import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  AdminAnalyticsService, bucketKeys, growthRate, resolveAnalyticsWindow,
} from './admin-analytics.service.js';

vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, logSafely: vi.fn() }));

const NOW = new Date('2026-11-05T12:00:00.000Z');
const D = (value: string) => new Prisma.Decimal(value);

/** Routes each aggregate by a fragment that only it contains; an unmatched query fails the test loudly. */
type Routes = Record<string, unknown[] | (() => unknown[])>;
function database(routes: Routes) {
  const $queryRaw = vi.fn(async (query: Prisma.Sql) => {
    const text = query.strings.join('?');
    const hit = Object.keys(routes).find(fragment => text.includes(fragment));
    if (!hit) throw new Error(`Unrouted query: ${text.slice(0, 120)}`);
    const value = routes[hit]!;
    return typeof value === 'function' ? value() : value;
  });
  return { $queryRaw } as unknown as import('@prisma/client').PrismaClient & { $queryRaw: typeof $queryRaw };
}
const service = (routes: Routes) => new AdminAnalyticsService(database(routes), () => NOW);

describe('analytics windows', () => {
  it('uses rolling UTC windows with an equal-length previous window for 7d, 30d and 90d', () => {
    for (const [period, days] of [['7d', 7], ['30d', 30], ['90d', 90]] as const) {
      const window = resolveAnalyticsWindow(period, NOW);
      expect(window.current.end).toEqual(NOW);
      expect(window.current.end.getTime() - window.current.start.getTime()).toBe(days * 86_400_000);
      expect(window.previous.end).toEqual(window.current.start);
      expect(window.current.start.getTime() - window.previous.start.getTime()).toBe(days * 86_400_000);
      expect(window.granularity).toBe('DAY');
    }
  });

  it('uses twelve calendar months for 12m with monthly buckets and an equal-length previous window', () => {
    const window = resolveAnalyticsWindow('12m', NOW);
    expect(window.current.start.toISOString()).toBe('2025-11-05T12:00:00.000Z');
    expect(window.previous.end).toEqual(window.current.start);
    expect(window.current.end.getTime() - window.current.start.getTime())
      .toBe(window.current.start.getTime() - window.previous.start.getTime());
    expect(window.granularity).toBe('MONTH');
  });

  it('zero-fills buckets only inside the window (UTC days and months)', () => {
    const days = bucketKeys(resolveAnalyticsWindow('7d', NOW).current, 'DAY');
    expect(days[0]).toBe('2026-10-29');
    expect(days.at(-1)).toBe('2026-11-05');
    expect(days.every(key => /^\d{4}-\d{2}-\d{2}$/.test(key))).toBe(true);
    const months = bucketKeys(resolveAnalyticsWindow('12m', NOW).current, 'MONTH');
    expect(months[0]).toBe('2025-11');
    expect(months.at(-1)).toBe('2026-11');
    expect(months).toHaveLength(13);
  });
});

describe('growth and money', () => {
  it('returns null (not a percentage) when the previous value is zero, and a signed ratio otherwise', () => {
    expect(growthRate(D('120'), D('0'))).toBeNull();
    expect(growthRate(D('120'), D('100'))).toBe(0.2);
    expect(growthRate(D('50'), D('100'))).toBe(-0.5);
    expect(growthRate(D('0'), D('-40'))).toBe(1);
  });
});

describe('overview', () => {
  it('computes per-currency revenue, distinct paid orders, AOV and previous-period growth with Decimal arithmetic', async () => {
    // Current and previous windows are distinguished by call order: Promise.all starts the current revenue query first.
    let call = 0;
    const db = database({
      'GROUP BY paid."currency"': () => (call++ % 2 === 0
        ? [{ currency: 'USD', amount: D('300.00'), orders: 3n }]
        : [{ currency: 'USD', amount: D('200.00'), orders: 2n }, { currency: 'EUR', amount: D('10.00'), orders: 1n }]),
      'AS bucket, "currency"': [{ bucket: '2026-11-05', currency: 'USD', amount: D('300.00'), orders: 3n }],
      'roles" r ON r."id" = u."roleId"': () => [{ count: 2n }],
    });
    const result = await new AdminAnalyticsService(db, () => NOW).overview('7d');
    const usd = result.data.byCurrency.find(row => row.currency === 'USD')!;
    expect(usd.revenue).toEqual({ current: '300.00', previous: '200.00', growth: 0.5 });
    expect(usd.averageOrderValue).toEqual({ current: '100.00', previous: '100.00', growth: 0 });
    expect(usd.paidOrders).toEqual({ current: 3, previous: 2, growth: 0.5 });
    const eur = result.data.byCurrency.find(row => row.currency === 'EUR')!;
    expect(eur.revenue).toEqual({ current: '0.00', previous: '10.00', growth: -1 });
    expect(eur.averageOrderValue.current).toBeNull();
    expect(result.data.newCustomers).toEqual({ current: 2, previous: 2, growth: 0 });
    expect(result.data.revenueSeries.buckets).toHaveLength(8);
    expect(result.data.revenueSeries.byCurrency[0]!.points.find(point => point.bucket === '2026-11-05'))
      .toEqual({ bucket: '2026-11-05', amount: '300.00', paidOrders: 3 });
    expect(result.meta).toMatchObject({ period: '7d', timezone: 'UTC', generatedAt: NOW.toISOString() });
    expect(result.meta.definitions.averageOrderValue).toContain('rounded to cents');
  });

  it('keeps currencies separate and reports a null AOV when there are no paid orders', async () => {
    const db = database({
      'GROUP BY paid."currency"': [],
      'AS bucket, "currency"': [],
      'roles" r ON r."id" = u."roleId"': [{ count: 0n }],
    });
    const result = await new AdminAnalyticsService(db, () => NOW).overview('30d');
    expect(result.data.byCurrency).toEqual([]);
    expect(result.data.paidOrders).toEqual({ current: 0, previous: 0, growth: null });
    expect(result.data.revenueSeries.byCurrency).toEqual([]);
    expect(result.meta.window.start).toBe(new Date(NOW.getTime() - 30 * 86_400_000).toISOString());
  });
});

