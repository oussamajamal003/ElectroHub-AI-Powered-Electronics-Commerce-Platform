import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiServiceClient } from '../integrations/ai/ai.client.js';
import { AiServiceError } from '../integrations/ai/ai.client.js';
import type { AiRecommendationRequestInput } from '../integrations/ai/ai.schemas.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { coPurchases, measuredPopularity, profileSignals } from './recommendation.sql.js';
import { issueImpressionToken, verifyImpressionToken } from './recommendation-token.js';
import {
  diversifyByCategory, FBT_MIN_SUPPORT, interleaveRecentInterest, POPULARITY_RULES, PROFILE_RULES, profileWeights, recentInterest,
  RECENT_INTEREST_GRACE_MS, recentInterestSlots, RecommendationService,
} from './recommendation.service.js';

const db = vi.hoisted(() => ({
  product: { findFirst: vi.fn() },
  recommendationPreference: { findUnique: vi.fn(), upsert: vi.fn() },
  productInteraction: { deleteMany: vi.fn() },
  recentlyViewedProduct: { deleteMany: vi.fn(), findMany: vi.fn() },
  recommendationEvent: { createMany: vi.fn(), deleteMany: vi.fn() },
  cartItem: { create: vi.fn(), update: vi.fn(), upsert: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  cart: { create: vi.fn(), update: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
}));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, logSafely: vi.fn() }));
vi.mock('./recommendation.sql.js', () => ({ coPurchases: vi.fn(), measuredPopularity: vi.fn(), profileSignals: vi.fn() }));
// The service constructs a SearchService by default; every test injects a fake catalog instead.
vi.mock('./search.service.js', () => ({ SearchService: class {} }));
vi.mock('./product.service.js', () => ({ publicProductWhere: { status: 'ACTIVE', storefrontVisible: true } }));

type Catalog = ConstructorParameters<typeof RecommendationService>[1];
type ProductSummary = Parameters<typeof diversifyByCategory>[0][number];

const A = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const B = '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11';
const C = '2d6cc2b3-6a1f-4a8b-8e5f-3c9e2a1b0d22';
const D = '3e7dd3c4-7b2a-4b9c-9f6a-4d0f3b2c1e33';
const E = '4f8ee4d5-8c3b-4cad-8a7b-5e1a4c3d2f44';
const F = '5a9ff5e6-9d4c-4dbe-9b8c-6f2b5d4e3a55';
const G = '6bb0a6f7-ae5d-4ecf-8c9d-7a3c6e5f4b66';
const HIDDEN = '7cc1b708-bf6e-4fd0-9dae-8b4d7f607c77';
const USER = '9de3d92a-d180-41f2-8bd1-ad6f9a6d1e99';

const laptops = { id: 'cat-laptops', name: 'Laptops', slug: 'laptops' };
const monitors = { id: 'cat-monitors', name: 'Monitors', slug: 'monitors' };
const product = (productId: string, category = laptops) =>
  ({ id: productId, name: `Product ${productId.slice(0, 4)}`, slug: `product-${productId.slice(0, 4)}`, category, purchasable: true }) as unknown as ProductSummary;

const anchorRow = { id: A, category: { name: 'Laptops', slug: 'laptops' } };

/** Mirrors productSummariesByIds: request order kept, unknown or hidden ids silently dropped. */
function makeCatalog(products: ProductSummary[]) {
  const byId = new Map(products.map(item => [item.id, item]));
  return {
    productSummariesByIds: vi.fn(async (ids: readonly string[]) => ids.map(id => byId.get(id)).filter((item): item is ProductSummary => item !== undefined)),
    products: vi.fn(async (input: { category?: string }) => ({
      data: products.filter(item => !input.category || item.category.slug === input.category),
      meta: { total: products.length, page: 1, pageSize: 12 },
    })),
  };
}

function makeAi(handler: (request: AiRecommendationRequestInput) => unknown) {
  const recommend = vi.fn(async (request: AiRecommendationRequestInput) => handler(request));
  return { client: { recommend } as unknown as AiServiceClient, recommend };
}

const aiResult = (mode: string, productIds: string[], extra: Record<string, unknown> = {}) => ({
  mode,
  items: productIds.map((productId, index) => ({ productId, score: 1 - index * 0.1, rank: index + 1 })),
  modelVersion: 'clip-v1.0',
  embeddingVersion: 'emb_2026.10',
  strategy: 'EMBEDDING_SIMILARITY',
  algorithmVersion: 'emb-knn-v1',
  anchorIndexed: true,
  ...extra,
});

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

const ids = (items: { product: { id: string } }[]) => items.map(item => item.product.id);

beforeEach(() => {
  vi.clearAllMocks();
  db.product.findFirst.mockResolvedValue(anchorRow);
  db.recommendationPreference.findUnique.mockResolvedValue(null);
  db.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as unknown[]));
  db.$queryRaw.mockResolvedValue([]);
  db.$executeRaw.mockResolvedValue(0);
  vi.mocked(coPurchases).mockResolvedValue([]);
  vi.mocked(measuredPopularity).mockResolvedValue({ rows: [], contributingUsers: 0 });
  vi.mocked(profileSignals).mockResolvedValue([]);
});

