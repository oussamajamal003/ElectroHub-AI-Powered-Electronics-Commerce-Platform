import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cartRevision, deliveryMethods, savedPurchaseTerms } from '../checkout.domain.js';
import {
  SEED_SHIPPING_SNAPSHOT, SHIPPING_TTL_MS, buildShippingSnapshot, currentShippingSnapshot, effectiveShippingPrice,
  invalidateShippingConfig, loadShippingConfig, shippingQuoteFor, shippingQuotes, type ShippingConfigClient, type ShippingSnapshot,
} from '../shipping-config.js';

/** The Task 03.5 revision algorithm, copied verbatim as it stood before shipping settings existed. Must never be edited. */
function legacyCartRevision(cartId: string, items: { productId: string; quantity: number; product: { price: string } | null }[]) {
  return createHash('sha256').update(JSON.stringify(['03.5-v1', [['STANDARD', '0.00', 5, 7], ['EXPRESS', '9.99', 2, 3], ['OVERNIGHT', '19.99', 1, 1]], cartId,
    items.map(item => [item.productId, item.quantity, item.product?.price ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))])).digest('hex');
}

const fakeClient = (settings: { version: number; freeShippingThreshold: Prisma.Decimal | null } | null,
  rows: { method: string; enabled: boolean; price: Prisma.Decimal }[]) => {
  const findUnique = vi.fn(async () => settings);
  const findMany = vi.fn(async () => rows);
  const client = { shippingSettings: { findUnique }, shippingMethodSetting: { findMany } } as unknown as ShippingConfigClient;
  return { client, findUnique, findMany };
};
const withMethod = (snapshot: ShippingSnapshot, id: string, patch: Partial<ShippingSnapshot['methods'][number]>): ShippingSnapshot => ({
  ...snapshot, methods: snapshot.methods.map(method => method.id === id ? { ...method, ...patch } : method) });

const cartA = [
  { productId: 'b0000000-0000-4000-8000-000000000002', quantity: 2, product: { price: '19.99' } },
  { productId: 'a0000000-0000-4000-8000-000000000001', quantity: 1, product: { price: '49.97' } },
];
const cartB = [{ productId: 'c0000000-0000-4000-8000-000000000003', quantity: 1, product: null }];

describe('cartRevision compatibility with the Task 03.5 algorithm', () => {
  it('seed snapshot produces byte-identical hashes to the Task 03.5 algorithm for the same inputs', () => {
    for (const items of [cartA, cartB, []]) {
      const cartId = 'cart-1';
      expect(cartRevision(cartId, items, SEED_SHIPPING_SNAPSHOT)).toBe(legacyCartRevision(cartId, items));
      expect(cartRevision(cartId, items)).toBe(legacyCartRevision(cartId, items));
    }
  });

  it('seed snapshot matches the static catalog the revision used before', () => {
    expect(SEED_SHIPPING_SNAPSHOT.methods.map(method => [method.id, method.price, method.minDays, method.maxDays]))
      .toEqual(deliveryMethods.map(method => [method.id, method.price, method.minDays, method.maxDays]));
  });

  it('any non-seed configuration changes the revision: disabled method, threshold, or price', () => {
    const seed = cartRevision('cart-1', cartA, SEED_SHIPPING_SNAPSHOT);
    expect(cartRevision('cart-1', cartA, withMethod(SEED_SHIPPING_SNAPSHOT, 'EXPRESS', { enabled: false }))).not.toBe(seed);
    expect(cartRevision('cart-1', cartA, { ...SEED_SHIPPING_SNAPSHOT, freeShippingThreshold: '50.00' })).not.toBe(seed);
    expect(cartRevision('cart-1', cartA, withMethod(SEED_SHIPPING_SNAPSHOT, 'EXPRESS', { price: '8.99' }))).not.toBe(seed);
  });

  it('a snapshot whose only difference is the version keeps the revision (version is not a pricing term)', () => {
    expect(cartRevision('cart-1', cartA, { ...SEED_SHIPPING_SNAPSHOT, version: 7 })).toBe(legacyCartRevision('cart-1', cartA));
  });
});

