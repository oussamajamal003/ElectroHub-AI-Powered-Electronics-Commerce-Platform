import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logSafely } from './logger.js';

export type WorkerHealthState = 'ready' | 'degraded';
const HEARTBEAT_MAX_AGE_MS = 90_000;
const FUTURE_CLOCK_SKEW_MS = 30_000;

/** A local, data-free readiness heartbeat for Compose. It never controls worker dispatch. */
export async function recordWorkerHealth(state: WorkerHealthState, now = Date.now()): Promise<void> {
  const target = process.env.ELECTROHUB_WORKER_HEALTH_FILE;
  if (!target) return;
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(temporary, JSON.stringify({ state, updatedAt: new Date(now).toISOString() }), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, target);
  } catch {
    // Health reporting must not change lease, authorization, dispatch, or shutdown behavior.
    logSafely('warn', 'Worker health heartbeat could not be written', { event: 'worker.health_heartbeat_failed' });
  }
}

export function isWorkerHealthFresh(value: unknown, now = Date.now()): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as { state?: unknown; updatedAt?: unknown };
  if (record.state !== 'ready' || typeof record.updatedAt !== 'string') return false;
  const timestamp = Date.parse(record.updatedAt);
  return Number.isFinite(timestamp) && now - timestamp <= HEARTBEAT_MAX_AGE_MS && timestamp - now <= FUTURE_CLOCK_SKEW_MS;
}
