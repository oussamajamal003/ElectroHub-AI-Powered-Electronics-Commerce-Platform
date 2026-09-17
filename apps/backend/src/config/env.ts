import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Determine the environment based on NODE_ENV (default: development)
const nodeEnv = process.env.NODE_ENV || 'development';

// 1. Base default development configuration (non-secret defaults)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// 2. Override with local environment secrets based on NODE_ENV
if (nodeEnv === 'production') {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.production.local'), override: true });
} else {
  // Explicitly load .env.local for development (and fallback for test)
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });
}

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
