/** Runner orchestration only: never changes payment state or retries a provider operation itself. */
export interface RecoveryAttention {
  attemptId: string; state: string; retryCount: number; leaseExpired: boolean;
}
interface RecoveryLoop {
  ready(): Promise<unknown>;
  batch(): Promise<unknown>;
  attention(): Promise<RecoveryAttention[]>;
  report(level: 'info' | 'error', event: string, fields: Record<string, unknown>): void;
  stopping(): boolean;
  wait(ms: number): Promise<void>;
  now(): number;
  once: boolean;
}
export const RECOVERY_ALERT_AGE_MS = 30 * 60_000;
/** Must equal `take` in PaymentService.runBatch: a full batch means more due work may be waiting, so the runner must not sleep. */
export const RECOVERY_BATCH_SIZE = 10;
const MONITOR_INTERVAL_MS = 60_000;

export async function runRecoveryLoop(deps: RecoveryLoop): Promise<void> {
  let ready = false; let failures = 0; let nextMonitor = 0; let drained = false;
  do {
    if (deps.stopping()) break;
    try {
      if (!ready) {
        await deps.ready(); ready = true;
        deps.report('info', 'payment.runner.ready', {});
      }
      if (deps.stopping()) break;
      const processed = await deps.batch();
      failures = 0;
      drained = typeof processed === 'number' && processed >= RECOVERY_BATCH_SIZE;
    } catch (error) {
      failures++; drained = false;
      deps.report('error', 'payment.recovery.batch_failed', { error, consecutiveFailures: failures });
      if (failures >= 3) deps.report('error', 'payment.recovery.escalation', {
        reason: 'RUNNER_UNAVAILABLE', consecutiveFailures: failures, action: 'CHECK_DATABASE_AND_RUNNER',
      });
      // --once is used by acceptance tooling: a failed single pass must still exit nonzero.
      if (deps.once) throw error;
    }
    if (ready && deps.now() >= nextMonitor) {
      nextMonitor = deps.now() + MONITOR_INTERVAL_MS;
      try {
        const attention = await deps.attention();
        if (attention.length) deps.report('error', 'payment.recovery.escalation', {
          reason: 'PAYMENT_REQUIRES_ATTENTION', action: 'VERIFY_PROVIDER_AND_RECOVERY_WORK',
          // Bounded opaque IDs and state only; never include customer or card data.
          attempts: attention, sampleLimit: 10,
        });
      } catch (error) {
        deps.report('error', 'payment.recovery.escalation', { reason: 'RECOVERY_MONITOR_UNAVAILABLE', error });
      }
    }
    if (deps.once || deps.stopping()) break;
    if (drained) continue; // backlog: take the next batch immediately instead of idling for 5 s per 10 attempts
    await deps.wait(failures ? Math.min(30_000, 1_000 * 2 ** Math.min(failures, 5)) : 5_000);
  } while (!deps.stopping());
}
