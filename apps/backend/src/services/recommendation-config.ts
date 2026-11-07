import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { projectInventory } from './inventory.service.js';

/**
 * Task 05.2 recommendation management: the engine's supported section matrix, the administrator configuration and pin
 * snapshot that the public recommendation service applies, and the storefront eligibility rule shared by pin writes.
 *
 * Configuration can narrow what the engine already does (disable a rail, cap its size, pin products into a
 * non-personalized rail). It can never add a strategy, bypass consent, or exceed the engine's maximum.
 */

export const RECOMMENDATION_DEFAULT_LIMIT = 4;
export const RECOMMENDATION_MAX_LIMIT = 12;
/** Admin edits take effect in the writing process immediately; other instances converge within this window. */
export const RECOMMENDATION_CONFIG_TTL_MS = 30_000;
export const FEATURED_MAX_PER_SURFACE = 8;

export type ConfigurableSurface = 'home' | 'product_detail' | 'cart';
export type PinSurface = ConfigurableSurface;
export type ConfigurableMode = 'SIMILAR_PRODUCTS' | 'YOU_MAY_ALSO_LIKE' | 'RECOMMENDED_FOR_YOU' | 'FREQUENTLY_BOUGHT_TOGETHER' | 'POPULAR_PRODUCTS';

export interface SectionSpec {
  surface: ConfigurableSurface;
  mode: ConfigurableMode;
  /** Strategies the engine can serve for this section. */
  strategies: readonly string[];
  /** Fallbacks the engine uses on its own when the primary strategy has no data. Administrators cannot choose them. */
  fallbacks: readonly string[];
  requiredContext: 'anchor' | 'cart' | 'consent' | 'none';
  requiredContextText: string;
}

/** Derived from apps/backend/src/services/recommendation.service.ts (productSections, popular, forUser, forCart). */
export const SECTION_MATRIX: readonly SectionSpec[] = [
  { surface: 'home', mode: 'POPULAR_PRODUCTS', strategies: ['MEASURED_POPULARITY'], fallbacks: ['FALLBACK_NEW_ARRIVALS'],
    requiredContext: 'none', requiredContextText: 'Anyone, including anonymous visitors. Measured demand over 30 days, otherwise new arrivals.' },
  { surface: 'home', mode: 'RECOMMENDED_FOR_YOU', strategies: ['BEHAVIOR_EMBEDDING'], fallbacks: ['FALLBACK_POPULAR', 'FALLBACK_NEW_ARRIVALS'],
    requiredContext: 'consent', requiredContextText: 'Signed-in customers who opted in to personalization with enough activity. Others get the popular fallback, never a personalized label.' },
  { surface: 'product_detail', mode: 'SIMILAR_PRODUCTS', strategies: ['EMBEDDING_SIMILARITY'], fallbacks: ['FALLBACK_CATEGORY'],
    requiredContext: 'anchor', requiredContextText: 'The product being viewed. Falls back to newest products in its category when the image index cannot answer.' },
  { surface: 'product_detail', mode: 'YOU_MAY_ALSO_LIKE', strategies: ['HYBRID_EMBEDDING'], fallbacks: [],
    requiredContext: 'anchor', requiredContextText: 'The product being viewed. Hidden when fewer than two products qualify; no fallback.' },
  { surface: 'product_detail', mode: 'FREQUENTLY_BOUGHT_TOGETHER', strategies: ['CO_PURCHASE'], fallbacks: [],
    requiredContext: 'anchor', requiredContextText: 'The product being viewed. Real qualifying co-purchases only; no fallback.' },
  { surface: 'cart', mode: 'FREQUENTLY_BOUGHT_TOGETHER', strategies: ['CO_PURCHASE'], fallbacks: [],
    requiredContext: 'cart', requiredContextText: 'Cart contents as context only. Real qualifying co-purchases; no fallback.' },
];

export function sectionSpec(surface: string, mode: string): SectionSpec | undefined {
  return SECTION_MATRIX.find(spec => spec.surface === surface && spec.mode === mode);
}

export interface SectionConfigRow { enabled: boolean; itemLimit: number; version: number; updatedAt: Date | null }

/** Absent row = engine default: enabled, with no administrator cap below the engine maximum. */
export const DEFAULT_SECTION_CONFIG: SectionConfigRow = { enabled: true, itemLimit: RECOMMENDATION_MAX_LIMIT, version: 0, updatedAt: null };

export interface PinRecord {
  id: string;
  productId: string;
  surface: PinSurface;
  position: number;
  startsAt: Date | null;
  endsAt: Date | null;
  enabled: boolean;
  version: number;
}

export interface RecommendationConfigSnapshot {
  sections: Map<string, SectionConfigRow>;
  /** Enabled pins only, ordered by position. Time windows are evaluated per request, never frozen into the cache. */
  pins: PinRecord[];
}

const sectionKey = (surface: string, mode: string) => `${surface}:${mode}`;

export function sectionConfigOf(snapshot: RecommendationConfigSnapshot, surface: string, mode: string): SectionConfigRow {
  return snapshot.sections.get(sectionKey(surface, mode)) ?? DEFAULT_SECTION_CONFIG;
}

