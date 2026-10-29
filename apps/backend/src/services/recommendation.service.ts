import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { AiServiceError, getAiServiceClient, type AiServiceClient } from '../integrations/ai/ai.client.js';
import { AI_MAX_TOP_K, AI_PROFILE_FEATURE_SPEC_VERSION, type AiRecommendationRequestInput, type AiRecommendationResult } from '../integrations/ai/ai.schemas.js';
import { logger } from '../utils/logger.js';
import { publicProductWhere } from './product.service.js';
import { SearchService } from './search.service.js';
import { coPurchases, measuredPopularity, profileSignals } from './recommendation.sql.js';
import { issueImpressionToken, verifyImpressionToken } from './recommendation-token.js';

/**
 * Task 04.4: public recommendation gateway. FastAPI ranks over the D3 learned-embedding index; co-purchase and
 * popularity are trustworthy SQL aggregates here. Every product leaving this service comes from the public catalog
 * projection (visibility, fixtures, current price and stock), and every section states truthfully how it was made.
 */

export type RecommendationMode = 'SIMILAR_PRODUCTS' | 'YOU_MAY_ALSO_LIKE' | 'RECOMMENDED_FOR_YOU' | 'FREQUENTLY_BOUGHT_TOGETHER' | 'POPULAR_PRODUCTS';
export type RecommendationStrategy =
  | 'EMBEDDING_SIMILARITY' | 'BEHAVIOR_EMBEDDING' | 'HYBRID_EMBEDDING' | 'CO_PURCHASE' | 'MEASURED_POPULARITY'
  | 'FALLBACK_CATEGORY' | 'FALLBACK_POPULAR' | 'FALLBACK_NEW_ARRIVALS' | 'NO_DATA';
export type FallbackReason =
  | 'AI_UNAVAILABLE' | 'NOT_INDEXED' | 'NO_RESULTS' | 'PERSONALIZATION_OFF' | 'INSUFFICIENT_HISTORY'
  | 'NO_MEASURED_DEMAND' | 'INSUFFICIENT_SUPPORT';
export type RecommendationSurface = 'product_detail' | 'home' | 'cart';
export type InteractionType = 'VIEW' | 'RECOMMENDATION_CLICK';

type ProductSummary = Awaited<ReturnType<SearchService['productSummariesByIds']>>[number];

export interface RecommendationSection {
  mode: RecommendationMode;
  surface: RecommendationSurface;
  strategy: RecommendationStrategy;
  isPersonalized: boolean;
  isFallback: boolean;
  fallbackReason: FallbackReason | null;
  modelVersion: string | null;
  embeddingVersion: string | null;
  algorithmVersion: string;
  context: { categoryName: string; categorySlug: string } | null;
  impressionToken: string | null;
  items: { rank: number; product: ProductSummary }[];
}

export const RECOMMENDATION_DEFAULT_LIMIT = 4;
export const RECOMMENDATION_MAX_LIMIT = 12;
export const MAX_CART_ANCHORS = 50;
export const RETENTION_DAYS = 90;
export const RECENTLY_VIEWED_CAP = 20;
/** profile-v1: personalization needs evidence on at least two products and a decayed weight of at least 3 (e.g. one wishlist). */
export const PROFILE_RULES = { windowDays: RETENTION_DAYS, maxSignals: 50, minProducts: 2, minTotalWeight: 3 } as const;
export const POPULARITY_RULES = { windowDays: 30, minUsersPerProduct: 2, minContributingUsers: 3 } as const;
export const FBT_MIN_SUPPORT = 2;
const ALGORITHMS = {
  coPurchase: 'co-purchase-v1', popularity: 'popularity-v1', category: 'category-newest-v1', newArrivals: 'new-arrivals-v1',
  contextSuffix: '.context-v1', none: 'none',
} as const;

class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();
  constructor(private readonly ttlMs: number, private readonly maxEntries: number) {}
  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt < Date.now()) { this.entries.delete(key); return undefined; }
    return entry.value;
  }
  set(key: string, value: V) {
    if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
  clear() { this.entries.clear(); }
}

type AiOutcome = { ok: true; result: AiRecommendationResult } | { ok: false; reason: 'AI_UNAVAILABLE' };

