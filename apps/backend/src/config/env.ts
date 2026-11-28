import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import { isIP } from 'node:net';

// Determine the environment based on NODE_ENV (default: development)
const nodeEnv = process.env.NODE_ENV || 'development';
const processPort = process.env.PORT;
const processFrontendUrl = process.env.FRONTEND_URL;
const processStripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const backendRoot = path.resolve(__dirname, '../..');

const envFilesByEnvironment = {
  development: ['.env', '.env.local'],
  test: ['.env', '.env.test.local'],
  production: ['.env', '.env.production.local'],
} as const;

/**
 * Env files for an environment. `ELECTROHUB_ENV_FILES=none` (Task 06.1) loads no file at all, so a hermetic test stack (the release
 * E2E suite) is configured only by the environment its launcher passes and can never inherit a developer's shared DEV database URL,
 * provider keys or storage credentials from `.env`. It can only remove configuration sources, never add one.
 */
export function selectEnvFiles(environmentName: string, filesMode: string | undefined): readonly string[] {
  if (filesMode === 'none') return [];
  return envFilesByEnvironment[environmentName as keyof typeof envFilesByEnvironment] ?? envFilesByEnvironment.development;
}

const selectedEnvFiles = selectEnvFiles(nodeEnv, process.env.ELECTROHUB_ENV_FILES);

const fileEnvironment: Record<string, string> = {};
const loadedEnvFiles = selectedEnvFiles.filter((fileName, index) => {
  const result = dotenv.config({
    path: path.resolve(backendRoot, fileName),
    override: index > 0,
    processEnv: fileEnvironment,
  });

  return !result.error;
});

for (const [name, value] of Object.entries(fileEnvironment)) {
  if (process.env[name] === undefined) process.env[name] = value;
}

process.env.NODE_ENV = nodeEnv;
if (processPort) process.env.PORT = processPort;
if (processFrontendUrl) process.env.FRONTEND_URL = processFrontendUrl;
// The local CLI listener/hosted runtime supplies its own signing secret in memory.
if (processStripeWebhookSecret) process.env.STRIPE_WEBHOOK_SECRET = processStripeWebhookSecret;

export const envDiagnostics = {
  nodeEnv,
  selectedEnvFiles,
  loadedEnvFiles,
} as const;

/**
 * Environment variable schema.
 * Validates required configuration at startup.
 * Fails safely when required variables are missing.
 */
/** True only for a loopback PostgreSQL host (a disposable/local cluster), never for Supabase or any remote database. */
export function isLoopbackDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

const blockedProductionHostSuffixes = ['.localhost', '.local', '.internal', '.lan', '.test', '.invalid', '.example'];
const blockedProductionHostLabels = new Set(['dev', 'development', 'staging', 'preview', 'qa', 'test']);
const unresolvedSecretPattern = /(?:replace[-_ ]?with|change[-_ ]?me|your[-_ ]|placeholder|sample|example|dummy|default|password|server[-_ ]side[-_ ]secret)/i;

/** Production OTP HMAC key contract: at least 256 bits of input, no templates/sequences, and meaningful character diversity. */
function isStrongProductionOtpSecret(secret: string | undefined): boolean {
  if (!secret || secret !== secret.trim() || Buffer.byteLength(secret, 'utf8') < 32) return false;
  if (unresolvedSecretPattern.test(secret) || /^(.)\1+$/.test(secret) || /(.{8,})\1+$/.test(secret)) return false;
  if (/(?:0123456789|9876543210|abcdefghijklmnopqrstuvwxyz|qwertyuiop|asdfghjkl)/i.test(secret)) return false;
  return new Set(secret).size >= 12;
}

