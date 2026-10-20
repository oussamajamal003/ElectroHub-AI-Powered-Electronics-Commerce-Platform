import { setTimeout as wait } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { prisma } from './lib/prisma.js';
import { env } from './config/env.js';
import { logger, logSafely, flushLogsWithDeadline, installFatalLogging } from './utils/logger.js';
import { resolvePaymentIsolation } from './payment-isolation.js';
import { commerceEmailConfig, dispatchPermission } from './services/commerce-email.config.js';
import { CommerceEmailDispatcher, captureTransport, commerceEmailHealth, type CommerceEmailTransport } from './services/commerce-email.dispatcher.js';
import { BrevoClient } from './integrations/brevo/brevo.client.js';
import { BrevoProvider } from './integrations/brevo/brevo.provider.js';
import { renderCommerceEmail } from './emails/commerce/templates.js';
import { logCommerceEmailRuntime } from './services/commerce-email.runtime.js';
import { brevoDeliveryEvents, DELIVERY_SYNC_INTERVAL_MS, reconcileDeliveries } from './services/commerce-email.delivery.js';

/**
 * Task 03.8 dedicated commerce email worker (`npm run email:worker`). Started only explicitly; importing services never starts it.
 * Separate from the payment runner: its own leases, its own provider pause, bounded batch/concurrency, and no PaymentWork access.
 */
const workerInstanceId = randomUUID();
const HEARTBEAT_MS = 60_000;
installFatalLogging();
const config = commerceEmailConfig();
const isolation = resolvePaymentIsolation();
const permission = dispatchPermission(config, { kind: isolation.target, identity: isolation.identity });
logSafely(permission.allowed ? 'info' : 'error', 'Commerce email worker permission resolved', { event: 'email_worker_permission',
  workerInstanceId, allowed: permission.allowed, reason: permission.reason, identity: permission.identity, sendMode: config.sendMode,
  allowlistSize: config.allowedRecipients.length, batchSize: config.batchSize, concurrency: config.concurrency });
if (!permission.allowed) throw new Error(`Commerce email worker refused: ${permission.reason} (${permission.identity}).`);
logCommerceEmailRuntime('email-worker');

const transport: CommerceEmailTransport = config.sendMode === 'capture' ? captureTransport(config.captureDir!) : (() => {
  const provider = new BrevoProvider(new BrevoClient({ apiKey: env.BREVO_API_KEY, timeoutMs: config.providerTimeoutMs }));
  return { name: 'BREVO' as const, send: message => provider.sendTransactionalEmail({ to: message.to, subject: message.subject,
    htmlContent: message.html, textContent: message.text, tags: message.tags }) };
})();
const dispatcher = new CommerceEmailDispatcher(prisma, transport, renderCommerceEmail, config, workerInstanceId);
// Provider delivery outcomes are read back (never resent) only when real Brevo sends happen; capture mode has no provider log.
const deliverySource = config.sendMode !== 'capture' && env.BREVO_API_KEY ? brevoDeliveryEvents(env.BREVO_API_KEY, config.providerTimeoutMs) : null;
let nextDeliverySync = 0;

let stopping = false;
const shutdown = new AbortController();
const stop = () => { stopping = true; shutdown.abort(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
const once = process.argv.includes('--once');

async function main() {
  let ready = false; let failures = 0; let nextHeartbeat = 0;
  try {
    while (!stopping) {
      let drained = false;
      try {
        if (!ready) {
          // One cheap startup check (never per payment): the Task 03.8 tables must exist in THIS database. A supervisor does not restart exit code 78.
          const [{ present }] = await prisma.$queryRaw<{ present: boolean }[]>`SELECT to_regclass('public.commerce_email_outbox') IS NOT NULL AS present`;
          if (!present) {
            logSafely('error', 'Commerce email worker cannot start: the commerce email schema is not migrated in this database.', {
              event: 'email_worker_unavailable', workerInstanceId, reason: 'SCHEMA_NOT_READY', identity: permission.identity });
            process.exitCode = 78; stopping = true; break;
          }
          ready = true;
          logSafely('info', 'Commerce email worker ready', { event: 'email_worker_ready', workerInstanceId, sendMode: config.sendMode,
            dispatchEnabled: config.dispatchEnabled, producerEnabledInThisEnvironment: config.enqueueEnabled, allowlistSize: config.allowedRecipients.length }); }
        const pass = await dispatcher.runBatch();
        failures = 0;
        drained = pass.claimed >= config.batchSize;
      } catch (error) {
        failures++;
        logSafely('error', 'Commerce email batch failed', { event: 'email_worker_batch_failed', workerInstanceId, consecutiveFailures: failures, error });
        if (failures >= 3) logSafely('error', 'Commerce email worker unavailable', { event: 'email_worker_unavailable', workerInstanceId,
          reason: 'REPEATED_BATCH_FAILURES', consecutiveFailures: failures });
        if (once) throw error;
      }
      if (ready && Date.now() >= nextHeartbeat) {
        nextHeartbeat = Date.now() + HEARTBEAT_MS;
        try {
          const health = await commerceEmailHealth(prisma, config.sendMode === 'allowlist' ? config.allowedRecipients : []);
          const attention = (health.byState.UNCERTAIN ?? 0) > 0 || (health.oldestDueMs ?? 0) > 5 * 60_000 || health.expiredLeases > 0 || health.staleNeedingReview > 0;
          logSafely(attention ? 'error' : 'info', 'Commerce email worker heartbeat', { event: 'email_worker_heartbeat', workerInstanceId,
            paused: dispatcher.paused, attention, sendMode: config.sendMode, allowlistSize: config.allowedRecipients.length, ...health });
          // Test-mode exclusion is deliberate, but silent exclusion looked like a stuck queue: name it (count only, never addresses).
          if (health.allowlistExcluded) logSafely('warn', 'Commerce emails held by the allowlist', { event: 'email_allowlist_excluded', workerInstanceId,
            excluded: health.allowlistExcluded, hint: 'recipients outside COMMERCE_EMAIL_ALLOWED_RECIPIENTS are never sent in allowlist mode' });
        } catch (error) { logSafely('error', 'Commerce email health unavailable', { event: 'email_worker_unavailable', workerInstanceId, reason: 'HEALTH_QUERY_FAILED', error }); }
      }
      if (ready && deliverySource && Date.now() >= nextDeliverySync) {
        nextDeliverySync = Date.now() + DELIVERY_SYNC_INTERVAL_MS;
        try {
          const sync = await reconcileDeliveries(prisma, deliverySource);
          if (sync.updated || sync.failed) logSafely(sync.failed ? 'warn' : 'info', 'Commerce email delivery outcomes recorded', { event: 'email_delivery_sync', workerInstanceId, ...sync });
        } catch (error) { logSafely('warn', 'Commerce email delivery sync unavailable', { event: 'email_delivery_sync_failed', workerInstanceId, error }); }
      }
      if (once || stopping) break;
      if (drained) continue;
      try { await wait(failures ? Math.min(60_000, 1_000 * 2 ** Math.min(failures, 6)) : config.pollMs, undefined, { signal: shutdown.signal }); }
      catch (error) { if (!shutdown.signal.aborted) throw error; }
    }
  } finally {
    await prisma.$disconnect();
    logger.info('Commerce email worker stopped', { event: 'email_worker_stopped', workerInstanceId });
    if (!await flushLogsWithDeadline()) process.exit(1);
  }
}
void main().catch(async error => { logSafely('error', 'Commerce email worker stopped on error', { event: 'email_worker_stopped', workerInstanceId, error });
  process.exitCode = 1; if (!await flushLogsWithDeadline()) process.exit(1); });
