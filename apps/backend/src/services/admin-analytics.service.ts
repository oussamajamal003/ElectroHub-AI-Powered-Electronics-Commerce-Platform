import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '../lib/prisma.js';

/**
 * Task 05.2 administrator analytics. Every figure is a bounded, parameterized aggregate over authoritative tables or the
 * analytics_events facts. Paid revenue reuses the 05.1 definition: payments with status SUCCEEDED, grouped by paidAt (UTC) and
 * currency; refunded payments carry status REFUNDED and are excluded, pending/processing/failed never count.
 * Windows are rolling and half-open [start, end) in UTC, with an equal-length previous window immediately before the current one.
 * Nothing here is sampled, estimated or padded with invented values; unavailable figures are returned as null with a reason.
 */
export const ANALYTICS_PERIODS = ['7d', '30d', '90d', '12m'] as const;
export type AnalyticsPeriod = typeof ANALYTICS_PERIODS[number];
export const DEFAULT_ANALYTICS_PERIOD: AnalyticsPeriod = '30d';

type Granularity = 'DAY' | 'MONTH';
export interface AnalyticsRange { start: Date; end: Date }
export interface AnalyticsWindow { period: AnalyticsPeriod; current: AnalyticsRange; previous: AnalyticsRange; granularity: Granularity }

const DAY_MS = 86_400_000;
const PERIOD_DAYS: Record<Exclude<AnalyticsPeriod, '12m'>, number> = { '7d': 7, '30d': 30, '90d': 90 };
const TOP_LIMIT = 10;
const DELIVERY_ACTIVE = ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY'] as const;
const DELIVERY_STATUSES = ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;
const INVENTORY_STATUSES = ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const;
// Fixed constants only: these strings are interpolated as raw SQL, so they must never carry request input.
const BUCKET_SQL: Record<Granularity, { unit: string; format: string }> = {
  DAY: { unit: 'day', format: 'YYYY-MM-DD' },
  MONTH: { unit: 'month', format: 'YYYY-MM' },
};

/** Rolling window for a period. 12m is twelve calendar months; the previous window has the same duration. */
export function resolveAnalyticsWindow(period: AnalyticsPeriod, now: Date): AnalyticsWindow {
  const end = new Date(now.getTime());
  let start: Date;
  if (period === '12m') {
    start = new Date(end.getTime());
    start.setUTCMonth(start.getUTCMonth() - 12);
  } else {
    start = new Date(end.getTime() - PERIOD_DAYS[period] * DAY_MS);
  }
  const length = end.getTime() - start.getTime();
  return {
    period,
    current: { start, end },
    previous: { start: new Date(start.getTime() - length), end: start },
    granularity: period === '12m' ? 'MONTH' : 'DAY',
  };
}

/** Every bucket that starts inside [start, end), in UTC, so empty buckets can be shown as zero rather than omitted. */
export function bucketKeys(range: AnalyticsRange, granularity: Granularity): string[] {
  const keys: string[] = [];
  if (granularity === 'DAY') {
    const first = Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth(), range.start.getUTCDate());
    for (let t = first; t < range.end.getTime(); t += DAY_MS) keys.push(new Date(t).toISOString().slice(0, 10));
  } else {
    const year = range.start.getUTCFullYear();
    const month = range.start.getUTCMonth();
    for (let offset = 0; ; offset++) {
      const t = Date.UTC(year, month + offset, 1);
      if (t >= range.end.getTime()) break;
      keys.push(new Date(t).toISOString().slice(0, 7));
    }
  }
  return keys;
}

const money = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value).toFixed(2);
const toNumber = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));
const roundedOrNull = (value: unknown) => (value === null || value === undefined ? null : Math.round(Number(value)));
const decimal = (value: unknown) => new Prisma.Decimal((value ?? 0) as Prisma.Decimal.Value);

