import express from 'express';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import settingsRoutes from './admin-settings.routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { invalidateShippingConfig } from '../services/shipping-config.js';

const ids = vi.hoisted(() => ({ admin: '8f2813b4-a388-44d3-b51e-5d4c40386677' }));
const db = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() });
  const handle: Record<string, unknown> = { storeSettings: model(), shippingSettings: model(), shippingMethodSetting: model(),
    adminAccountSecurity: model(), adminNotificationPreference: model(), adminAuditLog: { create: vi.fn() }, user: { findMany: vi.fn() } };
  handle.$queryRaw = vi.fn().mockResolvedValue([{ userId: "owner" }]);
  handle.$transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(handle));
  return handle as Record<string, ReturnType<typeof model> & Record<string, unknown>> & { $transaction: ReturnType<typeof vi.fn>; adminAuditLog: { create: ReturnType<typeof vi.fn> }; user: { findMany: ReturnType<typeof vi.fn> } };
});

vi.mock('../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, logSafely: vi.fn() }));
// The shared admin guard chain needs a live MFA-assured session (covered by its own tests). Here it only proves that the router
// is guarded: a request without credentials never reaches a handler, and an accepted request carries the authenticated user id.
vi.mock('../middleware/adminGuard.js', async importOriginal => ({ ...await importOriginal<typeof import('../middleware/adminGuard.js')>(), adminGuard: [(req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.headers.authorization) { res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Sign in.' } }); return; }
  Object.assign(req, { user: { userId: ids.admin, role: 'ADMIN' }, adminSession: { mfaVerifiedAt: new Date(), stepUpAt: new Date() } });
  res.set('Cache-Control', 'private, no-store');
  next();
}] }));

const app = express();
app.use(express.json());
app.use('/api', settingsRoutes);
app.use(errorHandler);
const as = <T extends request.Test>(test: T) => test.set('Authorization', 'Bearer test-token');

const storeRow = { storeName: 'ElectroHub', supportEmail: null, supportPhone: null, addressLine1: null, addressLine2: null, city: null,
  region: null, postalCode: null, country: null, timezone: 'UTC', version: 3, updatedAt: new Date('2026-11-01T00:00:00Z') };
const seedRows = [
  { method: 'STANDARD', enabled: true, price: new Prisma.Decimal('0.00') },
  { method: 'EXPRESS', enabled: true, price: new Prisma.Decimal('9.99') },
  { method: 'OVERNIGHT', enabled: true, price: new Prisma.Decimal('19.99') },
];
const validStore = { expectedVersion: 3, storeName: 'Northwind Electronics', supportEmail: 'help@example.com', supportPhone: '+1 555 010 2000',
  addressLine1: '', addressLine2: null, city: 'Springfield', region: null, postalCode: '12345', country: 'United States', timezone: 'Europe/Paris', currency: 'USD' };
const validShipping = { expectedVersion: 2, freeShippingThreshold: '50.00',
  methods: [{ method: 'STANDARD', enabled: true, price: '4.99' }, { method: 'EXPRESS', enabled: true, price: '9.99' }, { method: 'OVERNIGHT', enabled: false, price: '19.99' }] };

beforeEach(() => {
  vi.clearAllMocks();
  invalidateShippingConfig();
  db.adminAccountSecurity.findUnique.mockResolvedValue({ isOwner: true, canManageAdmins: true });
  db.storeSettings.findUnique.mockResolvedValue(storeRow);
  db.storeSettings.findUniqueOrThrow.mockResolvedValue({ ...storeRow, storeName: 'Northwind Electronics', timezone: 'Europe/Paris', version: 4 });
  db.storeSettings.updateMany.mockResolvedValue({ count: 1 });
  db.shippingSettings.findUnique.mockResolvedValue({ version: 2, freeShippingThreshold: null });
  db.shippingSettings.updateMany.mockResolvedValue({ count: 1 });
  db.shippingMethodSetting.findMany.mockResolvedValue(seedRows);
  db.shippingMethodSetting.upsert.mockResolvedValue({});
  db.adminNotificationPreference.findUnique.mockResolvedValue(null);
  db.adminNotificationPreference.create.mockResolvedValue({});
  db.adminNotificationPreference.updateMany.mockResolvedValue({ count: 1 });
  db.adminNotificationPreference.findUniqueOrThrow.mockResolvedValue(null);
  db.adminAuditLog.create.mockResolvedValue({});
});

describe('administrator settings API guard', () => {
  it.each([
    ['get', '/api/admin/settings/store'], ['patch', '/api/admin/settings/store'], ['get', '/api/admin/settings/shipping'],
    ['get', '/api/admin/settings/shipping/preview?subtotal=10'], ['patch', '/api/admin/settings/shipping'],
    ['get', '/api/admin/me/notification-preferences'], ['patch', '/api/admin/me/notification-preferences'],
  ] as const)('%s %s without credentials is rejected before any read or write', async (method, path) => {
    const response = await request(app)[method](path).send({});
    expect(response.status).toBe(401);
    expect(db.storeSettings.findUnique).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('store profile', () => {
  it.each([false, true])('allows read only for non-Owner with manage-admins=%s', async canManageAdmins => {
    db.adminAccountSecurity.findUnique.mockResolvedValue({ isOwner: false, canManageAdmins });
    expect((await as(request(app).get('/api/admin/settings/store'))).status).toBe(200);
    const response = await as(request(app).patch('/api/admin/settings/store').send(validStore));
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CAPABILITY_REQUIRED');
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('GET returns the stored profile with USD fixed and a private response', async () => {
    const response = await as(request(app).get('/api/admin/settings/store'));
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ storeName: 'ElectroHub', timezone: 'UTC', currency: 'USD', version: 3 });
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('rejects a currency change with a field error and writes nothing', async () => {
    const response = await as(request(app).patch('/api/admin/settings/store').send({ ...validStore, currency: 'EUR' }));
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: 'VALIDATION_ERROR', fields: [{ field: 'currency' }] });
    expect(db.storeSettings.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an unknown time zone and an invalid support email with field names only', async () => {
    const response = await as(request(app).patch('/api/admin/settings/store').send({ ...validStore, timezone: 'Mars/Olympus', supportEmail: 'nope' }));
    expect(response.status).toBe(400);
    expect(response.body.error.fields.map((issue: { field: string }) => issue.field)).toEqual(expect.arrayContaining(['timezone', 'supportEmail']));
    expect(JSON.stringify(response.body)).not.toContain('Mars/Olympus');
  });

  it('a stale expectedVersion is a 409 VERSION_CONFLICT carrying the current profile', async () => {
    db.storeSettings.updateMany.mockResolvedValue({ count: 0 });
    db.storeSettings.findUniqueOrThrow.mockResolvedValue({ ...storeRow, version: 4 });
    const response = await as(request(app).patch('/api/admin/settings/store').send(validStore));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('VERSION_CONFLICT');
    expect(response.body.data).toMatchObject({ version: 4 });
  });

  it('a valid save writes one versioned update and an audit row that names only the changed fields', async () => {
    const response = await as(request(app).patch('/api/admin/settings/store').send(validStore));
    expect(response.status).toBe(200);
    expect(db.storeSettings.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'default', version: 3 } }));
    const audit = db.adminAuditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ actorId: ids.admin, action: 'STORE_SETTINGS_UPDATED', resourceType: 'STORE_SETTINGS' });
    expect(audit.details.changedFields).toEqual(expect.arrayContaining(['storeName', 'timezone']));
    expect(audit.details.changedFields).not.toContain('currency');
    expect(JSON.stringify(audit)).not.toContain('Northwind');
    expect(JSON.stringify(audit)).not.toContain('help@example.com');
  });
});

describe('shipping', () => {
  it('GET returns the stored methods with fixed labels and the configured threshold', async () => {
    db.shippingSettings.findUnique.mockResolvedValue({ version: 2, freeShippingThreshold: new Prisma.Decimal('50') });
    const response = await as(request(app).get('/api/admin/settings/shipping'));
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ version: 2, currency: 'USD', freeShippingThreshold: '50.00' });
    expect(response.body.data.methods[1]).toMatchObject({ method: 'EXPRESS', label: 'Express Delivery', enabled: true, price: '9.99' });
  });

  it('rejects a configuration with no enabled method', async () => {
    const body = { ...validShipping, methods: validShipping.methods.map(method => ({ ...method, enabled: false })) };
    const response = await as(request(app).patch('/api/admin/settings/shipping').send(body));
    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual([expect.objectContaining({ field: 'methods' })]);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a price with more than two decimals or above the maximum', async () => {
    const tooPrecise = { ...validShipping, methods: [validShipping.methods[0], { ...validShipping.methods[1], price: '10.005' }, validShipping.methods[2]] };
    const tooLarge = { ...validShipping, methods: [validShipping.methods[0], { ...validShipping.methods[1], price: '10000' }, validShipping.methods[2]] };
    for (const body of [tooPrecise, tooLarge]) {
      const response = await as(request(app).patch('/api/admin/settings/shipping').send(body));
      expect(response.status).toBe(400);
      expect(response.body.error.fields[0].field).toBe('methods.1.price');
    }
  });

  it('a stale version is a 409 and no method row is written', async () => {
    db.shippingSettings.updateMany.mockResolvedValue({ count: 0 });
    const response = await as(request(app).patch('/api/admin/settings/shipping').send(validShipping));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('VERSION_CONFLICT');
    expect(db.shippingMethodSetting.upsert).not.toHaveBeenCalled();
  });

  it('a valid save upserts every method in the transaction and audits field names only', async () => {
    const response = await as(request(app).patch('/api/admin/settings/shipping').send(validShipping));
    expect(response.status).toBe(200);
    expect(db.shippingMethodSetting.upsert).toHaveBeenCalledTimes(3);
    const audit = db.adminAuditLog.create.mock.calls[0][0].data;
    expect(audit.details.changedFields).toEqual(expect.arrayContaining(['freeShippingThreshold', 'methods.OVERNIGHT.enabled', 'methods.STANDARD.price']));
    expect(JSON.stringify(audit)).not.toMatch(/4\.99|50\.00/);
  });

  it('preview returns the real quote rows for a subtotal, including the free-standard threshold boundary', async () => {
    db.shippingSettings.findUnique.mockResolvedValue({ version: 2, freeShippingThreshold: new Prisma.Decimal('50') });
    db.shippingMethodSetting.findMany.mockResolvedValue([{ method: 'STANDARD', enabled: true, price: new Prisma.Decimal('4.99') },
      { method: 'EXPRESS', enabled: false, price: new Prisma.Decimal('9.99') }, { method: 'OVERNIGHT', enabled: true, price: new Prisma.Decimal('19.99') }]);
    const below = await as(request(app).get('/api/admin/settings/shipping/preview?subtotal=49.99'));
    expect(below.status).toBe(200);
    expect(below.body.data.methods.map((quote: { id: string; price: string }) => [quote.id, quote.price])).toEqual([['STANDARD', '4.99'], ['OVERNIGHT', '19.99']]);
    const at = await as(request(app).get('/api/admin/settings/shipping/preview?subtotal=50'));
    expect(at.body.data.methods[0]).toMatchObject({ id: 'STANDARD', price: '0.00' });
  });

  it('preview rejects a malformed subtotal', async () => {
    const response = await as(request(app).get('/api/admin/settings/shipping/preview?subtotal=abc'));
    expect(response.status).toBe(400);
    expect(response.body.error.fields[0].field).toBe('subtotal');
  });
});

