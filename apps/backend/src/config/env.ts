import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Determine the environment based on NODE_ENV (default: development)
const nodeEnv = process.env.NODE_ENV || 'development';
const backendRoot = path.resolve(__dirname, '../..');

const envFilesByEnvironment = {
  development: ['.env', '.env.local'],
  test: ['.env', '.env.test.local'],
  production: ['.env', '.env.production.local'],
} as const;

const selectedEnvFiles =
  envFilesByEnvironment[nodeEnv as keyof typeof envFilesByEnvironment] ??
  envFilesByEnvironment.development;

const loadedEnvFiles = selectedEnvFiles.filter((fileName, index) => {
  const result = dotenv.config({
    path: path.resolve(backendRoot, fileName),
    override: index > 0,
  });

  return !result.error;
});

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
  JWT_SECRET: z.string().optional(),
  JWT_REFRESH_SECRET: z.string().optional(),
  AI_SERVICE_URL: z.string().url().optional(),
  FRONTEND_URL: z.string().url().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
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

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error(
      'Invalid environment configuration:',
      parsed.error.flatten().fieldErrors
    );
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
