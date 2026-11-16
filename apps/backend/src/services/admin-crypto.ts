import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Task 05.2 administrator MFA cryptography. Only node:crypto primitives are used (AES-256-GCM, HMAC-SHA1/SHA256, CSPRNG); TOTP follows
 * RFC 6238 / RFC 4226 and is checked against the RFC test vectors. Every failure to obtain key material fails closed with 503.
 */

const keyUnavailable = () => new AppError('Two-step verification is temporarily unavailable.', 503, 'MFA_UNAVAILABLE');

interface KeyRing { active: number; keys: Map<number, Buffer> }

export function parseKeyRing(raw: string | undefined, activeVersion: number | undefined): KeyRing | null {
  if (!raw) return null;
  const keys = new Map<number, Buffer>();
  for (const entry of raw.split(',')) {
    const match = /^\s*(\d{1,4}):([A-Za-z0-9+/=_-]+)\s*$/.exec(entry);
    if (!match) return null;
    const key = Buffer.from(match[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (key.length !== 32) return null;
    keys.set(Number(match[1]), key);
  }
  const active = activeVersion ?? Math.max(...keys.keys());
  return keys.has(active) ? { active, keys } : null;
}

function keyRing(): KeyRing {
  const ring = parseKeyRing(env.ADMIN_MFA_ENCRYPTION_KEYS, env.ADMIN_MFA_ACTIVE_KEY_VERSION);
  if (!ring) throw keyUnavailable();
  return ring;
}

/** AES-256-GCM, output base64url(iv[12] | tag[16] | ciphertext). Additional data binds the ciphertext to its owner and purpose. */
export function encryptSecret(plain: Buffer, aad: string): { ciphertext: string; keyVersion: number } {
  const ring = keyRing();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ring.keys.get(ring.active)!, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url'), keyVersion: ring.active };
}

export function decryptSecret(ciphertext: string, keyVersion: number, aad: string): Buffer {
  const key = keyRing().keys.get(keyVersion);
  if (!key) throw keyUnavailable();
  const raw = Buffer.from(ciphertext, 'base64url');
  if (raw.length < 29) throw keyUnavailable();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(raw.subarray(12, 28));
  try {
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  } catch {
    throw keyUnavailable();
  }
}

/** Keyed digest for recovery codes: an offline copy of the table cannot be brute-forced without the MFA key. */
export function keyedDigest(value: string): string {
  const ring = keyRing();
  return crypto.createHmac('sha256', ring.keys.get(ring.active)!).update(`electrohub-admin-recovery:${value}`).digest('hex');
}

/** Existing recovery batches remain usable while their signing key is retained during rotation. */
export function recoveryCodeDigests(value: string): string[] {
  return [...keyRing().keys.values()].map(key =>
    crypto.createHmac('sha256', key).update(`electrohub-admin-recovery:${value}`).digest('hex'));
}

export const sha256Hex = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// ── Base32 (RFC 4648, no padding) ──────────────────────────────────────────
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Buffer): string {
  let bits = 0; let value = 0; let output = '';
  for (const byte of data) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0; let value = 0; const bytes: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new TypeError('Invalid base32');
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

// ── TOTP (RFC 6238: SHA-1, 30 s, 6 digits) ─────────────────────────────────
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accepted clock drift: one step either side (±30 s). Wider windows weaken the code without a recovery benefit. */
export const TOTP_DRIFT_STEPS = 1;

export function hotp(secret: Buffer, counter: bigint, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const hmac = crypto.createHmac('sha1', secret).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export const totpStep = (nowMs: number) => BigInt(Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS));

/** Returns the matched time step (for the replay guard) or null. Every candidate is compared in constant time. */
export function verifyTotp(secret: Buffer, code: string, nowMs = Date.now()): bigint | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(nowMs);
  let matched: bigint | null = null;
  for (let delta = -TOTP_DRIFT_STEPS; delta <= TOTP_DRIFT_STEPS; delta++) {
    const step = current + BigInt(delta);
    if (step >= 0n && constantTimeEqual(hotp(secret, step), code) && matched === null) matched = step;
  }
  return matched;
}

export function otpauthUri(secretBase32: string, accountEmail: string, issuer = 'ElectroHub Admin'): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

/** Recovery code: 12 base32 characters (60 bits) shown as XXXX-XXXX-XXXX. */
export function generateRecoveryCode(): string {
  const raw = base32Encode(crypto.randomBytes(8)).slice(0, 12);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}
export const normalizeRecoveryCode = (code: string) => code.replace(/[\s-]/g, '').toUpperCase();
