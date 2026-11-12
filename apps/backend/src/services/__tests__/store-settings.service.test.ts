import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const audit = vi.hoisted(() => ({ recordAdminAudit: vi.fn() }));
const db = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() });
  const handle: Record<string, unknown> = { storeSettings: model(), shippingSettings: model(), shippingMethodSetting: model() };
  handle.$queryRaw = vi.fn().mockResolvedValue([{ userId: "owner" }]);
  handle.$transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(handle));
  return handle as Record<string, ReturnType<typeof model>> & { $transaction: ReturnType<typeof vi.fn> };
});

vi.mock('../../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../admin-audit.js', () => ({ recordAdminAudit: audit.recordAdminAudit }));

import { StoreSettingsService, shippingPreviewSchema, shippingUpdateSchema, storeUpdateSchema } from '../store-settings.service.js';
import { invalidateShippingConfig } from '../shipping-config.js';
import { AppError } from '../../middleware/errorHandler.js';

const ACTOR = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const storeRow = { storeName: 'ElectroHub', supportEmail: null, supportPhone: null, addressLine1: null, addressLine2: null, city: null,
  region: null, postalCode: null, country: null, timezone: 'UTC', version: 1, updatedAt: new Date('2026-11-01T00:00:00Z') };
const validStore = { expectedVersion: 1, storeName: 'ElectroHub', supportEmail: null, supportPhone: null, addressLine1: null,
  addressLine2: null, city: null, region: null, postalCode: null, country: null, timezone: 'UTC', currency: 'USD' };
const sharedShippingRows = [
  { method: 'STANDARD', enabled: true, price: new Prisma.Decimal('0.00') },
  { method: 'EXPRESS', enabled: true, price: new Prisma.Decimal('9.99') },
  { method: 'OVERNIGHT', enabled: true, price: new Prisma.Decimal('19.99') },
];
const validShipping = {
  expectedVersion: 1,
  freeShippingThreshold: null,
  methods: [
    { method: 'STANDARD', enabled: true, price: '0' },
    { method: 'EXPRESS', enabled: true, price: '9.9' },
    { method: 'OVERNIGHT', enabled: false, price: '19.99' },
  ],
};

let service: StoreSettingsService;
beforeEach(() => {
  vi.clearAllMocks();
  invalidateShippingConfig();
  service = new StoreSettingsService(db as never);
  db.storeSettings.findUnique.mockResolvedValue(storeRow);
  db.storeSettings.findUniqueOrThrow.mockResolvedValue(storeRow);
  db.storeSettings.updateMany.mockResolvedValue({ count: 1 });
  db.shippingSettings.findUnique.mockResolvedValue({ version: 1, freeShippingThreshold: null });
  db.shippingSettings.updateMany.mockResolvedValue({ count: 1 });
  db.shippingMethodSetting.findMany.mockResolvedValue(sharedShippingRows);
  db.shippingMethodSetting.upsert.mockResolvedValue({});
  audit.recordAdminAudit.mockResolvedValue(undefined);
});

