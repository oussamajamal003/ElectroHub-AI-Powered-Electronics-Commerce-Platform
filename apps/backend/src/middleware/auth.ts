import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JwtPayload } from '../utils/jwt.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../lib/prisma.js';
import { findActiveAdminSession, touchAdminSession, type ActiveAdminSession } from '../services/admin-session.js';

// Extend Express Request type to include user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
      /** Set by requireAuth for ADMIN accounts only: the verified, unrevoked MFA session this request runs under. */
      adminSession?: ActiveAdminSession;
    }
  }
}

/**
 * Middleware to require a valid JWT access token.
 */
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  let payload: JwtPayload;
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('AUTH_UNAUTHORIZED', { reason: 'Missing or malformed Authorization header' });
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      logger.warn('AUTH_UNAUTHORIZED', { reason: 'Missing token' });
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    payload = verifyAccessToken(token);
  } catch {
    logger.warn('AUTH_UNAUTHORIZED', { reason: 'Invalid or expired token' });
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  try {
    const user = await prisma.user.findFirst({
      where: { id: payload.userId, isActive: true },
      select: { id: true, role: { select: { name: true } } },
    });
    if (!user) {
      logger.warn('AUTH_UNAUTHORIZED', { reason: 'Account is unavailable' });
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }
    // Task 05.2: an ADMIN identity is honoured only through a live MFA-assured session family. A token without the session
    // claim (pre-MFA legacy token, or a CUSTOMER token whose account was promoted) never reaches any route as ADMIN.
    if (user.role.name === 'ADMIN') {
      const session = payload.sessionId ? await findActiveAdminSession(payload.sessionId, user.id) : null;
      if (!session) {
        logger.warn('AUTH_UNAUTHORIZED', { reason: 'Administrator session is not MFA-assured or was revoked', userId: user.id });
        res.status(401).json({ error: { code: 'ADMIN_SESSION_INVALID', message: 'Your administrator session has ended. Sign in again.' } });
        return;
      }
      req.adminSession = session;
      touchAdminSession(session);
    }
    req.user = { ...payload, role: user.role.name };
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to require a specific role.
 * Must be used AFTER requireAuth.
 */
export const requireRole = (requiredRole: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      logger.warn('AUTH_UNAUTHORIZED', { reason: 'Not authenticated in requireRole' });
      return res.status(401).json({ error: 'Unauthenticated' });
    }

    if (req.user.role !== requiredRole) {
      logger.warn('AUTH_FORBIDDEN', { 
        userId: req.user.userId, 
        role: req.user.role, 
        requiredRole 
      });
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }

    next();
  };
};
