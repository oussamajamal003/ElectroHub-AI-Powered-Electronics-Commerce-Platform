import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * Task 04.4 aggregates over authoritative commerce and consented activity tables. Every value is a bound parameter;
 * every result is an advisory product id that the service still hydrates through the public catalog projection.
 */

/** A purchase counts only when it was paid, never refunded, and the order was not cancelled or still awaiting capture. */
export const QUALIFYING_ORDER_STATUSES = ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;
const qualifyingOrders = Prisma.sql`
  SELECT o."id", o."userId", o."createdAt" FROM "orders" o
  JOIN "payments" pay ON pay."orderId" = o."id"
  WHERE pay."status" = 'SUCCEEDED' AND pay."refundedAt" IS NULL
    AND o."status"::text IN (${Prisma.join([...QUALIFYING_ORDER_STATUSES])})`;
const visibleProduct = Prisma.sql`p."status" = 'ACTIVE' AND p."isTestFixture" = false AND p."storefrontVisible" = true`;

export interface CoPurchaseRow { productId: string; support: number; confidence: number; lift: number }

/**
 * Distinct qualifying orders that contain any anchor AND the candidate (quantities are not votes). Confidence is
 * support / orders containing an anchor; lift divides it by the candidate's share of all qualifying orders.
 */
export async function coPurchases(anchorIds: readonly string[], minSupport: number, limit: number): Promise<CoPurchaseRow[]> {
  if (anchorIds.length === 0) return [];
  const anchors = [...anchorIds];
  const rows = await prisma.$queryRaw<{ productId: string; support: bigint; anchorOrders: bigint; productOrders: bigint; totalOrders: bigint }[]>(Prisma.sql`
    WITH qualifying AS (${qualifyingOrders}),
    lines AS (
      SELECT DISTINCT oi."orderId", oi."productId" FROM "order_items" oi
      JOIN qualifying q ON q."id" = oi."orderId"
      JOIN "products" p ON p."id" = oi."productId"
      WHERE p."isTestFixture" = false
    ),
    anchor_orders AS (SELECT DISTINCT "orderId" FROM lines WHERE "productId" = ANY(${anchors}::uuid[])),
    pairs AS (
      SELECT l."productId", COUNT(DISTINCT l."orderId") AS support
      FROM lines l JOIN anchor_orders a ON a."orderId" = l."orderId"
      -- Only candidates that can be shown compete for the LIMIT: storefront-visible and in stock (the same rule as
      -- purchasable), otherwise unavailable products would take slots and be dropped at hydration.
      JOIN "products" p ON p."id" = l."productId" AND ${visibleProduct}
      JOIN "inventory" inv ON inv."productId" = p."id" AND inv."quantity" > 0
      WHERE NOT (l."productId" = ANY(${anchors}::uuid[]))
      GROUP BY l."productId"
    ),
    product_orders AS (
      SELECT "productId", COUNT(DISTINCT "orderId") AS orders FROM lines
      WHERE "productId" IN (SELECT "productId" FROM pairs) GROUP BY "productId"
    )
    SELECT pairs."productId", pairs.support, (SELECT COUNT(*) FROM anchor_orders) AS "anchorOrders",
      po.orders AS "productOrders", (SELECT COUNT(DISTINCT "orderId") FROM lines) AS "totalOrders"
    FROM pairs JOIN product_orders po ON po."productId" = pairs."productId"
    WHERE pairs.support >= ${minSupport}
    ORDER BY pairs.support DESC, po.orders ASC, pairs."productId" ASC
    LIMIT ${limit}`);
  return rows.map(row => {
    const confidence = Number(row.support) / Math.max(1, Number(row.anchorOrders));
    const share = Number(row.productOrders) / Math.max(1, Number(row.totalOrders));
    return { productId: row.productId, support: Number(row.support), confidence, lift: share > 0 ? confidence / share : 0 };
  });
}

/**
 * Signal weights of feature spec profile-v1 (hyperparameters evaluated offline, not purchase probabilities). Shared by
 * measured popularity and the personal profile so both read demand the same way.
 */
export const SIGNAL_WEIGHTS = { VIEW: 1, RECOMMENDATION_CLICK: 1.5, CART: 2, WISHLIST: 3, PURCHASE: 4 } as const;
export const SIGNAL_HALF_LIFE_DAYS = 14;

function signals(windowDays: number, userId?: string) {
  const since = Prisma.sql`now() - make_interval(days => ${windowDays})`;
  const forUser = (column: Prisma.Sql) => (userId ? Prisma.sql`AND ${column} = ${userId}::uuid` : Prisma.empty);
  return Prisma.sql`
    SELECT pi."productId", pi."userId",
      CASE pi."eventType" WHEN 'VIEW' THEN ${SIGNAL_WEIGHTS.VIEW} ELSE ${SIGNAL_WEIGHTS.RECOMMENDATION_CLICK} END::float8 AS weight,
      pi."occurredAt" AS at, true AS browsing
    FROM "product_interactions" pi
    JOIN "recommendation_preferences" rp ON rp."userId" = pi."userId" AND rp."personalizationEnabled"
    WHERE pi."occurredAt" > ${since} ${forUser(Prisma.sql`pi."userId"`)}
    UNION ALL
    SELECT wi."productId", w."userId", ${SIGNAL_WEIGHTS.WISHLIST}::float8, wi."createdAt", false
    FROM "wishlist_items" wi JOIN "wishlists" w ON w."id" = wi."wishlistId"
    WHERE wi."createdAt" > ${since} ${forUser(Prisma.sql`w."userId"`)}
    UNION ALL
    SELECT ci."productId", c."userId", ${SIGNAL_WEIGHTS.CART}::float8, ci."updatedAt", false
    FROM "cart_items" ci JOIN "carts" c ON c."id" = ci."cartId"
    WHERE ci."updatedAt" > ${since} ${forUser(Prisma.sql`c."userId"`)}
    UNION ALL
    SELECT oi."productId", q."userId", ${SIGNAL_WEIGHTS.PURCHASE}::float8, q."createdAt", false
    FROM "order_items" oi JOIN (${qualifyingOrders}) q ON q."id" = oi."orderId"
    WHERE q."createdAt" > ${since} ${forUser(Prisma.sql`q."userId"`)}`;
}
const decay = Prisma.sql`exp(-ln(2) * extract(epoch FROM (now() - at)) / ${SIGNAL_HALF_LIFE_DAYS * 86400})`;

