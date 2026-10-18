import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import app from '../../app.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../utils/hash.js';

// Task 03.7 opt-in DEV read gate: real login, real Express routes and real DEV PostgreSQL ownership predicates.
// Writes only disposable, labeled users/category/product/Orders; no Stripe, Inventory, Cart or curated data.
const enabled = process.env.ORDERS_LIVE_DEV === 'true';
const testSafety = createRequire(resolve('package.json'))('./scripts/stripe-gate-safety.cjs') as {
  assertSyntheticDevEnvironment(values: Record<string, unknown>): void;
  syntheticCleanupAllowed(setupCompleted: boolean, testStates: Array<string | undefined>): boolean;
};
if (enabled) testSafety.assertSyntheticDevEnvironment({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED });

const prefix = `orders-gate-${randomUUID()}`;
const users: { id: string; token: string }[] = [];
const fixture = { categoryId: '', productId: '' };
const orderIds: Record<string, string> = {};
let setupCompleted = false;
const ref = (id: string) => `ORD-${id.toUpperCase()}`;
const get = (token: string, path: string) => request(app).get(path).auth(token, { type: 'bearer' });

async function order(userId: string, key: string, input: { createdAt: Date; status: Prisma.OrderCreateInput['status'];
  payment?: { status: 'SUCCEEDED' | 'REFUNDED' | 'FAILED'; refundedAt?: Date } | null; quantity?: number; shippingCost?: string; id?: string }) {
  const quantity = input.quantity ?? 1; const shipping = new Prisma.Decimal(input.shippingCost ?? '0.00');
  const subtotal = new Prisma.Decimal('1099.99').mul(quantity);
  const created = await prisma.order.create({ data: {
    id: input.id, user: { connect: { id: userId } }, status: input.status, createdAt: input.createdAt,
    checkoutAttemptId: randomUUID(), checkoutRequestHash: 'e'.repeat(64), deliveryMethod: 'STANDARD', paymentMethod: 'CARD',
    subtotal, shippingCost: shipping, total: subtotal.add(shipping), currency: 'USD',
    shippingRecipient: 'Live Gate Recipient', shippingLine1: '1 Disposable Way', shippingLine2: null, shippingCity: 'Fixture City',
    shippingState: null, shippingPostalCode: '00000', shippingCountry: 'Testland', shippingPhone: '+1 555 010 0000',
    estimatedDeliveryStart: new Date('2026-10-20T00:00:00Z'), estimatedDeliveryEnd: new Date('2026-10-22T00:00:00Z'),
    payment: input.payment ? { create: { provider: 'STRIPE', providerPaymentId: `pi_orders_gate_${randomUUID()}`, status: input.payment.status,
      amount: subtotal.add(shipping), currency: 'USD', paidAt: input.payment.status === 'FAILED' ? null : new Date('2026-10-18T10:00:00Z'),
      refundedAt: input.payment.refundedAt ?? null, cardBrand: 'visa', cardLast4: '4242', failureReason: 'raw gate failure text' } } : undefined,
    items: { create: [{ product: { connect: { id: fixture.productId } }, productName: 'Gate Phone Snapshot', sku: `${prefix}-sku`,
      productImageUrl: null, unitPrice: new Prisma.Decimal('1099.99'), quantity, lineTotal: subtotal }] },
  } });
  orderIds[key] = created.id;
  return created;
}

