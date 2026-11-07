import type { NextFunction, Request, Response } from 'express';
import { requireAuth, requireRole } from './auth.js';
import { prisma } from '../lib/prisma.js';
import { hasRecentStepUp } from '../services/admin-session.js';
import { logger } from '../utils/logger.js';

/**
 * Task 05.2 shared guard chain for every new /api/admin/** router: a valid access token, the DB-backed ADMIN role, a live MFA-assured
 * session (enforced inside requireAuth for every ADMIN identity) and a private, never-cached response.
 */
export const privateNoStore = (_req: Request, res: Response, next: NextFunction) => { res.set('Cache-Control', 'private, no-store'); next(); };
export const adminGuard = [requireAuth, requireRole('ADMIN'), privateNoStore];

/** Sensitive mutations: the session must have completed MFA or a step-up within STEP_UP_WINDOW_MS. */
export function requireStepUp(req: Request, res: Response, next: NextFunction) {
  if (!req.adminSession) {
    res.status(401).json({ error: { code: 'ADMIN_SESSION_INVALID', message: 'Your administrator session has ended. Sign in again.' } });
    return;
  }
  if (!hasRecentStepUp(req.adminSession)) {
    res.status(403).json({ error: { code: 'STEP_UP_REQUIRED', message: 'Confirm it is you to continue.' } });
    return;
  }
  next();
}

export type AdminCapability = 'MANAGE_ADMINS' | 'OWNER';

/** Durable capability read from admin_account_security on every request; the ADMIN role alone is not sufficient. */
export function requireAdminCapability(capability: AdminCapability) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const security = await prisma.adminAccountSecurity.findUnique({ where: { userId: req.user!.userId }, select: { isOwner: true, canManageAdmins: true } });
      const allowed = capability === 'OWNER' ? security?.isOwner === true : security?.isOwner === true || security?.canManageAdmins === true;
      if (!allowed) {
        logger.warn('ADMIN_CAPABILITY_DENIED', { userId: req.user!.userId, capability });
        res.status(403).json({ error: { code: 'CAPABILITY_REQUIRED', message: 'Your administrator account cannot perform this action.' } });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