export interface PopularityRow { productId: string; score: number; users: number }
export interface Popularity { rows: PopularityRow[]; contributingUsers: number }

/**
 * Measured demand over a window: one value per (customer, product) = that customer's strongest decayed signal, so
 * repeat clicks or one account cannot inflate a product; a product needs `minUsers` distinct customers.
 */
export async function measuredPopularity(windowDays: number, minUsers: number, limit: number): Promise<Popularity> {
  const rows = await prisma.$queryRaw<{ productId: string; score: number; users: bigint; totalUsers: bigint }[]>(Prisma.sql`
    WITH signals AS (${signals(windowDays)}),
    per_user AS (
      SELECT "productId", "userId", MAX(weight * ${decay}) AS score FROM signals GROUP BY "productId", "userId"
    ),
    per_product AS (SELECT "productId", SUM(score) AS score, COUNT(*) AS users FROM per_user GROUP BY "productId")
    SELECT pp."productId", pp.score::float8 AS score, pp.users, (SELECT COUNT(DISTINCT "userId") FROM per_user) AS "totalUsers"
    FROM per_product pp JOIN "products" p ON p."id" = pp."productId"
    WHERE ${visibleProduct} AND pp.users >= ${minUsers}
    ORDER BY pp.score DESC, pp."productId" ASC
    LIMIT ${limit}`);
  const contributingUsers = rows.length > 0 ? Number(rows[0].totalUsers) : await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    WITH signals AS (${signals(windowDays)}) SELECT COUNT(DISTINCT "userId") AS count FROM signals`).then(result => Number(result[0]?.count ?? 0));
  return { rows: rows.map(row => ({ productId: row.productId, score: Number(row.score), users: Number(row.users) })), contributingUsers };
}

/**
 * `score` is the decayed weight used for ranking; `evidence` is the undecayed weight used for the evidence threshold;
 * `recent` is the short-horizon browsing interest (views and recommendation clicks in the last RECENT_INTEREST days,
 * one-day half-life), 0 for a product with no recent browsing.
 */
export interface ProfileSignalRow { productId: string; score: number; evidence: number; recent: number; lastAt: Date }

/** Short horizon of the two-horizon profile: what the customer is browsing now, next to the long-term profile. */
export const RECENT_INTEREST = { windowDays: 3, halfLifeDays: 1, maxSignals: 20 } as const;

/**
 * One customer's decayed, per-product summed signals over the window, in one statement: the `limit` strongest
 * long-horizon rows plus up to RECENT_INTEREST.maxSignals recently browsed rows, so a heavy purchase history can
 * never truncate the products the customer is exploring now.
 */
export async function profileSignals(userId: string, windowDays: number, limit: number): Promise<ProfileSignalRow[]> {
  const recentAge = Prisma.sql`extract(epoch FROM (now() - s.at))`;
  const rows = await prisma.$queryRaw<{ productId: string; score: number; evidence: number; recent: number; lastAt: Date }[]>(Prisma.sql`
    WITH signals AS (${signals(windowDays, userId)}),
    per_product AS (
      SELECT s."productId", SUM(s.weight * ${decay})::float8 AS score, SUM(s.weight)::float8 AS evidence, MAX(s.at) AS "lastAt",
        COALESCE(SUM(s.weight * exp(-ln(2) * ${recentAge} / ${RECENT_INTEREST.halfLifeDays * 86400}))
          FILTER (WHERE s.browsing AND ${recentAge} <= ${RECENT_INTEREST.windowDays * 86400}), 0)::float8 AS recent
      FROM signals s JOIN "products" p ON p."id" = s."productId"
      WHERE ${visibleProduct}
      GROUP BY s."productId"
    ),
    ranked AS (
      SELECT *, row_number() OVER (ORDER BY score DESC, "productId" ASC) AS score_rank,
        row_number() OVER (ORDER BY recent DESC, "productId" ASC) AS recent_rank
      FROM per_product
    )
    SELECT "productId", score, evidence, recent, "lastAt" FROM ranked
    WHERE score_rank <= ${limit} OR (recent > 0 AND recent_rank <= ${RECENT_INTEREST.maxSignals})
    ORDER BY score DESC, "productId" ASC`);
  return rows.map(row => ({ productId: row.productId, score: Number(row.score), evidence: Number(row.evidence),
    recent: Number(row.recent), lastAt: row.lastAt }));
}
