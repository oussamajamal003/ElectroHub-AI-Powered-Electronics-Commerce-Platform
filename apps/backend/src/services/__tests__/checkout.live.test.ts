import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import app from '../../app.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../utils/hash.js';
import { OrderService } from '../order.service.js';
import { InventoryService } from '../inventory.service.js';
import { AppError } from '../../middleware/errorHandler.js';

// Explicit opt-in only; never runs against PROD or curated accounts/products.
const enabled = process.env.CHECKOUT_LIVE_DEV === 'true';
if (enabled && (![env.DATABASE_URL, env.DIRECT_URL].every(value => value.includes('pzxekjybdiulzmssalfo')) ||
  [env.DATABASE_URL, env.DIRECT_URL].some(value => value.includes('yepfgjehdstlxbpespun')))) throw new Error('Checkout live tests require the exact DEV project.');
const prefix = `checkout-gate-${randomUUID()}`;
const users: string[] = []; const products: string[] = []; const categories: string[] = [];
const customers: { id: string; token: string }[] = [];
let categoryId: string;
const shipping = { recipient: 'Checkout Test', line1: '123 Disposable Street', city: 'Test City', postalCode: '12345', country: 'United States', phone: '+1 555 010 2000' };
const readCart = (token: string) => request(app).get('/api/cart').auth(token, { type: 'bearer' });
const quote = (token: string) => request(app).get('/api/checkout').auth(token, { type: 'bearer' });
const submit = (token: string, key: string, body: object) => request(app).post('/api/orders').auth(token, { type: 'bearer' }).set('Idempotency-Key', key).send(body);
async function product(stock: number, price = '19.99') {
  const id = randomUUID(); products.push(id);
  await prisma.product.create({ data: { id, categoryId, sku: `${prefix}-${id}`, slug: `${prefix}-${id}`, name: 'Disposable Checkout Product', price: new Prisma.Decimal(price),
    inventory: { create: { quantity: stock, lowStockAt: 5, status: stock === 0 ? 'OUT_OF_STOCK' : stock <= 5 ? 'LOW_STOCK' : 'IN_STOCK' } },
    images: { create: { url: '/images/catalog/variety/apple-phone-generic-01.jpg', isPrimary: true } } } });
  return id;
}
async function prepare(customer: { id: string; token: string }, lines: { productId: string; quantity: number }[]) {
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

describe.skipIf(!enabled)('LIVE DEV Checkout: real login/routes/PostgreSQL; disposable fixtures only', () => {
  beforeAll(async () => {
    const schema = await prisma.$queryRaw<{ present: boolean }[]>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='checkoutAttemptId') AS present`);
    expect(schema[0]?.present).toBe(true);
    // Verify the approved env account through real login; never mutate its Cart.
    const lines = readFileSync('.env', 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const email = lines.at(-2); const password = lines.at(-1);
    if (!email || !password || !/^[^=\s]+@[^=\s]+\.[^=\s]+$/.test(email)) throw new Error('Approved DEV login values missing from final env lines.');
    const approved = await request(app).post('/api/auth/login').send({ email, password });
    expect(approved.status).toBe(200); expect(typeof approved.body.accessToken).toBe('string');
    expect((await request(app).get('/api/auth/me').auth(approved.body.accessToken, { type: 'bearer' })).status).toBe(200);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
    const category = await prisma.category.create({ data: { name: prefix, slug: prefix, isActive: true } }); categoryId = category.id; categories.push(categoryId);
    for (let index = 0; index < 2; index++) {
      const id = randomUUID(); const email = `${prefix}-${index}@example.invalid`; const password = `Checkout-${randomUUID()}-A1!`;
      users.push(id); await prisma.user.create({ data: { id, email, passwordHash: await hashPassword(password), roleId: role.id, firstName: 'Checkout', lastName: 'Disposable', emailVerifiedAt: new Date() } });
      const login = await request(app).post('/api/auth/login').send({ email, password }); expect(login.status).toBe(200);
      expect(login.body.user.id).toBe(id); expect(login.body.user.role).toBe('CUSTOMER');
      customers.push({ id, token: login.body.accessToken });
    }
  }, 180000);
  afterAll(async () => {
    await prisma.order.deleteMany({ where: { userId: { in: users } } });
    await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: users } } } });
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
    expect(response.status).toBe(201); const saved = response.body.data.confirmation;
    expect(saved.subtotal).toBe('40.28'); expect(saved.total).toBe('50.27'); expect(saved.paymentState).toBe('UNPROCESSED'); expect(saved.items).toHaveLength(2);
    expect(await inventory(first)).toBe(0); expect(await inventory(second)).toBe(2);
    const after = await snapshot(customer.id, [first, second]); expect(after.orders).toBe(before.orders + 1); expect(after.items).toBe(before.items + 2); expect(after.cart).toEqual([]);
    expect((await readCart(customer.token)).body.data.items).toEqual([]);
    const replay = await submit(customer.token, key, body); expect(replay.status).toBe(200); expect(replay.body.data.confirmation).toEqual(saved);
    expect(await snapshot(customer.id, [first, second])).toEqual(after);
    expect((await submit(customer.token, key, { ...body, deliveryMethod: 'STANDARD' })).body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    const own = await request(app).get(`/api/orders/${saved.orderReference}/confirmation`).auth(customer.token, { type: 'bearer' }); expect(own.body.data).toEqual(saved);
    expect((await request(app).get(`/api/orders/${saved.orderReference}/confirmation`).auth(other.token, { type: 'bearer' })).status).toBe(404);
    const recovered = await request(app).get(`/api/orders/attempts/${key}/confirmation`).auth(customer.token, { type: 'bearer' }); expect(recovered.body.data).toEqual(saved);
    expect(await prisma.payment.count({ where: { order: { userId: customer.id } } })).toBe(0); expect(await prisma.delivery.count({ where: { order: { userId: customer.id } } })).toBe(0);
    console.log(JSON.stringify({ gate: 'multi-item commit/idempotency/ownership/exact-stock', before, after, reference: saved.orderReference }));
  }, 180000);
  it('rolls back every earlier write after a controlled second-item Inventory failure (real transaction)', async () => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer');
    const ids = [await product(5), await product(5)].sort();
    const body = await prepare(customer, ids.map(productId => ({ productId, quantity: 2 }))); const before = await snapshot(customer.id, ids);
    class FailSecondInventory extends InventoryService {
      calls = 0;
      override async decreaseStock(productId: string, amount: number, tx?: Prisma.TransactionClient) {
        if (++this.calls === 2) throw new AppError('Controlled second-item failure.', 409, 'INVENTORY_CONFLICT');
        return super.decreaseStock(productId, amount, tx);
      }
    }
    const fault = new FailSecondInventory();
    await expect(new OrderService(prisma, fault).create(customer.id, randomUUID(), body)).rejects.toMatchObject({ code: 'INVENTORY_CONFLICT' });
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
    expect(response.status).toBe(409); expect(response.body.error.code).toBe(change === 'price' ? 'CHECKOUT_CHANGED' : change === 'stock' ? 'CART_STOCK_CONFLICT' : 'PRODUCT_UNAVAILABLE');
    expect(await snapshot(customer.id, [id])).toEqual(before);
  }, 180000);
});
