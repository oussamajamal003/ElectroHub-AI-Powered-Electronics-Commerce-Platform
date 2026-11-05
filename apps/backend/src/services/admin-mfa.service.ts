import crypto from 'node:crypto';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { AdminChallengePurpose, AdminMfaMethod, Prisma, SecurityEventType, type Role, type User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { lockUserTokenLifecycle } from '../repositories/auth.repository.js';
import { logger } from '../utils/logger.js';
import {
  base32Encode, decryptSecret, encryptSecret, generateRecoveryCode, keyedDigest, normalizeRecoveryCode, otpauthUri, randomToken,
  recoveryCodeDigests, sha256Hex, verifyTotp,
} from './admin-crypto.js';

/**
 * Task 05.2 administrator multi-factor authentication. Sessions are issued exclusively through AuthService.createAssuredAdminSession
 * after one of the proofs below succeeds against a restricted, single-use pre-auth transaction (admin_auth_challenges).
 */

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const CHALLENGE_MAX_ATTEMPTS = 5;
export const RECOVERY_CODE_COUNT = 10;
export const INVITE_ENROLLMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface RequestMeta { userAgent?: string | null; ipAddress?: string | null }
type AdminUser = User & { role: Role };

const challengeInvalid = () => new AppError('Your sign-in attempt expired or is no longer valid. Start again.', 401, 'MFA_CHALLENGE_INVALID');
const codeInvalid = (attemptsRemaining: number) =>
  Object.assign(new AppError('That code is not valid. Check it and try again.', 401, 'MFA_CODE_INVALID'), { attemptsRemaining });

export const credentialFingerprint = (passwordHash: string | null) => sha256Hex(`admin-credential:${passwordHash ?? ''}`);

/** Truncate to a network prefix: enough to recognise "same office / different country", never a full address. */
export function maskIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  const groups = ip.split(':').filter(Boolean);
  return groups.length >= 3 ? `${groups.slice(0, 3).join(':')}::/48` : null;
}

export function webauthnConfig() {
  const frontend = env.FRONTEND_URL || 'http://localhost:3000';
  return {
    rpID: env.WEBAUTHN_RP_ID || new URL(frontend).hostname,
    rpName: env.WEBAUTHN_RP_NAME || 'ElectroHub Admin',
    origin: env.WEBAUTHN_ORIGIN || new URL(frontend).origin,
  };
}

const totpAad = (userId: string, factorId: string) => `admin-totp:${userId}:${factorId}`;

async function authService() {
  // Imported lazily: AuthService delegates ADMIN logins here, so a static import would be circular.
  const { AuthService } = await import('./auth.service.js');
  return new AuthService();
}

async function securityEvent(type: SecurityEventType, userId: string, meta?: RequestMeta, client: Prisma.TransactionClient = prisma) {
  await client.securityEvent.create({ data: { userId, type, ipAddress: meta?.ipAddress ?? null, userAgent: meta?.userAgent?.slice(0, 1000) ?? null } });
}

export class AdminMfaService {
  // ── Factor inventory ─────────────────────────────────────────────────────
  async factorSummary(userId: string, client: Prisma.TransactionClient = prisma) {
    const [totp, passkeys, recovery] = await Promise.all([
      client.adminMfaFactor.count({ where: { userId, verifiedAt: { not: null }, disabledAt: null } }),
      client.adminWebAuthnCredential.count({ where: { userId, revokedAt: null } }),
      client.adminRecoveryCode.count({ where: { userId, consumedAt: null, revokedAt: null } }),
    ]);
    return { totp, passkeys, recoveryCodes: recovery };
  }