describe.skipIf(!enabled)('LIVE DEV Order Management read gate (real PostgreSQL; fixture Orders, no payment provider)', () => {
  beforeAll(async () => {
    // Remove only fixtures left by an earlier blocked run of this same gate (exact label prefix).
    const stale = await prisma.user.findMany({ where: { email: { startsWith: 'orders-gate-', endsWith: '@example.invalid' } }, select: { id: true } });
    const staleIds = stale.map(user => user.id);
    await prisma.payment.deleteMany({ where: { order: { userId: { in: staleIds } } } });
    await prisma.order.deleteMany({ where: { userId: { in: staleIds } } });
    await prisma.securityEvent.deleteMany({ where: { userId: { in: staleIds } } });
    await prisma.user.deleteMany({ where: { id: { in: staleIds } } });
    await prisma.product.deleteMany({ where: { slug: { startsWith: 'orders-gate-' }, isTestFixture: true } });
    await prisma.category.deleteMany({ where: { slug: { startsWith: 'orders-gate-' } } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
    const category = await prisma.category.create({ data: { name: prefix, slug: prefix, isActive: true } }); fixture.categoryId = category.id;
    const product = await prisma.product.create({ data: { categoryId: category.id, sku: `${prefix}-sku`, slug: `${prefix}-product`,
      name: 'Gate Phone Current Name', price: new Prisma.Decimal('1099.99'), isTestFixture: true, storefrontVisible: false } });
    fixture.productId = product.id;
    for (let index = 0; index < 3; index++) {
      const id = randomUUID(); const email = `${prefix}-${index}@example.invalid`; const password = `Orders-${randomUUID()}-A1!`;
      await prisma.user.create({ data: { id, email, passwordHash: await hashPassword(password), roleId: role.id, firstName: 'Orders', lastName: 'Disposable', emailVerifiedAt: new Date() } });
      const login = await request(app).post('/api/auth/login').send({ email, password });
      expect(login.status).toBe(200); expect(login.body.user.id).toBe(id);
      users.push({ id, token: login.body.accessToken });
    }
    const a = users[0]!; const b = users[1]!;
    const tie = new Date('2026-10-18T09:00:00Z');
    // Two Orders share createdAt; their ids decide the order (id DESC).
    await order(a.id, 'tieLow', { createdAt: tie, status: 'CONFIRMED', payment: { status: 'SUCCEEDED' }, id: '00000000-0000-4000-8000-0000000000a1' });
    await order(a.id, 'tieHigh', { createdAt: tie, status: 'PREPARING', payment: { status: 'SUCCEEDED' }, id: 'ffffffff-ffff-4fff-8fff-ffffffffffa1' });
    await order(a.id, 'legacy', { createdAt: new Date('2026-10-01T09:00:00Z'), status: 'CONFIRMED', payment: null, quantity: 3, shippingCost: '9.99' });
    await order(a.id, 'refunded', { createdAt: new Date('2026-10-10T09:00:00Z'), status: 'CANCELLED', payment: { status: 'REFUNDED', refundedAt: new Date('2026-10-11T00:00:00Z') } });
    await order(b.id, 'other', { createdAt: new Date('2026-10-18T11:00:00Z'), status: 'DELIVERED', payment: { status: 'SUCCEEDED' } });
    setupCompleted = true;
  }, 180000);

  // eslint-disable-next-line no-empty-pattern -- Vitest 4 requires a destructured fixture argument before the suite.
  afterAll(async ({}, suite) => {
    if (!testSafety.syntheticCleanupAllowed(setupCompleted, suite.tasks.map(task => task.result?.state))) {
      console.log('LIVE DEV orders cleanup BLOCKED; owned fixtures preserved for diagnosis.');
      await prisma.$disconnect(); return;
    }
    const ids = users.map(user => user.id);
    await prisma.payment.deleteMany({ where: { order: { userId: { in: ids } } } });
    await prisma.order.deleteMany({ where: { userId: { in: ids } } });
    await prisma.securityEvent.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.product.deleteMany({ where: { id: fixture.productId } });
    await prisma.category.deleteMany({ where: { id: fixture.categoryId } });
    expect(await prisma.order.count({ where: { userId: { in: ids } } })).toBe(0);
    expect(await prisma.user.count({ where: { id: { in: ids } } })).toBe(0);
    console.log('LIVE DEV orders cleanup PASS; only labeled fixtures removed.');
    await prisma.$disconnect();
  }, 180000);

  it('lists only the owner Orders, newest first with createdAt/id tie ordering, accurate totals and paging', async () => {
    const a = users[0]!;
    const page1 = await get(a.token, '/api/orders?page=1&pageSize=3');
    expect(page1.status).toBe(200); expect(page1.headers['cache-control']).toBe('no-store');
    expect(page1.body.meta).toEqual({ page: 1, pageSize: 3, total: 4, totalPages: 2 });
    expect(page1.body.data.map((item: { orderReference: string }) => item.orderReference))
      .toEqual([ref(orderIds.tieHigh!), ref(orderIds.tieLow!), ref(orderIds.refunded!)]);
    const page2 = await get(a.token, '/api/orders?page=2&pageSize=3');
    expect(page2.body.data.map((item: { orderReference: string }) => item.orderReference)).toEqual([ref(orderIds.legacy!)]);
    expect(page2.body.data[0]).toMatchObject({ itemCount: 3, paymentState: 'UNPROCESSED', card: null, shippingCost: '9.99' });
    expect(JSON.stringify(page1.body)).not.toContain(ref(orderIds.other!));
    const outOfRange = await get(a.token, '/api/orders?page=9&pageSize=3');
    expect(outOfRange.body).toEqual({ data: [], meta: { page: 9, pageSize: 3, total: 4, totalPages: 2 } });
  }, 120000);

  it('returns an empty history for a customer without Orders', async () => {
    const empty = users[2]!;
    expect((await get(empty.token, '/api/orders')).body).toEqual({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
  }, 120000);

  it('reads owned details and returns the identical 404 for another customer and an unknown reference', async () => {
    const a = users[0]!; const b = users[1]!;
    const own = await get(a.token, `/api/orders/${ref(orderIds.refunded!)}`);
    expect(own.status).toBe(200);
    expect(own.body.data).toMatchObject({ status: 'CANCELLED', paymentState: 'REFUNDED', payment: { refundedAt: '2026-10-11T00:00:00.000Z' },
      card: { brand: 'visa', last4: '4242' }, items: [{ productName: 'Gate Phone Snapshot', unitPrice: '1099.99' }] });
    const text = JSON.stringify(own.body);
    for (const hidden of ['pi_orders_gate_', 'raw gate failure text', 'e'.repeat(64)]) expect(text).not.toContain(hidden);
    const crossOwner = await get(b.token, `/api/orders/${ref(orderIds.refunded!)}`);
    const unknown = await get(b.token, `/api/orders/${ref(randomUUID())}`);
    expect(crossOwner.status).toBe(404); expect(unknown.status).toBe(404);
    expect(crossOwner.body.error.code).toBe('ORDER_NOT_FOUND');
    expect(crossOwner.body.error.message).toBe(unknown.body.error.message);
    expect((await get(b.token, `/api/orders/${ref(orderIds.other!)}`)).body.data.status).toBe('DELIVERED');
  }, 120000);

  it('keeps purchase-time snapshots after the current Product changes and preserves the delete restriction', async () => {
    const a = users[0]!;
    await prisma.product.update({ where: { id: fixture.productId }, data: { price: new Prisma.Decimal('999.99'), name: 'Renamed Today' } });
    const details = await get(a.token, `/api/orders/${ref(orderIds.legacy!)}`);
    expect(details.body.data.items[0]).toMatchObject({ productName: 'Gate Phone Snapshot', unitPrice: '1099.99', lineTotal: '3299.97', quantity: 3 });
    expect(details.body.data.total).toBe('3309.96');
    await expect(prisma.product.delete({ where: { id: fixture.productId } })).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  }, 120000);

  it('does not write Orders or Payments while reading', async () => {
    const a = users[0]!;
    const before = await prisma.order.findMany({ where: { userId: a.id }, orderBy: { id: 'asc' }, select: { id: true, status: true, updatedAt: true, payment: { select: { status: true, updatedAt: true } } } });
    await get(a.token, '/api/orders'); await get(a.token, `/api/orders/${ref(orderIds.tieHigh!)}`);
    expect(await prisma.order.findMany({ where: { userId: a.id }, orderBy: { id: 'asc' }, select: { id: true, status: true, updatedAt: true, payment: { select: { status: true, updatedAt: true } } } })).toEqual(before);
  }, 120000);
});
