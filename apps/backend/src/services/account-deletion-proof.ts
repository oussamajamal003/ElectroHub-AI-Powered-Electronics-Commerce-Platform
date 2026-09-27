import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { JWT_SECRET } from '../utils/jwt.js';

const proofSchema = z.object({
  userId: z.string().uuid(),
  purpose: z.literal('ACCOUNT_DELETION'),
  expiresAt: z.number().int(),
  nonce: z.string().min(32),
});

function secret() {
  if (env.NODE_ENV === 'production' && (!env.JWT_SECRET || env.JWT_SECRET.length < 16)) {
    throw new AppError('Account deletion is currently unavailable.', 503, 'ACCOUNT_DELETION_UNAVAILABLE');
  }
  return JWT_SECRET;
}

export function createAccountDeletionProof(userId: string) {
  const payload = Buffer.from(JSON.stringify({
    userId,
    purpose: 'ACCOUNT_DELETION',
    expiresAt: Date.now() + 5 * 60 * 1000,
    nonce: crypto.randomBytes(24).toString('base64url'),
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyAccountDeletionProof(value: unknown, userId: string) {
  try {
    if (typeof value !== 'string' || value.length > 2048) throw new Error();
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra) throw new Error();
    const expected = crypto.createHmac('sha256', secret()).update(payload).digest();
    const received = Buffer.from(signature, 'base64url');
    if (received.length !== expected.length || !crypto.timingSafeEqual(expected, received)) throw new Error();
    const proof = proofSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    if (proof.userId !== userId || proof.expiresAt <= Date.now()) throw new Error();
    return proof;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Please verify your identity again before deleting your account.', 403, 'ACCOUNT_REAUTH_REQUIRED');
  }
}
