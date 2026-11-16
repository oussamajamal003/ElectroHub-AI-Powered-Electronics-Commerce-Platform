import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { RecommendationService } from './recommendation.service.js';
import { coPurchases } from './recommendation.sql.js';

/**
 * Task 04.4 FBT behavioural gate against a real, disposable PostgreSQL (run by scripts/recommendation-fbt-pg.cjs only).
 * Fixtures are created with a unique suffix and deleted afterwards. Nothing here reads or writes a hosted database.
 */
const suffix = randomUUID().slice(0, 8);
const created: { orderIds: string[]; productIds: string[]; categoryId?: string; userId?: string } = { orderIds: [], productIds: [] };

async function product(label: string, quantity: number) {
  const category = created.categoryId ?? (await prisma.category.create({ data: { name: `FBT QA ${suffix}`, slug: `fbt-qa-${suffix}` } })).id;
  created.categoryId = category;
  const row = await prisma.product.create({ data: { categoryId: category, sku: `FBTQA-${suffix}-${label}`, name: `FBT QA ${label} ${suffix}`,
    slug: `fbt-qa-${suffix}-${label.toLowerCase()}`, price: '100.00', status: 'ACTIVE', storefrontVisible: true, isTestFixture: false,
    inventory: { create: { quantity, lowStockAt: 5 } } } });
  created.productIds.push(row.id);
  return { id: row.id, name: row.name, sku: row.sku };
}

async function order(lines: { id: string; name: string; sku: string }[], status: 'CONFIRMED' | 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED',
  payment: { status: 'SUCCEEDED' | 'FAILED'; refunded?: boolean } | null) {
  const userId = created.userId!;
  const row = await prisma.order.create({ data: { userId, status, subtotal: '0.00', total: '0.00', checkoutAttemptId: randomUUID(),
    checkoutRequestHash: 'a'.repeat(64), deliveryMethod: 'STANDARD', paymentMethod: 'CARD', shippingPhone: '+10000000000',
    estimatedDeliveryStart: new Date('2026-12-01'), estimatedDeliveryEnd: new Date('2026-12-05'), shippingRecipient: 'FBT QA',
    shippingLine1: '1 QA Street', shippingCity: 'QA City', shippingCountry: 'US' } });
  created.orderIds.push(row.id);
  for (const line of lines) {
    await prisma.orderItem.create({ data: { orderId: row.id, productId: line.id, productName: line.name, sku: line.sku, unitPrice: '100.00', quantity: 1, lineTotal: '100.00' } });
  }
  if (payment) {
    await prisma.payment.create({ data: { orderId: row.id, status: payment.status, amount: '100.00', providerPaymentId: `fbt_qa_${randomUUID()}`,
      refundedAt: payment.refunded ? new Date('2026-12-02') : null } });
  }
  return row;
}

describe.sequential('FBT co-purchase behaviour on real PostgreSQL', () => {
  let anchor: { id: string; name: string; sku: string };
  let outOfStock: { id: string; name: string; sku: string };
  let inStock: { id: string; name: string; sku: string };
  let refunded: { id: string; name: string; sku: string };

  beforeAll(async () => {
    const role = await prisma.role.upsert({ where: { name: 'CUSTOMER' }, create: { name: 'CUSTOMER' }, update: {} });
    const user = await prisma.user.create({ data: { roleId: role.id, email: `fbt-qa-${suffix}@example.invalid`, firstName: 'FBT', lastName: 'QA' } });
    created.userId = user.id;
    anchor = await product('ANCHOR', 5);
    outOfStock = await product('OOS', 0);
    inStock = await product('INSTOCK', 5);
    refunded = await product('REFUNDED', 5);

    // Out-of-stock candidate: higher support (3) than the valid in-stock candidate (2).
    await order([anchor, outOfStock], 'CONFIRMED', { status: 'SUCCEEDED' });
    await order([anchor, outOfStock], 'DELIVERED', { status: 'SUCCEEDED' });
    await order([anchor, outOfStock], 'OUT_FOR_DELIVERY', { status: 'SUCCEEDED' });
    // Two distinct qualifying orders with the in-stock candidate; the first repeats it on a second line (must count once).
    await order([anchor, inStock, inStock], 'CONFIRMED', { status: 'SUCCEEDED' });
    await order([anchor, inStock], 'PREPARING', { status: 'SUCCEEDED' });
    // Excluded: refunded and cancelled orders must not contribute.
    await order([anchor, refunded], 'CONFIRMED', { status: 'SUCCEEDED', refunded: true });
    await order([anchor, refunded], 'CANCELLED', { status: 'SUCCEEDED' });
  });

  afterAll(async () => {
    if (created.orderIds.length) {
      await prisma.payment.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: created.orderIds } } });
    }
    if (created.productIds.length) {
      await prisma.inventory.deleteMany({ where: { productId: { in: created.productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: created.productIds } } });
    }
    if (created.categoryId) await prisma.category.deleteMany({ where: { id: created.categoryId } });
    if (created.userId) await prisma.user.deleteMany({ where: { id: created.userId } });
    await prisma.$disconnect();
  });

  it('skips the out-of-stock candidate that would otherwise take the only limit slot', async () => {
    const rows = await coPurchases([anchor.id], 2, 1);

    expect(rows.map(row => row.productId)).toEqual([inStock.id]);
    expect(rows[0].support).toBe(2);
  });

  it('counts distinct qualifying orders only and excludes refunded and cancelled ones', async () => {
    const rows = await coPurchases([anchor.id], 2, 8);

    expect(rows.map(row => row.productId)).toEqual([inStock.id]);
    expect(rows.some(row => row.productId === refunded.id || row.productId === outOfStock.id || row.productId === anchor.id)).toBe(false);
    // Anchor orders: the five qualifying orders containing the anchor (the refunded/cancelled ones are excluded).
    expect(rows[0].confidence).toBeCloseTo(2 / 5);
  });

  it('keeps the minimum-support threshold', async () => {
    await expect(coPurchases([anchor.id], 3, 8)).resolves.toEqual([]);
  });

  it('still uses an out-of-stock anchor as purchase context', async () => {
    const rows = await coPurchases([outOfStock.id], 2, 8);

    expect(rows.map(row => row.productId)).toEqual([anchor.id]);
    expect(rows[0].support).toBe(3);
  });

  it('returns FBT for a cart through the real service, never returning cart items or out-of-stock products', async () => {
    const service = new RecommendationService(() => null);

    const single = await service.forCart([anchor.id], 1);
    expect(single.mode).toBe('FREQUENTLY_BOUGHT_TOGETHER');
    expect(single.items.map(item => item.product.id)).toEqual([inStock.id]);

    const withCandidateInCart = await service.forCart([anchor.id, inStock.id], 4);
    expect(withCandidateInCart.isFallback).toBe(true);
    expect(withCandidateInCart.items).toEqual([]);
  });
});
