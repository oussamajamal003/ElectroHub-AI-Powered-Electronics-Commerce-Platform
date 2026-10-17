import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { CartService } from '../cart.service.js';

// Offline round-trip accounting for POST /api/cart/items. The recording client counts every Prisma operation
// (each is at least one database statement; `begin`/`commit` are the transaction envelope). This proves how many
// sequential database round trips the code path issues. It does NOT measure latency: that needs a real database.
const calls = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../../utils/logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

const productId = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const otherId = '9a2813b4-a388-44d3-b51e-5d4c40386688';
const userId = '62a990ff-7909-4bbb-b42f-8f20b6d97af4';
const product = (id: string) => ({ id, slug: 'phone', name: 'Phone', sku: 'S', categoryId: 'c', price: new Prisma.Decimal('19.99'),
  status: 'ACTIVE', isTestFixture: false, category: { name: 'Phones', isActive: true }, inventory: { quantity: 50, lowStockAt: 2 },
  images: [{ url: '/phone.jpg', altText: 'Phone' }] });

/** An in-memory customer Cart. `lines` start with one existing line for `otherId` (and optionally `productId`). */
function recordingClient(options: { cart: boolean; existingLine: boolean }) {
  const lines = [{ id: 'line-other', productId: otherId, quantity: 1 }];
  if (options.existingLine) lines.push({ id: 'line-1', productId, quantity: 2 });
  let cartExists = options.cart;
  const withProducts = () => lines.map(line => ({ ...line, product: product(line.productId) }));
  const client = {
    cart: {
      upsert: vi.fn(async () => { calls.list.push('cart.upsert'); cartExists = true; return { id: 'cart-1' }; }),
      findUnique: vi.fn(async ({ select }: { select?: { items?: unknown } }) => {
        calls.list.push('cart.findUnique'); if (!cartExists) return null;
        return select?.items ? { id: 'cart-1', items: (select.items as { select: { product?: unknown } }).select.product ? withProducts() : lines } : { id: 'cart-1' };
      }),
    },
    cartItem: {
      findUnique: vi.fn(async ({ where }: { where: { cartId_productId: { productId: string } } }) => {
        calls.list.push('cartItem.findUnique'); return lines.find(line => line.productId === where.cartId_productId.productId) ?? null; }),
      findMany: vi.fn(async () => { calls.list.push('cartItem.findMany'); return lines.map(({ id, productId: pid, quantity }) => ({ id, productId: pid, quantity })); }),
      count: vi.fn(async () => { calls.list.push('cartItem.count'); return lines.length; }),
      create: vi.fn(async ({ data }: { data: { productId: string; quantity: number } }) => { calls.list.push('cartItem.create'); lines.push({ id: 'new', productId: data.productId, quantity: data.quantity }); return {}; }),
      update: vi.fn(async ({ data }: { data: { quantity: number } }) => { calls.list.push('cartItem.update'); lines.find(line => line.productId === productId)!.quantity = data.quantity; return {}; }),
    },
    product: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => { calls.list.push('product.findMany'); return where.id.in.map(product); }) },
    $queryRaw: vi.fn(async (query: { strings?: string[]; sql?: string }) => {
      const text = (query.strings ?? [query.sql ?? '']).join('?'); calls.list.push(/WHERE "userId"/.test(text) ? 'lock.byUser' : 'lock.byId');
      return /WHERE "userId"/.test(text) ? (cartExists ? [{ id: 'cart-1' }] : []) : [{ id: 'cart-1' }];
    }),
    $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) => { calls.list.push('begin'); const value = await operation(client); calls.list.push('commit'); return value; }),
  };
  return { client, lines };
}

beforeEach(() => { calls.list = []; });

describe('POST /api/cart/items database round trips (offline accounting)', () => {
  const scenarios = [
    ['existing Cart, existing line', { cart: true, existingLine: true }],
    ['existing Cart, new line', { cart: true, existingLine: false }],
    ['first-ever Cart', { cart: false, existingLine: false }],
  ] as const;
  for (const [name, options] of scenarios) {
    it(`${name}: count and sequence`, async () => {
      const { client } = recordingClient(options);
      const result = await new CartService(client as never).add(userId, { productId, quantity: 1 });
      const line = result.items.find((item: { productId: string }) => item.productId === productId);
      expect(line?.quantity).toBe(options.existingLine ? 3 : 1);
      // Regression guard (counts include begin/commit). Measured before the optimization: 9 / 10 / 10.
      expect(calls.list.length).toBeLessThanOrEqual(options.cart ? 7 : 9);
      expect(calls.list).toEqual(options.cart
        ? ['begin', 'lock.byUser', 'cartItem.findMany', 'product.findMany', options.existingLine ? 'cartItem.update' : 'cartItem.create', 'commit', 'cart.findUnique']
        : ['begin', 'lock.byUser', 'cart.upsert', 'lock.byId', 'cartItem.findMany', 'product.findMany', 'cartItem.create', 'commit', 'cart.findUnique']);
    });
  }
});