  // ── Login: primary proof already verified by AuthService.login ───────────
  async startLogin(user: AdminUser) {
    const mfaToken = randomToken();
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    const state = await prisma.$transaction(async tx => {
      await lockUserTokenLifecycle(tx, user.id);
      const currentUser = await tx.user.findUnique({ where: { id: user.id }, include: { role: true } });
      if (!currentUser || !currentUser.isActive || currentUser.role.name !== 'ADMIN' ||
        credentialFingerprint(currentUser.passwordHash) !== credentialFingerprint(user.passwordHash)) throw challengeInvalid();
      const [factors, security] = await Promise.all([
        this.factorSummary(user.id, tx),
        tx.adminAccountSecurity.findUnique({ where: { userId: user.id }, select: { enrollmentAllowedUntil: true } }),
      ]);
      const enrollmentRequired = factors.totp + factors.passkeys === 0;
      if (enrollmentRequired && !(security?.enrollmentAllowedUntil && security.enrollmentAllowedUntil > new Date())) {
        await securityEvent(SecurityEventType.ADMIN_MFA_CHALLENGE_FAILED, user.id, undefined, tx);
        return { denied: true as const };
      }
      // A new sign-in attempt supersedes any earlier unfinished one: attempts cannot be multiplied by parallel challenges.
      await tx.adminAuthChallenge.updateMany({ where: { userId: user.id, purpose: AdminChallengePurpose.LOGIN, consumedAt: null }, data: { consumedAt: new Date() } });
      await tx.adminAuthChallenge.create({ data: { tokenHash: sha256Hex(mfaToken), userId: user.id, purpose: AdminChallengePurpose.LOGIN,
        credentialFingerprint: credentialFingerprint(currentUser.passwordHash), expiresAt, maxAttempts: CHALLENGE_MAX_ATTEMPTS } });
      return { denied: false as const, enrollmentRequired, factors };
    });
    if (state.denied) throw new AppError('Two-step verification must be authorised by an owner before this account can sign in.', 403, 'ENROLLMENT_NOT_AUTHORIZED');
    return {
      requiresMfa: true as const, mfaToken, expiresAt, enrollmentRequired: state.enrollmentRequired,
      factors: { totp: state.factors.totp > 0, passkey: state.factors.passkeys > 0, recoveryCode: state.factors.recoveryCodes > 0 },
    };
  }

  /** Resolve a live LOGIN transaction and the still-eligible administrator it was issued for. */
  private async loginChallenge(mfaToken: string) {
    if (typeof mfaToken !== 'string' || mfaToken.length < 20 || mfaToken.length > 200) throw challengeInvalid();
    const challenge = await prisma.adminAuthChallenge.findUnique({ where: { tokenHash: sha256Hex(mfaToken) }, include: { user: { include: { role: true } } } });
    if (!challenge || challenge.purpose !== AdminChallengePurpose.LOGIN || challenge.consumedAt || challenge.expiresAt <= new Date() ||
      challenge.attempts >= challenge.maxAttempts || !challenge.user.isActive || challenge.user.role.name !== 'ADMIN' ||
      challenge.credentialFingerprint !== credentialFingerprint(challenge.user.passwordHash)) throw challengeInvalid();
    return challenge;
  }

  /** Count a failed proof atomically; the last allowed failure burns the transaction. */
  private async failAttempt(challengeId: string, userId: string, meta?: RequestMeta): Promise<never> {
    const rows = await prisma.$queryRaw<{ attempts: number; maxAttempts: number }[]>`
      UPDATE "admin_auth_challenges" SET "attempts" = "attempts" + 1,
        "consumedAt" = CASE WHEN "attempts" + 1 >= "maxAttempts" THEN now() ELSE "consumedAt" END
      WHERE "id" = ${challengeId}::uuid AND "consumedAt" IS NULL AND "attempts" < "maxAttempts"
      RETURNING "attempts", "maxAttempts"`;
    await securityEvent(SecurityEventType.ADMIN_MFA_CHALLENGE_FAILED, userId, meta);
    // No row: a concurrent request already completed or burned this transaction — it is simply no longer valid.
    if (!rows[0]) throw challengeInvalid();
    const remaining = rows[0].maxAttempts - rows[0].attempts;
    if (remaining <= 0) throw new AppError('Too many incorrect codes. Start signing in again.', 429, 'MFA_ATTEMPTS_EXCEEDED');
    throw codeInvalid(remaining);
  }

