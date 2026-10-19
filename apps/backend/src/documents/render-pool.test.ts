import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { ASSET_VERSION } from './assets.js';
import type { DocumentSnapshotV1 } from './document.types.js';
import { RenderPool } from './render-pool.js';
import { evaluateDocuments } from '../services/order-document.domain.js';
import { line, paidOrder } from '../services/__tests__/order-document.fixtures.js';

/**
 * Renderer pool tests (Task 03.9 §7, §11.2). These use real worker threads (render-worker.ts loaded through tsx), so each
 * test allows a generous timeout for worker start-up. Every pool is closed in afterEach.
 */

const TIMEOUT = 60_000;

function invoiceSnapshot(order = paidOrder()): { snapshot: DocumentSnapshotV1; contentVersion: string } {
  const decision = evaluateDocuments(order, ASSET_VERSION).find(entry => entry.kind === 'invoice')!;
  if (!decision.available) throw new Error(`fixture unavailable: ${decision.reason}`);
  return { snapshot: decision.snapshot!, contentVersion: decision.contentVersion! };
}

const hundredLines = () => Array.from({ length: 100 }, (_, index) => line(index, '18.75', (index % 5) + 1, `Synthetic accessory item ${index + 1}`));

const pools: RenderPool[] = [];
function createPool(options: ConstructorParameters<typeof RenderPool>[0]) {
  const pool = new RenderPool(options);
  pools.push(pool);
  return pool;
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map(pool => pool.close()));
});

const tempDir = mkdtempSync(path.join(tmpdir(), 'electrohub-render-pool-'));
afterAll(() => { rmSync(tempDir, { recursive: true, force: true }); });

const isPdf = (bytes: Buffer) => bytes.subarray(0, 5).toString('latin1') === '%PDF-' && bytes.toString('latin1').includes('%%EOF');

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try { await promise; return undefined; } catch (error) { return (error as { code?: string }).code; }
}

describe('RenderPool: rendering', () => {
  it('returns a valid single-page PDF from a worker thread', async () => {
    const pool = createPool({ size: 1 });
    const { snapshot, contentVersion } = invoiceSnapshot();
    const result = await pool.render(snapshot, contentVersion);
    expect(isPdf(result.bytes)).toBe(true);
    expect(result.pageCount).toBe(1);
    expect(result.bytes.byteLength).toBeGreaterThan(64);
  }, TIMEOUT);

  // BUG (render-pool.ts:67 with pump() at :145-156): jobs are only dispatched once a worker posts 'ready', so jobs submitted
  // synchronously count against maxQueue while no slot is busy. Capacity at submission time is maxQueue, not size + maxQueue.
  it('accepts size + maxQueue concurrent renders', async () => {
    const pool = createPool({ size: 2, maxQueue: 2 });
    const { snapshot, contentVersion } = invoiceSnapshot();
    const outcomes = await Promise.allSettled([1, 2, 3, 4].map(() => pool.render(snapshot, contentVersion)));
    expect(outcomes.map(outcome => outcome.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
  }, TIMEOUT);

  // BUG (same root cause as above): with size 1 / maxQueue 1, the first job is still waiting for the worker to boot, so the
  // second submission is rejected with QUEUE_FULL although one job can still be accepted. Observed: 1 fulfilled, 2 rejected.
  it('rejects only the render that exceeds size + maxQueue with QUEUE_FULL', async () => {
    const pool = createPool({ size: 1, maxQueue: 1 });
    const { snapshot, contentVersion } = invoiceSnapshot();
    const outcomes = await Promise.allSettled([1, 2, 3].map(() => pool.render(snapshot, contentVersion)));
    const rejected = outcomes.filter(outcome => outcome.status === 'rejected') as PromiseRejectedResult[];
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect((rejected[0]!.reason as { code?: string }).code).toBe('QUEUE_FULL');
  }, TIMEOUT);
});

describe('RenderPool: cancellation', () => {
  it('rejects with CANCELLED when the signal is already aborted', async () => {
    const pool = createPool({ size: 1 });
    const { snapshot, contentVersion } = invoiceSnapshot();
    const controller = new AbortController();
    controller.abort();
    expect(await codeOf(pool.render(snapshot, contentVersion, controller.signal))).toBe('CANCELLED');
    expect(pool.stats().workers).toBe(0);
  }, TIMEOUT);

  it('cancels a job aborted while queued and still renders the following job', async () => {
    const pool = createPool({ size: 1, maxQueue: 4 });
    const { snapshot, contentVersion } = invoiceSnapshot();
    const controller = new AbortController();
    const first = pool.render(snapshot, contentVersion);
    const queued = pool.render(snapshot, contentVersion, controller.signal);
    controller.abort();
    expect(await codeOf(queued)).toBe('CANCELLED');
    const following = await pool.render(snapshot, contentVersion);
    expect(isPdf(following.bytes)).toBe(true);
    expect((await first).pageCount).toBe(1);
  }, TIMEOUT);

  it('cancels a running job and the pool recovers for the next render', async () => {
    const pool = createPool({ size: 1 });
    const heavy = invoiceSnapshot(paidOrder({}, hundredLines()));
    const controller = new AbortController();
    const running = pool.render(heavy.snapshot, heavy.contentVersion, controller.signal);
    // Wait for the worker to pick the job up before aborting it.
    while (pool.stats().busy === 0) await new Promise(resolve => setTimeout(resolve, 5));
    controller.abort();
    expect(await codeOf(running)).toBe('CANCELLED');
    const small = invoiceSnapshot();
    const next = await pool.render(small.snapshot, small.contentVersion);
    expect(next.pageCount).toBe(1);
  }, TIMEOUT);
});

describe('RenderPool: deadline', () => {
  it('rejects with TIMEOUT, counts it, terminates the worker, and a normal pool still renders', async () => {
    const pool = createPool({ size: 1, deadlineMs: 1 });
    const { snapshot, contentVersion } = invoiceSnapshot(paidOrder({}, hundredLines()));
    expect(await codeOf(pool.render(snapshot, contentVersion))).toBe('TIMEOUT');
    expect(pool.stats().timeouts).toBe(1);
    // The timed-out worker is removed from the pool rather than left running in the background.
    expect(pool.stats().workers).toBe(0);
    expect(pool.stats().busy).toBe(0);

    const healthy = createPool({ size: 1 });
    const result = await healthy.render(invoiceSnapshot().snapshot, contentVersion);
    expect(result.pageCount).toBe(1);
  }, TIMEOUT);
});

describe('RenderPool: asset failure', () => {
  it('rejects with ASSETS_UNAVAILABLE when the worker reports an init error', async () => {
    // A minimal CommonJS worker that reports the same init-error message as render-worker.ts when fonts cannot be verified.
    const workerFile = path.join(tempDir, 'init-error-worker.cjs');
    writeFileSync(workerFile, "require('node:worker_threads').parentPort.postMessage({ type: 'init-error' });\n");
    const pool = createPool({ size: 1, workerFile });
    const { snapshot, contentVersion } = invoiceSnapshot();
    expect(await codeOf(pool.render(snapshot, contentVersion))).toBe('ASSETS_UNAVAILABLE');
    // Once assets are known to be unavailable, later renders fail fast without spawning workers again.
    expect(await codeOf(pool.render(snapshot, contentVersion))).toBe('ASSETS_UNAVAILABLE');
    expect(pool.stats().workers).toBe(0);
  }, TIMEOUT);
});