describe('notification preferences (self only)', () => {
  it('GET returns the defaults for an administrator who never saved preferences', async () => {
    const response = await as(request(app).get('/api/admin/me/notification-preferences'));
    expect(response.body.data).toEqual({ orderPaid: true, lowStock: true, invitationAccepted: true, version: 0 });
  });

  it('PATCH creates the caller row at version 1 and never accepts a userId from the body', async () => {
    const forged = await as(request(app).patch('/api/admin/me/notification-preferences')
      .send({ expectedVersion: 0, orderPaid: false, lowStock: true, invitationAccepted: true, userId: '3e7dd3c4-7b2f-4c9b-9f6a-4d0f3b2c1e33' }));
    expect(forged.status).toBe(400);
    expect(db.adminNotificationPreference.create).not.toHaveBeenCalled();

    db.adminNotificationPreference.findUniqueOrThrow.mockResolvedValue(null);
    const response = await as(request(app).patch('/api/admin/me/notification-preferences')
      .send({ expectedVersion: 0, orderPaid: false, lowStock: true, invitationAccepted: true }));
    expect(response.status).toBe(200);
    expect(db.adminNotificationPreference.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: ids.admin, orderPaid: false, version: 1 }) });
  });

  it('a stale preference version is a 409 with the current preferences', async () => {
    db.adminNotificationPreference.findUnique.mockResolvedValue({ orderPaid: false, lowStock: true, invitationAccepted: true, version: 2 });
    const response = await as(request(app).patch('/api/admin/me/notification-preferences')
      .send({ expectedVersion: 1, orderPaid: true, lowStock: true, invitationAccepted: true }));
    expect(response.status).toBe(409);
    expect(response.body.data).toMatchObject({ orderPaid: false, version: 2 });
  });
});
