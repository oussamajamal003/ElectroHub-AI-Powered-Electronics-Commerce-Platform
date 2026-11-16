import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { SearchInput } from '../validators/search.validator.js';
import { categoryMixPage, escapeLike, relevance, searchFrom, searchOrder, searchWhere, storefrontVisibility } from './search.sql.js';
import { projectInventory } from './inventory.service.js';
import { decodeCursor, effectiveSort, encodeCursor, filterFingerprint, keyProjection, keysFromRow, seekPredicate, supportsKeyset,
  type KeysetRow } from './catalog-cursor.js';
import { AppError } from '../middleware/errorHandler.js';

export interface SearchSuggestion { id: string; type: 'PRODUCT' | 'BRAND' | 'CATEGORY'; label: string; slug: string }
export type ProductListingProfile = Record<string, number>;

interface ProductRow extends KeysetRow {
  total: bigint;
  id: string | null;
  name: string | null;
  slug: string | null;
  price: string | null;
  compareAtPrice: string | null;
  description: string | null;
  quantity: number | null;
  lowStockAt: number | null;
  category: { id: string; name: string; slug: string } | null;
  brand: { id: string; name: string; slug: string } | null;
  images: { id: string; url: string; altText: string | null; sortOrder: number; isPrimary: boolean }[] | null;
  reviewCount: bigint | null;
  averageRating: string | null;
}

/** Shared ProductSummary projection: the same columns, rating and primary-image joins for every product-card listing. */
const ratingCte = Prisma.sql`SELECT r."productId", COUNT(*) AS "reviewCount", ROUND(AVG(r."rating")::numeric, 1)::text AS "averageRating"
        FROM "reviews" r JOIN page ON page."id" = r."productId" GROUP BY r."productId"`;
const productSummaryColumns = Prisma.sql`p."id", p."name", p."slug", p."price"::text AS price,
        p."compareAtPrice"::text AS "compareAtPrice", p."description", i."quantity", i."lowStockAt",
        jsonb_build_object('id', c."id", 'name', c."name", 'slug', c."slug") AS category,
        CASE WHEN b."id" IS NULL THEN NULL ELSE jsonb_build_object('id', b."id", 'name', b."name", 'slug', b."slug") END AS brand,
        images.images, rating."reviewCount", rating."averageRating"`;
const productSummaryJoins = Prisma.sql`LEFT JOIN "products" p ON p."id" = page."id"
      LEFT JOIN "categories" c ON c."id" = p."categoryId"
      LEFT JOIN "brands" b ON b."id" = p."brandId"
      LEFT JOIN "inventory" i ON i."productId" = p."id"
      LEFT JOIN rating ON rating."productId" = p."id"
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(to_jsonb(img) ORDER BY img."isPrimary" DESC, img."sortOrder", img."id") AS images
        FROM (SELECT pi."id", pi."url", pi."altText", pi."position" AS "sortOrder", pi."isPrimary"
          FROM "product_images" pi WHERE pi."productId" = p."id" AND pi."mediaState" = 'PUBLISHED'
          ORDER BY pi."isPrimary" DESC, pi."position", pi."id" LIMIT 2) img
      ) images ON true`;

export function mapProductRow(row: Omit<ProductRow, 'total'>) {
  if (!row.id || !row.name || !row.slug || !row.price || !row.category) return null;
  const price = new Prisma.Decimal(row.price);
  const compareAtPrice = row.compareAtPrice === null ? null : new Prisma.Decimal(row.compareAtPrice);
  const images = row.images ?? [];
  return {
    id: row.id, name: row.name, slug: row.slug,
    price: price.toFixed(2), compareAtPrice: compareAtPrice?.toFixed(2) ?? null,
    currency: 'USD' as const, category: row.category, brand: row.brand,
    availability: projectInventory(row.quantity === null ? null : { quantity: row.quantity, lowStockAt: row.lowStockAt ?? 5 }).purchasable ? 'AVAILABLE' as const : 'UNAVAILABLE' as const,
    ...projectInventory(row.quantity === null ? null : { quantity: row.quantity, lowStockAt: row.lowStockAt ?? 5 }),
    discountPercent: compareAtPrice?.gt(price)
      ? compareAtPrice.minus(price).div(compareAtPrice).mul(100)
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber() : null,
    reviewCount: Number(row.reviewCount ?? 0), averageRating: row.averageRating,
    description: row.description?.slice(0, 160) ?? null,
    primaryImage: images[0] ?? null, secondaryImage: images[1] ?? null,
  };
}

