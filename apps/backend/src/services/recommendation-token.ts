import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Task 04.4: server-issued impression token for one rendered recommendation batch. It names the batch, the exact
 * products and their ranks, and carries no customer or session identifier, so attribution events can be validated
 * (a forged product, rank or batch is rejected) without linking them to a person.
 */
export interface ImpressionClaims {
  batchId: string;
  mode: string;
  strategy: string;
  surface: string;
  productIds: string[];
  expiresAt: number;
}

const VERSION = 1;
export const IMPRESSION_TOKEN_TTL_MS = 60 * 60_000;
const MAX_TOKEN_LENGTH = 4096;

// Derived (not reused) key: a leaked impression key never signs an access token, and vice versa.
const key = () => crypto.createHmac('sha256', env.JWT_SECRET).update('electrohub:recommendation-impression:v1').digest();
const sign = (payload: string) => crypto.createHmac('sha256', key()).update(payload).digest('base64url');

export function issueImpressionToken(claims: Omit<ImpressionClaims, 'batchId' | 'expiresAt'>, now = Date.now()) {
  const full: ImpressionClaims = { ...claims, batchId: crypto.randomUUID(), expiresAt: now + IMPRESSION_TOKEN_TTL_MS };
  const payload = Buffer.from(JSON.stringify({
    v: VERSION, b: full.batchId, m: full.mode, st: full.strategy, s: full.surface, p: full.productIds, e: full.expiresAt,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Returns the claims only for an authentic, unexpired token of the current version. */
export function verifyImpressionToken(token: string, now = Date.now()): ImpressionClaims | null {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (body.v !== VERSION || typeof body.e !== 'number' || body.e < now) return null;
    if (typeof body.b !== 'string' || typeof body.m !== 'string' || typeof body.st !== 'string' || typeof body.s !== 'string') return null;
    if (!Array.isArray(body.p) || !body.p.every(id => typeof id === 'string')) return null;
    return { batchId: body.b, mode: body.m, strategy: body.st, surface: body.s, productIds: body.p as string[], expiresAt: body.e };
  } catch {
    return null;
  }
}
