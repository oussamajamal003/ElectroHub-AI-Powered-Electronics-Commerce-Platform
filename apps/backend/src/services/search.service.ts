import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { SearchInput } from '../validators/search.validator.js';
import { escapeLike, relevance, searchFrom, searchOrder, searchWhere } from './search.sql.js';

export interface SearchSuggestion { id: string; type: 'PRODUCT' | 'BRAND' | 'CATEGORY'; label: string; slug: string }
export type ProductListingProfile = Record<string, number>;

interface ProductRow {
  total: bigint;
  id: string | null;
  name: string | null;
  slug: string | null;
  price: string | null;
  compareAtPrice: string | null;
  description: string | null;
  quantity: number | null;
  category: { id: string; name: string; slug: string } | null;
  brand: { id: string; name: string; slug: string } | null;
  images: { id: string; url: string; altText: string | null; sortOrder: number; isPrimary: boolean }[] | null;
  reviewCount: bigint | null;
  averageRating: string | null;
}

function mapProductRow(row: ProductRow) {
  if (!row.id || !row.name || !row.slug || !row.price || !row.category) return null;
  const price = new Prisma.Decimal(row.price);
  const compareAtPrice = row.compareAtPrice === null ? null : new Prisma.Decimal(row.compareAtPrice);
  const images = row.images ?? [];
  return {
    id: row.id, name: row.name, slug: row.slug,
    price: price.toFixed(2), compareAtPrice: compareAtPrice?.toFixed(2) ?? null,
    currency: 'USD' as const, category: row.category, brand: row.brand,
    availability: row.quantity !== null && row.quantity > 0 ? 'AVAILABLE' as const : 'UNAVAILABLE' as const,
    discountPercent: compareAtPrice?.gt(price)
      ? compareAtPrice.minus(price).div(compareAtPrice).mul(100)
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber() : null,
    reviewCount: Number(row.reviewCount ?? 0), averageRating: row.averageRating,
    description: row.description?.slice(0, 160) ?? null,
    primaryImage: images[0] ?? null, secondaryImage: images[1] ?? null,
  };
}

export class SearchService {
  async products(input: SearchInput, profile?: ProductListingProfile, dealsOnly = false) {
    const buildStart = performance.now();
    const where = dealsOnly
      ? Prisma.sql`${searchWhere(input)} AND p."compareAtPrice" > p."price"`
      : searchWhere(input);
    const order = searchOrder(input);
    if (profile) profile.filterBuild = performance.now() - buildStart;
    const queryStart = performance.now();
    const rows = await prisma.$queryRaw<ProductRow[]>(Prisma.sql`
      WITH total AS (
        SELECT COUNT(*) AS total ${searchFrom} ${where}
      ), page AS (
        SELECT p."id", ROW_NUMBER() OVER (ORDER BY ${order}) AS ordinal
        ${searchFrom} ${where}
        ORDER BY ${order} LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
      ), rating AS (
        SELECT r."productId", COUNT(*) AS "reviewCount", ROUND(AVG(r."rating")::numeric, 1)::text AS "averageRating"
        FROM "reviews" r JOIN page ON page."id" = r."productId" GROUP BY r."productId"
      )
      SELECT total.total, p."id", p."name", p."slug", p."price"::text AS price,
        p."compareAtPrice"::text AS "compareAtPrice", p."description", i."quantity",
        jsonb_build_object('id', c."id", 'name', c."name", 'slug', c."slug") AS category,
        CASE WHEN b."id" IS NULL THEN NULL ELSE jsonb_build_object('id', b."id", 'name', b."name", 'slug', b."slug") END AS brand,
        images.images, rating."reviewCount", rating."averageRating"
      FROM total LEFT JOIN page ON true
      LEFT JOIN "products" p ON p."id" = page."id"
      LEFT JOIN "categories" c ON c."id" = p."categoryId"
      LEFT JOIN "brands" b ON b."id" = p."brandId"
      LEFT JOIN "inventory" i ON i."productId" = p."id"
      LEFT JOIN rating ON rating."productId" = p."id"
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(to_jsonb(img) ORDER BY img."isPrimary" DESC, img."sortOrder", img."id") AS images
        FROM (SELECT pi."id", pi."url", pi."altText", pi."position" AS "sortOrder", pi."isPrimary"
          FROM "product_images" pi WHERE pi."productId" = p."id"
          ORDER BY pi."isPrimary" DESC, pi."position", pi."id" LIMIT 2) img
      ) images ON true
      ORDER BY page.ordinal`);
    if (profile) profile.combinedQuery = performance.now() - queryStart;
    const mapStart = performance.now();
    const total = Number(rows[0]?.total ?? 0);
    const data = rows.map(mapProductRow).filter((product): product is NonNullable<typeof product> => product !== null);
    if (profile) profile.mapping = performance.now() - mapStart;
    return { data, meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) } };
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
        UNION ALL SELECT "id", 'CATEGORY', "name", "slug", 4 FROM "categories" WHERE "isActive" = true AND "name" ILIKE ${contains}
      ) suggestions ORDER BY rank ASC, LOWER("label") ASC, "type" ASC, "id" ASC LIMIT ${limit}`);
    return { data };
  }
}
