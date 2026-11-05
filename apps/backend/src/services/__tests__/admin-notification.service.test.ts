import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const audit = vi.hoisted(() => ({ recordAdminAudit: vi.fn() }));
const logs = vi.hoisted(() => ({ logSafely: vi.fn() }));
const db = vi.hoisted(() => {
  const handle: Record<string, unknown> = {
    adminNotificationPreference: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    order: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    emailDelivery: { create: vi.fn(), update: vi.fn() },
  };
  handle.$transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(handle));
  return handle as {
    adminNotificationPreference: Record<'findUnique' | 'create' | 'updateMany', ReturnType<typeof vi.fn>>;
    order: { findUnique: ReturnType<typeof vi.fn> };
    user: { findMany: ReturnType<typeof vi.fn> };
    emailDelivery: Record<'create' | 'update', ReturnType<typeof vi.fn>>;
    $transaction: ReturnType<typeof vi.fn>;
  };
});

vi.mock('../../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../admin-audit.js', () => ({ recordAdminAudit: audit.recordAdminAudit }));
vi.mock('../../utils/logger.js', () => ({ logSafely: logs.logSafely, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { AdminNotificationService, preferencesUpdateSchema } from '../admin-notification.service.js';
import { AppError } from '../../middleware/errorHandler.js';

const ADMIN = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const ORDER = '3e7dd3c4-7b2f-4c9b-9f6a-4d0f3b2c1e33';
const current = { orderPaid: true, lowStock: true, invitationAccepted: true, version: 2 };
const validPrefs = { expectedVersion: 2, orderPaid: false, lowStock: true, invitationAccepted: true };

let provider: { sendTransactionalEmail: ReturnType<typeof vi.fn> };
let service: AdminNotificationService;
beforeEach(() => {
  vi.clearAllMocks();
  provider = { sendTransactionalEmail: vi.fn(async () => ({ success: true, messageId: 'brevo-1' })) };
  service = new AdminNotificationService(db as never, provider as never);
  db.adminNotificationPreference.findUnique.mockResolvedValue(current);
  db.adminNotificationPreference.create.mockResolvedValue({});
  db.adminNotificationPreference.updateMany.mockResolvedValue({ count: 1 });
  db.emailDelivery.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'delivery-1', ...data }));
  db.emailDelivery.update.mockResolvedValue({});
  db.order.findUnique.mockResolvedValue({ total: new Prisma.Decimal('129.5'), currency: 'USD' });
  db.user.findMany.mockResolvedValue([{ id: ADMIN, email: 'admin@example.com' }]);
  audit.recordAdminAudit.mockResolvedValue(undefined);
});

describe('preferences validation', () => {
  it('accepts exactly the three toggles and rejects any extra key such as a userId', () => {
    expect(preferencesUpdateSchema.safeParse(validPrefs).success).toBe(true);
    expect(preferencesUpdateSchema.safeParse({ ...validPrefs, userId: ADMIN }).success).toBe(false);
    expect(preferencesUpdateSchema.safeParse({ ...validPrefs, expectedVersion: -1 }).success).toBe(false);
  });
});

describe('getPreferences', () => {
  it('returns the schema defaults for an administrator who never saved preferences', async () => {
    db.adminNotificationPreference.findUnique.mockResolvedValue(null);
    await expect(service.getPreferences(ADMIN)).resolves.toEqual({ orderPaid: true, lowStock: true, invitationAccepted: true, version: 0 });
  });

  it('reads only the row keyed by the given user id', async () => {
    await service.getPreferences(ADMIN);
    expect(db.adminNotificationPreference.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: ADMIN } }));
  });
});