describe('store profile validation', () => {
  it.each(['P2021', 'P2022', 'P1001'])('does not mask database failure %s as a default store', async code => {
    const error = new Prisma.PrismaClientKnownRequestError('Database unavailable', { code, clientVersion: '6.12.0' });
    db.storeSettings.findUnique.mockRejectedValueOnce(error);
    await expect(service.getStore()).rejects.toBe(error);
  });
  it('accepts the USD echo and rejects any other currency', () => {
    expect(storeUpdateSchema.safeParse(validStore).success).toBe(true);
    expect(storeUpdateSchema.safeParse({ ...validStore, currency: 'EUR' }).success).toBe(false);
  });

  it('rejects an unknown time zone and a phone number without 7 to 15 digits', () => {
    expect(storeUpdateSchema.safeParse({ ...validStore, timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(storeUpdateSchema.safeParse({ ...validStore, supportPhone: '12-34' }).success).toBe(false);
    expect(storeUpdateSchema.safeParse({ ...validStore, supportPhone: '+1 (555) 010-2000' }).success).toBe(true);
  });

  it('normalises blank optional text to null and rejects unknown keys', () => {
    const parsed = storeUpdateSchema.parse({ ...validStore, city: '   ', supportEmail: '' });
    expect(parsed.city).toBeNull();
    expect(parsed.supportEmail).toBeNull();
    expect(storeUpdateSchema.safeParse({ ...validStore, role: 'ADMIN' }).success).toBe(false);
  });
});

describe('updateStore', () => {
  it('writes one conditional update, bumps the version and audits changed field names only, inside the transaction', async () => {
    db.storeSettings.findUniqueOrThrow.mockResolvedValue({ ...storeRow, storeName: 'Northwind', version: 2 });
    const result = await service.updateStore(ACTOR, { ...validStore, storeName: 'Northwind', currency: undefined }, 'req-1');

    expect(db.storeSettings.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'default', version: 1 },
      data: expect.objectContaining({ storeName: 'Northwind', version: { increment: 1 }, updatedById: ACTOR }),
    }));
    expect(audit.recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
      actorId: ACTOR, action: 'STORE_SETTINGS_UPDATED', requestId: 'req-1',
      details: { version: 2, changedFields: ['storeName'] },
    }), db);
    expect(JSON.stringify(audit.recordAdminAudit.mock.calls[0][0])).not.toContain('Northwind');
    expect(result).toMatchObject({ storeName: 'Northwind', currency: 'USD', version: 2 });
  });

  it('a version that no longer matches is a 409 carrying the current profile and writes nothing', async () => {
    db.storeSettings.findUnique.mockResolvedValue({ ...storeRow, version: 3 });
    const error = await service.updateStore(ACTOR, validStore).catch(caught => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT', current: { version: 3 } });
    expect(db.storeSettings.updateMany).not.toHaveBeenCalled();
    expect(audit.recordAdminAudit).not.toHaveBeenCalled();
  });

  it('a lost race (updateMany matches nothing) is a 409, and the audit row is not written', async () => {
    db.storeSettings.updateMany.mockResolvedValue({ count: 0 });
    db.storeSettings.findUniqueOrThrow.mockResolvedValue({ ...storeRow, version: 2 });
    await expect(service.updateStore(ACTOR, validStore)).rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' });
    expect(audit.recordAdminAudit).not.toHaveBeenCalled();
  });

  it('a unique-constraint violation from a concurrent first write is mapped to 409', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
    db.$transaction.mockRejectedValueOnce(p2002);
    await expect(service.updateStore(ACTOR, validStore)).rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' });
  });

  it('a validation failure reports the field path and never touches the database', async () => {
    const error = await service.updateStore(ACTOR, { ...validStore, timezone: 'Mars/Olympus' }).catch(caught => caught);
    expect(error).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(error.fields).toEqual([expect.objectContaining({ field: 'timezone' })]);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('shipping validation', () => {
  it('requires every delivery method exactly once and at least one enabled', () => {
    const missing = { ...validShipping, methods: validShipping.methods.slice(0, 2) };
    const duplicate = { ...validShipping, methods: [validShipping.methods[0], validShipping.methods[0], validShipping.methods[2]] };
    const allOff = { ...validShipping, methods: validShipping.methods.map(method => ({ ...method, enabled: false })) };
    expect(shippingUpdateSchema.safeParse(missing).success).toBe(false);
    expect(shippingUpdateSchema.safeParse(duplicate).success).toBe(false);
    expect(shippingUpdateSchema.safeParse(allOff).success).toBe(false);
    // A threshold-only path would strand every sub-threshold cart; it does not replace this validation.
    expect(shippingUpdateSchema.safeParse({ ...allOff, freeShippingThreshold: '50.00' }).success).toBe(false);
  });

  it('normalises prices to two decimals and rejects over-precise or oversized prices', () => {
    const parsed = shippingUpdateSchema.parse(validShipping);
    expect(parsed.methods[1].price).toBe('9.90');
    expect(shippingUpdateSchema.safeParse({ ...validShipping, methods: [{ ...validShipping.methods[0], price: '1.001' }, ...validShipping.methods.slice(1)] }).success).toBe(false);
    expect(shippingUpdateSchema.safeParse({ ...validShipping, methods: [{ ...validShipping.methods[0], price: '10000' }, ...validShipping.methods.slice(1)] }).success).toBe(false);
  });

  it('allows no threshold, but a threshold must be greater than zero', () => {
    expect(shippingUpdateSchema.safeParse({ ...validShipping, freeShippingThreshold: null }).success).toBe(true);
    expect(shippingUpdateSchema.safeParse({ ...validShipping, freeShippingThreshold: '0' }).success).toBe(false);
    expect(shippingUpdateSchema.parse({ ...validShipping, freeShippingThreshold: '50' }).freeShippingThreshold).toBe('50.00');
  });

  it('the preview subtotal must be a plain amount', () => {
    expect(shippingPreviewSchema.safeParse({ subtotal: '49.99' }).success).toBe(true);
    expect(shippingPreviewSchema.safeParse({ subtotal: '-1' }).success).toBe(false);
  });
});

describe('updateShipping', () => {
  it('upserts every method, bumps the version, audits changed field names, and invalidates the cached snapshot after commit', async () => {
    await service.previewShipping('10.00');
    expect(db.shippingMethodSetting.findMany).toHaveBeenCalledTimes(1);

    await service.updateShipping(ACTOR, validShipping, 'req-2');

    expect(db.shippingMethodSetting.upsert).toHaveBeenCalledTimes(3);
    expect(audit.recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SHIPPING_SETTINGS_UPDATED',
      details: { version: 2, changedFields: ['methods.EXPRESS.price', 'methods.OVERNIGHT.enabled'] },
    }), db);
    expect(JSON.stringify(audit.recordAdminAudit.mock.calls[0][0])).not.toMatch(/9\.9|19\.99/);

    await service.previewShipping('10.00');
    expect(db.shippingMethodSetting.findMany).toHaveBeenCalledTimes(3);
  });

  it('a stale version is a 409 with the current view and no method row is written', async () => {
    db.shippingSettings.findUnique.mockResolvedValue({ version: 4, freeShippingThreshold: null });
    const error = await service.updateShipping(ACTOR, validShipping).catch(caught => caught);
    expect(error).toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT', current: { version: 4 } });
    expect(db.shippingMethodSetting.upsert).not.toHaveBeenCalled();
  });

  it('a lost race on the singleton version is a 409 and the cache is not invalidated by a rolled-back write', async () => {
    db.shippingSettings.updateMany.mockResolvedValue({ count: 0 });
    await service.previewShipping('10.00');
    await expect(service.updateShipping(ACTOR, validShipping)).rejects.toMatchObject({ statusCode: 409 });
    expect(audit.recordAdminAudit).not.toHaveBeenCalled();
    await service.previewShipping('10.00');
    expect(db.shippingMethodSetting.findMany).toHaveBeenCalledTimes(3);
  });
});

