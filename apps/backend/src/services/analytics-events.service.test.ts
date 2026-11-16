import { beforeEach, describe, expect, it, vi } from 'vitest';
import { issueAnalyticsToken } from './analytics-token.js';

const db = vi.hoisted(() => ({ analyticsEvent: { createMany: vi.fn() }, $executeRaw: vi.fn() }));
const logger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../utils/logger.js', () => ({ logger, logSafely: vi.fn() }));

import {
  ANALYTICS_RETENTION_DAYS, AnalyticsUnavailableError, purgeExpiredAnalyticsEvents, recordImageSearchCompleted,
  recordImageSearchFailed, recordImageSearchSelection,
} from './analytics-events.service.js';

const CORRELATION = '6d1b8f0e-2c3a-4e5f-8a9b-0c1d2e3f4a5b';
const P1 = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const P2 = '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11';
const flush = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  vi.clearAllMocks();
  db.analyticsEvent.createMany.mockResolvedValue({ count: 1 });
});

describe('image-search outcome events', () => {
  it('stores a completed search with server-derived fields and an idempotency key, never an image or identity', async () => {
    recordImageSearchCompleted({ correlationId: CORRELATION, resultCount: 3, durationMs: 412.6 });
    await flush();
    const [args] = db.analyticsEvent.createMany.mock.calls[0]!;
    expect(args).toEqual({ data: [expect.objectContaining({ type: 'image_search.completed', source: 'SERVER', outcome: 'COMPLETED',
      correlationId: CORRELATION, resultCount: 3, durationMs: 413, idempotencyKey: `isr:${CORRELATION}` })], skipDuplicates: true });
    expect(Object.keys(args.data[0]).sort()).toEqual(['correlationId', 'durationMs', 'idempotencyKey', 'occurredAt', 'outcome',
      'resultCount', 'source', 'type']);
  });

  it('marks zero results as NO_RESULTS and caps absurd durations', async () => {
    recordImageSearchCompleted({ correlationId: CORRELATION, resultCount: 0, durationMs: 9_999_999 });
    await flush();
    expect(db.analyticsEvent.createMany.mock.calls[0]![0].data[0]).toEqual(expect.objectContaining({ outcome: 'NO_RESULTS', durationMs: 300_000 }));
  });

  it('records a failure with a fixed category only', async () => {
    recordImageSearchFailed({ correlationId: CORRELATION, category: 'inference_timeout', durationMs: 25_000 });
    await flush();
    expect(db.analyticsEvent.createMany.mock.calls[0]![0].data[0]).toEqual(expect.objectContaining({ type: 'image_search.failed',
      outcome: 'inference_timeout', idempotencyKey: `isr:${CORRELATION}` }));
  });

  it('absorbs storage failures into a warning log and never throws to the caller', async () => {
    db.analyticsEvent.createMany.mockRejectedValue(new Error('connection refused postgres://user:pw@db'));
    expect(() => recordImageSearchCompleted({ correlationId: CORRELATION, resultCount: 1, durationMs: 1 })).not.toThrow();
    await flush();
    expect(logger.warn).toHaveBeenCalledWith('ANALYTICS_EVENT_DROPPED', expect.objectContaining({ errorName: 'Error' }));
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('postgres://');
  });
});

describe('image-search selection events', () => {
  const token = () => issueAnalyticsToken({ correlationId: CORRELATION, productIds: [P1, P2] });

  it('accepts a shown product and keys the row by search and product', async () => {
    await expect(recordImageSearchSelection({ token: token(), productId: P2.toUpperCase() })).resolves.toEqual({ accepted: true });
    expect(db.analyticsEvent.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ type: 'image_search.result_selected',
      source: 'CLIENT', correlationId: CORRELATION, productId: P2, idempotencyKey: `iss:${CORRELATION}:${P2}` })], skipDuplicates: true });
  });

  it('treats a duplicate submission as accepted (the database absorbs it through the idempotency key)', async () => {
    db.analyticsEvent.createMany.mockResolvedValue({ count: 0 });
    await expect(recordImageSearchSelection({ token: token(), productId: P1 })).resolves.toEqual({ accepted: true });
  });

  it('rejects a forged, expired or missing token and a product outside the signed result list without writing', async () => {
    await expect(recordImageSearchSelection({ token: 'forged.token', productId: P1 })).resolves.toEqual({ accepted: false, reason: 'INVALID_TOKEN' });
    await expect(recordImageSearchSelection({ token: undefined, productId: P1 })).resolves.toEqual({ accepted: false, reason: 'INVALID_TOKEN' });
    const expired = issueAnalyticsToken({ correlationId: CORRELATION, productIds: [P1] }, 0);
    await expect(recordImageSearchSelection({ token: expired, productId: P1 })).resolves.toEqual({ accepted: false, reason: 'INVALID_TOKEN' });
    await expect(recordImageSearchSelection({ token: token(), productId: '3e7dd3c4-7b2f-4c9b-9f6a-4d0f3b2c1e33' }))
      .resolves.toEqual({ accepted: false, reason: 'PRODUCT_NOT_IN_RESULTS' });
    expect(db.analyticsEvent.createMany).not.toHaveBeenCalled();
  });

  it('surfaces storage failure as AnalyticsUnavailableError so the route can answer without exposing details', async () => {
    db.analyticsEvent.createMany.mockRejectedValue(new Error('FK violation on products'));
    await expect(recordImageSearchSelection({ token: token(), productId: P1 })).rejects.toBeInstanceOf(AnalyticsUnavailableError);
  });
});

describe('analytics retention', () => {
  it('keeps events for 400 days and deletes older rows in bounded batches', async () => {
    expect(ANALYTICS_RETENTION_DAYS).toBe(400);
    db.$executeRaw.mockResolvedValueOnce(1000).mockResolvedValueOnce(12);
    const deleted = await purgeExpiredAnalyticsEvents(Date.UTC(2027, 0, 1));
    expect(deleted).toBe(1012);
    expect(db.$executeRaw).toHaveBeenCalledTimes(2);
    const cutoff = db.$executeRaw.mock.calls[0]![0].values[0] as Date;
    expect(cutoff.toISOString()).toBe(new Date(Date.UTC(2027, 0, 1) - 400 * 86_400_000).toISOString());
  });
});