/** (current - previous) / |previous|; null when there is no prior value (no false percentage). */
export function growthRate(current: Prisma.Decimal.Value, previous: Prisma.Decimal.Value): number | null {
  const prior = new Prisma.Decimal(previous);
  if (prior.isZero()) return null;
  return new Prisma.Decimal(current).minus(prior).div(prior.abs()).toDecimalPlaces(4).toNumber();
}

/** Ratio = numerator / denominator, null when the denominator is zero. */
function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

/** Eligible paid payments in a range: the 05.1 paid-revenue definition, one row per paid order. */
const paidPayments = (range: AnalyticsRange) => Prisma.sql`
  SELECT p."orderId" AS "orderId", p."currency" AS "currency", p."amount" AS "amount", p."paidAt" AS "paidAt"
  FROM "payments" p
  WHERE p."status" = 'SUCCEEDED' AND p."paidAt" >= ${range.start} AND p."paidAt" < ${range.end}`;

/** One most recent qualifying click per purchased order item; equal timestamps break ties by interaction id. */
export const recommendationAttributions = (range: AnalyticsRange) => Prisma.sql`
  WITH paid AS (${paidPayments(range)})
  SELECT paid."orderId" AS "orderId", paid."currency" AS currency, paid."amount" AS amount,
    oi."id" AS "itemId", latest."id" AS "interactionId"
  FROM paid
  JOIN "orders" o ON o."id" = paid."orderId"
  JOIN "recommendation_preferences" rp ON rp."userId" = o."userId" AND rp."personalizationEnabled" = true
  JOIN "order_items" oi ON oi."orderId" = o."id"
  JOIN LATERAL (
    SELECT pi."id"
    FROM "product_interactions" pi
    WHERE pi."userId" = o."userId" AND pi."productId" = oi."productId"
      AND pi."eventType" = 'RECOMMENDATION_CLICK'
      AND pi."occurredAt" <= o."createdAt" AND pi."occurredAt" >= o."createdAt" - INTERVAL '7 days'
    ORDER BY pi."occurredAt" DESC, pi."id" DESC
    LIMIT 1
  ) latest ON true`;

/** Bucket label in UTC. `column` is one of two fixed, server-owned column references (never request input). */
const bucketExpression = (granularity: Granularity, column: '"paidAt"' | 'u."createdAt"') =>
  Prisma.raw(`to_char(date_trunc('${BUCKET_SQL[granularity].unit}', ${column}), '${BUCKET_SQL[granularity].format}')`);

type CurrencyTotal = { currency: string; amount: Prisma.Decimal; orders: bigint | number };
type ProductRow = { productId: string; currency: string; units: bigint | number; amount: Prisma.Decimal; orders: bigint | number;
  name: string; status: string; unitRank: bigint | number; amountRank: bigint | number };
type CategoryRow = { categoryId: string; name: string; currency: string; units: bigint | number; amount: Prisma.Decimal };
type BucketRow = { bucket: string; currency: string; amount: Prisma.Decimal; orders: bigint | number };
type CustomerBucketRow = { bucket: string; count: bigint | number };

export class AdminAnalyticsService {
  constructor(private readonly db: PrismaClient = defaultDb, private readonly clock: () => Date = () => new Date()) {}

  private envelope<T>(window: AnalyticsWindow, now: Date, data: T, definitions: Record<string, string>) {
    return {
      data,
      meta: {
        period: window.period,
        window: { start: window.current.start.toISOString(), end: window.current.end.toISOString() },
        previousWindow: { start: window.previous.start.toISOString(), end: window.previous.end.toISOString() },
        generatedAt: now.toISOString(),
        timezone: 'UTC' as const,
        definitions,
      },
    };
  }

  private revenueTotals(range: AnalyticsRange) {
    return this.db.$queryRaw<CurrencyTotal[]>(Prisma.sql`
      SELECT paid."currency" AS currency, COALESCE(SUM(paid."amount"), 0) AS amount, COUNT(*) AS orders
      FROM (${paidPayments(range)}) paid
      GROUP BY paid."currency" ORDER BY paid."currency" ASC`);
  }