describe('productSections', () => {
  it('logs privacy-safe timings for FBT and sequential AI/hydration stages', async () => {
    const catalog = makeCatalog([product(A), product(B), product(C)]);
    const { client } = makeAi(request => request.mode === 'SIMILAR_PRODUCTS'
      ? aiResult('SIMILAR_PRODUCTS', [B])
      : aiResult('YOU_MAY_ALSO_LIKE', [C]));
    await new RecommendationService(() => client, catalog as unknown as Catalog).productSections('anchor-laptop', 4, 'req-time');

    expect(logger.info).toHaveBeenCalledWith('RECOMMENDATIONS_RESOLVED', expect.objectContaining({
      requestId: 'req-time',
      timingsMs: {
        fbt: expect.any(Number),
        similarAi: expect.any(Number),
        similarHydration: expect.any(Number),
        similarFallback: null,
        ymalAi: expect.any(Number),
        ymalHydration: expect.any(Number),
      },
    }));
  });

  it('404s an unknown or hidden slug without calling AI or co-purchase SQL', async () => {
    db.product.findFirst.mockResolvedValueOnce(null);
    const { client, recommend } = makeAi(() => { throw new Error('unexpected'); });
    const service = new RecommendationService(() => client, makeCatalog([]) as unknown as Catalog);
    const error = await errorOf(service.productSections('hidden-item', 4));
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 404, code: 'PRODUCT_NOT_FOUND' });
    expect(db.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ slug: 'hidden-item', status: 'ACTIVE' }) }));
    expect(recommend).not.toHaveBeenCalled();
    expect(coPurchases).not.toHaveBeenCalled();
  });

  it('uses the embedding index for Similar Products, hydrated in AI order, and never includes the anchor', async () => {
    const catalog = makeCatalog([product(A), product(B), product(C)]);
    const { client } = makeAi(request => (request.mode === 'SIMILAR_PRODUCTS'
      ? aiResult('SIMILAR_PRODUCTS', [C, A, B])
      : aiResult('YOU_MAY_ALSO_LIKE', [])));
    const service = new RecommendationService(() => client, catalog as unknown as Catalog);
    const { sections } = await service.productSections('anchor-laptop', 4);
    const similar = sections[0];
    expect(similar).toMatchObject({
      mode: 'SIMILAR_PRODUCTS', strategy: 'EMBEDDING_SIMILARITY', isPersonalized: false, isFallback: false, fallbackReason: null,
      modelVersion: 'clip-v1.0', embeddingVersion: 'emb_2026.10', algorithmVersion: 'emb-knn-v1', context: null,
    });
    expect(similar.items.map(item => [item.rank, item.product.id])).toEqual([[1, C], [2, B]]);
    const token = verifyImpressionToken(similar.impressionToken ?? '');
    expect(token).toMatchObject({ mode: 'SIMILAR_PRODUCTS', strategy: 'EMBEDDING_SIMILARITY', productIds: [C, B] });
  });

  it('falls back to labelled same-category products when the AI service fails, and skips the YMAL call', async () => {
    const catalog = makeCatalog([product(A), product(B), product(C), product(D, monitors)]);
    const { client, recommend } = makeAi(() => { throw new AiServiceError('unavailable', { statusCode: 503 }); });
    const service = new RecommendationService(() => client, catalog as unknown as Catalog);
    const { sections } = await service.productSections('anchor-laptop', 4);
    const [similar, alsoLike, fbt] = sections;
    expect(similar).toMatchObject({
      mode: 'SIMILAR_PRODUCTS', strategy: 'FALLBACK_CATEGORY', isFallback: true, fallbackReason: 'AI_UNAVAILABLE',
      modelVersion: null, embeddingVersion: null, algorithmVersion: 'category-newest-v1',
      context: { categoryName: 'Laptops', categorySlug: 'laptops' },
    });
    expect(ids(similar.items)).toEqual([B, C]);
    expect(alsoLike).toMatchObject({ mode: 'YOU_MAY_ALSO_LIKE', strategy: 'NO_DATA', isFallback: true, fallbackReason: 'AI_UNAVAILABLE', items: [] });
    expect(fbt).toMatchObject({ strategy: 'NO_DATA', fallbackReason: 'INSUFFICIENT_SUPPORT' });
    expect(recommend).toHaveBeenCalledTimes(1);
  });

  it('labels a not-yet-indexed anchor as NOT_INDEXED', async () => {
    const catalog = makeCatalog([product(A), product(B)]);
    const { client, recommend } = makeAi(() => aiResult('SIMILAR_PRODUCTS', [B], { anchorIndexed: false }));
    const service = new RecommendationService(() => client, catalog as unknown as Catalog);
    const { sections } = await service.productSections('anchor-laptop', 4);
    expect(sections[0]).toMatchObject({ strategy: 'FALLBACK_CATEGORY', isFallback: true, fallbackReason: 'NOT_INDEXED' });
    expect(sections[1]).toMatchObject({ strategy: 'NO_DATA', fallbackReason: 'NOT_INDEXED' });
    expect(recommend).toHaveBeenCalledTimes(1);
  });

  it('shows Frequently Bought Together with the CO_PURCHASE strategy only when real co-purchases exist', async () => {
    vi.mocked(coPurchases).mockResolvedValue([{ productId: D, support: 3, confidence: 0.6, lift: 2 }]);
    const catalog = makeCatalog([product(A), product(B), product(D)]);
    const { client } = makeAi(() => aiResult('SIMILAR_PRODUCTS', [B]));
    const service = new RecommendationService(() => client, catalog as unknown as Catalog);
    const { sections } = await service.productSections('anchor-laptop', 4);
    expect(coPurchases).toHaveBeenCalledWith([A], FBT_MIN_SUPPORT, 8);
    expect(sections[2]).toMatchObject({
      mode: 'FREQUENTLY_BOUGHT_TOGETHER', strategy: 'CO_PURCHASE', isFallback: false, algorithmVersion: 'co-purchase-v1',
    });
    expect(ids(sections[2].items)).toEqual([D]);
  });

  it('reports FBT as NO_DATA with INSUFFICIENT_SUPPORT and no token when there are no co-purchases', async () => {
    const catalog = makeCatalog([product(A)]);
    const { client } = makeAi(() => aiResult('SIMILAR_PRODUCTS', []));
    const service = new RecommendationService(() => client, catalog as unknown as Catalog);
    const { sections } = await service.productSections('anchor-laptop', 4);
    expect(sections[2]).toMatchObject({ strategy: 'NO_DATA', isFallback: true, fallbackReason: 'INSUFFICIENT_SUPPORT', impressionToken: null, items: [] });
  });

  it('omits out-of-stock FBT candidates using the database-derived purchasable projection', async () => {
    vi.mocked(coPurchases).mockResolvedValue([{ productId: D, support: 3, confidence: 0.6, lift: 2 }]);
    const unavailable = { ...product(D), purchasable: false } as ProductSummary;
    const catalog = makeCatalog([product(A), unavailable]);
    const { client } = makeAi(() => aiResult('SIMILAR_PRODUCTS', []));
    const { sections } = await new RecommendationService(() => client, catalog as unknown as Catalog).productSections('anchor-laptop', 4);
    expect(sections[2]).toMatchObject({ strategy: 'NO_DATA', fallbackReason: 'INSUFFICIENT_SUPPORT', items: [] });
  });

  it('never shows one product in two sections, and passes already-shown ids as exclusions', async () => {
    vi.mocked(coPurchases).mockResolvedValue([{ productId: D, support: 2, confidence: 0.5, lift: 1 }, { productId: E, support: 2, confidence: 0.5, lift: 1 }]);
    const catalog = makeCatalog([product(A), product(B), product(C), product(D), product(E), product(F, monitors), product(G, monitors)]);
    const { client, recommend } = makeAi(request => (request.mode === 'SIMILAR_PRODUCTS'
      ? aiResult('SIMILAR_PRODUCTS', [D, B, C])
      : aiResult('YOU_MAY_ALSO_LIKE', [B, F, G, C])));
    const service = new RecommendationService(() => client, catalog as unknown as Catalog);
    const { sections } = await service.productSections('anchor-laptop', 4);
    const [similar, alsoLike, fbt] = sections;
    expect(ids(fbt.items)).toEqual([D, E]);
    expect(ids(similar.items)).toEqual([B, C]);
    expect(ids(alsoLike.items)).toEqual([F, G]);
    const shownIds = [...ids(similar.items), ...ids(alsoLike.items), ...ids(fbt.items)];
    expect(new Set(shownIds).size).toBe(shownIds.length);
    expect(shownIds).not.toContain(A);
    expect(alsoLike.strategy).toBe('HYBRID_EMBEDDING');
    expect(alsoLike.algorithmVersion).toBe('emb-knn-v1.context-v1');
    expect(recommend.mock.calls[0][0]).toMatchObject({ mode: 'SIMILAR_PRODUCTS', productId: A, excludeProductIds: [D, E] });
    expect(recommend.mock.calls[1][0].excludeProductIds).toEqual(expect.arrayContaining([B, C, D, E]));
    expect(recommend.mock.calls[1][0].excludeProductIds).not.toContain(A);
  });

  it('drops a product the catalog does not return (hidden or retired) and renumbers the rank', async () => {
    const catalog = makeCatalog([product(A), product(B), product(C)]);
    const { client } = makeAi(request => (request.mode === 'SIMILAR_PRODUCTS'
      ? aiResult('SIMILAR_PRODUCTS', [B, HIDDEN, C])
      : aiResult('YOU_MAY_ALSO_LIKE', [])));
    const service = new RecommendationService(() => client, catalog as unknown as Catalog);
    const { sections } = await service.productSections('anchor-laptop', 4);
    expect(sections[0].items.map(item => [item.rank, item.product.id])).toEqual([[1, B], [2, C]]);
    expect(JSON.stringify(sections)).not.toContain(HIDDEN);
  });
});

