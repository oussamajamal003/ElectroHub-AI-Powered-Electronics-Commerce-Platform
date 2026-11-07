import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { ANALYTICS_TOKEN_TTL_MS, issueAnalyticsToken, verifyAnalyticsToken } from './analytics-token.js';

const CORRELATION = '6d1b8f0e-2c3a-4e5f-8a9b-0c1d2e3f4a5b';
const P1 = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const P2 = '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11';
const NOW = 1_800_000_000_000;

const split = (token: string) => token.split('.') as [string, string];
const encode = (body: Record<string, unknown>) => Buffer.from(JSON.stringify(body)).toString('base64url');
/** Signs a forged body with the same derived key, so tests can prove that a correct signature alone is not enough. */
function forge(body: Record<string, unknown>) {
  const key = crypto.createHmac('sha256', env.JWT_SECRET).update('electrohub:analytics-selection:v1').digest();
  const payload = encode(body);
  return `${payload}.${crypto.createHmac('sha256', key).update(payload).digest('base64url')}`;
}

describe('analytics selection tokens', () => {
  it('round-trips the correlation id and shown products with a 30 minute expiry', () => {
    const token = issueAnalyticsToken({ correlationId: CORRELATION, productIds: [P1, P2.toUpperCase()] }, NOW);
    expect(verifyAnalyticsToken(token, NOW + 1000)).toEqual({
      correlationId: CORRELATION, productIds: [P1, P2], expiresAt: NOW + ANALYTICS_TOKEN_TTL_MS,
    });
    expect(ANALYTICS_TOKEN_TTL_MS).toBe(30 * 60_000);
  });

  it('rejects an expired token', () => {
    const token = issueAnalyticsToken({ correlationId: CORRELATION, productIds: [P1] }, NOW);
    expect(verifyAnalyticsToken(token, NOW + ANALYTICS_TOKEN_TTL_MS + 1)).toBeNull();
  });

  it('rejects a tampered payload that keeps the original signature', () => {
    const [, signature] = split(issueAnalyticsToken({ correlationId: CORRELATION, productIds: [P1] }, NOW));
    const forged = encode({ v: 1, c: CORRELATION, p: [P2], e: NOW + 60_000 });
    expect(verifyAnalyticsToken(`${forged}.${signature}`, NOW)).toBeNull();
  });

  it('rejects a token signed with the recommendation or access key (domain separation)', () => {
    const body = { v: 1, c: CORRELATION, p: [P1], e: NOW + 60_000 };
    const other = crypto.createHmac('sha256', crypto.createHmac('sha256', env.JWT_SECRET).update('electrohub:recommendation-impression:v1').digest())
      .update(encode(body)).digest('base64url');
    expect(verifyAnalyticsToken(`${encode(body)}.${other}`, NOW)).toBeNull();
  });

  it('rejects malformed, oversized, wrong-version and non-uuid claims even when correctly signed', () => {
    expect(verifyAnalyticsToken(undefined, NOW)).toBeNull();
    expect(verifyAnalyticsToken(42, NOW)).toBeNull();
    expect(verifyAnalyticsToken('a'.repeat(5000), NOW)).toBeNull();
    expect(verifyAnalyticsToken('no-dot', NOW)).toBeNull();
    expect(verifyAnalyticsToken(`${encode({ v: 1, c: CORRELATION, p: [P1], e: NOW + 1 })}.x.y`, NOW)).toBeNull();
    expect(verifyAnalyticsToken(forge({ v: 2, c: CORRELATION, p: [P1], e: NOW + 60_000 }), NOW)).toBeNull();
    expect(verifyAnalyticsToken(forge({ v: 1, c: 'not-a-uuid', p: [P1], e: NOW + 60_000 }), NOW)).toBeNull();
    expect(verifyAnalyticsToken(forge({ v: 1, c: CORRELATION, p: ['x'], e: NOW + 60_000 }), NOW)).toBeNull();
    expect(verifyAnalyticsToken(forge({ v: 1, c: CORRELATION, p: [P1], e: 'soon' }), NOW)).toBeNull();
  });
});
