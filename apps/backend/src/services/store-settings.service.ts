import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { recordAdminAudit } from './admin-audit.js';
import { SHIPPING_CATALOG, SHIPPING_PRICE_MAX, buildShippingSnapshot, invalidateShippingConfig, loadShippingConfig, shippingQuotes,
  readShippingSnapshot, type ShippingMethodId, type ShippingSnapshot } from './shipping-config.js';

/**
 * Task 05.2 administrator settings: store profile and shipping configuration. Every write is a versioned compare-and-set
 * (`expectedVersion` against the stored version, under one conditional UPDATE), commits its audit row in the same transaction and
 * records field NAMES only. Currency is fixed to USD (the database CHECK and every price in the system) and cannot be changed here.
 * Historical orders keep their stored shipping cost; a shipping change affects only quotes and payments created afterwards.
 */
const TX = { maxWait: 10_000, timeout: 20_000 };
const STORE_ID = 'default';
const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

// ─── Store profile ───────────────────────────────────────────────────────────

const STORE_FIELDS = ['storeName', 'supportEmail', 'supportPhone', 'addressLine1', 'addressLine2', 'city', 'region', 'postalCode',
  'country', 'businessHours', 'timezone'] as const;
type StoreField = (typeof STORE_FIELDS)[number];
/** `businessHours` is optional on the wire: an older client that omits it leaves the stored value untouched. */
type StoreWrite = Partial<Record<StoreField, string | null>> & { storeName: string; timezone: string };

const storeSelect = { storeName: true, supportEmail: true, supportPhone: true, addressLine1: true, addressLine2: true, city: true,
  region: true, postalCode: true, country: true, businessHours: true, timezone: true, version: true, updatedAt: true } as const;
export type StoreRow = Omit<Prisma.StoreSettingsGetPayload<{ select: typeof storeSelect }>, 'updatedAt'> & { updatedAt: Date | null };

export interface StoreProfile {
  storeName: string; supportEmail: string | null; supportPhone: string | null; addressLine1: string | null; addressLine2: string | null;
  city: string | null; region: string | null; postalCode: string | null; country: string | null; businessHours: string | null; timezone: string; currency: 'USD';
  version: number; updatedAt: string | null;
}

/** Store profile before any administrator saves it (the migration seeds the same values). */
const DEFAULT_STORE: StoreRow = { storeName: 'ElectroHub', supportEmail: null, supportPhone: null, addressLine1: null, addressLine2: null,
  city: null, region: null, postalCode: null, country: null, businessHours: null, timezone: 'UTC', version: 0, updatedAt: null };

export const projectStore = (row: StoreRow): StoreProfile => ({
  storeName: row.storeName, supportEmail: row.supportEmail, supportPhone: row.supportPhone, addressLine1: row.addressLine1,
  addressLine2: row.addressLine2, city: row.city, region: row.region, postalCode: row.postalCode, country: row.country, businessHours: row.businessHours,
  timezone: row.timezone, currency: 'USD', version: row.version, updatedAt: row.updatedAt?.toISOString() ?? null,
});

const optionalText = (max: number, message: string) => z.union([z.literal(''), z.null(), z.string().trim().max(max, message)])
  .transform(value => (value === '' || value === null ? null : value));
const phoneSchema = z.union([z.literal(''), z.null(), z.string().trim().max(32, 'Phone is too long.')
  .regex(/^[+\d\s().-]+$/, 'Enter a phone number using digits, spaces and + ( ) . -.')
  .refine(value => { const digits = value.replace(/\D/g, '').length; return digits >= 7 && digits <= 15; }, 'Enter a phone number with 7 to 15 digits.')])
  .transform(value => (value === '' || value === null ? null : value));
const timeZones = new Set<string>([...Intl.supportedValuesOf('timeZone'), 'UTC']);

export const storeUpdateSchema = z.object({
  expectedVersion: z.number().int().min(0, 'Reload the settings and try again.'),
  storeName: z.string().trim().regex(/^[^\r\n]+$/, 'Use a single line for the store name.').min(2, 'Enter a store name of at least 2 characters.').max(120, 'Store name is too long.'),
  supportEmail: z.union([z.literal(''), z.null(), z.string().trim().email('Enter a valid support email address.').max(255, 'Email is too long.')])
    .transform(value => (value === '' || value === null ? null : value)),
  supportPhone: phoneSchema,
  addressLine1: optionalText(255, 'Address is too long.'),
  addressLine2: optionalText(255, 'Address is too long.'),
  city: optionalText(100, 'City is too long.'),
  region: optionalText(100, 'Region is too long.'),
  postalCode: optionalText(20, 'Postal code is too long.'),
  country: optionalText(100, 'Country is too long.'),
  businessHours: z.union([z.literal(''), z.null(), z.string().trim().max(255, 'Business hours are too long.')
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\u0000-\u001F\u007F]*$/, 'Use a single line for the business hours.')]).transform(value => (value === '' || value === null ? null : value)).optional(),
  timezone: z.string().trim().max(64).refine(value => timeZones.has(value), 'Choose a supported time zone.'),
  // Currency is read-only: an echo of USD is accepted, any other value is rejected.
  currency: z.string().optional().refine(value => value === undefined || value === 'USD', 'Currency is fixed to USD and cannot be changed.'),
}).strict();
export type StoreUpdateInput = z.infer<typeof storeUpdateSchema>;

