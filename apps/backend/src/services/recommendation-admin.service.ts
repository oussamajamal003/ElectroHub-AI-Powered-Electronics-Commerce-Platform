import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { recordAdminAudit } from './admin-audit.js';
import { projectInventory } from './inventory.service.js';
import { publicProductWhere } from './product.service.js';
import { recommendationService, RETENTION_DAYS, type RecommendationSection, type RecommendationService } from './recommendation.service.js';
import {
  DEFAULT_SECTION_CONFIG, eligibilitySelect, FEATURED_MAX_PER_SURFACE, invalidateRecommendationConfig, IneligibleReason, pinState,
  PinState, PinSurface, RECOMMENDATION_DEFAULT_LIMIT, RECOMMENDATION_MAX_LIMIT, SECTION_MATRIX, sectionSpec, storefrontEligibility,
  type ConfigurableSurface, type SectionConfigRow, type SectionSpec,
} from './recommendation-config.js';

/**
 * Task 05.2 recommendation management. Administrators can narrow the engine (enable/disable a section, cap its size, pin
 * products into an explicit "Featured" placement); they cannot add strategies, change consent, or exceed the engine's
 * maximum. Every write is versioned, audited in the same transaction and followed by a configuration cache invalidation.
 */

export interface RecommendationActor { userId: string; requestId?: string }
export type RecommendationPeriod = '7d' | '30d' | '90d';
const PERIOD_DAYS: Record<RecommendationPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 };

const REASON_TEXT: Record<IneligibleReason, string> = {
  NOT_ACTIVE: 'the product is not active',
  TEST_FIXTURE: 'test fixtures cannot be featured',
  NOT_STOREFRONT_VISIBLE: 'the product is hidden from the storefront',
  CATEGORY_INACTIVE: 'its category is inactive',
  OUT_OF_STOCK: 'it is out of stock',
};

type PinWithProduct = Prisma.FeaturedProductPinGetPayload<{ include: { product: { select: typeof eligibilitySelect } } }>;

const versionConflict = (message: string) => new AppError(message, 409, 'VERSION_CONFLICT');
const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const iso = (value: Date | null | undefined) => value ? value.toISOString() : null;
const ctr = (impressions: number, clicks: number) => (impressions > 0 ? clicks / impressions : null);

function assertWindow(startsAt: Date | null | undefined, endsAt: Date | null | undefined) {
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new AppError('The end time must be after the start time.', 400, 'INVALID_PIN_SCHEDULE');
  }
}

function ineligibleMessage(reasons: IneligibleReason[]) {
  return `This product cannot be featured because ${reasons.map(reason => REASON_TEXT[reason]).join(', ')}.`;
}

function sectionView(spec: SectionSpec, row: { enabled: boolean; itemLimit: number; version: number; updatedAt: Date | null } | null) {
  const config: SectionConfigRow = row ?? DEFAULT_SECTION_CONFIG;
  return {
    surface: spec.surface,
    mode: spec.mode,
    enabled: config.enabled,
    itemLimit: config.itemLimit,
    defaultLimit: RECOMMENDATION_DEFAULT_LIMIT,
    maxLimit: RECOMMENDATION_MAX_LIMIT,
    version: config.version,
    /** False while no administrator has saved this section: the engine defaults apply. */
    configured: row !== null,
    updatedAt: iso(config.updatedAt),
    requiredContext: spec.requiredContext,
    requiredContextText: spec.requiredContextText,
    strategies: [...spec.strategies],
    fallbacks: [...spec.fallbacks],
  };
}

/** Preview output keeps the customer-facing shape but never carries a token: nothing from it can be recorded. */
function previewSection(section: RecommendationSection) {
  return {
    mode: section.mode,
    surface: section.surface,
    strategy: section.strategy,
    isPersonalized: section.isPersonalized,
    isFallback: section.isFallback,
    fallbackReason: section.fallbackReason,
    algorithmVersion: section.algorithmVersion,
    modelVersion: section.modelVersion,
    embeddingVersion: section.embeddingVersion,
    impressionToken: null,
    items: section.items.map(item => ({ rank: item.rank, featured: item.featured === true, eligible: true, product: item.product })),
  };
}

export class RecommendationAdminService {
  constructor(private readonly engine: RecommendationService = recommendationService) {}

  /** Every engine-supported section, with its saved settings (or the engine defaults when none were saved). */
  async configurations() {
    const rows = await prisma.recommendationSectionConfig.findMany();
    const byKey = new Map(rows.map(row => [`${row.surface}:${row.mode}`, row]));
    return SECTION_MATRIX.map(spec => sectionView(spec, byKey.get(`${spec.surface}:${spec.mode}`) ?? null));
  }