describe('products and categories', () => {
  it('returns top products by units and by amount per currency, labelled with current names and status', async () => {
    const rows = [
      { productId: 'p1', currency: 'USD', units: 9n, amount: D('900.00'), orders: 4n, name: 'Headphones', status: 'ACTIVE', unitRank: 1n, amountRank: 2n },
      { productId: 'p2', currency: 'USD', units: 3n, amount: D('1200.00'), orders: 2n, name: 'Camera', status: 'INACTIVE', unitRank: 12n, amountRank: 1n },
    ];
    const result = await service({ 'ranked AS': rows }).products('30d');
    expect(result.data.byUnits).toEqual([expect.objectContaining({ productId: 'p1', units: 9, amount: '900.00', status: 'ACTIVE' })]);
    expect(result.data.byAmount.map(row => row.productId)).toEqual(['p2', 'p1']);
    expect(result.data.byAmount[0]).toEqual(expect.objectContaining({ name: 'Camera', amount: '1200.00', status: 'INACTIVE' }));
  });

  it('labels categories as the current catalog category and computes shares within each currency', async () => {
    const result = await service({ 'c."name" AS name': [
      { categoryId: 'c1', name: 'Audio', currency: 'USD', units: 3n, amount: D('300.00') },
      { categoryId: 'c2', name: 'Cameras', currency: 'USD', units: 1n, amount: D('100.00') },
    ] }).categories('30d');
    expect(result.data.basis).toBe('CURRENT_CATALOG_CATEGORY');
    expect(result.data.categories.map(row => row.share)).toEqual([0.75, 0.25]);
    expect(result.meta.definitions.basis).toContain('not the category at purchase time');
  });
});

describe('inventory', () => {
  it('reports current counts by status with a CURRENT_STATE basis and zero-filled statuses', async () => {
    const result = await service({ 'FROM "inventory" i': [{ status: 'LOW_STOCK', count: 2n }] }).inventory('30d');
    expect(result.data).toEqual({ basis: 'CURRENT_STATE', trackedProducts: 2,
      byStatus: { IN_STOCK: 0, LOW_STOCK: 2, OUT_OF_STOCK: 0 } });
  });
});

describe('recommendations', () => {
  it('computes CTR from deduplicated impressions and clicks, null when there are no impressions', async () => {
    const svc = service({
      'FROM "recommendation_events"': [
        { surface: 'home', mode: 'POPULAR_PRODUCTS', strategy: 'MEASURED_POPULARITY', eventType: 'IMPRESSION', count: 8n },
        { surface: 'home', mode: 'POPULAR_PRODUCTS', strategy: 'MEASURED_POPULARITY', eventType: 'CLICK', count: 2n },
      ],
      'attributed_orders': [],
    });
    const result = await svc.recommendations('30d');
    expect(result.data).toMatchObject({ impressions: 8, clicks: 2, ctr: 0.25 });
    expect(result.data.breakdown.bySurface).toEqual([{ surface: 'home', impressions: 8, clicks: 2, ctr: 0.25 }]);
    expect(result.data.conversion).toMatchObject({ model: 'LAST_CLICK_7D_CONSENTED',
      coverage: 'Signed-in customers who opted in to personalization only', attributedOrders: 0 });

    const empty = await service({ 'FROM "recommendation_events"': [], 'attributed_orders': [] }).recommendations('30d');
    expect(empty.data.ctr).toBeNull();
  });

  it('counts conversion per distinct paid order and item, with revenue summed per currency', async () => {
    const result = await service({
      'FROM "recommendation_events"': [],
      'attributed_orders': [{ currency: 'USD', orders: 2n, revenue: D('250.50'), items: 3n }],
    }).recommendations('7d');
    expect(result.data.conversion).toMatchObject({ attributedOrders: 2, attributedOrderItems: 3,
      attributedRevenue: [{ currency: 'USD', amount: '250.50' }] });
  });
});

