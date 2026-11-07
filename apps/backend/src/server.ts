import { startDeletionNoticeRetry } from './services/admin-deletion-email.js';
import app, { corsOrigin } from './app.js';
import { env } from './config/env.js';
import { logger, flushLogsWithDeadline, installFatalLogging } from './utils/logger.js';
import { prisma } from './lib/prisma.js';
import { inProcessRecoveryEnabled, startInProcessRecovery } from './payment-inprocess-recovery.js';
import { paymentIsolation } from './payment-isolation.js';
import { logCommerceEmailRuntime } from './services/commerce-email.runtime.js';
import { startOperationalRecommendationRetentionRunner } from './recommendation-retention-runner.js';
import { deliveryOrigin } from './config/delivery-map.config.js';
import { attachDeliveryGateway, type DeliveryGateway } from './sockets/delivery.gateway.js';
import { DeliveryPublisher } from './sockets/delivery.publisher.js';
import { startRealtimeMetricsLog } from './sockets/realtime-metrics.js';
import { assertSimulationBootConfig, simulationAvailability } from './services/delivery-simulation/simulation.config.js';
import { deliverySimulation } from './services/delivery-simulation/delivery-simulation.runner.js';

const PORT = env.PORT;
let stopRecovery: (() => Promise<void>) | null = null;
let stopRecommendationRetention: (() => Promise<void>) | null = null;
let stopDeletionNoticeRetry: (() => void) | null = null;
installFatalLogging();
// Task 04.6: a partial or out-of-range DELIVERY_ORIGIN_* configuration refuses to boot; unset leaves the map off.
logger.info('Delivery map origin resolved', { event: 'delivery.map.origin_resolved', configured: deliveryOrigin() !== null });
// Task 04.7: the demo simulation flag in production refuses to boot.
assertSimulationBootConfig();
logger.info('Delivery simulation resolved', { event: 'delivery.simulation.resolved', ...simulationAvailability() });
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
  // The bounded retention runner owns retries if startup DB readiness is degraded.
  if (!shuttingDown) stopRecommendationRetention = startOperationalRecommendationRetentionRunner();
  if (!shuttingDown) stopDeletionNoticeRetry = startDeletionNoticeRetry();
  if (isDbReady && !shuttingDown) {
    deliverySimulation.recoverOrphans().catch(() => logger.warn('Delivery simulation recovery failed', { event: 'delivery.simulation.recovery_failed' }));
  }
});

// Task 04.7: Socket.IO /delivery on the same HTTP server and CORS allowlist; closed before the HTTP server on shutdown.
const deliveryGateway: DeliveryGateway = attachDeliveryGateway(server, { corsOrigin });
DeliveryPublisher.attach(deliveryGateway);
const stopRealtimeMetrics = startRealtimeMetricsLog();

let shuttingDown = false;
export const gracefulShutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  // Signal immediately, then drain the current lease owner before disconnecting
  // its shared pool. The existing shutdown deadline still bounds the process.
  const recoveryStopped = stopRecovery?.();
  const retentionStopped = stopRecommendationRetention?.();
  stopDeletionNoticeRetry?.();
  logger.info(`${signal} signal received. Closing HTTP server.`, { event: 'server.stopping' });
  deliverySimulation.stopAll();
  stopRealtimeMetrics();
  DeliveryPublisher.attach(null);
  // io.close() disconnects every socket first (clients reconnect and refetch), then closes the HTTP server itself.
  const socketsClosed = deliveryGateway.close();

  // Force close after 10s if graceful shutdown hangs
  const forceTimer = setTimeout(async () => {
    logger.error('Could not close connections in time, forcefully shutting down', { event: 'server.force_stopped' });
    await flushLogsWithDeadline(1000);
    process.exit(1);
  }, 10000);
  forceTimer.unref();

  server.close(async (closeErr) => {
    await socketsClosed;
    if (closeErr && (closeErr as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
      logger.error('Error closing HTTP server', { event: 'server.close_error', error: closeErr.message });
    } else {
      logger.info('HTTP server closed.', { event: 'server.http_closed' });
    }

    try {
      await recoveryStopped;
      await retentionStopped;
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
