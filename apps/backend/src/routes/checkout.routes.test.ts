import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import checkoutRoutes from './checkout.routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { generateAccessToken } from '../utils/jwt.js';
import { cartRevision, requestHash } from '../services/checkout.domain.js';

const state = vi.hoisted(() => ({ userId: '11111111-1111-4111-8111-111111111111', cartId: '22222222-2222-4222-8222-222222222222',
  productId: '33333333-3333-4333-8333-333333333333', categoryId: '44444444-4444-4444-8444-444444444444', quantity: 2, stock: 5, active: true, inventory: true, role: 'CUSTOMER' }));
const db = vi.hoisted(() => ({ user: { findFirst: vi.fn() }, cart: { findUnique: vi.fn() }, product: { findMany: vi.fn() },
  cartItem: { findMany: vi.fn(), deleteMany: vi.fn() }, order: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() }, inventory: { update: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));
const app = express(); app.use(express.json()); app.use('/api', checkoutRoutes); app.use(errorHandler);
const shipping = { recipient: 'Test Customer', line1: '123 Test Street', city: 'Test City', postalCode: '12345', country: 'United States', phone: '+1 555 010 2000' };
const body = () => ({ shipping, deliveryMethod: 'EXPRESS', paymentMethod: 'CARD', expectedRevision: cartRevision(state.cartId, [{ productId: state.productId, quantity: state.quantity, product: { price: '19.99' } }]) });
const key = '55555555-5555-4555-8555-555555555555';
const token = () => generateAccessToken({ userId: state.userId, role: 'CUSTOMER' });
beforeEach(() => {
  vi.resetAllMocks(); Object.assign(state, { quantity: 2, stock: 5, active: true, inventory: true, role: 'CUSTOMER' });
  db.user.findFirst.mockResolvedValue({ id: state.userId, role: { name: state.role } });
  db.cart.findUnique.mockImplementation(async () => ({ id: state.cartId, items: state.quantity ? [{ id: 'line', productId: state.productId, quantity: state.quantity }] : [] }));
  db.cartItem.findMany.mockResolvedValue([{ productId: state.productId }]);
  db.product.findMany.mockImplementation(async () => [{ id: state.productId, sku: 'TEST-PHONE', name: 'Test Phone', slug: 'test-phone', categoryId: state.categoryId,
    price: new Prisma.Decimal('19.99'), status: state.active ? 'ACTIVE' : 'INACTIVE', category: { name: 'Test Category', isActive: true },
    inventory: state.inventory ? { quantity: state.stock, lowStockAt: 5 } : null, images: [{ url: '/test.jpg' }] }]);
  db.$queryRaw.mockImplementation(async (sql: { text: string }) => sql.text.includes('categoryId') ? [{ categoryId: state.categoryId }] : [{ quantity: state.stock, lowStockAt: 5 }]);
  db.$transaction.mockImplementation(async (operation: (tx: typeof db) => Promise<unknown>) => operation(db));
  db.order.findUnique.mockResolvedValue(null);
  db.order.create.mockImplementation(async ({ data }: { data: Record<string, unknown> & { items: { create: object[] } } }) => ({ ...data,
    subtotal: new Prisma.Decimal(String(data.subtotal)), shippingCost: new Prisma.Decimal(String(data.shippingCost)), total: new Prisma.Decimal(String(data.total)),
    id: '66666666-6666-4666-8666-666666666666', createdAt: new Date('2026-10-06T12:00:00Z'),
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
  it('creates snapshots, decreases Inventory and clears Cart using the same transaction', async () => {
    const response = await request(app).post('/api/orders').auth(token(), { type: 'bearer' }).set('Idempotency-Key', key).send(body());
    expect(response.status).toBe(201); expect(response.body.data.confirmation).toMatchObject({ total: '49.97', paymentState: 'UNPROCESSED', items: [{ quantity: 2, sku: 'TEST-PHONE', imageUrl: '/test.jpg' }] });
    expect(state.stock).toBe(3); expect(response.body.data.cart.items).toEqual([]);
    expect(db.$transaction).toHaveBeenCalledTimes(1); expect(db.inventory.update).toHaveBeenCalledTimes(1); expect(db.cartItem.deleteMany).toHaveBeenCalledTimes(1);
  });
  it.each(['total', 'userId', 'stock', 'status', 'paymentStatus'])('rejects client-authoritative field %s before writes', async field => {
    const response = await request(app).post('/api/orders').auth(token(), { type: 'bearer' }).set('Idempotency-Key', key).send({ ...body(), [field]: 'untrusted' });
    expect(response.status).toBe(400); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects a missing attempt key and changed economic revision', async () => {
    expect((await request(app).post('/api/orders').auth(token(), { type: 'bearer' }).send(body())).status).toBe(400);
    const response = await request(app).post('/api/orders').auth(token(), { type: 'bearer' }).set('Idempotency-Key', key).send({ ...body(), expectedRevision: '0'.repeat(64) });
    expect(response.status).toBe(409); expect(response.body.error.code).toBe('CHECKOUT_CHANGED'); expect(db.order.create).not.toHaveBeenCalled(); expect(state.quantity).toBe(2);
  });
  it.each(['inactive', 'missingInventory', 'insufficient'])('rejects invalid line %s with no economic writes', async reason => {
    if (reason === 'inactive') state.active = false; if (reason === 'missingInventory') state.inventory = false; if (reason === 'insufficient') state.stock = 1;
    const response = await request(app).post('/api/orders').auth(token(), { type: 'bearer' }).set('Idempotency-Key', key).send(body());
    expect(response.status).toBe(409); expect(db.order.create).not.toHaveBeenCalled(); expect(db.inventory.update).not.toHaveBeenCalled();
  });
  it('returns a compatible committed replay without a second transaction and rejects changed payload', async () => {
    const input = body();
    const created = await request(app).post('/api/orders').auth(token(), { type: 'bearer' }).set('Idempotency-Key', key).send(input);
    expect(created.status).toBe(201);
    const stored = await db.order.create.mock.results[0]?.value;
    db.order.findUnique.mockResolvedValue({ ...stored, checkoutRequestHash: requestHash({ ...input, deliveryMethod: 'EXPRESS', paymentMethod: 'CARD' }) });
    const replay = await request(app).post('/api/orders').auth(token(), { type: 'bearer' }).set('Idempotency-Key', key).send(input);
    expect(replay.status).toBe(200); expect(db.$transaction).toHaveBeenCalledTimes(1);
    const conflict = await request(app).post('/api/orders').auth(token(), { type: 'bearer' }).set('Idempotency-Key', key).send({ ...input, deliveryMethod: 'STANDARD' });
    expect(conflict.status).toBe(409); expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
  it('scopes confirmation and attempt queries to the authenticated owner and sanitizes misses', async () => {
    db.order.findFirst.mockResolvedValue(null);
    const response = await request(app).get('/api/orders/ORD-66666666-6666-4666-8666-666666666666/confirmation').auth(token(), { type: 'bearer' });
    expect(response.status).toBe(404); expect(db.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: '66666666-6666-4666-8666-666666666666', userId: state.userId } }));
    expect((await request(app).get(`/api/orders/attempts/${key}/confirmation`).auth(token(), { type: 'bearer' })).status).toBe(404);
    expect(db.order.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId_checkoutAttemptId: { userId: state.userId, checkoutAttemptId: key } } }));
  });
});