function section(input: Omit<RecommendationSection, 'impressionToken' | 'items'> & { products: ProductSummary[] }): RecommendationSection {
  const { products, ...rest } = input;
  const items = products.map((product, index) => ({ rank: index + 1, product }));
  return {
    ...rest,
    impressionToken: items.length > 0
      ? issueImpressionToken({ mode: rest.mode, strategy: rest.strategy, surface: rest.surface, productIds: items.map(item => item.product.id) })
      : null,
    items,
  };
}

function noData(mode: RecommendationMode, surface: RecommendationSurface, reason: FallbackReason): RecommendationSection {
  return section({ mode, surface, strategy: 'NO_DATA', isPersonalized: false, isFallback: true, fallbackReason: reason,
    modelVersion: null, embeddingVersion: null, algorithmVersion: ALGORITHMS.none, context: null, products: [] });
}

/** Keeps AI order but lets at most half of the rail come from the anchor's own category, so the rail broadens. */
export function diversifyByCategory(products: ProductSummary[], anchorCategorySlug: string, limit: number) {
  const cap = Math.ceil(limit / 2);
  const chosen: ProductSummary[] = [];
  const deferred: ProductSummary[] = [];
  let sameCategory = 0;
  for (const product of products) {
    if (chosen.length >= limit) break;
    if (product.category.slug === anchorCategorySlug) {
      if (sameCategory >= cap) { deferred.push(product); continue; }
      sameCategory += 1;
    }
    chosen.push(product);
  }
  // Never shorten the rail just for diversity: fill from the deferred same-category items in AI order.
  for (const product of deferred) { if (chosen.length >= limit) break; chosen.push(product); }
  return chosen;
}

/**
 * Normalized profile weights in (0, 1] for the strongest signals, or null when the evidence threshold is not met.
 * The threshold counts undecayed signal weight inside the window (`evidence`, defaulting to `score`): decay ranks
 * signals, it must not make three fresh views (3 × 0.9999…) fall short of a threshold of 3.
 */
export function profileWeights(rows: { productId: string; score: number; evidence?: number }[]) {
  const usable = rows.filter(row => Number.isFinite(row.score) && row.score > 0);
  const total = usable.reduce((sum, row) => sum + (row.evidence ?? row.score), 0);
  if (usable.length < PROFILE_RULES.minProducts || total < PROFILE_RULES.minTotalWeight) return null;
  const max = Math.max(...usable.map(row => row.score));
  return usable.slice(0, PROFILE_RULES.maxSignals).map(row => ({
    productId: row.productId,
    weight: Math.min(1, Math.max(0.01, Math.round((row.score / max) * 1e6) / 1e6)),
  }));
}

let lastPurgeAt = 0;
const PURGE_INTERVAL_MS = 60 * 60_000;

export class RecommendationService {
  private readonly popularityCache = new TtlCache<Awaited<ReturnType<typeof measuredPopularity>>>(60_000, 32);
  private readonly coPurchaseCache = new TtlCache<Awaited<ReturnType<typeof coPurchases>>>(5 * 60_000, 500);

  constructor(
    private readonly resolveClient: () => AiServiceClient | null = getAiServiceClient,
    private readonly catalog = new SearchService(),
  ) {}

  private async ai(request: AiRecommendationRequestInput, requestId?: string): Promise<AiOutcome> {
    const client = this.resolveClient();
    if (!client) return { ok: false, reason: 'AI_UNAVAILABLE' };
    try {
      return { ok: true, result: await client.recommend(request, { requestId }) };
    } catch (error) {
      // Recommendations are optional: every AI failure becomes an honest fallback, never a page error.
      if (error instanceof AiServiceError) {
        this.log('RECOMMENDATIONS_AI_FAILED', { mode: request.mode, category: error.category, code: error.code, requestId });
        return { ok: false, reason: 'AI_UNAVAILABLE' };
      }
      throw error;
    }
  }

  private log(event: string, fields: Record<string, unknown>) {
    try { logger.info(event, { operation: 'recommendations', ...fields }); } catch { /* Logging never replaces a response. */ }
  }

  private async coPurchaseFor(anchorIds: string[], limit: number) {
    const key = `${[...anchorIds].sort().join(',')}:${limit}`;
    const cached = this.coPurchaseCache.get(key);
    if (cached) return cached;
    const rows = await coPurchases(anchorIds, FBT_MIN_SUPPORT, limit);
    this.coPurchaseCache.set(key, rows);
    return rows;
  }