  private newCustomers(range: AnalyticsRange) {
    return this.db.$queryRaw<{ count: bigint | number }[]>(Prisma.sql`
      SELECT COUNT(*) AS count FROM "users" u JOIN "roles" r ON r."id" = u."roleId"
      WHERE r."name" = 'CUSTOMER' AND u."createdAt" >= ${range.start} AND u."createdAt" < ${range.end}
        AND u."email" NOT LIKE '%@deleted.invalid'`);
  }

  private revenueBuckets(range: AnalyticsRange, granularity: Granularity) {
    return this.db.$queryRaw<BucketRow[]>(Prisma.sql`
      SELECT ${bucketExpression(granularity, '"paidAt"')} AS bucket, "currency" AS currency,
        COALESCE(SUM("amount"), 0) AS amount, COUNT(*) AS orders
      FROM "payments"
      WHERE "status" = 'SUCCEEDED' AND "paidAt" >= ${range.start} AND "paidAt" < ${range.end}
      GROUP BY 1, 2 ORDER BY 1 ASC, 2 ASC`);
  }

  /** Paid revenue, paid orders, AOV and new customers, each with the previous equal-length window and growth. */
  async overview(period: AnalyticsPeriod) {
    const now = this.clock();
    const window = resolveAnalyticsWindow(period, now);
    const [current, previous, newCurrent, newPrevious, buckets] = await Promise.all([
      this.revenueTotals(window.current), this.revenueTotals(window.previous),
      this.newCustomers(window.current), this.newCustomers(window.previous),
      this.revenueBuckets(window.current, window.granularity),
    ]);
    const currencies = [...new Set([...current, ...previous].map(row => row.currency))].sort();
    const byCurrency = currencies.map(currency => {
      const cur = current.find(row => row.currency === currency);
      const prev = previous.find(row => row.currency === currency);
      const curAmount = decimal(cur?.amount);
      const prevAmount = decimal(prev?.amount);
      const curOrders = toNumber(cur?.orders);
      const prevOrders = toNumber(prev?.orders);
      const curAov = curOrders > 0 ? curAmount.div(curOrders).toDecimalPlaces(2) : null;
      const prevAov = prevOrders > 0 ? prevAmount.div(prevOrders).toDecimalPlaces(2) : null;
      return {
        currency,
        revenue: { current: money(curAmount), previous: money(prevAmount), growth: growthRate(curAmount, prevAmount) },
        averageOrderValue: { current: curAov ? money(curAov) : null, previous: prevAov ? money(prevAov) : null,
          growth: curAov && prevAov ? growthRate(curAov, prevAov) : null },
        paidOrders: { current: curOrders, previous: prevOrders, growth: growthRate(curOrders, prevOrders) },
      };
    });
    const totalOrders = (rows: CurrencyTotal[]) => rows.reduce((sum, row) => sum + toNumber(row.orders), 0);
    const curOrders = totalOrders(current);
    const prevOrders = totalOrders(previous);
    const keys = bucketKeys(window.current, window.granularity);
    const points = (currency: string) => keys.map(bucket => {
      const row = buckets.find(item => item.bucket === bucket && item.currency === currency);
      return { bucket, amount: money(decimal(row?.amount)), paidOrders: toNumber(row?.orders) };
    });
    const newCustomersCurrent = toNumber(newCurrent[0]?.count);
    const newCustomersPrevious = toNumber(newPrevious[0]?.count);
    return this.envelope(window, now, {
      paidOrders: { current: curOrders, previous: prevOrders, growth: growthRate(curOrders, prevOrders) },
      byCurrency,
      newCustomers: { current: newCustomersCurrent, previous: newCustomersPrevious, growth: growthRate(newCustomersCurrent, newCustomersPrevious) },
      revenueSeries: { granularity: window.granularity, buckets: keys,
        byCurrency: [...new Set(buckets.map(row => row.currency))].sort().map(currency => ({ currency, points: points(currency) })) },
    }, {
      revenue: 'Sum of SUCCEEDED payments paid inside the window (UTC paidAt), per currency. Refunded and unpaid payments are excluded; currencies are never added together.',
      paidOrders: 'Distinct orders with a SUCCEEDED payment paid inside the window. One payment per order, so this equals the number of paid payments.',
      averageOrderValue: 'Paid revenue divided by paid orders for the same window and currency, rounded to cents. Null when there are no paid orders.',
      growth: 'Current minus previous, divided by the absolute previous value, over the equal-length window immediately before. Null when the previous value is zero.',
      newCustomers: 'Customer accounts (role CUSTOMER) created inside the window by createdAt. Admin accounts and anonymized deleted accounts are excluded.',
      revenueSeries: 'Daily buckets for 7d/30d/90d and monthly buckets for 12m. Buckets with no paid orders are zero. The first bucket may start before the window; only paid events inside the window are counted.',
    });
  }

