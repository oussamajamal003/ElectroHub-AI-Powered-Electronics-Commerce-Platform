import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import type { SearchInput } from '../validators/search.validator.js';
import { relevance } from './search.sql.js';

/**
 * Task 06.2 — keyset (cursor) pagination for the public catalog.
 *
 * Ordering contract (identical to the offset path's ORDER BY, so a cursor continues exactly where an offset page ends):
 *   newest      p.createdAt DESC, p.id ASC
 *   price-asc   p.price ASC,  p.createdAt DESC, p.id ASC
 *   price-desc  p.price DESC, p.createdAt DESC, p.id ASC
 *   name-asc    p.name ASC, p.id ASC
 *   relevance   rank(q) ASC, p.createdAt DESC, p.id ASC        (rank is a deterministic 0..7 CASE on the row)
 * category-mix is a window-function round robin over the whole filtered set: it has no row-local seek key, so it is
 * served only by bounded offset pagination (CURSOR_UNSUPPORTED_SORT).
 *
 * Every sort column is NOT NULL (products.price, products.name, products.createdAt, products.id), so no NULLS ordering
 * branch is needed. Seek values travel as the database's own text rendering (timestamp(3)::text, numeric::text, uuid)
 * and are cast back with the column type, so comparisons are exact and never pass through a JavaScript Date or float.
 *
 * A cursor is opaque: base64url(JSON payload) + "." + base64url(HMAC-SHA256). The payload holds only the format version,
 * the sort, the last row's seek values (public product attributes) and a fingerprint of the filters. It never contains
 * customer data. The signature makes tampering a clean 400 instead of an arbitrary seek; the fingerprint makes reusing a
 * cursor with different filters or a different sort a clean 400 instead of a misleading page.
 */

export const CURSOR_VERSION = 1;
export const MAX_CURSOR_LENGTH = 1024;
export type KeysetSort = 'newest' | 'price-asc' | 'price-desc' | 'name-asc' | 'relevance';
export type EffectiveSort = KeysetSort | 'category-mix';

const timestampText = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/);
const uuid = z.string().uuid();
const priceText = z.string().regex(/^\d{1,10}\.\d{2}$/);
const keySchemas = {
  newest: z.tuple([timestampText, uuid]),
  'price-asc': z.tuple([priceText, timestampText, uuid]),
  'price-desc': z.tuple([priceText, timestampText, uuid]),
  'name-asc': z.tuple([z.string().min(1).max(255), uuid]),
  relevance: z.tuple([z.string().regex(/^[0-7]$/), timestampText, uuid]),
} as const;
const payloadSchema = z.object({
  v: z.literal(CURSOR_VERSION),
  s: z.enum(['newest', 'price-asc', 'price-desc', 'name-asc', 'relevance']),
  k: z.array(z.string()).min(2).max(3),
  f: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
}).strict();

/** The seek-key columns a page query must project, as text, for cursor construction. */
export interface KeysetRow { kCreatedAt: string | null; kId: string | null; kPrice: string | null; kName: string | null; kRank: number | null }

/** Mirrors searchOrder(): relevance without a query orders exactly like newest. */
export function effectiveSort(input: Pick<SearchInput, 'q' | 'sort'>): EffectiveSort {
  const sort = input.sort ?? (input.q ? 'relevance' : 'newest');
  return sort === 'relevance' && !input.q ? 'newest' : sort;
}

export const supportsKeyset = (sort: EffectiveSort): sort is KeysetSort => sort !== 'category-mix';

const signingKey = () => crypto.createHmac('sha256', env.JWT_SECRET).update('electrohub:catalog-cursor:v1').digest();
const sign = (payload: string) => crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');

/** Fingerprint of everything that changes the result set or its order. A relevance query is part of its ordering. */
export function filterFingerprint(input: SearchInput, sort: EffectiveSort, dealsOnly: boolean): string {
  const canonical = JSON.stringify([input.q, input.category ?? null, input.brand ?? null, input.availability ?? null,
    input.minPrice ?? null, input.maxPrice ?? null, sort, dealsOnly]);
  return crypto.createHash('sha256').update(canonical).digest('base64url').slice(0, 22);
}

const invalidCursor = (message = 'The pagination cursor is invalid or expired. Start again from the first page.') =>
  new AppError(message, 400, 'INVALID_CURSOR');

