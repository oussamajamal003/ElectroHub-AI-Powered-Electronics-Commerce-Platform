import { Prisma } from '@prisma/client';
import type { SearchInput } from '../validators/search.validator.js';

export const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');
export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fields = [Prisma.sql`p."name"`, Prisma.sql`p."sku"`, Prisma.sql`p."modelNumber"`,
  Prisma.sql`p."description"`, Prisma.sql`b."name"`, Prisma.sql`c."name"`];
export const searchFrom = Prisma.sql`FROM "products" p JOIN "categories" c ON c."id" = p."categoryId"
  LEFT JOIN "brands" b ON b."id" = p."brandId" LEFT JOIN "inventory" i ON i."productId" = p."id"`;
export function searchWhere(input: SearchInput) {
  const clauses = [Prisma.sql`p."status" = 'ACTIVE' AND c."isActive" = true`];
  for (const token of input.q.split(' ').filter(Boolean)) {
    const specificationMatch = token.length < 3
      ? Prisma.sql`EXISTS (SELECT 1 FROM "product_specifications" ps WHERE ps."productId" = p."id" AND (ps."group" ~* ${`(^|[^[:alpha:]])${escapeRegex(token)}([^[:alpha:]]|$)`} OR ps."name" ~* ${`(^|[^[:alpha:]])${escapeRegex(token)}([^[:alpha:]]|$)`} OR ps."value" ~* ${`(^|[^[:alpha:]])${escapeRegex(token)}([^[:alpha:]]|$)`}))`
      : Prisma.sql`EXISTS (SELECT 1 FROM "product_specifications" ps WHERE ps."productId" = p."id" AND (ps."group" ILIKE ${`%${escapeLike(token)}%`} OR ps."name" ILIKE ${`%${escapeLike(token)}%`} OR ps."value" ILIKE ${`%${escapeLike(token)}%`}))`;
    const matches = token.length < 3
      ? Prisma.sql`(${Prisma.join(fields.map(field => Prisma.sql`${field} ~* ${`(^|[^[:alpha:]])${escapeRegex(token)}([^[:alpha:]]|$)`}`).concat(specificationMatch), ' OR ')})`
      : Prisma.sql`(${Prisma.join(fields.map(field => Prisma.sql`${field} ILIKE ${`%${escapeLike(token)}%`}`).concat(specificationMatch), ' OR ')})`;
    clauses.push(matches);
  }
  if (input.category) clauses.push(Prisma.sql`c."slug" = ${input.category}`);
  if (input.brand) clauses.push(Prisma.sql`b."slug" = ${input.brand}`);
  if (input.availability === 'available') clauses.push(Prisma.sql`COALESCE(i."quantity", 0) > 0`);
  if (input.availability === 'unavailable') clauses.push(Prisma.sql`COALESCE(i."quantity", 0) <= 0`);
  if (input.minPrice !== undefined) clauses.push(Prisma.sql`p."price" >= ${new Prisma.Decimal(input.minPrice)}`);
  if (input.maxPrice !== undefined) clauses.push(Prisma.sql`p."price" <= ${new Prisma.Decimal(input.maxPrice)}`);
  return Prisma.sql`WHERE ${Prisma.join(clauses, ' AND ')}`;
}
export function relevance(query: string) {
  const exact = query.toLowerCase();
  const prefix = `${escapeLike(query)}%`;
  const contains = `%${escapeLike(query)}%`;
  return Prisma.sql`CASE
    WHEN LOWER(p."name") = ${exact} OR LOWER(p."sku") = ${exact} OR LOWER(p."modelNumber") = ${exact} THEN 0
    WHEN p."name" ILIKE ${prefix} THEN 1
    WHEN p."name" ILIKE ${contains} THEN 2
    WHEN p."sku" ILIKE ${contains} OR p."modelNumber" ILIKE ${contains} THEN 3
    WHEN b."name" ILIKE ${contains} OR c."name" ILIKE ${contains} THEN 4
    WHEN p."description" ILIKE ${contains} THEN 5
    WHEN EXISTS (SELECT 1 FROM "product_specifications" ps WHERE ps."productId" = p."id" AND (ps."group" ILIKE ${contains} OR ps."name" ILIKE ${contains} OR ps."value" ILIKE ${contains})) THEN 6 ELSE 7 END`;
}
export function searchOrder(input: SearchInput) {
  const sort = input.sort ?? (input.q ? 'relevance' : 'newest');
  if (sort === 'price-asc') return Prisma.sql`p."price" ASC, p."createdAt" DESC, p."id" ASC`;
  if (sort === 'price-desc') return Prisma.sql`p."price" DESC, p."createdAt" DESC, p."id" ASC`;
  if (sort === 'name-asc') return Prisma.sql`p."name" ASC, p."id" ASC`;
  if (sort === 'relevance' && input.q) return Prisma.sql`${relevance(input.q)} ASC, p."createdAt" DESC, p."id" ASC`;
  return Prisma.sql`p."createdAt" DESC, p."id" ASC`;
}