  /** Top 10 products by units and by paid amount per currency, from paid orders in the window. Names and status are current. */
  async products(period: AnalyticsPeriod) {
    const now = this.clock();
    const window = resolveAnalyticsWindow(period, now);
    const rows = await this.db.$queryRaw<ProductRow[]>(Prisma.sql`
      WITH paid AS (${paidPayments(window.current)}),
      lines AS (
        SELECT oi."productId" AS "productId", paid."currency" AS "currency", SUM(oi."quantity") AS units,
          SUM(oi."lineTotal") AS amount, COUNT(DISTINCT oi."orderId") AS orders
        FROM "order_items" oi JOIN paid ON paid."orderId" = oi."orderId"
        GROUP BY oi."productId", paid."currency"
      ),
      ranked AS (
        SELECT l."productId" AS "productId", l."currency" AS "currency", l.units AS units, l.amount AS amount, l.orders AS orders,
          pr."name" AS name, pr."status"::text AS status,
          ROW_NUMBER() OVER (ORDER BY l.units DESC, l.amount DESC, l."productId" ASC, l."currency" ASC) AS "unitRank",
          ROW_NUMBER() OVER (PARTITION BY l."currency" ORDER BY l.amount DESC, l.units DESC, l."productId" ASC) AS "amountRank"
        FROM lines l JOIN "products" pr ON pr."id" = l."productId"
      )
      SELECT * FROM ranked WHERE "unitRank" <= ${TOP_LIMIT} OR "amountRank" <= ${TOP_LIMIT}`);
    const row = (item: ProductRow) => ({ productId: item.productId, name: item.name, status: item.status, currency: item.currency,
      units: toNumber(item.units), amount: money(decimal(item.amount)), orders: toNumber(item.orders) });
    const byUnits = rows.filter(item => toNumber(item.unitRank) <= TOP_LIMIT)
      .sort((a, b) => toNumber(a.unitRank) - toNumber(b.unitRank)).map(row);
    const byAmount = rows.filter(item => toNumber(item.amountRank) <= TOP_LIMIT)
      .sort((a, b) => a.currency.localeCompare(b.currency) || toNumber(a.amountRank) - toNumber(b.amountRank)).map(row);
    return this.envelope(window, now, { limit: TOP_LIMIT, byUnits, byAmount }, {
      byUnits: 'Top products by units sold in paid orders paid inside the window. Units are summed order-line quantities.',
      byAmount: 'Top products by paid line amount (line totals) per currency. Ties break by units, then product id.',
      name: 'Current catalog name and status of the product, not a purchase-time snapshot.',
    });
  }