describe('getShipping', () => {
  it('retries if the settings version changes between the singleton and method-row reads', async () => {
    const updatedRows = [
      { method: 'STANDARD', enabled: true, price: new Prisma.Decimal('0.00') },
      { method: 'EXPRESS', enabled: false, price: new Prisma.Decimal('12.50') },
      { method: 'OVERNIGHT', enabled: true, price: new Prisma.Decimal('19.99') },
    ];
    db.shippingSettings.findUnique
      .mockResolvedValueOnce({ version: 1, freeShippingThreshold: null })
      .mockResolvedValueOnce({ version: 2, freeShippingThreshold: new Prisma.Decimal('100.00') })
      .mockResolvedValueOnce({ version: 2, freeShippingThreshold: new Prisma.Decimal('100.00') })
      .mockResolvedValueOnce({ version: 2, freeShippingThreshold: new Prisma.Decimal('100.00') });
    db.shippingMethodSetting.findMany.mockResolvedValueOnce(sharedShippingRows).mockResolvedValueOnce(updatedRows);

    const result = await service.getShipping();

    expect(result.version).toBe(2);
    expect(result.freeShippingThreshold).toBe('100.00');
    expect(result.methods.find(method => method.method === 'EXPRESS')).toMatchObject({ enabled: false, price: '12.50' });
    expect(db.shippingSettings.findUnique).toHaveBeenCalledTimes(4);
    expect(db.shippingMethodSetting.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('previewShipping', () => {
  it('returns the quote rows the checkout would produce for the subtotal, with the threshold applied to STANDARD only', async () => {
    db.shippingSettings.findUnique.mockResolvedValue({ version: 1, freeShippingThreshold: new Prisma.Decimal('50') });
    const preview = await service.previewShipping('50');
    expect(preview).toMatchObject({ subtotal: '50.00', currency: 'USD' });
    expect(preview.methods.find(quote => quote.id === 'STANDARD')?.price).toBe('0.00');
    expect(preview.methods.find(quote => quote.id === 'EXPRESS')?.price).toBe('9.99');
  });
});
