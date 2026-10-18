import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import checkoutRoutes from './checkout.routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { generateAccessToken } from '../utils/jwt.js';

// Task 03.7 contract tests with mocked persistence: they prove route/auth/DTO/predicate behavior,
// not real PostgreSQL semantics (see orders.management.live.test.ts for the opt-in DEV gate).
const ids = vi.hoisted(() => ({ a: '11111111-1111-4111-8111-111111111111', b: '22222222-2222-4222-8222-222222222222',
  order: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'CUSTOMER' }));
const db = vi.hoisted(() => ({ user: { findFirst: vi.fn() }, order: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(),
  create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() }, payment: { update: vi.fn(), create: vi.fn() },
  inventory: { update: vi.fn() }, cartItem: { deleteMany: vi.fn() }, $transaction: vi.fn(), $queryRaw: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, logSafely: vi.fn() }));

const app = express(); app.use(express.json()); app.use('/api', checkoutRoutes); app.use(errorHandler);
const token = (userId = ids.a) => generateAccessToken({ userId, role: 'CUSTOMER' });
const get = (path: string, userId = ids.a) => request(app).get(path).auth(token(userId), { type: 'bearer' });
const reference = `ORD-${ids.order.toUpperCase()}`;

type PaymentRow = { status: string; cardBrand: string | null; cardLast4: string | null; paidAt: Date | null; refundedAt: Date | null;
  providerPaymentId: string; failureReason: string | null; amount: Prisma.Decimal };
function order(overrides: { id?: string; status?: string; payment?: Partial<PaymentRow> | null; createdAt?: Date } = {}) {
  const payment = overrides.payment === null ? null : { status: 'SUCCEEDED', cardBrand: 'visa', cardLast4: '4242', paidAt: new Date('2026-10-06T12:01:00Z'),
    refundedAt: null, providerPaymentId: 'pi_secret_internal', failureReason: 'raw provider failure text', amount: new Prisma.Decimal('2209.97'), ...overrides.payment };
  return { id: overrides.id ?? ids.order, userId: ids.a, status: overrides.status ?? 'CONFIRMED', createdAt: overrides.createdAt ?? new Date('2026-10-06T12:00:00Z'),
    checkoutAttemptId: '99999999-9999-4999-8999-999999999999', checkoutRequestHash: 'f'.repeat(64), paymentMethod: 'CARD', deliveryMethod: 'EXPRESS',
    subtotal: new Prisma.Decimal('2199.98'), shippingCost: new Prisma.Decimal('9.99'), total: new Prisma.Decimal('2209.97'), currency: 'USD',
    shippingRecipient: 'Alex Morgan', shippingLine1: '123 Demo Street', shippingLine2: null, shippingCity: 'Demo City', shippingState: null,
    shippingPostalCode: '12345', shippingCountry: 'United States', shippingPhone: '+1 555 010 2000', shippingLatitude: null, shippingLongitude: null,
    estimatedDeliveryStart: new Date('2026-10-08T00:00:00Z'), estimatedDeliveryEnd: new Date('2026-10-09T00:00:00Z'),
    payment, items: [
      { id: 'line-1', productId: 'p1', productName: 'Apple iPhone 15 Pro', sku: 'DEMO-PHONE', productImageUrl: '/phone.jpg', quantity: 2,
        unitPrice: new Prisma.Decimal('1099.99'), lineTotal: new Prisma.Decimal('2199.98') },
      { id: 'line-2', productId: 'p2', productName: 'Cable', sku: 'DEMO-CABLE', productImageUrl: null, quantity: 1,
        unitPrice: new Prisma.Decimal('0.00'), lineTotal: new Prisma.Decimal('0.00') },
    ] };
}
const writes = () => [db.order.create, db.order.update, db.order.updateMany, db.order.delete, db.payment.update, db.payment.create,
  db.inventory.update, db.cartItem.deleteMany, db.$queryRaw].map(fn => fn.mock.calls.length).reduce((a, b) => a + b, 0);

beforeEach(() => {
  vi.resetAllMocks(); ids.role = 'CUSTOMER';
  db.user.findFirst.mockImplementation(async () => ({ id: ids.a, role: { name: ids.role } }));
  db.$transaction.mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations));
  db.order.findMany.mockResolvedValue([order()]); db.order.count.mockResolvedValue(1);
  db.order.findFirst.mockImplementation(async ({ where }: { where: { id: string; userId: string } }) =>
    where.id === ids.order && where.userId === ids.a ? order() : null);
});

