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

import { ObservablePrismaPg } from './database-adapter.js';
import { readFileSync } from 'node:fs';

import { env } from '../config/env.js';
import { paymentDiagnostics } from './payment-diagnostics.js';
import { logSafely } from '../utils/logger.js';
import { logContext } from '../utils/logContext.js';
function createClient() {
  const runtimeUrl = new URL(env.DIRECT_URL || env.DATABASE_URL);
  const ca = env.DB_SSL_CA_CERT_PATH ? readFileSync(env.DB_SSL_CA_CERT_PATH, 'utf8') : undefined;
  const paymentSqlDiagnostics = process.env.ELECTROHUB_SQL_DIAGNOSTICS === '1';
  for (const parameter of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'pgbouncer']) {
    runtimeUrl.searchParams.delete(parameter);
  }
  const adapter = new ObservablePrismaPg({
    connectionString: runtimeUrl.toString(),
    // Configured application maxima do not establish Supavisor tenant headroom.
    // pg min retains connections; it does not proactively warm an empty pool.
    max: env.NODE_ENV === 'production' ? 10 : 5,
    min: env.NODE_ENV === 'production' ? 2 : env.NODE_ENV === 'development' ? 1 : 0,
    idleTimeoutMillis: env.NODE_ENV === 'test' ? 10000 : 300000,
    connectionTimeoutMillis: 30000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true },
  });

  const client = new PrismaClient({
    adapter,
    // Migration 20261016000000 may not be applied to every database yet: never select its column unless explicitly enabled.
    omit: { paymentAttempt: { confirmationStartedAt: process.env.PAYMENT_CONFIRMATION_SIGNAL !== 'true' } },
    log: [{ emit: 'event', level: 'query' }, { emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }],
  });
  client.$on('query', event => {
    const kind = /^\s*(SELECT|INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.exec(event.query ?? '')?.[1]?.toUpperCase() ?? 'QUERY';
    logSafely('info', 'Database operation completed', { operation: `db.${kind.toLowerCase()}`, durationMs: event.duration });
    if (paymentSqlDiagnostics) {
      try { paymentDiagnostics.record('prisma-query', event.duration); } catch { /* Observer failure must not affect queries. */ }
    }
  });
  client.$on('error', event => {
    // Only the fixed-format identifiers are extracted; the engine message itself may carry SQL or parameters and is never logged.
    const text = typeof event?.message === 'string' ? event.message : '';
    const prismaCode = /\bP[0-9]{4}\b/.exec(text)?.[0] ?? null;
    const sqlStateCandidate = /\bSQLSTATE\s*[:=]?\s*"?([0-9A-Z]{5})\b/i.exec(text)?.[1] ??
      /\bcode\s*[:=]\s*"?([0-9A-Z]{5})\b/i.exec(text)?.[1];
    const sqlState = sqlStateCandidate && !/^P[0-9]{4}$/i.test(sqlStateCandidate) ? sqlStateCandidate.toUpperCase() : null;
    // Prisma's global event does not identify the application operation. Attach the
    // request only when the async context is present; otherwise leave it uncorrelated.
    const correlationId = logContext.getStore()?.requestId ?? null;
    logSafely('error', 'Database operation failed', { operation: 'db.error', code: 'DATABASE_ERROR', prismaCode, sqlState,
      requestId: correlationId, correlationId });
    if (paymentSqlDiagnostics) {
      try { paymentDiagnostics.record('database-operation', null, { code: 'DATABASE_ERROR' }, correlationId ?? undefined); } catch { /* No raw error contents. */ }
    }
  });
  client.$on('warn', () => logSafely('warn', 'Database warning', { operation: 'db.warning' }));
  return client;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