describe('shipping snapshot', () => {
  beforeEach(() => invalidateShippingConfig());
  afterEach(() => { vi.useRealTimers(); invalidateShippingConfig(); });

  it('missing rows or a missing singleton build exactly the seed values', () => {
    expect(buildShippingSnapshot(null, [])).toEqual(SEED_SHIPPING_SNAPSHOT);
  });

  it('stored rows override enabled and price with 2dp strings and the threshold applies', () => {
    const snapshot = buildShippingSnapshot({ version: 4, freeShippingThreshold: new Prisma.Decimal('75') },
      [{ method: 'EXPRESS', enabled: false, price: new Prisma.Decimal('12.5') }]);
    expect(snapshot.version).toBe(4);
    expect(snapshot.freeShippingThreshold).toBe('75.00');
    expect(snapshot.methods.find(method => method.id === 'EXPRESS')).toMatchObject({ enabled: false, price: '12.50', label: 'Express Delivery' });
    expect(snapshot.methods.find(method => method.id === 'STANDARD')).toMatchObject({ enabled: true, price: '0.00' });
  });

  it('the synchronous accessor equals the seed until a load happens', () => {
    expect(currentShippingSnapshot()).toEqual(SEED_SHIPPING_SNAPSHOT);
  });

  it('loads once and serves the cache within TTL; invalidation forces a reload', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
    const { client, findUnique } = fakeClient({ version: 2, freeShippingThreshold: null }, []);
    // Each load reads the singleton before and after the method rows (consistency check), so two reads per load.
    await loadShippingConfig(client);
    await loadShippingConfig(client);
    expect(findUnique).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date(Date.now() + SHIPPING_TTL_MS + 1));
    await loadShippingConfig(client);
    expect(findUnique).toHaveBeenCalledTimes(4);
    invalidateShippingConfig();
    await loadShippingConfig(client);
    expect(findUnique).toHaveBeenCalledTimes(6);
  });

  it('shares one in-flight read between concurrent callers', async () => {
    const { client, findUnique } = fakeClient(null, []);
    await Promise.all([loadShippingConfig(client), loadShippingConfig(client), loadShippingConfig(client)]);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('retries a configuration that changed mid-read and fails closed when it never settles', async () => {
    const settled = vi.fn().mockResolvedValueOnce({ version: 1, freeShippingThreshold: null }).mockResolvedValueOnce({ version: 2, freeShippingThreshold: null })
      .mockResolvedValueOnce({ version: 2, freeShippingThreshold: null }).mockResolvedValueOnce({ version: 2, freeShippingThreshold: null });
    const retried = { shippingSettings: { findUnique: settled }, shippingMethodSetting: { findMany: vi.fn(async () => []) } } as unknown as ShippingConfigClient;
    await expect(loadShippingConfig(retried)).resolves.toMatchObject({ version: 2 });

    invalidateShippingConfig();
    const never = vi.fn();
    for (const version of [1, 2, 2, 3, 3, 4]) never.mockResolvedValueOnce({ version, freeShippingThreshold: null });
    const unstable = { shippingSettings: { findUnique: never }, shippingMethodSetting: { findMany: vi.fn(async () => []) } } as unknown as ShippingConfigClient;
    await expect(loadShippingConfig(unstable)).rejects.toMatchObject({ code: 'SHIPPING_CONFIG_UNSTABLE' });
  });

  it('propagates database errors instead of falling back to the seed', async () => {
    const client = { shippingSettings: { findUnique: vi.fn(async () => { throw new Error('db down'); }) },
      shippingMethodSetting: { findMany: vi.fn(async () => []) } } as unknown as ShippingConfigClient;
    await expect(loadShippingConfig(client)).rejects.toThrow('db down');
  });

  it('the loaded snapshot becomes the synchronous accessor value', async () => {
    const { client } = fakeClient({ version: 3, freeShippingThreshold: null }, [{ method: 'OVERNIGHT', enabled: false, price: new Prisma.Decimal('0') }]);
    await loadShippingConfig(client);
    expect(currentShippingSnapshot().methods.find(method => method.id === 'OVERNIGHT')).toMatchObject({ enabled: false, price: '0.00' });
  });
});

