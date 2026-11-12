import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { SearchService } from './search.service.js';
import { searchSchema } from '../validators/search.validator.js';
import { searchFrom, searchOrder, searchWhere } from './search.sql.js';
import { decodeCursor, effectiveSort, filterFingerprint, keyProjection, seekPredicate } from './catalog-cursor.js';

/**
 * Task 06.2 Work Package F — keyset pagination behaviour against a real, disposable PostgreSQL
 * (run by scripts/catalog-pagination-pg.cjs only; `--bench` adds the large-catalog query-plan benchmark).
 * Fixtures live in categories with a unique suffix and are deleted afterwards. Nothing here touches a hosted database.
 *
 * The ordering oracle is a plain SQL ORDER BY over the fixture category (the documented contract), never the service.
 */
const suffix = randomUUID().slice(0, 8);
const token = `zq${suffix}`;
const service = new SearchService();
const created: { categoryIds: string[] } = { categoryIds: [] };
let categorySlug = '';
let categoryId = '';
const FIXTURE_COUNT = 43;
const PRICES = ['10.00', '10.00', '10.00', '25.50', '25.50', '99.99', '99.99', '149.00'];
const base = Date.UTC(2026, 10, 1, 12, 0, 0, 123);

type Params = Record<string, string>;
const ORACLE_ORDER: Record<string, Prisma.Sql> = {
  newest: Prisma.sql`p."createdAt" DESC, p."id" ASC`,
  'price-asc': Prisma.sql`p."price" ASC, p."createdAt" DESC, p."id" ASC`,
  'price-desc': Prisma.sql`p."price" DESC, p."createdAt" DESC, p."id" ASC`,
  'name-asc': Prisma.sql`p."name" ASC, p."id" ASC`,
};

async function oracle(sort: keyof typeof ORACLE_ORDER) {
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT p."id"::text AS id FROM "products" p
    WHERE p."categoryId" = CAST(${categoryId} AS uuid) AND p."status" = 'ACTIVE' AND p."storefrontVisible" = true AND p."isTestFixture" = false
    ORDER BY ${ORACLE_ORDER[sort]}`);
  return rows.map(row => row.id);
}

async function relevanceOracle() {
  const lower = token.toLowerCase();
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT p."id"::text AS id FROM "products" p
    WHERE p."categoryId" = CAST(${categoryId} AS uuid) AND p."status" = 'ACTIVE' AND p."storefrontVisible" = true AND p."isTestFixture" = false
      AND (p."name" ILIKE ${`%${token}%`} OR p."sku" ILIKE ${`%${token}%`})
    ORDER BY CASE WHEN LOWER(p."name") = ${lower} OR LOWER(p."sku") = ${lower} THEN 0
                  WHEN p."name" ILIKE ${`${token}%`} THEN 1 WHEN p."name" ILIKE ${`%${token}%`} THEN 2 ELSE 3 END ASC,
             p."createdAt" DESC, p."id" ASC`);
  return rows.map(row => row.id);
}

const parse = (params: Params) => searchSchema.parse(params);

async function page(params: Params) {
  return service.products(parse(params));
}

/** Follows nextCursor to the end; asserts hasNextPage/nextCursor agree on every page. */
async function traverse(params: Params, pageSize: number, between?: (pageIndex: number, ids: string[]) => Promise<void>) {
  const ids: string[] = [];
  const pages: string[][] = [];
  let cursor: string | null = null;
  do {
    const response = await page({ ...params, pageSize: String(pageSize), ...(cursor ? { cursor } : { paginate: 'cursor' }) });
    const pageIds = response.data.map(product => product.id);
    expect(pageIds.length).toBeLessThanOrEqual(pageSize);
    expect(response.meta.hasNextPage).toBe(response.meta.nextCursor !== null);
    if (pages.length === 0) expect(typeof response.meta.total).toBe('number');
    else expect(response.meta.total).toBeNull();
    ids.push(...pageIds);
    pages.push(pageIds);
    cursor = response.meta.nextCursor;
    if (cursor && between) await between(pages.length, pageIds);
  } while (cursor && pages.length < 200);
  return { ids, pages };
}

