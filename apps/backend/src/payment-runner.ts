import { setTimeout as wait } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { logContext } from './utils/logContext.js';
import { paymentService } from './services/payment.service.js';
import { prisma } from './lib/prisma.js';
import { logger, logSafely, flushLogsWithDeadline, installFatalLogging } from './utils/logger.js';
import { env } from './config/env.js';
import { attemptSchema } from './services/checkout.domain.js';
import { runRecoveryLoop } from './payment-recovery-loop.js';
import { paymentRecoveryAttention } from './payment-recovery-attention.js';
import { paymentIsolation } from './payment-isolation.js';
import { logCommerceEmailRuntime } from './services/commerce-email.runtime.js';
import { devSupervisorScope, requireSupervisedPaymentScope } from './lib/dev-supervisor.js';
import type { PaymentWorkScope } from './services/payment.service.js';

installFatalLogging();
logger.info('Payment runner starting', { operation: 'payment.runner.starting' });
const isolation = paymentIsolation();
logger[isolation.allowed ? 'info' : 'error']('Payment isolation resolved', { event: 'payment.isolation.resolved', allowed: isolation.allowed,
  target: isolation.target, identity: isolation.identity, reason: isolation.reason });
if (!isolation.allowed) throw new Error(`Payment runner refused: ${isolation.reason} (${isolation.identity}).`);
// A supervised shared-DEV runner must consume the scope issued through its authenticated IPC handshake.
// Direct --attempt flags remain limited to disposable NODE_ENV=test fixtures.
const requested = process.argv.filter(value => value.startsWith('--attempt=')).map(value => value.slice('--attempt='.length));
const supervisedDev = env.NODE_ENV === 'development' && process.env.PAYMENT_DEV_SUPERVISED === '1';
let scope: PaymentWorkScope | undefined;
if (supervisedDev) {
  if (requested.length) throw new Error('Supervised DEV attempt scope must come from supervisor IPC.');
  scope = requireSupervisedPaymentScope(devSupervisorScope(isolation.identity));
} else {
  if (requested.length && (env.NODE_ENV !== 'test' || requested.length > 10)) {
    throw new Error('Scoped runner is restricted to bounded test fixtures.');
  }
  scope = requested.length ? requested.map(value => attemptSchema.parse(value)) : undefined;
}
const workerInstanceId = randomUUID();
if (scope) Object.freeze(scope);
logCommerceEmailRuntime('payment-worker');
let stopping = false;
const shutdown = new AbortController();
const stop = () => { stopping = true; shutdown.abort(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
async function main() {
  try {
  await runRecoveryLoop({
    ready: () => prisma.$queryRaw`SELECT 1`,
    batch: () => logContext.run({ requestId: randomUUID(), workerInstanceId }, () => paymentService.runBatch(scope)),
    attention: () => paymentRecoveryAttention(prisma, scope),
    report: (level, event, fields) => logSafely(level, 'Payment recovery lifecycle', { event, workerInstanceId, scoped: Boolean(scope),
      scopeKind: !scope ? 'none' : Array.isArray(scope) ? 'attempt-ids' : 'governed-since', ...fields }),
    stopping: () => stopping,
    wait: async ms => {
      try { await wait(ms, undefined, { signal: shutdown.signal }); }
      catch (error) { if (!shutdown.signal.aborted) throw error; }
    }, now: Date.now,
    once: process.argv.includes('--once'),
  });
  } finally {
    await prisma.$disconnect();
    logger.info('Payment runner stopped', { operation: 'payment.runner.stopped' });
    if (!await flushLogsWithDeadline()) process.exit(1);
  }
}
void main().catch(async (error) => { logSafely('error', 'Payment recovery stopped.', { event: 'payment.recovery.stopped', error }); process.exitCode = 1; if (!await flushLogsWithDeadline()) process.exit(1); });