// ─── Shipping ────────────────────────────────────────────────────────────────

const METHOD_IDS = SHIPPING_CATALOG.map(method => method.id) as [ShippingMethodId, ...ShippingMethodId[]];
const moneyPattern = /^\d{1,4}(\.\d{1,2})?$/;
const thresholdPattern = /^\d{1,7}(\.\d{1,2})?$/;
// Zod runs every refine even after the pattern has failed, so each numeric check is guarded by its pattern. Without the guard,
// Prisma.Decimal throws on a blank or malformed value and the request returns 500 instead of a 400 validation error.
const priceSchema = z.string().trim().regex(moneyPattern, 'Enter a price such as 9.99.')
  .refine(value => !moneyPattern.test(value) || new Prisma.Decimal(value).lte(SHIPPING_PRICE_MAX), `Price must be at most ${SHIPPING_PRICE_MAX}.`)
  .transform(value => new Prisma.Decimal(value).toFixed(2));
const thresholdSchema = z.union([z.null(), z.string().trim().regex(thresholdPattern, 'Enter an amount such as 50.00.')
  .refine(value => !thresholdPattern.test(value) || new Prisma.Decimal(value).gt(0), 'The free-shipping threshold must be greater than zero.')
  .refine(value => !thresholdPattern.test(value) || new Prisma.Decimal(value).lte('9999999.99'), 'The free-shipping threshold is too large.')
  .transform(value => new Prisma.Decimal(value).toFixed(2))]);

export const shippingUpdateSchema = z.object({
  expectedVersion: z.number().int().min(1, 'Reload the shipping settings and try again.'),
  freeShippingThreshold: thresholdSchema,
  methods: z.array(z.object({ method: z.enum(METHOD_IDS), enabled: z.boolean(), price: priceSchema }).strict())
    .length(SHIPPING_CATALOG.length, 'Send every delivery method once.')
    .refine(list => new Set(list.map(entry => entry.method)).size === SHIPPING_CATALOG.length, 'Each delivery method must appear once.')
    .refine(list => list.some(entry => entry.enabled), 'Enable at least one delivery method.'),
}).strict();
export type ShippingUpdateInput = z.infer<typeof shippingUpdateSchema>;

export const shippingPreviewSchema = z.object({
  subtotal: z.string().trim().regex(/^\d{1,7}(\.\d{1,2})?$/, 'Enter a subtotal such as 49.99.'),
}).strict();

/** Validation failure with the offending field paths only (the admin controller envelope shape). */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields = result.error.issues.slice(0, 20).map(issue => ({ field: issue.path.join('.') || null, message: issue.message }));
  throw Object.assign(new AppError('Check the highlighted fields and try again.', 400, 'VALIDATION_ERROR'), { fields });
}

export interface ShippingView {
  version: number; currency: 'USD'; freeShippingThreshold: string | null;
  methods: { method: ShippingMethodId; label: string; enabled: boolean; price: string; minDays: number; maxDays: number; estimate: string }[];
}
const viewOf = (snapshot: ShippingSnapshot): ShippingView => ({ version: snapshot.version, currency: 'USD',
  freeShippingThreshold: snapshot.freeShippingThreshold,
  methods: snapshot.methods.map(method => ({ method: method.id, label: method.label, enabled: method.enabled, price: method.price,
    minDays: method.minDays, maxDays: method.maxDays, estimate: method.estimate })) });

// ─── Service ─────────────────────────────────────────────────────────────────

const conflict = (message: string, current: unknown) =>
  Object.assign(new AppError(message, 409, 'VERSION_CONFLICT'), { current });

