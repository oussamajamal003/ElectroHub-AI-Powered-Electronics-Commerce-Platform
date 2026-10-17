import { setTimeout as wait } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { runRecoveryLoop } from './payment-recovery-loop.js';
import { paymentService } from './services/payment.service.js';
import { prisma } from './lib/prisma.js';
import { logSafely } from './utils/logger.js';
import { paymentRecoveryAttention } from './payment-recovery-attention.js';
import { inProcessRecoveryRuntime } from './payment-recovery-runtime.js';
import { logContext } from './utils/logContext.js';
import { resolvePaymentIsolation } from './payment-isolation.js';

/**
 * Recovery must never depend on a developer remembering to start `npm run payment:worker`: abandoned or unresolved purchases
 * (for example a submitted attempt stuck at card entry past its 15-minute abandonment window) are resolved by the same
 * lease-fenced `runBatch` the dedicated worker uses. Several runners (this one plus a dedicated worker) are safe together because
 * every job is claimed under a lease. Set PAYMENT_INPROCESS_RECOVERY=false where a dedicated supervised worker is the only runner.
 */
export function inProcessRecoveryEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.NODE_ENV !== 'test' && environment.PAYMENT_INPROCESS_RECOVERY !== 'false' && Boolean(environment.STRIPE_SECRET_KEY) &&
    resolvePaymentIsolation(environment).allowed;
}

export function startInProcessRecovery(): () => Promise<void> {
  const shutdown = new AbortController();
  inProcessRecoveryRuntime.update('starting');
  const completed = runRecoveryLoop({
    ready: () => prisma.$queryRaw`SELECT 1`,
    batch: async () => {
      inProcessRecoveryRuntime.update('processing');
      try {
        const workerInstanceId = inProcessRecoveryRuntime.snapshot().instanceId;
        const count = await logContext.run({ requestId: randomUUID(), workerInstanceId }, () => paymentService.runBatch());
        inProcessRecoveryRuntime.update('ready');
        return count;
      } catch (error) { inProcessRecoveryRuntime.update('degraded'); throw error; }
    },
    attention: () => paymentRecoveryAttention(prisma),
    report: (level, event, fields) => logSafely(level, 'Payment recovery lifecycle', { event, runner: 'in-process',
      workerInstanceId: inProcessRecoveryRuntime.snapshot().instanceId, ...fields }),
    stopping: () => shutdown.signal.aborted,
    wait: async ms => { try { await wait(ms, undefined, { signal: shutdown.signal }); } catch (error) { if (!shutdown.signal.aborted) throw error; } },
    now: Date.now,
    once: false,
  }).catch(error => logSafely('error', 'In-process payment recovery stopped.', { event: 'payment.recovery.inprocess_stopped', error }))
    .finally(() => inProcessRecoveryRuntime.update('stopped'));
  return () => { shutdown.abort(); return completed; };
}
