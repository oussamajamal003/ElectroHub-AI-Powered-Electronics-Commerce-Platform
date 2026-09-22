import jwt from 'jsonwebtoken';

// Use environment variables for secrets in production
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key_change_me_in_prod';
const JWT_EXPIRES_IN = '15m'; // Access token is short-lived

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
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

/**
 * Verify a JWT access token.
 * @param token The JWT string.
 * @returns The decoded payload if valid, otherwise throws an error.
 */
export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
