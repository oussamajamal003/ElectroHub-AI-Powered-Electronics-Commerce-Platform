import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { storeSettings } from './store-settings.service.js';

describe.skipIf(process.env.ADMIN_SECURITY_PG_RUN !== '1')('store identity and ownership on disposable PostgreSQL', () => {
  beforeAll(() => {
    if (new URL(process.env.DATABASE_URL!).hostname !== '127.0.0.1') throw new Error('Disposable PostgreSQL required');
  });
  afterAll(() => prisma.$disconnect());

  it('serializes competing writes, rejects a demoted Owner, and preserves shipping and historical payments', async () => {
    const id = randomUUID();
    const role = await prisma.role.upsert({ where: { name: 'ADMIN' }, create: { name: 'ADMIN' }, update: {} });
    await prisma.user.create({ data: { id, roleId: role.id, email: `owner-${id}@qa.invalid`, firstName: 'QA', lastName: 'Owner' } });
    await prisma.adminAccountSecurity.create({ data: { userId: id, isOwner: true, canManageAdmins: true } });
    const initial = await storeSettings.getStore();
    const { version, updatedAt: _updated, ...profile } = initial;
    const draft = { ...profile, expectedVersion: version, storeName: 'ElectroTech', country: 'Lebanon', timezone: 'Asia/Beirut' };
    const shipping = await storeSettings.previewShipping('60');
    const payments = await prisma.payment.aggregate({ _count: true, _sum: { amount: true } });
    try {
      const results = await Promise.allSettled([storeSettings.updateStore(id, draft), storeSettings.updateStore(id, draft)]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'VERSION_CONFLICT' } });
      const saved = await storeSettings.getStore();
      expect(saved).toMatchObject({ storeName: 'ElectroTech', country: 'Lebanon', currency: 'USD', version: version + 1 });
      await prisma.adminAccountSecurity.update({ where: { userId: id }, data: { isOwner: false } });
      await expect(storeSettings.updateStore(id, { ...draft, expectedVersion: saved.version })).rejects.toMatchObject({ code: 'CAPABILITY_REQUIRED' });
      expect(await storeSettings.getStore()).toEqual(saved);
      expect(await prisma.adminAuditLog.count({ where: { actorId: id, action: 'STORE_SETTINGS_UPDATED' } })).toBe(1);
      expect(await storeSettings.previewShipping('60')).toEqual(shipping);
      expect(await prisma.payment.aggregate({ _count: true, _sum: { amount: true } })).toEqual(payments);
    } finally {
      await prisma.adminAccountSecurity.update({ where: { userId: id }, data: { isOwner: true } });
      const current = await storeSettings.getStore();
      await storeSettings.updateStore(id, { ...profile, expectedVersion: current.version });
    }
  });
});
