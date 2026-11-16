import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { collectDbMetrics, MAX_RECORDED_OPERATIONS, recordDbOperation, timeDbStage, trackHttpRequest } from './db-request-metrics.js';
import { ObservablePrismaPg } from './database-adapter.js';

describe('request-scoped database metrics', () => {
  it('records nothing outside an explicit scope and bounds storage inside one', async () => {
    recordDbOperation({ kind: 'read', transactional: false, durationMs: 1, poolQueued: false });
    const scoped = collectDbMetrics(async () => {
      for (let index = 0; index < MAX_RECORDED_OPERATIONS + 5; index += 1) recordDbOperation({ kind: 'read', transactional: false, durationMs: 1, poolQueued: index === 0 });
      recordDbOperation({ kind: 'transaction_start', transactional: false, durationMs: 2, poolQueued: false, failureKind: 'network' });
      await timeDbStage('stage', () => undefined);
    });
    await scoped.result;
    const summary = scoped.metrics();
    expect(summary).toMatchObject({ dbOperationCount: MAX_RECORDED_OPERATIONS + 6, dbOperationsDropped: 6, dbReadCount: MAX_RECORDED_OPERATIONS,
      poolQueuedOperations: 1, transactionStartCount: 0 });
    expect(Object.keys(summary.stagesMs)).toEqual(['stage']);
    expect(summary.sequence.length).toBeLessThanOrEqual(16);
  });

  it('marks a scope exclusive only when no other HTTP request overlapped it, and stops observing when it ends', async () => {
    const end = trackHttpRequest();
    const alone = collectDbMetrics(async () => recordDbOperation({ kind: 'read', transactional: false, durationMs: 1, poolQueued: false }));
    await alone.result;
    recordDbOperation({ kind: 'write', transactional: false, durationMs: 1, poolQueued: false });
    expect(alone.metrics()).toMatchObject({ attribution: 'exclusive', dbReadCount: 1, dbWriteCount: 0 });
    const overlapped = collectDbMetrics(async () => { const other = trackHttpRequest(); other(); other(); });
    await overlapped.result;
    expect(overlapped.metrics()).toMatchObject({ attribution: 'shared', concurrentRequests: 2 });
    end();
    const stages = collectDbMetrics(async () => { await timeDbStage('a', async () => undefined); });
    await stages.result;
    expect(Object.keys(stages.metrics().stagesMs)).toEqual(['a']);
  });
});

// Real-driver attribution: counts must be what Prisma actually sent through the adapter, not inferred from source.
const isolated = (() => { try { return JSON.parse(readFileSync('.isolated/env.json', 'utf8')) as Record<string, string>; } catch { return null; } })();
const local = isolated && ['127.0.0.1', 'localhost'].includes(new URL(isolated.DATABASE_URL).hostname) ? isolated : null;

describe.skipIf(!local)('real adapter attribution on the disposable database', () => {
  it('counts the exact Orders find+count batch transaction and never retains SQL or parameters', async () => {
    const url = new URL(local!.DATABASE_URL);
    for (const parameter of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(parameter);
    const adapter = new ObservablePrismaPg({ connectionString: url.toString(), max: 2,
      ssl: { ca: readFileSync(local!.DB_SSL_CA_CERT_PATH, 'utf8'), rejectUnauthorized: true } });
    const client = new PrismaClient({ adapter });
    try {
      const userId = '00000000-0000-4000-8000-00000000c0de';
      const scoped = collectDbMetrics(async () => client.$transaction([
        client.order.findMany({ where: { userId }, include: { items: true, payment: true }, take: 10 }),
        client.order.count({ where: { userId } }),
      ]));
      await scoped.result;
      const summary = scoped.metrics();
      // Observed on Prisma 6.12 + adapter-pg: acquire+BEGIN, findMany, count, COMMIT (sent as executeRaw), then the adapter release.
      expect(summary.sequence.map(entry => entry.split(':')[0])).toEqual(['transaction_start', 'read', 'read', 'write', 'commit']);
      expect(JSON.stringify(summary)).not.toMatch(/SELECT|c0de|orders/i);
      const before = scoped.metrics().dbOperationCount;
      await client.order.count({ where: { userId } });
      expect(scoped.metrics().dbOperationCount).toBe(before);
      expect(summary.attribution).toBe('exclusive');
    } finally { await client.$disconnect(); }
  });
});