  async updateSection(surface: string, mode: string, input: { enabled?: boolean; itemLimit?: number; expectedVersion: number }, actor: RecommendationActor) {
    const spec = sectionSpec(surface, mode);
    if (!spec) throw new AppError('This recommendation section is not supported by the engine.', 400, 'UNSUPPORTED_RECOMMENDATION_SECTION');
    if (input.itemLimit !== undefined && (input.itemLimit < 1 || input.itemLimit > RECOMMENDATION_MAX_LIMIT)) {
      throw new AppError(`The item limit must be between 1 and ${RECOMMENDATION_MAX_LIMIT}.`, 400, 'INVALID_ITEM_LIMIT');
    }
    const row = await prisma.$transaction(async tx => {
      const current = await tx.recommendationSectionConfig.findUnique({ where: { surface_mode: { surface: spec.surface, mode: spec.mode } } });
      const currentVersion = current?.version ?? 0;
      if (input.expectedVersion !== currentVersion) {
        throw versionConflict('These settings changed since you loaded them. Reload to review the current values.');
      }
      const next = {
        enabled: input.enabled ?? current?.enabled ?? DEFAULT_SECTION_CONFIG.enabled,
        itemLimit: input.itemLimit ?? current?.itemLimit ?? DEFAULT_SECTION_CONFIG.itemLimit,
        updatedById: actor.userId,
      };
      let saved;
      if (current) {
        const result = await tx.recommendationSectionConfig.updateMany({
          where: { surface: spec.surface, mode: spec.mode, version: currentVersion },
          data: { ...next, version: { increment: 1 } },
        });
        if (result.count !== 1) throw versionConflict('These settings changed since you loaded them. Reload to review the current values.');
        saved = await tx.recommendationSectionConfig.findUniqueOrThrow({ where: { surface_mode: { surface: spec.surface, mode: spec.mode } } });
      } else {
        try {
          saved = await tx.recommendationSectionConfig.create({ data: { surface: spec.surface, mode: spec.mode, ...next, version: 1 } });
        } catch (error) {
          if (isUniqueViolation(error)) throw versionConflict('These settings were created by someone else. Reload to review the current values.');
          throw error;
        }
      }
      await recordAdminAudit({
        actorId: actor.userId, action: 'RECOMMENDATION_SECTION_UPDATED', resourceType: 'recommendation_section',
        resourceId: `${spec.surface}:${spec.mode}`, outcome: 'SUCCESS', requestId: actor.requestId,
        details: {
          surface: spec.surface, mode: spec.mode, previousVersion: currentVersion, version: saved.version,
          previousEnabled: current?.enabled ?? DEFAULT_SECTION_CONFIG.enabled, enabled: saved.enabled,
          previousItemLimit: current?.itemLimit ?? DEFAULT_SECTION_CONFIG.itemLimit, itemLimit: saved.itemLimit,
        },
      }, tx);
      return saved;
    });
    invalidateRecommendationConfig();
    return sectionView(spec, row);
  }

