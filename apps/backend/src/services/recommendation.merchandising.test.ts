import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recommendationConfig, type PinRecord, type RecommendationConfigSnapshot } from './recommendation-config.js';
import { measuredPopularity } from './recommendation.sql.js';
import { RecommendationService } from './recommendation.service.js';

const db = vi.hoisted(() => ({
  product: { findFirst: vi.fn() },
  recommendationEvent: { createMany: vi.fn(), deleteMany: vi.fn() },
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, logSafely: vi.fn() }));
vi.mock('./recommendation.sql.js', () => ({ coPurchases: vi.fn(async () => []), measuredPopularity: vi.fn(), profileSignals: vi.fn() }));
vi.mock('./search.service.js', () => ({ SearchService: class {} }));
vi.mock('./product.service.js', () => ({ publicProductWhere: { status: 'ACTIVE', storefrontVisible: true } }));
vi.mock('./recommendation-config.js', async importOriginal => ({ ...(await importOriginal<typeof import('./recommendation-config.js')>()), recommendationConfig: vi.fn() }));

const ORGANIC = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const ORGANIC_2 = '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11';
const PINNED = '5a9ff5e6-9d4c-4dbe-9b8c-6f2b5d4e3a55';
const EXPIRED = '6bb0a6f7-ae5d-4ecf-8c9d-7a3c6e5f4b66';
const cat = { id: 'cat-laptops', name: 'Laptops', slug: 'laptops', isActive: true };

const summary = (id: string) => ({ id, name: `Product ${id.slice(0, 4)}`, slug: `product-${id.slice(0, 4)}`, category: cat, purchasable: true });

function catalog(ids: string[]) {
  const byId = new Map(ids.map(id => [id, summary(id)]));
  return {
    productSummariesByIds: vi.fn(async (requested: readonly string[]) => requested.map(id => byId.get(id)).filter((item): item is ReturnType<typeof summary> => item !== undefined)),
    products: vi.fn(async () => ({ data: [], meta: { total: 0, page: 1, pageSize: 4 } })),
  };
}

const snapshot = (overrides: Partial<RecommendationConfigSnapshot> = {}): RecommendationConfigSnapshot => ({ sections: new Map(), pins: [], ...overrides });
const pin = (productId: string, overrides: Partial<PinRecord> = {}): PinRecord => ({
  id: `pin-${productId}`, productId, surface: 'home', position: 0, startsAt: null, endsAt: null, enabled: true, version: 1, ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(measuredPopularity).mockResolvedValue({
    rows: [{ productId: ORGANIC, orders: 9 }, { productId: ORGANIC_2, orders: 7 }], contributingUsers: 5,
  } as never);
});

describe('merchandising in the recommendation engine', () => {
  it('reports a disabled home popular section as DISABLED with no items and without reading popularity', async () => {
    vi.mocked(recommendationConfig).mockResolvedValue(snapshot({
      sections: new Map([['home:POPULAR_PRODUCTS', { enabled: false, itemLimit: 12, version: 2, updatedAt: null }]]),
    }));
    const section = await new RecommendationService(() => null, catalog([ORGANIC]) as never).popular(4, 'home', { preview: true });
    expect(section).toMatchObject({ strategy: 'NO_DATA', fallbackReason: 'DISABLED', items: [] });
    expect(measuredPopularity).not.toHaveBeenCalled();
  });

  it('places an active pin first on home and flags it featured, while the organic item stays unflagged', async () => {
    vi.mocked(recommendationConfig).mockResolvedValue(snapshot({ pins: [pin(PINNED)] }));
    const section = await new RecommendationService(() => null, catalog([PINNED, ORGANIC, ORGANIC_2]) as never).popular(4, 'home', { preview: true });
    expect(section.strategy).toBe('MEASURED_POPULARITY');
    expect(section.items.map(item => item.product.id)).toEqual([PINNED, ORGANIC, ORGANIC_2]);
    expect(section.items[0]).toMatchObject({ rank: 1, featured: true });
    expect(section.items[1].featured).toBeUndefined();
    expect(section.items[2].featured).toBeUndefined();
  });

  it('never shows a pin whose window has ended, even though it is still enabled in the cache', async () => {
    vi.mocked(recommendationConfig).mockResolvedValue(snapshot({
      pins: [pin(EXPIRED, { endsAt: new Date(Date.now() - 60_000) })],
    }));
    const section = await new RecommendationService(() => null, catalog([EXPIRED, ORGANIC, ORGANIC_2]) as never).popular(4, 'home', { preview: true, pins: true });
    expect(section.items.map(item => item.product.id)).not.toContain(EXPIRED);
    expect(section.items.map(item => item.product.id)).toContain(ORGANIC);
  });
});
