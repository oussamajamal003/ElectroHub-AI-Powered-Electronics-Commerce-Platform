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

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

import { env } from '../config/env.js';
const connectionString = env.DIRECT_URL || env.DATABASE_URL;
export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  ssl: {
    rejectUnauthorized: false,
  },
});
const adapter = new PrismaPg(pool);

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
