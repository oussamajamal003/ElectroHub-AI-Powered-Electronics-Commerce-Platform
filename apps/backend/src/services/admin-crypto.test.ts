import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  base32Decode, base32Encode, decryptSecret, encryptSecret, generateRecoveryCode, hotp, keyedDigest, normalizeRecoveryCode, parseKeyRing,
  recoveryCodeDigests, totpStep, verifyTotp,
} from './admin-crypto.js';

const KEY_1 = crypto.randomBytes(32).toString('base64');
const KEY_2 = crypto.randomBytes(32).toString('base64');
const env = vi.hoisted(() => ({ ADMIN_MFA_ENCRYPTION_KEYS: undefined as string | undefined, ADMIN_MFA_ACTIVE_KEY_VERSION: undefined as number | undefined }));
vi.mock('../config/env.js', () => ({ env }));



describe('Task 05.2 administrator MFA cryptography', () => {
  // RFC 6238 Appendix B (SHA-1 seed "12345678901234567890"); the 8-digit reference values truncated to the 6 digits we use.
  const seed = Buffer.from('12345678901234567890', 'ascii');
  it.each([
    [59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130'],
  ])('matches the RFC 6238 vector at T=%i', (seconds, expected) => {
    expect(hotp(seed, totpStep(seconds * 1000))).toBe(expected);
    expect(verifyTotp(seed, expected, seconds * 1000)).toBe(totpStep(seconds * 1000));
  });

  it('accepts exactly one step of clock drift either side and nothing wider', () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    expect(verifyTotp(seed, hotp(seed, step - 1n), now)).toBe(step - 1n);
    expect(verifyTotp(seed, hotp(seed, step + 1n), now)).toBe(step + 1n);
    expect(verifyTotp(seed, hotp(seed, step - 2n), now)).toBeNull();
    expect(verifyTotp(seed, hotp(seed, step + 2n), now)).toBeNull();
    expect(verifyTotp(seed, '12345', now)).toBeNull();
    expect(verifyTotp(seed, 'abcdef', now)).toBeNull();
  });

  it('round-trips base32 (RFC 4648 vectors, unpadded)', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    const random = crypto.randomBytes(20);
    expect(base32Decode(base32Encode(random)).equals(random)).toBe(true);
  });

  it('parses only well-formed 32-byte key rings and selects the active version', () => {
    expect(parseKeyRing(undefined, undefined)).toBeNull();
    expect(parseKeyRing(`1:${Buffer.alloc(16).toString('base64')}`, undefined)).toBeNull();
    expect(parseKeyRing(`1:${KEY_1},2:${KEY_2}`, undefined)?.active).toBe(2);
    expect(parseKeyRing(`1:${KEY_1},2:${KEY_2}`, 1)?.active).toBe(1);
    expect(parseKeyRing(`1:${KEY_1}`, 3)).toBeNull();
  });

  it('fails closed (503) when no key ring is configured', () => {
    env.ADMIN_MFA_ENCRYPTION_KEYS = undefined;
    expect(() => encryptSecret(Buffer.from('x'), 'aad')).toThrow(expect.objectContaining({ statusCode: 503, code: 'MFA_UNAVAILABLE' }));
    expect(() => keyedDigest('code')).toThrow(expect.objectContaining({ code: 'MFA_UNAVAILABLE' }));
  });

  it('encrypts with AES-256-GCM bound to its owner, decrypts after rotation, and rejects tampering or a foreign binding', () => {
    env.ADMIN_MFA_ENCRYPTION_KEYS = `1:${KEY_1}`;
    const secret = crypto.randomBytes(20);
    const sealed = encryptSecret(secret, 'admin-totp:user-a:factor-1');
    expect(sealed.keyVersion).toBe(1);
    expect(sealed.ciphertext).not.toContain(secret.toString('base64url'));
    // Key rotation: version 2 becomes active, version 1 ciphertext stays readable.
    env.ADMIN_MFA_ENCRYPTION_KEYS = `1:${KEY_1},2:${KEY_2}`;
    expect(decryptSecret(sealed.ciphertext, 1, 'admin-totp:user-a:factor-1').equals(secret)).toBe(true);
    expect(encryptSecret(secret, 'x').keyVersion).toBe(2);
    expect(() => decryptSecret(sealed.ciphertext, 1, 'admin-totp:user-b:factor-1')).toThrow(expect.objectContaining({ code: 'MFA_UNAVAILABLE' }));
    const tampered = Buffer.from(sealed.ciphertext, 'base64url'); tampered[tampered.length - 1] ^= 1;
    expect(() => decryptSecret(tampered.toString('base64url'), 1, 'admin-totp:user-a:factor-1')).toThrow();
    // Removing a key version makes its ciphertext unreadable (fail closed, never plaintext fallback).
    env.ADMIN_MFA_ENCRYPTION_KEYS = `2:${KEY_2}`;
    expect(() => decryptSecret(sealed.ciphertext, 1, 'admin-totp:user-a:factor-1')).toThrow(expect.objectContaining({ code: 'MFA_UNAVAILABLE' }));
  });

  it('generates high-entropy recovery codes and digests them with the MFA key', () => {
    env.ADMIN_MFA_ENCRYPTION_KEYS = `1:${KEY_1}`;
    const codes = new Set(Array.from({ length: 200 }, generateRecoveryCode));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    const [code] = [...codes];
    expect(normalizeRecoveryCode(code.toLowerCase())).toBe(code.replace(/-/g, ''));
    expect(keyedDigest('ABCD')).toMatch(/^[a-f0-9]{64}$/);
    expect(keyedDigest('ABCD')).not.toBe(crypto.createHash('sha256').update('ABCD').digest('hex'));
    env.ADMIN_MFA_ENCRYPTION_KEYS = `1:${KEY_2}`;
    expect(keyedDigest('ABCD')).not.toBe((() => { env.ADMIN_MFA_ENCRYPTION_KEYS = `1:${KEY_1}`; return keyedDigest('ABCD'); })());
  });

  it('verifies an existing recovery digest after rotating the active key, until its key is retired', () => {
    env.ADMIN_MFA_ENCRYPTION_KEYS = `1:${KEY_1}`;
    env.ADMIN_MFA_ACTIVE_KEY_VERSION = 1;
    const code = normalizeRecoveryCode(generateRecoveryCode());
    const digest = keyedDigest(code);
    env.ADMIN_MFA_ENCRYPTION_KEYS = `1:${KEY_1},2:${KEY_2}`;
    env.ADMIN_MFA_ACTIVE_KEY_VERSION = 2;
    expect(keyedDigest(code)).not.toBe(digest);
    expect(recoveryCodeDigests(code)).toContain(digest);
    expect(recoveryCodeDigests(normalizeRecoveryCode(generateRecoveryCode()))).not.toContain(digest);
    env.ADMIN_MFA_ENCRYPTION_KEYS = `2:${KEY_2}`;
    expect(recoveryCodeDigests(code)).not.toContain(digest);
    env.ADMIN_MFA_ACTIVE_KEY_VERSION = undefined;
  });
});
