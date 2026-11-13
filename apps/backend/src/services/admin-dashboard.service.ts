import { Prisma, PrismaClient, type OrderStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AdminInventoryService } from './admin-inventory.service.js';
import { projectOrderRow } from './admin-order.service.js';
import { deriveStockStatus } from './inventory.service.js';
import { addLocalDays, localDayWindow, storeTimeZone } from './reporting-timezone.js';

/**
 * Task 05.1 operational overview: bounded aggregates over the canonical tables only (no analytics warehouse, no growth percentages).
 * Revenue = amount of stored SUCCEEDED payments whose paidAt falls in the window (store-local days), grouped by currency, never summed
 * across currencies. Refunded payments have status REFUNDED and are therefore excluded; pending/processing/failed never count.
 * Trends compare the selected window (store-local days, today included) with the same number of local days before it, and count what was added today.
 */
const ORDER_STATUSES: OrderStatus[] = ['AWAITING_CAPTURE', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];

export const ALERT_CATEGORIES = ['lowStock', 'outOfStock', 'awaitingFulfillment', 'outForDelivery'] as const;
export type AlertCategory = typeof ALERT_CATEGORIES[number];

export class AdminDashboardService {
  constructor(private readonly db: PrismaClient = prisma, private readonly inventory = new AdminInventoryService(),
    private readonly clock: () => Date = () => new Date()) {}

  /** Paid orders waiting at each fulfillment step. */
  private async fulfillment() {
    const [awaitingFulfillment, preparing, outForDelivery] = await Promise.all((['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY'] as const)
      .map(status => this.db.order.count({ where: { status, payment: { is: { status: 'SUCCEEDED' } } } })));
    return { awaitingFulfillment, preparing, outForDelivery };
  }

  private async alertCounts() {
    const [stock, fulfillment] = await Promise.all([this.inventory.summary(), this.fulfillment()]);
    return { lowStock: stock.lowStock, outOfStock: stock.outOfStock, awaitingFulfillment: fulfillment.awaitingFulfillment,
      outForDelivery: fulfillment.outForDelivery, fulfillment };
  }

  /**
   * Actionable operational counts shared by the dashboard and the header alerts menu. The counts are live business state and are
   * NEVER changed by reading or acknowledging them. `unread` is the per-administrator remainder after the acknowledged baseline:
   * unread = max(0, current - acknowledged). A baseline above the current count (the condition cleared) is lowered to the current
   * count so a later recurrence counts as new rather than being swallowed by a stale baseline.
   */
  async alerts(userId?: string) {
    const counts = await this.alertCounts();
    const current = Object.fromEntries(ALERT_CATEGORIES.map(category => [category, counts[category]])) as Record<AlertCategory, number>;
    const baseline = await this.baseline(userId, current);
    const unread = Object.fromEntries(ALERT_CATEGORIES.map(category => [category, Math.max(0, current[category] - baseline[category])])) as Record<AlertCategory, number>;
    return { lowStock: counts.lowStock, outOfStock: counts.outOfStock, ...counts.fulfillment,
      unread: { ...unread, total: ALERT_CATEGORIES.reduce((sum, category) => sum + unread[category], 0) }, generatedAt: this.clock().toISOString() };
  }

  /**
   * Marks what the administrator has SEEN as acknowledged, per category: only the categories present in `seen` change (opening one
   * alert category never reads the others). `seen` is the count the client actually displayed; it is clamped to the current server
   * count, so an alert that arrived after the list was rendered stays unread, and a client can never acknowledge more than exists.
   * Only this administrator's own rows change; operational counts are never touched.
   */
  async acknowledgeAlerts(userId: string, seen: Partial<Record<AlertCategory, number>>) {
    const categories = ALERT_CATEGORIES.filter(category => seen[category] !== undefined);
    if (categories.length === 0) return this.alerts(userId);
    const counts = await this.alertCounts();
    const rows = await this.db.adminAlertAcknowledgement.findMany({ where: { userId } });
    const existing = new Map(rows.map(row => [row.category, row.acknowledgedCount]));
    await this.db.$transaction(categories.map(category => {
      const current = counts[category];
      const next = Math.max(Math.min(existing.get(category) ?? 0, current), Math.min(seen[category]!, current));
      return this.db.adminAlertAcknowledgement.upsert({ where: { userId_category: { userId, category } },
        create: { userId, category, acknowledgedCount: next }, update: { acknowledgedCount: next } });
    }));
    return this.alerts(userId);
  }

  private async baseline(userId: string | undefined, current: Record<AlertCategory, number>) {
    const result: Record<AlertCategory, number> = { lowStock: 0, outOfStock: 0, awaitingFulfillment: 0, outForDelivery: 0 };
    if (!userId) return result;
    const rows = await this.db.adminAlertAcknowledgement.findMany({ where: { userId } });
    for (const row of rows) {
      if (!(ALERT_CATEGORIES as readonly string[]).includes(row.category)) continue;
      const category = row.category as AlertCategory;
      result[category] = Math.min(row.acknowledgedCount, current[category]);
      if (row.acknowledgedCount > current[category]) {
        // Best effort: a failed write only leaves the (already clamped) stored value to be clamped again on the next read.
        await this.db.adminAlertAcknowledgement.update({ where: { userId_category: { userId, category } }, data: { acknowledgedCount: current[category] } }).catch(() => undefined);
      }
    }
    return result;
  }

