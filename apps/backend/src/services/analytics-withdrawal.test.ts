import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { issueAnalyticsToken } from './analytics-token.js';

const db = vi.hoisted(() => ({ analyticsEvent: { createMany: vi.fn(), deleteMany: vi.fn() }, $executeRaw: vi.fn() }));
const logger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../utils/logger.js', () => ({ logger, logSafely: vi.fn() }));

import { recordImageSearchCompleted, recordImageSearchFailed, recordImageSearchSelection } from './analytics-events.service.js';
import { bindAnalyticsRef, isAnalyticsRefRevoked, resetAnalyticsWithdrawalsForTests, WITHDRAWAL_TTL_MS } from './analytics-withdrawal.js';
import analyticsEventRoutes from '../routes/analytics-events.routes.js';

const REF = '0b4f2d1e-6a7c-4e8f-9a0b-1c2d3e4f5a6b';
const OTHER_REF = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';
const CORRELATION = '6d1b8f0e-2c3a-4e5f-8a9b-0c1d2e3f4a5b';
const OTHER_CORRELATION = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';
const PRODUCT = '8f2813b4-a388-44d3-b51e-5d4c40386677';

const app = express();
app.use(express.json());
app.use('/api', analyticsEventRoutes);
const withdraw = (refs: unknown) => request(app).post('/api/analytics/withdrawals').send({ refs });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const erasedCorrelation = (correlationId: string) => expect(db.analyticsEvent.deleteMany).toHaveBeenCalledWith({
  where: { correlationId, type: { in: ['image_search.completed', 'image_search.failed', 'image_search.result_selected'] } } });

beforeEach(() => {
  vi.clearAllMocks();
  resetAnalyticsWithdrawalsForTests();
  db.analyticsEvent.createMany.mockResolvedValue({ count: 1 });
  db.analyticsEvent.deleteMany.mockResolvedValue({ count: 1 });
});

describe('Task 06.2 in-flight image-search analytics withdrawal', () => {
  it('withdrawal before completion: the outcome is never written', async () => {
    bindAnalyticsRef(REF, CORRELATION);
    expect((await withdraw([REF])).status).toBe(202);
    recordImageSearchCompleted({ correlationId: CORRELATION, resultCount: 3, durationMs: 10, ref: REF });
    recordImageSearchFailed({ correlationId: CORRELATION, category: 'failed', durationMs: 10, ref: REF });
    await flush();
    expect(db.analyticsEvent.createMany).not.toHaveBeenCalled();
  });

  it('withdrawal while the write is in flight: the committed row is erased right after', async () => {
    bindAnalyticsRef(REF, CORRELATION);
    let commit!: (value: { count: number }) => void;
    db.analyticsEvent.createMany.mockReturnValueOnce(new Promise(resolve => { commit = resolve; }));
    recordImageSearchCompleted({ correlationId: CORRELATION, resultCount: 3, durationMs: 10, ref: REF });
    await flush();
    expect(db.analyticsEvent.createMany).toHaveBeenCalledOnce();
    expect((await withdraw([REF])).status).toBe(202); // the erase it issues finds nothing yet
    commit({ count: 1 });
    await vi.waitFor(() => expect(db.analyticsEvent.deleteMany).toHaveBeenCalledTimes(2));
    erasedCorrelation(CORRELATION);
  });

  it('withdrawal just after completion (response still in transit): the written row is erased', async () => {
    bindAnalyticsRef(REF, CORRELATION);
    recordImageSearchCompleted({ correlationId: CORRELATION, resultCount: 3, durationMs: 10, ref: REF });
    await flush();
    expect(db.analyticsEvent.deleteMany).not.toHaveBeenCalled();
    expect((await withdraw([REF.toUpperCase()])).status).toBe(202);
    erasedCorrelation(CORRELATION);
  });

  it('a selection token of a withdrawn search is refused, including one sent after re-consent', async () => {
    bindAnalyticsRef(REF, CORRELATION);
    await withdraw([REF]);
    const token = issueAnalyticsToken({ correlationId: CORRELATION, productIds: [PRODUCT] });
    expect(await recordImageSearchSelection({ token, productId: PRODUCT })).toEqual({ accepted: false, reason: 'INVALID_TOKEN' });
    const response = await request(app).post('/api/analytics/events').send({ type: 'image_search.result_selected', token, productId: PRODUCT });
    expect(response.status).toBe(400);
    expect(db.analyticsEvent.createMany).not.toHaveBeenCalled();
  });

  it('only the withdrawn search is affected: a new consented search (re-consent) is recorded normally', async () => {
    bindAnalyticsRef(REF, CORRELATION);
    await withdraw([REF]);
    bindAnalyticsRef(OTHER_REF, OTHER_CORRELATION);
    recordImageSearchCompleted({ correlationId: OTHER_CORRELATION, resultCount: 1, durationMs: 10, ref: OTHER_REF });
    await flush();
    expect(db.analyticsEvent.createMany).toHaveBeenCalledOnce();
    expect(db.analyticsEvent.deleteMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ correlationId: OTHER_CORRELATION }) }));
    const token = issueAnalyticsToken({ correlationId: OTHER_CORRELATION, productIds: [PRODUCT] });
    expect(await recordImageSearchSelection({ token, productId: PRODUCT })).toEqual({ accepted: true });
  });

  it('a withdrawal that arrives before the server bound the search still blocks it (retry/ordering)', async () => {
    await withdraw([REF]);
    bindAnalyticsRef(REF, CORRELATION);
    expect(isAnalyticsRefRevoked(REF)).toBe(true);
    const token = issueAnalyticsToken({ correlationId: CORRELATION, productIds: [PRODUCT] });
    expect((await recordImageSearchSelection({ token, productId: PRODUCT })).accepted).toBe(false);
  });

  it('duplicate withdrawals are idempotent and unknown references answer the same 202 (no existence oracle)', async () => {
    bindAnalyticsRef(REF, CORRELATION);
    const first = await withdraw([REF, REF]);
    const second = await withdraw([REF]);
    const unknown = await withdraw([OTHER_REF]);
    expect([first.status, second.status, unknown.status]).toEqual([202, 202, 202]);
    expect(unknown.body).toEqual(first.body);
  });

  it('a withdrawal expires with the selection-token lifetime', () => {
    const now = Date.now();
    bindAnalyticsRef(REF, CORRELATION, now);
    return withdraw([REF]).then(() => {
      expect(isAnalyticsRefRevoked(REF, now + WITHDRAWAL_TTL_MS + 60_000)).toBe(false);
    });
  });

  it('validates the body strictly', async () => {
    for (const body of [undefined, [], ['not-a-uuid'], Array(17).fill(REF)]) expect((await withdraw(body)).status).toBe(400);
    expect((await request(app).post('/api/analytics/withdrawals').send({ refs: [REF], extra: 1 })).status).toBe(400);
  });

  it('answers 503 without details when an existing row cannot be erased', async () => {
    bindAnalyticsRef(REF, CORRELATION);
    db.analyticsEvent.deleteMany.mockRejectedValue(new Error('connect ECONNREFUSED postgres://u:p@db.internal'));
    const response = await withdraw([REF]);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('postgres');
    expect(logger.warn).toHaveBeenCalledWith('ANALYTICS_WITHDRAWAL_ERASE_FAILED', expect.not.objectContaining({ message: expect.anything() }));
  });
});
