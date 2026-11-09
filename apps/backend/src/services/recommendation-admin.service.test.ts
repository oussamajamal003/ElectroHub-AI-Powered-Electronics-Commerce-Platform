import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../middleware/errorHandler.js';
import { recordAdminAudit } from './admin-audit.js';
import { RecommendationAdminService } from './recommendation-admin.service.js';
import { RecommendationService } from './recommendation.service.js';
import { coPurchases, measuredPopularity } from './recommendation.sql.js';
import { invalidateRecommendationConfig, pinState, sectionSpec, storefrontEligibility, SECTION_MATRIX } from './recommendation-config.js';

const db = vi.hoisted(() => ({
  recommendationSectionConfig: { findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  featuredProductPin: { findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  product: { findFirst: vi.fn(), findUnique: vi.fn() },
  recommendationEvent: { createMany: vi.fn(), deleteMany: vi.fn() },
  recommendationPreference: { findUnique: vi.fn(), upsert: vi.fn() },
  productInteraction: { deleteMany: vi.fn(), create: vi.fn() },
  recentlyViewedProduct: { deleteMany: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
}));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, logSafely: vi.fn() }));
vi.mock('./admin-audit.js', () => ({ recordAdminAudit: vi.fn() }));
vi.mock('./recommendation.sql.js', () => ({ coPurchases: vi.fn(), measuredPopularity: vi.fn(), profileSignals: vi.fn() }));
vi.mock('./search.service.js', () => ({ SearchService: class {} }));
vi.mock('./product.service.js', () => ({ publicProductWhere: { status: 'ACTIVE', storefrontVisible: true } }));

const ACTOR = { userId: '9de3d92a-d180-41f2-8bd1-ad6f9a6d1e99', requestId: 'req-1' };
const PRODUCT = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const OTHER = '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11';
const PIN = '5a9ff5e6-9d4c-4dbe-9b8c-6f2b5d4e3a55';
const NOW = Date.parse('2026-11-05T12:00:00.000Z');

const eligibleProduct = (id = PRODUCT, quantity = 5) => ({
  id, name: 'QA Probe Headphones', sku: 'QA-PROBE-1', slug: 'qa-probe-headphones', status: 'ACTIVE', isTestFixture: false,
  storefrontVisible: true, category: { isActive: true, name: 'Audio', slug: 'audio' }, inventory: { quantity, lowStockAt: 5 },
});

const pinRow = (overrides: Record<string, unknown> = {}) => ({
  id: PIN, productId: PRODUCT, surface: 'home', position: 1, startsAt: null, endsAt: null, enabled: true, version: 2,
  createdAt: new Date('2026-11-01T10:00:00.000Z'), updatedAt: new Date('2026-11-02T10:00:00.000Z'),
  product: eligibleProduct(), ...overrides,
});

const audit = () => vi.mocked(recordAdminAudit);

beforeEach(() => {
  vi.clearAllMocks();
  invalidateRecommendationConfig();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  db.recommendationSectionConfig.findMany.mockResolvedValue([]);
  db.featuredProductPin.findMany.mockResolvedValue([]);
});

describe('section matrix', () => {
  it('lists only engine-supported surface/mode pairs with their real context', () => {
    const pairs = SECTION_MATRIX.map(spec => `${spec.surface}:${spec.mode}`).sort();
    expect(pairs).toEqual([
      'cart:FREQUENTLY_BOUGHT_TOGETHER', 'home:POPULAR_PRODUCTS', 'home:RECOMMENDED_FOR_YOU',
      'product_detail:FREQUENTLY_BOUGHT_TOGETHER', 'product_detail:SIMILAR_PRODUCTS', 'product_detail:YOU_MAY_ALSO_LIKE',
    ]);
    expect(sectionSpec('home', 'RECOMMENDED_FOR_YOU')?.requiredContext).toBe('consent');
    expect(sectionSpec('cart', 'FREQUENTLY_BOUGHT_TOGETHER')?.requiredContext).toBe('cart');
    expect(sectionSpec('product_detail', 'POPULAR_PRODUCTS')).toBeUndefined();
  });

  it('reports engine defaults for unsaved sections and never exposes the internal featured mode', async () => {
    const sections = await new RecommendationAdminService().configurations();
    expect(sections).toHaveLength(6);
    expect(sections.every(section => section.configured === false && section.enabled && section.version === 0)).toBe(true);
    expect(sections.every(section => section.itemLimit === 12 && section.maxLimit === 12 && section.defaultLimit === 4)).toBe(true);
  });
});

