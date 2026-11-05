import { SecurityEventType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { lockUserTokenLifecycle, revokeAdminSessions } from '../repositories/auth.repository.js';
import { DeliveryPublisher } from '../sockets/delivery.publisher.js';
import { adminMfaService, type RequestMeta } from './admin-mfa.service.js';
import { STEP_UP_WINDOW_MS } from './admin-session.js';

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
    const factors = await adminMfaService.factorSummary(userId);
    const latest = Math.max(session.mfaVerifiedAt.getTime(), session.stepUpAt?.getTime() ?? 0);
    return {
      id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: 'ADMIN' as const, createdAt: user.createdAt,
      // Administrator accounts are created verified (invitation possession or seeded); the flag keeps the UI contract explicit.
      emailVerified: true,
      isOwner: user.adminSecurity?.isOwner ?? false, canManageAdmins: (user.adminSecurity?.isOwner || user.adminSecurity?.canManageAdmins) ?? false,
      capabilities: { isOwner: user.adminSecurity?.isOwner ?? false, canManageAdmins: (user.adminSecurity?.isOwner || user.adminSecurity?.canManageAdmins) ?? false },
      mfa: { totp: factors.totp, passkeys: factors.passkeys, recoveryCodesRemaining: factors.recoveryCodes, enrolledAt: user.adminSecurity?.mfaEnrolledAt ?? null },
      stepUpUntil: new Date(latest + STEP_UP_WINDOW_MS) > new Date() ? new Date(latest + STEP_UP_WINDOW_MS) : null,
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
    });
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
    });
    // Live delivery sockets carry no session family (Task 04.7): drop them all; this session's client reconnects with its token.
    if (count > 0) DeliveryPublisher.disconnectUser(userId, 'LOGOUT');
    return { revoked: count };
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
