import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { issueAnalyticsToken } from '../services/analytics-token.js';

const db = vi.hoisted(() => ({ analyticsEvent: { createMany: vi.fn() }, $executeRaw: vi.fn() }));
const logger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../utils/logger.js', () => ({ logger, logSafely: vi.fn() }));

import analyticsEventRoutes from './analytics-events.routes.js';

const CORRELATION = '6d1b8f0e-2c3a-4e5f-8a9b-0c1d2e3f4a5b';
const P1 = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const P2 = '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11';

const app = express();
app.use(express.json());
app.use('/api', analyticsEventRoutes);

const token = () => issueAnalyticsToken({ correlationId: CORRELATION, productIds: [P1, P2] });
const body = (overrides: Record<string, unknown> = {}) => ({ type: 'image_search.result_selected', token: token(), productId: P1, ...overrides });

beforeEach(() => {
  vi.clearAllMocks();
  db.analyticsEvent.createMany.mockResolvedValue({ count: 1 });
  db.$executeRaw.mockResolvedValue(1);
});

describe('POST /api/analytics/events', () => {
  it('accepts a selection of a product from the signed result list with 202', async () => {
    const response = await request(app).post('/api/analytics/events').send(body());
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ accepted: true });
    expect(db.analyticsEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true,
      data: [expect.objectContaining({ type: 'image_search.result_selected', idempotencyKey: `iss:${CORRELATION}:${P1}` })] }));
  });

  it('answers a duplicate submission with 202 as well (dedupe happens in storage)', async () => {
    db.analyticsEvent.createMany.mockResolvedValue({ count: 0 });
    const first = await request(app).post('/api/analytics/events').send(body());
    const second = await request(app).post('/api/analytics/events').send(body());
    expect([first.status, second.status]).toEqual([202, 202]);
  });

  it('rejects unknown event types and any other client-supplied event without writing', async () => {
    for (const type of ['image_search.completed', 'payment.succeeded', 'order.paid', 'recommendation.impression']) {
      expect((await request(app).post('/api/analytics/events').send(body({ type }))).status, type).toBe(400);
    }
    expect(db.analyticsEvent.createMany).not.toHaveBeenCalled();
  });

  it('rejects extra fields (for example a client-chosen outcome, count, price or user) with 400', async () => {
    for (const extra of [{ outcome: 'COMPLETED' }, { resultCount: 99 }, { userId: P2 }, { amount: '1.00' }, { source: 'SERVER' }]) {
      const response = await request(app).post('/api/analytics/events').send(body(extra));
      expect(response.status, JSON.stringify(extra)).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
    expect(db.analyticsEvent.createMany).not.toHaveBeenCalled();
  });

  it('rejects a malformed product id, a missing token and an oversized token', async () => {
    expect((await request(app).post('/api/analytics/events').send(body({ productId: 'not-a-uuid' }))).status).toBe(400);
    expect((await request(app).post('/api/analytics/events').send(body({ token: undefined }))).status).toBe(400);
    expect((await request(app).post('/api/analytics/events').send(body({ token: 'a'.repeat(5000) }))).status).toBe(400);
    expect(db.analyticsEvent.createMany).not.toHaveBeenCalled();
  });

  it('rejects a forged token with INVALID_ANALYTICS_TOKEN and a product outside the signed result list', async () => {
    const forged = await request(app).post('/api/analytics/events').send(body({ token: `${token().split('.')[0]}.forged` }));
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe('INVALID_ANALYTICS_TOKEN');
    const outside = await request(app).post('/api/analytics/events').send(body({ productId: '3e7dd3c4-7b2f-4c9b-9f6a-4d0f3b2c1e33' }));
    expect(outside.status).toBe(400);
    expect(db.analyticsEvent.createMany).not.toHaveBeenCalled();
  });

  it('answers 503 without details when storage is unavailable, and never fails loudly to the customer', async () => {
    db.analyticsEvent.createMany.mockRejectedValue(new Error('connect ECONNREFUSED postgres://u:p@db.internal'));
    const response = await request(app).post('/api/analytics/events').send(body());
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: { code: 'ANALYTICS_UNAVAILABLE', message: expect.any(String) } });
    expect(JSON.stringify(response.body)).not.toContain('db.internal');
  });

  describe('storefront.session', () => {
    const SESSION = '0b7c4f1e-9a2d-4c3b-8e5f-6a7b8c9d0e1f';
    const session = (overrides: Record<string, unknown> = {}) => ({ type: 'storefront.session', sessionId: SESSION, visibleMs: 272_400, ...overrides });

    it('records a tab session keyed by its random id, keeping the largest reported total', async () => {
      const response = await request(app).post('/api/analytics/events').send(session());
      expect(response.status).toBe(202);
      const sql = db.$executeRaw.mock.calls[0]![0] as { strings: string[]; values: unknown[] };
      expect(sql.strings.join('?')).toContain('ON CONFLICT ("idempotencyKey") DO UPDATE SET "durationMs" = GREATEST(');
      expect(sql.values).toEqual(expect.arrayContaining(['storefront.session', SESSION, 272_400, `ses:${SESSION}`]));
    });

    it('rejects identities, URLs, out-of-range durations and non-uuid ids without writing', async () => {
      for (const bad of [{ userId: P1 }, { path: '/account' }, { visibleMs: -1 }, { visibleMs: 4 * 3_600_000 + 1 }, { visibleMs: 1.5 }, { sessionId: 'abc' }]) {
        expect((await request(app).post('/api/analytics/events').send(session(bad))).status, JSON.stringify(bad)).toBe(400);
      }
      expect(db.$executeRaw).not.toHaveBeenCalled();
    });

    it('answers 503 without details when storage fails', async () => {
      db.$executeRaw.mockRejectedValue(new Error('connection refused at 10.0.0.1'));
      const response = await request(app).post('/api/analytics/events').send(session());
      expect(response.status).toBe(503);
      expect(JSON.stringify(response.body)).not.toContain('10.0.0.1');
    });
  });

  it('limits ingestion to 60 requests per minute per client', async () => {
    db.analyticsEvent.createMany.mockResolvedValue({ count: 0 });
    let last = 0;
    for (let attempt = 0; attempt < 61; attempt++) {
      last = (await request(app).post('/api/analytics/events').send(body())).status;
    }
    expect(last).toBe(429);
  });
});