  async productSections(slug: string, limit: number, requestId?: string) {
    const started = Date.now();
    const anchor = await prisma.product.findFirst({
      where: { ...publicProductWhere, slug },
      select: { id: true, category: { select: { name: true, slug: true } } },
    });
    if (!anchor) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
    const surface: RecommendationSurface = 'product_detail';
    const shown = new Set<string>([anchor.id]);
    const unseen = (products: ProductSummary[]) => products.filter(product => !shown.has(product.id));
    const remember = (products: ProductSummary[]) => { for (const product of products) shown.add(product.id); return products; };

    // 1. Frequently Bought Together: real distinct qualifying co-purchases only.
    const pairs = await this.coPurchaseFor([anchor.id], limit * 2);
    const fbtProducts = remember(unseen(await this.catalog.productSummariesByIds(pairs.map(pair => pair.productId))).slice(0, limit));
    const fbt = fbtProducts.length > 0
      ? section({ mode: 'FREQUENTLY_BOUGHT_TOGETHER', surface, strategy: 'CO_PURCHASE', isPersonalized: false, isFallback: false,
        fallbackReason: null, modelVersion: null, embeddingVersion: null, algorithmVersion: ALGORITHMS.coPurchase, context: null, products: fbtProducts })
      : noData('FREQUENTLY_BOUGHT_TOGETHER', surface, 'INSUFFICIENT_SUPPORT');

    // 2. Similar Products: D3 learned-embedding retrieval, or an honestly labelled same-category fallback.
    const similarAi = await this.ai({ mode: 'SIMILAR_PRODUCTS', productId: anchor.id, excludeProductIds: [...shown].filter(id => id !== anchor.id),
      limit: Math.min(AI_MAX_TOP_K, limit * 2) }, requestId);
    let similar: RecommendationSection | null = null;
    let fallbackReason: FallbackReason | null = null;
    if (similarAi.ok && similarAi.result.anchorIndexed) {
      const products = remember(unseen(await this.catalog.productSummariesByIds(similarAi.result.items.map(item => item.productId))).slice(0, limit));
      if (products.length > 0) {
        similar = section({ mode: 'SIMILAR_PRODUCTS', surface, strategy: 'EMBEDDING_SIMILARITY', isPersonalized: false, isFallback: false,
          fallbackReason: null, modelVersion: similarAi.result.modelVersion, embeddingVersion: similarAi.result.embeddingVersion,
          algorithmVersion: similarAi.result.algorithmVersion, context: null, products });
      } else fallbackReason = 'NO_RESULTS';
    } else fallbackReason = similarAi.ok ? 'NOT_INDEXED' : similarAi.reason;
    if (!similar) {
      fallbackReason ??= 'NO_RESULTS';
      const category = await this.catalog.products({ q: '', category: anchor.category.slug, page: 1, pageSize: limit + shown.size });
      similar = section({ mode: 'SIMILAR_PRODUCTS', surface, strategy: 'FALLBACK_CATEGORY', isPersonalized: false, isFallback: true,
        fallbackReason, modelVersion: null, embeddingVersion: null, algorithmVersion: ALGORITHMS.category,
        context: { categoryName: anchor.category.name, categorySlug: anchor.category.slug },
        products: remember(unseen(category.data).slice(0, limit)) });
    }

    // 3. You May Also Like: deeper D3 neighbours beyond what is already shown, broadened across categories.
    let alsoLike = noData('YOU_MAY_ALSO_LIKE', surface, fallbackReason ?? 'NO_RESULTS');
    if (!fallbackReason) {
      const ymalAi = await this.ai({ mode: 'YOU_MAY_ALSO_LIKE', productId: anchor.id,
        excludeProductIds: [...shown].filter(id => id !== anchor.id), limit: AI_MAX_TOP_K }, requestId);
      if (ymalAi.ok && ymalAi.result.anchorIndexed) {
        const candidates = unseen(await this.catalog.productSummariesByIds(ymalAi.result.items.map(item => item.productId)));
        const products = remember(diversifyByCategory(candidates, anchor.category.slug, limit));
        // Two cards are the minimum for a meaningful rail; fewer is hidden rather than padded.
        if (products.length >= 2) {
          alsoLike = section({ mode: 'YOU_MAY_ALSO_LIKE', surface, strategy: 'HYBRID_EMBEDDING', isPersonalized: false, isFallback: false,
            fallbackReason: null, modelVersion: ymalAi.result.modelVersion, embeddingVersion: ymalAi.result.embeddingVersion,
            algorithmVersion: `${ymalAi.result.algorithmVersion}${ALGORITHMS.contextSuffix}`, context: null, products });
        }
      } else alsoLike = noData('YOU_MAY_ALSO_LIKE', surface, ymalAi.ok ? 'NOT_INDEXED' : ymalAi.reason);
    }

    const sections = [similar, alsoLike, fbt];
    this.log('RECOMMENDATIONS_RESOLVED', { surface, durationMs: Date.now() - started, requestId,
      sections: sections.map(item => ({ mode: item.mode, strategy: item.strategy, fallbackReason: item.fallbackReason, returned: item.items.length })),
      embeddingVersion: similar.embeddingVersion });
    return { sections };
  }

