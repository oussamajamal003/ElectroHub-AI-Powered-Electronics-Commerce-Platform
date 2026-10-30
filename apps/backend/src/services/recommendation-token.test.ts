import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { IMPRESSION_TOKEN_TTL_MS, issueImpressionToken, verifyImpressionToken } from './recommendation-token.js';

const P1 = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const P2 = '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11';
const NOW = 1_800_000_000_000;
const claims = { mode: 'SIMILAR_PRODUCTS', strategy: 'EMBEDDING_SIMILARITY', surface: 'product_detail', productIds: [P1, P2] };

const split = (token: string) => token.split('.') as [string, string];
const bodyOf = (payload: string) => JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
const encode = (body: Record<string, unknown>) => Buffer.from(JSON.stringify(body)).toString('base64url');

/** Signs a payload with the same derived impression key, so tests can forge a correctly-signed body on purpose. */
function signWithImpressionKey(payload: string) {
  const key = crypto.createHmac('sha256', env.JWT_SECRET).update('electrohub:recommendation-impression:v1').digest();
  return crypto.createHmac('sha256', key).update(payload).digest('base64url');
}

describe('recommendation impression tokens', () => {
  it('round-trips the shown products, mode and strategy with a fresh batch id and the TTL expiry', () => {
    const token = issueImpressionToken(claims, NOW);
    const verified = verifyImpressionToken(token, NOW + 1000);
    expect(verified).toEqual({ ...claims, batchId: expect.any(String), expiresAt: NOW + IMPRESSION_TOKEN_TTL_MS });
    expect(verified?.batchId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(issueImpressionToken(claims, NOW)).not.toBe(token);
  });

  it('rejects a tampered payload that keeps the original signature', () => {
    const [payload, signature] = split(issueImpressionToken(claims, NOW));
    const body = bodyOf(payload);
    expect(verifyImpressionToken(`${encode({ ...body, p: [P2, P1] })}.${signature}`, NOW)).toBeNull();
    expect(verifyImpressionToken(`${encode({ ...body, p: [P1] })}.${signature}`, NOW)).toBeNull();
    expect(verifyImpressionToken(`${encode({ ...body, m: 'POPULAR_PRODUCTS' })}.${signature}`, NOW)).toBeNull();
  });

  it('rejects a tampered or missing signature', () => {
    const [payload, signature] = split(issueImpressionToken(claims, NOW));
    const flipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
    expect(verifyImpressionToken(`${payload}.${flipped}`, NOW)).toBeNull();
    expect(verifyImpressionToken(`${payload}.`, NOW)).toBeNull();
  });

  it('rejects an extra segment', () => {
    expect(verifyImpressionToken(`${issueImpressionToken(claims, NOW)}.extra`, NOW)).toBeNull();
  });

  it('rejects an expired token, accepting it only up to the expiry instant', () => {
    const token = issueImpressionToken(claims, NOW);
    const expiresAt = NOW + IMPRESSION_TOKEN_TTL_MS;
    expect(verifyImpressionToken(token, expiresAt)).not.toBeNull();
    expect(verifyImpressionToken(token, expiresAt + 1)).toBeNull();
  });

  it('rejects oversized input, including a correctly signed token above the length cap', () => {
    expect(verifyImpressionToken('a'.repeat(4097), NOW)).toBeNull();
    const many = Array.from({ length: 200 }, (_, index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`);
    const token = issueImpressionToken({ ...claims, productIds: many }, NOW);
    expect(token.length).toBeGreaterThan(4096);
    expect(verifyImpressionToken(token, NOW)).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(verifyImpressionToken(undefined as unknown as string, NOW)).toBeNull();
    expect(verifyImpressionToken(42 as unknown as string, NOW)).toBeNull();
  });

  it('rejects a token signed with a different key', () => {
    const [payload] = split(issueImpressionToken(claims, NOW));
    const foreign = crypto.createHmac('sha256', 'not-the-impression-key').update(payload).digest('base64url');
    expect(verifyImpressionToken(`${payload}.${foreign}`, NOW)).toBeNull();
  });

  it('rejects a correctly signed token of another version, while the same body at version 1 verifies', () => {
    const body = bodyOf(split(issueImpressionToken(claims, NOW))[0]);
    const v2 = encode({ ...body, v: 2 });
    const v1 = encode(body);
    expect(verifyImpressionToken(`${v2}.${signWithImpressionKey(v2)}`, NOW)).toBeNull();
    expect(verifyImpressionToken(`${v1}.${signWithImpressionKey(v1)}`, NOW)).not.toBeNull();
  });

  it('never carries a customer or session identifier in the payload', () => {
    const body = bodyOf(split(issueImpressionToken(claims, NOW))[0]);
    expect(Object.keys(body).sort()).toEqual(['b', 'e', 'm', 'p', 's', 'st', 'v']);
    expect(JSON.stringify(body)).not.toMatch(/user|email|session|sub/i);
  });
});
