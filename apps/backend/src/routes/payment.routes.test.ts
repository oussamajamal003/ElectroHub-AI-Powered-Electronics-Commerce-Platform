import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import routes from './payment.routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { generateAccessToken } from '../utils/jwt.js';
import { paymentService, PaymentSetupBlockedError } from '../services/payment.service.js';
import { requestId } from '../middleware/requestId.js';
import { logger } from '../utils/logger.js';
import { sanitize } from '../utils/logger.js';

const ids = vi.hoisted(() => ({ user: '11111111-1111-4111-8111-111111111111', attempt: '22222222-2222-4222-8222-222222222222',
  cart: '33333333-3333-4333-8333-333333333333', product: '44444444-4444-4444-8444-444444444444' }));
const db = vi.hoisted(() => ({ user: { findFirst: vi.fn() }, cart: { findUnique: vi.fn() },
  paymentAttempt: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../services/stripe.provider.js', () => ({ stripeProvider: { account: async () => 'acct_test', retrieve: async () => {
  throw new Error('No provider access expected in API validation tests');
} } }));
vi.mock('../services/cart.service.js', () => ({ MAX_CART_LINES: 50, MAX_CART_QUANTITY: 999,
  currentCart: async () => ({ data: { revision: 'a'.repeat(64), subtotal: '19.99', items: [{ productId: ids.product, quantity: 1 }], canCheckout: true },
    products: new Map([[ids.product, { price: new Prisma.Decimal('19.99'), name: 'Snapshot Product', sku: 'SNAPSHOT', images: [{ url: '/image.jpg' }] }]]) }) }));
const app = express(); app.use(requestId); app.use(express.json()); app.use('/api', routes); app.use(errorHandler);
const token = (role = 'CUSTOMER') => generateAccessToken({ userId: ids.user, role });
const body = { shipping: { recipient: 'Test Customer', line1: '123 Test Street', city: 'Test City', postalCode: '12345', country: 'United States', phone: '+1 555 010 2000' },
  deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: 'a'.repeat(64) };