describe('updateSection', () => {
  it('rejects a surface/mode pair the engine does not serve with 400 before opening a transaction', async () => {
    await expect(new RecommendationAdminService().updateSection('home', 'SIMILAR_PRODUCTS', { enabled: false, expectedVersion: 0 }, ACTOR))
      .rejects.toMatchObject({ statusCode: 400, code: 'UNSUPPORTED_RECOMMENDATION_SECTION' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an item limit above the engine maximum', async () => {
    await expect(new RecommendationAdminService().updateSection('home', 'POPULAR_PRODUCTS', { itemLimit: 13, expectedVersion: 0 }, ACTOR))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_ITEM_LIMIT' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('answers 409 VERSION_CONFLICT when the expected version is stale and writes nothing', async () => {
    db.recommendationSectionConfig.findUnique.mockResolvedValue({ surface: 'home', mode: 'POPULAR_PRODUCTS', enabled: true, itemLimit: 4, version: 3, updatedAt: new Date() });
    const error = await new RecommendationAdminService().updateSection('home', 'POPULAR_PRODUCTS', { enabled: false, expectedVersion: 2 }, ACTOR).catch(e => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' });
    expect(db.recommendationSectionConfig.updateMany).not.toHaveBeenCalled();
    expect(audit()).not.toHaveBeenCalled();
  });

  it('updates with a version compare-and-set, audits inside the same transaction and returns the new version', async () => {
    db.recommendationSectionConfig.findUnique.mockResolvedValue({ surface: 'home', mode: 'POPULAR_PRODUCTS', enabled: true, itemLimit: 4, version: 3, updatedAt: new Date() });
    db.recommendationSectionConfig.updateMany.mockResolvedValue({ count: 1 });
    db.recommendationSectionConfig.findUniqueOrThrow.mockResolvedValue({ surface: 'home', mode: 'POPULAR_PRODUCTS', enabled: false, itemLimit: 4, version: 4, updatedAt: new Date() });
    const view = await new RecommendationAdminService().updateSection('home', 'POPULAR_PRODUCTS', { enabled: false, expectedVersion: 3 }, ACTOR);
    expect(db.recommendationSectionConfig.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { surface: 'home', mode: 'POPULAR_PRODUCTS', version: 3 }, data: expect.objectContaining({ enabled: false, version: { increment: 1 } }),
    }));
    expect(audit()).toHaveBeenCalledWith(expect.objectContaining({ action: 'RECOMMENDATION_SECTION_UPDATED', actorId: ACTOR.userId,
      details: expect.objectContaining({ previousVersion: 3, version: 4, enabled: false }) }), db);
    expect(view).toMatchObject({ enabled: false, version: 4, configured: true });
  });

  it('creates the first row at version 1 and maps a racing duplicate create to 409', async () => {
    db.recommendationSectionConfig.findUnique.mockResolvedValue(null);
    db.recommendationSectionConfig.create.mockResolvedValue({ surface: 'cart', mode: 'FREQUENTLY_BOUGHT_TOGETHER', enabled: true, itemLimit: 6, version: 1, updatedAt: new Date() });
    const created = await new RecommendationAdminService().updateSection('cart', 'FREQUENTLY_BOUGHT_TOGETHER', { itemLimit: 6, expectedVersion: 0 }, ACTOR);
    expect(created).toMatchObject({ itemLimit: 6, version: 1 });

    db.recommendationSectionConfig.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.0.0' }));
    await expect(new RecommendationAdminService().updateSection('cart', 'FREQUENTLY_BOUGHT_TOGETHER', { itemLimit: 6, expectedVersion: 0 }, ACTOR))
      .rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' });
  });
});

describe('storefront eligibility and pin state (pure rules)', () => {
  it('names every reason a product is not storefront-eligible, matching the engine predicate', () => {
    expect(storefrontEligibility(eligibleProduct()).eligible).toBe(true);
    expect(storefrontEligibility({ ...eligibleProduct(), status: 'INACTIVE' }).reasons).toContain('NOT_ACTIVE');
    expect(storefrontEligibility({ ...eligibleProduct(), isTestFixture: true }).reasons).toContain('TEST_FIXTURE');
    expect(storefrontEligibility({ ...eligibleProduct(), storefrontVisible: false }).reasons).toContain('NOT_STOREFRONT_VISIBLE');
    expect(storefrontEligibility({ ...eligibleProduct(), category: { isActive: false } }).reasons).toContain('CATEGORY_INACTIVE');
    expect(storefrontEligibility({ ...eligibleProduct(), inventory: null }).reasons).toEqual(['OUT_OF_STOCK']);
  });

  it('computes ACTIVE, SCHEDULED, EXPIRED, PAUSED and INELIGIBLE with paused and expired winning over eligibility', () => {
    const at = (iso: string) => new Date(iso);
    expect(pinState({ enabled: true, startsAt: null, endsAt: null }, true, NOW)).toBe('ACTIVE');
    expect(pinState({ enabled: true, startsAt: at('2026-11-06T00:00:00Z'), endsAt: null }, true, NOW)).toBe('SCHEDULED');
    expect(pinState({ enabled: true, startsAt: null, endsAt: at('2026-11-05T11:00:00Z') }, true, NOW)).toBe('EXPIRED');
    expect(pinState({ enabled: false, startsAt: null, endsAt: null }, false, NOW)).toBe('PAUSED');
    expect(pinState({ enabled: true, startsAt: null, endsAt: null }, false, NOW)).toBe('INELIGIBLE');
    expect(pinState({ enabled: true, startsAt: null, endsAt: at('2026-11-05T11:00:00Z') }, false, NOW)).toBe('EXPIRED');
  });
});

describe('featured pins', () => {
  it('refuses to pin a product that is not storefront-eligible at write time (422) and creates nothing', async () => {
    db.product.findUnique.mockResolvedValue(eligibleProduct(OTHER, 0));
    await expect(new RecommendationAdminService().createPin({ productId: OTHER, surface: 'home', position: 0, startsAt: null, endsAt: null, enabled: true }, ACTOR))
      .rejects.toMatchObject({ statusCode: 422, code: 'PRODUCT_NOT_ELIGIBLE' });
    expect(db.featuredProductPin.create).not.toHaveBeenCalled();
  });

  it('enforces the maximum of eight pins per placement (409) and the single-product uniqueness per placement', async () => {
    db.product.findUnique.mockResolvedValue(eligibleProduct());
    db.featuredProductPin.count.mockResolvedValue(8);
    await expect(new RecommendationAdminService().createPin({ productId: PRODUCT, surface: 'home', position: 0, startsAt: null, endsAt: null, enabled: true }, ACTOR))
      .rejects.toMatchObject({ statusCode: 409, code: 'FEATURED_LIMIT_REACHED' });

    db.featuredProductPin.count.mockResolvedValue(1);
    db.featuredProductPin.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.0.0' }));
    await expect(new RecommendationAdminService().createPin({ productId: PRODUCT, surface: 'home', position: 0, startsAt: null, endsAt: null, enabled: true }, ACTOR))
      .rejects.toMatchObject({ statusCode: 409, code: 'PIN_EXISTS' });
  });

  it('rejects an end time that is not after the start time (400) before touching the database', async () => {
    await expect(new RecommendationAdminService().createPin({ productId: PRODUCT, surface: 'home', position: 0,
      startsAt: new Date('2026-11-06T00:00:00Z'), endsAt: new Date('2026-11-05T00:00:00Z'), enabled: true }, ACTOR))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PIN_SCHEDULE' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('creates an eligible pin with a sanitized audit entry (identifiers only, no product name)', async () => {
    db.product.findUnique.mockResolvedValue(eligibleProduct());
    db.featuredProductPin.count.mockResolvedValue(0);
    db.featuredProductPin.create.mockResolvedValue(pinRow({ version: 1 }));
    const view = await new RecommendationAdminService().createPin({ productId: PRODUCT, surface: 'home', position: 1, startsAt: null, endsAt: null, enabled: true }, ACTOR, NOW);
    expect(view).toMatchObject({ id: PIN, state: 'ACTIVE', eligible: true, version: 1 });
    const entry = audit().mock.calls[0][0];
    expect(entry.action).toBe('FEATURED_PIN_CREATED');
    expect(JSON.stringify(entry.details)).not.toContain('QA Probe Headphones');
  });

  it('answers 409 VERSION_CONFLICT when a pin update is stale and 422 when re-enabling an ineligible product', async () => {
    db.featuredProductPin.findUnique.mockResolvedValue({ ...pinRow(), enabled: false, version: 4 });
    await expect(new RecommendationAdminService().updatePin(PIN, { expectedVersion: 3, position: 2 }, ACTOR))
      .rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' });

    db.featuredProductPin.findUnique.mockResolvedValue({ ...pinRow(), enabled: false, version: 4, product: eligibleProduct(PRODUCT, 0) });
    await expect(new RecommendationAdminService().updatePin(PIN, { expectedVersion: 4, enabled: true }, ACTOR))
      .rejects.toMatchObject({ statusCode: 422, code: 'PRODUCT_NOT_ELIGIBLE' });
    expect(db.featuredProductPin.updateMany).not.toHaveBeenCalled();
  });

  it('requires a matching version to delete and reports 404 for an unknown pin', async () => {
    db.featuredProductPin.findUnique.mockResolvedValue(null);
    await expect(new RecommendationAdminService().deletePin(PIN, ACTOR, 2)).rejects.toMatchObject({ statusCode: 404, code: 'PIN_NOT_FOUND' });

    db.featuredProductPin.findUnique.mockResolvedValue(pinRow({ version: 2 }));
    await expect(new RecommendationAdminService().deletePin(PIN, ACTOR, 1)).rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' });
    expect(db.featuredProductPin.deleteMany).not.toHaveBeenCalled();

    db.featuredProductPin.deleteMany.mockResolvedValue({ count: 1 });
    await new RecommendationAdminService().deletePin(PIN, ACTOR, 2);
    expect(db.featuredProductPin.deleteMany).toHaveBeenCalledWith({ where: { id: PIN, version: 2 } });
    expect(audit()).toHaveBeenCalledWith(expect.objectContaining({ action: 'FEATURED_PIN_DELETED' }), db);
  });
});

describe('overview', () => {
  it('reports CTR as null for a group with no impressions and as clicks over impressions otherwise', async () => {
    db.$queryRaw.mockResolvedValue([
      { surface: 'home', mode: 'POPULAR_PRODUCTS', strategy: 'MEASURED_POPULARITY', impressions: BigInt(40), clicks: BigInt(10) },
      { surface: 'cart', mode: 'FREQUENTLY_BOUGHT_TOGETHER', strategy: 'NO_DATA', impressions: BigInt(0), clicks: BigInt(0) },
      { surface: 'home', mode: 'POPULAR_PRODUCTS', strategy: 'FALLBACK_NEW_ARRIVALS', impressions: BigInt(10), clicks: BigInt(0) },
    ]);
    const data = await new RecommendationAdminService().overview('7d', undefined, NOW);
    const byStrategy = Object.fromEntries(data.breakdown.map(row => [row.strategy, row]));
    expect(byStrategy.MEASURED_POPULARITY).toMatchObject({ impressions: 40, clicks: 10, ctr: 0.25, fallback: false });
    expect(byStrategy.NO_DATA.ctr).toBeNull();
    expect(data.totals).toMatchObject({ impressions: 50, clicks: 10, ctr: 0.2, fallbackImpressions: 10, fallbackShare: 0.2 });
    expect(data.since).toBe(new Date(NOW - 7 * 86_400_000).toISOString());
  });

  it('reports no CTR at all when nothing was recorded, rather than a zero rate', async () => {
    db.$queryRaw.mockResolvedValue([]);
    const data = await new RecommendationAdminService().overview('30d', 'home', NOW);
    expect(data.totals).toMatchObject({ impressions: 0, clicks: 0, ctr: null, fallbackShare: null });
    expect(data.breakdown).toEqual([]);
  });
});

describe('preview isolation', () => {
  const engine = () => new RecommendationService(() => null, {
    productSummariesByIds: vi.fn(async (ids: readonly string[]) => ids.map(id => ({ ...eligibleProduct(id), purchasable: true, id }))),
    products: vi.fn(async () => ({ data: [{ ...eligibleProduct(OTHER), purchasable: true }], meta: { total: 1, page: 1, pageSize: 4 } })),
  } as never);

  it('runs the real home engine path without issuing a token or writing any event, interaction, preference or history row', async () => {
    vi.mocked(measuredPopularity).mockResolvedValue({ rows: [], contributingUsers: 0 });
    const preview = await new RecommendationAdminService(engine()).preview({ surface: 'home', limit: 4 });
    expect(preview.recorded).toBe(false);
    expect(preview.sections).toHaveLength(1);
    expect(preview.sections[0].impressionToken).toBeNull();
    expect(preview.sections[0].items.length).toBeGreaterThan(0);
    expect(db.recommendationEvent.createMany).not.toHaveBeenCalled();
    expect(db.productInteraction.create).not.toHaveBeenCalled();
    expect(db.recommendationPreference.upsert).not.toHaveBeenCalled();
    expect(db.recentlyViewedProduct.deleteMany).not.toHaveBeenCalled();
    expect(audit()).not.toHaveBeenCalled();
  });

  it('previews a product page and a synthetic cart with no token, and requires the context it needs', async () => {
    db.product.findFirst.mockResolvedValue({ id: PRODUCT, name: 'QA Probe Headphones', slug: 'qa-probe-headphones', category: { name: 'Audio', slug: 'audio' } });
    vi.mocked(coPurchases).mockResolvedValue([]);
    const service = new RecommendationAdminService(engine());
    await expect(service.preview({ surface: 'product_detail', limit: 4 })).rejects.toMatchObject({ statusCode: 400, code: 'PREVIEW_PRODUCT_REQUIRED' });
    await expect(service.preview({ surface: 'cart', limit: 4, cartProductIds: [] })).rejects.toMatchObject({ statusCode: 400, code: 'PREVIEW_CART_REQUIRED' });

    const page = await service.preview({ surface: 'product_detail', productId: PRODUCT, limit: 4 });
    expect(page.context).toMatchObject({ kind: 'ANCHOR_PRODUCT', productId: PRODUCT });
    for (const section of page.sections) expect(section.impressionToken).toBeNull();
    expect(db.recommendationEvent.createMany).not.toHaveBeenCalled();
  });
});
