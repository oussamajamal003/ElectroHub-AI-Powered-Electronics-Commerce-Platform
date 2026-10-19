/* eslint-disable no-console */
/**
 * Task 03.9 renderer performance/resource probe (synthetic, no database): p50/p95 per document size through the production
 * worker pool at its default concurrency, main-thread event-loop delay while rendering, and process RSS.
 *   npx tsx scripts/document-perf.ts
 */
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { ASSET_VERSION } from '../src/documents/assets.js';
import { RenderPool } from '../src/documents/render-pool.js';
import { evaluateDocuments } from '../src/services/order-document.domain.js';
import { line, paidOrder } from '../src/services/__tests__/order-document.fixtures.js';

const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(p * values.length) - 1)]!;
(async () => {
  const pool = new RenderPool();
  const loop = monitorEventLoopDelay({ resolution: 10 });
  console.log(`host: ${os.cpus()[0]?.model} x${os.cpus().length}, ${Math.round(os.totalmem() / 2 ** 30)} GiB, node ${process.version}; pool size 2, queue 8`);
  const warm = evaluateDocuments(paidOrder(), ASSET_VERSION)[0]!;
  await Promise.all([pool.render(warm.snapshot!, warm.contentVersion!), pool.render(warm.snapshot!, warm.contentVersion!)]);
  loop.enable();
  let peakRss = process.memoryUsage().rss;
  for (const lines of [1, 10, 50, 100]) {
    const order = paidOrder({}, Array.from({ length: lines }, (_, index) => line(index, '18.75', (index % 5) + 1,
      index % 9 === 0 ? `Long synthetic product title ${index} with extended descriptive wording that wraps across several lines` : `Synthetic item ${index}`)));
    const decision = evaluateDocuments(order, ASSET_VERSION)[0]!;
    const durations: number[] = []; let bytes = 0; let pages = 0;
    // 20 requests in waves of 4 concurrent callers (2 rendering + 2 queued) — the configured per-process concurrency.
    for (let wave = 0; wave < 5; wave++) {
      await Promise.all(Array.from({ length: 4 }, async () => {
        const started = performance.now();
        const pdf = await pool.render(decision.snapshot!, decision.contentVersion!);
        durations.push(performance.now() - started); bytes = pdf.bytes.length; pages = pdf.pageCount;
      }));
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }
    console.log(`${String(lines).padStart(3)} lines: p50 ${percentile(durations, 0.5).toFixed(0)} ms, p95 ${percentile(durations, 0.95).toFixed(0)} ms (incl. queue wait), ${bytes} B, ${pages} page(s)`);
  }
  loop.disable();
  console.log(`main event-loop delay while rendering: p99 ${(loop.percentile(99) / 1e6).toFixed(1)} ms, max ${(loop.max / 1e6).toFixed(1)} ms`);
  console.log(`peak main-process RSS (includes worker threads): ${Math.round(peakRss / 2 ** 20)} MiB; pool stats ${JSON.stringify(pool.stats())}`);
  await pool.close();
})();