  async popular(limit: number, surface: RecommendationSurface = 'home'): Promise<RecommendationSection> {
    const key = String(limit);
    let popularity = this.popularityCache.get(key);
    if (!popularity) {
      popularity = await measuredPopularity(POPULARITY_RULES.windowDays, POPULARITY_RULES.minUsersPerProduct, limit * 2);
      this.popularityCache.set(key, popularity);
    }
    if (popularity.contributingUsers >= POPULARITY_RULES.minContributingUsers) {
      const products = (await this.catalog.productSummariesByIds(popularity.rows.map(row => row.productId))).slice(0, limit);
      if (products.length >= 2) {
        return section({ mode: 'POPULAR_PRODUCTS', surface, strategy: 'MEASURED_POPULARITY', isPersonalized: false, isFallback: false,
          fallbackReason: null, modelVersion: null, embeddingVersion: null, algorithmVersion: ALGORITHMS.popularity, context: null, products });
      }
    }
    const arrivals = await this.catalog.products({ q: '', page: 1, pageSize: limit });
    return section({ mode: 'POPULAR_PRODUCTS', surface, strategy: 'FALLBACK_NEW_ARRIVALS', isPersonalized: false, isFallback: true,
      fallbackReason: 'NO_MEASURED_DEMAND', modelVersion: null, embeddingVersion: null, algorithmVersion: ALGORITHMS.newArrivals,
      context: null, products: arrivals.data });
  }

  /** Recommended for You: a learned-embedding profile only for a consenting customer with enough real activity. */
  async forUser(userId: string, limit: number, requestId?: string): Promise<RecommendationSection & { profile: { featureSpecVersion: string; signalCount: number; watermark: string } | null }> {
    const fallback = async (reason: FallbackReason) => {
      const popular = await this.popular(limit, 'home');
      return { ...popular, mode: 'RECOMMENDED_FOR_YOU' as const, isFallback: true, fallbackReason: reason,
        strategy: popular.strategy === 'MEASURED_POPULARITY' ? 'FALLBACK_POPULAR' as const : 'FALLBACK_NEW_ARRIVALS' as const,
        impressionToken: popular.items.length > 0 ? issueImpressionToken({ mode: 'RECOMMENDED_FOR_YOU',
          strategy: popular.strategy === 'MEASURED_POPULARITY' ? 'FALLBACK_POPULAR' : 'FALLBACK_NEW_ARRIVALS', surface: 'home',
          productIds: popular.items.map(item => item.product.id) }) : null,
        profile: null };
    };
    if (!(await this.preferences(userId)).personalizationEnabled) return fallback('PERSONALIZATION_OFF');
    const rows = await profileSignals(userId, PROFILE_RULES.windowDays, PROFILE_RULES.maxSignals);
    const weights = profileWeights(rows);
    if (!weights) return fallback('INSUFFICIENT_HISTORY');
    const outcome = await this.ai({ mode: 'RECOMMENDED_FOR_YOU', limit: Math.min(AI_MAX_TOP_K, limit * 2),
      context: { profileSignals: weights, featureSpecVersion: AI_PROFILE_FEATURE_SPEC_VERSION } }, requestId);
    if (!outcome.ok) return fallback(outcome.reason);
    if (!outcome.result.anchorIndexed) return fallback('NOT_INDEXED');
    const products = (await this.catalog.productSummariesByIds(outcome.result.items.map(item => item.productId))).slice(0, limit);
    if (products.length < 2) return fallback('NO_RESULTS');
    const watermark = rows.reduce((latest, row) => (row.lastAt > latest ? row.lastAt : latest), rows[0].lastAt);
    this.log('RECOMMENDATIONS_RESOLVED', { surface: 'home', mode: 'RECOMMENDED_FOR_YOU', strategy: 'BEHAVIOR_EMBEDDING',
      signalCount: weights.length, returned: products.length, embeddingVersion: outcome.result.embeddingVersion, requestId });
    return {
      ...section({ mode: 'RECOMMENDED_FOR_YOU', surface: 'home', strategy: 'BEHAVIOR_EMBEDDING', isPersonalized: true, isFallback: false,
        fallbackReason: null, modelVersion: outcome.result.modelVersion, embeddingVersion: outcome.result.embeddingVersion,
        algorithmVersion: outcome.result.algorithmVersion, context: null, products }),
      profile: { featureSpecVersion: AI_PROFILE_FEATURE_SPEC_VERSION, signalCount: weights.length, watermark: watermark.toISOString() },
    };
  }