describe('diversifyByCategory', () => {
  const item = (n: number, slug = 'laptops') =>
    ({ id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`, category: { name: slug, slug } }) as unknown as ProductSummary;
  const L = (n: number) => item(n, 'laptops');
  const M = (n: number) => item(n, 'monitors');
  const idsOf = (products: ProductSummary[]) => products.map(product => product.id);

  it('caps same-category items at ceil(limit / 2) and keeps AI order', () => {
    const products = [L(1), L(2), L(3), M(4), L(5), M(6)];
    expect(idsOf(diversifyByCategory(products, 'laptops', 4))).toEqual(idsOf([L(1), L(2), M(4), M(6)]));
  });

  it('fills from deferred same-category items in AI order when the rail would be short', () => {
    expect(idsOf(diversifyByCategory([L(1), L(2), L(3), L(4)], 'laptops', 4))).toEqual(idsOf([L(1), L(2), L(3), L(4)]));
    expect(idsOf(diversifyByCategory([L(1), L(2), L(3)], 'laptops', 3))).toEqual(idsOf([L(1), L(2), L(3)]));
  });

  it('uses ceil for odd limits and never returns more than the limit', () => {
    expect(idsOf(diversifyByCategory([L(1), L(2), L(3), M(4)], 'laptops', 3))).toEqual(idsOf([L(1), L(2), M(4)]));
    expect(diversifyByCategory([M(1), M(2), M(3), M(4), M(5)], 'laptops', 2)).toHaveLength(2);
  });
});

describe('profileWeights', () => {
  it('applies the evidence threshold to undecayed weight, so three fresh views qualify', () => {
    const fresh = [A, B, C].map(productId => ({ productId, score: 0.99999, evidence: 1 }));
    expect(profileWeights(fresh)).toHaveLength(3);
    expect(profileWeights(fresh.map(row => ({ ...row, evidence: 0.9 })))).toBeNull();
  });

  it('returns null below the evidence thresholds (one product, or total weight under 3)', () => {
    expect(profileWeights([{ productId: A, score: 10 }])).toBeNull();
    expect(profileWeights([{ productId: A, score: 1 }, { productId: B, score: 1 }])).toBeNull();
    expect(profileWeights([{ productId: A, score: 0 }, { productId: B, score: Number.NaN }, { productId: C, score: 5 }])).toBeNull();
  });

  it('accepts exactly the minimum evidence', () => {
    expect(profileWeights([{ productId: A, score: 1.5 }, { productId: B, score: 1.5 }])).not.toBeNull();
  });

  it('normalizes so the strongest signal is exactly 1 and the rest are proportional', () => {
    expect(profileWeights([{ productId: A, score: 4 }, { productId: B, score: 2 }, { productId: C, score: 1 }])).toEqual([
      { productId: A, weight: 1 }, { productId: B, weight: 0.5 }, { productId: C, weight: 0.25 },
    ]);
  });

  it('clamps tiny weights to 0.01 and caps the vector at the maximum signal count', () => {
    const tiny = profileWeights([{ productId: A, score: 10 }, { productId: B, score: 0.00001 }]);
    expect(tiny?.[1].weight).toBe(0.01);
    const many = Array.from({ length: 60 }, (_, index) => ({ productId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`, score: 60 - index }));
    const capped = profileWeights(many);
    expect(capped).toHaveLength(PROFILE_RULES.maxSignals);
    expect(capped?.every(weight => weight.weight > 0 && weight.weight <= 1)).toBe(true);
    expect(capped?.[0].weight).toBe(1);
  });
});