const post = (value: object = body, key = ids.attempt) => request(app).post('/api/checkout/payment-attempts').auth(token(), { type: 'bearer' }).set('Idempotency-Key', key).send(value);
beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks();
  db.user.findFirst.mockResolvedValue({ id: ids.user, role: { name: 'CUSTOMER' } });
  db.cart.findUnique.mockResolvedValue({ id: ids.cart });
  db.$queryRaw.mockImplementation(async (sql: Prisma.Sql) =>
    sql.sql.includes('"payment_attempts"') || sql.sql.includes('"payment_work"') ? [] : [{ id: ids.cart }]);
  db.paymentAttempt.findFirst.mockResolvedValue(null); db.paymentAttempt.findUnique.mockResolvedValue(null);
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
});
describe('Owned payment API boundaries (actual service validation; mocked persistence)', () => {
  it.each(['P2024', 'P2028'])('correlates and safely reports setup failure %s without exposing database details', async code => {
    const prismaError = new Prisma.PrismaClientKnownRequestError('private SQL / parameter detail', { code, clientVersion: 'test' });
    vi.spyOn(paymentService, 'setup').mockRejectedValue(prismaError);
    const errors = vi.spyOn(logger, 'error');
    const infos = vi.spyOn(logger, 'info');
    const requestId = `setup_${code}`;
    const response = await request(app).post('/api/checkout/payment-attempts').auth(token(), { type: 'bearer' })
      .set('X-Request-ID', requestId).set('Idempotency-Key', ids.attempt).send(body);
    expect(response.status).toBe(503);
    expect(response.headers['x-request-id']).toBe(requestId);
    expect(response.body.error).toEqual({ code: 'PAYMENT_UNAVAILABLE',
      message: 'Payment is temporarily unavailable. Your existing attempt can be recovered safely.' });
    const errorCalls: readonly (readonly unknown[])[] = errors.mock.calls;
    const handled = errorCalls.map(call => call[1] as Record<string, unknown>)
      .find(fields => fields.operation === 'http.handled_error');
    const safeCause = sanitize(handled?.error);
    expect(safeCause).toEqual(expect.objectContaining({ errorType: 'PrismaClientKnownRequestError', code }));
    expect(JSON.stringify(safeCause)).not.toContain('private SQL');
    const infoCalls: readonly (readonly unknown[])[] = infos.mock.calls;
    const performance = infoCalls.map(call => call[1] as Record<string, unknown>)
      .find(fields => fields.event === 'payment.setup.http_performance');
    expect(performance).toEqual(expect.objectContaining({ correlationId: requestId, statusCode: 503, stage: 'setup' }));
    expect(db.paymentAttempt.create).not.toHaveBeenCalled();
  });
  it('returns the safe setup error even if the error-log call throws synchronously', async () => {
    vi.spyOn(paymentService, 'setup').mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('private SQL detail', { code: 'P2024', clientVersion: 'test' }));
    const log = vi.spyOn(logger, 'error').mockImplementation(() => { throw new Error('log sink unavailable'); });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const response = await post();
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('PAYMENT_UNAVAILABLE');
      expect(stderr).toHaveBeenCalled();
      expect(stderr.mock.calls.join(' ')).not.toContain('private SQL detail');
      expect(stderr.mock.calls.join(' ')).not.toContain('log sink unavailable');
    } finally { log.mockRestore(); stderr.mockRestore(); }
  });
  it('returns only owned blocker metadata and preserves the no-store setup response', async () => {
    vi.spyOn(paymentService, 'setup').mockRejectedValue(new PaymentSetupBlockedError({ attemptId: ids.attempt,
      state: 'AUTHORIZED', workState: 'LEASED', lease: 'active' }));
    const response = await post();
    expect(response.status).toBe(409); expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.error).toEqual({ code: 'PAYMENT_RECOVERY_PENDING',
      message: 'An existing payment is unresolved. Checking its status before starting another payment.',
      recovery: { attemptId: ids.attempt, state: 'AUTHORIZED', workState: 'LEASED', lease: 'active' } });
    expect(JSON.stringify(response.body)).not.toMatch(/leaseToken|clientSecret|shipping/);
  });
  it('correlates authenticated setup timings without logging customer or credential values', async () => {
    const logs = vi.spyOn(logger, 'info');
    const response = await request(app).post('/api/checkout/payment-attempts').auth(token(), { type: 'bearer' })
      .set('X-Request-ID', 'setup-timing-route').set('Idempotency-Key', ids.attempt).send({ ...body, amount: 'untrusted' });
    expect(response.status).toBe(400); expect(response.headers['x-request-id']).toBe('setup-timing-route');
    const calls: readonly (readonly unknown[])[] = logs.mock.calls;
    const measurement = calls.map(call => call[1]).find(value => value && typeof value === 'object' && Reflect.get(value, 'event') === 'payment.setup.http_performance');
    expect(measurement).toEqual(expect.objectContaining({ correlationId: 'setup-timing-route', statusCode: 400, authMiddlewareMs: expect.any(Number), totalBackendMs: expect.any(Number) }));
    expect(JSON.stringify(measurement)).not.toContain(ids.user); expect(JSON.stringify(measurement)).not.toContain('untrusted');
    expect(db.paymentAttempt.create).not.toHaveBeenCalled();
  });
  it('uses verified identity for rate-limit headers when socket IP is unavailable', async () => {
    const detached = express();
    detached.use((req, _res, next) => { Object.defineProperty(req, 'ip', { value: undefined }); next(); });
    detached.use(express.json()); detached.use('/api', routes); detached.use(errorHandler);
    const response = await request(detached).get(`/api/checkout/payment-attempts/${ids.attempt}`).auth(token(), { type: 'bearer' });
    expect(response.status).toBe(404);
    expect(response.headers.ratelimit).toBeDefined();
    expect(response.body.error.code).toBe('PAYMENT_ATTEMPT_NOT_FOUND');
  });
  it('rejects guest and database-confirmed Admin access before setup', async () => {
    expect((await request(app).post('/api/checkout/payment-attempts').send(body)).status).toBe(401);
    db.user.findFirst.mockResolvedValue({ id: ids.user, role: { name: 'ADMIN' } });
    expect((await post()).status).toBe(403); expect(db.paymentAttempt.create).not.toHaveBeenCalled();
  });
  it.each(['amount', 'total', 'shippingPrice', 'userId', 'stock', 'paymentStatus', 'providerIntentId', 'clientSecret'])('rejects client authority field %s before writes', async field => {
    const result = await post({ ...body, [field]: 'untrusted' }); expect(result.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled(); expect(db.paymentAttempt.create).not.toHaveBeenCalled();
  });
  it('rejects missing or invalid keys, unsupported payment/delivery and invalid shipping', async () => {
    for (const [value, key] of [[body, 'invalid'], [{ ...body, paymentMethod: 'PAYPAL' }, ids.attempt],
      [{ ...body, deliveryMethod: 'CUSTOM' }, ids.attempt], [{ ...body, shipping: { ...body.shipping, recipient: ' ' } }, ids.attempt]] as const) {
      expect((await post(value, key)).status).toBe(400);
    }
    expect(db.paymentAttempt.create).not.toHaveBeenCalled();
  });
  describe('POST /checkout/payment-attempts/:attemptId/dismiss', () => {
    const dismiss = (id = ids.attempt) => request(app).post(`/api/checkout/payment-attempts/${id}/dismiss`);
    const owned = (patch: object = {}) => db.paymentAttempt.findFirst.mockResolvedValue({ id: ids.attempt, state: 'DECLINED', orderId: null,
      submittedAt: new Date(), dismissedAt: null, work: null, ...patch });
    it('requires a session', async () => {
      const response = await dismiss().send({});
      expect(response.status).toBe(401);
      expect(db.paymentAttempt.findFirst).not.toHaveBeenCalled(); expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
    });
    it('returns 404 for an attempt the customer does not own or that does not exist, without writing', async () => {
      const response = await dismiss().auth(token(), { type: 'bearer' }).send({});
      expect(response.status).toBe(404); expect(response.body.error.code).toBe('PAYMENT_ATTEMPT_NOT_FOUND');
      expect(db.paymentAttempt.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ids.attempt, userId: ids.user } }));
      expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
    });
    it.each([['PAID', { state: 'PAID', orderId: 'order-1' }], ['still awaiting card input', { state: 'AWAITING_INPUT' }],
      ['not submitted', { submittedAt: null }], ['being worked by a recovery worker', { work: { state: 'LEASED', lastError: null } }]])(
      'returns 409 for an ineligible attempt (%s) without writing', async (_label, patch) => {
        owned(patch);
        const response = await dismiss().auth(token(), { type: 'bearer' }).send({});
        expect(response.status).toBe(409); expect(response.body.error.code).toBe('PAYMENT_NOT_DISMISSIBLE');
        expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
      });
    it('hides only a failed attempt, scoped to the verified customer, changing nothing but dismissedAt', async () => {
      owned(); db.paymentAttempt.updateMany.mockResolvedValue({ count: 1 });
      const response = await dismiss().auth(token(), { type: 'bearer' }).send({});
      expect(response.status).toBe(200); expect(response.body.data.attemptId).toBe(ids.attempt);
      expect(typeof response.body.data.dismissedAt).toBe('string');
      expect(db.paymentAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: ids.attempt, userId: ids.user, dismissedAt: null, orderId: null }), data: { dismissedAt: expect.any(Date) } }));
    });
    it('is idempotent for an already dismissed attempt', async () => {
      owned({ dismissedAt: new Date('2026-10-15T10:00:00.000Z') });
      const response = await dismiss().auth(token(), { type: 'bearer' }).send({});
      expect(response.status).toBe(200); expect(response.body.data.dismissedAt).toBe('2026-10-15T10:00:00.000Z');
      expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
    });
  });
  it('scopes status reads to the verified customer and hides foreign attempts', async () => {
    const response = await request(app).get(`/api/checkout/payment-attempts/${ids.attempt}`).auth(token(), { type: 'bearer' });
    expect(response.status).toBe(404); expect(response.headers['cache-control']).toBe('no-store');
    expect(db.paymentAttempt.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ids.attempt, userId: ids.user } }));
  });
  it('rejects changed same-key requests and competing active Cart attempts', async () => {
    db.paymentAttempt.findUnique.mockResolvedValue({ requestHash: 'different' });
    expect((await post()).body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    db.paymentAttempt.findUnique.mockResolvedValue(null); db.paymentAttempt.findFirst.mockResolvedValue({ id: 'competing' });
    expect((await post()).body.error.code).toBe('PAYMENT_RECOVERY_PENDING'); expect(db.paymentAttempt.create).not.toHaveBeenCalled();
  });
  it('stores server-owned totals and immutable snapshots without purchasing', async () => {
    const process = vi.spyOn(paymentService, 'process').mockResolvedValue(null);
    db.paymentAttempt.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: ids.attempt }));
    db.paymentAttempt.findFirst.mockResolvedValue({ id: ids.attempt, state: 'PREPARING', providerIntentId: null, cancelRequested: false,
      total: new Prisma.Decimal('19.99'), currency: 'USD', orderId: null, providerStatus: null, failureCode: null, recoveryRemainder: null });
    // Active-attempt lookup is inside the transaction; owner status reads occur afterward.
    db.paymentAttempt.findFirst.mockResolvedValueOnce(null);
    const response = await post(); expect(response.status).toBe(202); expect(response.body.data.clientSecret).toBeNull();
    expect(db.paymentAttempt.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amountCents: 1999,
      total: '19.99', userId: ids.user, stripeAccountId: 'acct_test', work: { create: { nextRunAt: expect.any(Date) } },
      items: { create: [expect.objectContaining({ productId: ids.product, quantity: 1, sku: 'SNAPSHOT', imageUrl: '/image.jpg' })] } }) }));
    expect(process).toHaveBeenCalledWith(ids.attempt, expect.any(Function)); expect(response.body.data.committed).toBe(false);
  });
  it('rejects arbitrary reconcile flags instead of trusting browser success', async () => {
    const response = await request(app).post(`/api/checkout/payment-attempts/${ids.attempt}/reconcile`).auth(token(), { type: 'bearer' }).send({ paid: true });
    expect(response.status).toBe(400); expect(db.paymentAttempt.findFirst).not.toHaveBeenCalled();
  });
});

// P0: the UI must learn up front that payment writes are disabled (payment isolation) instead of discovering it from a 503.
describe('GET /api/checkout/payment-capability', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/checkout/payment-capability')).status).toBe(401);
  });
  it('reports only a boolean, never the database or environment identity', async () => {
    db.user.findFirst.mockResolvedValue({ id: ids.user, isActive: true, deletedAt: null, role: { name: 'CUSTOMER' }, tokenVersion: 0 });
    const response = await request(app).get('/api/checkout/payment-capability').auth(token(), { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(Object.keys(response.body.data)).toEqual(['paymentsEnabled']);
    expect(typeof response.body.data.paymentsEnabled).toBe('boolean');
    expect(JSON.stringify(response.body)).not.toMatch(/supabase|localhost|postgres|electrohub_/i);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
