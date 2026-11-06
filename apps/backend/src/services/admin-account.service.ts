import { AdminInvitationStatus, SecurityEventType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ADMIN_AUTH_TX } from '../lib/transaction-options.js';
import { AppError } from '../middleware/errorHandler.js';
import { lockUserTokenLifecycle, revokeAdminSessions } from '../repositories/auth.repository.js';
import { DeliveryPublisher } from '../sockets/delivery.publisher.js';
import { verifyPassword } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { recordAdminAudit } from './admin-audit.js';
import { adminMfaService, type RequestMeta } from './admin-mfa.service.js';
import { STEP_UP_WINDOW_MS } from './admin-session.js';

const OWNER_LIFECYCLE_LOCK = 'admin_owner_lifecycle';
export const LAST_OWNER_MESSAGE = 'You are the last active Owner. Assign another trusted administrator as Owner before deleting your account.';

async function authService() {
  // Imported lazily, like AdminMfaService does: AuthService depends on the MFA service, so a static import here risks a cycle.
  const { AuthService } = await import('./auth.service.js');
  return new AuthService();
}

const invalidPassword = () => new AppError('Your current password is incorrect.', 400, 'INVALID_CURRENT_PASSWORD');
const inactiveAccount = () => new AppError('This administrator account is no longer active.', 409, 'ACCOUNT_INACTIVE');

/**
 * Task 05.2 administrator self-service: profile, session families and sanitized login history. Every method is scoped to the calling
 * administrator; no method accepts another user's id.
 */

/** Coarse, privacy-preserving device label derived from the stored User-Agent (no fingerprinting, no version noise). */
export function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /OPR\//.test(userAgent) ? 'Opera' : /Firefox\//.test(userAgent) ? 'Firefox'
    : /Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : 'Browser';
  const os = /Windows/.test(userAgent) ? 'Windows' : /iPhone|iPad/.test(userAgent) ? 'iOS' : /Mac OS X/.test(userAgent) ? 'macOS'
    : /Android/.test(userAgent) ? 'Android' : /Linux/.test(userAgent) ? 'Linux' : 'Unknown OS';
  return `${browser} on ${os}`;
}

const HISTORY_TYPES: SecurityEventType[] = ['LOGIN_SUCCESS', 'LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'ADMIN_MFA_CHALLENGE_FAILED',
  'ADMIN_MFA_ENROLLED', 'ADMIN_MFA_DISABLED', 'ADMIN_RECOVERY_CODES_REGENERATED', 'ADMIN_RECOVERY_CODE_USED', 'ADMIN_PASSKEY_ADDED',
  'ADMIN_PASSKEY_REMOVED', 'ADMIN_SESSION_REVOKED', 'ADMIN_STEP_UP_VERIFIED'];
export const LOGIN_HISTORY_RETENTION_DAYS = 90;
/** Stable, UI-facing event names (the raw enum stays internal). */
const HISTORY_EVENT: Partial<Record<SecurityEventType, string>> = {
  LOGIN_SUCCESS: 'LOGIN', LOGOUT: 'LOGOUT', PASSWORD_CHANGED: 'PASSWORD_CHANGED', PASSWORD_RESET: 'PASSWORD_RESET', ADMIN_MFA_CHALLENGE_FAILED: 'MFA_FAILED',
  ADMIN_MFA_ENROLLED: 'FACTOR_ADDED', ADMIN_MFA_DISABLED: 'FACTOR_REMOVED', ADMIN_RECOVERY_CODES_REGENERATED: 'RECOVERY_CODES_REGENERATED',
  ADMIN_RECOVERY_CODE_USED: 'RECOVERY_CODE_USED', ADMIN_PASSKEY_ADDED: 'PASSKEY_ADDED', ADMIN_PASSKEY_REMOVED: 'PASSKEY_REMOVED',
  ADMIN_SESSION_REVOKED: 'SESSION_REVOKED', ADMIN_STEP_UP_VERIFIED: 'STEP_UP',
};