export class SearchService {
  /**
   * Offset mode (default): bounded page/pageSize (page <= 100). The response also carries `nextCursor`/`hasNextPage` so a
   * client can continue past the offset cap with keyset pagination from exactly where this page ends.
   * Cursor mode (`paginate=cursor` or `cursor=`): keyset pagination, no OFFSET at any depth. See catalog-cursor.ts.
   */
  async products(input: SearchInput, profile?: ProductListingProfile, dealsOnly = false) {
    if (input.paginate === 'cursor' || input.cursor !== undefined) return this.productsByCursor(input, dealsOnly);
    const buildStart = performance.now();
    const where = dealsOnly
      ? Prisma.sql`${searchWhere(input)} AND p."compareAtPrice" > p."price"`
      : searchWhere(input);
    const order = searchOrder(input);
    const sort = effectiveSort(input);
    if (profile) profile.filterBuild = performance.now() - buildStart;
    const queryStart = performance.now();
    const rows = await prisma.$queryRaw<ProductRow[]>(Prisma.sql`
      WITH total AS (
        SELECT COUNT(*) AS total ${searchFrom} ${where}
      ), page AS (${input.sort === 'category-mix'
        ? categoryMixPage(where, input.pageSize, (input.page - 1) * input.pageSize)
        : Prisma.sql`
        SELECT p."id", ROW_NUMBER() OVER (ORDER BY ${order}) AS ordinal, ${keyProjection(sort, input.q)}
        ${searchFrom} ${where}
        ORDER BY ${order} LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}`}
      ), rating AS (${ratingCte})
      SELECT total.total, ${productSummaryColumns}${input.sort === 'category-mix' ? Prisma.empty : Prisma.sql`, page."kCreatedAt", page."kId", page."kPrice", page."kName", page."kRank"`}
      FROM total LEFT JOIN page ON true
      ${productSummaryJoins}
      ORDER BY page.ordinal`);
    if (profile) profile.combinedQuery = performance.now() - queryStart;
    const mapStart = performance.now();
    const total = Number(rows[0]?.total ?? 0);
    const data = rows.map(mapProductRow).filter((product): product is NonNullable<typeof product> => product !== null);
    const hasNextPage = input.page * input.pageSize < total;
    const last = rows[rows.length - 1];
    const keys = hasNextPage && last && supportsKeyset(sort) ? keysFromRow(sort, last) : null;
    const nextCursor = keys && supportsKeyset(sort) ? encodeCursor(sort, keys, filterFingerprint(input, sort, dealsOnly)) : null;
    if (profile) profile.mapping = performance.now() - mapStart;
    return { data, meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize), hasNextPage, nextCursor } };
  }

  private async productsByCursor(input: SearchInput, dealsOnly: boolean) {
    const sort = effectiveSort(input);
    if (!supportsKeyset(sort)) {
      throw new AppError('Cursor pagination is not available for the category-mix order. Use page-based pagination or another sort.', 400, 'CURSOR_UNSUPPORTED_SORT');
    }
    const fingerprint = filterFingerprint(input, sort, dealsOnly);
    const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor, sort, fingerprint);
    const base = dealsOnly ? Prisma.sql`${searchWhere(input)} AND p."compareAtPrice" > p."price"` : searchWhere(input);
    const where = cursor ? Prisma.sql`${base} AND ${seekPredicate(cursor, input.q)}` : base;
    const order = searchOrder(input);
    // pageSize + 1 rows: the extra row only proves another page exists; it is never returned.
    const rows = await prisma.$queryRaw<ProductRow[]>(Prisma.sql`
      WITH page AS (
        SELECT p."id", ROW_NUMBER() OVER (ORDER BY ${order}) AS ordinal, ${keyProjection(sort, input.q)}
        ${searchFrom} ${where}
        ORDER BY ${order} LIMIT ${input.pageSize + 1}
      ), rating AS (${ratingCte})
      SELECT 0::bigint AS total, ${productSummaryColumns}, page."kCreatedAt", page."kId", page."kPrice", page."kName", page."kRank"
      FROM page
      ${productSummaryJoins}
      ORDER BY page.ordinal`);
    const hasNextPage = rows.length > input.pageSize;
    const pageRows = rows.slice(0, input.pageSize);
    const last = pageRows[pageRows.length - 1];
    const keys = hasNextPage && last ? keysFromRow(sort, last) : null;
    // The (expensive) total is computed only for the first cursor page, where a client shows "N products".
    const total = cursor ? null : Number((await prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS total ${searchFrom} ${base}`))[0]?.total ?? 0);
    return {
      data: pageRows.map(mapProductRow).filter((product): product is NonNullable<typeof product> => product !== null),
      meta: { pageSize: input.pageSize, total, hasNextPage, nextCursor: keys ? encodeCursor(sort, keys, fingerprint) : null },
    };
  }

  /**
   * Task 04.2: resolves AI-ranked product ids in ONE bounded query that applies the same storefront visibility rule and
   * ProductSummary mapping as /api/search/products. Returned rows follow the input order; hidden, inactive, test-fixture,
   * deleted or unknown ids are simply absent. Prices and stock always come from the database.
   */
  async productSummariesByIds(orderedIds: readonly string[]) {
    if (orderedIds.length === 0) return [];
    const rows = await prisma.$queryRaw<Omit<ProductRow, 'total'>[]>(Prisma.sql`
      WITH page AS (
        SELECT p."id", ROW_NUMBER() OVER (ORDER BY array_position(${[...orderedIds]}::uuid[], p."id")) AS ordinal
        ${searchFrom}
        WHERE ${storefrontVisibility} AND p."id" = ANY(${[...orderedIds]}::uuid[])
      ), rating AS (${ratingCte})
      SELECT ${productSummaryColumns}
      FROM page
      ${productSummaryJoins}
      ORDER BY page.ordinal`);
    const position = new Map(orderedIds.map((id, index) => [id, index]));
    return rows
      .map(mapProductRow)
      .filter((product): product is NonNullable<typeof product> => product !== null && position.has(product.id))
      .sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
  }

  async suggestions(query: string, limit: number): Promise<{ data: SearchSuggestion[] }> {
    const contains = `%${escapeLike(query)}%`;
    const productInput = { q: query, page: 1, pageSize: limit } as SearchInput;
    const data = await prisma.$queryRaw<SearchSuggestion[]>(Prisma.sql`
      SELECT "id", "type", "label", "slug" FROM (
        SELECT productMatches."id", 'PRODUCT' AS "type", productMatches."label", productMatches."slug", productMatches.rank
          FROM (SELECT p."id", p."name" AS "label", p."slug", ${relevance(query)} AS rank
            ${searchFrom} ${searchWhere(productInput)} ORDER BY rank ASC, p."createdAt" DESC, p."id" ASC LIMIT ${limit}) productMatches
        UNION ALL SELECT "id", 'BRAND', "name", "slug", 3 FROM "brands" WHERE "name" ILIKE ${contains}
        UNION ALL SELECT c."id", 'CATEGORY', c."name", c."slug", 4 FROM "categories" c
          WHERE c."isActive" = true AND c."name" ILIKE ${contains} AND EXISTS (
            SELECT 1 FROM "products" p
            WHERE p."categoryId" = c."id" AND p."status" = 'ACTIVE' AND p."isTestFixture" = false AND p."storefrontVisible" = true
          )
      ) suggestions ORDER BY rank ASC, LOWER("label") ASC, "type" ASC, "id" ASC LIMIT ${limit}`);
    return { data };
  }
}