describe('B01 authentication and role', () => {
  it.each(['/api/orders', `/api/orders/${reference}`])('rejects anonymous %s', async path => {
    expect((await request(app).get(path)).status).toBe(401);
    expect(db.order.findMany).not.toHaveBeenCalled(); expect(db.order.findFirst).not.toHaveBeenCalled();
  });
  it.each(['/api/orders', `/api/orders/${reference}`])('rejects a database-confirmed non-customer role on %s', async path => {
    ids.role = 'ADMIN';
    expect((await get(path)).status).toBe(403);
    expect(db.order.findFirst).not.toHaveBeenCalled();
  });
  it('sends no-store on history and details', async () => {
    expect((await get('/api/orders')).headers['cache-control']).toBe('no-store');
    expect((await get(`/api/orders/${reference}`)).headers['cache-control']).toBe('no-store');
  });
});

describe('B02 owner-scoped details', () => {
  it('reads one Order with the authenticated owner and normalized id in the same predicate', async () => {
    const response = await get(`/api/orders/${reference}`);
    expect(response.status).toBe(200);
    expect(db.order.findFirst).toHaveBeenCalledTimes(1);
    expect(db.order.findFirst.mock.calls[0]![0].where).toEqual({ id: ids.order, userId: ids.a });
    expect(response.body.data.orderReference).toBe(reference);
  });
  it('returns the same 404 body for another customer and for an unknown Order', async () => {
    const other = await get(`/api/orders/${reference}`, ids.b);
    const unknown = await get(`/api/orders/ORD-${'B'.repeat(8)}-BBBB-4BBB-8BBB-${'B'.repeat(12)}`);
    expect(other.status).toBe(404); expect(unknown.status).toBe(404);
    expect(other.body.error.code).toBe('ORDER_NOT_FOUND');
    expect({ ...other.body.error, requestId: undefined }).toEqual({ ...unknown.body.error, requestId: undefined });
    expect(db.order.findFirst.mock.calls[0]![0].where.userId).toBe(ids.b);
  });
  it('accepts lowercase and legacy bare-UUID references', async () => {
    expect((await get(`/api/orders/${reference.toLowerCase()}`)).status).toBe(200);
    expect((await get(`/api/orders/${ids.order}`)).status).toBe(200);
  });
  it.each(['ORD-J220A0', 'ORD-', 'not-a-reference', `ORD-${ids.order}-extra`, 'x'.repeat(200), "ORD-' OR 1=1 --"])('rejects malformed %s without a query', async value => {
    const response = await get(`/api/orders/${encodeURIComponent(value)}`);
    expect(response.status).toBe(400); expect(response.body.error.code).toBe('ORDER_REFERENCE_INVALID');
    expect(db.order.findFirst).not.toHaveBeenCalled();
  });
});