  /** Card trends: the window vs the window before it, plus today. Revenue stays per currency; the others count new rows. */
  private async trends(start: Date, days: number, timezone: string) {
    const current = addLocalDays(start, -(days - 1), timezone);
    const previous = addLocalDays(current, -days, timezone);
    const counts = (count: (where: { gte: Date; lt?: Date }) => Promise<number>) => Promise.all([
      count({ gte: current }), count({ gte: previous, lt: current }), count({ gte: start }),
    ]).then(([last30, prior30, added]) => ({ current: last30, previous: prior30, today: added }));
    const [revenue, orders, products, customers] = await Promise.all([
      this.db.$queryRaw<{ currency: string; current: Prisma.Decimal; previous: Prisma.Decimal; today: Prisma.Decimal }[]>(Prisma.sql`
        SELECT "currency",
          COALESCE(SUM("amount") FILTER (WHERE "paidAt" >= ${current}), 0) AS current,
          COALESCE(SUM("amount") FILTER (WHERE "paidAt" < ${current}), 0) AS previous,
          COALESCE(SUM("amount") FILTER (WHERE "paidAt" >= ${start}), 0) AS today
        FROM "payments" WHERE "status" = 'SUCCEEDED' AND "paidAt" >= ${previous}
        GROUP BY 1 ORDER BY 1 ASC`),
      counts(createdAt => this.db.order.count({ where: { createdAt } })),
      counts(createdAt => this.db.product.count({ where: { isTestFixture: false, createdAt } })),
      counts(createdAt => this.db.user.count({ where: { role: { name: 'CUSTOMER' }, createdAt } })),
    ]);
    return {
      revenue: revenue.map(row => ({ currency: row.currency, current: new Prisma.Decimal(row.current).toFixed(2),
        previous: new Prisma.Decimal(row.previous).toFixed(2), today: new Prisma.Decimal(row.today).toFixed(2) })),
      orders, products, customers,
    };
  }

  async overview(days: number) {
    const now = this.clock();
    const settings = this.db.storeSettings ? await this.db.storeSettings.findUnique({ where: { id: 'default' }, select: { timezone: true } }) : null;
    const timezone = storeTimeZone(settings?.timezone);
    const { today, since, end } = localDayWindow(now, days, timezone);
    const [revenue, series, statusGroups, ordersInWindow, products, activeProducts, customers, activeCustomers, recent, lowStockRows, fulfillment, stock, trends] =
      await Promise.all([
        this.db.payment.groupBy({ by: ['currency'], where: { status: 'SUCCEEDED', paidAt: { gte: since, lt: end } }, _sum: { amount: true },
          _count: { _all: true }, orderBy: { currency: 'asc' } }),
        this.db.$queryRaw<{ day: string; currency: string; amount: Prisma.Decimal; orders: bigint }[]>(Prisma.sql`
          SELECT to_char(date_trunc('day', "paidAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}), 'YYYY-MM-DD') AS day, "currency", SUM("amount") AS amount, COUNT(*) AS orders
          FROM "payments" WHERE "status" = 'SUCCEEDED' AND "paidAt" >= ${since} AND "paidAt" < ${end}
          GROUP BY 1, 2 ORDER BY 1 ASC`),
        this.db.order.groupBy({ by: ['status'], _count: { _all: true } }),
        this.db.order.count({ where: { createdAt: { gte: since, lt: end } } }),
        this.db.product.count({ where: { isTestFixture: false } }),
        this.db.product.count({ where: { isTestFixture: false, status: 'ACTIVE', category: { isActive: true }, inventory: { quantity: { gt: 0 } } } }),
        this.db.user.count({ where: { role: { name: 'CUSTOMER' }, NOT: { email: { endsWith: '@deleted.invalid' } } } }),
        this.db.user.count({ where: { role: { name: 'CUSTOMER' }, isActive: true } }),
        this.db.order.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 6, select: {
          id: true, status: true, total: true, currency: true, createdAt: true, deliveryMethod: true,
          user: { select: { id: true, email: true, firstName: true, lastName: true } }, payment: { select: { status: true } },
          delivery: { select: { status: true, trackingCode: true, revision: true } }, items: { select: { quantity: true } } } }),
        this.db.product.findMany({ where: { isTestFixture: false, inventory: { is: { status: { in: ['LOW_STOCK', 'OUT_OF_STOCK'] } } } },
          orderBy: [{ inventory: { quantity: 'asc' } }, { name: 'asc' }], take: 5,
          select: { id: true, name: true, sku: true, inventory: { select: { quantity: true, lowStockAt: true } } } }),
        this.fulfillment(),
        this.inventory.summary(),
        this.trends(today, days, timezone),
      ]);
    const statusCounts = Object.fromEntries(ORDER_STATUSES.map(status => [status, statusGroups.find(group => group.status === status)?._count._all ?? 0]));
    return {
      generatedAt: now.toISOString(),
      window: { days, since: since.toISOString(), timezone },
      revenue: revenue.map(row => ({ currency: row.currency, amount: (row._sum.amount ?? new Prisma.Decimal(0)).toFixed(2), payments: row._count._all })),
      revenueSeries: series.map(row => ({ day: row.day, currency: row.currency,
        amount: new Prisma.Decimal(row.amount).toFixed(2), payments: Number(row.orders) })),
      orders: { total: Object.values(statusCounts).reduce((sum, count) => sum + count, 0), inWindow: ordersInWindow, byStatus: statusCounts },
      products: { total: products, sellable: activeProducts },
      customers: { total: customers, active: activeCustomers },
      inventory: { ...stock, attention: lowStockRows.map(row => ({ productId: row.id, name: row.name, sku: row.sku,
        quantity: row.inventory!.quantity, lowStockAt: row.inventory!.lowStockAt,
        stockStatus: deriveStockStatus(row.inventory!.quantity, row.inventory!.lowStockAt) })) },
      fulfillment,
      trends,
      recentOrders: recent.map(projectOrderRow),
    };
  }
}