  async listPins(surface?: PinSurface, now = Date.now()) {
    const rows = await prisma.featuredProductPin.findMany({
      where: surface ? { surface } : undefined,
      orderBy: [{ surface: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
      include: { product: { select: eligibilitySelect } },
    });
    return rows.map(row => this.pinView(row, now));
  }

  async createPin(input: { productId: string; surface: PinSurface; position: number; startsAt: Date | null; endsAt: Date | null; enabled: boolean },
    actor: RecommendationActor, now = Date.now()) {
    assertWindow(input.startsAt, input.endsAt);
    const created = await prisma.$transaction(async tx => {
      // Serializes concurrent creates for one placement, so the per-surface cap cannot be exceeded by a race.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`featured_product_pins:${input.surface}`}))`);
      const product = await tx.product.findUnique({ where: { id: input.productId }, select: eligibilitySelect });
      if (!product) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
      const eligibility = storefrontEligibility(product);
      if (!eligibility.eligible) throw new AppError(ineligibleMessage(eligibility.reasons), 422, 'PRODUCT_NOT_ELIGIBLE');
      const existing = await tx.featuredProductPin.count({ where: { surface: input.surface } });
      if (existing >= FEATURED_MAX_PER_SURFACE) {
        throw new AppError(`This placement already holds ${FEATURED_MAX_PER_SURFACE} pins. Remove one before adding another.`, 409, 'FEATURED_LIMIT_REACHED');
      }
      let pin;
      try {
        pin = await tx.featuredProductPin.create({
          data: {
            productId: input.productId, surface: input.surface, position: input.position, startsAt: input.startsAt, endsAt: input.endsAt,
            enabled: input.enabled, createdById: actor.userId, updatedById: actor.userId,
          },
          include: { product: { select: eligibilitySelect } },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new AppError('This product is already pinned to this placement.', 409, 'PIN_EXISTS');
        throw error;
      }
      await recordAdminAudit({
        actorId: actor.userId, action: 'FEATURED_PIN_CREATED', resourceType: 'featured_product_pin', resourceId: pin.id,
        outcome: 'SUCCESS', requestId: actor.requestId,
        details: {
          productId: input.productId, surface: input.surface, position: input.position, enabled: input.enabled,
          startsAt: iso(input.startsAt), endsAt: iso(input.endsAt), version: pin.version,
        },
      }, tx);
      return pin;
    });
    invalidateRecommendationConfig();
    return this.pinView(created, now);
  }

  async updatePin(id: string, input: { expectedVersion: number; position?: number; startsAt?: Date | null; endsAt?: Date | null; enabled?: boolean },
    actor: RecommendationActor, now = Date.now()) {
    const row = await prisma.$transaction(async tx => {
      const current = await tx.featuredProductPin.findUnique({ where: { id }, include: { product: { select: eligibilitySelect } } });
      if (!current) throw new AppError('Pinned product not found.', 404, 'PIN_NOT_FOUND');
      if (current.version !== input.expectedVersion) {
        throw versionConflict('This pin changed since you loaded it. Reload to see its current state.');
      }
      const startsAt = input.startsAt !== undefined ? input.startsAt : current.startsAt;
      const endsAt = input.endsAt !== undefined ? input.endsAt : current.endsAt;
      assertWindow(startsAt, endsAt);
      const enabled = input.enabled ?? current.enabled;
      if (enabled && !current.enabled) {
        // Re-enabling is a write: the product must still be eligible, exactly as when it was first pinned.
        const eligibility = storefrontEligibility(current.product);
        if (!eligibility.eligible) throw new AppError(ineligibleMessage(eligibility.reasons), 422, 'PRODUCT_NOT_ELIGIBLE');
      }
      const position = input.position ?? current.position;
      const result = await tx.featuredProductPin.updateMany({
        where: { id, version: current.version },
        data: { position, startsAt, endsAt, enabled, updatedById: actor.userId, version: { increment: 1 } },
      });
      if (result.count !== 1) throw versionConflict('This pin changed since you loaded it. Reload to see its current state.');
      const saved = await tx.featuredProductPin.findUniqueOrThrow({ where: { id }, include: { product: { select: eligibilitySelect } } });
      await recordAdminAudit({
        actorId: actor.userId, action: 'FEATURED_PIN_UPDATED', resourceType: 'featured_product_pin', resourceId: id,
        outcome: 'SUCCESS', requestId: actor.requestId,
        details: {
          productId: current.productId, surface: current.surface, previousVersion: current.version, version: saved.version,
          position, previousEnabled: current.enabled, enabled, startsAt: iso(startsAt), endsAt: iso(endsAt),
        },
      }, tx);
      return saved;
    });
    invalidateRecommendationConfig();
    return this.pinView(row, now);
  }

  async deletePin(id: string, actor: RecommendationActor, expectedVersion?: number) {
    await prisma.$transaction(async tx => {
      const current = await tx.featuredProductPin.findUnique({ where: { id } });
      if (!current) throw new AppError('Pinned product not found.', 404, 'PIN_NOT_FOUND');
      if (expectedVersion !== undefined && expectedVersion !== current.version) {
        throw versionConflict('This pin changed since you loaded it. Reload to see its current state.');
      }
      const result = await tx.featuredProductPin.deleteMany({ where: { id, version: current.version } });
      if (result.count !== 1) throw versionConflict('This pin changed since you loaded it. Reload to see its current state.');
      await recordAdminAudit({
        actorId: actor.userId, action: 'FEATURED_PIN_DELETED', resourceType: 'featured_product_pin', resourceId: id,
        outcome: 'SUCCESS', requestId: actor.requestId,
        details: { productId: current.productId, surface: current.surface, position: current.position, version: current.version },
      }, tx);
    });
    invalidateRecommendationConfig();
  }

  /**
   * Bounded real activity from recorded (non-personal) attribution events. CTR is null when a group has no impressions.
   * Events are kept for RETENTION_DAYS, so no period can exceed that window. Conversion is reported in Analytics, not here.
   */
  async overview(period: RecommendationPeriod, surface?: ConfigurableSurface, now = Date.now()) {
    const since = new Date(now - PERIOD_DAYS[period] * 86_400_000);
    const rows = await prisma.$queryRaw<{ surface: string; mode: string; strategy: string; impressions: bigint; clicks: bigint }[]>(Prisma.sql`
      SELECT "surface", "mode", "strategy",
        COUNT(*) FILTER (WHERE "eventType" = 'IMPRESSION') AS impressions,
        COUNT(*) FILTER (WHERE "eventType" = 'CLICK') AS clicks
      FROM "recommendation_events"
      WHERE "occurredAt" >= ${since} ${surface ? Prisma.sql`AND "surface" = ${surface}` : Prisma.empty}
      GROUP BY "surface", "mode", "strategy"
      ORDER BY impressions DESC, "surface" ASC, "mode" ASC, "strategy" ASC`);
    const breakdown = rows.map(row => {
      const impressions = Number(row.impressions);
      const clicks = Number(row.clicks);
      return {
        surface: row.surface, mode: row.mode, strategy: row.strategy, impressions, clicks, ctr: ctr(impressions, clicks),
        fallback: row.strategy.startsWith('FALLBACK') || row.strategy === 'NO_DATA',
      };
    });
    const impressions = breakdown.reduce((sum, row) => sum + row.impressions, 0);
    const clicks = breakdown.reduce((sum, row) => sum + row.clicks, 0);
    const fallbackImpressions = breakdown.filter(row => row.fallback).reduce((sum, row) => sum + row.impressions, 0);

    const pins = await this.listPins(surface as PinSurface | undefined, now);
    const pinCounts: Record<PinState, number> = { ACTIVE: 0, SCHEDULED: 0, EXPIRED: 0, PAUSED: 0, INELIGIBLE: 0 };
    for (const pin of pins) pinCounts[pin.state] += 1;

    const [lastSection, lastPin] = await Promise.all([
      prisma.recommendationSectionConfig.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
      prisma.featuredProductPin.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    ]);
    const lastChange = [lastSection?.updatedAt, lastPin?.updatedAt].filter((value): value is Date => value instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    return {
      period,
      since: since.toISOString(),
      generatedAt: new Date(now).toISOString(),
      retentionDays: RETENTION_DAYS,
      totals: { impressions, clicks, ctr: ctr(impressions, clicks), fallbackImpressions, fallbackShare: impressions > 0 ? fallbackImpressions / impressions : null },
      breakdown,
      pins: pinCounts,
      lastConfigChangeAt: iso(lastChange),
    };
  }

  /**
   * Runs the real engine path with `preview: true`: no impression token is issued and no event, interaction, consent or
   * recently-viewed row is written. Personalized rails are not previewed, because they describe one customer's own activity.
   */
  async preview(input: { surface: ConfigurableSurface; productId?: string; cartProductIds?: string[]; limit: number }) {
    const { surface, limit } = input;
    let sections: RecommendationSection[];
    let context: { kind: string; text: string; productId?: string; productName?: string; productCount?: number };
    if (surface === 'home') {
      sections = [await this.engine.popular(limit, 'home', { preview: true })];
      context = { kind: 'ANONYMOUS_VISITOR', text: 'An anonymous visitor on the home page. Personalized rails are not previewed because they depend on one customer\'s own consented activity.' };
    } else if (surface === 'product_detail') {
      if (!input.productId) throw new AppError('Choose a product to preview this page.', 400, 'PREVIEW_PRODUCT_REQUIRED');
      const product = await prisma.product.findFirst({ where: { ...publicProductWhere, id: input.productId }, select: { id: true, name: true, slug: true } });
      if (!product) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
      sections = (await this.engine.productSections(product.slug, limit, undefined, { preview: true })).sections;
      context = { kind: 'ANCHOR_PRODUCT', text: 'The chosen product is the anchor, as it is for a shopper viewing that page.', productId: product.id, productName: product.name };
    } else {
      const ids = input.cartProductIds ?? [];
      if (ids.length === 0) throw new AppError('Choose at least one product for the synthetic cart.', 400, 'PREVIEW_CART_REQUIRED');
      sections = [await this.engine.forCart(ids, limit, { preview: true })];
      context = { kind: 'SYNTHETIC_CART', text: 'A synthetic cart made from the products you chose. No real cart is read or changed.', productCount: ids.length };
    }
    return {
      surface,
      limit,
      generatedAt: new Date().toISOString(),
      recorded: false as const,
      context,
      sections: sections.map(previewSection),
    };
  }

  private pinView(row: PinWithProduct, now: number) {
    const eligibility = storefrontEligibility(row.product);
    return {
      id: row.id,
      productId: row.productId,
      surface: row.surface as PinSurface,
      position: row.position,
      startsAt: iso(row.startsAt),
      endsAt: iso(row.endsAt),
      enabled: row.enabled,
      version: row.version,
      state: pinState(row, eligibility.eligible, now),
      eligible: eligibility.eligible,
      ineligibleReasons: eligibility.reasons,
      product: {
        id: row.product.id,
        name: row.product.name,
        sku: row.product.sku,
        slug: row.product.slug,
        status: row.product.status,
        stock: { quantity: row.product.inventory?.quantity ?? null, status: projectInventory(row.product.inventory).stockStatus },
      },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export const recommendationAdminService = new RecommendationAdminService();
