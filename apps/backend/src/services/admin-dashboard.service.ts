import { Prisma, PrismaClient, type OrderStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AdminInventoryService } from './admin-inventory.service.js';
import { projectOrderRow } from './admin-order.service.js';
import { deriveStockStatus } from './inventory.service.js';

/**
 * Task 05.1 operational overview: bounded aggregates over the canonical tables only (no analytics warehouse, no growth percentages).
 * Revenue = amount of stored SUCCEEDED payments whose paidAt falls in the window (UTC days), grouped by currency, never summed
 * across currencies. Refunded payments have status REFUNDED and are therefore excluded; pending/processing/failed never count.
 */
const ORDER_STATUSES: OrderStatus[] = ['AWAITING_CAPTURE', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];
const DAY = 24 * 60 * 60 * 1000;

export class AdminDashboardService {
  constructor(private readonly db: PrismaClient = prisma, private readonly inventory = new AdminInventoryService(),
    private readonly clock: () => Date = () => new Date()) {}

  /** Paid orders waiting at each fulfillment step. */
  private async fulfillment() {
    const [awaitingFulfillment, preparing, outForDelivery] = await Promise.all((['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY'] as const)
      .map(status => this.db.order.count({ where: { status, payment: { is: { status: 'SUCCEEDED' } } } })));
    return { awaitingFulfillment, preparing, outForDelivery };
  }

  /** Actionable operational counts shared by the dashboard and the header alerts menu. */
  async alerts() {
    const [stock, fulfillment] = await Promise.all([this.inventory.summary(), this.fulfillment()]);
    return { lowStock: stock.lowStock, outOfStock: stock.outOfStock, ...fulfillment, generatedAt: this.clock().toISOString() };
  }

  async overview(days: number) {
    const now = this.clock();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const since = new Date(today - (days - 1) * DAY);
    const [revenue, series, statusGroups, ordersInWindow, products, activeProducts, customers, activeCustomers, recent, lowStockRows, fulfillment, stock] =
      await Promise.all([
        this.db.payment.groupBy({ by: ['currency'], where: { status: 'SUCCEEDED', paidAt: { gte: since } }, _sum: { amount: true },
          _count: { _all: true }, orderBy: { currency: 'asc' } }),
        this.db.$queryRaw<{ day: Date; currency: string; amount: Prisma.Decimal; orders: bigint }[]>(Prisma.sql`
          SELECT date_trunc('day', "paidAt") AS day, "currency", SUM("amount") AS amount, COUNT(*) AS orders
          FROM "payments" WHERE "status" = 'SUCCEEDED' AND "paidAt" >= ${since}
          GROUP BY 1, 2 ORDER BY 1 ASC`),
        this.db.order.groupBy({ by: ['status'], _count: { _all: true } }),
        this.db.order.count({ where: { createdAt: { gte: since } } }),
        this.db.product.count({ where: { isTestFixture: false } }),
        this.db.product.count({ where: { isTestFixture: false, status: 'ACTIVE', category: { isActive: true } } }),
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
      ]);
    const statusCounts = Object.fromEntries(ORDER_STATUSES.map(status => [status, statusGroups.find(group => group.status === status)?._count._all ?? 0]));
    return {
      generatedAt: now.toISOString(),
      window: { days, since: since.toISOString(), timezone: 'UTC' },
      revenue: revenue.map(row => ({ currency: row.currency, amount: (row._sum.amount ?? new Prisma.Decimal(0)).toFixed(2), payments: row._count._all })),
      revenueSeries: series.map(row => ({ day: row.day.toISOString().slice(0, 10), currency: row.currency,
        amount: new Prisma.Decimal(row.amount).toFixed(2), payments: Number(row.orders) })),
      orders: { total: Object.values(statusCounts).reduce((sum, count) => sum + count, 0), inWindow: ordersInWindow, byStatus: statusCounts },
      products: { total: products, sellable: activeProducts },
      customers: { total: customers, active: activeCustomers },
      inventory: { ...stock, attention: lowStockRows.map(row => ({ productId: row.id, name: row.name, sku: row.sku,
        quantity: row.inventory!.quantity, lowStockAt: row.inventory!.lowStockAt,
        stockStatus: deriveStockStatus(row.inventory!.quantity, row.inventory!.lowStockAt) })) },
      fulfillment,
      recentOrders: recent.map(projectOrderRow),
    };
  }
}