export class StoreSettingsService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async getStore(): Promise<StoreProfile> {
    const row = await this.db.storeSettings.findUnique({ where: { id: STORE_ID }, select: storeSelect });
    return projectStore(row ?? DEFAULT_STORE);
  }

  async updateStore(actorId: string, input: unknown, requestId?: string | null): Promise<StoreProfile> {
    const parsed = parseOrThrow(storeUpdateSchema, input);
    const { expectedVersion, currency: _ignored, ...fields } = parsed;
    const write = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as StoreWrite;
    try {
      const saved = await this.db.$transaction(async tx => {
        // Serialize this decision with ownership changes until the settings and audit commit.
        const owners = await tx.$queryRaw<{ userId: string }[]>`
          SELECT "userId" FROM admin_account_security WHERE "userId" = ${actorId}::uuid AND "isOwner" FOR SHARE`;
        if (!owners.length) throw new AppError('Only an Owner can update store information.', 403, 'CAPABILITY_REQUIRED');
        const current = await tx.storeSettings.findUnique({ where: { id: STORE_ID }, select: storeSelect });
        const currentVersion = current?.version ?? 0;
        if (currentVersion !== expectedVersion) throw conflict('These settings changed elsewhere. Reload to review the latest values.', projectStore(current ?? DEFAULT_STORE));
        let nextVersion: number;
        if (!current) {
          await tx.storeSettings.create({ data: { id: STORE_ID, ...write, version: 1, updatedById: actorId } });
          nextVersion = 1;
        } else {
          const result = await tx.storeSettings.updateMany({ where: { id: STORE_ID, version: expectedVersion },
            data: { ...write, version: { increment: 1 }, updatedById: actorId } });
          if (result.count !== 1) throw conflict('These settings changed elsewhere. Reload to review the latest values.', projectStore(await tx.storeSettings.findUniqueOrThrow({ where: { id: STORE_ID }, select: storeSelect })));
          nextVersion = expectedVersion + 1;
        }
        const changedFields = STORE_FIELDS.filter(name => name in write && (!current || (current[name] ?? null) !== write[name]));
        await recordAdminAudit({ actorId, action: 'STORE_SETTINGS_UPDATED', resourceType: 'STORE_SETTINGS', resourceId: STORE_ID,
          outcome: 'SUCCESS', details: { version: nextVersion, changedFields }, requestId }, tx);
        return projectStore(await tx.storeSettings.findUniqueOrThrow({ where: { id: STORE_ID }, select: storeSelect }));
      }, TX);
      return saved;
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('These settings changed elsewhere. Reload to review the latest values.', await this.getStore());
      throw error;
    }
  }

  async getShipping(): Promise<ShippingView> {
    return viewOf(await readShippingSnapshot(this.db));
  }

  async updateShipping(actorId: string, input: unknown, requestId?: string | null): Promise<ShippingView> {
    const parsed: ShippingUpdateInput = parseOrThrow(shippingUpdateSchema, input);
    const { expectedVersion, freeShippingThreshold, methods } = parsed;
    try {
      const view = await this.db.$transaction(async tx => {
        const [settings, rows] = await Promise.all([
          tx.shippingSettings.findUnique({ where: { id: STORE_ID }, select: { version: true, freeShippingThreshold: true } }),
          tx.shippingMethodSetting.findMany({ select: { method: true, enabled: true, price: true } }),
        ]);
        const before = buildShippingSnapshot(settings, rows);
        if (before.version !== expectedVersion) throw conflict('Shipping settings changed elsewhere. Reload to review the latest values.', viewOf(before));
        let nextVersion: number;
        if (!settings) {
          await tx.shippingSettings.create({ data: { id: STORE_ID, freeShippingThreshold, version: 1, updatedById: actorId } });
          nextVersion = 1;
        } else {
          const result = await tx.shippingSettings.updateMany({ where: { id: STORE_ID, version: expectedVersion },
            data: { freeShippingThreshold, version: { increment: 1 }, updatedById: actorId } });
          if (result.count !== 1) throw conflict('Shipping settings changed elsewhere. Reload to review the latest values.', await this.getShipping());
          nextVersion = expectedVersion + 1;
        }
        for (const entry of methods) {
          await tx.shippingMethodSetting.upsert({ where: { method: entry.method },
            create: { method: entry.method, enabled: entry.enabled, price: entry.price },
            update: { enabled: entry.enabled, price: entry.price } });
        }
        const after = buildShippingSnapshot({ version: nextVersion, freeShippingThreshold }, methods.map(entry => ({ method: entry.method, enabled: entry.enabled, price: entry.price })));
        // Names only: which method/field changed, never the prices themselves in the audit trail.
        const changedFields = [
          ...(before.freeShippingThreshold !== after.freeShippingThreshold ? ['freeShippingThreshold'] : []),
          ...after.methods.flatMap(method => {
            const previous = before.methods.find(candidate => candidate.id === method.id);
            return [...(previous?.enabled !== method.enabled ? [`methods.${method.id}.enabled`] : []),
              ...(previous?.price !== method.price ? [`methods.${method.id}.price`] : [])];
          }),
        ];
        await recordAdminAudit({ actorId, action: 'SHIPPING_SETTINGS_UPDATED', resourceType: 'SHIPPING_SETTINGS', resourceId: STORE_ID,
          outcome: 'SUCCESS', details: { version: nextVersion, changedFields }, requestId }, tx);
        return viewOf(after);
      }, TX);
      // Only after the commit: a rolled-back write must never leave a stale or future snapshot cached in this process.
      invalidateShippingConfig();
      return view;
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Shipping settings changed elsewhere. Reload to review the latest values.', await this.getShipping());
      throw error;
    }
  }

  /** The real quote rows the checkout would produce for this subtotal (enabled methods, effective prices). */
  async previewShipping(subtotal: string) {
    const shipping = await loadShippingConfig(this.db);
    return { subtotal: new Prisma.Decimal(subtotal).toFixed(2), currency: 'USD' as const, methods: shippingQuotes(subtotal, shipping) };
  }
}

export const storeSettings = new StoreSettingsService();