  /** Frequently Bought Together for the current cart. Product ids are context only: nothing about the cart is changed. */
  async forCart(productIds: string[], limit: number): Promise<RecommendationSection> {
    const anchors = (await this.catalog.productSummariesByIds(productIds)).map(product => product.id);
    if (anchors.length === 0) return noData('FREQUENTLY_BOUGHT_TOGETHER', 'cart', 'INSUFFICIENT_SUPPORT');
    const pairs = await this.coPurchaseFor(anchors, limit * 2);
    const inCart = new Set(anchors);
    const products = (await this.catalog.productSummariesByIds(pairs.map(pair => pair.productId)))
      .filter(product => !inCart.has(product.id)).slice(0, limit);
    if (products.length === 0) return noData('FREQUENTLY_BOUGHT_TOGETHER', 'cart', 'INSUFFICIENT_SUPPORT');
    return section({ mode: 'FREQUENTLY_BOUGHT_TOGETHER', surface: 'cart', strategy: 'CO_PURCHASE', isPersonalized: false,
      isFallback: false, fallbackReason: null, modelVersion: null, embeddingVersion: null, algorithmVersion: ALGORITHMS.coPurchase,
      context: null, products });
  }

  async preferences(userId: string) {
    const row = await prisma.recommendationPreference.findUnique({ where: { userId } });
    return { personalizationEnabled: row?.personalizationEnabled ?? false, updatedAt: row?.updatedAt.toISOString() ?? null };
  }

  /** Opting out erases the activity history it governed; the preference row itself records the choice. */
  async setPreferences(userId: string, personalizationEnabled: boolean) {
    const row = await prisma.$transaction(async transaction => {
      const saved = await transaction.recommendationPreference.upsert({
        where: { userId },
        create: { userId, personalizationEnabled, consentedAt: personalizationEnabled ? new Date() : null },
        update: { personalizationEnabled, consentedAt: personalizationEnabled ? new Date() : null },
      });
      if (!personalizationEnabled) {
        await transaction.productInteraction.deleteMany({ where: { userId } });
        await transaction.recentlyViewedProduct.deleteMany({ where: { userId } });
      }
      return saved;
    });
    return { personalizationEnabled: row.personalizationEnabled, updatedAt: row.updatedAt.toISOString() };
  }

