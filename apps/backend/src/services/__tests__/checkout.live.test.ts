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
import { OrderService } from '../order.service.js';
import { InventoryService, type LockedInventorySnapshot } from '../inventory.service.js';
import { AppError } from '../../middleware/errorHandler.js';
import { currentCart } from '../cart.service.js';
import { checkoutRequestSchema, checkoutTotals, requestHash } from '../checkout.domain.js';
import type { ProviderIntent } from '../payment.domain.js';

// Explicit opt-in only; never runs against PROD or curated accounts/products.
const enabled = process.env.CHECKOUT_LIVE_DEV === 'true';
const testSafety = createRequire(resolve('package.json'))('./scripts/stripe-gate-safety.cjs') as {
  assertSyntheticDevEnvironment(values: Record<string, unknown>): void;
  syntheticCleanupAllowed(setupCompleted: boolean, testStates: Array<string | undefined>): boolean;
};
if (enabled) {
  // Reuse the guarded harness endpoint parser; a project ref in a password,
  // path or deceptive hostname is not evidence of DEV identity.
  testSafety.assertSyntheticDevEnvironment({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED });
}
const prefix = `checkout-gate-${randomUUID()}`;
const users: string[] = []; const products: string[] = []; const categories: string[] = [];
const customers: { id: string; token: string }[] = [];
let categoryId: string;
let setupCompleted = false;
const shipping = { recipient: 'Checkout Test', line1: '123 Disposable Street', city: 'Test City', postalCode: '12345', country: 'United States', phone: '+1 555 010 2000' };
const readCart = (token: string) => request(app).get('/api/cart').auth(token, { type: 'bearer' });
const quote = (token: string) => request(app).get('/api/checkout').auth(token, { type: 'bearer' });
// 03.6 closes public unpaid POST /orders. This suite now tests the reused purchase
// transaction with synthetic verified provider facts; real Stripe/API proof is a separate gate.
async function authorization(customer: { id: string }, key: string, body: object) {
  const input = checkoutRequestSchema.parse(body); const current = await currentCart(customer.id, prisma);
  const cart = await prisma.cart.findUniqueOrThrow({ where: { userId: customer.id } });
  const totals = checkoutTotals(current.data.subtotal, input.deliveryMethod === 'EXPRESS' ? '9.99' : input.deliveryMethod === 'OVERNIGHT' ? '19.99' : '0.00');
  let saved = await prisma.paymentAttempt.findUnique({ where: { userId_idempotencyKey: { userId: customer.id, idempotencyKey: key } }, include: { work: true } });
  if (saved && saved.requestHash !== requestHash(input)) throw new AppError('Different request.', 409, 'IDEMPOTENCY_CONFLICT');
  if (!saved) {
    try {
      saved = await prisma.paymentAttempt.create({ data: { userId: customer.id, cartId: cart.id, cartIdentity: cart.id, activeCartId: cart.id,
        idempotencyKey: key, request: input, requestHash: requestHash(input), revision: input.expectedRevision,
        subtotal: totals.subtotal, shippingCost: totals.shipping, total: totals.total, amountCents: new Prisma.Decimal(totals.total).mul(100).toNumber(),
        stripeAccountId: 'acct_synthetic_core_gate', providerIntentId: `pi_core_${key}`, state: 'AUTHORIZED', expiresAt: new Date(Date.now() + 600000),
        work: { create: { state: 'LEASED', leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 180000) } },
        items: { create: current.data.items.map(item => { const product = current.products.get(item.productId); if (!product) throw new Error('Missing fixture product');
          return { productId: item.productId, quantity: item.quantity, unitPrice: product.price, lineTotal: product.price.mul(item.quantity), productName: product.name, sku: product.sku, imageUrl: product.images[0]?.url }; }) } }, include: { work: true } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      saved = await prisma.paymentAttempt.findUnique({ where: { userId_idempotencyKey: { userId: customer.id, idempotencyKey: key } }, include: { work: true } });
      if (!saved) throw new AppError('Another Cart attempt.', 409, 'PAYMENT_RECOVERY_PENDING');
    }
  }
  if (!saved.work?.leaseToken) throw new Error('Missing fixture lease');
  const intent: ProviderIntent = { id: saved.providerIntentId ?? '', account: saved.stripeAccountId, livemode: false,
    amount: saved.amountCents, currency: 'usd', captureMethod: 'manual', status: 'requires_capture', capturable: saved.amountCents,
    received: 0, methodType: 'card', clientSecret: null, attemptId: saved.id, declined: false, card: null, captureBefore: new Date(Date.now() + 600000) };
  return { id: saved.id, intent, lease: saved.work.leaseToken };
}
async function submit(token: string, key: string, body: object) {
  const customer = customers.find(value => value.token === token); if (!customer) throw new Error('Missing authenticated fixture');
  try { const saved = await authorization(customer, key, body); const data = await new OrderService().commitAuthorized(saved.id, saved.intent, saved.lease);
    return { status: data.replayed ? 200 : 201, body: { data, error: undefined } }; }
  catch (error) { if (error instanceof AppError) return { status: error.statusCode, body: { data: undefined, error: { code: error.code } } }; throw error; }
}
async function product(stock: number, price = '19.99') {
  const id = randomUUID(); products.push(id);
  // Only this run's fresh, owned products are customer-purchasable. Hidden
  // internal fixtures must remain rejected by the ordinary Cart APIs.
  await prisma.product.create({ data: { id, categoryId, sku: `${prefix}-${id}`, slug: `${prefix}-${id}`, name: 'Disposable Checkout Product', price: new Prisma.Decimal(price), isTestFixture: false, storefrontVisible: false,
    inventory: { create: { quantity: stock, lowStockAt: 5, status: stock === 0 ? 'OUT_OF_STOCK' : stock <= 5 ? 'LOW_STOCK' : 'IN_STOCK' } },
    images: { create: { url: '/images/catalog/variety/apple-phone-generic-01.jpg', isPrimary: true } } } });
  return id;
}
async function prepare(customer: { id: string; token: string }, lines: { productId: string; quantity: number }[]) {
  // Release claims belonging only to previous synthetic-provider cases in this isolated suite.
  await prisma.paymentAttempt.updateMany({ where: { userId: customer.id }, data: { activeCartId: null } });
  const cart = await prisma.cart.upsert({ where: { userId: customer.id }, update: {}, create: { userId: customer.id } });
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  for (const line of lines) {
    const response = await request(app).post('/api/cart/items').auth(customer.token, { type: 'bearer' }).send(line);
    expect(response.status).toBe(201);
  }
  const response = await quote(customer.token); expect(response.status).toBe(200);
  return { shipping, deliveryMethod: 'EXPRESS', paymentMethod: 'CARD', expectedRevision: response.body.data.cartRevision };
}
const inventory = async (id: string) => (await prisma.inventory.findUniqueOrThrow({ where: { productId: id } })).quantity;
async function snapshot(userId: string, ids: string[]) {
  return { orders: await prisma.order.count({ where: { userId } }), items: await prisma.orderItem.count({ where: { order: { userId } } }),
    cart: (await prisma.cartItem.findMany({ where: { cart: { userId } }, orderBy: { productId: 'asc' }, select: { productId: true, quantity: true } })),
    inventory: await prisma.inventory.findMany({ where: { productId: { in: ids } }, orderBy: { productId: 'asc' }, select: { productId: true, quantity: true, status: true } }) };
}

describe.skipIf(!enabled)('LIVE DEV purchase core: real login/PostgreSQL, synthetic authorization; not real Stripe proof', () => {
  beforeAll(async () => {
    const schema = await prisma.$queryRaw<{ present: boolean }[]>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='checkoutAttemptId') AS present`);
    expect(schema[0]?.present).toBe(true);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
    const category = await prisma.category.create({ data: { name: prefix, slug: prefix, isActive: true } }); categoryId = category.id; categories.push(categoryId);
    for (let index = 0; index < 2; index++) {
      const id = randomUUID(); const email = `${prefix}-${index}@example.invalid`; const password = `Checkout-${randomUUID()}-A1!`;
      users.push(id); await prisma.user.create({ data: { id, email, passwordHash: await hashPassword(password), roleId: role.id, firstName: 'Checkout', lastName: 'Disposable', emailVerifiedAt: new Date() } });
      const login = await request(app).post('/api/auth/login').send({ email, password }); expect(login.status).toBe(200);
      expect(login.body.user.id).toBe(id); expect(login.body.user.role).toBe('CUSTOMER');
      customers.push({ id, token: login.body.accessToken });
      expect((await request(app).get('/api/auth/me').auth(login.body.accessToken, { type: 'bearer' })).status).toBe(200);
    }
    setupCompleted = true;
  }, 180000);
  afterAll(async (_context, suite) => {
    // Failed/unknown transactions must remain available for read-only diagnosis.
    // A partial setup or a skipped/failing test is not permission to erase evidence.
    if (!testSafety.syntheticCleanupAllowed(setupCompleted, suite.tasks.map(task => task.result?.state))) {
      console.log('LIVE DEV cleanup BLOCKED; owned fixtures and transaction evidence preserved.');
      await prisma.$disconnect();
      return;
    }
    await prisma.stripeEvent.deleteMany({ where: { attempt: { userId: { in: users } } } });
    await prisma.paymentWork.deleteMany({ where: { attempt: { userId: { in: users } } } });
    await prisma.paymentAttemptItem.deleteMany({ where: { attempt: { userId: { in: users } } } });
    await prisma.paymentAttempt.deleteMany({ where: { userId: { in: users } } });
    await prisma.payment.deleteMany({ where: { order: { userId: { in: users } } } });
    await prisma.order.deleteMany({ where: { userId: { in: users } } });
    await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: users } } } });
    await prisma.paymentAttemptItem.deleteMany({ where: { productId: { in: products } } });
    await prisma.product.deleteMany({ where: { id: { in: products } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.category.deleteMany({ where: { id: { in: categories } } });
    expect(await prisma.order.count({ where: { userId: { in: users } } })).toBe(0);
    expect(await prisma.product.count({ where: { id: { in: products } } })).toBe(0);
    expect(await prisma.user.count({ where: { id: { in: users } } })).toBe(0);
    console.log('LIVE DEV cleanup PASS; no curated fixtures, no PROD, no seed.');
    await prisma.$disconnect();
  }, 180000);
  it('atomically commits multiple items, exact stock, snapshots, empty Cart, replay and ownership', async () => {
    const customer = customers[0]; const other = customers[1]; if (!customer || !other) throw new Error('Missing customer fixtures');
    const first = await product(2); const second = await product(5, '0.10');
    const body = await prepare(customer, [{ productId: first, quantity: 2 }, { productId: second, quantity: 3 }]); const key = randomUUID();
    const before = await snapshot(customer.id, [first, second]); const response = await submit(customer.token, key, body);
    expect(response.status).toBe(201); if (!response.body.data) throw new Error('Missing committed purchase'); const saved = response.body.data.confirmation;
    expect(saved.subtotal).toBe('40.28'); expect(saved.total).toBe('50.27'); expect(saved.paymentState).toBe('PENDING'); expect(saved.items).toHaveLength(2);
    expect(await inventory(first)).toBe(0); expect(await inventory(second)).toBe(2);
    const after = await snapshot(customer.id, [first, second]); expect(after.orders).toBe(before.orders + 1); expect(after.items).toBe(before.items + 2); expect(after.cart).toEqual([]);
    expect((await readCart(customer.token)).body.data.items).toEqual([]);
    const replay = await submit(customer.token, key, body); expect(replay.status).toBe(200); if (!replay.body.data) throw new Error('Missing replay'); expect(replay.body.data.confirmation).toEqual(saved);
    expect(await snapshot(customer.id, [first, second])).toEqual(after);
    expect((await submit(customer.token, key, { ...body, deliveryMethod: 'STANDARD' })).body.error?.code).toBe('IDEMPOTENCY_CONFLICT');
    const own = await request(app).get(`/api/orders/${saved.orderReference}/confirmation`).auth(customer.token, { type: 'bearer' }); expect(own.body.data).toEqual(saved);
    expect((await request(app).get(`/api/orders/${saved.orderReference}/confirmation`).auth(other.token, { type: 'bearer' })).status).toBe(404);
    const recovered = await request(app).get(`/api/orders/attempts/${key}/confirmation`).auth(customer.token, { type: 'bearer' }); expect(recovered.body.data).toEqual(saved);
    expect(await prisma.payment.count({ where: { order: { userId: customer.id } } })).toBe(1); expect(await prisma.delivery.count({ where: { order: { userId: customer.id } } })).toBe(0);
    console.log(JSON.stringify({ gate: 'multi-item commit/idempotency/ownership/exact-stock', before, after, reference: saved.orderReference }));
  }, 180000);
  it('rolls back every earlier write after a controlled second-item Inventory failure (real transaction)', async () => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer');
    const ids = [await product(5), await product(5)].sort();
    const body = await prepare(customer, ids.map(productId => ({ productId, quantity: 2 }))); const before = await snapshot(customer.id, ids);
    class FailSecondInventory extends InventoryService {
      calls = 0;
      override async decreaseStock(productId: string, amount: number, tx?: Prisma.TransactionClient, lockedInventory?: LockedInventorySnapshot) {
        if (++this.calls === 2) throw new AppError('Controlled second-item failure.', 409, 'INVENTORY_CONFLICT');
        return super.decreaseStock(productId, amount, tx, lockedInventory);
      }
    }
    const fault = new FailSecondInventory();
    const auth = await authorization(customer, randomUUID(), body);
    await expect(new OrderService(prisma, fault).commitAuthorized(auth.id, auth.intent, auth.lease)).rejects.toMatchObject({ code: 'INVENTORY_CONFLICT' });
    expect(fault.calls).toBe(2); expect(await snapshot(customer.id, ids)).toEqual(before);
    console.log(JSON.stringify({ gate: 'real rollback after earlier Order/items/Inventory writes', before, after: await snapshot(customer.id, ids) }));
  }, 180000);
  it('allows only one customer to purchase the last unit under genuine concurrency', async () => {
    const first = customers[0]; const second = customers[1]; if (!first || !second) throw new Error('Missing customers');
    const id = await product(1); const a = await prepare(first, [{ productId: id, quantity: 1 }]); const b = await prepare(second, [{ productId: id, quantity: 1 }]);
    const count = await prisma.order.count({ where: { items: { some: { productId: id } } } });
    const results = await Promise.all([submit(first.token, randomUUID(), a), submit(second.token, randomUUID(), b)]);
    expect(results.map(response => response.status).sort()).toEqual([201, 409]); expect(await inventory(id)).toBe(0);
    expect(await prisma.order.count({ where: { items: { some: { productId: id } } } })).toBe(count + 1);
    const winner = results.findIndex(response => response.status === 201); const loser = winner === 0 ? second : first;
    expect((await readCart(loser.token)).body.data.items).toMatchObject([{ productId: id, quantity: 1 }]);
    console.log(JSON.stringify({ gate: 'two-customer last unit', statuses: results.map(response => response.status), inventory: 0, orderDelta: 1 }));
  }, 180000);
  it.each(['same', 'different'])('protects one Cart against concurrent %s attempt keys', async mode => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer');
    const id = await product(10); const body = await prepare(customer, [{ productId: id, quantity: 2 }]); const key = randomUUID();
    const results = await Promise.all([submit(customer.token, key, body), submit(customer.token, mode === 'same' ? key : randomUUID(), body)]);
    expect(results.filter(response => response.status === 201)).toHaveLength(1);
    expect(results.find(response => response.status !== 201)?.status).toBe(mode === 'same' ? 200 : 409);
    expect(await inventory(id)).toBe(8); expect(await prisma.order.count({ where: { items: { some: { productId: id } } } })).toBe(1);
    expect((await readCart(customer.token)).body.data.items).toEqual([]);
    console.log(JSON.stringify({ gate: `same-Cart ${mode} key`, statuses: results.map(response => response.status), inventory: 8, orders: 1 }));
  }, 180000);
  it.each(['stock', 'price', 'inactive'])('preserves all effects when current %s changes before submission', async change => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer');
    const id = await product(5); const body = await prepare(customer, [{ productId: id, quantity: 2 }]);
    if (change === 'stock') await prisma.inventory.update({ where: { productId: id }, data: { quantity: 1, status: 'LOW_STOCK' } });
    if (change === 'price') await prisma.product.update({ where: { id }, data: { price: '29.99' } });
    if (change === 'inactive') await prisma.product.update({ where: { id }, data: { status: 'INACTIVE' } });
    const before = await snapshot(customer.id, [id]); const response = await submit(customer.token, randomUUID(), body);
    expect(response.status).toBe(409); expect(response.body.error?.code).toBe(change === 'price' ? 'CHECKOUT_CHANGED' : change === 'stock' ? 'CART_STOCK_CONFLICT' : 'PRODUCT_UNAVAILABLE');
    expect(await snapshot(customer.id, [id])).toEqual(before);
  }, 180000);
});
