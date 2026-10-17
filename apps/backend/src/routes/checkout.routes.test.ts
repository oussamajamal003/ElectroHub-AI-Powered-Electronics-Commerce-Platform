import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import checkoutRoutes from './checkout.routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { generateAccessToken } from '../utils/jwt.js';
import { cartRevision, requestHash } from '../services/checkout.domain.js';
import { OrderService } from '../services/order.service.js';
import type { ProviderIntent } from '../services/payment.domain.js';

const state = vi.hoisted(() => ({ userId: '11111111-1111-4111-8111-111111111111', cartId: '22222222-2222-4222-8222-222222222222',
  productId: '33333333-3333-4333-8333-333333333333', categoryId: '44444444-4444-4444-8444-444444444444', quantity: 2, stock: 5, active: true, inventory: true, role: 'CUSTOMER',
  attemptRequest: null as unknown, attemptRequestHash: '' }));
const diagnosticsLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
const db = vi.hoisted(() => ({ user: { findFirst: vi.fn() }, cart: { findUnique: vi.fn() }, product: { findMany: vi.fn() },
  cartItem: { findMany: vi.fn(), deleteMany: vi.fn() }, order: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() }, inventory: { update: vi.fn() },
  paymentAttempt: { findUnique: vi.fn(), update: vi.fn() }, paymentAttemptItem: { findMany: vi.fn() },
  paymentWork: { update: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../utils/logger.js', () => ({ logger: diagnosticsLogger, logSafely: vi.fn() }));
const app = express(); app.use(express.json()); app.use('/api', checkoutRoutes); app.use(errorHandler);
const shipping = { recipient: 'Test Customer', line1: '123 Test Street', city: 'Test City', postalCode: '12345', country: 'United States', phone: '+1 555 010 2000' };
const body = () => ({ shipping, deliveryMethod: 'EXPRESS', paymentMethod: 'CARD', expectedRevision: cartRevision(state.cartId, [{ productId: state.productId, quantity: state.quantity, product: { price: '19.99' } }]) });
const key = '55555555-5555-4555-8555-555555555555';
const token = () => generateAccessToken({ userId: state.userId, role: 'CUSTOMER' });
const intent: ProviderIntent = { id: 'pi_test', account: 'acct_test', livemode: false, amount: 4997, currency: 'usd',
  captureMethod: 'manual', status: 'requires_capture', capturable: 4997, received: 0, methodType: 'card', clientSecret: null,
  attemptId: key, declined: false, card: null, captureBefore: new Date(Date.now() + 60000) };
const commit = () => new OrderService().commitAuthorized(key, intent, 'worker');
function prepareAttempt(input = body()) {
  state.attemptRequest = input;
  state.attemptRequestHash = requestHash({ ...input, deliveryMethod: 'EXPRESS', paymentMethod: 'CARD' });
  db.paymentAttempt.findUnique.mockResolvedValue({ id: key, userId: state.userId, cartId: state.cartId, cartIdentity: state.cartId,
    idempotencyKey: key, request: input, requestHash: state.attemptRequestHash,
    providerIntentId: 'pi_test', stripeAccountId: 'acct_test', amountCents: 4997, currency: 'USD', total: new Prisma.Decimal('49.97'),
    shippingCost: new Prisma.Decimal('9.99'), orderId: null, state: 'AUTHORIZED', cancelRequested: false,
    work: { state: 'LEASED', leaseToken: 'worker', leaseUntil: new Date(Date.now() + 60000) },
    items: [{ productId: state.productId, quantity: state.quantity, unitPrice: new Prisma.Decimal('19.99'), productName: 'Test Phone', sku: 'TEST-PHONE', imageUrl: '/test.jpg' }] });
  db.paymentAttemptItem.findMany.mockResolvedValue([{ productId: state.productId, quantity: state.quantity,
    unitPrice: new Prisma.Decimal('19.99'), productName: 'Test Phone', sku: 'TEST-PHONE', imageUrl: '/test.jpg' }]);
}
beforeEach(() => {
  vi.resetAllMocks(); Object.assign(state, { quantity: 2, stock: 5, active: true, inventory: true, role: 'CUSTOMER' });
  db.user.findFirst.mockResolvedValue({ id: state.userId, role: { name: state.role } });
  db.cart.findUnique.mockImplementation(async () => ({ id: state.cartId, items: state.quantity ? [{ id: 'line', productId: state.productId, quantity: state.quantity }] : [] }));
  db.cartItem.findMany.mockResolvedValue([{ productId: state.productId }]);
  db.product.findMany.mockImplementation(async () => [{ id: state.productId, sku: 'TEST-PHONE', name: 'Test Phone', slug: 'test-phone', categoryId: state.categoryId,
    price: new Prisma.Decimal('19.99'), status: state.active ? 'ACTIVE' : 'INACTIVE', category: { name: 'Test Category', isActive: true },
    inventory: state.inventory ? { quantity: state.stock, lowStockAt: 5 } : null, images: [{ url: '/test.jpg' }] }]);
  db.$queryRaw.mockImplementation(async (sql: { text: string }) => {
    if (sql.text.includes('FROM "payment_attempts"')) return [{ cartId: state.cartId, cartIdentity: state.cartId,
      state: 'AUTHORIZED', cancelRequested: false, orderId: null, request: state.attemptRequest, requestHash: state.attemptRequestHash,
      total: new Prisma.Decimal('49.97'), shippingCost: new Prisma.Decimal('9.99'), amountCents: 4997 }];
    if (sql.text.includes('FROM "payment_work"')) return [{ state: 'LEASED', leaseToken: 'worker', leaseUntil: new Date(Date.now() + 60000) }];
    if (sql.text.includes('FROM "carts"')) return [{ id: state.cartId }];
    if (sql.text.includes('FROM "cart_items"')) return [{ productId: state.productId, quantity: state.quantity,
      categoryId: state.categoryId, price: new Prisma.Decimal('19.99'), status: state.active ? 'ACTIVE' : 'INACTIVE' }];
    if (sql.text.includes('FROM "categories"')) return [{ id: state.categoryId, isActive: true }];
    if (sql.text.includes('FROM "inventory"')) return state.inventory ? [{ productId: state.productId, quantity: state.stock, lowStockAt: 5 }] : [];
    return [];
  });
  db.$transaction.mockImplementation(async (operation: (tx: typeof db) => Promise<unknown>) => operation(db));
  db.order.findUnique.mockResolvedValue(null);
  prepareAttempt();
  db.order.create.mockImplementation(async ({ data }: { data: Record<string, unknown> & { items: { create: object[] } } }) => ({ ...data,
    subtotal: new Prisma.Decimal(String(data.subtotal)), shippingCost: new Prisma.Decimal(String(data.shippingCost)), total: new Prisma.Decimal(String(data.total)),
    id: '66666666-6666-4666-8666-666666666666', createdAt: new Date('2026-10-06T12:00:00Z'),
    payment: { status: 'PROCESSING', cardBrand: null, cardLast4: null },
    items: data.items.create.map(item => ({ ...item, id: 'order-item', createdAt: new Date() })) }));
  db.inventory.update.mockImplementation(async ({ data }: { data: { quantity: number } }) => { state.stock = data.quantity; return data; });
  db.cartItem.deleteMany.mockImplementation(async () => { state.quantity = 0; return { count: 1 }; });
});

describe('Checkout API orchestration with mocked persistence (not live DB proof)', () => {
  it('rejects unauthenticated reads and database-confirmed non-customer roles', async () => {
    expect((await request(app).get('/api/checkout')).status).toBe(401);
    db.user.findFirst.mockResolvedValue({ id: state.userId, role: { name: 'ADMIN' } });
    expect((await request(app).get('/api/checkout').auth(token(), { type: 'bearer' })).status).toBe(403);
  });
  it('returns authoritative options, totals and economic revision', async () => {
    const response = await request(app).get('/api/checkout').auth(token(), { type: 'bearer' });
    expect(response.status).toBe(200); expect(response.body.data.cartRevision).toBe(body().expectedRevision);
    expect(response.body.data.deliveryMethods.map((method: { totals: { total: string } }) => method.totals.total)).toEqual(['39.98', '49.97', '59.97']);
  });
  it('internally commits verified authorization, snapshots, Inventory and Cart in one transaction', async () => {
    const response = await commit();
    expect(response.confirmation).toMatchObject({ total: '49.97', paymentState: 'PENDING', status: 'AWAITING_CAPTURE', items: [{ quantity: 2, sku: 'TEST-PHONE', imageUrl: '/test.jpg' }] });
    expect(state.stock).toBe(3); expect(response.cart.items).toEqual([]);
    expect(db.$transaction).toHaveBeenCalledTimes(1); expect(db.inventory.update).toHaveBeenCalledTimes(1); expect(db.cartItem.deleteMany).toHaveBeenCalledTimes(1);
  });
  it('records sanitized purchase stage timings when diagnostics are enabled', async () => {
    const previous = process.env.ELECTROHUB_SQL_DIAGNOSTICS;
    process.env.ELECTROHUB_SQL_DIAGNOSTICS = '1';
    try {
      await commit();
      expect(diagnosticsLogger.info).toHaveBeenCalledWith('Purchase transaction committed.', expect.objectContaining({
        event: 'order.purchase.transaction', outcome: 'committed', retryCount: 0,
        stageTimings: expect.arrayContaining([
          expect.objectContaining({ stage: 'attempt_lock', prismaOperationCount: 1 }),
          expect.objectContaining({ stage: 'inventory_locks', prismaOperationCount: 1 }),
          expect.objectContaining({ stage: 'cart_cleanup', prismaOperationCount: 1 }),
          expect.objectContaining({ stage: 'capture_work_ready_persist', prismaOperationCount: 1 }),
        ]),
        acquisitionAndBeginMs: expect.any(Number), transactionDurationMs: expect.any(Number),
      }));
      const output = JSON.stringify(diagnosticsLogger.info.mock.calls);
      expect(output).not.toContain(state.userId); expect(output).not.toContain('pi_test'); expect(output).not.toContain('worker');
    } finally {
      if (previous === undefined) delete process.env.ELECTROHUB_SQL_DIAGNOSTICS;
      else process.env.ELECTROHUB_SQL_DIAGNOSTICS = previous;
    }
  });
  it('marks a transaction timeout outcome unknown and never schedules a retry', async () => {
    const previous = process.env.ELECTROHUB_SQL_DIAGNOSTICS;
    process.env.ELECTROHUB_SQL_DIAGNOSTICS = '1';
    db.cartItem.deleteMany.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Transaction API error', {
      code: 'P2028', clientVersion: '6.12.0', meta: { operation: 'transaction' },
    }));
    try {
      await expect(commit()).rejects.toMatchObject({ code: 'P2028' });
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(diagnosticsLogger.error).toHaveBeenCalledWith('Purchase transaction failed.', expect.objectContaining({
        event: 'order.purchase.transaction', failureStage: 'cart_cleanup', prismaCode: 'P2028', sqlState: null,
        transactionOutcome: 'unknown', retryCount: 0, willRetry: false,
        stageTimings: expect.arrayContaining([expect.objectContaining({ stage: 'cart_cleanup', prismaOperationCount: 1 })]),
      }));
      const output = JSON.stringify(diagnosticsLogger.error.mock.calls);
      expect(output).not.toContain(state.userId); expect(output).not.toContain('pi_test'); expect(output).not.toContain('worker');
    } finally {
      if (previous === undefined) delete process.env.ELECTROHUB_SQL_DIAGNOSTICS;
      else process.env.ELECTROHUB_SQL_DIAGNOSTICS = previous;
    }
  });
  it.each(['total', 'userId', 'stock', 'status', 'paymentStatus'])('blocks the obsolete unpaid API even with client field %s', async field => {
    const response = await request(app).post('/api/orders').auth(token(), { type: 'bearer' }).set('Idempotency-Key', key).send({ ...body(), [field]: 'untrusted' });
    expect(response.status).toBe(409); expect(response.body.error.code).toBe('PAYMENT_REQUIRED'); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('blocks unpaid creation without a key and rejects a changed revision in the authorized commit', async () => {
    expect((await request(app).post('/api/orders').auth(token(), { type: 'bearer' }).send(body())).body.error.code).toBe('PAYMENT_REQUIRED');
    prepareAttempt({ ...body(), expectedRevision: '0'.repeat(64) });
    await expect(commit()).rejects.toMatchObject({ code: 'CHECKOUT_CHANGED' });
    expect(db.order.create).not.toHaveBeenCalled(); expect(state.quantity).toBe(2);
  });
  it.each(['inactive', 'missingInventory', 'insufficient'])('rejects invalid line %s with no economic writes', async reason => {
    if (reason === 'inactive') state.active = false; if (reason === 'missingInventory') state.inventory = false; if (reason === 'insufficient') state.stock = 1;
    await expect(commit()).rejects.toBeInstanceOf(Error); expect(db.order.create).not.toHaveBeenCalled(); expect(db.inventory.update).not.toHaveBeenCalled();
  });
  it('returns a compatible committed replay without a second transaction and rejects changed payload', async () => {
    const input = body();
    const created = await commit(); expect(created.replayed).toBe(false);
    const stored = await db.order.create.mock.results[0]?.value;
    db.order.findUnique.mockResolvedValue({ ...stored, checkoutRequestHash: requestHash({ ...input, deliveryMethod: 'EXPRESS', paymentMethod: 'CARD' }) });
    const replay = await commit(); expect(replay.replayed).toBe(true); expect(db.$transaction).toHaveBeenCalledTimes(1);
    db.order.findUnique.mockResolvedValue({ ...stored, checkoutRequestHash: '0'.repeat(64) });
    await expect(commit()).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('scopes confirmation and attempt queries to the authenticated owner and sanitizes misses', async () => {
    db.order.findFirst.mockResolvedValue(null);
    const response = await request(app).get('/api/orders/ORD-66666666-6666-4666-8666-666666666666/confirmation').auth(token(), { type: 'bearer' });
    expect(response.status).toBe(404); expect(db.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: '66666666-6666-4666-8666-666666666666', userId: state.userId } }));
    expect((await request(app).get(`/api/orders/attempts/${key}/confirmation`).auth(token(), { type: 'bearer' })).status).toBe(404);
    expect(db.order.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId_checkoutAttemptId: { userId: state.userId, checkoutAttemptId: key } } }));
  });
});
