import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { DOCUMENT_LIMITS, type DocumentSnapshotV1 } from './document.types.js';

/**
 * Bounded renderer pool (Task 03.9 §7, §11.2): a fixed number of worker threads per API process, a bounded wait queue, a hard
 * per-job deadline enforced by terminating the worker (stopping CPU work), and cancellation of queued or running jobs. PDF work
 * never runs on the event loop that serves payments.
 */
export type RenderFailureCode = 'QUEUE_FULL' | 'TIMEOUT' | 'CANCELLED' | 'ASSETS_UNAVAILABLE' | 'RENDER_FAILED' | 'PAGE_LIMIT' | 'BYTE_LIMIT'
  | 'UNSUPPORTED_GLYPH' | 'LAYOUT_OVERFLOW' | 'INVALID_OUTPUT';

export class RenderError extends Error {
  constructor(public readonly code: RenderFailureCode) { super(`Document rendering failed: ${code}`); this.name = 'RenderError'; }
}

export interface RenderPoolOptions { size?: number; maxQueue?: number; deadlineMs?: number; workerFile?: string }
export interface PoolStats { workers: number; busy: number; queued: number; timeouts: number; maxQueue: number }

interface Job {
  id: number;
  snapshot: DocumentSnapshotV1;
  contentVersion: string;
  signal?: AbortSignal;
  resolve: (value: { bytes: Buffer; pageCount: number }) => void;
  reject: (error: RenderError) => void;
  onAbort?: () => void;
}

interface Slot { worker: Worker; job: Job | null; timer: NodeJS.Timeout | null; ready: boolean; failed: boolean }

/** Compiled `dist/*.js` runs directly; the TypeScript source (dev/tests) is loaded through tsx inside the worker. */
function spawn(file: string) {
  if (file.endsWith('.ts')) return new Worker(`require('tsx/cjs'); require(${JSON.stringify(file)});`, { eval: true });
  return new Worker(file);
}

const isPdf = (bytes: Buffer) => bytes.length > 64 && bytes.subarray(0, 5).toString('latin1') === '%PDF-' &&
  bytes.subarray(Math.max(0, bytes.length - 32)).toString('latin1').includes('%%EOF');

export class RenderPool {
  private readonly size: number;
  private readonly maxQueue: number;
  private readonly deadlineMs: number;
  private readonly workerFile: string;
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private nextId = 1;
  private timeouts = 0;
  private assetsUnavailable = false;

  constructor(options: RenderPoolOptions = {}) {
    this.size = options.size ?? 2;
    this.maxQueue = options.maxQueue ?? 8;
    this.deadlineMs = options.deadlineMs ?? DOCUMENT_LIMITS.renderDeadlineMs;
    this.workerFile = options.workerFile ?? path.join(__dirname, `render-worker${path.extname(__filename)}`);
  }

  stats(): PoolStats {
    return { workers: this.slots.length, busy: this.slots.filter(slot => slot.job).length, queued: this.queue.length,
      timeouts: this.timeouts, maxQueue: this.maxQueue };
  }

  render(snapshot: DocumentSnapshotV1, contentVersion: string, signal?: AbortSignal): Promise<{ bytes: Buffer; pageCount: number }> {
    if (signal?.aborted) return Promise.reject(new RenderError('CANCELLED'));
    if (this.assetsUnavailable) return Promise.reject(new RenderError('ASSETS_UNAVAILABLE'));
    // Jobs a free (or still booting) worker slot will take are not waiting; only the excess counts against the queue bound.
    const freeSlots = this.size - this.slots.filter(slot => slot.job).length;
    if (this.queue.length - freeSlots >= this.maxQueue) return Promise.reject(new RenderError('QUEUE_FULL'));
    return new Promise((resolve, reject) => {
      const job: Job = { id: this.nextId++, snapshot, contentVersion, signal, resolve, reject };
      if (signal) {
        job.onAbort = () => this.cancel(job);
        signal.addEventListener('abort', job.onAbort, { once: true });
      }
      this.queue.push(job);
      this.pump();
    });
  }

