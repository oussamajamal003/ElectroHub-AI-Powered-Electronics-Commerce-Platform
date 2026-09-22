import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JwtPayload } from '../utils/jwt.js';
import { logger } from '../utils/logger.js';

// Extend Express Request type to include user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Middleware to require a valid JWT access token.
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('AUTH_UNAUTHORIZED', { reason: 'Missing or malformed Authorization header' });
      return res.status(401).json({ error: 'Unauthenticated' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      logger.warn('AUTH_UNAUTHORIZED', { reason: 'Missing token' });
      return res.status(401).json({ error: 'Unauthenticated' });
    }

    const payload = verifyAccessToken(token);
    req.user = payload;
    
    next();
  } catch {
    logger.warn('AUTH_UNAUTHORIZED', { reason: 'Invalid or expired token' });
    return res.status(401).json({ error: 'Invalid or expired token' });
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