describe('popular', () => {
  it('falls back to new arrivals with NO_MEASURED_DEMAND below three contributing customers', async () => {
    vi.mocked(measuredPopularity).mockResolvedValue({ rows: [{ productId: B, score: 3, users: 2 }], contributingUsers: 2 });
    const catalog = makeCatalog([product(B), product(C)]);
    const section = await new RecommendationService(() => null, catalog as unknown as Catalog).popular(2);
    expect(measuredPopularity).toHaveBeenCalledWith(POPULARITY_RULES.windowDays, POPULARITY_RULES.minUsersPerProduct, 4);
    expect(section).toMatchObject({
      mode: 'POPULAR_PRODUCTS', surface: 'home', strategy: 'FALLBACK_NEW_ARRIVALS', isFallback: true,
      fallbackReason: 'NO_MEASURED_DEMAND', algorithmVersion: 'new-arrivals-v1',
    });
    expect(ids(section.items)).toEqual([B, C]);
  });

  it('shows measured popularity in ranked order once enough customers contribute', async () => {
    vi.mocked(measuredPopularity).mockResolvedValue({
      rows: [{ productId: C, score: 5, users: 4 }, { productId: B, score: 3, users: 2 }], contributingUsers: 3,
    });
    const catalog = makeCatalog([product(B), product(C)]);
    const section = await new RecommendationService(() => null, catalog as unknown as Catalog).popular(2);
    expect(section).toMatchObject({
      mode: 'POPULAR_PRODUCTS', strategy: 'MEASURED_POPULARITY', isFallback: false, fallbackReason: null, algorithmVersion: 'popularity-v1',
    });
    expect(ids(section.items)).toEqual([C, B]);
  });
});

