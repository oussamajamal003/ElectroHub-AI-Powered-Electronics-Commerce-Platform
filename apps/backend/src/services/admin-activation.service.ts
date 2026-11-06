import { AdminActivationStatus, AdminInvitationDelivery, Prisma, type AdminMfaActivation } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ADMIN_AUTH_TX } from '../lib/transaction-options.js';
import { AppError } from '../middleware/errorHandler.js';
import { hashPassword, verifyPassword } from '../utils/hash.js';
import { lockUserTokenLifecycle, revokeAdminSessions } from '../repositories/auth.repository.js';
import { recordAdminAudit } from './admin-audit.js';
import { randomToken, sha256Hex } from './admin-crypto.js';
import { sendAdminActivationEmail } from './admin-invitation-email.js';
import { adminMfaService } from './admin-mfa.service.js';

/**
 * Task 05.2 existing-administrator MFA activation. An Owner (with a fresh step-up) authorizes a factor-less ADMIN; the administrator proves
 * control of the delivery channel by redeeming a single-use, hashed, 30-minute link, which rotates the legacy password and revokes every
 * old session BEFORE a short first-factor enrollment window opens. No session is issued here: the caller continues through the existing
 * restricted MFA enrollment, so full ADMIN access still requires a verified second factor. Already-enrolled accounts are never eligible.
 */
export const ACTIVATION_TTL_MS = 30 * 60 * 1000;
export const ACTIVATION_ENROLLMENT_WINDOW_MS = 30 * 60 * 1000;
export const ACTIVATION_RESEND_COOLDOWN_MS = 60 * 1000;

const unavailable = () => new AppError('This activation link is invalid, expired or has already been used. Ask an owner for a new one.', 410, 'ACTIVATION_UNAVAILABLE');
const pendingExists = () => new AppError('An activation is already pending for this administrator. Resend or revoke it instead.', 409, 'ACTIVATION_PENDING');
const tokenShape = (token: unknown): token is string => typeof token === 'string' && token.length >= 20 && token.length <= 200;

interface Actor { userId: string; requestId?: string }

export function activationDto(row: AdminMfaActivation, now = new Date()) {
  const status = row.status === AdminActivationStatus.PENDING && row.expiresAt <= now ? 'EXPIRED' : row.status;
  return { id: row.id, status, deliveryStatus: row.deliveryStatus, expiresAt: row.expiresAt, lastSentAt: row.lastSentAt, sendCount: row.sendCount, createdAt: row.createdAt };
}

export class AdminActivationService {
  /** Owner capability is re-read inside the transaction, so a revocation that lands during the request denies it. */
  private async assertActiveOwner(tx: Prisma.TransactionClient, actorId: string) {
    const owner = await tx.adminAccountSecurity.findUnique({ where: { userId: actorId }, select: { isOwner: true, user: { select: { isActive: true } } } });
    if (!owner?.isOwner || !owner.user.isActive) throw new AppError('Only an owner can activate administrator accounts.', 403, 'CAPABILITY_REQUIRED');
  }

  /** The account must still be an active, factor-less ADMIN. Returns the committed account for the caller to use. */
  private async eligibleTarget(tx: Prisma.TransactionClient, targetId: string) {
    const target = await tx.user.findFirst({ where: { id: targetId, role: { name: 'ADMIN' } }, select: { id: true, email: true, isActive: true } });
    if (!target) throw new AppError('Administrator not found.', 404, 'NOT_FOUND');
    if (!target.isActive) throw new AppError('This administrator account is deactivated.', 409, 'ACCOUNT_INACTIVE');
    const factors = await adminMfaService.factorSummary(targetId, tx);
    if (factors.totp + factors.passkeys > 0) {
      throw new AppError('Two-step verification is already set up for this account. Lost factors follow the separate recovery procedure.', 409, 'ALREADY_ENROLLED');
    }
    return target;
  }