function ipv4IsPublic(host: string): boolean {
  const [a, b, c] = host.split('.').map(Number);
  if ([a, b, c].some(value => !Number.isInteger(value))) return false;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b! >= 64 && b! <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b! >= 16 && b! <= 31) return false;
  if (a === 192 && (b === 0 && (c === 0 || c === 2) || b === 88 && c === 99 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function ipv6IsPublic(host: string): boolean {
  if (host.includes('%') || host.includes('.')) return false;
  const halves = host.toLowerCase().split('::');
  if (halves.length > 2) return false;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return false;
  const groups = [...left, ...Array(missing).fill('0'), ...right].map(value => Number.parseInt(value, 16));
  if (groups.length !== 8 || groups.some(value => !Number.isInteger(value) || value < 0 || value > 0xffff)) return false;
  const first = groups[0]!;
  // Public IPv6 unicast is in 2000::/3. Exclude documentation, protocol-assignment and 6to4 ranges.
  if (first < 0x2000 || first > 0x3fff || first === 0x2002) return false;
  if (first === 0x2001 && (groups[1] === 0x0db8 || groups[1]! <= 0x01ff)) return false;
  return true;
}

/** Syntactically screens production browser origins; DNS ownership and resolved-address reachability require deployment preflight. */
export function isPublicProductionOrigin(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.port !== '' && url.port !== '443') || value !== url.origin) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host.endsWith('.') || host === 'localhost' || blockedProductionHostSuffixes.some(suffix => host.endsWith(suffix))) return false;
    const ipVersion = isIP(host);
    if (ipVersion === 4 && !ipv4IsPublic(host)) return false;
    if (ipVersion === 6 && !ipv6IsPublic(host)) return false;
    if (!ipVersion) {
      const labels = host.split('.');
      if (labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) ||
        blockedProductionHostLabels.has(label) || /(^|[-_])(dev|development|staging|preview|qa|test)([-_]|$)/.test(label))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().default(5000),
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
  DB_SSL_CA_CERT_PATH: z.string().optional(),
  DB_RUNTIME_URL_SOURCE: z.enum(['database', 'direct']).optional(),
  E2E_OTP_OUTBOX_DIR: z.string().optional(),
  E2E_TEST_SUPPORT_TOKEN: z.string().optional(),
  JWT_SECRET: z.string().min(32).refine((secret) => {
    const normalizedSecret = secret.trim().toLowerCase();
    const rejectedValues = new Set([
      'dev_secret_key_change_me_in_prod',
      'your-jwt-secret-here',
      'your-jwt-refresh-secret-here',
      'test-jwt-secret',
      'test-secret',
      'changeme',
      'change-me',
      'placeholder',
    ]);

    return (
      secret === secret.trim() &&
      !rejectedValues.has(normalizedSecret) &&
      !/(your-|change[-_ ]?me|placeholder|replace[-_ ]?(me|with)|example|password)/i.test(secret) &&
      new Set(secret).size >= 8
    );
  }, 'JWT_SECRET must be a unique, non-placeholder value of at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().optional(),
  // AI_SERVICE_* settings are validated by src/integrations/ai/ai.config.ts so an AI misconfiguration can never block commerce startup.
  FRONTEND_URL: z.string().url().optional(),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  COMMERCE_EMAIL_ORIGIN: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  BREVO_API_KEY: z.string().optional(),
  BREVO_SENDER_EMAIL: z.string().email().optional(),
  BREVO_SENDER_NAME: z.string().optional().default('ElectroHub'),
  OTP_HASH_SECRET: z.string().optional(),
  // Task 05.2 administrator MFA. Key ring "1:<base64 32 bytes>[,2:<...>]"; missing/invalid keys fail closed at use, never at boot,
  // so customer traffic is unaffected while administrator MFA refuses to operate.
  ADMIN_MFA_ENCRYPTION_KEYS: z.string().optional(),
  // Operator-issued seed-administrator provisioning redemption (shared DEV / disposable only). Never mounted in production.
  ADMIN_SEED_PROVISIONING_ENABLED: z.enum(['true', 'false']).optional(),
  ADMIN_MFA_ACTIVE_KEY_VERSION: z.coerce.number().int().positive().optional(),
  WEBAUTHN_RP_ID: z.string().optional(),
  WEBAUTHN_RP_NAME: z.string().optional(),
  WEBAUTHN_ORIGIN: z.string().url().optional(),
}).superRefine((data, ctx) => {
  // The local email outbox captures mail instead of sending it. It is allowed only for automated tests or a development server on
  // a loopback (disposable) database, so a misconfigured shared DEV or production server can never silently divert real email.
  if (data.E2E_OTP_OUTBOX_DIR && data.NODE_ENV !== 'test' && !(data.NODE_ENV === 'development' && isLoopbackDatabaseUrl(data.DATABASE_URL))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['E2E_OTP_OUTBOX_DIR'],
      message: 'E2E_OTP_OUTBOX_DIR is allowed only in test, or in development against a loopback database' });
  }
  if (data.ADMIN_SEED_PROVISIONING_ENABLED === 'true' && data.NODE_ENV === 'production') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ADMIN_SEED_PROVISIONING_ENABLED'],
      message: 'Seed administrator provisioning cannot be enabled in production' });
  }
  if (data.NODE_ENV === 'production') {
    if (!isPublicProductionOrigin(data.FRONTEND_URL)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['FRONTEND_URL'],
        message: 'FRONTEND_URL must be one canonical public HTTPS origin in production' });
    }
    if (data.COMMERCE_EMAIL_ORIGIN && !isPublicProductionOrigin(data.COMMERCE_EMAIL_ORIGIN)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['COMMERCE_EMAIL_ORIGIN'],
        message: 'COMMERCE_EMAIL_ORIGIN must be one canonical public HTTPS origin in production' });
    }
    const googleConfigured = Boolean(data.GOOGLE_CLIENT_ID || data.GOOGLE_CLIENT_SECRET || data.GOOGLE_REDIRECT_URI);
    if (googleConfigured && !(data.GOOGLE_CLIENT_ID && data.GOOGLE_CLIENT_SECRET && data.GOOGLE_REDIRECT_URI)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['GOOGLE_REDIRECT_URI'],
        message: 'Google OAuth production settings must be configured together' });
    }
    if (googleConfigured && data.GOOGLE_REDIRECT_URI) {
      const callback = new URL(data.GOOGLE_REDIRECT_URI);
      if (!isPublicProductionOrigin(callback.origin) || callback.pathname !== '/api/auth/google/callback' || callback.search || callback.hash) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['GOOGLE_REDIRECT_URI'],
          message: 'GOOGLE_REDIRECT_URI must be a canonical public HTTPS origin plus the exact /api/auth/google/callback path' });
      }
    }
    if (data.CORS_ALLOWED_ORIGINS) {
      for (const origin of data.CORS_ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)) {
        if (!isPublicProductionOrigin(origin)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CORS_ALLOWED_ORIGINS'],
            message: 'CORS_ALLOWED_ORIGINS entries must be canonical public HTTPS origins' });
        }
      }
    }
    if (data.STRIPE_SECRET_KEY && !/^(?:sk|rk)_test_[A-Za-z0-9]+$/.test(data.STRIPE_SECRET_KEY)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['STRIPE_SECRET_KEY'],
        message: 'Production Stripe credentials must be Stripe Test Mode keys' });
    }
    if (data.STRIPE_WEBHOOK_SECRET && !/^whsec_[A-Za-z0-9]+$/.test(data.STRIPE_WEBHOOK_SECRET)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['STRIPE_WEBHOOK_SECRET'],
        message: 'STRIPE_WEBHOOK_SECRET must be a configured hosted webhook signing secret' });
    }
    if (!data.BREVO_API_KEY || unresolvedSecretPattern.test(data.BREVO_API_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'BREVO_API_KEY must be configured and must not contain an unresolved placeholder',
        path: ['BREVO_API_KEY'],
      });
    }
    if (!data.BREVO_SENDER_EMAIL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'BREVO_SENDER_EMAIL is required in production',
        path: ['BREVO_SENDER_EMAIL'],
      });
    }
    if (!isStrongProductionOtpSecret(data.OTP_HASH_SECRET) || data.OTP_HASH_SECRET === data.JWT_SECRET ||
      data.OTP_HASH_SECRET === data.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'OTP_HASH_SECRET must be a unique, non-placeholder random key with at least 32 UTF-8 bytes and must differ from JWT signing secrets',
        path: ['OTP_HASH_SECRET'],
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

export function validateEnvironment(source: NodeJS.ProcessEnv): Env {
  return envSchema.parse(source);
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // Throw a safe diagnostic so bootstrap can persist and flush startup evidence.
    throw new Error(`Invalid environment configuration (${Object.keys(parsed.error.flatten().fieldErrors).join(', ')})`);
  }

  return parsed.data;
}

export const env = loadEnv();