  /** Paid amount and units per CURRENT catalog category. Order items carry no category snapshot, so this is not a historical view. */
  async categories(period: AnalyticsPeriod) {
    const now = this.clock();
    const window = resolveAnalyticsWindow(period, now);
    const rows = await this.db.$queryRaw<CategoryRow[]>(Prisma.sql`
      WITH paid AS (${paidPayments(window.current)})
      SELECT c."id" AS "categoryId", c."name" AS name, paid."currency" AS currency,
        SUM(oi."quantity") AS units, SUM(oi."lineTotal") AS amount
      FROM "order_items" oi
      JOIN paid ON paid."orderId" = oi."orderId"
      JOIN "products" pr ON pr."id" = oi."productId"
      JOIN "categories" c ON c."id" = pr."categoryId"
      GROUP BY c."id", c."name", paid."currency"
      ORDER BY paid."currency" ASC, SUM(oi."lineTotal") DESC, c."name" ASC`);
    const totals = new Map<string, Prisma.Decimal>();
    for (const row of rows) totals.set(row.currency, (totals.get(row.currency) ?? new Prisma.Decimal(0)).plus(decimal(row.amount)));
    const categories = rows.map(row => {
      const amount = decimal(row.amount);
      const total = totals.get(row.currency) ?? new Prisma.Decimal(0);
      return { categoryId: row.categoryId, name: row.name, currency: row.currency, units: toNumber(row.units), amount: money(amount),
        share: total.isZero() ? null : amount.div(total).toDecimalPlaces(4).toNumber() };
    });
    return this.envelope(window, now, { basis: 'CURRENT_CATALOG_CATEGORY' as const, categories }, {
      basis: 'Products are classified by their CURRENT catalog category. Order items store no category snapshot, so this is not the category at purchase time.',
      share: 'Category paid amount divided by the total paid amount of the same currency in the window across all categories. Null when the total is zero.',
    });
  }

  /** Current inventory state (not a time series): counts by stored inventory status for non-test products. */
  async inventory(period: AnalyticsPeriod) {
    const now = this.clock();
    const window = resolveAnalyticsWindow(period, now);
    const rows = await this.db.$queryRaw<{ status: string; count: bigint | number }[]>(Prisma.sql`
      SELECT i."status"::text AS status, COUNT(*) AS count
      FROM "inventory" i JOIN "products" p ON p."id" = i."productId"
      WHERE p."isTestFixture" = false
      GROUP BY i."status"`);
    const byStatus = Object.fromEntries(INVENTORY_STATUSES.map(status => [status,
      toNumber(rows.find(row => row.status === status)?.count)])) as Record<(typeof INVENTORY_STATUSES)[number], number>;
    return this.envelope(window, now, {
      basis: 'CURRENT_STATE' as const,
      trackedProducts: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
      byStatus,
    }, {
      basis: 'Current state only. Historical stock levels are not recorded as a time series, so no past counts are reconstructed.',
      trackedProducts: 'Non-test products that have an inventory record.',
      byStatus: 'Stored inventory status (IN_STOCK, LOW_STOCK, OUT_OF_STOCK) as maintained by the inventory service.',
    });
  }

