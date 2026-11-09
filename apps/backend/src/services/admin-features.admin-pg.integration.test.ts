import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { AdminAnalyticsService, recommendationAttributions } from './admin-analytics.service.js';
import { storeSettings } from './store-settings.service.js';
import { CheckoutService } from './checkout.service.js';
import { invalidateShippingConfig } from './shipping-config.js';
import { RecommendationAdminService } from './recommendation-admin.service.js';
import { recommendationService } from './recommendation.service.js';
import { issueImpressionToken } from './recommendation-token.js';
import { AdminCatalogService } from './admin-catalog.service.js';

/**
 * Task 05.2 business behaviour on a real, freshly migrated disposable PostgreSQL (run only by scripts/admin-security-pg.cjs):
 * analytics reconcile to seeded authoritative rows (ANA-01..05), shipping settings drive new checkout quotes without touching history
 * (COM-01), featured pins obey eligibility, expiry and preview isolation (REC-02/03), and bulk status writes persist item audits (CAT-01).
 * Assertions on shared aggregates use deltas.
 */
const suffix = randomUUID().slice(0, 8);
const actor = { userId: randomUUID() };
const day = 86_400_000;
const ids: { customerA?: string; customerB?: string; category?: string; p1?: string; p2?: string; o1?: string } = {};

async function customer(label: string) {
  const role = await prisma.role.upsert({ where: { name: 'CUSTOMER' }, create: { name: 'CUSTOMER' }, update: {} });
  return (await prisma.user.create({ data: { roleId: role.id, email: `${label}-${suffix}@qa.invalid`, firstName: 'QA', lastName: label, emailVerifiedAt: new Date() } })).id;
}
async function product(label: string, price: string) {
  return (await prisma.product.create({ data: { categoryId: ids.category!, sku: `F52-${suffix}-${label}`, name: `F52 ${label} ${suffix}`,
    slug: `f52-${suffix}-${label.toLowerCase()}`, price, status: 'ACTIVE', storefrontVisible: true, isTestFixture: false,
    inventory: { create: { quantity: 10, lowStockAt: 2 } } } })).id;
}
async function paidOrder(userId: string, lines: { productId: string; quantity: number; unitPrice: string }[], payment: {
  status: 'SUCCEEDED' | 'FAILED' | 'REFUNDED'; paidAt: Date | null; amount: string }) {
  const order = await prisma.order.create({ data: { userId, status: 'CONFIRMED', subtotal: payment.amount, total: payment.amount, checkoutAttemptId: randomUUID(),
    checkoutRequestHash: 'b'.repeat(64), deliveryMethod: 'STANDARD', paymentMethod: 'CARD', shippingPhone: '+10000000000',
    estimatedDeliveryStart: new Date('2026-12-01'), estimatedDeliveryEnd: new Date('2026-12-05'), shippingRecipient: 'QA', shippingLine1: '1 QA Street',
    shippingCity: 'QA City', shippingCountry: 'US' } });
  for (const line of lines) {
    const product = await prisma.product.findUniqueOrThrow({ where: { id: line.productId }, select: { name: true, sku: true } });
    await prisma.orderItem.create({ data: { orderId: order.id, productId: line.productId, productName: product.name, sku: product.sku, unitPrice: line.unitPrice,
      quantity: line.quantity, lineTotal: (Number(line.unitPrice) * line.quantity).toFixed(2) } });
  }
  await prisma.payment.create({ data: { orderId: order.id, status: payment.status, amount: payment.amount, paidAt: payment.paidAt,
    providerPaymentId: `qa_${randomUUID()}`, refundedAt: payment.status === 'REFUNDED' ? new Date() : null } });
  return order.id;
}

