import express from 'express';
import request from 'supertest';
import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import routes from './stripe-webhook.routes.js';
import { errorHandler } from '../middleware/errorHandler.js';

const state = vi.hoisted(() => ({ secret: 'whsec_disposable_unit_test', account: 'acct_test' }));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
const audit = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }));
vi.mock('../utils/logger.js', () => ({ logger: audit, logSafely: vi.fn() }));
vi.mock('../config/env.js', () => ({ env: { STRIPE_WEBHOOK_SECRET: state.secret, NODE_ENV: 'test' } }));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../services/stripe.provider.js', () => ({ stripeProvider: { sdk: () => new Stripe('sk_test_disposable'), account: async () => state.account } }));
const app = express(); app.use(routes); app.use(express.json()); app.use(errorHandler);
const event = (extra: object = {}) => JSON.stringify({ id: 'evt_test', type: 'payment_intent.succeeded', livemode: false,
  data: { object: { id: 'pi_test', object: 'payment_intent' } }, ...extra });
const send = (payload: string, signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: state.secret })) =>
  request(app).post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', signature).send(payload);
beforeEach(() => {
  vi.resetAllMocks(); db.$queryRaw.mockResolvedValue([{inserted:1,scheduled:1,existingDisposition:null,mismatch:false}]);
});
describe('Raw signed webhook ingestion (mocked persistence, genuine signature verification)', () => {
  it.each(['ACCEPTED', 'IGNORED', 'REJECTED'])('classifies existing %s without scheduling work', async disposition => {
    db.$queryRaw.mockResolvedValue([{inserted:0,scheduled:0,existingDisposition:disposition,mismatch:false}]);
    const response = await send(event()); expect(response.status).toBe(200);
    const finished = audit.info.mock.calls.find(call => call[1]?.phase === 'response')?.[1];
    expect(finished.status).toBe(200); expect(finished.scheduled).toBe(0);
    expect(finished.outcome).toBe(`DUPLICATE_${disposition}`);
    expect(response.headers['x-webhook-correlation-id']).toBe(finished.correlationId);
  });
  it('does not acknowledge a concurrent conflict invisible to the SQL snapshot', async () => {
    db.$queryRaw.mockResolvedValue([{inserted:0,scheduled:0,existingDisposition:null,mismatch:false}]);
    expect((await send(event())).status).toBe(503);
    expect(audit.info.mock.calls.some(call => call[1]?.outcome === 'DUPLICATE_PENDING')).toBe(true);
  });
  it('rejects conflicting duplicate binding without changing persisted work', async () => {
    db.$queryRaw.mockResolvedValue([{inserted:0,scheduled:0,existingDisposition:'ACCEPTED',mismatch:true}]);
    expect((await send(event())).status).toBe(409);
    expect(audit.info.mock.calls.some(call => call[1]?.outcome === 'BINDING_MISMATCH')).toBe(true);
  });
  it('never attributes an invalid signature to the claimed provider event or leaks payload', async () => {
    const response = await send(event({customer:'private-person',client_secret:'sensitive-secret'}), 'bad');
    expect(response.status).toBe(400);
    expect(audit.info.mock.calls.every(call => !call[1]?.eventId)).toBe(true);
    expect(JSON.stringify(audit.info.mock.calls)).not.toMatch(/private-person|sensitive-secret|whsec_|sk_test_/);
  });
  it('records database failure and actual HTTP status without internal errors', async () => {
    db.$queryRaw.mockRejectedValue(new Error('password=private_database_error'));
    expect((await send(event())).status).toBe(503);
    const finished = audit.info.mock.calls.find(call => call[1]?.phase === 'response')?.[1];
    expect(finished.database).toBe('FAILED'); expect(finished.status).toBe(503);
    expect(JSON.stringify(audit.info.mock.calls)).not.toContain('private_database_error');
  });
  it('logging transport failure does not change durable acceptance', async () => {
    audit.info.mockImplementation(() => { throw new Error('sink failure'); });
    expect((await send(event())).status).toBe(200);
  });
  it('concurrent signed requests each expose their atomic persistence outcome', async () => {
    db.$queryRaw.mockResolvedValueOnce([{inserted:1,scheduled:1,existingDisposition:null,mismatch:false}])
      .mockResolvedValueOnce([{inserted:0,scheduled:0,existingDisposition:'ACCEPTED',mismatch:false}]);
    const results = await Promise.all([send(event()),send(event())]);
    expect(results.map(r => r.status)).toEqual([200,200]);
    const completed = audit.info.mock.calls.filter(call => call[1]?.phase === 'database').map(call => call[1]);
    expect(completed.reduce((sum,row) => sum + row.scheduled,0)).toBe(1);
    expect(new Set(completed.map(row => row.correlationId)).size).toBe(2);
  });
  it('accepts original signed bytes and atomically stores event identity plus work', async () => {
    expect((await send(event())).status).toBe(200);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    const statement = db.$queryRaw.mock.calls[0]?.[0];
    expect(statement.values).toEqual(expect.arrayContaining(['evt_test', 'payment_intent.succeeded', 'pi_test', true]));
    expect(statement.text).toContain('INSERT INTO "stripe_events"');
    expect(statement.text).toContain('UPDATE "payment_work"');
    expect(statement.text).toContain('FOR KEY SHARE');
  });
  it('timestamps event receipt and wakes work on the application clock, never the session time zone', async () => {
    // Real PostgreSQL 17 acceptance (2026-10-15): CURRENT_TIMESTAMP in these timestamp-without-time-zone columns followed a
    // UTC+3 session TimeZone, so a signed webhook scheduled PaymentWork three hours in the future.
    const before = Date.now();
    expect((await send(event())).status).toBe(200);
    const after = Date.now();
    const statement = db.$queryRaw.mock.calls[0]?.[0];
    expect(statement.text).not.toMatch(/CURRENT_TIMESTAMP|now()|LOCALTIMESTAMP/i);
    const stamps = statement.values.filter((value: unknown): value is Date => value instanceof Date);
    expect(stamps).toHaveLength(3);
    expect(new Set(stamps.map((stamp: Date) => stamp.getTime())).size).toBe(1);
    expect(stamps[0].getTime()).toBeGreaterThanOrEqual(before); expect(stamps[0].getTime()).toBeLessThanOrEqual(after);
  });
  it('rejects missing, invalid, altered and stale signatures before any writes', async () => {
    const payload = event();
    for (const signature of ['', 'bad', Stripe.webhooks.generateTestHeaderString({ payload: `${payload} `, secret: state.secret }),
      Stripe.webhooks.generateTestHeaderString({ payload, secret: state.secret, timestamp: 1 })]) {
      expect((await send(payload, signature)).status).toBe(400);
    }
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it.each([{ livemode: true }, { account: 'acct_other' }])('rejects wrong environment %j', async extra => {
    expect((await send(event(extra))).status).toBe(400); expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('acknowledges a duplicate event without applying any financial operation', async () => {
    db.$queryRaw.mockResolvedValue([{inserted:0,scheduled:0,existingDisposition:'ACCEPTED',mismatch:false}]);
    expect((await send(event())).status).toBe(200);
    expect(db.$queryRaw.mock.calls[0]?.[0].text).toContain('ON CONFLICT ("id") DO NOTHING');
  });
  it('records unsupported or unbound events without waking a purchase', async () => {
    expect((await send(event({ type: 'customer.created' }))).status).toBe(200);
    expect(db.$queryRaw.mock.calls[0]?.[0].values).toContain(false);
    expect(db.$queryRaw.mock.calls[0]?.[0].text).toContain("THEN 'IGNORED' ELSE 'ACCEPTED'");
  });
  it('returns retryable failure when durable acceptance fails', async () => {
    db.$queryRaw.mockRejectedValue(new Error('database unavailable'));
    const response = await send(event()); expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('WEBHOOK_ACCEPTANCE_FAILED'); expect(JSON.stringify(response.body)).not.toContain('database unavailable');
  });
  it('rejects malformed signed JSON and oversized bodies before database work', async () => {
    expect((await send('{invalid-json')).status).toBe(400);
    const oversized = await send('x'.repeat(256 * 1024 + 1));
    expect(oversized.status).toBe(413); expect(oversized.body.error.code).toBe('WEBHOOK_BODY_TOO_LARGE');
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('rejects reserialized JSON signed for different original bytes', async () => {
    const original = event(); const signature = Stripe.webhooks.generateTestHeaderString({ payload: original, secret: state.secret });
    expect((await send(JSON.stringify(JSON.parse(original), null, 2), signature)).status).toBe(400);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('accepts delayed event order without trusting amount or retaining raw provider fields', async () => {
    for (const type of ['payment_intent.succeeded', 'payment_intent.amount_capturable_updated']) {
      const payload = event({ type, data: { object: { id: 'pi_test', object: 'payment_intent', amount: 1, currency: 'eur', client_secret: 'sensitive_fixture_marker' } } });
      expect((await send(payload)).status).toBe(200);
    }
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(db.$queryRaw.mock.calls.map(call => call[0].values))).not.toContain('sensitive_fixture_marker');
    expect(JSON.stringify(db.$queryRaw.mock.calls.map(call => call[0].values))).not.toContain('eur');
  });
  it('retries the exact event identity after unavailable durable acceptance', async () => {
    db.$queryRaw.mockRejectedValueOnce(new Error('Controlled database failure'));
    const payload = event(); expect((await send(payload)).status).toBe(503); expect((await send(payload)).status).toBe(200);
    // Identity values are identical; only the per-delivery receipt time (application clock) differs.
    const identity = (values: unknown[]) => values.filter(value => !(value instanceof Date));
    expect(identity(db.$queryRaw.mock.calls[0]?.[0].values)).toEqual(identity(db.$queryRaw.mock.calls[1]?.[0].values));
  });
});

// Task 03.6 isolation gate: a backend that may not mutate its payment target never ingests a webhook (Stripe retries the 503).
it('refuses webhook ingestion before any database write when payment mutations are disabled', async () => {
  const { createStripeWebhookRouter } = await import('./stripe-webhook.routes.js');
  const isolated = express();
  isolated.use(createStripeWebhookRouter({ database: db as never, webhookSecret: state.secret, account: async () => state.account,
    isolation: () => ({ allowed: false, target: 'shared', identity: 'x', reason: 'watched-dev-server-on-shared-target' }) }));
  isolated.use(errorHandler);
  const payload = event();
  const response = await request(isolated).post('/api/webhooks/stripe').set('Content-Type', 'application/json')
    .set('Stripe-Signature', Stripe.webhooks.generateTestHeaderString({ payload, secret: state.secret })).send(payload);
  expect(response.status).toBe(503); expect(db.$queryRaw).not.toHaveBeenCalled();
});
