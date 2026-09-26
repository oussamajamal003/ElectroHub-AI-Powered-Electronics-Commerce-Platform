import { PrismaClient } from '@prisma/client';

/**
 * Prisma Client singleton.
 *
 * Ensures a single PrismaClient instance is reused across the application.
 * In development with hot-reload (tsx watch), stores the instance on
 * globalThis to prevent connection exhaustion from repeated module reloads.
 *
 * Usage:
 *   import { prisma } from '../lib/prisma.js';
 *   const users = await prisma.user.findMany();
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'node:fs';

import { env } from '../config/env.js';
const runtimeUrl = new URL(env.DATABASE_URL);
const ca = env.DB_SSL_CA_CERT_PATH ? readFileSync(env.DB_SSL_CA_CERT_PATH, 'utf8') : undefined;
for (const parameter of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
  runtimeUrl.searchParams.delete(parameter);
}
const adapter = new PrismaPg({
  connectionString: runtimeUrl.toString(),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
  ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: env.NODE_ENV === 'production' },
});

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