  private async consume(tx: Prisma.TransactionClient, challengeId: string) {
    const consumed = await tx.adminAuthChallenge.updateMany({
      where: { id: challengeId, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw challengeInvalid();
  }

  /**
   * `user` is the snapshot the challenge was validated against (its password hash matched the challenge fingerprint). Session issuance
   * re-compares that snapshot with the committed account under the lifecycle lock, so a password change, deactivation or role change
   * that lands while the factor is being verified yields no session.
   */
  private async issue(user: AdminUser, method: AdminMfaMethod, meta?: RequestMeta) {
    try {
      return await (await authService()).createAssuredAdminSession(user, { method, userAgent: meta?.userAgent, ipAddress: meta?.ipAddress });
    } catch {
      throw challengeInvalid();
    }
  }

  /** Verify a TOTP code against the user's active factors and atomically advance that factor's replay guard. */
  private async acceptTotp(tx: Prisma.TransactionClient, userId: string, code: string): Promise<boolean> {
    const factors = await tx.adminMfaFactor.findMany({ where: { userId, verifiedAt: { not: null }, disabledAt: null } });
    for (const factor of factors) {
      const step = verifyTotp(decryptSecret(factor.secretCiphertext, factor.keyVersion, totpAad(userId, factor.id)), code);
      if (step === null) continue;
      const advanced = await tx.adminMfaFactor.updateMany({
        where: { id: factor.id, disabledAt: null, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] }, data: { lastUsedStep: step } });
      return advanced.count === 1; // 0 = this time step was already used (replay)
    }
    return false;
  }

  async verifyLoginTotp(mfaToken: string, code: string, meta?: RequestMeta) {
    const challenge = await this.loginChallenge(mfaToken);
    const ok = await prisma.$transaction(async tx => {
      if (!await this.acceptTotp(tx, challenge.userId, code)) return false;
      await this.consume(tx, challenge.id);
      return true;
    });
    if (!ok) return this.failAttempt(challenge.id, challenge.userId, meta);
    return this.issue(challenge.user, AdminMfaMethod.TOTP, meta);
  }

  async verifyLoginRecoveryCode(mfaToken: string, code: string, meta?: RequestMeta) {
    const challenge = await this.loginChallenge(mfaToken);
    const ok = await prisma.$transaction(async tx => {
      if (!await this.consumeRecoveryCode(tx, challenge.userId, code)) return false;
      await this.consume(tx, challenge.id);
      await securityEvent(SecurityEventType.ADMIN_RECOVERY_CODE_USED, challenge.userId, meta, tx);
      return true;
    });
    if (!ok) return this.failAttempt(challenge.id, challenge.userId, meta);
    return this.issue(challenge.user, AdminMfaMethod.RECOVERY_CODE, meta);
  }

  private async consumeRecoveryCode(tx: Prisma.TransactionClient, userId: string, code: string): Promise<boolean> {
    const normalized = normalizeRecoveryCode(code);
    if (!/^[A-Z2-7]{12}$/.test(normalized)) return false;
    const used = await tx.adminRecoveryCode.updateMany({
      where: { userId, codeHash: { in: recoveryCodeDigests(normalized) }, consumedAt: null, revokedAt: null }, data: { consumedAt: new Date() } });
    return used.count === 1;
  }

  async loginWebAuthnOptions(mfaToken: string) {
    const challenge = await this.loginChallenge(mfaToken);
    const credentials = await prisma.adminWebAuthnCredential.findMany({ where: { userId: challenge.userId, revokedAt: null } });
    if (credentials.length === 0) throw new AppError('No passkey is registered for this account.', 422, 'NO_PASSKEY');
    const options = await generateAuthenticationOptions({
      rpID: webauthnConfig().rpID, userVerification: 'required', timeout: 120_000,
      allowCredentials: credentials.map(item => ({ id: item.credentialId, transports: item.transports as never })),
    });
    await prisma.adminAuthChallenge.update({ where: { id: challenge.id }, data: { webauthnChallenge: options.challenge } });
    return { options };
  }

  async verifyLoginWebAuthn(mfaToken: string, response: AuthenticationResponseJSON, meta?: RequestMeta) {
    const challenge = await this.loginChallenge(mfaToken);
    if (!challenge.webauthnChallenge) throw challengeInvalid();
    if (!await this.acceptAssertion(challenge.userId, challenge.webauthnChallenge, response, async tx => this.consume(tx, challenge.id))) {
      return this.failAttempt(challenge.id, challenge.userId, meta);
    }
    return this.issue(challenge.user, AdminMfaMethod.WEBAUTHN, meta);
  }

  /** Cryptographically verify an assertion for one of the user's own live credentials; counter advanced in the same transaction. */
  private async acceptAssertion(userId: string, expectedChallenge: string, response: AuthenticationResponseJSON,
    onAccepted: (tx: Prisma.TransactionClient) => Promise<void>): Promise<boolean> {
    if (!response || typeof response.id !== 'string') return false;
    const credential = await prisma.adminWebAuthnCredential.findFirst({ where: { credentialId: response.id, userId, revokedAt: null } });
    if (!credential) return false;
    const { rpID, origin } = webauthnConfig();
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
        credential: { id: credential.credentialId, publicKey: new Uint8Array(credential.publicKey), counter: Number(credential.counter), transports: credential.transports },
      });
    } catch (error) {
      logger.warn('ADMIN_WEBAUTHN_ASSERTION_REJECTED', { userId, reason: error instanceof Error ? error.name : 'unknown' });
      return false;
    }
    if (!verification.verified) return false;
    return prisma.$transaction(async tx => {
      const advanced = await tx.adminWebAuthnCredential.updateMany({
        where: { id: credential.id, revokedAt: null, counter: credential.counter },
        data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() } });
      if (advanced.count !== 1) return false;
      await onAccepted(tx);
      return true;
    });
  }

  // ── First-factor enrollment inside a LOGIN transaction ───────────────────
  async startLoginEnrollment(mfaToken: string) {
    const challenge = await this.loginChallenge(mfaToken);
    await this.assertEnrollmentAllowed(challenge.userId);
    return this.createPendingTotp(challenge.userId, challenge.user.email, 'Authenticator app');
  }

  private async assertEnrollmentAllowed(userId: string, client: Prisma.TransactionClient = prisma) {
    const [summary, security] = await Promise.all([this.factorSummary(userId, client),
      client.adminAccountSecurity.findUnique({ where: { userId }, select: { enrollmentAllowedUntil: true } })]);
    if (summary.totp + summary.passkeys > 0) throw new AppError('Two-step verification is already set up for this account.', 409, 'ALREADY_ENROLLED');
    if (!(security?.enrollmentAllowedUntil && security.enrollmentAllowedUntil > new Date())) {
      throw new AppError('Two-step verification must be authorised by an owner before this account can sign in.', 403, 'ENROLLMENT_NOT_AUTHORIZED');
    }
  }

  private async createPendingTotp(userId: string, email: string, label: string) {
    const secret = crypto.randomBytes(20);
    const factorId = crypto.randomUUID();
    const sealed = encryptSecret(secret, totpAad(userId, factorId));
    await prisma.$transaction(async tx => {
      // Abandoned enrollments are not history: they never protected anything and are replaced.
      await tx.adminMfaFactor.deleteMany({ where: { userId, verifiedAt: null } });
      await tx.adminMfaFactor.create({ data: { id: factorId, userId, label, secretCiphertext: sealed.ciphertext, keyVersion: sealed.keyVersion } });
    });
    const secretBase32 = base32Encode(secret);
    return { factorId, otpauthUri: otpauthUri(secretBase32, email), secret: secretBase32 };
  }

  /** Activate a pending factor when the code proves the authenticator holds the secret. Returns false on a wrong/replayed code. */
  private async activatePendingTotp(tx: Prisma.TransactionClient, userId: string, factorId: string, code: string): Promise<boolean> {
    const factor = await tx.adminMfaFactor.findFirst({ where: { id: factorId, userId, verifiedAt: null, disabledAt: null } });
    if (!factor) throw new AppError('This setup has expired. Start again.', 409, 'ENROLLMENT_EXPIRED');
    const step = verifyTotp(decryptSecret(factor.secretCiphertext, factor.keyVersion, totpAad(userId, factor.id)), code);
    if (step === null) return false;
    const activated = await tx.adminMfaFactor.updateMany({ where: { id: factor.id, verifiedAt: null }, data: { verifiedAt: new Date(), lastUsedStep: step } });
    return activated.count === 1;
  }

  async confirmLoginEnrollment(mfaToken: string, factorId: string, code: string, meta?: RequestMeta) {
    const challenge = await this.loginChallenge(mfaToken);
    const result = await prisma.$transaction(async tx => {
      await lockUserTokenLifecycle(tx, challenge.userId);
      // Password changes and account deactivation use the same lifecycle lock. Re-read both sides of the proof
      // after acquiring it so a challenge validated just before a credential change cannot enroll stale proof.
      const [user, currentChallenge] = await Promise.all([
        tx.user.findUnique({ where: { id: challenge.userId }, include: { role: true } }),
        tx.adminAuthChallenge.findUnique({ where: { id: challenge.id } }),
      ]);
      if (!user || !user.isActive || user.role.name !== 'ADMIN' || !currentChallenge || currentChallenge.purpose !== AdminChallengePurpose.LOGIN ||
        currentChallenge.consumedAt || currentChallenge.expiresAt <= new Date() || currentChallenge.attempts >= currentChallenge.maxAttempts ||
        currentChallenge.credentialFingerprint !== credentialFingerprint(user.passwordHash) ||
        currentChallenge.credentialFingerprint !== challenge.credentialFingerprint) throw challengeInvalid();
      await this.assertEnrollmentAllowed(challenge.userId, tx);
      if (!await this.activatePendingTotp(tx, challenge.userId, factorId, code)) return null;
      await this.consume(tx, challenge.id);
      await tx.adminAccountSecurity.upsert({ where: { userId: challenge.userId },
        create: { userId: challenge.userId, mfaEnrolledAt: new Date() }, update: { mfaEnrolledAt: new Date(), enrollmentAllowedUntil: null } });
      await securityEvent(SecurityEventType.ADMIN_MFA_ENROLLED, challenge.userId, meta, tx);
      return { codes: await this.replaceRecoveryCodes(tx, challenge.userId), user };
    });
    if (!result) return this.failAttempt(challenge.id, challenge.userId, meta);
    const session = await this.issue(result.user, AdminMfaMethod.TOTP, meta);
    return { ...session, recoveryCodes: result.codes };
  }

  private async replaceRecoveryCodes(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
    await tx.adminRecoveryCode.updateMany({ where: { userId, consumedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const batchId = crypto.randomUUID();
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    await tx.adminRecoveryCode.createMany({ data: codes.map(code => ({ userId, batchId, codeHash: keyedDigest(normalizeRecoveryCode(code)) })) });
    return codes;
  }

  // ── Step-up inside a live session ────────────────────────────────────────
  private async markStepUp(tx: Prisma.TransactionClient, userId: string, familyId: string, meta?: RequestMeta) {
    const updated = await tx.adminSession.updateMany({ where: { familyId, userId, revokedAt: null }, data: { stepUpAt: new Date() } });
    if (updated.count !== 1) throw new AppError('Your administrator session has ended. Sign in again.', 401, 'ADMIN_SESSION_INVALID');
    await securityEvent(SecurityEventType.ADMIN_STEP_UP_VERIFIED, userId, meta, tx);
  }

  async stepUpWithCode(userId: string, familyId: string, method: 'TOTP' | 'RECOVERY_CODE', code: string, meta?: RequestMeta) {
    const ok = await prisma.$transaction(async tx => {
      const accepted = method === 'TOTP' ? await this.acceptTotp(tx, userId, code) : await this.consumeRecoveryCode(tx, userId, code);
      if (!accepted) return false;
      if (method === 'RECOVERY_CODE') await securityEvent(SecurityEventType.ADMIN_RECOVERY_CODE_USED, userId, meta, tx);
      await this.markStepUp(tx, userId, familyId, meta);
      return true;
    });
    if (!ok) {
      await securityEvent(SecurityEventType.ADMIN_MFA_CHALLENGE_FAILED, userId, meta);
      throw new AppError('That code is not valid. Check it and try again.', 401, 'MFA_CODE_INVALID');
    }
  }

  /** Session-bound WebAuthn challenge (STEP_UP or WEBAUTHN_REGISTRATION); only the newest one for the session is honoured. */
  private async sessionChallenge(userId: string, familyId: string, purpose: AdminChallengePurpose, webauthnChallenge: string, fingerprintSource: string | null) {
    await prisma.$transaction(async tx => {
      await tx.adminAuthChallenge.updateMany({ where: { userId, sessionFamilyId: familyId, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
      await tx.adminAuthChallenge.create({ data: { tokenHash: sha256Hex(randomToken()), userId, purpose, sessionFamilyId: familyId, webauthnChallenge,
        credentialFingerprint: credentialFingerprint(fingerprintSource), expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS), maxAttempts: 1 } });
    });
  }

  private async liveSessionChallenge(userId: string, familyId: string, purpose: AdminChallengePurpose) {
    const challenge = await prisma.adminAuthChallenge.findFirst({
      where: { userId, sessionFamilyId: familyId, purpose, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    if (!challenge?.webauthnChallenge) throw new AppError('This passkey request expired. Try again.', 401, 'MFA_CHALLENGE_INVALID');
    return challenge;
  }

  async stepUpWebAuthnOptions(user: { id: string; passwordHash: string | null }, familyId: string) {
    const credentials = await prisma.adminWebAuthnCredential.findMany({ where: { userId: user.id, revokedAt: null } });
    if (credentials.length === 0) throw new AppError('No passkey is registered for this account.', 422, 'NO_PASSKEY');
    const options = await generateAuthenticationOptions({ rpID: webauthnConfig().rpID, userVerification: 'required', timeout: 120_000,
      allowCredentials: credentials.map(item => ({ id: item.credentialId, transports: item.transports as never })) });
    await this.sessionChallenge(user.id, familyId, AdminChallengePurpose.STEP_UP, options.challenge, user.passwordHash);
    return { options };
  }

  async stepUpWithWebAuthn(userId: string, familyId: string, response: AuthenticationResponseJSON, meta?: RequestMeta) {
    const challenge = await this.liveSessionChallenge(userId, familyId, AdminChallengePurpose.STEP_UP);
    const ok = await this.acceptAssertion(userId, challenge.webauthnChallenge!, response, async tx => {
      await this.consume(tx, challenge.id);
      await this.markStepUp(tx, userId, familyId, meta);
    });
    if (!ok) {
      await prisma.adminAuthChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
      await securityEvent(SecurityEventType.ADMIN_MFA_CHALLENGE_FAILED, userId, meta);
      throw new AppError('The passkey could not be verified.', 401, 'MFA_CODE_INVALID');
    }
  }

  // ── Self-service factor management (callers enforce step-up) ─────────────
  async listFactors(userId: string) {
    const [totp, passkeys, recovery] = await Promise.all([
      prisma.adminMfaFactor.findMany({ where: { userId, verifiedAt: { not: null }, disabledAt: null }, orderBy: { createdAt: 'asc' },
        select: { id: true, label: true, createdAt: true, verifiedAt: true, updatedAt: true } }),
      prisma.adminWebAuthnCredential.findMany({ where: { userId, revokedAt: null }, orderBy: { createdAt: 'asc' },
        select: { id: true, label: true, createdAt: true, lastUsedAt: true, deviceType: true, backedUp: true } }),
      prisma.adminRecoveryCode.findMany({ where: { userId, revokedAt: null }, select: { consumedAt: true, createdAt: true } }),
    ]);
    return {
      // lastUsedAt: the factor row changes only when a code is accepted (replay guard) or it is relabelled, so updatedAt is that moment.
      totp: totp.map(({ updatedAt, ...factor }) => ({ ...factor, lastUsedAt: updatedAt })), passkeys,
      recoveryCodes: { remaining: recovery.filter(code => !code.consumedAt).length, total: recovery.length,
        generatedAt: recovery.reduce<Date | null>((latest, code) => (!latest || code.createdAt > latest ? code.createdAt : latest), null) },
    };
  }

  async startAdditionalTotp(userId: string, email: string, label: string) {
    return this.createPendingTotp(userId, email, label);
  }

  async confirmAdditionalTotp(userId: string, factorId: string, code: string, meta?: RequestMeta) {
    const result = await prisma.$transaction(async tx => {
      await lockUserTokenLifecycle(tx, userId);
      if (!await this.activatePendingTotp(tx, userId, factorId, code)) return null;
      await tx.adminAccountSecurity.upsert({ where: { userId }, create: { userId, mfaEnrolledAt: new Date() }, update: {} });
      await securityEvent(SecurityEventType.ADMIN_MFA_ENROLLED, userId, meta, tx);
      // An administrator who has never had recovery codes gets a first batch with the first factor.
      const hasCodes = await tx.adminRecoveryCode.count({ where: { userId, revokedAt: null } });
      return { recoveryCodes: hasCodes === 0 ? await this.replaceRecoveryCodes(tx, userId) : null };
    });
    if (!result) throw new AppError('That code is not valid. Check it and try again.', 401, 'MFA_CODE_INVALID');
    return result;
  }

  /** Removing a factor never leaves the account without a usable TOTP or passkey (checked under the user lifecycle lock). */
  private async assertNotLastFactor(tx: Prisma.TransactionClient, userId: string) {
    const summary = await this.factorSummary(userId, tx);
    if (summary.totp + summary.passkeys <= 1) {
      throw new AppError('Add another authenticator or passkey before removing your last one.', 409, 'LAST_FACTOR');
    }
  }

  async disableTotp(userId: string, factorId: string, meta?: RequestMeta) {
    await prisma.$transaction(async tx => {
      await lockUserTokenLifecycle(tx, userId);
      const factor = await tx.adminMfaFactor.findFirst({ where: { id: factorId, userId, disabledAt: null } });
      if (!factor) throw new AppError('Authenticator not found.', 404, 'NOT_FOUND');
      if (factor.verifiedAt) await this.assertNotLastFactor(tx, userId);
      await tx.adminMfaFactor.update({ where: { id: factor.id }, data: { disabledAt: new Date() } });
      await securityEvent(SecurityEventType.ADMIN_MFA_DISABLED, userId, meta, tx);
    });
  }

  async regenerateRecoveryCodes(userId: string, meta?: RequestMeta) {
    return prisma.$transaction(async tx => {
      await lockUserTokenLifecycle(tx, userId);
      const codes = await this.replaceRecoveryCodes(tx, userId);
      await securityEvent(SecurityEventType.ADMIN_RECOVERY_CODES_REGENERATED, userId, meta, tx);
      return { codes };
    });
  }

  async passkeyRegistrationOptions(user: { id: string; email: string; firstName: string; lastName: string; passwordHash: string | null }, familyId: string) {
    const existing = await prisma.adminWebAuthnCredential.findMany({ where: { userId: user.id, revokedAt: null }, select: { credentialId: true, transports: true } });
    if (existing.length >= 10) throw new AppError('You can register up to 10 passkeys.', 409, 'PASSKEY_LIMIT');
    const { rpID, rpName } = webauthnConfig();
    const options = await generateRegistrationOptions({
      rpName, rpID, userName: user.email, userDisplayName: `${user.firstName} ${user.lastName}`.trim(),
      userID: new Uint8Array(Buffer.from(user.id.replace(/-/g, ''), 'hex')), attestationType: 'none', timeout: 120_000,
      excludeCredentials: existing.map(item => ({ id: item.credentialId, transports: item.transports as never })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    });
    await this.sessionChallenge(user.id, familyId, AdminChallengePurpose.WEBAUTHN_REGISTRATION, options.challenge, user.passwordHash);
    return { options };
  }

  async registerPasskey(userId: string, familyId: string, response: RegistrationResponseJSON, label: string, meta?: RequestMeta) {
    const challenge = await this.liveSessionChallenge(userId, familyId, AdminChallengePurpose.WEBAUTHN_REGISTRATION);
    const { rpID, origin } = webauthnConfig();
    let verification;
    try {
      verification = await verifyRegistrationResponse({ response, expectedChallenge: challenge.webauthnChallenge!, expectedOrigin: origin,
        expectedRPID: rpID, requireUserVerification: true });
    } catch (error) {
      logger.warn('ADMIN_WEBAUTHN_REGISTRATION_REJECTED', { userId, reason: error instanceof Error ? error.name : 'unknown' });
      verification = null;
    }
    if (!verification?.verified || !verification.registrationInfo) {
      await prisma.adminAuthChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
      throw new AppError('The passkey could not be verified. Try again.', 400, 'PASSKEY_INVALID');
    }
    const info = verification.registrationInfo;
    return prisma.$transaction(async tx => {
      await this.consume(tx, challenge.id);
      if (await tx.adminWebAuthnCredential.findUnique({ where: { credentialId: info.credential.id }, select: { id: true } })) {
        throw new AppError('This passkey is already registered.', 409, 'PASSKEY_EXISTS');
      }
      const created = await tx.adminWebAuthnCredential.create({ data: {
        userId, credentialId: info.credential.id, publicKey: Buffer.from(info.credential.publicKey), counter: BigInt(info.credential.counter),
        transports: info.credential.transports ?? [], deviceType: info.credentialDeviceType, backedUp: info.credentialBackedUp, label },
      select: { id: true, label: true, createdAt: true, lastUsedAt: true, deviceType: true, backedUp: true } });
      await tx.adminAccountSecurity.upsert({ where: { userId }, create: { userId, mfaEnrolledAt: new Date() }, update: {} });
      await securityEvent(SecurityEventType.ADMIN_PASSKEY_ADDED, userId, meta, tx);
      return created;
    });
  }

  async renamePasskey(userId: string, id: string, label: string) {
    const updated = await prisma.adminWebAuthnCredential.updateMany({ where: { id, userId, revokedAt: null }, data: { label } });
    if (updated.count !== 1) throw new AppError('Passkey not found.', 404, 'NOT_FOUND');
  }

  async revokePasskey(userId: string, id: string, meta?: RequestMeta) {
    await prisma.$transaction(async tx => {
      await lockUserTokenLifecycle(tx, userId);
      const credential = await tx.adminWebAuthnCredential.findFirst({ where: { id, userId, revokedAt: null }, select: { id: true } });
      if (!credential) throw new AppError('Passkey not found.', 404, 'NOT_FOUND');
      await this.assertNotLastFactor(tx, userId);
      await tx.adminWebAuthnCredential.update({ where: { id }, data: { revokedAt: new Date() } });
      await securityEvent(SecurityEventType.ADMIN_PASSKEY_REMOVED, userId, meta, tx);
    });
  }
}

export const adminMfaService = new AdminMfaService();
