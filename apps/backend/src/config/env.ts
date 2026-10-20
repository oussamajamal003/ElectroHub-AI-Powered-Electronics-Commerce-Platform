import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

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

const selectedEnvFiles =
  envFilesByEnvironment[nodeEnv as keyof typeof envFilesByEnvironment] ??
  envFilesByEnvironment.development;

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
  AI_SERVICE_URL: z.string().url().optional(),
  FRONTEND_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  BREVO_API_KEY: z.string().optional(),
  BREVO_SENDER_EMAIL: z.string().email().optional(),
  BREVO_SENDER_NAME: z.string().optional().default('ElectroHub'),
  CLOUDINARY_URL: z.string().optional(),
  OTP_HASH_SECRET: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production') {
    if (!data.BREVO_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'BREVO_API_KEY is required in production',
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
    if (!data.OTP_HASH_SECRET || data.OTP_HASH_SECRET.length < 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A secure OTP_HASH_SECRET of at least 16 characters is required in production',
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