  /** Non-personal impressions and clicks (deduplicated per batch), CTR, breakdowns, and last-click conversion for consenting customers. */
  async recommendations(period: AnalyticsPeriod) {
    const now = this.clock();
    const window = resolveAnalyticsWindow(period, now);
    const [events, conversion] = await Promise.all([
      this.db.$queryRaw<{ surface: string; mode: string; strategy: string; eventType: string; count: bigint | number }[]>(Prisma.sql`
        SELECT "surface", "mode", "strategy", "eventType", COUNT(*) AS count
        FROM "recommendation_events"
        WHERE "occurredAt" >= ${window.current.start} AND "occurredAt" < ${window.current.end}
        GROUP BY "surface", "mode", "strategy", "eventType"
        LIMIT 500`),
      this.db.$queryRaw<{ currency: string; orders: bigint | number; items: bigint | number; revenue: Prisma.Decimal }[]>(Prisma.sql`
        WITH attributed AS (${recommendationAttributions(window.current)}),
        attributed_orders AS (SELECT DISTINCT "orderId", currency, amount FROM attributed)
        SELECT ao.currency AS currency, COUNT(*) AS orders, COALESCE(SUM(ao.amount), 0) AS revenue,
          (SELECT COUNT(DISTINCT a2."itemId") FROM attributed a2 WHERE a2.currency = ao.currency) AS items
        FROM attributed_orders ao
        GROUP BY ao.currency
        ORDER BY ao.currency ASC`),
    ]);
    type EventRow = (typeof events)[number];
    const sumWhere = (filter: (row: EventRow) => boolean) => events.filter(filter).reduce((total, row) => total + toNumber(row.count), 0);
    const impressions = sumWhere(row => row.eventType === 'IMPRESSION');
    const clicks = sumWhere(row => row.eventType === 'CLICK');
    const breakdown = (key: 'surface' | 'mode' | 'strategy') => [...new Set(events.map(row => row[key]))].sort().map(value => {
      const imp = sumWhere(row => row[key] === value && row.eventType === 'IMPRESSION');
      const clk = sumWhere(row => row[key] === value && row.eventType === 'CLICK');
      return { [key]: value, impressions: imp, clicks: clk, ctr: ratio(clk, imp) } as Record<string, string | number | null>;
    });
    const orderTotal = conversion.reduce((total, row) => total + toNumber(row.orders), 0);
    const itemTotal = conversion.reduce((total, row) => total + toNumber(row.items), 0);
    return this.envelope(window, now, {
      impressions, clicks, ctr: ratio(clicks, impressions),
      breakdown: { bySurface: breakdown('surface'), byMode: breakdown('mode'), byStrategy: breakdown('strategy') },
      conversion: {
        model: 'LAST_CLICK_7D_CONSENTED' as const,
        coverage: 'Signed-in customers who opted in to personalization only',
        attributedOrders: orderTotal,
        attributedOrderItems: itemTotal,
        attributedRevenue: conversion.map(row => ({ currency: row.currency, amount: money(decimal(row.revenue)) })),
      },
    }, {
      impressions: 'Recommendation impressions recorded for the window (one per batch, product and event type). Requests and admin previews are not impressions.',
      clicks: 'Recommendation clicks recorded for the window, deduplicated per batch and product.',
      ctr: 'Clicks divided by impressions for the same window. Null when there are no impressions.',
      conversion: 'Distinct paid, non-refunded orders in the window whose customer, with personalization still enabled, clicked a recommendation for the same product within 7 days before the order was created. The most recent qualifying click per order item is selected, with interaction ID breaking timestamp ties. Consenting signed-in customers only; anonymous and non-consenting purchases are not attributed.',
    });
  }