export class AdminAccountService {
  async profile(userId: string, session: { mfaVerifiedAt: Date; stepUpAt: Date | null }) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, firstName: true, lastName: true, createdAt: true,
      adminSecurity: { select: { isOwner: true, canManageAdmins: true, mfaEnrolledAt: true } } } });
    if (!user) throw new AppError('Account not found.', 404, 'NOT_FOUND');
    const [factors, otherActiveOwners] = await Promise.all([
      adminMfaService.factorSummary(userId),
      user.adminSecurity?.isOwner
        ? prisma.adminAccountSecurity.count({ where: { isOwner: true, userId: { not: userId }, user: { isActive: true } } })
        : Promise.resolve(0),
    ]);
    const lastActiveOwner = Boolean(user.adminSecurity?.isOwner) && otherActiveOwners === 0;
    const latest = Math.max(session.mfaVerifiedAt.getTime(), session.stepUpAt?.getTime() ?? 0);
    return {
      id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: 'ADMIN' as const, createdAt: user.createdAt,
      // Administrator accounts are created verified (invitation possession or seeded); the flag keeps the UI contract explicit.
      emailVerified: true,
      isOwner: user.adminSecurity?.isOwner ?? false, canManageAdmins: (user.adminSecurity?.isOwner || user.adminSecurity?.canManageAdmins) ?? false,
      capabilities: { isOwner: user.adminSecurity?.isOwner ?? false, canManageAdmins: (user.adminSecurity?.isOwner || user.adminSecurity?.canManageAdmins) ?? false },
      mfa: { totp: factors.totp, passkeys: factors.passkeys, recoveryCodesRemaining: factors.recoveryCodes, enrolledAt: user.adminSecurity?.mfaEnrolledAt ?? null },
      stepUpUntil: new Date(latest + STEP_UP_WINDOW_MS) > new Date() ? new Date(latest + STEP_UP_WINDOW_MS) : null,
      // Advisory only: the deletion transaction re-checks under the owner lock. Lets the UI explain the block before any attempt.
      deletion: { allowed: !lastActiveOwner, reason: lastActiveOwner ? 'LAST_OWNER' as const : null },
    };
  }

  async updateProfile(userId: string, input: { firstName: string; lastName: string }) {
    await prisma.user.update({ where: { id: userId }, data: { firstName: input.firstName.trim(), lastName: input.lastName.trim() } });
  }

  async sessions(userId: string, currentFamilyId: string) {
    const rows = await prisma.$queryRaw<{ familyId: string; mfaMethod: string; createdAt: Date; lastSeenAt: Date; userAgent: string | null; ipAddress: string | null }[]>`
      SELECT s."familyId", s."mfaMethod", s."createdAt", s."lastSeenAt", s."userAgent", s."ipAddress"
      FROM "admin_sessions" s
      WHERE s."userId" = ${userId}::uuid AND s."revokedAt" IS NULL
        AND EXISTS (SELECT 1 FROM "refresh_tokens" r WHERE r."familyId" = s."familyId" AND r."userId" = s."userId" AND r."isRevoked" = false AND r."expiresAt" > now())
      ORDER BY (s."familyId" = ${currentFamilyId}::uuid) DESC, s."lastSeenAt" DESC
      LIMIT 50`;
    const data = rows.map(row => ({ id: row.familyId, current: row.familyId === currentFamilyId, mfaMethod: row.mfaMethod, createdAt: row.createdAt,
      lastActiveAt: row.lastSeenAt, device: deviceLabel(row.userAgent), ipMasked: row.ipAddress }));
    return { data, meta: { page: 1, pageSize: 50, total: data.length, totalPages: 1 } };
  }

  /** Revokes the family's refresh tokens AND its AdminSession in one locked transaction: access and refresh end together. */
  async revokeSession(userId: string, familyId: string, reason: 'REVOKED_BY_USER' | 'SIGNED_OUT_OTHERS', meta?: RequestMeta) {
    const revoked = await prisma.$transaction(async tx => {
      await lockUserTokenLifecycle(tx, userId);
      const session = await tx.adminSession.findFirst({ where: { familyId, userId, revokedAt: null }, select: { familyId: true } });
      if (!session) return false;
      await tx.refreshToken.updateMany({ where: { userId, familyId }, data: { isRevoked: true, expiresAt: new Date(0) } });
      await revokeAdminSessions(tx, { userId, familyId }, reason);
      await tx.securityEvent.create({ data: { userId, type: SecurityEventType.ADMIN_SESSION_REVOKED, ipAddress: meta?.ipAddress ?? null, userAgent: meta?.userAgent?.slice(0, 1000) ?? null } });
      return true;
    }, ADMIN_AUTH_TX);
    if (!revoked) throw new AppError('Session not found or already ended.', 404, 'NOT_FOUND');
    // Match revoke-others/logout: existing sockets must lose their order subscriptions at commit too.
    // Other valid sessions can reconnect with their own tokens.
    DeliveryPublisher.disconnectUser(userId, 'LOGOUT');
  }

  async revokeOtherSessions(userId: string, currentFamilyId: string, meta?: RequestMeta) {
    const count = await prisma.$transaction(async tx => {
      await lockUserTokenLifecycle(tx, userId);
      const others = await tx.adminSession.findMany({ where: { userId, revokedAt: null, familyId: { not: currentFamilyId } }, select: { familyId: true } });
      const ids = others.map(row => row.familyId);
      if (ids.length === 0) return 0;
      await tx.refreshToken.updateMany({ where: { userId, familyId: { in: ids } }, data: { isRevoked: true, expiresAt: new Date(0) } });
      await tx.adminSession.updateMany({ where: { userId, familyId: { in: ids }, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'SIGNED_OUT_OTHERS' } });
      await tx.securityEvent.create({ data: { userId, type: SecurityEventType.ADMIN_SESSION_REVOKED, ipAddress: meta?.ipAddress ?? null, userAgent: meta?.userAgent?.slice(0, 1000) ?? null } });
      return ids.length;
    }, ADMIN_AUTH_TX);
    // Live delivery sockets carry no session family (Task 04.7): drop them all; this session's client reconnects with its token.
    if (count > 0) DeliveryPublisher.disconnectUser(userId, 'LOGOUT');
    return { revoked: count };
  }

  /**
   * Administrator password change. The route already demands a recent MFA step-up; this reuses the shared AuthService change (bcrypt
   * verification, hashing, every refresh family and AdminSession revoked in one locked transaction, PASSWORD_CHANGED security event and
   * notification email), then records the administrative audit entry and drops live sockets. The caller must sign in again.
   */
  async changePassword(userId: string, input: { currentPassword: string; newPassword: string }, requestId?: string) {
    if (input.currentPassword === input.newPassword) {
      throw new AppError('Choose a new password that is different from your current one.', 400, 'PASSWORD_UNCHANGED');
    }
    try {
      await (await authService()).changePassword(userId, input.currentPassword, input.newPassword);
    } catch (error) {
      if (error instanceof Error && error.message === 'Incorrect current password') throw invalidPassword();
      if (error instanceof Error && error.message === 'User not found or inactive') throw inactiveAccount();
      throw error;
    }
    try {
      await recordAdminAudit({ actorId: userId, action: 'ADMIN_PASSWORD_CHANGED', resourceType: 'admin_user', resourceId: userId, outcome: 'SUCCESS', requestId });
    } catch (error) {
      // The change has committed and every session is revoked; a missing audit row must not report the change as failed.
      logger.error('ADMIN_AUDIT_WRITE_FAILED', { action: 'ADMIN_PASSWORD_CHANGED', userId, errorName: error instanceof Error ? error.name : 'unknown' });
    }
    DeliveryPublisher.disconnectUser(userId, 'LOGOUT');
  }

  /**
   * Self-service administrator deletion. Not a row delete: orders, inventory, delivery and audit records keep their foreign keys, so the
   * account is anonymized and permanently disabled in one transaction under the user's token-lifecycle lock and, for an Owner, the shared
   * owner lock, re-checking that another active Owner remains. Credentials, MFA factors, recovery codes, passkeys, open challenges,
   * refresh families and admin sessions are removed or revoked; invitations this administrator sent that are still pending are revoked.
   * Security events and admin audit rows are kept for accountability. Live sockets are dropped only after commit.
   */
  async deleteSelf(userId: string, currentPassword: string, meta?: RequestMeta, requestId?: string) {
    const account = await prisma.user.findFirst({ where: { id: userId, isActive: true, role: { name: 'ADMIN' } }, select: { passwordHash: true } });
    if (!account) throw inactiveAccount();
    if (!await verifyPassword(currentPassword, account.passwordHash)) throw invalidPassword(); // bcrypt stays outside the transaction
    const now = new Date();
    await prisma.$transaction(async tx => {
      await lockUserTokenLifecycle(tx, userId);
      const current = await tx.user.findFirst({ where: { id: userId, role: { name: 'ADMIN' } },
        select: { isActive: true, passwordHash: true, adminSecurity: { select: { isOwner: true } } } });
      if (!current?.isActive) throw inactiveAccount();
      // The password verified above must still be the stored one: a concurrent password change wins.
      if (current.passwordHash !== account.passwordHash) throw new AppError('Your account changed while confirming. Sign in again.', 409, 'ACCOUNT_CHANGED');
      if (current.adminSecurity?.isOwner) {
        // Same shared lock as owner deactivation, so two owners leaving at once cannot both see "another owner remains".
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${OWNER_LIFECYCLE_LOCK}), 0)`;
        const others = await tx.adminAccountSecurity.count({ where: { isOwner: true, userId: { not: userId }, user: { isActive: true } } });
        if (others === 0) throw new AppError(LAST_OWNER_MESSAGE, 409, 'LAST_OWNER');
      }
      await tx.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true, expiresAt: new Date(0) } });
      await revokeAdminSessions(tx, { userId }, 'ACCOUNT_DELETED');
      await tx.adminAuthChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
      await tx.adminMfaFactor.deleteMany({ where: { userId } });
      await tx.adminRecoveryCode.deleteMany({ where: { userId } });
      await tx.adminWebAuthnCredential.deleteMany({ where: { userId } });
      await tx.otpChallenge.deleteMany({ where: { userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.oAuthAccount.deleteMany({ where: { userId } });
      const revokedInvitations = await tx.adminInvitation.updateMany({ where: { invitedById: userId, status: AdminInvitationStatus.PENDING },
        data: { status: AdminInvitationStatus.REVOKED, revokedAt: now } });
      // Capabilities end with the account; nothing is transferred to anyone else.
      await tx.adminAccountSecurity.updateMany({ where: { userId },
        data: { isOwner: false, canManageAdmins: false, enrollmentAllowedUntil: null, mfaEnrolledAt: null } });
      await tx.user.update({ where: { id: userId }, data: {
        email: `deleted-admin-${userId}@deleted.invalid`, pendingEmail: null, passwordHash: null,
        firstName: 'Deleted', lastName: 'Administrator', isActive: false, emailVerifiedAt: null,
      } });
      await tx.securityEvent.create({ data: { userId, type: SecurityEventType.ACCOUNT_DELETED,
        ipAddress: meta?.ipAddress ?? null, userAgent: meta?.userAgent?.slice(0, 1000) ?? null } });
      await recordAdminAudit({ actorId: userId, action: 'ADMIN_ACCOUNT_DELETED', resourceType: 'admin_user', resourceId: userId, outcome: 'SUCCESS',
        details: { wasOwner: Boolean(current.adminSecurity?.isOwner), revokedInvitations: revokedInvitations.count }, requestId }, tx);
    }, ADMIN_AUTH_TX);
    DeliveryPublisher.disconnectUser(userId, 'ACCOUNT_DELETED');
  }

  async loginHistory(userId: string, page: number, pageSize: number) {
    const since = new Date(Date.now() - LOGIN_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const where = { userId, type: { in: HISTORY_TYPES }, createdAt: { gte: since } };
    const [total, rows] = await Promise.all([
      prisma.securityEvent.count({ where }),
      prisma.securityEvent.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, type: true, createdAt: true, ipAddress: true, userAgent: true } }),
    ]);
    return {
      data: rows.map(row => ({ id: row.id, event: HISTORY_EVENT[row.type] ?? 'ACCOUNT_ACTIVITY',
        outcome: row.type === 'ADMIN_MFA_CHALLENGE_FAILED' || row.type === 'LOGIN_FAILED' ? 'FAILURE' : 'SUCCESS',
        occurredAt: row.createdAt, ipMasked: row.ipAddress, device: row.userAgent ? deviceLabel(row.userAgent) : null })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), retentionDays: LOGIN_HISTORY_RETENTION_DAYS },
    };
  }
}

export const adminAccountService = new AdminAccountService();
