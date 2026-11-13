import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
import { AdminDashboardService } from './admin-dashboard.service.js';
import type { AdminInventoryService } from './admin-inventory.service.js';

const admin = '5a1e2c3d-4b5f-4a6b-8c7d-9e0f1a2b3c4d';
const otherAdmin = '9b1e2c3d-4b5f-4a6b-8c7d-9e0f1a2b3c4e';

/** In-memory stand-in for the acknowledgement table plus the live operational counts it is measured against. */
function harness(initial: { lowStock: number; outOfStock: number; awaiting: number; outForDelivery?: number }) {
  const live = { outForDelivery: 0, ...initial };
  const rows = new Map<string, number>();
  const key = (userId: string, category: string) => `${userId}:${category}`;
  const ack = {
    findMany: vi.fn(async ({ where }: { where: { userId: string } }) => [...rows].filter(([k]) => k.startsWith(where.userId)).map(([k, acknowledgedCount]) => ({ category: k.split(':')[1]!, acknowledgedCount }))),
    upsert: vi.fn(async ({ where, create, update }: { where: { userId_category: { userId: string; category: string } }; create: { acknowledgedCount: number }; update: { acknowledgedCount: number } }) => {
      const k = key(where.userId_category.userId, where.userId_category.category);
      rows.set(k, rows.has(k) ? update.acknowledgedCount : create.acknowledgedCount);
    }),
    update: vi.fn(async ({ where, data }: { where: { userId_category: { userId: string; category: string } }; data: { acknowledgedCount: number } }) => {
      rows.set(key(where.userId_category.userId, where.userId_category.category), data.acknowledgedCount);
    }),
  };
  const db = { adminAlertAcknowledgement: ack, $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    order: { count: vi.fn(async ({ where }: { where: { status: string } }) => where.status === 'CONFIRMED' ? live.awaiting : where.status === 'OUT_FOR_DELIVERY' ? live.outForDelivery : 0) } };
  const inventory = { summary: vi.fn(async () => ({ lowStock: live.lowStock, outOfStock: live.outOfStock })) };
  const service = new AdminDashboardService(db as unknown as PrismaClient, inventory as unknown as AdminInventoryService, () => new Date('2026-11-01T10:00:00.000Z'));
  return { service, live, rows, db };
}
const seen = (lowStock: number, outOfStock: number, awaitingFulfillment: number, outForDelivery = 0) => ({ lowStock, outOfStock, awaitingFulfillment, outForDelivery });

