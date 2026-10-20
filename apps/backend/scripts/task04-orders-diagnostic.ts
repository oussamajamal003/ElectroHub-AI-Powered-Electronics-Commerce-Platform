// Task 04.0 bounded Orders read diagnostic: the real OrderService.list path through the instrumented adapter, serialized (one
// request at a time, so attribution is exclusive), for the private synthetic fixture customer only. Read-only; prints aggregates only.
// Usage: npx tsx scripts/task04-orders-diagnostic.ts --samples=30
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { prisma } from '../src/lib/prisma.js';
import { OrderService } from '../src/services/order.service.js';
import { collectDbMetrics, trackHttpRequest, type DbMetricsSummary } from '../src/lib/db-request-metrics.js';
import { resolveDatabaseTargets } from '../src/lib/database-target.js';

const samples = Number(/^--samples=(\d+)$/.exec(process.argv[2] ?? '')?.[1] ?? 10);
if (!Number.isInteger(samples) || samples < 1 || samples > 30) throw new Error('Use --samples=1..30.');
const target = resolveDatabaseTargets(process.env).runtime;
if (target.category !== 'dev' && target.category !== 'disposable') throw new Error('Orders diagnostic is limited to DEV or disposable targets.');
const fixture = JSON.parse(readFileSync(path.resolve('.cache/task04-acceptance/fixture.json'), 'utf8')) as { userId: string; email: string };
if (!/^task04-[a-f0-9-]+@electrohub\.invalid$/.test(fixture.email)) throw new Error('Synthetic fixture ownership required.');

const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
const service = new OrderService();
const runs: (DbMetricsSummary & { durationMs: number })[] = [];
async function main() {
try {
  await prisma.$queryRaw`SELECT 1`; // warm one pooled connection; excluded from samples
  for (let index = 0; index < samples; index += 1) {
    const untrack = trackHttpRequest();
    const started = performance.now();
    const scoped = collectDbMetrics(() => service.list(fixture.userId, { page: 1, pageSize: 10 }));
    try { await scoped.result; } finally { untrack(); }
    runs.push({ ...scoped.metrics(), durationMs: performance.now() - started });
  }
  const pick = (select: (run: (typeof runs)[number]) => number) => {
    const values = runs.map(select);
    return { p50: Math.round(percentile(values, 0.5)! * 100) / 100, p95: Math.round(percentile(values, 0.95)! * 100) / 100 };
  };
  console.log(JSON.stringify({ target: target.category, transport: target.transport, samples: runs.length,
    attribution: [...new Set(runs.map(run => run.attribution))], operationCounts: [...new Set(runs.map(run => run.dbOperationCount))],
    sequenceKinds: runs[0]?.sequence.map(entry => entry.split(':')[0]), poolQueuedOperations: runs.reduce((sum, run) => sum + run.poolQueuedOperations, 0),
    failedOperations: runs.reduce((sum, run) => sum + run.failedOperations, 0),
    serviceMs: pick(run => run.durationMs), dbTotalMs: pick(run => run.dbTotalMs), transactionStartMs: pick(run => run.transactionStartMs),
    queryMs: pick(run => run.queryMs), slowestReadMs: pick(run => run.maxOperationMs),
    dbReadCounts: [...new Set(runs.map(run => run.dbReadCount))], stageReadsMs: pick(run => run.stagesMs.find_count_reads ?? 0),
    projectionMs: pick(run => run.stagesMs.response_projection ?? 0) }, null, 2));
} finally { await prisma.$disconnect(); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Orders diagnostic failed'); process.exitCode = 1; });