describe('image search', () => {
  it('reports measured counts, zero-safe rates, percentiles and the tracking start date', async () => {
    const result = await service({
      'percentile_cont': [{ completed: 10n, noResults: 2n, withResults: 8n, failed: 1n, p50: 310.4, p95: 1220.9 }],
      'COUNT(*) AS count FROM "analytics_events"': [{ count: 4n }],
      'COUNT(DISTINCT c': [{ count: 2n }],
      'MIN("occurredAt")': [{ since: new Date('2026-10-20T08:00:00.000Z') }],
    }).imageSearch('30d');
    expect(result.data).toMatchObject({ requests: 11, completed: 10, noResults: 2, failed: 1, noResultRate: 0.2, selections: 4,
      selectionRate: 0.25, latencyMs: { p50: 310, p95: 1221 }, trackingSince: '2026-10-20T08:00:00.000Z' });
  });

  it('answers honestly with null rates and no tracking start when nothing was recorded', async () => {
    const result = await service({
      'percentile_cont': [{ completed: 0n, noResults: 0n, withResults: 0n, failed: 0n, p50: null, p95: null }],
      'COUNT(*) AS count FROM "analytics_events"': [{ count: 0n }],
      'COUNT(DISTINCT c': [{ count: 0n }],
      'MIN("occurredAt")': [{ since: null }],
    }).imageSearch('7d');
    expect(result.data).toMatchObject({ requests: 0, noResultRate: null, selectionRate: null, latencyMs: { p50: null, p95: null },
      trackingSince: null });
  });
});

describe('deliveries', () => {
  it('counts only canonical active statuses and returns a null average with a reason when timestamps are missing', async () => {
    const result = await service({
      'GROUP BY d."status"': [{ status: 'CONFIRMED', count: 2n }, { status: 'OUT_FOR_DELIVERY', count: 1n }, { status: 'DELIVERED', count: 5n }],
      'AVG(EXTRACT': [{ delivered: 0n, timed: 0n, averageHours: null }],
    }).deliveries('30d');
    expect(result.data.active).toBe(3);
    expect(result.data.byStatus).toEqual({ CONFIRMED: 2, PREPARING: 0, OUT_FOR_DELIVERY: 1, DELIVERED: 5 });
    expect(result.data.averageHoursPaidToDelivered).toEqual({ value: null, sampleSize: 0,
      unavailableReason: 'No delivered orders in this window have a recorded payment time.' });
  });

  it('rounds the average hours to one decimal when timestamps exist', async () => {
    const result = await service({
      'GROUP BY d."status"': [],
      'AVG(EXTRACT': [{ delivered: 4n, timed: 4n, averageHours: D('26.04') }],
    }).deliveries('30d');
    expect(result.data.averageHoursPaidToDelivered).toEqual({ value: 26, sampleSize: 4, unavailableReason: null });
    expect(result.data.deliveredInWindow).toBe(4);
  });
});

describe('customers', () => {
  it('reports registrations with zero-filled buckets and repeat-buyer rates (all-time and in window)', async () => {
    let repeat = 0;
    const result = await service({
      'AS bucket, COUNT(*) AS count': [{ bucket: '2026-11-04', count: 3n }],
      'roles" r ON r."id" = u."roleId"': [{ count: 1n }],
      'COUNT(*) FILTER (WHERE t.n >= 2)': () => (repeat++ === 0
        ? [{ repeat: 4n, paying: 10n }] : [{ repeat: 1n, paying: 4n }]),
    }).customers('7d');
    expect(result.data.newCustomers).toEqual({ current: 1, previous: 1, growth: 0 });
    expect(result.data.registrations.buckets.find(bucket => bucket.bucket === '2026-11-04')).toEqual({ bucket: '2026-11-04', count: 3 });
    expect(result.data.repeatBuyers).toEqual({
      allTime: { repeatCustomers: 4, payingCustomers: 10, rate: 0.4 },
      inWindow: { repeatCustomers: 1, payingCustomers: 4, rate: 0.25 },
    });
    expect(result.meta.definitions.repeatBuyers).toContain('two or more SUCCEEDED paid orders');
  });

  it('never returns a session-duration figure', async () => {
    const result = await service({
      'AS bucket, COUNT(*) AS count': [],
      'roles" r ON r."id" = u."roleId"': [{ count: 0n }],
      'COUNT(*) FILTER (WHERE t.n >= 2)': [{ repeat: 0n, paying: 0n }],
    }).customers('90d');
    expect(JSON.stringify(result)).not.toMatch(/session/i);
  });
});