  private async deliver(activationId: string, to: string, token: string, tokenHash: string, ownerId: string, expiresAt: Date) {
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { firstName: true, lastName: true } });
    const sent = await sendAdminActivationEmail({ to, token, expiresAt, ownerName: owner ? `${owner.firstName} ${owner.lastName}`.trim() : null });
    // A slow provider completion must not overwrite the delivery status of a newer token generation.
    await prisma.adminMfaActivation.updateMany({ where: { id: activationId, tokenHash },
      data: { deliveryStatus: sent ? AdminInvitationDelivery.SENT : AdminInvitationDelivery.FAILED, lastSentAt: new Date(), sendCount: { increment: 1 } } });
    const updated = await prisma.adminMfaActivation.findUnique({ where: { id: activationId } });
    if (!updated) throw new AppError('Activation not found.', 404, 'NOT_FOUND');
    return activationDto(updated);
  }

  async request(actor: Actor, targetId: string) {
    const token = randomToken();
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + ACTIVATION_TTL_MS);
    const created = await prisma.$transaction(async tx => {
      await this.assertActiveOwner(tx, actor.userId);
      await lockUserTokenLifecycle(tx, targetId);
      const target = await this.eligibleTarget(tx, targetId);
      const pending = await tx.adminMfaActivation.findFirst({ where: { userId: targetId, status: AdminActivationStatus.PENDING } });
      if (pending && pending.expiresAt > new Date()) throw pendingExists();
      // An expired pending activation is closed (kept as history) so the one-pending-per-administrator index admits the new one.
      if (pending) await tx.adminMfaActivation.update({ where: { id: pending.id }, data: { status: AdminActivationStatus.REVOKED, revokedAt: new Date() } });
      const row = await tx.adminMfaActivation.create({ data: { userId: targetId, authorizedById: actor.userId, email: target.email, tokenHash, expiresAt, lastSentAt: new Date() } });
      await recordAdminAudit({ actorId: actor.userId, action: 'ADMIN_MFA_ACTIVATION_REQUESTED', resourceType: 'admin_user', resourceId: targetId, outcome: 'SUCCESS',
        requestId: actor.requestId }, tx);
      return { row, email: target.email };
    }, ADMIN_AUTH_TX).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw pendingExists();
      throw error;
    });
    // Provider call outside the transaction: a failed send is recorded as FAILED and can be resent; nothing privileged is granted by it.
    return this.deliver(created.row.id, created.email, token, tokenHash, actor.userId, expiresAt);
  }

  async state(targetId: string) {
    const row = await prisma.adminMfaActivation.findFirst({ where: { userId: targetId }, orderBy: { createdAt: 'desc' } });
    return row ? activationDto(row) : null;
  }

  async resend(actor: Actor, targetId: string) {
    const token = randomToken();
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + ACTIVATION_TTL_MS);
    const reserved = await prisma.$transaction(async tx => {
      await this.assertActiveOwner(tx, actor.userId);
      await lockUserTokenLifecycle(tx, targetId);
      const target = await this.eligibleTarget(tx, targetId);
      const rows = await tx.$queryRaw<{ id: string; lastSentAt: Date | null }[]>`
        SELECT "id", "lastSentAt" FROM "admin_mfa_activations" WHERE "userId" = ${targetId}::uuid AND "status" = 'PENDING' FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new AppError('No activation is pending for this administrator.', 404, 'NOT_FOUND');
      if (row.lastSentAt && Date.now() - row.lastSentAt.getTime() < ACTIVATION_RESEND_COOLDOWN_MS) {
        throw new AppError('The activation link was sent moments ago. Wait a minute before resending.', 429, 'RESEND_COOLDOWN');
      }
      // Replacing the digest invalidates the previous link atomically; the cooldown is reserved before the provider call.
      await tx.adminMfaActivation.update({ where: { id: row.id }, data: { tokenHash, expiresAt, email: target.email, authorizedById: actor.userId,
        deliveryStatus: AdminInvitationDelivery.PENDING, lastSentAt: new Date() } });
      await recordAdminAudit({ actorId: actor.userId, action: 'ADMIN_MFA_ACTIVATION_RESENT', resourceType: 'admin_user', resourceId: targetId, outcome: 'SUCCESS',
        requestId: actor.requestId }, tx);
      return { id: row.id, email: target.email };
    }, ADMIN_AUTH_TX);
    return this.deliver(reserved.id, reserved.email, token, tokenHash, actor.userId, expiresAt);
  }

  async revoke(actor: Actor, targetId: string) {
    return prisma.$transaction(async tx => {
      await this.assertActiveOwner(tx, actor.userId);
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "admin_mfa_activations" WHERE "userId" = ${targetId}::uuid AND "status" = 'PENDING' FOR UPDATE`;
      if (!rows[0]) throw new AppError('No activation is pending for this administrator.', 404, 'NOT_FOUND');
      const row = await tx.adminMfaActivation.update({ where: { id: rows[0].id }, data: { status: AdminActivationStatus.REVOKED, revokedAt: new Date() } });
      // Close a first-factor window an earlier redemption may have opened but not finished.
      await tx.adminAccountSecurity.updateMany({ where: { userId: targetId, mfaEnrolledAt: null }, data: { enrollmentAllowedUntil: null } });
      await recordAdminAudit({ actorId: actor.userId, action: 'ADMIN_MFA_ACTIVATION_REVOKED', resourceType: 'admin_user', resourceId: targetId, outcome: 'SUCCESS',
        requestId: actor.requestId }, tx);
      return activationDto(row);
    }, ADMIN_AUTH_TX);
  }

  // ── Public, token-bound ──────────────────────────────────────────────────
  async preview(token: string) {
    if (!tokenShape(token)) throw unavailable();
    const row = await prisma.adminMfaActivation.findUnique({ where: { tokenHash: sha256Hex(token) },
      include: { user: { select: { email: true, firstName: true, lastName: true, isActive: true, role: { select: { name: true } } } } } });
    if (!row || row.status !== AdminActivationStatus.PENDING || row.expiresAt <= new Date() || !row.user.isActive ||
      row.user.role.name !== 'ADMIN' || row.user.email !== row.email) throw unavailable();
    const factors = await adminMfaService.factorSummary(row.userId);
    if (factors.totp + factors.passkeys > 0) throw unavailable();
    return { email: row.user.email, firstName: row.user.firstName, lastName: row.user.lastName, expiresAt: row.expiresAt };
  }

  async redeem(input: { token: string; password: string }) {
    if (!tokenShape(input.token)) throw unavailable();
    const passwordHash = await hashPassword(input.password); // bcrypt outside the transaction
    const tokenHash = sha256Hex(input.token);
    const user = await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: string; userId: string; email: string; status: AdminActivationStatus; expiresAt: Date }[]>`
        SELECT "id", "userId", "email", "status", "expiresAt" FROM "admin_mfa_activations" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
      const row = rows[0];
      if (!row || row.status !== AdminActivationStatus.PENDING || row.expiresAt <= new Date()) throw unavailable();
      await lockUserTokenLifecycle(tx, row.userId);
      const current = await tx.user.findUnique({ where: { id: row.userId }, include: { role: true } });
      if (!current || !current.isActive || current.role.name !== 'ADMIN' || current.email !== row.email) throw unavailable();
      const factors = await adminMfaService.factorSummary(row.userId, tx);
      if (factors.totp + factors.passkeys > 0) throw unavailable();
      if (await verifyPassword(input.password, current.passwordHash)) {
        throw new AppError('Choose a password you have not used before.', 422, 'PASSWORD_REUSED');
      }
      const now = new Date();
      const rotated = await tx.user.update({ where: { id: row.userId }, data: { passwordHash }, include: { role: true } });
      await tx.refreshToken.updateMany({ where: { userId: row.userId }, data: { isRevoked: true, expiresAt: new Date(0) } });
      await revokeAdminSessions(tx, { userId: row.userId }, 'ACTIVATION_PASSWORD_ROTATED');
      // Challenges are bound to the old credential fingerprint already; closing them also stops a half-finished sign-in from lingering.
      await tx.adminAuthChallenge.updateMany({ where: { userId: row.userId, consumedAt: null }, data: { consumedAt: now } });
      await tx.adminAccountSecurity.upsert({ where: { userId: row.userId }, create: { userId: row.userId, enrollmentAllowedUntil: new Date(now.getTime() + ACTIVATION_ENROLLMENT_WINDOW_MS) },
        update: { enrollmentAllowedUntil: new Date(now.getTime() + ACTIVATION_ENROLLMENT_WINDOW_MS) } });
      await tx.adminMfaActivation.update({ where: { id: row.id }, data: { status: AdminActivationStatus.REDEEMED, redeemedAt: now } });
      await tx.securityEvent.create({ data: { userId: row.userId, type: 'PASSWORD_CHANGED' } });
      await recordAdminAudit({ actorId: row.userId, action: 'ADMIN_MFA_ACTIVATION_REDEEMED', resourceType: 'admin_user', resourceId: row.userId, outcome: 'SUCCESS' }, tx);
      return rotated;
    }, ADMIN_AUTH_TX);
    // No session: the administrator continues straight into mandatory first-factor enrollment with the restricted challenge.
    return adminMfaService.startLogin(user);
  }
}

export const adminActivationService = new AdminActivationService();
