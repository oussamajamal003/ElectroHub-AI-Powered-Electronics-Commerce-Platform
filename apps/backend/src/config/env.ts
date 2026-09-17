import { z } from 'zod';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Determine the environment file to load based on NODE_ENV (default: development)
const nodeEnv = process.env.NODE_ENV || 'development';
const envFile = nodeEnv === 'production' ? '.env.production.local' : '.env.local';

const envPath = path.resolve(process.cwd(), envFile);
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Fallback to the default .env (dotenv won't override variables already loaded)
dotenv.config();
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
  DATABASE_URL: z.string().optional(),
  DIRECT_URL: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  JWT_REFRESH_SECRET: z.string().optional(),
  AI_SERVICE_URL: z.string().url().optional(),
  FRONTEND_URL: z.string().url().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  BREVO_API_KEY: z.string().optional(),
  CLOUDINARY_URL: z.string().optional(),
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