describe('quotes and effective prices', () => {
  const threshold: ShippingSnapshot = { ...SEED_SHIPPING_SNAPSHOT, freeShippingThreshold: '50.00',
    methods: SEED_SHIPPING_SNAPSHOT.methods.map(method => method.id === 'STANDARD' ? { ...method, price: '4.99' } : method) };

  it('STANDARD is free at and above the threshold and charged below it', () => {
    expect(effectiveShippingPrice(threshold.methods[0], '49.99', threshold)).toBe('4.99');
    expect(shippingQuoteFor('STANDARD', '49.99', threshold)?.price).toBe('4.99');
    expect(shippingQuoteFor('STANDARD', '50.00', threshold)?.price).toBe('0.00');
    expect(shippingQuoteFor('STANDARD', '120', threshold)?.price).toBe('0.00');
  });

  it('the threshold never changes other methods', () => {
    expect(shippingQuoteFor('EXPRESS', '500', threshold)?.price).toBe('9.99');
  });

  it('disabled methods are excluded from quotes and have no delivery terms', () => {
    const snapshot = withMethod(SEED_SHIPPING_SNAPSHOT, 'EXPRESS', { enabled: false });
    expect(shippingQuotes('10', snapshot).map(quote => quote.id)).toEqual(['STANDARD', 'OVERNIGHT']);
    expect(shippingQuoteFor('EXPRESS', '10', snapshot)).toBeNull();
    expect(shippingQuoteFor('UNKNOWN', '10', snapshot)).toBeNull();
  });

  it('saved purchase terms: a disabled method gives null delivery and null totals (existing error path)', () => {
    const snapshot = withMethod(SEED_SHIPPING_SNAPSHOT, 'EXPRESS', { enabled: false });
    const revision = cartRevision('cart-1', [{ productId: 'p', quantity: 1, product: { price: '19.99' } }], snapshot);
    const terms = savedPurchaseTerms({ scopeId: 'cart-1', expectedRevision: revision, deliveryMethod: 'EXPRESS',
      lines: [{ productId: 'p', quantity: 1, price: '19.99' }], shipping: snapshot });
    expect(terms).toEqual({ revisionMatches: true, delivery: null, totals: null });
  });

  it('a configuration change between quote and commit makes the old revision stale, never re-priced', () => {
    const lines = [{ productId: 'p', quantity: 2, price: '19.99' }];
    const quotedRevision = cartRevision('cart-1', [{ productId: 'p', quantity: 2, product: { price: '19.99' } }], SEED_SHIPPING_SNAPSHOT);
    const current = withMethod(SEED_SHIPPING_SNAPSHOT, 'EXPRESS', { price: '12.00' });
    const terms = savedPurchaseTerms({ scopeId: 'cart-1', expectedRevision: quotedRevision, deliveryMethod: 'EXPRESS', lines, shipping: current });
    expect(terms.revisionMatches).toBe(false);
    expect(terms.totals).toBeNull();
    // The same saved terms under the snapshot they were quoted on still price exactly as before.
    const original = savedPurchaseTerms({ scopeId: 'cart-1', expectedRevision: quotedRevision, deliveryMethod: 'EXPRESS', lines, shipping: SEED_SHIPPING_SNAPSHOT });
    expect(original.revisionMatches).toBe(true);
    expect(original.totals).toMatchObject({ subtotal: '39.98', shipping: '9.99', total: '49.97' });
  });

  it('threshold-based totals use the effective STANDARD price in savedPurchaseTerms', () => {
    const lines = [{ productId: 'p', quantity: 3, price: '19.00' }];
    const revision = cartRevision('cart-1', [{ productId: 'p', quantity: 3, product: { price: '19.00' } }], threshold);
    const terms = savedPurchaseTerms({ scopeId: 'cart-1', expectedRevision: revision, deliveryMethod: 'STANDARD', lines, shipping: threshold });
    expect(terms.totals).toMatchObject({ subtotal: '57.00', shipping: '0.00', total: '57.00' });
  });
});