  /** Terminates every worker (tests / shutdown). Pending jobs are cancelled. */
  async close() {
    for (const job of this.queue.splice(0)) this.settle(job, new RenderError('CANCELLED'));
    await Promise.all(this.slots.map(slot => { if (slot.job) this.settle(slot.job, new RenderError('CANCELLED')); return slot.worker.terminate(); }));
    this.slots = [];
  }

  private settle(job: Job, outcome: RenderError | { bytes: Buffer; pageCount: number }) {
    if (job.onAbort) job.signal?.removeEventListener('abort', job.onAbort);
    if (outcome instanceof RenderError) job.reject(outcome); else job.resolve(outcome);
  }

  private cancel(job: Job) {
    const queued = this.queue.indexOf(job);
    if (queued >= 0) { this.queue.splice(queued, 1); this.settle(job, new RenderError('CANCELLED')); return; }
    const slot = this.slots.find(candidate => candidate.job === job);
    if (slot) this.recycle(slot, new RenderError('CANCELLED'));
  }

  private addSlot() {
    const slot: Slot = { worker: spawn(this.workerFile), job: null, timer: null, ready: false, failed: false };
    slot.worker.unref();
    slot.worker.on('message', message => this.onMessage(slot, message));
    slot.worker.on('error', () => { if (this.slots.includes(slot)) this.recycle(slot, new RenderError('RENDER_FAILED')); });
    slot.worker.on('exit', () => { if (this.slots.includes(slot)) this.recycle(slot, new RenderError('RENDER_FAILED')); });
    this.slots.push(slot);
    return slot;
  }

  /** Kills the worker (if running a job, that job fails with `error`) and replaces it lazily on the next dispatch. */
  private recycle(slot: Slot, error: RenderError) {
    if (slot.timer) clearTimeout(slot.timer);
    const job = slot.job;
    slot.job = null;
    this.slots = this.slots.filter(candidate => candidate !== slot);
    void slot.worker.terminate();
    if (job) this.settle(job, error);
    this.pump();
  }

  private onMessage(slot: Slot, message: { type: string; id?: number; ok?: boolean; bytes?: ArrayBuffer; pageCount?: number; code?: string }) {
    if (message.type === 'ready') { slot.ready = true; this.pump(); return; }
    if (message.type === 'init-error') {
      // Missing/corrupt packaged fonts: the feature reports DOCUMENTS_UNAVAILABLE instead of crash-looping workers.
      this.assetsUnavailable = true;
      for (const job of this.queue.splice(0)) this.settle(job, new RenderError('ASSETS_UNAVAILABLE'));
      this.recycle(slot, new RenderError('ASSETS_UNAVAILABLE'));
      return;
    }
    const job = slot.job;
    if (message.type !== 'result' || !job || message.id !== job.id) return;
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    slot.job = null;
    if (message.ok && message.bytes) {
      const bytes = Buffer.from(message.bytes);
      if (bytes.length > DOCUMENT_LIMITS.maxPdfBytes || !isPdf(bytes) || !Number.isInteger(message.pageCount) ||
        message.pageCount! < 1 || message.pageCount! > DOCUMENT_LIMITS.maxPages) this.settle(job, new RenderError('INVALID_OUTPUT'));
      else this.settle(job, { bytes, pageCount: message.pageCount! });
    } else {
      const known: RenderFailureCode[] = ['ASSETS_UNAVAILABLE', 'PAGE_LIMIT', 'BYTE_LIMIT', 'UNSUPPORTED_GLYPH', 'LAYOUT_OVERFLOW'];
      this.settle(job, new RenderError(known.includes(message.code as RenderFailureCode) ? message.code as RenderFailureCode : 'RENDER_FAILED'));
    }
    this.pump();
  }

  private pump() {
    if (this.assetsUnavailable) return;
    while (this.slots.length < this.size && this.queue.length > this.slots.filter(slot => !slot.job).length) this.addSlot();
    for (const slot of this.slots) {
      if (!this.queue.length) return;
      if (!slot.ready || slot.job) continue;
      const job = this.queue.shift()!;
      slot.job = job;
      slot.timer = setTimeout(() => { this.timeouts++; this.recycle(slot, new RenderError('TIMEOUT')); }, this.deadlineMs);
      slot.timer.unref();
      slot.worker.postMessage({ id: job.id, snapshot: job.snapshot, contentVersion: job.contentVersion });
    }
  }
}