describe.skipIf(process.env.ADMIN_SECURITY_PG_RUN !== '1').sequential('Task 05.2 settings, analytics and recommendations on real PostgreSQL', { timeout: 60_000 }, () => {
  const analytics = new AdminAnalyticsService();
  let before: Awaited<ReturnType<AdminAnalyticsService['overview']>>;
  let beforeReco: Awaited<ReturnType<AdminAnalyticsService['recommendations']>>;
  let beforeImage: Awaited<ReturnType<AdminAnalyticsService['imageSearch']>>;

  beforeAll(async () => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error('Refusing to run against a non-loopback database.');
    before = await analytics.overview('30d');
    beforeReco = await analytics.recommendations('30d');
    beforeImage = await analytics.imageSearch('30d');
    ids.category = (await prisma.category.create({ data: { name: `F52 QA ${suffix}`, slug: `f52-qa-${suffix}` } })).id;
    ids.p1 = await product('P1', '50.00');
    ids.p2 = await product('P2', '30.00');
    ids.customerA = await customer('consenting');
    ids.customerB = await customer('anonymous');
    await prisma.recommendationPreference.create({ data: { userId: ids.customerA, personalizationEnabled: true, consentedAt: new Date() } });
    // A consenting customer clicked P1 in a recommendation an hour before ordering it; the non-consenting one clicked P2.
    await prisma.productInteraction.create({ data: { userId: ids.customerA, productId: ids.p1, eventType: 'RECOMMENDATION_CLICK', surface: 'home',
      idempotencyKey: `k-${suffix}-a`, occurredAt: new Date(Date.now() - 3600_000) } });
    await prisma.productInteraction.create({ data: { userId: ids.customerB, productId: ids.p2, eventType: 'RECOMMENDATION_CLICK', surface: 'home',
      idempotencyKey: `k-${suffix}-b`, occurredAt: new Date(Date.now() - 3600_000) } });
    ids.o1 = await paidOrder(ids.customerA, [{ productId: ids.p1, quantity: 2, unitPrice: '50.00' }], { status: 'SUCCEEDED', paidAt: new Date(Date.now() - day), amount: '100.00' });
    await paidOrder(ids.customerB, [{ productId: ids.p2, quantity: 1, unitPrice: '30.00' }], { status: 'SUCCEEDED', paidAt: new Date(Date.now() - 2 * day), amount: '30.00' });
    await paidOrder(ids.customerA, [{ productId: ids.p2, quantity: 1, unitPrice: '30.00' }], { status: 'REFUNDED', paidAt: new Date(Date.now() - 3 * day), amount: '999.00' });
    await paidOrder(ids.customerB, [{ productId: ids.p2, quantity: 1, unitPrice: '30.00' }], { status: 'FAILED', paidAt: null, amount: '500.00' });
    await paidOrder(ids.customerB, [{ productId: ids.p2, quantity: 1, unitPrice: '30.00' }], { status: 'SUCCEEDED', paidAt: new Date(Date.now() - 40 * day), amount: '70.00' });
  });

  it('groups UTC-naive stored timestamps by the correct local day across the New York DST jump', async () => {
    const rows = await prisma.$queryRaw<{ bucket: string }[]>(Prisma.sql`
      SELECT to_char(date_trunc('day', TIMESTAMP '2026-03-08 04:30:00' AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York'), 'YYYY-MM-DD') AS bucket
      UNION ALL
      SELECT to_char(date_trunc('day', TIMESTAMP '2026-03-08 07:30:00' AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York'), 'YYYY-MM-DD') AS bucket`);
    expect(rows.map(row => row.bucket)).toEqual(['2026-03-07', '2026-03-08']);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('ANA-01 revenue, paid orders and AOV reconcile to SUCCEEDED payments only, with the equal-length previous window', async () => {
    const after = await analytics.overview('30d');
    const usd = (value: typeof after) => value.data.byCurrency.find(row => row.currency === 'USD');
    const delta = (a?: string | null, b?: string | null) => (Number(a ?? 0) - Number(b ?? 0)).toFixed(2);
    expect(delta(usd(after)?.revenue.current, usd(before)?.revenue.current)).toBe('130.00'); // 100 + 30; refunded 999 and failed 500 excluded
    expect(delta(usd(after)?.revenue.previous, usd(before)?.revenue.previous)).toBe('70.00');
    expect(after.data.paidOrders.current - before.data.paidOrders.current).toBe(2);
    expect(after.data.newCustomers.current - before.data.newCustomers.current).toBe(2);
    if (before.data.paidOrders.current === 0) expect(usd(after)?.averageOrderValue.current).toBe('65.00');
    expect(after.meta.definitions).toHaveProperty('revenue');
    const products = await analytics.products('30d');
    expect(JSON.stringify(products.data)).toContain(ids.p1!);
  });

  it('ANA-01 images select one published catalog thumbnail without multiplying sales', async () => {
    const before = (await analytics.products('30d')).data;
    await prisma.productImage.createMany({ data: [
      { productId: ids.p1!, url: '/secondary.jpg', isPrimary: false, sortOrder: 0 },
      { productId: ids.p1!, url: '/retired.jpg', isPrimary: false, sortOrder: -1, mediaState: 'RETIRED' },
      { productId: ids.p1!, url: '/later.jpg', isPrimary: false, sortOrder: 2 },
      { productId: ids.p1!, url: '/primary.jpg', altText: 'Catalog primary', isPrimary: true, sortOrder: 5 },
    ] });
    const after = (await analytics.products('30d')).data;
    for (const key of ['byUnits', 'byAmount'] as const) {
      const withoutImage = (rows: typeof after.byUnits) => rows.map(({ image: _image, ...row }) => row);
      expect(withoutImage(after[key])).toEqual(withoutImage(before[key]));
      expect(after[key].find(row => row.productId === ids.p1)?.image).toEqual({ url: '/primary.jpg', altText: 'Catalog primary' });
      expect(after[key].find(row => row.productId === ids.p2)?.image).toBeNull();
    }
    await prisma.productImage.updateMany({ where: { productId: ids.p1! }, data: { isPrimary: false } });
    expect((await analytics.products('30d')).data.byUnits.find(row => row.productId === ids.p1)?.image?.url).toBe('/secondary.jpg');
  });

  it('ANA-02/ANA-03 recommendation CTR uses deduplicated events; conversion counts only the consenting click-then-paid order', async () => {
    const token = issueImpressionToken({ mode: 'POPULAR_PRODUCTS', strategy: 'MEASURED_POPULARITY', surface: 'home', productIds: [ids.p1!, ids.p2!] });
    await recommendationService.recordEvents(token, [{ productId: ids.p1!, type: 'IMPRESSION' }, { productId: ids.p2!, type: 'IMPRESSION' }, { productId: ids.p1!, type: 'CLICK' }]);
    await recommendationService.recordEvents(token, [{ productId: ids.p1!, type: 'CLICK' }]); // client retry: deduplicated
    const after = await analytics.recommendations('30d');
    expect(after.data.impressions - beforeReco.data.impressions).toBe(2);
    expect(after.data.clicks - beforeReco.data.clicks).toBe(1);
    expect(after.data.conversion.attributedOrders - beforeReco.data.conversion.attributedOrders).toBe(1);
    expect(after.data.conversion.model).toBe('LAST_CLICK_7D_CONSENTED');
  });

  it('ANA-03 selects the deterministic latest same-product click per paid item, excluding absent consent, failed/refunded and expired clicks', async () => {
    const baseline = await analytics.recommendations('30d');
    const optedIn = await customer('lastclick');
    const noConsent = await customer('no-consent');
    const expired = await customer('expired');
    await prisma.recommendationPreference.createMany({ data: [optedIn, expired].map(userId => ({ userId, personalizationEnabled: true, consentedAt: new Date() })) });
    const latestTime = new Date(Date.now() - 60_000);
    const latestIds = ['00000000-0000-4000-8000-000000000001', 'ffffffff-ffff-4fff-8fff-ffffffffffff'];
    await prisma.productInteraction.createMany({ data: [
      { userId: optedIn, productId: ids.p1!, eventType: 'RECOMMENDATION_CLICK', surface: 'home', idempotencyKey: `lc-old-${suffix}`, occurredAt: new Date(latestTime.getTime() - 60_000) },
      ...latestIds.map((id, index) => ({ id, userId: optedIn, productId: ids.p1!, eventType: 'RECOMMENDATION_CLICK', surface: 'home', idempotencyKey: `lc-tie-${index}-${suffix}`, occurredAt: latestTime })),
      { userId: noConsent, productId: ids.p1!, eventType: 'RECOMMENDATION_CLICK', surface: 'home', idempotencyKey: `lc-no-consent-${suffix}`, occurredAt: latestTime },
      { userId: expired, productId: ids.p1!, eventType: 'RECOMMENDATION_CLICK', surface: 'home', idempotencyKey: `lc-expired-${suffix}`, occurredAt: new Date(Date.now() - 8 * day) },
    ] });
    const purchase = await paidOrder(optedIn, [{ productId: ids.p1!, quantity: 3, unitPrice: '50.00' }], { status: 'SUCCEEDED', paidAt: new Date(), amount: '150.00' });
    const excluded = await Promise.all([
      paidOrder(noConsent, [{ productId: ids.p1!, quantity: 1, unitPrice: '50.00' }], { status: 'SUCCEEDED', paidAt: new Date(), amount: '50.00' }),
      paidOrder(expired, [{ productId: ids.p1!, quantity: 1, unitPrice: '50.00' }], { status: 'SUCCEEDED', paidAt: new Date(), amount: '50.00' }),
      paidOrder(optedIn, [{ productId: ids.p1!, quantity: 1, unitPrice: '50.00' }], { status: 'FAILED', paidAt: null, amount: '50.00' }),
      paidOrder(optedIn, [{ productId: ids.p1!, quantity: 1, unitPrice: '50.00' }], { status: 'REFUNDED', paidAt: new Date(), amount: '50.00' }),
    ]);
    const rows = await prisma.$queryRaw<{ orderId: string; itemId: string; interactionId: string }[]>(recommendationAttributions({ start: new Date(Date.now() - 30 * day), end: new Date(Date.now() + day) }));
    expect(rows.filter(row => row.orderId === purchase)).toMatchObject([{ interactionId: latestIds[1] }]);
    expect(rows.filter(row => excluded.includes(row.orderId))).toHaveLength(0);
    const after = await analytics.recommendations('30d');
    expect(after.data.conversion.attributedOrders - baseline.data.conversion.attributedOrders).toBe(1);
    expect(after.data.conversion.attributedOrderItems - baseline.data.conversion.attributedOrderItems).toBe(1);
    const usd = (result: typeof after) => Number(result.data.conversion.attributedRevenue.find(row => row.currency === 'USD')?.amount ?? 0);
    expect(usd(after) - usd(baseline)).toBe(150);
  });

  it('ANA-04 image-search activity is measured from server events with no image or identity columns', async () => {
    const correlation = randomUUID();
    await prisma.analyticsEvent.createMany({ data: [
      { type: 'image_search.completed', source: 'SERVER', outcome: 'COMPLETED', correlationId: correlation, resultCount: 3, durationMs: 400, idempotencyKey: `isr:${correlation}`, occurredAt: new Date() },
      { type: 'image_search.completed', source: 'SERVER', outcome: 'NO_RESULTS', correlationId: randomUUID(), resultCount: 0, durationMs: 200, idempotencyKey: `isr:${randomUUID()}`, occurredAt: new Date() },
      { type: 'image_search.failed', source: 'SERVER', outcome: 'AI_UNAVAILABLE', correlationId: randomUUID(), idempotencyKey: `isr:${randomUUID()}`, occurredAt: new Date() },
      { type: 'image_search.result_selected', source: 'CLIENT_SIGNED', correlationId: correlation, productId: ids.p1, idempotencyKey: `iss:${correlation}:${ids.p1}`, occurredAt: new Date() },
    ] });
    const after = await analytics.imageSearch('30d');
    const json = JSON.stringify(after.data);
    expect(json).not.toMatch(/image\/|base64|email/i);
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name::text AS column_name FROM information_schema.columns WHERE table_name = 'analytics_events'`;
    expect(columns.map(column => column.column_name)).not.toEqual(expect.arrayContaining(['userId']));
    expect(JSON.stringify(after.data)).not.toBe(JSON.stringify(beforeImage.data));
  });

  it('ANA-05 categories are labelled as current-catalog classification', async () => {
    const categories = await analytics.categories('30d');
    expect(JSON.stringify(categories)).toContain('CURRENT_CATALOG_CATEGORY');
  });

  it('CAT-01 bulk status changes commit only with their per-product audit and retain the batch summary', async () => {
    const targetId = await product('Bulk Audit', '19.00');
    const current = await prisma.product.findUniqueOrThrow({ where: { id: targetId }, select: { updatedAt: true } });
    const result = await new AdminCatalogService().bulkSetProductStatus(actor.userId, 'INACTIVE', [
      { id: targetId, expectedUpdatedAt: current.updatedAt.toISOString() },
    ]);

    expect(result.results).toMatchObject([{ id: targetId, outcome: 'UPDATED' }]);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: targetId }, select: { status: true } })).toEqual({ status: 'INACTIVE' });
    expect(await prisma.adminAuditLog.findMany({ where: { actorId: actor.userId, action: 'PRODUCT_BULK_STATUS_ITEM', resourceId: targetId },
      select: { outcome: true, details: true } })).toEqual([{ outcome: 'SUCCESS', details: { status: 'INACTIVE' } }]);
    expect(await prisma.adminAuditLog.findMany({ where: { actorId: actor.userId, action: 'PRODUCT_BULK_STATUS', outcome: 'SUCCESS' },
      select: { details: true } })).toEqual([expect.objectContaining({ details: expect.objectContaining({ status: 'INACTIVE', counts: { updated: 1,
        unchanged: 0, conflict: 0, notFound: 0, rejected: 0 } }) })]);
  });

  it('COM-01 shipping settings change NEW checkout quotes and the revision, never historical order amounts; stale versions conflict', async () => {
    await prisma.cart.create({ data: { userId: ids.customerB!, items: { create: [{ productId: ids.p2!, quantity: 1 }] } } });
    invalidateShippingConfig();
    const seedQuote = await new CheckoutService().get(ids.customerB!);
    expect(seedQuote.deliveryMethods.map(method => [method.id, method.price])).toEqual([['STANDARD', '0.00'], ['EXPRESS', '9.99'], ['OVERNIGHT', '19.99']]);
    const current = await storeSettings.getShipping();
    const historical = await prisma.order.findUniqueOrThrow({ where: { id: ids.o1! }, select: { shippingCost: true, total: true } });

    const updated = await storeSettings.updateShipping(actor.userId, { expectedVersion: current.version, freeShippingThreshold: '100.00', methods: [
      { method: 'STANDARD', enabled: true, price: '5.00' }, { method: 'EXPRESS', enabled: true, price: '12.50' }, { method: 'OVERNIGHT', enabled: false, price: '19.99' }] });
    await expect(storeSettings.updateShipping(actor.userId, { expectedVersion: current.version, freeShippingThreshold: null, methods: [
      { method: 'STANDARD', enabled: true, price: '0.00' }, { method: 'EXPRESS', enabled: true, price: '9.99' }, { method: 'OVERNIGHT', enabled: true, price: '19.99' }] }))
      .rejects.toMatchObject({ statusCode: 409 });

    const quote = await new CheckoutService().get(ids.customerB!);
    expect(quote.deliveryMethods.map(method => [method.id, method.price, method.totals.total])).toEqual([['STANDARD', '5.00', '35.00'], ['EXPRESS', '12.50', '42.50']]);
    expect(quote.cartRevision).not.toBe(seedQuote.cartRevision); // a quote priced under the old terms is now stale (409 path)
    await prisma.cartItem.updateMany({ where: { productId: ids.p2!, cart: { userId: ids.customerB! } }, data: { quantity: 4 } });
    const freeStandard = await new CheckoutService().get(ids.customerB!);
    expect(freeStandard.deliveryMethods[0]).toMatchObject({ id: 'STANDARD', price: '0.00' }); // 120.00 >= 100.00 threshold
    expect(await prisma.order.findUniqueOrThrow({ where: { id: ids.o1! }, select: { shippingCost: true, total: true } })).toEqual(historical);
    expect(await prisma.adminAuditLog.count({ where: { actorId: actor.userId } })).toBeGreaterThanOrEqual(1);

    // Restore the seed terms through the same versioned path (no direct row edits).
    await storeSettings.updateShipping(actor.userId, { expectedVersion: updated.version, freeShippingThreshold: null, methods: [
      { method: 'STANDARD', enabled: true, price: '0.00' }, { method: 'EXPRESS', enabled: true, price: '9.99' }, { method: 'OVERNIGHT', enabled: true, price: '19.99' }] });
    invalidateShippingConfig();
    expect((await new CheckoutService().get(ids.customerB!)).deliveryMethods).toHaveLength(3);
  });

  it('REC-02/REC-03 a pin appears labelled Featured while eligible, disappears when archived or expired, and preview records nothing', async () => {
    const admin = new RecommendationAdminService();
    const pin = await admin.createPin({ productId: ids.p2!, surface: 'home', position: 0, startsAt: null, endsAt: null, enabled: true }, actor);
    const live = await recommendationService.popular(8, 'home');
    expect(live.items[0]).toMatchObject({ featured: true, product: { id: ids.p2 } });
    expect(live.items.filter(item => item.product.id === ids.p2)).toHaveLength(1); // deduplicated against organic results

    const eventsBefore = await prisma.recommendationEvent.count();
    const preview = await admin.preview({ surface: 'home', limit: 8 });
    expect(JSON.stringify(preview)).not.toMatch(/impressionToken":"[^"]/);
    expect(await prisma.recommendationEvent.count()).toBe(eventsBefore);

    await prisma.product.update({ where: { id: ids.p2! }, data: { status: 'INACTIVE' } });
    const archived = await recommendationService.popular(8, 'home');
    expect(archived.items.some(item => item.product.id === ids.p2)).toBe(false);
    await prisma.product.update({ where: { id: ids.p2! }, data: { status: 'ACTIVE' } });

    const listed = (await admin.listPins('home')) as unknown as { data?: { id: string; version: number }[] } | { id: string; version: number }[];
    const rows = Array.isArray(listed) ? listed : listed.data ?? [];
    const version = rows.find(row => row.id === (pin as { id: string }).id)?.version ?? 1;
    await admin.updatePin((pin as { id: string }).id, { expectedVersion: version, startsAt: new Date(Date.now() - 2 * day), endsAt: new Date(Date.now() - day) }, actor);
    const expired = await recommendationService.popular(8, 'home');
    expect(expired.items.some(item => item.featured)).toBe(false);

    await prisma.product.update({ where: { id: ids.p1! }, data: { status: 'INACTIVE' } });
    await expect(admin.createPin({ productId: ids.p1!, surface: 'home', position: 1, startsAt: null, endsAt: null, enabled: true }, actor)).rejects.toMatchObject({ statusCode: expect.any(Number) });
    await prisma.product.update({ where: { id: ids.p1! }, data: { status: 'ACTIVE' } });
  });
});