export function isPinInWindow(pin: Pick<PinRecord, 'startsAt' | 'endsAt'>, now: number): boolean {
  return (!pin.startsAt || pin.startsAt.getTime() <= now) && (!pin.endsAt || pin.endsAt.getTime() > now);
}

export type PinState = 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'PAUSED' | 'INELIGIBLE';

/** Administrator-facing state. Paused and expired win over eligibility so the reason shown is the one an editor can act on. */
export function pinState(pin: Pick<PinRecord, 'enabled' | 'startsAt' | 'endsAt'>, eligible: boolean, now: number): PinState {
  if (!pin.enabled) return 'PAUSED';
  if (pin.endsAt && pin.endsAt.getTime() <= now) return 'EXPIRED';
  if (pin.startsAt && pin.startsAt.getTime() > now) return 'SCHEDULED';
  return eligible ? 'ACTIVE' : 'INELIGIBLE';
}

export type IneligibleReason = 'NOT_ACTIVE' | 'TEST_FIXTURE' | 'NOT_STOREFRONT_VISIBLE' | 'CATEGORY_INACTIVE' | 'OUT_OF_STOCK';

export interface EligibilityFacts {
  status: string;
  isTestFixture: boolean;
  storefrontVisible: boolean;
  category: { isActive: boolean };
  inventory: { quantity: number; lowStockAt: number } | null;
}

/**
 * The storefront predicate behind every recommendation item (search.sql storefrontVisibility plus inventory purchasable),
 * expressed over one loaded product so pin writes and pin listings apply what the engine applies at serving time.
 */
export function storefrontEligibility(facts: EligibilityFacts): { eligible: boolean; reasons: IneligibleReason[] } {
  const reasons: IneligibleReason[] = [];
  if (facts.status !== 'ACTIVE') reasons.push('NOT_ACTIVE');
  if (facts.isTestFixture) reasons.push('TEST_FIXTURE');
  if (!facts.storefrontVisible) reasons.push('NOT_STOREFRONT_VISIBLE');
  if (!facts.category.isActive) reasons.push('CATEGORY_INACTIVE');
  if (!projectInventory(facts.inventory).purchasable) reasons.push('OUT_OF_STOCK');
  return { eligible: reasons.length === 0, reasons };
}

export const eligibilitySelect = {
  id: true, name: true, sku: true, slug: true, status: true, isTestFixture: true, storefrontVisible: true,
  category: { select: { isActive: true } },
  inventory: { select: { quantity: true, lowStockAt: true } },
} as const;

// ─── Snapshot cache ──────────────────────────────────────────────────────────
let cache: { at: number; value: RecommendationConfigSnapshot } | null = null;
let generation = 0;
let loading: { generation: number; promise: Promise<RecommendationConfigSnapshot> } | null = null;

const EMPTY_SNAPSHOT: RecommendationConfigSnapshot = { sections: new Map(), pins: [] };

/** Called by every administrator write after it commits. */
export function invalidateRecommendationConfig() {
  generation += 1;
  cache = null;
  loading = null;
}

async function readSnapshot(): Promise<RecommendationConfigSnapshot> {
  const [sectionRows, pinRows] = await Promise.all([
    prisma.recommendationSectionConfig.findMany({ select: { surface: true, mode: true, enabled: true, itemLimit: true, version: true, updatedAt: true } }),
    prisma.featuredProductPin.findMany({
      where: { enabled: true }, orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true, productId: true, surface: true, position: true, startsAt: true, endsAt: true, enabled: true, version: true },
    }),
  ]);
  return {
    sections: new Map(sectionRows.map(row => [sectionKey(row.surface, row.mode), {
      enabled: row.enabled, itemLimit: row.itemLimit, version: row.version, updatedAt: row.updatedAt,
    }])),
    pins: pinRows.map(row => ({ ...row, surface: row.surface as PinSurface })),
  };
}

/**
 * The configuration the storefront applies. A read failure degrades to engine defaults (rails as the engine serves them
 * without administrator changes) and is logged. Failures are not cached, so the next request retries.
 */
export async function recommendationConfig(now = Date.now()): Promise<RecommendationConfigSnapshot> {
  if (cache && now - cache.at < RECOMMENDATION_CONFIG_TTL_MS) return cache.value;
  if (!loading || loading.generation !== generation) {
    const started = generation;
    const entry: { generation: number; promise: Promise<RecommendationConfigSnapshot> } = { generation: started, promise: Promise.resolve(EMPTY_SNAPSHOT) };
    entry.promise = readSnapshot().then(
      value => {
        if (started === generation) cache = { at: Date.now(), value };
        if (loading === entry) loading = null;
        return value;
      },
      error => {
        if (loading === entry) loading = null;
        logger.warn('RECOMMENDATION_CONFIG_UNAVAILABLE', { operation: 'recommendations', error: error instanceof Error ? error.name : 'unknown' });
        return EMPTY_SNAPSHOT;
      },
    );
    loading = entry;
  }
  return loading.promise;
}
