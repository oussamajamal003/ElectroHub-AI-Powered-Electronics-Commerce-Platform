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
      -- Only storefront-visible candidates compete for the LIMIT (hidden ones would be dropped at hydration).
      JOIN "products" p ON p."id" = l."productId" AND ${visibleProduct}
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
      pi."occurredAt" AS at
    FROM "product_interactions" pi
    JOIN "recommendation_preferences" rp ON rp."userId" = pi."userId" AND rp."personalizationEnabled"
    WHERE pi."occurredAt" > ${since} ${forUser(Prisma.sql`pi."userId"`)}
    UNION ALL
    SELECT wi."productId", w."userId", ${SIGNAL_WEIGHTS.WISHLIST}::float8, wi."createdAt"
    FROM "wishlist_items" wi JOIN "wishlists" w ON w."id" = wi."wishlistId"
    WHERE wi."createdAt" > ${since} ${forUser(Prisma.sql`w."userId"`)}
    UNION ALL
    SELECT ci."productId", c."userId", ${SIGNAL_WEIGHTS.CART}::float8, ci."updatedAt"
    FROM "cart_items" ci JOIN "carts" c ON c."id" = ci."cartId"
    WHERE ci."updatedAt" > ${since} ${forUser(Prisma.sql`c."userId"`)}
    UNION ALL
    SELECT oi."productId", q."userId", ${SIGNAL_WEIGHTS.PURCHASE}::float8, q."createdAt"
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

/** `score` is the decayed weight used for ranking; `evidence` is the undecayed weight used for the evidence threshold. */
export interface ProfileSignalRow { productId: string; score: number; evidence: number; lastAt: Date }

/** One customer's decayed, per-product summed signals over the window (strongest first), for the profile-v1 vector. */
export async function profileSignals(userId: string, windowDays: number, limit: number): Promise<ProfileSignalRow[]> {
  const rows = await prisma.$queryRaw<{ productId: string; score: number; evidence: number; lastAt: Date }[]>(Prisma.sql`
    WITH signals AS (${signals(windowDays, userId)})
    SELECT s."productId", SUM(s.weight * ${decay})::float8 AS score, SUM(s.weight)::float8 AS evidence, MAX(s.at) AS "lastAt"
    FROM signals s JOIN "products" p ON p."id" = s."productId"
    WHERE ${visibleProduct}
    GROUP BY s."productId"
    ORDER BY score DESC, s."productId" ASC
    LIMIT ${limit}`);
  return rows.map(row => ({ productId: row.productId, score: Number(row.score), evidence: Number(row.evidence), lastAt: row.lastAt }));
}
