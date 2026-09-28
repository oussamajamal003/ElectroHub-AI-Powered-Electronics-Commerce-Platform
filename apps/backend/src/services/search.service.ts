import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { SearchInput } from '../validators/search.validator.js';
import { mapProductSummary, productSummarySelect, publicProductWhere } from './product.service.js';
import { escapeLike, relevance, searchFrom, searchOrder, searchWhere } from './search.sql.js';

export interface SearchSuggestion { id: string; type: 'PRODUCT' | 'BRAND' | 'CATEGORY'; label: string; slug: string }
export class SearchService {
  async products(input: SearchInput) {
    return prisma.$transaction(async transaction => {
      const where = searchWhere(input);
      const counts = await transaction.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS total ${searchFrom} ${where}`);
      const ids = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT p."id" ${searchFrom} ${where}
        ORDER BY ${searchOrder(input)} LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}`);
      const products = ids.length ? await transaction.product.findMany({
        where: { ...publicProductWhere, id: { in: ids.map(value => value.id) } }, select: productSummarySelect,
      }) : [];
      const byId = new Map(products.map(product => [product.id, mapProductSummary(product)]));
      const total = Number(counts[0].total);
      return { data: ids.map(value => byId.get(value.id)).filter(value => value !== undefined),
        meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 30000 });
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
