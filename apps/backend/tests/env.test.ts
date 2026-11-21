import { describe, expect, it } from 'vitest';
import { envDiagnostics, isPublicProductionOrigin, selectEnvFiles, validateEnvironment } from '../src/config/env.js';

describe('Environment loading', () => {
  it('loads the isolated test environment file under NODE_ENV=test', () => {
    expect(envDiagnostics.selectedEnvFiles).toEqual(['.env', '.env.test.local']);
    expect(envDiagnostics.loadedEnvFiles).toContain('.env.test.local');
    expect(envDiagnostics.selectedEnvFiles).not.toContain('.env.local');
    expect(envDiagnostics.loadedEnvFiles).not.toContain('.env.local');
  });

  it('loads no env file at all for a hermetic stack (ELECTROHUB_ENV_FILES=none) and only that exact value opts out', () => {
    expect(selectEnvFiles('test', 'none')).toEqual([]);
    expect(selectEnvFiles('development', 'none')).toEqual([]);
    expect(selectEnvFiles('test', undefined)).toEqual(['.env', '.env.test.local']);
    expect(selectEnvFiles('test', 'NONE')).toEqual(['.env', '.env.test.local']);
    expect(selectEnvFiles('production', '')).toEqual(['.env', '.env.production.local']);
    expect(selectEnvFiles('unknown', undefined)).toEqual(['.env', '.env.local']);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['short', 'short-test-secret'],
    ['known development fallback', 'dev_secret_key_change_me_in_prod'],
    ['placeholder', 'REPLACE_WITH_A_UNIQUE_RANDOM_VALUE_OF_AT_LEAST_32_CHARACTERS'],
    ['low diversity', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  ])('rejects a %s JWT signing secret', (_label, secret) => {
    const source = validEnvironment();
    if (secret === undefined) delete source.JWT_SECRET;
    else source.JWT_SECRET = secret;

    expect(() => validateEnvironment(source)).toThrow(/JWT_SECRET/);
  });

  it('accepts a strong configured JWT signing secret', () => {
    const validated = validateEnvironment(validEnvironment());
    expect(validated.JWT_SECRET).toBe(validEnvironment().JWT_SECRET);
  });

  it('accepts only canonical public HTTPS origins for production browser links', () => {
    expect(isPublicProductionOrigin('https://electrohub-store.ondigitalocean.app')).toBe(true);
    expect(isPublicProductionOrigin('https://203.0.113.8')).toBe(false);
    expect(isPublicProductionOrigin('https://8.8.8.8')).toBe(true);
    expect(isPublicProductionOrigin('https://[2001:4860:4860::8888]')).toBe(true);
    for (const origin of [
      undefined,
      'http://electrohub-store.ondigitalocean.app',
      'https://localhost',
      'https://127.0.0.1',
      'https://10.0.0.8',
      'https://172.20.0.3',
      'https://192.168.1.20',
      'https://[::1]',
      'https://[fc00::1]',
      'https://[fe80::1]',
      'https://[2001:db8::1]',
      'https://shop-dev.electrohub.com',
      'https://shop.electrohub.test',
      'https://shop.ondigitalocean.app/path',
      'https://shop.ondigitalocean.app/',
      'https://user@shop.ondigitalocean.app',
      'https://shop.ondigitalocean.app?preview=1',
    ]) expect(isPublicProductionOrigin(origin)).toBe(false);
  });

  it('requires production frontend and email URLs to use public HTTPS origins', () => {
    const source = validProductionEnvironment();
    expect(validateEnvironment(source).FRONTEND_URL).toBe(source.FRONTEND_URL);

    for (const origin of ['http://localhost:3000', 'https://localhost', 'https://192.168.1.7', 'https://shop-dev.example.com']) {
      expect(() => validateEnvironment({ ...source, FRONTEND_URL: origin })).toThrow(/FRONTEND_URL/);
    }
    expect(() => validateEnvironment({ ...source, FRONTEND_URL: undefined })).toThrow(/FRONTEND_URL/);
    expect(() => validateEnvironment({ ...source, COMMERCE_EMAIL_ORIGIN: 'https://localhost' })).toThrow(/COMMERCE_EMAIL_ORIGIN/);
    expect(() => validateEnvironment({ ...source, COMMERCE_EMAIL_ORIGIN: 'https://electrohub-mail.ondigitalocean.app' })).not.toThrow();
  });

  it('keeps production Google OAuth callback on the configured same origin and verified path', () => {
    const source = validProductionEnvironment();
    source.GOOGLE_CLIENT_ID = 'client-id';
    source.GOOGLE_CLIENT_SECRET = 'server-only-secret';
    source.GOOGLE_REDIRECT_URI = `${source.FRONTEND_URL}/api/auth/google/callback`;
    expect(() => validateEnvironment(source)).not.toThrow();
    expect(() => validateEnvironment({ ...source, GOOGLE_REDIRECT_URI: 'https://api.example.net/api/auth/google/callback' })).toThrow(/GOOGLE_REDIRECT_URI/);
    expect(() => validateEnvironment({ ...source, GOOGLE_REDIRECT_URI: `${source.FRONTEND_URL}/other` })).toThrow(/GOOGLE_REDIRECT_URI/);
    expect(() => validateEnvironment({ ...source, GOOGLE_CLIENT_SECRET: undefined })).toThrow(/GOOGLE_REDIRECT_URI/);
  });

  it('rejects live Stripe secret keys in production configuration', () => {
    const source = validProductionEnvironment();
    expect(() => validateEnvironment({ ...source, STRIPE_SECRET_KEY: 'sk_live_never-allowed' })).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => validateEnvironment({ ...source, STRIPE_SECRET_KEY: 'sk_test_sampleonly' })).not.toThrow();
  });

  it.each([
    ['example placeholder', 'REPLACE_WITH_UNIQUE_RANDOM_VALUE'],
    ['empty', ''],
    ['short', 'short-otp-key'],
    ['repeated', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    ['predictable sequence', '0123456789abcdefghijklmnopqrstuvwxyz'],
    ['same as JWT signing key', validEnvironment().JWT_SECRET!],
  ])('rejects a %s OTP HMAC secret in production', (_label, secret) => {
    const source = validProductionEnvironment();
    source.OTP_HASH_SECRET = secret;
    expect(() => validateEnvironment(source)).toThrow(/OTP_HASH_SECRET/);
  });

  it('accepts a strong disposable OTP HMAC fixture and does not echo rejected values', () => {
    const source = validProductionEnvironment();
    source.OTP_HASH_SECRET = 'R7m$4Qx!9Vn#2Pk@6Dz^1Hb&8Lf+3Cs5Wn9P';
    expect(() => validateEnvironment(source)).not.toThrow();

    const rejected = 'REPLACE_WITH_UNIQUE_RANDOM_VALUE';
    try {
      validateEnvironment({ ...source, OTP_HASH_SECRET: rejected });
      throw new Error('expected OTP secret validation to fail');
    } catch (error) {
      expect(String(error)).not.toContain(rejected);
      expect(String(error)).toContain('OTP_HASH_SECRET');
    }
  });

  it('requires the production OTP HMAC key to differ from the refresh-token signing key', () => {
    const source = validProductionEnvironment();
    source.JWT_REFRESH_SECRET = source.OTP_HASH_SECRET;
    expect(() => validateEnvironment(source)).toThrow(/OTP_HASH_SECRET/);
  });

  it('rejects unresolved mandatory Brevo placeholders without printing the value', () => {
    const placeholder = 'REPLACE_WITH_SERVER_SIDE_SECRET';
    try {
      validateEnvironment({ ...validProductionEnvironment(), BREVO_API_KEY: placeholder });
      throw new Error('expected Brevo placeholder validation to fail');
    } catch (error) {
      expect(String(error)).not.toContain(placeholder);
      expect(String(error)).toContain('BREVO_API_KEY');
    }
  });
});

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/electrohub',
    DIRECT_URL: 'postgresql://test:test@localhost:5432/electrohub',
    JWT_SECRET: 'c8f3e4a7d19b2605c8f3e4a7d19b2605c8f3e4a7d19b2605c8f3e4a7d19b2605',
  };
}

function validProductionEnvironment(): NodeJS.ProcessEnv {
  return {
    ...validEnvironment(),
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://runtime:placeholder@prod-db.invalid:5432/electrohub?sslmode=require',
    DIRECT_URL: 'postgresql://migration:placeholder@prod-db.invalid:5432/electrohub?sslmode=require',
    FRONTEND_URL: 'https://electrohub-store.ondigitalocean.app',
    COMMERCE_EMAIL_ORIGIN: 'https://electrohub-store.ondigitalocean.app',
    BREVO_API_KEY: 'xkeysib-7F2mQ4!vK9pL3zA6R1nX8cD5+G0h',
    BREVO_SENDER_EMAIL: 'sender@example.invalid',
    OTP_HASH_SECRET: 'R7m$4Qx!9Vn#2Pk@6Dz^1Hb&8Lf+3Cs5Wn9P',
  };
}