export function keysFromRow(sort: KeysetSort, row: KeysetRow): string[] | null {
  if (!row.kId || !row.kCreatedAt) return null;
  if (sort === 'newest') return [row.kCreatedAt, row.kId];
  if (sort === 'name-asc') return row.kName ? [row.kName, row.kId] : null;
  if (sort === 'relevance') return row.kRank === null ? null : [String(row.kRank), row.kCreatedAt, row.kId];
  return row.kPrice ? [row.kPrice, row.kCreatedAt, row.kId] : null;
}

export function encodeCursor(sort: KeysetSort, keys: string[], fingerprint: string): string {
  const payload = Buffer.from(JSON.stringify({ v: CURSOR_VERSION, s: sort, k: keys, f: fingerprint })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export interface DecodedCursor { sort: KeysetSort; keys: string[] }

export function decodeCursor(token: string, expectedSort: EffectiveSort, expectedFingerprint: string): DecodedCursor {
  if (token.length > MAX_CURSOR_LENGTH) throw invalidCursor();
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) throw invalidCursor();
  const expected = Buffer.from(sign(payload));
  const presented = Buffer.from(signature);
  if (expected.length !== presented.length || !crypto.timingSafeEqual(expected, presented)) throw invalidCursor();
  let parsed: z.infer<typeof payloadSchema>;
  try {
    parsed = payloadSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  } catch {
    throw invalidCursor();
  }
  if (parsed.s !== expectedSort || parsed.f !== expectedFingerprint) {
    throw invalidCursor('This pagination cursor belongs to different filters or sorting. Start again from the first page.');
  }
  const keys = keySchemas[parsed.s].safeParse(parsed.k);
  if (!keys.success) throw invalidCursor();
  return { sort: parsed.s, keys: keys.data };
}

const ts = (value: string) => Prisma.sql`CAST(${value} AS timestamp(3))`;
const id = (value: string) => Prisma.sql`CAST(${value} AS uuid)`;
/** (createdAt DESC, id ASC) tail shared by every sort. */
const recencyTail = (createdAt: string, rowId: string) =>
  Prisma.sql`(p."createdAt" < ${ts(createdAt)} OR (p."createdAt" = ${ts(createdAt)} AND p."id" > ${id(rowId)}))`;

/**
 * Lexicographic seek predicate equivalent to "row sorts strictly after the cursor row" for the sort's ORDER BY.
 * Each predicate starts with a redundant inclusive bound on the leading sort column (e.g. price >= cursor price) so the
 * planner can begin the index range scan at the cursor instead of filtering from the start of the index.
 */
export function seekPredicate(cursor: DecodedCursor, query: string): Prisma.Sql {
  const [first, second, third] = cursor.keys;
  switch (cursor.sort) {
    case 'newest':
      return Prisma.sql`p."createdAt" <= ${ts(first)} AND ${recencyTail(first, second)}`;
    case 'name-asc':
      return Prisma.sql`p."name" >= ${first} AND (p."name" > ${first} OR (p."name" = ${first} AND p."id" > ${id(second)}))`;
    case 'price-asc':
    case 'price-desc': {
      const price = Prisma.sql`CAST(${first} AS numeric(12,2))`;
      const asc = cursor.sort === 'price-asc';
      const bound = asc ? Prisma.sql`p."price" >= ${price}` : Prisma.sql`p."price" <= ${price}`;
      const beyond = asc ? Prisma.sql`p."price" > ${price}` : Prisma.sql`p."price" < ${price}`;
      return Prisma.sql`${bound} AND (${beyond} OR (p."price" = ${price} AND ${recencyTail(second, third)}))`;
    }
    case 'relevance': {
      const rank = relevance(query);
      const value = Number(first);
      return Prisma.sql`((${rank}) > ${value} OR ((${rank}) = ${value} AND ${recencyTail(second, third)}))`;
    }
  }
}

/** Text projections of the seek keys, appended to a page CTE that has the searchFrom aliases in scope. */
export function keyProjection(sort: EffectiveSort, query: string): Prisma.Sql {
  const rank = sort === 'relevance' && query ? Prisma.sql`(${relevance(query)})::int` : Prisma.sql`NULL::int`;
  return Prisma.sql`p."createdAt"::text AS "kCreatedAt", p."id"::text AS "kId", p."price"::text AS "kPrice", p."name" AS "kName", ${rank} AS "kRank"`;
}
