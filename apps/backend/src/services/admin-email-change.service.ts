import crypto from 'node:crypto';
import { OtpChannel, OtpPurpose, Prisma, SecurityEventType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { lockUserTokenLifecycle, revokeAdminSessions } from '../repositories/auth.repository.js';
import { DeliveryPublisher } from '../sockets/delivery.publisher.js';
import { verifyPassword } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { recordAdminAudit } from './admin-audit.js';
import { credentialFingerprint, type RequestMeta } from './admin-mfa.service.js';
import { STEP_UP_WINDOW_MS } from './admin-session.js';
import { OTP_CONFIG, OtpVerificationError, otpService } from './otp.service.js';
import { dispatchAdminEmailChangeNotices, sendAdminEmailChangeOtp, queueAdminEmailChangeNotices } from './admin-email-change-email.js';
import { z } from 'zod';

const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const stepUpRequired = () => new AppError('Confirm it is you to continue.', 403, 'STEP_UP_REQUIRED');
const sessionInvalid = () => new AppError('Your administrator session has ended. Sign in again.', 401, 'ADMIN_SESSION_INVALID');
const inactiveAccount = () => new AppError('This administrator account is no longer active.', 409, 'ACCOUNT_INACTIVE');
const accountChanged = () => new AppError('Your account security state changed. Start the email change again.', 409, 'EMAIL_CHANGE_AUTHORIZATION_STALE');
const conflict = () => new AppError('That email address is already in use or reserved.', 409, 'EMAIL_ALREADY_REGISTERED');
const noRequest = () => new AppError('There is no active email change to verify.', 409, 'EMAIL_CHANGE_NOT_FOUND');
const expired = () => new AppError('This email change expired. Start again.', 410, 'EMAIL_CHANGE_EXPIRED');

type Tx = Prisma.TransactionClient;
type AuthorizationRow = Prisma.AdminEmailChangeAuthorizationGetPayload<{ include: { challenge: true } }>;

/** A digest over factor/capability state, excluding counters and last-use telemetry that do not change factor authority. */
async function securityFingerprint(tx: Tx, userId: string): Promise<string> {
  const state = await tx.user.findUnique({ where: { id: userId }, select: {
    adminSecurity: { select: { isOwner: true, canManageAdmins: true, mfaEnrolledAt: true } },
    adminMfaFactors: { orderBy: { id: 'asc' }, select: { id: true, secretCiphertext: true, keyVersion: true, verifiedAt: true, disabledAt: true } },
    adminRecoveryCodes: { orderBy: { id: 'asc' }, select: { id: true, batchId: true, consumedAt: true, revokedAt: true } },
    adminWebAuthnCredentials: { orderBy: { id: 'asc' }, select: { id: true, credentialId: true, publicKey: true, revokedAt: true } },
  } });
  if (!state?.adminSecurity) throw inactiveAccount();
  const stable = {
    capabilities: state.adminSecurity,
    totp: state.adminMfaFactors,
    recovery: state.adminRecoveryCodes,
    passkeys: state.adminWebAuthnCredentials.map(({ publicKey, ...factor }) => ({ ...factor, publicKey: Buffer.from(publicKey).toString('base64') })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

async function liveFreshSession(tx: Tx, userId: string, familyId: string, expectedStepUpAt?: Date) {
  const session = await tx.adminSession.findFirst({ where: { userId, familyId, revokedAt: null }, select: { stepUpAt: true } });
  const stepUpAt = session?.stepUpAt;
  if (!session) throw sessionInvalid();
  if (!stepUpAt || Date.now() - stepUpAt.getTime() > STEP_UP_WINDOW_MS) throw stepUpRequired();
  if (expectedStepUpAt && stepUpAt.getTime() !== expectedStepUpAt.getTime()) throw accountChanged();
  return stepUpAt;
}

async function assertAvailable(tx: Tx, userId: string, email: string) {
  const existing = await tx.user.findFirst({ where: { id: { not: userId }, OR: [
    { email: { equals: email, mode: 'insensitive' } }, { pendingEmail: { equals: email, mode: 'insensitive' } },
  ] }, select: { id: true } });
  if (existing) throw conflict();
}

function activeAuthorization(row: AuthorizationRow | null, familyId: string, now: Date): AuthorizationRow {
  if (!row || row.sessionFamilyId !== familyId || row.cancelledAt || row.consumedAt) throw noRequest();
  if (row.expiresAt <= now) throw expired();
  return row;
}

async function currentAdmin(tx: Tx, userId: string) {
  const user = await tx.user.findFirst({ where: { id: userId, isActive: true, role: { name: 'ADMIN' } },
    select: { id: true, email: true, pendingEmail: true, passwordHash: true, emailVerifiedAt: true } });
  if (!user) throw inactiveAccount();
  return user;
}

async function invalidateAuthorization(tx: Tx, userId: string, targetEmail: string, now: Date, cancelled: boolean) {
  await tx.otpChallenge.updateMany({ where: { userId, purpose: OtpPurpose.EMAIL_CHANGE, destination: targetEmail, consumedAt: null, lockedAt: null },
    data: { lockedAt: now } });
  await tx.user.updateMany({ where: { id: userId, pendingEmail: targetEmail }, data: { pendingEmail: null } });
  await tx.adminEmailChangeAuthorization.updateMany({ where: { userId, cancelledAt: null, consumedAt: null },
    data: cancelled ? { cancelledAt: now } : { consumedAt: now } });
}

async function makeChallenge(tx: Tx, userId: string, destination: string, now: Date) {
  await tx.otpChallenge.updateMany({ where: { userId, purpose: OtpPurpose.EMAIL_CHANGE, consumedAt: null, lockedAt: null }, data: { lockedAt: now } });
  const code = otpService.generateCode();
  const challenge = await tx.otpChallenge.create({ data: { userId, purpose: OtpPurpose.EMAIL_CHANGE, channel: OtpChannel.EMAIL, destination,
    codeHash: otpService.hashCode(code), expiresAt: new Date(now.getTime() + OTP_CONFIG.TTL_MS), attempts: 0, maxAttempts: OTP_CONFIG.MAX_ATTEMPTS,
    resendCount: 0, lastSentAt: now }, select: { id: true, expiresAt: true } });
  return { code, challenge };
}

export class AdminEmailChangeService {
  async request(userId: string, familyId: string, input: { newEmail: string; currentPassword: string }) {
    const parsedEmail = z.string().trim().email().max(255).safeParse(input.newEmail);
    if (!parsedEmail.success) throw new AppError('Enter a valid email address.', 400, 'EMAIL_INVALID');
    if (typeof input.currentPassword !== 'string' || input.currentPassword.length < 1 || input.currentPassword.length > 128) {
      throw new AppError('Enter your current password.', 400, 'INVALID_CURRENT_PASSWORD');
    }
    const targetEmail = normalizeEmail(parsedEmail.data);
    const before = await prisma.user.findFirst({ where: { id: userId, isActive: true, role: { name: 'ADMIN' } },
      select: { email: true, passwordHash: true } });
    if (!before) throw inactiveAccount();
    if (!before.passwordHash || !await verifyPassword(input.currentPassword, before.passwordHash)) {
      throw new AppError('Your current password is incorrect.', 400, 'INVALID_CURRENT_PASSWORD');
    }

    const started = await prisma.$transaction(async tx => {
      await lockUserTokenLifecycle(tx, userId);
      const now = new Date();
      const sessionStepUpAt = await liveFreshSession(tx, userId, familyId);
      const user = await currentAdmin(tx, userId);
      if (user.passwordHash !== before.passwordHash || normalizeEmail(user.email) !== normalizeEmail(before.email)) throw accountChanged();
      if (!user.emailVerifiedAt) throw new AppError('Verify the administrator email before changing it.', 409, 'ADMIN_EMAIL_UNVERIFIED');
      if (targetEmail === normalizeEmail(user.email)) throw new AppError('Enter a different email address.', 400, 'EMAIL_UNCHANGED');
      await assertAvailable(tx, userId, targetEmail);

      const { code, challenge } = await makeChallenge(tx, userId, targetEmail, now);
      const authExpiresAt = new Date(Math.min(now.getTime() + AUTHORIZATION_TTL_MS, sessionStepUpAt.getTime() + STEP_UP_WINDOW_MS));
      const fingerprint = await securityFingerprint(tx, userId);
      await tx.user.update({ where: { id: userId }, data: { pendingEmail: targetEmail } });
      await tx.adminEmailChangeAuthorization.upsert({ where: { userId }, create: { userId, currentEmail: user.email, targetEmail, sessionFamilyId: familyId,
        credentialFingerprint: credentialFingerprint(user.passwordHash), securityFingerprint: fingerprint, stepUpAt: sessionStepUpAt, challengeId: challenge.id,
        expiresAt: authExpiresAt, resendAvailableAt: new Date(now.getTime() + OTP_CONFIG.RESEND_COOLDOWN_MS) },
      update: { currentEmail: user.email, targetEmail, sessionFamilyId: familyId, credentialFingerprint: credentialFingerprint(user.passwordHash),
        securityFingerprint: fingerprint, stepUpAt: sessionStepUpAt, challengeId: challenge.id, expiresAt: authExpiresAt,
        resendAvailableAt: new Date(now.getTime() + OTP_CONFIG.RESEND_COOLDOWN_MS), cancelledAt: null, consumedAt: null } });
      await recordAdminAudit({ actorId: userId, action: 'ADMIN_EMAIL_CHANGE_REQUESTED', resourceType: 'admin_user', resourceId: userId,
        outcome: 'SUCCESS', details: { targetEmailDigest: crypto.createHash('sha256').update(targetEmail).digest('hex') } }, tx);
      return { code, targetEmail, expiresAt: authExpiresAt, otpExpiresAt: challenge.expiresAt,
        resendAvailableAt: new Date(now.getTime() + OTP_CONFIG.RESEND_COOLDOWN_MS), attemptsRemaining: OTP_CONFIG.MAX_ATTEMPTS };
    }, { timeout: 15000 });

    const delivered = await sendAdminEmailChangeOtp(started.targetEmail, started.code, userId);
    if (!delivered) logger.warn('ADMIN_EMAIL_CHANGE_OTP_NOT_DELIVERED', { userId });
    return { pendingEmail: started.targetEmail, expiresAt: started.expiresAt, otpExpiresAt: started.otpExpiresAt,
      resendAvailableAt: started.resendAvailableAt, attemptsRemaining: started.attemptsRemaining,
      deliveryStatus: delivered ? 'ACCEPTED_BY_PROVIDER' as const : 'FAILED' as const };
  }

  async status(userId: string, familyId: string) {
    const now = new Date();
    const row = await prisma.adminEmailChangeAuthorization.findUnique({ where: { userId }, include: { challenge: true } });
    if (!row || row.sessionFamilyId !== familyId || row.cancelledAt || row.consumedAt || row.expiresAt <= now) return { active: false as const };
    const user = await prisma.user.findFirst({ where: { id: userId, isActive: true, role: { name: 'ADMIN' }, pendingEmail: row.targetEmail }, select: { id: true } });
    if (!user || !row.challenge || row.challenge.userId !== userId || row.challenge.purpose !== OtpPurpose.EMAIL_CHANGE || row.challenge.destination !== row.targetEmail) {
      return { active: false as const };
    }
    return { active: true as const, pendingEmail: row.targetEmail, expiresAt: row.expiresAt, otpExpiresAt: row.challenge.expiresAt,
      resendAvailableAt: row.resendAvailableAt, attemptsRemaining: Math.max(0, row.challenge.maxAttempts - row.challenge.attempts) };
  }

  async resend(userId: string, familyId: string) {
    const result = await prisma.$transaction(async tx => {
      await lockUserTokenLifecycle(tx, userId);
      const now = new Date();
      const row = activeAuthorization(await tx.adminEmailChangeAuthorization.findUnique({ where: { userId }, include: { challenge: true } }), familyId, now);
      const stepUpAt = await liveFreshSession(tx, userId, familyId, row.stepUpAt);
      const user = await currentAdmin(tx, userId);
      if (user.email !== row.currentEmail || user.pendingEmail !== row.targetEmail || credentialFingerprint(user.passwordHash) !== row.credentialFingerprint ||
        await securityFingerprint(tx, userId) !== row.securityFingerprint || stepUpAt.getTime() !== row.stepUpAt.getTime()) {
        await invalidateAuthorization(tx, userId, row.targetEmail, now, true);
        return { stale: true as const };
      }
      if (row.resendAvailableAt > now) throw new AppError('Wait before requesting another verification code.', 429, 'OTP_RESEND_COOLDOWN');
      const { code, challenge } = await makeChallenge(tx, userId, row.targetEmail, now);
      const resendAvailableAt = new Date(now.getTime() + OTP_CONFIG.RESEND_COOLDOWN_MS);
      await tx.adminEmailChangeAuthorization.update({ where: { userId }, data: { challengeId: challenge.id, resendAvailableAt } });
      return { stale: false as const, code, targetEmail: row.targetEmail, expiresAt: row.expiresAt, otpExpiresAt: challenge.expiresAt,
        resendAvailableAt, attemptsRemaining: OTP_CONFIG.MAX_ATTEMPTS };
    }, { timeout: 15000 });
    if (result.stale) throw accountChanged();
    const delivered = await sendAdminEmailChangeOtp(result.targetEmail, result.code, userId);
    if (!delivered) logger.warn('ADMIN_EMAIL_CHANGE_OTP_NOT_DELIVERED', { userId });
    return { pendingEmail: result.targetEmail, expiresAt: result.expiresAt, otpExpiresAt: result.otpExpiresAt,
      resendAvailableAt: result.resendAvailableAt, attemptsRemaining: result.attemptsRemaining,
      deliveryStatus: delivered ? 'ACCEPTED_BY_PROVIDER' as const : 'FAILED' as const };
  }

  async cancel(userId: string, familyId: string) {
    await prisma.$transaction(async tx => {
      await lockUserTokenLifecycle(tx, userId);
      const row = await tx.adminEmailChangeAuthorization.findUnique({ where: { userId } });
      if (!row || row.sessionFamilyId !== familyId || row.cancelledAt || row.consumedAt) return;
      await invalidateAuthorization(tx, userId, row.targetEmail, new Date(), true);
    }, { timeout: 15000 });
    return { cancelled: true as const };
  }

  async verify(userId: string, familyId: string, code: string, meta?: RequestMeta) {
    if (!/^\d{6}$/.test(code)) throw new AppError('Enter the six-digit code.', 400, 'VALIDATION_FAILED');
    const now = new Date();
    let result: { failure: 'OTP_INCORRECT' | 'OTP_EXPIRED' | 'OTP_CONSUMED' | 'OTP_ATTEMPTS_EXHAUSTED' | 'OTP_INVALID'; attemptsRemaining?: number } | {
      success: true; oldEmail: string; newEmail: string; notificationIds: string[];
    };
    try {
      result = await prisma.$transaction(async tx => {
        await lockUserTokenLifecycle(tx, userId);
        const authorization = activeAuthorization(await tx.adminEmailChangeAuthorization.findUnique({ where: { userId }, include: { challenge: true } }), familyId, now);
        const stepUpAt = await liveFreshSession(tx, userId, familyId, authorization.stepUpAt);
        const user = await currentAdmin(tx, userId);
        const fingerprint = await securityFingerprint(tx, userId);
        if (normalizeEmail(user.email) !== normalizeEmail(authorization.currentEmail) || user.pendingEmail !== authorization.targetEmail ||
          credentialFingerprint(user.passwordHash) !== authorization.credentialFingerprint || fingerprint !== authorization.securityFingerprint ||
          stepUpAt.getTime() !== authorization.stepUpAt.getTime()) {
          await invalidateAuthorization(tx, userId, authorization.targetEmail, now, true);
          return { failure: 'OTP_INVALID' as const };
        }
        await assertAvailable(tx, userId, authorization.targetEmail);
        const challenge = authorization.challenge;
        if (!challenge || challenge.id !== authorization.challengeId || challenge.userId !== userId || challenge.purpose !== OtpPurpose.EMAIL_CHANGE ||
          challenge.destination !== authorization.targetEmail || challenge.consumedAt) return { failure: 'OTP_INVALID' as const };
        if (challenge.lockedAt || challenge.attempts >= challenge.maxAttempts) return { failure: 'OTP_ATTEMPTS_EXHAUSTED' as const, attemptsRemaining: 0 };
        if (challenge.expiresAt <= now) return { failure: 'OTP_EXPIRED' as const };

        if (!otpService.matchesCode(code, challenge.codeHash)) {
          const incremented = await tx.otpChallenge.updateMany({ where: { id: challenge.id, userId, purpose: OtpPurpose.EMAIL_CHANGE,
            codeHash: challenge.codeHash, consumedAt: null, lockedAt: null, attempts: challenge.attempts, expiresAt: { gt: now } },
          data: { attempts: { increment: 1 } } });
          if (incremented.count !== 1) return { failure: 'OTP_CONSUMED' as const };
          const attempts = challenge.attempts + 1;
          if (attempts >= challenge.maxAttempts) {
            await tx.otpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, lockedAt: null, attempts: { gte: challenge.maxAttempts } }, data: { lockedAt: now } });
            return { failure: 'OTP_ATTEMPTS_EXHAUSTED' as const, attemptsRemaining: 0 };
          }
          return { failure: 'OTP_INCORRECT' as const, attemptsRemaining: challenge.maxAttempts - attempts };
        }

        const consumed = await tx.otpChallenge.updateMany({ where: { id: challenge.id, userId, purpose: OtpPurpose.EMAIL_CHANGE, destination: authorization.targetEmail,
          codeHash: challenge.codeHash, consumedAt: null, lockedAt: null, expiresAt: { gt: now }, attempts: { lt: challenge.maxAttempts } }, data: { consumedAt: now } });
        if (consumed.count !== 1) return { failure: 'OTP_CONSUMED' as const };

        const promoted = await tx.user.updateMany({ where: { id: userId, email: authorization.currentEmail, pendingEmail: authorization.targetEmail, isActive: true },
          data: { email: authorization.targetEmail, pendingEmail: null, emailVerifiedAt: now } });
        if (promoted.count !== 1) throw accountChanged();
        await tx.adminEmailChangeAuthorization.update({ where: { userId }, data: { consumedAt: now } });
        await tx.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true, expiresAt: new Date(0) } });
        await revokeAdminSessions(tx, { userId }, 'EMAIL_CHANGED');
        await tx.adminAuthChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
        await tx.passwordResetToken.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
        await tx.otpChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
        await tx.securityEvent.create({ data: { userId, type: SecurityEventType.EMAIL_CHANGED, ipAddress: meta?.ipAddress ?? null, userAgent: meta?.userAgent?.slice(0, 1000) ?? null } });
        await recordAdminAudit({ actorId: userId, action: 'ADMIN_EMAIL_CHANGED', resourceType: 'admin_user', resourceId: userId, outcome: 'SUCCESS',
          details: { previousEmailDigest: crypto.createHash('sha256').update(authorization.currentEmail).digest('hex'),
            newEmailDigest: crypto.createHash('sha256').update(authorization.targetEmail).digest('hex') } }, tx);
        const notificationIds = await queueAdminEmailChangeNotices(tx, userId, authorization.currentEmail, authorization.targetEmail);
        return { success: true as const, oldEmail: authorization.currentEmail, newEmail: authorization.targetEmail, notificationIds };
      }, { timeout: 20000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict();
      throw error;
    }

    if ('failure' in result) throw new OtpVerificationError(result.failure, result.attemptsRemaining);
    DeliveryPublisher.disconnectUser(userId, 'LOGOUT');
    await dispatchAdminEmailChangeNotices(result.notificationIds);
    return { changed: true as const, email: result.newEmail, signedOut: true as const };
  }
}

export const adminEmailChangeService = new AdminEmailChangeService();
