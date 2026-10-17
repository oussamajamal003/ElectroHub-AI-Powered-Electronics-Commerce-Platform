import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const JWT_SECRET = env.JWT_SECRET;
const JWT_EXPIRES_IN = '15m'; // Access token is short-lived
const JWT_ALGORITHM = 'HS256' as const;
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_ROLES = new Set(['CUSTOMER', 'ADMIN']);

export interface JwtPayload {
  userId: string;
  role: string;
}

/**
 * Generate a JWT access token for a user.
 * @param payload The user payload to encode.
 * @returns The signed JWT string.
 */
export function generateAccessToken(payload: JwtPayload): string {
  if (!isJwtPayload(payload)) {
    throw new TypeError('Invalid access token claims');
  }

  return jwt.sign(payload, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: JWT_EXPIRES_IN,
  });
}

/**
 * Verify a JWT access token.
 * @param token The JWT string.
 * @returns The decoded payload if valid, otherwise throws an error.
 */
export function verifyAccessToken(token: string): JwtPayload {
  const payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
  if (!isJwtPayload(payload) || typeof payload.exp !== 'number' || typeof payload.iat !== 'number') {
    throw new jwt.JsonWebTokenError('Invalid access token claims');
  }

  return { userId: payload.userId, role: payload.role };
}

function isJwtPayload(value: unknown): value is JwtPayload & { exp?: number; iat?: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const claims = value as Record<string, unknown>;
  return (
    typeof claims.userId === 'string' &&
    USER_ID_PATTERN.test(claims.userId) &&
    typeof claims.role === 'string' &&
    VALID_ROLES.has(claims.role)
  );
}
