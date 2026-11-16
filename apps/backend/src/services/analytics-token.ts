import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Task 05.2: server-issued token for one image-search result list. It names the search correlation id and the exact
 * products returned, so a later `image_search.result_selected` event is accepted only for a product that was actually shown
 * by that search. It carries no user, session, image or email value.
 */
export interface AnalyticsSelectionClaims {
  correlationId: string;
  productIds: string[];
  expiresAt: number;
}

const VERSION = 1;
export const ANALYTICS_TOKEN_TTL_MS = 30 * 60_000;
const MAX_TOKEN_LENGTH = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Derived key with its own context: a leaked analytics key never signs an access or impression token, and vice versa.
const key = () => crypto.createHmac('sha256', env.JWT_SECRET).update('electrohub:analytics-selection:v1').digest();
const sign = (payload: string) => crypto.createHmac('sha256', key()).update(payload).digest('base64url');

export function issueAnalyticsToken(input: { correlationId: string; productIds: string[] }, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({
    v: VERSION, c: input.correlationId, p: input.productIds.map(id => id.toLowerCase()), e: now + ANALYTICS_TOKEN_TTL_MS,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Returns the claims only for an authentic, unexpired token of the current version. */
export function verifyAnalyticsToken(token: unknown, now = Date.now()): AnalyticsSelectionClaims | null {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (body.v !== VERSION || typeof body.e !== 'number' || body.e < now) return null;
    if (typeof body.c !== 'string' || !UUID.test(body.c)) return null;
    if (!Array.isArray(body.p) || !body.p.every(id => typeof id === 'string' && UUID.test(id))) return null;
    return { correlationId: body.c, productIds: body.p as string[], expiresAt: body.e };
  } catch {
    return null;
  }
}