describe('updatePreferences', () => {
  it('updates the caller row with a version guard, bumps the version and audits field names inside the transaction', async () => {
    const result = await service.updatePreferences(ADMIN, validPrefs, 'req-9');
    expect(db.adminNotificationPreference.updateMany).toHaveBeenCalledWith({
      where: { userId: ADMIN, version: 2 },
      data: { orderPaid: false, lowStock: true, invitationAccepted: true, version: { increment: 1 } },
    });
    expect(audit.recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
      actorId: ADMIN, action: 'NOTIFICATION_PREFERENCES_UPDATED', requestId: 'req-9',
      details: { version: 3, changedFields: ['orderPaid'] },
    }), db);
    expect(result).toEqual({ orderPaid: false, lowStock: true, invitationAccepted: true, version: 3 });
  });

  it('creates the first row at version 1 when none exists and expectedVersion is 0', async () => {
    db.adminNotificationPreference.findUnique.mockResolvedValue(null);
    const result = await service.updatePreferences(ADMIN, { ...validPrefs, expectedVersion: 0 });
    expect(db.adminNotificationPreference.create).toHaveBeenCalledWith({
      data: { userId: ADMIN, orderPaid: false, lowStock: true, invitationAccepted: true, version: 1 },
    });
    expect(result.version).toBe(1);
  });

  it('a stale version is a 409 carrying the current preferences and writes nothing', async () => {
    const error = await service.updatePreferences(ADMIN, { ...validPrefs, expectedVersion: 1 }).catch(caught => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT', current: { version: 2, orderPaid: true } });
    expect(db.adminNotificationPreference.updateMany).not.toHaveBeenCalled();
    expect(audit.recordAdminAudit).not.toHaveBeenCalled();
  });

  it('a lost race (no row matched the version guard) is a 409 and no audit row is written', async () => {
    db.adminNotificationPreference.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.updatePreferences(ADMIN, validPrefs)).rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' });
    expect(audit.recordAdminAudit).not.toHaveBeenCalled();
  });

  it('a unique-constraint violation on the first create is mapped to 409', async () => {
    db.adminNotificationPreference.findUnique.mockResolvedValue(null);
    db.adminNotificationPreference.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: 'test' }));
    await expect(service.updatePreferences(ADMIN, { ...validPrefs, expectedVersion: 0 })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects an invalid body before any database access', async () => {
    await expect(service.updatePreferences(ADMIN, { ...validPrefs, orderPaid: 'yes' })).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('operational notifications', () => {
  const flush = () => vi.waitFor(() => expect(provider.sendTransactionalEmail).toHaveBeenCalled());

  it('sends the order-paid alert to each eligible administrator and marks the delivery SENT with the provider message id', async () => {
    service.notifyOrderPaid(ORDER);
    await flush();
    await vi.waitFor(() => expect(db.emailDelivery.update).toHaveBeenCalled());
    expect(db.emailDelivery.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'ADMIN_NOTIFICATION', userId: ADMIN,
      recipient: 'admin@example.com', status: 'QUEUED', provider: 'BREVO' }) });
    expect(provider.sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@example.com', tags: ['ADMIN_NOTIFICATION'] }));
    expect(db.emailDelivery.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'delivery-1' },
      data: expect.objectContaining({ status: 'SENT', providerMessageId: 'brevo-1' }) }));
  });

  it('the order-paid body carries the reference and the server-stored total, not client data', async () => {
    service.notifyOrderPaid(ORDER);
    await flush();
    const sent = provider.sendTransactionalEmail.mock.calls[0][0];
    expect(sent.textContent).toContain('129.50');
    expect(sent.textContent).toContain('USD');
  });

  it('records a provider rejection as FAILED without throwing into the caller', async () => {
    provider.sendTransactionalEmail.mockResolvedValue({ success: false });
    service.notifyLowStock({ productName: 'USB-C Cable', status: 'LOW_STOCK', quantity: 2 });
    await vi.waitFor(() => expect(db.emailDelivery.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', failureReason: 'Email provider delivery failed' }),
    })));
    expect(logs.logSafely).toHaveBeenCalledWith('warn', expect.any(String), expect.objectContaining({ recipients: 1, sent: 0, failed: 1 }));
  });

  it('a thrown provider error marks the delivery FAILED and does not reject', async () => {
    provider.sendTransactionalEmail.mockRejectedValue(new Error('network down'));
    service.notifyLowStock({ productName: 'Dock', status: 'OUT_OF_STOCK', quantity: 0 });
    await vi.waitFor(() => expect(db.emailDelivery.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    })));
  });

  it('sends nothing and writes no delivery row when no administrator is eligible', async () => {
    db.user.findMany.mockResolvedValue([]);
    service.notifyLowStock({ productName: 'Dock', status: 'LOW_STOCK', quantity: 1 });
    await vi.waitFor(() => expect(db.user.findMany).toHaveBeenCalled());
    expect(provider.sendTransactionalEmail).not.toHaveBeenCalled();
    expect(db.emailDelivery.create).not.toHaveBeenCalled();
  });

  it('an order that cannot be found sends nothing and does not throw', async () => {
    db.order.findUnique.mockResolvedValue(null);
    service.notifyOrderPaid(ORDER);
    await vi.waitFor(() => expect(db.order.findUnique).toHaveBeenCalled());
    expect(provider.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('escapes product names in the HTML body', async () => {
    service.notifyLowStock({ productName: '<img src=x onerror=alert(1)>', status: 'LOW_STOCK', quantity: 3 });
    await flush();
    const html = provider.sendTransactionalEmail.mock.calls[0][0].htmlContent as string;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('recipients are active, email-verified ADMIN users whose preference is on or unset', async () => {
    await service.recipientsFor('LOW_STOCK');
    const where = db.user.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ isActive: true, emailVerifiedAt: { not: null }, role: { name: 'ADMIN' } });
    expect(where.OR).toEqual([{ adminNotificationPreference: { is: null } }, { adminNotificationPreference: { is: { lowStock: true } } }]);
  });
});
