import jwt from 'jsonwebtoken';
import type { ExtendedError, Socket } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { findActiveAdminSession } from '../services/admin-session.js';

/**
 * Task 04.7 handshake authentication (architecture §8.2). The same checks as requireAuth: a valid access JWT, then a live lookup that the
 * account is still active, with the role read from the database rather than the token. There are no cookies on the socket, so no CSRF surface.
 */
export type SocketIdentity = { userId: string; role: string; expiresAt: number; sessionId?: string };
export type UserLookup = (userId: string) => Promise<{ role: string } | null>;

export const lookupActiveUser: UserLookup = async userId => {
  const user = await prisma.user.findFirst({ where: { id: userId, isActive: true }, select: { role: { select: { name: true } } } });
  return user ? { role: user.role.name } : null;
};

/** Error codes reach the client as `connect_error.data.code`; messages are generic. */
export function socketError(code: 'UNAUTHENTICATED' | 'TOO_MANY_CONNECTIONS' | 'UNAVAILABLE'): ExtendedError {
  const error = new Error(code === 'TOO_MANY_CONNECTIONS' ? 'Too many live connections.' : code === 'UNAVAILABLE' ? 'Live updates are unavailable.' : 'Authentication required.') as ExtendedError;
  error.data = { code };
  return error;
}

/** Task 05.2: an ADMIN handshake needs the same live MFA-assured session family as requireAuth. */
export type AdminSessionCheck = (familyId: string, userId: string) => Promise<boolean>;
export const liveAdminSession: AdminSessionCheck = async (familyId, userId) => Boolean(await findActiveAdminSession(familyId, userId));

export async function authenticateHandshake(token: unknown, lookup: UserLookup = lookupActiveUser,
  adminSession: AdminSessionCheck = liveAdminSession): Promise<SocketIdentity | null> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return null;
  let userId: string;
  let sessionId: string | undefined;
  try { ({ userId, sessionId } = verifyAccessToken(token)); } catch { return null; }
  // verifyAccessToken already proved exp is a number; decode only reads it back.
  const exp = (jwt.decode(token) as { exp: number }).exp;
  const user = await lookup(userId);
  if (!user) return null;
  if (user.role === 'ADMIN' && !(sessionId && await adminSession(sessionId, userId))) return null;
  return { userId, role: user.role, expiresAt: exp * 1000, ...(sessionId ? { sessionId } : {}) };
}

export function socketAuthMiddleware(lookup: UserLookup = lookupActiveUser, adminSession: AdminSessionCheck = liveAdminSession) {
  return (socket: Socket, next: (error?: ExtendedError) => void) => {
    authenticateHandshake((socket.handshake.auth as Record<string, unknown> | undefined)?.token, lookup, adminSession)
      .then(identity => {
        if (!identity) return next(socketError('UNAUTHENTICATED'));
        socket.data.identity = identity;
        next();
      })
      .catch(() => next(socketError('UNAVAILABLE')));
  };
}
