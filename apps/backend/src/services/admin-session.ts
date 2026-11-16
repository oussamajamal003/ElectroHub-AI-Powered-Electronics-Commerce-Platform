import { prisma } from '../lib/prisma.js';
import type { AdminMfaMethod } from '@prisma/client';

/**
 * Task 05.2 administrator session assurance. An ADMIN access token is honoured only while its AdminSession row is unrevoked AND its
 * refresh session family still has a live token, so every existing revocation path (logout, password change/reset, reuse detection,
 * account deletion) and every new one (session revoke, factor reset) cuts protected access immediately, not after the 15-minute
 * access-token lifetime. One indexed statement per request (admin_sessions PK + refresh_tokens familyId index).
 */
export interface ActiveAdminSession {
  familyId: string;
  mfaMethod: AdminMfaMethod;
  mfaVerifiedAt: Date;
  stepUpAt: Date | null;
  lastSeenAt: Date;
}

export async function findActiveAdminSession(familyId: string, userId: string): Promise<ActiveAdminSession | null> {
  const rows = await prisma.$queryRaw<ActiveAdminSession[]>`
    SELECT s."familyId", s."mfaMethod", s."mfaVerifiedAt", s."stepUpAt", s."lastSeenAt"
    FROM "admin_sessions" s
    WHERE s."familyId" = ${familyId}::uuid AND s."userId" = ${userId}::uuid AND s."revokedAt" IS NULL
      AND EXISTS (SELECT 1 FROM "refresh_tokens" r WHERE r."familyId" = s."familyId" AND r."userId" = s."userId"
        AND r."isRevoked" = false AND r."expiresAt" > now())`;
  return rows[0] ?? null;
}

const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000;

/** Best-effort, throttled activity stamp for the Sessions page; never fails or delays the request. */
export function touchAdminSession(session: ActiveAdminSession): void {
  if (Date.now() - session.lastSeenAt.getTime() < LAST_SEEN_RESOLUTION_MS) return;
  prisma.adminSession.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);
}

/** Recent strong proof window for sensitive operations (factor changes, invitations, session revocation of others). */
export const STEP_UP_WINDOW_MS = 10 * 60 * 1000;

export function hasRecentStepUp(session: Pick<ActiveAdminSession, 'mfaVerifiedAt' | 'stepUpAt'>, now = Date.now()): boolean {
  const latest = Math.max(session.mfaVerifiedAt.getTime(), session.stepUpAt?.getTime() ?? 0);
  return now - latest <= STEP_UP_WINDOW_MS;
}