  /** Image-search outcomes measured on the server, selections from signed tokens, and latency percentiles. */
  async imageSearch(period: AnalyticsPeriod) {
    const now = this.clock();
    const window = resolveAnalyticsWindow(period, now);
    const [outcome, selections, searchesWithSelection, since] = await Promise.all([
      this.db.$queryRaw<{ completed: bigint | number; noResults: bigint | number; withResults: bigint | number; failed: bigint | number;
        p50: number | null; p95: number | null }[]>(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE "type" = 'image_search.completed') AS completed,
          COUNT(*) FILTER (WHERE "type" = 'image_search.completed' AND "resultCount" = 0) AS "noResults",
          COUNT(*) FILTER (WHERE "type" = 'image_search.completed' AND "resultCount" > 0) AS "withResults",
          COUNT(*) FILTER (WHERE "type" = 'image_search.failed') AS failed,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs") FILTER (WHERE "durationMs" IS NOT NULL) AS p50,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs") FILTER (WHERE "durationMs" IS NOT NULL) AS p95
        FROM "analytics_events"
        WHERE "type" IN ('image_search.completed', 'image_search.failed')
          AND "occurredAt" >= ${window.current.start} AND "occurredAt" < ${window.current.end}`),
      this.db.$queryRaw<{ count: bigint | number }[]>(Prisma.sql`
        SELECT COUNT(*) AS count FROM "analytics_events"
        WHERE "type" = 'image_search.result_selected'
          AND "occurredAt" >= ${window.current.start} AND "occurredAt" < ${window.current.end}`),
      this.db.$queryRaw<{ count: bigint | number }[]>(Prisma.sql`
        SELECT COUNT(DISTINCT c."correlationId") AS count
        FROM "analytics_events" c
        JOIN "analytics_events" s ON s."correlationId" = c."correlationId" AND s."type" = 'image_search.result_selected'
        WHERE c."type" = 'image_search.completed' AND c."resultCount" > 0
          AND c."occurredAt" >= ${window.current.start} AND c."occurredAt" < ${window.current.end}`),
      this.db.$queryRaw<{ since: Date | null }[]>(Prisma.sql`
        SELECT MIN("occurredAt") AS since FROM "analytics_events"
        WHERE "type" IN ('image_search.completed', 'image_search.failed', 'image_search.result_selected')`),
    ]);
    const row = outcome[0];
    const completed = toNumber(row?.completed);
    const failed = toNumber(row?.failed);
    const withResults = toNumber(row?.withResults);
    const trackingSince = since[0]?.since ?? null;
    const requests = completed + failed;
    return this.envelope(window, now, {
      requests, completed, noResults: toNumber(row?.noResults), failed,
      noResultRate: ratio(toNumber(row?.noResults), completed),
      selections: toNumber(selections[0]?.count),
      selectionRate: ratio(toNumber(searchesWithSelection[0]?.count), withResults),
      latencyMs: { p50: roundedOrNull(row?.p50), p95: roundedOrNull(row?.p95) },
      trackingSince: trackingSince ? trackingSince.toISOString() : null,
    }, {
      requests: 'Image searches the server completed or failed in the window (client-side rejections such as oversized uploads before handling are not recorded).',
      completed: 'Searches that returned a successful response, including zero-result searches.',
      noResults: 'Successful searches with zero results.',
      failed: 'Searches that ended in a failure response, by server-side measurement.',
      selections: 'Customer selections of a product from a search result, accepted only with a signed token for that search.',
      selectionRate: 'Searches with at least one returned product that were followed by a selection, divided by searches with results, in the window.',
      latencyMs: 'Server-measured end-to-end time for completed and failed searches. Null when no measurements exist.',
      trackingSince: 'Earliest recorded image-search event. Before this moment no activity was recorded, so earlier periods are not comparable.',
    });
  }

  /** Current delivery statuses, deliveries delivered in the window, and average paid-to-delivered hours where both timestamps exist. */
  async deliveries(period: AnalyticsPeriod) {
    const now = this.clock();
    const window = resolveAnalyticsWindow(period, now);
    const [statusRows, delivered] = await Promise.all([
      this.db.$queryRaw<{ status: string; count: bigint | number }[]>(Prisma.sql`
        SELECT d."status"::text AS status, COUNT(*) AS count FROM "deliveries" d GROUP BY d."status"`),
      this.db.$queryRaw<{ delivered: bigint | number; timed: bigint | number; averageHours: Prisma.Decimal | null }[]>(Prisma.sql`
        SELECT COUNT(*) AS delivered,
          COUNT(p."paidAt") AS timed,
          AVG(EXTRACT(EPOCH FROM (d."deliveredAt" - p."paidAt")) / 3600.0) AS "averageHours"
        FROM "deliveries" d
        LEFT JOIN "payments" p ON p."orderId" = d."orderId" AND p."status" = 'SUCCEEDED'
        WHERE d."status" = 'DELIVERED' AND d."deliveredAt" >= ${window.current.start} AND d."deliveredAt" < ${window.current.end}`),
    ]);
    const byStatus = Object.fromEntries(DELIVERY_STATUSES.map(status => [status,
      toNumber(statusRows.find(row => row.status === status)?.count)])) as Record<(typeof DELIVERY_STATUSES)[number], number>;
    const active = DELIVERY_ACTIVE.reduce((total, status) => total + byStatus[status], 0);
    const timed = toNumber(delivered[0]?.timed);
    const averageHours = timed > 0 && delivered[0]?.averageHours !== null && delivered[0]?.averageHours !== undefined
      ? Number(Number(delivered[0].averageHours).toFixed(1)) : null;
    return this.envelope(window, now, {
      active, byStatus,
      deliveredInWindow: toNumber(delivered[0]?.delivered),
      averageHoursPaidToDelivered: {
        value: averageHours,
        sampleSize: timed,
        unavailableReason: averageHours === null ? 'No delivered orders in this window have a recorded payment time.' : null,
      },
    }, {
      active: 'Deliveries currently in an active fulfillment status (CONFIRMED, PREPARING, OUT_FOR_DELIVERY). Delivered deliveries are not active.',
      byStatus: 'Current status counts of all deliveries (current state, not a window).',
      deliveredInWindow: 'Deliveries with status DELIVERED whose deliveredAt falls in the window.',
      averageHoursPaidToDelivered: 'Average hours from the successful payment time to deliveredAt, for deliveries delivered in the window that have both timestamps. No courier location or ETA accuracy is inferred.',
    });
  }

  /** New customer registrations per bucket and repeat paying customers (all-time and within the window). */
  async customers(period: AnalyticsPeriod) {
    const now = this.clock();
    const window = resolveAnalyticsWindow(period, now);
    const [newCurrent, newPrevious, series, repeatAll, repeatWindow] = await Promise.all([
      this.newCustomers(window.current), this.newCustomers(window.previous),
      this.db.$queryRaw<CustomerBucketRow[]>(Prisma.sql`
        SELECT ${bucketExpression(window.granularity, 'u."createdAt"')} AS bucket, COUNT(*) AS count
        FROM "users" u JOIN "roles" r ON r."id" = u."roleId"
        WHERE r."name" = 'CUSTOMER' AND u."createdAt" >= ${window.current.start} AND u."createdAt" < ${window.current.end}
          AND u."email" NOT LIKE '%@deleted.invalid'
        GROUP BY 1 ORDER BY 1 ASC`),
      this.repeatCounts(),
      this.repeatCounts({ start: window.current.start, end: window.current.end }),
    ]);
    const keys = bucketKeys(window.current, window.granularity);
    const current = toNumber(newCurrent[0]?.count);
    const previous = toNumber(newPrevious[0]?.count);
    return this.envelope(window, now, {
      newCustomers: { current, previous, growth: growthRate(current, previous) },
      registrations: { granularity: window.granularity, buckets: keys.map(bucket => ({ bucket,
        count: toNumber(series.find(row => row.bucket === bucket)?.count) })) },
      repeatBuyers: {
        allTime: { repeatCustomers: repeatAll.repeat, payingCustomers: repeatAll.paying, rate: ratio(repeatAll.repeat, repeatAll.paying) },
        inWindow: { repeatCustomers: repeatWindow.repeat, payingCustomers: repeatWindow.paying, rate: ratio(repeatWindow.repeat, repeatWindow.paying) },
      },
    }, {
      newCustomers: 'Customer accounts created inside the window by createdAt. Admin accounts and anonymized deleted accounts are excluded.',
      registrations: 'Registrations per UTC day (7d/30d/90d) or month (12m). Empty buckets are zero.',
      repeatBuyers: 'A paying customer is a user with at least one SUCCEEDED payment. A repeat customer has two or more SUCCEEDED paid orders. allTime counts every paid order; inWindow counts only orders paid inside the window. rate = repeat / paying customers.',
    });
  }

  private async repeatCounts(range?: AnalyticsRange) {
    const condition = range
      ? Prisma.sql` AND p."paidAt" >= ${range.start} AND p."paidAt" < ${range.end}`
      : Prisma.empty;
    const rows = await this.db.$queryRaw<{ repeat: bigint | number; paying: bigint | number }[]>(Prisma.sql`
      SELECT COUNT(*) FILTER (WHERE t.n >= 2) AS repeat, COUNT(*) AS paying
      FROM (
        SELECT o."userId" AS "userId", COUNT(*) AS n
        FROM "payments" p JOIN "orders" o ON o."id" = p."orderId"
        WHERE p."status" = 'SUCCEEDED'${condition}
        GROUP BY o."userId"
      ) t`);
    return { repeat: toNumber(rows[0]?.repeat), paying: toNumber(rows[0]?.paying) };
  }
}

export const adminAnalyticsService = new AdminAnalyticsService();