async function insertProduct(label: string, price: string, createdAt: Date, name = `PGQA ${suffix} ${label}`, category = categoryId) {
  const row = await prisma.product.create({ data: { categoryId: category, sku: `PGQA-${suffix}-${label}`, name, slug: `pgqa-${suffix}-${label.toLowerCase()}`,
    price, status: 'ACTIVE', storefrontVisible: true, isTestFixture: false, createdAt } });
  return row.id;
}

describe.sequential('catalog keyset pagination on real PostgreSQL', () => {
  beforeAll(async () => {
    categorySlug = `pgqa-${suffix}`;
    const category = await prisma.category.create({ data: { name: `PGQA ${suffix}`, slug: categorySlug } });
    categoryId = category.id;
    created.categoryIds.push(category.id);
    for (let i = 0; i < FIXTURE_COUNT; i += 1) {
      // Groups of four rows share one millisecond timestamp; prices repeat; names repeat every ten rows.
      const createdAt = new Date(base + Math.floor(i / 4) * 1000);
      const variant = i % 4;
      const name = variant === 0 ? `${token} Phone ${i % 10}` : variant === 1 ? `Phone ${token} ${i % 10}` : `Phone plain ${i % 10}`;
      const row = await prisma.product.create({ data: { categoryId, sku: `PGQA-${suffix}-${variant === 2 ? token.toUpperCase() : 'X'}-${i}`, name,
        slug: `pgqa-${suffix}-${i}`, price: PRICES[i % PRICES.length], status: 'ACTIVE', storefrontVisible: true, isTestFixture: false, createdAt } });
      void row;
    }
    // One exact-name match (rank 0) and one hidden product that must never appear.
    await insertProduct('EXACT', '10.00', new Date(base - 5000), token);
    await prisma.product.create({ data: { categoryId, sku: `PGQA-${suffix}-HIDDEN`, name: `${token} hidden`, slug: `pgqa-${suffix}-hidden`,
      price: '10.00', status: 'ACTIVE', storefrontVisible: false, isTestFixture: false, createdAt: new Date(base) } });
  });

  afterAll(async () => {
    if (created.categoryIds.length) {
      await prisma.product.deleteMany({ where: { categoryId: { in: created.categoryIds } } });
      await prisma.category.deleteMany({ where: { id: { in: created.categoryIds } } });
    }
    await prisma.$disconnect();
  });

  it.each(['newest', 'price-asc', 'price-desc', 'name-asc'] as const)(
    '15/16/20. %s: full traversal equals the ORDER BY contract with no duplicates or skips across duplicate keys', async (sort) => {
      const expected = await oracle(sort);
      expect(expected).toHaveLength(FIXTURE_COUNT + 1);
      for (const pageSize of [1, 5, 7, 100]) {
        const { ids, pages } = await traverse({ category: categorySlug, sort }, pageSize);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual(expected);
        expect(pages.length).toBe(Math.max(1, Math.ceil(expected.length / pageSize)));
      }
    });

  it('relevance with a query: rank, then recency, then id; hidden products never appear', async () => {
    const expected = await relevanceOracle();
    expect(expected.length).toBeGreaterThan(20);
    const { ids } = await traverse({ category: categorySlug, q: token, sort: 'relevance' }, 4);
    expect(ids).toEqual(expected);
    const hidden = await prisma.product.findUniqueOrThrow({ where: { sku: `PGQA-${suffix}-HIDDEN` } });
    expect(ids).not.toContain(hidden.id);
  });

  it('16. a page boundary inside a run of equal prices neither repeats nor drops a row', async () => {
    const response = await page({ category: categorySlug, sort: 'price-asc', pageSize: '2', paginate: 'cursor' });
    const next = await page({ category: categorySlug, sort: 'price-asc', pageSize: '2', cursor: response.meta.nextCursor! });
    expect(response.data.map(product => product.price)).toEqual(['10.00', '10.00']);
    expect(next.data[0].price).toBe('10.00');
    expect(next.data.map(product => product.id)).not.toContain(response.data[1].id);
  });

  it('19. identical requests return identical pages (stable order)', async () => {
    const first = await page({ category: categorySlug, sort: 'name-asc', pageSize: '9', paginate: 'cursor' });
    const again = await page({ category: categorySlug, sort: 'name-asc', pageSize: '9', paginate: 'cursor' });
    expect(again.data.map(product => product.id)).toEqual(first.data.map(product => product.id));
    expect(again.meta.nextCursor).toBe(first.meta.nextCursor);
  });

  it('offset page N hands over to the cursor without a gap: nextCursor of page 2 yields offset page 3', async () => {
    for (const sort of ['newest', 'price-desc', 'name-asc']) {
      const offset2 = await page({ category: categorySlug, sort, pageSize: '6', page: '2' });
      const offset3 = await page({ category: categorySlug, sort, pageSize: '6', page: '3' });
      expect(offset2.meta.hasNextPage).toBe(true);
      const continued = await page({ category: categorySlug, sort, pageSize: '6', cursor: offset2.meta.nextCursor! });
      expect(continued.data.map(product => product.id)).toEqual(offset3.data.map(product => product.id));
    }
  });

  it('17. rows inserted between requests: earlier rows are not repeated, later rows are still reached', async () => {
    const extra: string[] = [];
    const before = await oracle('newest');
    const { ids } = await traverse({ category: categorySlug, sort: 'newest' }, 5, async (pageIndex) => {
      if (pageIndex !== 1) return;
      extra.push(await insertProduct('NEWER', '10.00', new Date(base + 3_600_000)));   // sorts before the cursor
      extra.push(await insertProduct('OLDER', '10.00', new Date(base - 3_600_000)));   // sorts after every fixture
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(extra[0]);
    expect(ids).toEqual([...before, extra[1]]);
    await prisma.product.deleteMany({ where: { id: { in: extra } } });
  });

  it('18. rows deleted between requests, including the cursor anchor itself: traversal continues without skipping', async () => {
    const before = await oracle('price-asc');
    const removed: string[] = [];
    const { ids } = await traverse({ category: categorySlug, sort: 'price-asc' }, 5, async (pageIndex, pageIds) => {
      if (pageIndex !== 1) return;
      const anchor = pageIds[pageIds.length - 1];          // the row the cursor points at
      const upcoming = before[before.indexOf(anchor) + 2]; // a row on the next page
      removed.push(anchor, upcoming);
      await prisma.product.updateMany({ where: { id: { in: removed } }, data: { status: 'INACTIVE' } });
    });
    expect(ids).toEqual(before.filter(id => !removed.slice(1).includes(id)));
    await prisma.product.updateMany({ where: { id: { in: removed } }, data: { status: 'ACTIVE' } });
    const deletedAnchor = await insertProduct('ANCHOR', '25.50', new Date(base + 2500));
    const all = await oracle('price-asc');
    const index = all.indexOf(deletedAnchor);
    const firstPage = await page({ category: categorySlug, sort: 'price-asc', pageSize: String(index + 1), paginate: 'cursor' });
    expect(firstPage.data.at(-1)?.id).toBe(deletedAnchor);
    await prisma.product.delete({ where: { id: deletedAnchor } });            // hard delete of the anchor row
    const rest = await page({ category: categorySlug, sort: 'price-asc', pageSize: '100', cursor: firstPage.meta.nextCursor! });
    expect(rest.data.map(product => product.id)).toEqual(all.slice(index + 1));
  });

  it('13. a cursor from one category is rejected for another, even though both are valid filters', async () => {
    const other = await prisma.category.create({ data: { name: `PGQA other ${suffix}`, slug: `pgqa-other-${suffix}` } });
    created.categoryIds.push(other.id);
    const first = await page({ category: categorySlug, sort: 'newest', pageSize: '3', paginate: 'cursor' });
    await expect(page({ category: other.slug, sort: 'newest', pageSize: '3', cursor: first.meta.nextCursor! }))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', statusCode: 400 });
  });

  it('first cursor page reports the filtered total; the last page reports no next cursor', async () => {
    const first = await page({ category: categorySlug, sort: 'newest', pageSize: '100', paginate: 'cursor' });
    expect(first.meta).toMatchObject({ total: FIXTURE_COUNT + 1, hasNextPage: false, nextCursor: null });
  });
});

/**
 * Optional benchmark (scripts/catalog-pagination-pg.cjs --bench). Seeds a large synthetic catalog in its own category, then
 * records EXPLAIN (ANALYZE, BUFFERS) of the service's page query for deep offset vs keyset positions, before and after
 * candidate indexes. Results are written as JSON evidence; nothing is asserted about absolute timings.
 */
describe.runIf(process.env.CATALOG_PAGINATION_BENCH === '1').sequential('catalog pagination benchmark (disposable PostgreSQL)', () => {
  const BENCH_ROWS = Number(process.env.CATALOG_PAGINATION_BENCH_ROWS ?? 200_000);
  const benchSlug = `pgbench-${suffix}`;
  let benchCategoryId = '';
  const evidence: Record<string, unknown> = { rows: BENCH_ROWS, measurements: [] as unknown[] };

  beforeAll(async () => {
    const category = await prisma.category.create({ data: { name: `PG bench ${suffix}`, slug: benchSlug } });
    benchCategoryId = category.id;
    created.categoryIds.push(category.id);
    // 2,000 distinct prices and 1-second timestamp buckets of ~7 rows: realistic duplicate keys at every depth.
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "products" ("id", "categoryId", "sku", "name", "slug", "price", "status", "isTestFixture", "storefrontVisible", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), CAST(${benchCategoryId} AS uuid), 'PGB-' || ${suffix} || '-' || g, 'Bench product ' || (g % 5000),
             'pgb-' || ${suffix} || '-' || g, ((g * 7919) % 2000) + 0.99, 'ACTIVE', false, true,
             TIMESTAMP '2025-01-01 00:00:00' + ((g / 7) * INTERVAL '1 second'), now()
      FROM generate_series(1, ${BENCH_ROWS}) AS g`);
    await prisma.$executeRawUnsafe('ANALYZE "products"');
    const version = await prisma.$queryRaw<{ version: string }[]>`SELECT version()`;
    evidence.postgres = version[0]?.version;
    evidence.totalProducts = Number((await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM "products"`)[0].n);
  }, 600_000);

  afterAll(async () => {
    const dir = process.env.CATALOG_PAGINATION_EVIDENCE_DIR;
    if (dir) fs.writeFileSync(path.join(dir, 'catalog-pagination-benchmark.json'), JSON.stringify(evidence, null, 2));
    console.log(`CATALOG_PAGINATION_BENCH ${JSON.stringify(evidence)}`);
  });

  /** The service's page query (same FROM/WHERE/ORDER/projection), as offset or as keyset seek. */
  async function explain(label: string, params: Params, mode: { offset: number } | { cursor: string }) {
    const input = parse(params);
    const sort = effectiveSort(input);
    let where = searchWhere(input);
    if ('cursor' in mode) {
      const decoded = decodeCursor(mode.cursor, sort, filterFingerprint(input, sort, false));
      where = Prisma.sql`${where} AND ${seekPredicate(decoded, input.q)}`;
    }
    const order = searchOrder(input);
    const limit = 'cursor' in mode ? input.pageSize + 1 : input.pageSize;
    const offset = 'offset' in mode ? mode.offset : 0;
    const query = Prisma.sql`SELECT p."id", ROW_NUMBER() OVER (ORDER BY ${order}) AS ordinal, ${keyProjection(sort, input.q)}
      ${searchFrom} ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`;
    const samples: number[] = [];
    let plan: unknown;
    for (let run = 0; run < 5; run += 1) {
      const result = await prisma.$queryRaw<{ 'QUERY PLAN': [{ 'Execution Time': number; Plan: unknown }] }[]>(
        Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`);
      const [entry] = result[0]['QUERY PLAN'];
      samples.push(entry['Execution Time']);
      plan = entry.Plan;
    }
    samples.sort((a, b) => a - b);
    const top = plan as { 'Node Type': string; Plans?: unknown[] };
    const nodes: string[] = [];
    const walk = (node: { 'Node Type': string; 'Index Name'?: string; Plans?: unknown[] }) => {
      nodes.push(node['Index Name'] ? `${node['Node Type']}(${node['Index Name']})` : node['Node Type']);
      (node.Plans as typeof node[] | undefined)?.forEach(walk);
    };
    walk(top);
    const measurement = { label, medianMs: Number(samples[2].toFixed(3)), minMs: Number(samples[0].toFixed(3)), maxMs: Number(samples[4].toFixed(3)), nodes };
    (evidence.measurements as unknown[]).push(measurement);
    return measurement;
  }

  /** A cursor for the row at 0-based position `position` (obtained through the real offset path's nextCursor). */
  async function cursorAt(params: Params, position: number) {
    const pageSize = 100;
    const pageNumber = Math.floor(position / pageSize);
    if (pageNumber < 1 || pageNumber > 100) throw new Error('position must be reachable within the offset cap');
    const response = await page({ ...params, pageSize: String(pageSize), page: String(pageNumber) });
    return response.meta.nextCursor!;
  }

  it('records deep offset vs keyset plans, without and with candidate indexes', async () => {
    const scenarios: { name: string; params: Params }[] = [
      { name: 'catalog newest', params: { sort: 'newest', pageSize: '20' } },
      { name: 'catalog price-asc', params: { sort: 'price-asc', pageSize: '20' } },
      { name: 'category newest', params: { category: benchSlug, sort: 'newest', pageSize: '20' } },
      { name: 'category price-asc', params: { category: benchSlug, sort: 'price-asc', pageSize: '20' } },
      { name: 'catalog price-desc', params: { sort: 'price-desc', pageSize: '20' } },
      { name: 'catalog name-asc', params: { sort: 'name-asc', pageSize: '20' } },
    ];
    // Phase 2 is the index shipped by 20261114000000_catalog_price_keyset_index (expressible in schema.prisma, so no drift).
    // Run 1 of this benchmark also measured partial storefront indexes and category-leading indexes; the category-leading
    // ones were never chosen by the planner (the category is filtered by slug through a join) and were not shipped.
    const phases: [string, string[]][] = [
      ['without price keyset index', ['DROP INDEX IF EXISTS "products_price_createdAt_id_idx"']],
      ['with products_price_createdAt_id_idx', ['CREATE INDEX "products_price_createdAt_id_idx" ON "products"("price" ASC, "createdAt" DESC, "id" ASC)']],
    ];
    const cursors = new Map<string, { deep: string; shallow: string }>();
    for (const scenario of scenarios) {
      cursors.set(scenario.name, { deep: await cursorAt(scenario.params, 9_900), shallow: await cursorAt(scenario.params, 100) });
    }
    for (const [phase, ddl] of phases) {
      for (const statement of ddl) await prisma.$executeRawUnsafe(statement);
      await prisma.$executeRawUnsafe('ANALYZE "products"');
      for (const scenario of scenarios) {
        const { deep } = cursors.get(scenario.name)!;
        await explain(`${phase} | ${scenario.name} | offset page 1`, scenario.params, { offset: 0 });
        await explain(`${phase} | ${scenario.name} | offset page 100 (offset 1980)`, scenario.params, { offset: 1980 });
        await explain(`${phase} | ${scenario.name} | old cap: offset 99,900 (page 1000 x 100)`, scenario.params, { offset: 99_900 });
        await explain(`${phase} | ${scenario.name} | keyset after row 9,900`, scenario.params, { cursor: deep });
      }
    }
    expect((evidence.measurements as unknown[]).length).toBe(phases.length * scenarios.length * 4);
  }, 600_000);
});
