import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import type { AdminInventoryService } from './admin-inventory.service.js';
import { storeSettings } from './store-settings.service.js';

/**
 * Real-PostgreSQL proof for migration 20261114000000: the acknowledgement table (composite key, FK, CHECK) and the nullable
 * store_settings.businessHours column. Operational counts come from a stub so the test controls them without inserting products or
 * orders; everything written here is scoped to administrators this test creates and is removed afterwards.
 */
describe.skipIf(process.env.ADMIN_SECURITY_PG_RUN !== '1')('admin alert acknowledgement and business hours on disposable PostgreSQL', () => {
  const live = { lowStock: 0, outOfStock: 0 };
  const created: string[] = [];
  const dashboard = new AdminDashboardService(prisma, { summary: async () => ({ ...live }) } as unknown as AdminInventoryService);
  const admin = async () => {
    const id = randomUUID();
    const role = await prisma.role.upsert({ where: { name: 'ADMIN' }, create: { name: 'ADMIN' }, update: {} });
    await prisma.user.create({ data: { id, roleId: role.id, email: `alerts-${id}@qa.invalid`, firstName: 'QA', lastName: 'Admin' } });
    created.push(id);
    return id;
  };

  beforeAll(() => {
    if (new URL(process.env.DATABASE_URL!).hostname !== '127.0.0.1') throw new Error('Disposable PostgreSQL required');
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  });

  it('persists per-administrator acknowledgement, survives a fresh read, rises for new alerts and never changes the counts', async () => {
    const [first, second] = [await admin(), await admin()];
    live.lowStock = 3; live.outOfStock = 1;
    expect((await dashboard.alerts(first)).unread.total).toBeGreaterThanOrEqual(4);

    const seen = await dashboard.alerts(first);
    const acknowledged = await dashboard.acknowledgeAlerts(first, { lowStock: seen.lowStock, outOfStock: seen.outOfStock, awaitingFulfillment: seen.awaitingFulfillment });
    expect(acknowledged.unread.total).toBe(0);
    expect(acknowledged).toMatchObject({ lowStock: 3, outOfStock: 1 });          // reading never resolves the condition

    // A brand-new service instance reads only what PostgreSQL stored (the refresh / other-tab case).
    const fresh = new AdminDashboardService(prisma, { summary: async () => ({ ...live }) } as unknown as AdminInventoryService);
    expect((await fresh.alerts(first)).unread.total).toBe(0);
    expect((await fresh.alerts(second)).unread.lowStock).toBe(3);               // per administrator

    // Idempotent and concurrency-safe: parallel acknowledgements from two tabs converge on one row per category.
    await Promise.all([1, 2, 3].map(() => dashboard.acknowledgeAlerts(first, { lowStock: 3, outOfStock: 1, awaitingFulfillment: seen.awaitingFulfillment })));
    expect(await prisma.adminAlertAcknowledgement.count({ where: { userId: first } })).toBe(3);

    live.lowStock = 5;                                                           // two new low-stock alerts
    expect((await dashboard.alerts(first)).unread.lowStock).toBe(2);
    live.lowStock = 1;                                                           // restocked: baseline is lowered and stored
    expect((await dashboard.alerts(first)).unread.lowStock).toBe(0);
    expect((await prisma.adminAlertAcknowledgement.findUniqueOrThrow({ where: { userId_category: { userId: first, category: 'lowStock' } } })).acknowledgedCount).toBe(1);
    live.lowStock = 2;
    expect((await dashboard.alerts(first)).unread.lowStock).toBe(1);
  });

  it('enforces the schema: no negative baseline, no orphan rows, and rows disappear with their administrator', async () => {
    const id = await admin();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO admin_alert_acknowledgements ("userId", category, "acknowledgedCount", "updatedAt") VALUES ($1::uuid, 'lowStock', -1, now())`, id))
      .rejects.toThrow();
    await expect(prisma.adminAlertAcknowledgement.create({ data: { userId: randomUUID(), category: 'lowStock', acknowledgedCount: 0 } })).rejects.toThrow();
    await dashboard.acknowledgeAlerts(id, { lowStock: 0, outOfStock: 0, awaitingFulfillment: 0 });
    expect(await prisma.adminAlertAcknowledgement.count({ where: { userId: id } })).toBe(3);
    await prisma.user.delete({ where: { id } });
    created.splice(created.indexOf(id), 1);
    expect(await prisma.adminAlertAcknowledgement.count({ where: { userId: id } })).toBe(0);
    const rls = await prisma.$queryRawUnsafe<{ relrowsecurity: boolean }[]>(`SELECT relrowsecurity FROM pg_class WHERE relname = 'admin_alert_acknowledgements'`);
    expect(rls[0]?.relrowsecurity).toBe(true);
  });

  it('stores, clears and publicly projects business hours through the existing Owner-only settings path', async () => {
    const id = await admin();
    await prisma.adminAccountSecurity.create({ data: { userId: id, isOwner: true, canManageAdmins: true } });
    const initial = await storeSettings.getStore();
    const { version, updatedAt: _updated, currency: _currency, ...profile } = initial;
    try {
      const saved = await storeSettings.updateStore(id, { ...profile, expectedVersion: version, businessHours: 'Monday–Friday, 9:00 AM–6:00 PM' });
      expect(saved.businessHours).toBe('Monday–Friday, 9:00 AM–6:00 PM');
      // An older client that omits the field leaves it untouched.
      const { businessHours: _omit, ...withoutHours } = profile;
      const untouched = await storeSettings.updateStore(id, { ...withoutHours, expectedVersion: saved.version, storeName: `${profile.storeName}` });
      expect(untouched.businessHours).toBe('Monday–Friday, 9:00 AM–6:00 PM');
      const cleared = await storeSettings.updateStore(id, { ...profile, expectedVersion: untouched.version, businessHours: '' });
      expect(cleared.businessHours).toBeNull();
      const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { actorId: id, action: 'STORE_SETTINGS_UPDATED' }, orderBy: { createdAt: 'asc' } });
      expect(JSON.stringify(audit.details)).toContain('businessHours');
      expect(JSON.stringify(audit.details)).not.toContain('Monday');                // names only, never values
    } finally {
      const current = await storeSettings.getStore();
      await storeSettings.updateStore(id, { ...profile, expectedVersion: current.version });
      await prisma.adminAuditLog.deleteMany({ where: { actorId: id } }).catch(() => undefined);
    }
  });
});
