import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isWorkerHealthFresh, recordWorkerHealth } from './worker-health.js';

const previous = process.env.ELECTROHUB_WORKER_HEALTH_FILE;
let directory: string | undefined;

afterEach(async () => {
  if (previous === undefined) delete process.env.ELECTROHUB_WORKER_HEALTH_FILE;
  else process.env.ELECTROHUB_WORKER_HEALTH_FILE = previous;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('worker readiness heartbeat', () => {
  it('writes only ready state and timestamp using an atomic rename', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'electrohub-worker-health-'));
    const target = path.join(directory, 'health.json');
    process.env.ELECTROHUB_WORKER_HEALTH_FILE = target;
    const now = Date.now();
    await recordWorkerHealth('ready', now);
    const value = JSON.parse(await readFile(target, 'utf8'));
    expect(value).toEqual({ state: 'ready', updatedAt: new Date(now).toISOString() });
    expect(isWorkerHealthFresh(value, now)).toBe(true);
  });

  it('fails closed for degraded, stale, malformed, and materially future heartbeats', () => {
    const now = Date.now();
    expect(isWorkerHealthFresh({ state: 'degraded', updatedAt: new Date(now).toISOString() }, now)).toBe(false);
    expect(isWorkerHealthFresh({ state: 'ready', updatedAt: new Date(now - 90_001).toISOString() }, now)).toBe(false);
    expect(isWorkerHealthFresh({ state: 'ready', updatedAt: 'invalid' }, now)).toBe(false);
    expect(isWorkerHealthFresh({ state: 'ready', updatedAt: new Date(now + 30_001).toISOString() }, now)).toBe(false);
  });
});
