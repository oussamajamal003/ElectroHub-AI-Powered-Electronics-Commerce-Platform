import { randomUUID } from 'node:crypto';

/** Local runner evidence only; never claims liveness of a different process. */
export function createRecoveryRuntime(now = Date.now) {
  const instanceId = randomUUID();
  let phase: 'stopped' | 'starting' | 'ready' | 'processing' | 'degraded' = 'stopped';
  let lastProgressAt: number | null = null;
  return {
    update(next: typeof phase) { phase = next; lastProgressAt = now(); },
    snapshot() {
      const age = lastProgressAt === null ? null : Math.max(0, now() - lastProgressAt);
      return { instanceId, phase, lastProgressAt: lastProgressAt === null ? null : new Date(lastProgressAt).toISOString(),
        // An unusually long batch is an operational signal, never a payment outcome.
        healthy: (phase === 'ready' || phase === 'processing') && age !== null && age <= 120_000 };
    },
  };
}
export const inProcessRecoveryRuntime = createRecoveryRuntime();