describe('admin alert acknowledgement', () => {
  it('reports every current alert as unread before anything is acknowledged', async () => {
    const { service } = harness({ lowStock: 2, outOfStock: 1, awaiting: 3 });
    const alerts = await service.alerts(admin);
    expect(alerts.unread).toEqual({ lowStock: 2, outOfStock: 1, awaitingFulfillment: 3, outForDelivery: 0, total: 6 });
  });

  it('acknowledging clears unread to zero but never resolves the underlying operational counts', async () => {
    const { service } = harness({ lowStock: 2, outOfStock: 1, awaiting: 3 });
    const alerts = await service.acknowledgeAlerts(admin, seen(2, 1, 3));
    expect(alerts.unread.total).toBe(0);
    expect(alerts).toMatchObject({ lowStock: 2, outOfStock: 1, awaitingFulfillment: 3 });
    // Persisted: a fresh read (page refresh, another device) stays acknowledged.
    expect((await service.alerts(admin)).unread.total).toBe(0);
  });

  it('a new alert after acknowledgement makes the unread count rise again', async () => {
    const { service, live } = harness({ lowStock: 2, outOfStock: 0, awaiting: 1 });
    await service.acknowledgeAlerts(admin, seen(2, 0, 1));
    live.awaiting = 2; live.outOfStock = 1;
    expect((await service.alerts(admin)).unread).toEqual({ lowStock: 0, outOfStock: 1, awaitingFulfillment: 1, outForDelivery: 0, total: 2 });
  });

  it('only acknowledges what the administrator was shown: an alert that arrived meanwhile stays unread', async () => {
    const { service, live } = harness({ lowStock: 1, outOfStock: 0, awaiting: 0 });
    live.lowStock = 3; // two more arrived after the list was rendered with 1
    const alerts = await service.acknowledgeAlerts(admin, seen(1, 0, 0));
    expect(alerts.unread.lowStock).toBe(2);
  });

  it('clamps an inflated client count to the server count', async () => {
    const { service } = harness({ lowStock: 1, outOfStock: 0, awaiting: 0 });
    await service.acknowledgeAlerts(admin, seen(500, 500, 500));
    const alerts = await service.alerts(admin);
    expect(alerts.unread.total).toBe(0);
  });

  it('a recovered condition lowers the baseline so a later recurrence counts as unread', async () => {
    const { service, live, rows } = harness({ lowStock: 5, outOfStock: 0, awaiting: 0 });
    await service.acknowledgeAlerts(admin, seen(5, 0, 0));
    live.lowStock = 1; // restocked
    expect((await service.alerts(admin)).unread.lowStock).toBe(0);
    expect(rows.get(`${admin}:lowStock`)).toBe(1);
    live.lowStock = 3;
    expect((await service.alerts(admin)).unread.lowStock).toBe(2);
  });

  it('is per administrator', async () => {
    const { service } = harness({ lowStock: 2, outOfStock: 0, awaiting: 0 });
    await service.acknowledgeAlerts(admin, seen(2, 0, 0));
    expect((await service.alerts(otherAdmin)).unread.lowStock).toBe(2);
  });

  it('repeating the acknowledgement is idempotent', async () => {
    const { service } = harness({ lowStock: 2, outOfStock: 0, awaiting: 0 });
    await service.acknowledgeAlerts(admin, seen(2, 0, 0));
    expect((await service.acknowledgeAlerts(admin, seen(2, 0, 0))).unread.total).toBe(0);
  });
  it('counts out-for-delivery orders as their own unread category in the aggregate badge', async () => {
    const { service } = harness({ lowStock: 1, outOfStock: 0, awaiting: 0, outForDelivery: 2 });
    const alerts = await service.alerts(admin);
    expect(alerts.unread).toEqual({ lowStock: 1, outOfStock: 0, awaitingFulfillment: 0, outForDelivery: 2, total: 3 });
    expect(alerts.outForDelivery).toBe(2);
  });

  it('acknowledging one category leaves every other category unread and writes only that category', async () => {
    const { service, rows } = harness({ lowStock: 2, outOfStock: 1, awaiting: 3, outForDelivery: 4 });
    const alerts = await service.acknowledgeAlerts(admin, { outOfStock: 1 });
    expect(alerts.unread).toEqual({ lowStock: 2, outOfStock: 0, awaitingFulfillment: 3, outForDelivery: 4, total: 9 });
    expect([...rows.keys()]).toEqual([`${admin}:outOfStock`]);
    expect(alerts).toMatchObject({ lowStock: 2, outOfStock: 1, awaitingFulfillment: 3, outForDelivery: 4 }); // counts unchanged
  });

  it('acknowledges each of the four categories independently until the aggregate reaches zero', async () => {
    const { service } = harness({ lowStock: 2, outOfStock: 1, awaiting: 3, outForDelivery: 4 });
    expect((await service.acknowledgeAlerts(admin, { lowStock: 2 })).unread.total).toBe(8);
    expect((await service.acknowledgeAlerts(admin, { awaitingFulfillment: 3 })).unread.total).toBe(5);
    expect((await service.acknowledgeAlerts(admin, { outForDelivery: 4 })).unread.total).toBe(1);
    expect((await service.acknowledgeAlerts(admin, { outOfStock: 1 })).unread.total).toBe(0);
    expect((await service.alerts(admin)).unread.total).toBe(0); // persisted across a fresh read
  });

  it('a later per-category acknowledgement never lowers a previously stored baseline for another category', async () => {
    const { service, rows } = harness({ lowStock: 2, outOfStock: 0, awaiting: 1 });
    await service.acknowledgeAlerts(admin, { lowStock: 2 });
    await service.acknowledgeAlerts(admin, { awaitingFulfillment: 1 });
    expect(rows.get(`${admin}:lowStock`)).toBe(2);
    expect((await service.alerts(admin)).unread.total).toBe(0);
  });

  it('an empty acknowledgement changes nothing', async () => {
    const { service, rows } = harness({ lowStock: 2, outOfStock: 0, awaiting: 0 });
    expect((await service.acknowledgeAlerts(admin, {})).unread.total).toBe(2);
    expect(rows.size).toBe(0);
  });
});