describe('B03 paginated history', () => {
  it('filters list and count by the authenticated owner with stable newest-first ordering and bounds', async () => {
    db.order.count.mockResolvedValue(25);
    const response = await get('/api/orders?page=2&pageSize=10');
    expect(response.status).toBe(200);
    const [{ where, orderBy, skip, take }] = db.order.findMany.mock.calls[0]!;
    expect(where).toEqual({ userId: ids.a }); expect(db.order.count.mock.calls[0]![0]).toEqual({ where: { userId: ids.a } });
    expect(orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]); expect(skip).toBe(10); expect(take).toBe(10);
    expect(response.body.meta).toEqual({ page: 2, pageSize: 10, total: 25, totalPages: 3 });
  });
  it('defaults to page 1 / 10', async () => {
    await get('/api/orders');
    expect(db.order.findMany.mock.calls[0]![0]).toMatchObject({ skip: 0, take: 10 });
  });
  it('returns empty data and zero total for an empty account', async () => {
    db.order.findMany.mockResolvedValue([]); db.order.count.mockResolvedValue(0);
    const response = await get('/api/orders');
    expect(response.body).toEqual({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
  });
  it('keeps truthful metadata for a valid out-of-range page', async () => {
    db.order.findMany.mockResolvedValue([]); db.order.count.mockResolvedValue(3);
    const response = await get('/api/orders?page=5');
    expect(response.body).toEqual({ data: [], meta: { page: 5, pageSize: 10, total: 3, totalPages: 1 } });
  });
  it.each(['page=0', 'page=-1', 'page=1.5', 'page=abc', 'page=1001', 'pageSize=51', 'pageSize=0', 'page=1&page=2',
    'userId=22222222-2222-4222-8222-222222222222', 'sort=asc', `page=${'9'.repeat(30)}`])('rejects %s', async query => {
    const response = await get(`/api/orders?${query}`);
    expect(response.status).toBe(400); expect(db.order.findMany).not.toHaveBeenCalled();
  });
  it('adds itemCount as the sum of purchased quantities while keeping the Confirmation fields', async () => {
    const [summary] = (await get('/api/orders')).body.data;
    expect(summary.itemCount).toBe(3);
    expect(summary).toMatchObject({ orderReference: reference, status: 'CONFIRMED', paymentState: 'PAID', total: '2209.97' });
    expect(summary.items).toHaveLength(2);
  });
});

describe('B05/B08 status, payment projection and snapshot serialization', () => {
  it.each(['AWAITING_CAPTURE', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'])('returns stored Order status %s unchanged', async status => {
    db.order.findFirst.mockResolvedValue(order({ status }));
    expect((await get(`/api/orders/${reference}`)).body.data.status).toBe(status);
  });
  it.each([
    [null, 'UNPROCESSED'], [{ status: 'PENDING' }, 'PENDING'], [{ status: 'PROCESSING' }, 'PENDING'], [{ status: 'SUCCEEDED' }, 'PAID'],
    [{ status: 'FAILED' }, 'FAILED'], [{ status: 'REFUNDED', refundedAt: new Date('2026-10-07T00:00:00Z') }, 'REFUNDED'],
  ] as const)('projects Payment %j as %s independently of fulfillment', async (payment, expected) => {
    db.order.findFirst.mockResolvedValue(order({ status: 'CANCELLED', payment }));
    const data = (await get(`/api/orders/${reference}`)).body.data;
    expect(data.paymentState).toBe(expected); expect(data.status).toBe('CANCELLED');
  });
  it('serializes decimal strings, zero-priced lines, stable line ids, date-only estimates and nullable payment fields', async () => {
    db.order.findFirst.mockResolvedValue(order({ payment: { cardBrand: null, cardLast4: null, paidAt: null } }));
    const data = (await get(`/api/orders/${reference}`)).body.data;
    expect(data).toMatchObject({ subtotal: '2199.98', shippingCost: '9.99', total: '2209.97', currency: 'USD', itemCount: 3, card: null,
      payment: { paidAt: null, refundedAt: null }, estimatedDeliveryStart: '2026-10-08T00:00:00.000Z',
      shipping: { recipient: 'Alex Morgan', line2: null, state: null, phone: '+1 555 010 2000' } });
    expect(data.items.map((item: { id: string }) => item.id)).toEqual(['line-1', 'line-2']);
    expect(data.items[1]).toMatchObject({ imageUrl: null, unitPrice: '0.00', lineTotal: '0.00' });
  });
  it('returns null payment metadata for a legacy Order without Payment', async () => {
    db.order.findFirst.mockResolvedValue(order({ payment: null }));
    const data = (await get(`/api/orders/${reference}`)).body.data;
    expect(data).toMatchObject({ paymentState: 'UNPROCESSED', payment: null, card: null });
  });
});

describe('B06 allowlist and B07 read-only behavior', () => {
  it('never serializes provider ids, failure reasons, request hashes, attempt keys or owner ids', async () => {
    for (const path of ['/api/orders', `/api/orders/${reference}`]) {
      const text = JSON.stringify((await get(path)).body);
      for (const secret of ['pi_secret_internal', 'raw provider failure text', 'f'.repeat(64), '99999999-9999-4999-8999-999999999999', ids.a,
        'providerPaymentId', 'failureReason', 'checkoutRequestHash', 'checkoutAttemptId', 'userId', 'shippingLatitude'])
        expect(text).not.toContain(secret);
    }
  });
  it('performs no writes, raw SQL or transactions-with-callbacks on management reads', async () => {
    await get('/api/orders'); await get(`/api/orders/${reference}`); await get(`/api/orders/${reference}`, ids.b);
    expect(writes()).toBe(0);
  });
  it('keeps the confirmation read and disabled unpaid creation contracts', async () => {
    const confirmation = await get(`/api/orders/${reference}/confirmation`);
    expect(confirmation.status).toBe(200); expect(confirmation.body.data).not.toHaveProperty('itemCount');
    expect(confirmation.body.data).not.toHaveProperty('payment');
    const created = await request(app).post('/api/orders').auth(token(), { type: 'bearer' }).send({});
    expect(created.status).toBe(409); expect(created.body.error.code).toBe('PAYMENT_REQUIRED');
  });
});
