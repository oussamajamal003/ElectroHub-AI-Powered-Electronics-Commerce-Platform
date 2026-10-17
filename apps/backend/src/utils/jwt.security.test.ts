import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { generateAccessToken, JWT_SECRET, verifyAccessToken } from './jwt.js';

const userId = '11111111-1111-4111-8111-111111111111';

describe('JWT security', () => {
  it('signs and verifies a valid access token using HS256', () => {
    const token = generateAccessToken({ userId, role: 'CUSTOMER' });
    expect(jwt.decode(token, { complete: true })?.header.alg).toBe('HS256');
    expect(verifyAccessToken(token)).toEqual({ userId, role: 'CUSTOMER' });
  });

  it('rejects a token signed with a different secret', () => {
    const token = jwt.sign({ userId, role: 'CUSTOMER' }, 'a-different-signing-secret-that-is-not-configured');
    expect(() => verifyAccessToken(token)).toThrow();
  });

  it('rejects an expired access token', () => {
    const token = jwt.sign({ userId, role: 'CUSTOMER' }, JWT_SECRET, { expiresIn: -1 });
    expect(() => verifyAccessToken(token)).toThrow(/expired/i);
  });

  it('rejects an unsupported signing algorithm', () => {
    const token = jwt.sign({ userId, role: 'CUSTOMER' }, JWT_SECRET, { algorithm: 'HS384' });
    expect(() => verifyAccessToken(token)).toThrow();
  });

  it('rejects an unsigned token (alg: none)', () => {
    const token = jwt.sign({ userId, role: 'CUSTOMER' }, '', { algorithm: 'none' });
    expect(() => verifyAccessToken(token)).toThrow();
  });

  it.each([
    ['missing userId', { role: 'CUSTOMER' }],
    ['invalid userId', { userId: 42, role: 'CUSTOMER' }],
    ['invalid role', { userId, role: 'OWNER' }],
  ])('rejects %s claims', (_case, claims) => {
    const token = jwt.sign(claims, JWT_SECRET);
    expect(() => verifyAccessToken(token)).toThrow(/claims/i);
  });

  it('rejects signing malformed claims', () => {
    expect(() => generateAccessToken({ userId: 'not-a-uuid', role: 'CUSTOMER' })).toThrow(/claims/i);
    expect(() => generateAccessToken({ userId, role: 'OWNER' })).toThrow(/claims/i);
  });
});
