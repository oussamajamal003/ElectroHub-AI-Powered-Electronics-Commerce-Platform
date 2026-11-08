import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Task 05.2 shipping configuration. The three delivery methods and their labels, day ranges and estimates are fixed catalog data
 * (Task 03.5). Only `enabled`, `price` and the STANDARD free-shipping threshold are administrator-configurable, and they are read
 * from `shipping_settings` / `shipping_method_settings`. Missing rows fall back to the seed values below, so an unconfigured
 * database prices exactly as Task 03.5 did.
 *
 * Consumers use one snapshot: `loadShippingConfig()` (async, TTL-cached) must run before a pure function reads
 * `currentShippingSnapshot()`. The cache is per process: an admin change is visible in the same process immediately
 * (`invalidateShippingConfig`) and in other processes within TTL_MS.
 */
export const SHIPPING_CATALOG = [
  { id: 'STANDARD', label: 'Standard Delivery', price: '0.00', minDays: 5, maxDays: 7, estimate: '5–7 business days' },
  { id: 'EXPRESS', label: 'Express Delivery', price: '9.99', minDays: 2, maxDays: 3, estimate: '2–3 business days' },
  { id: 'OVERNIGHT', label: 'Overnight Delivery', price: '19.99', minDays: 1, maxDays: 1, estimate: 'Next business day' },
] as const;

export type ShippingMethodId = (typeof SHIPPING_CATALOG)[number]['id'];

export interface ShippingMethodTerms {
  id: ShippingMethodId; label: string; price: string; minDays: number; maxDays: number; estimate: string; enabled: boolean;
}

/** `version` is the administrator-visible configuration version (0 = seed, never written). `freeShippingThreshold` is a 2dp string or null. */
export interface ShippingSnapshot {
  version: number;
  methods: ShippingMethodTerms[];
  freeShippingThreshold: string | null;
}

export interface ShippingQuote {
  id: ShippingMethodId; label: string; price: string; minDays: number; maxDays: number; estimate: string;
}

export const SHIPPING_TTL_MS = 15_000;
export const SHIPPING_PRICE_MAX = '9999.99';
export const SHIPPING_THRESHOLD_MAX = '9999999.99';

export const SEED_SHIPPING_SNAPSHOT: ShippingSnapshot = {
  version: 0,
  freeShippingThreshold: null,
  methods: SHIPPING_CATALOG.map(method => ({ ...method, enabled: true })),
};

/** Structural client surface, so a transaction client (or a test double) can be passed. */
export type ShippingConfigClient = Pick<PrismaClient, 'shippingSettings' | 'shippingMethodSetting'>;

let snapshot: ShippingSnapshot = SEED_SHIPPING_SNAPSHOT;
let loadedAt: number | null = null;
let generation = 0;
let inflight: Promise<ShippingSnapshot> | null = null;

/** Synchronous accessor for pure domain functions. Equals the seed until `loadShippingConfig` has run. */
export function currentShippingSnapshot(): ShippingSnapshot {
  return snapshot;
}

/** Drops the cache; the next `loadShippingConfig` reads the database. Call after every committed shipping change. */
export function invalidateShippingConfig(): void {
  generation += 1;
  loadedAt = null;
  inflight = null;
}

/** Builds a snapshot from stored rows. Missing rows (or a missing singleton) keep the seed values. */
export function buildShippingSnapshot(
  settings: { version: number; freeShippingThreshold: Prisma.Decimal | string | null } | null,
  rows: readonly { method: string; enabled: boolean; price: Prisma.Decimal | string }[],
): ShippingSnapshot {
  const methods = SEED_SHIPPING_SNAPSHOT.methods.map(seed => {
    const row = rows.find(candidate => candidate.method === seed.id);
    return row ? { ...seed, enabled: row.enabled, price: new Prisma.Decimal(row.price).toFixed(2) } : seed;
  });
  const threshold = settings?.freeShippingThreshold;
  return {
    version: settings?.version ?? 0,
    freeShippingThreshold: threshold === null || threshold === undefined ? null : new Prisma.Decimal(threshold).toFixed(2),
    methods,
  };
}

/**
 * Reads the singleton and the method rows without a transaction. Every administrator write bumps the singleton version in the same
 * transaction as the method rows, so a version that is unchanged across the reads proves they were one committed configuration.
 */