describe('forUser', () => {
  const profileRow = (productId: string, score: number, lastAt = new Date('2026-10-20T00:00:00.000Z'), recent = 0) => ({ productId, score, evidence: score, recent, lastAt });

  it('serves a labelled new-arrivals fallback when personalization is off, without reading history or calling AI', async () => {
    db.recommendationPreference.findUnique.mockResolvedValue({ personalizationEnabled: false, updatedAt: new Date() });
    const catalog = makeCatalog([product(C)]);
    const { client, recommend } = makeAi(() => aiResult('RECOMMENDED_FOR_YOU', [C]));
    const section = await new RecommendationService(() => client, catalog as unknown as Catalog).forUser(USER, 2);
    expect(section).toMatchObject({
      mode: 'RECOMMENDED_FOR_YOU', isPersonalized: false, isFallback: true, fallbackReason: 'PERSONALIZATION_OFF',
      strategy: 'FALLBACK_NEW_ARRIVALS', profile: null,
    });
    expect(profileSignals).not.toHaveBeenCalled();
    expect(recommend).not.toHaveBeenCalled();
  });

  it('uses the FALLBACK_POPULAR strategy when measured popularity is available', async () => {
    db.recommendationPreference.findUnique.mockResolvedValue({ personalizationEnabled: false, updatedAt: new Date() });
    vi.mocked(measuredPopularity).mockResolvedValue({ rows: [{ productId: C, score: 5, users: 4 }, { productId: B, score: 3, users: 3 }], contributingUsers: 5 });
    const catalog = makeCatalog([product(B), product(C)]);
    const section = await new RecommendationService(() => null, catalog as unknown as Catalog).forUser(USER, 2);
    expect(section).toMatchObject({ strategy: 'FALLBACK_POPULAR', fallbackReason: 'PERSONALIZATION_OFF', isPersonalized: false });
    expect(section.impressionToken).not.toBeNull();
  });

  it('reports INSUFFICIENT_HISTORY and skips AI when the profile is below threshold', async () => {
    db.recommendationPreference.findUnique.mockResolvedValue({ personalizationEnabled: true, updatedAt: new Date() });
    vi.mocked(profileSignals).mockResolvedValue([profileRow(A, 0.5)]);
    const { client, recommend } = makeAi(() => aiResult('RECOMMENDED_FOR_YOU', [C]));
    const section = await new RecommendationService(() => client, makeCatalog([product(C)]) as unknown as Catalog).forUser(USER, 2);
    expect(section).toMatchObject({ isPersonalized: false, isFallback: true, fallbackReason: 'INSUFFICIENT_HISTORY', profile: null });
    expect(recommend).not.toHaveBeenCalled();
  });

  it('asks AI for a profile ranking with product ids and weights only, never the user id', async () => {
    db.recommendationPreference.findUnique.mockResolvedValue({ personalizationEnabled: true, updatedAt: new Date() });
    const lastAt = new Date('2026-10-20T00:00:00.000Z');
    vi.mocked(profileSignals).mockResolvedValue([profileRow(A, 4, lastAt), profileRow(B, 2, new Date('2026-10-10T00:00:00.000Z'))]);
    const catalog = makeCatalog([product(C), product(D), product(E)]);
    const { client, recommend } = makeAi(() => aiResult('RECOMMENDED_FOR_YOU', [C, D, E], { strategy: 'BEHAVIOR_EMBEDDING' }));
    const section = await new RecommendationService(() => client, catalog as unknown as Catalog).forUser(USER, 2);

    expect(profileSignals).toHaveBeenCalledWith(USER, PROFILE_RULES.windowDays, PROFILE_RULES.maxSignals);
    const [request] = recommend.mock.calls[0];
    expect(request).toMatchObject({
      mode: 'RECOMMENDED_FOR_YOU', limit: 4,
      context: { profileSignals: [{ productId: A, weight: 1 }, { productId: B, weight: 0.5 }], featureSpecVersion: 'profile-v1' },
    });
    expect(JSON.stringify(request)).not.toContain(USER);

    expect(section).toMatchObject({
      mode: 'RECOMMENDED_FOR_YOU', strategy: 'BEHAVIOR_EMBEDDING', isPersonalized: true, isFallback: false, fallbackReason: null,
    });
    expect(ids(section.items)).toEqual([C, D]);
    expect(section.profile).toEqual({ featureSpecVersion: 'profile-v1', signalCount: 2, watermark: lastAt.toISOString() });
  });

  it('gives recent browsing its own ranking and bounded slots while long-term interests keep the first position', async () => {
    db.recommendationPreference.findUnique.mockResolvedValue({ personalizationEnabled: true, updatedAt: new Date() });
    // Purchase-heavy A and B dominate the decayed score; C and D are being browsed now.
    vi.mocked(profileSignals).mockResolvedValue([profileRow(A, 40), profileRow(B, 30), profileRow(C, 1, undefined, 1), profileRow(D, 1, undefined, 0.5)]);
    const recentPicks = ['b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002'];
    const catalog = makeCatalog([E, F, G, ...recentPicks].map(id => product(id)));
    const { client, recommend } = makeAi(request => (request.context?.profileSignals?.length === 2 && request.context.profileSignals[0].productId === C
      ? aiResult('RECOMMENDED_FOR_YOU', recentPicks, { strategy: 'BEHAVIOR_EMBEDDING' })
      : aiResult('RECOMMENDED_FOR_YOU', [E, F, G], { strategy: 'BEHAVIOR_EMBEDDING' })));
    const section = await new RecommendationService(() => client, catalog as unknown as Catalog).forUser(USER, 4);

    expect(recommend).toHaveBeenCalledTimes(2);
    const recentRequest = recommend.mock.calls.map(([request]) => request).find(request => request.excludeProductIds?.length);
    expect(recentRequest).toMatchObject({ context: { profileSignals: [{ productId: C, weight: 1 }, { productId: D, weight: 0.5 }] } });
    expect(new Set(recentRequest?.excludeProductIds)).toEqual(new Set([A, B, C, D]));
    expect(JSON.stringify(recommend.mock.calls)).not.toContain(USER);
    // Two recent products earn one slot, at position 2.
    expect(ids(section.items)).toEqual([E, recentPicks[0], F, G]);
    expect(section).toMatchObject({ strategy: 'BEHAVIOR_EMBEDDING', isPersonalized: true });
  });

  it('keeps the long-term ranking when the recent ranking fails, and asks once when there is no recent interest', async () => {
    db.recommendationPreference.findUnique.mockResolvedValue({ personalizationEnabled: true, updatedAt: new Date() });
    vi.mocked(profileSignals).mockResolvedValue([profileRow(A, 40), profileRow(B, 30), profileRow(C, 1, undefined, 1), profileRow(D, 1, undefined, 1)]);
    const catalog = makeCatalog([product(E), product(F)]);
    const failing = makeAi(request => {
      if (request.excludeProductIds?.length) throw new AiServiceError('unavailable', { statusCode: 503 });
      return aiResult('RECOMMENDED_FOR_YOU', [E, F], { strategy: 'BEHAVIOR_EMBEDDING' });
    });
    const section = await new RecommendationService(() => failing.client, catalog as unknown as Catalog).forUser(USER, 4);
    expect(ids(section.items)).toEqual([E, F]);
    expect(section).toMatchObject({ isPersonalized: true, isFallback: false });

    // One accidental view: no recent ranking at all.
    vi.mocked(profileSignals).mockResolvedValue([profileRow(A, 40), profileRow(B, 30), profileRow(C, 1, undefined, 1)]);
    const single = makeAi(() => aiResult('RECOMMENDED_FOR_YOU', [E, F], { strategy: 'BEHAVIOR_EMBEDDING' }));
    await new RecommendationService(() => single.client, catalog as unknown as Catalog).forUser(USER, 4);
    expect(single.recommend).toHaveBeenCalledTimes(1);
  });

  it('never lets a hung recent ranking delay the long-term rail beyond the grace period', async () => {
    vi.useFakeTimers();
    try {
      db.recommendationPreference.findUnique.mockResolvedValue({ personalizationEnabled: true, updatedAt: new Date() });
      vi.mocked(profileSignals).mockResolvedValue([profileRow(A, 40), profileRow(B, 30), profileRow(C, 1, undefined, 1), profileRow(D, 1, undefined, 1)]);
      const { client } = makeAi(request => (request.excludeProductIds?.length
        ? new Promise(() => {}) : aiResult('RECOMMENDED_FOR_YOU', [E, F], { strategy: 'BEHAVIOR_EMBEDDING' })));
      const pending = new RecommendationService(() => client, makeCatalog([product(E), product(F)]) as unknown as Catalog).forUser(USER, 4);
      await vi.advanceTimersByTimeAsync(RECENT_INTEREST_GRACE_MS);
      const section = await pending;
      expect(ids(section.items)).toEqual([E, F]);
      expect(section).toMatchObject({ isPersonalized: true, isFallback: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([2, 6])('keeps limit %i, unique ids, complete ranks and eligibility with recent slots', async limit => {
    db.recommendationPreference.findUnique.mockResolvedValue({ personalizationEnabled: true, updatedAt: new Date() });
    vi.mocked(profileSignals).mockResolvedValue([profileRow(A, 40), profileRow(B, 30),
      ...[C, D, E, F].map(id => profileRow(id, 1, undefined, 1))]);
    const longIds = ['c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000003',
      'c1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000006'];
    const outOfStock = 'd1000000-0000-4000-8000-000000000001';
    const recentIds = [outOfStock, longIds[1], 'd1000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000003'];
    const catalog = makeCatalog([...longIds, ...recentIds.slice(2)].map(id => product(id)).concat({ ...product(outOfStock), purchasable: false } as ProductSummary));
    const { client } = makeAi(request => aiResult('RECOMMENDED_FOR_YOU', request.excludeProductIds?.length ? recentIds : longIds, { strategy: 'BEHAVIOR_EMBEDDING' }));
    const section = await new RecommendationService(() => client, catalog as unknown as Catalog).forUser(USER, limit);
    const shown = ids(section.items);
    expect(shown).toHaveLength(limit);
    expect(new Set(shown).size).toBe(limit);
    expect(section.items.map(item => item.rank)).toEqual(Array.from({ length: limit }, (_, index) => index + 1));
    expect(shown).not.toContain(outOfStock);
    expect(shown[0]).toBe(longIds[0]);
    // Four recent products earn two slots; a recent pick that is also a long-term pick appears once, in its recent slot.
    expect(shown.slice(0, 4)).toEqual(limit === 2 ? [longIds[0], longIds[1]] : [longIds[0], longIds[1], longIds[2], recentIds[2]]);
  });

  it('falls back with NOT_INDEXED when the AI index is not ready for the profile', async () => {
    db.recommendationPreference.findUnique.mockResolvedValue({ personalizationEnabled: true, updatedAt: new Date() });
    vi.mocked(profileSignals).mockResolvedValue([profileRow(A, 4), profileRow(B, 2)]);
    const { client } = makeAi(() => aiResult('RECOMMENDED_FOR_YOU', [C], { anchorIndexed: false }));
    const section = await new RecommendationService(() => client, makeCatalog([product(C)]) as unknown as Catalog).forUser(USER, 2);
    expect(section).toMatchObject({ isPersonalized: false, fallbackReason: 'NOT_INDEXED', profile: null });
  });
});

describe('two-horizon profile', () => {
  it('earns no slot for one recent product, one for two or three, and never more than two', () => {
    expect([0, 1, 2, 3, 4, 9].map(recentInterestSlots)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('builds recent weights only for distinct recent interest beside a long-term profile', () => {
    expect(recentInterest([{ productId: A, score: 9 }, { productId: B, score: 1, recent: 1 }])).toBeNull();
    // A new customer whose whole profile is recent: the long-term ranking already is the recent one.
    expect(recentInterest([{ productId: A, score: 1, recent: 1 }, { productId: B, score: 1, recent: 1 }])).toBeNull();
    expect(recentInterest([{ productId: A, score: 9 }, { productId: C, score: 1, recent: 0.25 }, { productId: B, score: 1, recent: 1 }]))
      .toEqual({ slots: 1, weights: [{ productId: B, weight: 1 }, { productId: C, weight: 0.25 }] });
  });

  it('interleaves deterministically at positions 2 and 4 without duplicates', () => {
    expect(interleaveRecentInterest([A, B, C, D], [E, F, G], 2)).toEqual([A, E, B, F, C, D]);
    expect(interleaveRecentInterest([A, B, C], [B, E], 1)).toEqual([A, B, C]);
    expect(interleaveRecentInterest([A], [E, F], 2)).toEqual([A, E, F]);
    expect(interleaveRecentInterest([A, B], [E], 0)).toEqual([A, B]);
  });
});

describe('forCart', () => {
  it('returns co-purchases for the cart without the cart items, and never writes to the cart', async () => {
    vi.mocked(coPurchases).mockResolvedValue([{ productId: C, support: 2, confidence: 0.5, lift: 1 }, { productId: B, support: 2, confidence: 0.5, lift: 1 }, { productId: D, support: 2, confidence: 0.5, lift: 1 }]);
    const outOfStockCartItem = { ...product(B), purchasable: false } as ProductSummary;
    const catalog = makeCatalog([product(A), outOfStockCartItem, product(C), product(D)]);
    const { client, recommend } = makeAi(() => { throw new Error('AI must not be used for carts'); });
    const section = await new RecommendationService(() => client, catalog as unknown as Catalog).forCart([A, B], 4);
    expect(coPurchases).toHaveBeenCalledWith([A, B], FBT_MIN_SUPPORT, 8);
    expect(section).toMatchObject({ mode: 'FREQUENTLY_BOUGHT_TOGETHER', surface: 'cart', strategy: 'CO_PURCHASE', isFallback: false });
    expect(ids(section.items)).toEqual([C, D]);
    expect(recommend).not.toHaveBeenCalled();
    for (const writer of [db.cartItem.create, db.cartItem.update, db.cartItem.upsert, db.cartItem.delete, db.cartItem.deleteMany,
      db.cart.create, db.cart.update, db.cart.upsert, db.cart.delete, db.$transaction, db.$executeRaw]) {
      expect(writer).not.toHaveBeenCalled();
    }
  });

  it('returns NO_DATA without querying co-purchases when no cart product is publicly visible', async () => {
    const catalog = makeCatalog([product(A)]);
    const section = await new RecommendationService(() => null, catalog as unknown as Catalog).forCart([HIDDEN], 4);
    expect(section).toMatchObject({ strategy: 'NO_DATA', fallbackReason: 'INSUFFICIENT_SUPPORT', items: [] });
    expect(coPurchases).not.toHaveBeenCalled();
  });

  it('excludes every submitted cart id even when catalog hydration omits that anchor', async () => {
    vi.mocked(coPurchases).mockResolvedValue([
      { productId: HIDDEN, support: 2, confidence: 0.5, lift: 1 },
      { productId: C, support: 2, confidence: 0.5, lift: 1 },
    ]);
    const catalog = {
      productSummariesByIds: vi.fn()
        .mockResolvedValueOnce([product(A)])
        // Simulates a catalog visibility change between anchor and candidate hydration.
        .mockResolvedValueOnce([product(HIDDEN), product(C)]),
    };
    const section = await new RecommendationService(() => null, catalog as unknown as Catalog).forCart([A, HIDDEN], 4);
    expect(coPurchases).toHaveBeenCalledWith([A], FBT_MIN_SUPPORT, 8);
    expect(ids(section.items)).toEqual([C]);
  });
});

describe('recordEvents', () => {
  const token = issueImpressionToken({ mode: 'SIMILAR_PRODUCTS', strategy: 'EMBEDDING_SIMILARITY', surface: 'product_detail', productIds: [B, C] });
  const service = () => new RecommendationService(() => null, makeCatalog([]) as unknown as Catalog);

  it('rejects an invalid or expired token', async () => {
    const error = await errorOf(service().recordEvents('x'.repeat(20), [{ productId: B, type: 'IMPRESSION' }]));
    expect(error).toMatchObject({ statusCode: 400, code: 'INVALID_RECOMMENDATION_TOKEN' });
    expect(db.recommendationEvent.createMany).not.toHaveBeenCalled();
  });

  it('rejects a product the token did not show', async () => {
    const error = await errorOf(service().recordEvents(token, [{ productId: D, type: 'CLICK' }]));
    expect(error).toMatchObject({ statusCode: 400, code: 'INVALID_RECOMMENDATION_EVENT' });
    expect(db.recommendationEvent.createMany).not.toHaveBeenCalled();
  });

  it('stores each event once, with rank and mode taken from the signed token, not the client', async () => {
    db.recommendationEvent.createMany.mockResolvedValue({ count: 2 });
    const upper = C.toUpperCase();
    const result = await service().recordEvents(token, [{ productId: upper, type: 'IMPRESSION' }, { productId: B, type: 'CLICK' }]);
    expect(result).toEqual({ accepted: 2 });
    const { batchId } = verifyImpressionToken(token) ?? { batchId: '' };
    expect(db.recommendationEvent.createMany).toHaveBeenCalledWith({
      data: [
        { batchId, productId: C, eventType: 'IMPRESSION', mode: 'SIMILAR_PRODUCTS', strategy: 'EMBEDDING_SIMILARITY', surface: 'product_detail', rank: 2 },
        { batchId, productId: B, eventType: 'CLICK', mode: 'SIMILAR_PRODUCTS', strategy: 'EMBEDDING_SIMILARITY', surface: 'product_detail', rank: 1 },
      ],
      skipDuplicates: true,
    });
  });
});

describe('preferences and activity', () => {
  it('opting out erases interactions and recently viewed rows inside the same transaction', async () => {
    const updatedAt = new Date('2026-10-28T00:00:00.000Z');
    db.recommendationPreference.upsert.mockResolvedValue({ personalizationEnabled: false, updatedAt });
    const result = await new RecommendationService(() => null, makeCatalog([]) as unknown as Catalog).setPreferences(USER, false);
    expect(result).toEqual({ personalizationEnabled: false, updatedAt: updatedAt.toISOString() });
    expect(db.recommendationPreference.upsert).toHaveBeenCalledWith({
      where: { userId: USER },
      create: { userId: USER, personalizationEnabled: false, consentedAt: null },
      update: { personalizationEnabled: false, consentedAt: null },
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.productInteraction.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
    expect(db.recentlyViewedProduct.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
    const transactionStarted = db.$transaction.mock.invocationCallOrder[0];
    expect(db.productInteraction.deleteMany.mock.invocationCallOrder[0]).toBeGreaterThan(transactionStarted);
  });

  it('opting in stamps consent and erases nothing', async () => {
    db.recommendationPreference.upsert.mockResolvedValue({ personalizationEnabled: true, updatedAt: new Date() });
    await new RecommendationService(() => null, makeCatalog([]) as unknown as Catalog).setPreferences(USER, true);
    expect(db.recommendationPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { userId: USER, personalizationEnabled: true, consentedAt: expect.any(Date) },
    }));
    expect(db.productInteraction.deleteMany).not.toHaveBeenCalled();
    expect(db.recentlyViewedProduct.deleteMany).not.toHaveBeenCalled();
  });

  it('records nothing when consent is withdrawn at write time', async () => {
    db.product.findFirst.mockResolvedValueOnce({ id: B });
    db.$queryRaw.mockResolvedValueOnce([{ enabled: false }]);
    const result = await new RecommendationService(() => null, makeCatalog([]) as unknown as Catalog)
      .recordInteraction(USER, { productId: B, eventType: 'VIEW', surface: 'product_detail', idempotencyKey: 'view-0001abcd' });
    expect(result).toEqual({ recorded: false, reason: 'PERSONALIZATION_OFF' });
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('moves a duplicate-window revisit to the top of history without adding profile weight', async () => {
    db.product.findFirst.mockResolvedValueOnce({ id: B });
    db.$queryRaw.mockResolvedValueOnce([{ enabled: true }]);
    db.$executeRaw.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const result = await new RecommendationService(() => null, makeCatalog([]) as unknown as Catalog)
      .recordInteraction(USER, { productId: B, eventType: 'VIEW', surface: 'product_detail', idempotencyKey: 'view-0001abcd' });
    expect(result).toEqual({ recorded: false, reason: 'DUPLICATE', historyUpdated: true });
    expect(db.$executeRaw).toHaveBeenCalledTimes(2);
    const bump = db.$executeRaw.mock.calls[1][0].strings.join('?');
    expect(bump).toContain('UPDATE "recently_viewed_products" SET "lastViewedAt"');
    expect(bump).not.toContain('INSERT');
    expect(bump).not.toContain('viewCount');
  });

  it('does not touch history for a duplicate recommendation click', async () => {
    db.product.findFirst.mockResolvedValueOnce({ id: B });
    db.$queryRaw.mockResolvedValueOnce([{ enabled: true }]);
    db.$executeRaw.mockResolvedValueOnce(0);
    const result = await new RecommendationService(() => null, makeCatalog([]) as unknown as Catalog)
      .recordInteraction(USER, { productId: B, eventType: 'RECOMMENDATION_CLICK', surface: 'home', idempotencyKey: 'click-0001abcd' });
    expect(result).toEqual({ recorded: false, reason: 'DUPLICATE' });
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('shows no recently viewed items while personalization is off', async () => {
    db.recommendationPreference.findUnique.mockResolvedValue({ personalizationEnabled: false, updatedAt: new Date() });
    const result = await new RecommendationService(() => null, makeCatalog([product(B)]) as unknown as Catalog).recentlyViewed(USER, 4);
    expect(result).toEqual({ personalizationEnabled: false, items: [] });
    expect(db.recentlyViewedProduct.findMany).not.toHaveBeenCalled();
  });

  it('keeps out-of-stock products in the customer history display', async () => {
    db.recommendationPreference.findUnique.mockResolvedValue({ personalizationEnabled: true, updatedAt: new Date() });
    db.recentlyViewedProduct.findMany.mockResolvedValue([{ productId: B }]);
    const outOfStock = { ...product(B), purchasable: false } as ProductSummary;
    const result = await new RecommendationService(() => null, makeCatalog([outOfStock]) as unknown as Catalog).recentlyViewed(USER, 4);
    expect(result.items.map(item => item.id)).toEqual([B]);
  });

  it('clears the recently viewed list and its view events together', async () => {
    await new RecommendationService(() => null, makeCatalog([]) as unknown as Catalog).clearRecentlyViewed(USER);
    expect(db.$queryRaw.mock.calls[0][0].strings.join('?')).toContain('FOR UPDATE');
    expect(db.recentlyViewedProduct.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
    expect(db.productInteraction.deleteMany).toHaveBeenCalledWith({ where: { userId: USER, eventType: 'VIEW' } });
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.recentlyViewedProduct.deleteMany.mock.invocationCallOrder[0]);
    expect(db.productInteraction.deleteMany.mock.invocationCallOrder[0]).toBeGreaterThan(db.recentlyViewedProduct.deleteMany.mock.invocationCallOrder[0]);
  });

  it('removes only this user-product VIEW history in one transaction', async () => {
    await new RecommendationService(() => null, makeCatalog([]) as unknown as Catalog).removeRecentlyViewed(USER, B);
    expect(db.recentlyViewedProduct.deleteMany).toHaveBeenCalledWith({ where: { userId: USER, productId: B } });
    expect(db.productInteraction.deleteMany).toHaveBeenCalledWith({ where: { userId: USER, productId: B, eventType: 'VIEW' } });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$queryRaw.mock.calls[0][0].strings.join('?')).toContain('FOR UPDATE');
  });

  it('deletes expired activity in bounded indexed batches within one transaction per batch', async () => {
    const service = new RecommendationService(() => null, makeCatalog([]) as unknown as Catalog);
    const now = Date.parse('2030-01-01T00:00:00.000Z');
    expect(await service.purgeExpired(now)).toEqual({ interactions: 0, recentlyViewed: 0, events: 0 });
    expect(db.$executeRaw).toHaveBeenCalledTimes(3);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const statements = db.$executeRaw.mock.calls.map(([query]) => query.strings.join('?'));
    expect(statements.join(' ')).toContain('FOR UPDATE SKIP LOCKED');
    expect(statements.join(' ')).toContain('LIMIT');
  });

  it('caps each retention sweep at four batches per table', async () => {
    db.$executeRaw.mockResolvedValue(500);
    const service = new RecommendationService(() => null, makeCatalog([]) as unknown as Catalog);
    expect(await service.purgeExpired(Date.parse('2030-01-01T00:00:00.000Z'))).toEqual({ interactions: 2000, recentlyViewed: 2000, events: 2000 });
    expect(db.$executeRaw).toHaveBeenCalledTimes(12);
    expect(db.$transaction).toHaveBeenCalledTimes(4);
  });
});
