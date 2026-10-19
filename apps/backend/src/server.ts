import app from './app.js';
import { env } from './config/env.js';
import { logger, flushLogsWithDeadline, installFatalLogging } from './utils/logger.js';
import { prisma } from './lib/prisma.js';
import { inProcessRecoveryEnabled, startInProcessRecovery } from './payment-inprocess-recovery.js';
import { paymentIsolation } from './payment-isolation.js';
import { logCommerceEmailRuntime } from './services/commerce-email.runtime.js';

const PORT = env.PORT;
let stopRecovery: (() => Promise<void>) | null = null;
installFatalLogging();
logger.info('Server starting', { operation: 'server.starting' });
{
  const isolation = paymentIsolation();
  logger[isolation.allowed ? 'info' : 'warn']('Payment isolation resolved', { event: 'payment.isolation.resolved', allowed: isolation.allowed,
    target: isolation.target, identity: isolation.identity, reason: isolation.reason });
  logCommerceEmailRuntime('api');
}

/**
 * Pre-warm the database connection pool and verify readiness.
 * Handles failures cleanly to prevent unhandled promise rejections.
 */
export async function prewarmDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('Database connection established and pool pre-warmed.', {
      event: 'db.ready',
    });
    return true;
  } catch (err) {
    logger.error('Database connection failed during startup pre-warm.', {
      event: 'db.unavailable',
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export const server = app.listen(PORT, async () => {
  logger.info('Server started', {
    port: PORT,
    environment: env.NODE_ENV,
    event: 'server.started',
  });
  logger.info(`Swagger docs available at http://localhost:${PORT}/api/docs`);

  // Recovery owns its readiness retries. An initial database outage must not
  // permanently disable it after the HTTP process has started.
  if (inProcessRecoveryEnabled()) {
    stopRecovery = startInProcessRecovery();
    logger.info('In-process payment recovery started.', { event: 'payment.recovery.inprocess_started' });
  }
  // Explicit startup prewarming & readiness verification.
  // API binds port first for liveness; server.ready is logged only after DB verification.
  const isDbReady = await prewarmDatabase();
  if (isDbReady) {
    logger.info('Server is fully ready to accept database traffic.', {
      event: 'server.ready',
    });
  } else {
    logger.warn('Server started in degraded state; database is currently unavailable.', {
      event: 'server.degraded',
    });
  }
});

let shuttingDown = false;
export const gracefulShutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  // Signal immediately, then drain the current lease owner before disconnecting
  // its shared pool. The existing shutdown deadline still bounds the process.
  const recoveryStopped = stopRecovery?.();
  logger.info(`${signal} signal received. Closing HTTP server.`, { event: 'server.stopping' });

  // Force close after 10s if graceful shutdown hangs
  const forceTimer = setTimeout(async () => {
    logger.error('Could not close connections in time, forcefully shutting down', { event: 'server.force_stopped' });
    await flushLogsWithDeadline(1000);
    process.exit(1);
  }, 10000);
  forceTimer.unref();

  server.close(async (closeErr) => {
    if (closeErr) {
      logger.error('Error closing HTTP server', { event: 'server.close_error', error: closeErr.message });
    } else {
      logger.info('HTTP server closed.', { event: 'server.http_closed' });
    }

    try {
      await recoveryStopped;
      await prisma.$disconnect();
      logger.info('Database connection pool closed cleanly.', { event: 'db.disconnected' });
    } catch (dbErr) {
      logger.error('Error disconnecting Prisma client', {
        event: 'db.disconnect_error',
        error: dbErr instanceof Error ? dbErr.message : String(dbErr),
      });
    }

    logger.info('Graceful shutdown completed. Exiting process.', { event: 'server.stopped' });
    if (!await flushLogsWithDeadline()) process.exit(1);
    clearTimeout(forceTimer);
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