export async function readShippingSnapshot(client: ShippingConfigClient): Promise<ShippingSnapshot> {
  const settingsSelect = { version: true, freeShippingThreshold: true } as const;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const before = await client.shippingSettings.findUnique({ where: { id: 'default' }, select: settingsSelect });
    const rows = await client.shippingMethodSetting.findMany({ select: { method: true, enabled: true, price: true } });
    const after = await client.shippingSettings.findUnique({ where: { id: 'default' }, select: settingsSelect });
    if ((before?.version ?? 0) === (after?.version ?? 0)) return buildShippingSnapshot(after, rows);
  }
  throw new AppError('Shipping configuration is being updated. Try again.', 503, 'SHIPPING_CONFIG_UNSTABLE');
}

/** The default client is imported lazily so pure consumers (checkout.domain) load without database configuration. */
function readWith(client?: ShippingConfigClient): Promise<ShippingSnapshot> {
  return client ? readShippingSnapshot(client) : import('../lib/prisma.js').then(module => readShippingSnapshot(module.prisma));
}

/**
 * Loads the current snapshot (cached for SHIPPING_TTL_MS). Database errors propagate: a checkout must never price from
 * a guessed configuration. Concurrent callers share one read.
 */
export function loadShippingConfig(client?: ShippingConfigClient): Promise<ShippingSnapshot> {
  if (loadedAt !== null && Date.now() - loadedAt < SHIPPING_TTL_MS) return Promise.resolve(snapshot);
  if (inflight) return inflight;
  const startedAt = generation;
  const read: Promise<ShippingSnapshot> = readWith(client).then(async next => {
    // An invalidation during the read means this result may predate a committed change: read again and do not cache it.
    if (startedAt !== generation) return readWith(client);
    snapshot = next;
    loadedAt = Date.now();
    return next;
  });
  const pending: Promise<ShippingSnapshot> = read.finally(() => { if (inflight === pending) inflight = null; });
  inflight = pending;
  return pending;
}

/** True when the snapshot is exactly the Task 03.5 pricing (every method enabled at seed price, no threshold). */
export function isSeedShippingSnapshot(shipping: ShippingSnapshot): boolean {
  return shipping.freeShippingThreshold === null && shipping.methods.length === SEED_SHIPPING_SNAPSHOT.methods.length &&
    shipping.methods.every((method, index) => {
      const seed = SEED_SHIPPING_SNAPSHOT.methods[index];
      return method.id === seed.id && method.enabled && method.price === seed.price;
    });
}

/** STANDARD becomes free at or above the threshold; every other method keeps its configured price. */
function qualifiesForFreeShipping(method: ShippingMethodTerms, subtotal: Prisma.Decimal | string, shipping: ShippingSnapshot): boolean {
  return method.id === 'STANDARD' && shipping.freeShippingThreshold !== null &&
    new Prisma.Decimal(subtotal).gte(shipping.freeShippingThreshold);
}

export function effectiveShippingPrice(method: ShippingMethodTerms, subtotal: Prisma.Decimal | string, shipping: ShippingSnapshot): string {
  if (qualifiesForFreeShipping(method, subtotal, shipping)) return '0.00';
  return method.price;
}

/** Free STANDARD is independent of regular STANDARD availability. Other methods require their enabled flag. */
export function shippingQuoteFor(methodId: string, subtotal: Prisma.Decimal | string,
  shipping: ShippingSnapshot = currentShippingSnapshot()): ShippingQuote | null {
  const method = shipping.methods.find(candidate => candidate.id === methodId);
  if (!method || (!method.enabled && !qualifiesForFreeShipping(method, subtotal, shipping))) return null;
  return { id: method.id, label: method.label, price: effectiveShippingPrice(method, subtotal, shipping),
    minDays: method.minDays, maxDays: method.maxDays, estimate: method.estimate };
}

/** Quotes for every eligible method, in catalog order. */
export function shippingQuotes(subtotal: Prisma.Decimal | string, shipping: ShippingSnapshot = currentShippingSnapshot()): ShippingQuote[] {
  return shipping.methods.flatMap(method => {
    const quote = shippingQuoteFor(method.id, subtotal, shipping);
    return quote ? [quote] : [];
  });
}