  async recordInteraction(userId: string, input: { productId: string; eventType: InteractionType; surface: string; idempotencyKey: string }) {
    const product = await prisma.product.findFirst({ where: { ...publicProductWhere, id: input.productId }, select: { id: true } });
    if (!product) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
    const now = new Date();
    const result = await prisma.$transaction(async transaction => {
      // Locks the consent row against a concurrent opt-out, whose update+erase therefore runs strictly before or after.
      const consent = await transaction.$queryRaw<{ enabled: boolean }[]>(Prisma.sql`
        SELECT "personalizationEnabled" AS enabled FROM "recommendation_preferences" WHERE "userId" = ${userId}::uuid FOR SHARE`);
      if (!consent[0]?.enabled) return { recorded: false, reason: 'PERSONALIZATION_OFF' as const };
      const inserted = await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "product_interactions" ("id", "userId", "productId", "eventType", "surface", "idempotencyKey", "occurredAt", "receivedAt")
        VALUES (gen_random_uuid(), ${userId}::uuid, ${input.productId}::uuid, ${input.eventType}, ${input.surface}, ${input.idempotencyKey}, ${now}, ${now})
        ON CONFLICT ("userId", "idempotencyKey") DO NOTHING`);
      if (inserted === 0) return { recorded: false, reason: 'DUPLICATE' as const };
      if (input.eventType === 'VIEW') {
        await transaction.$executeRaw(Prisma.sql`
          INSERT INTO "recently_viewed_products" ("userId", "productId", "lastViewedAt", "viewCount")
          VALUES (${userId}::uuid, ${input.productId}::uuid, ${now}, 1)
          ON CONFLICT ("userId", "productId") DO UPDATE
          SET "lastViewedAt" = EXCLUDED."lastViewedAt", "viewCount" = LEAST("recently_viewed_products"."viewCount" + 1, 1000000)`);
        await transaction.$executeRaw(Prisma.sql`
          DELETE FROM "recently_viewed_products" WHERE "userId" = ${userId}::uuid AND "productId" NOT IN (
            SELECT "productId" FROM "recently_viewed_products" WHERE "userId" = ${userId}::uuid
            ORDER BY "lastViewedAt" DESC, "productId" ASC LIMIT ${RECENTLY_VIEWED_CAP})`);
      }
      return { recorded: true, reason: null };
    });
    void this.purgeExpiredIfDue();
    return result;
  }

  async recentlyViewed(userId: string, limit: number) {
    const { personalizationEnabled } = await this.preferences(userId);
    if (!personalizationEnabled) return { personalizationEnabled, items: [] as ProductSummary[] };
    const rows = await prisma.recentlyViewedProduct.findMany({
      where: { userId, lastViewedAt: { gt: new Date(Date.now() - RETENTION_DAYS * 86_400_000) } },
      orderBy: [{ lastViewedAt: 'desc' }, { productId: 'asc' }], take: limit, select: { productId: true },
    });
    // Hidden, retired or fixture products drop out here even if they were viewed before.
    return { personalizationEnabled, items: await this.catalog.productSummariesByIds(rows.map(row => row.productId)) };
  }

  /** Clears the list and the VIEW events behind it, so the profile forgets those views (clicks, cart, wishlist and purchases stay until opt-out). */
  async clearRecentlyViewed(userId: string) {
    await prisma.$transaction([
      prisma.recentlyViewedProduct.deleteMany({ where: { userId } }),
      prisma.productInteraction.deleteMany({ where: { userId, eventType: 'VIEW' } }),
    ]);
  }

  /** Non-personal attribution: each (batch, product, type) is stored once; rank and mode come from the signed token. */
  async recordEvents(token: string, events: { productId: string; type: 'IMPRESSION' | 'CLICK' }[]) {
    const claims = verifyImpressionToken(token);
    if (!claims) throw new AppError('Recommendation event token is invalid or expired.', 400, 'INVALID_RECOMMENDATION_TOKEN');
    const rank = new Map(claims.productIds.map((id, index) => [id.toLowerCase(), index + 1]));
    if (events.some(event => !rank.has(event.productId.toLowerCase()))) {
      throw new AppError('Recommendation event does not match the shown products.', 400, 'INVALID_RECOMMENDATION_EVENT');
    }
    const result = await prisma.recommendationEvent.createMany({
      data: events.map(event => ({ batchId: claims.batchId, productId: event.productId.toLowerCase(), eventType: event.type,
        mode: claims.mode, strategy: claims.strategy, surface: claims.surface, rank: rank.get(event.productId.toLowerCase())! })),
      skipDuplicates: true,
    });
    return { accepted: result.count };
  }

  /** Retention: personal activity and attribution older than the window are deleted (at most hourly per process). */
  async purgeExpiredIfDue(now = Date.now()) {
    if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;
    lastPurgeAt = now;
    const cutoff = new Date(now - RETENTION_DAYS * 86_400_000);
    try {
      await prisma.$transaction([
        prisma.productInteraction.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
        prisma.recentlyViewedProduct.deleteMany({ where: { lastViewedAt: { lt: cutoff } } }),
        prisma.recommendationEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
      ]);
    } catch (error) {
      this.log('RECOMMENDATIONS_RETENTION_FAILED', { errorName: error instanceof Error ? error.name : 'unknown' });
    }
  }
}

export const recommendationService = new RecommendationService();
