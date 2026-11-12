/**
 * Task 06.2 — catalog pagination contract (Work Package F): validator cap, opaque cursor integrity and seek predicates.
 * Database traversal behaviour is covered by catalog-pagination.postgres.integration.test.ts on a disposable PostgreSQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { Prisma } from '@prisma/client';

vi.mock('../lib/prisma.js', () => ({ prisma: { $queryRaw: vi.fn(), $transaction: vi.fn() } }));

import app from '../app.js';
import { prisma } from '../lib/prisma.js';
import { paginationSchema, MAX_PAGE } from '../validators/product.validator.js';
import { searchSchema } from '../validators/search.validator.js';
import { reviewPaginationSchema } from '../validators/review.validator.js';
import { decodeCursor, effectiveSort, encodeCursor, filterFingerprint, keysFromRow, seekPredicate } from './catalog-cursor.js';

const ID_A = '00000000-0000-4000-8000-00000000000a';
const ID_B = '00000000-0000-4000-8000-00000000000b';
const base = searchSchema.parse({});
const sqlText = (sql: Prisma.Sql) => sql.text.replace(/\s+/g, ' ');

describe('offset pagination validator boundary', () => {
  it('1/2. accepts page 1 and page 100 (the cap)', () => {
    expect(paginationSchema.parse({}).page).toBe(1);
    expect(paginationSchema.parse({ page: '100' }).page).toBe(MAX_PAGE);
    expect(paginationSchema.parse({ page: '100', pageSize: '100' })).toEqual({ page: 100, pageSize: 100 });
  });

  it('3. rejects page 101 with too_big', () => {
    const result = paginationSchema.safeParse({ page: '101' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ['page'], code: 'too_big' });
  });

  it.each(['0', '-1', '1.5', '1e2', ' 1', '1 ', '0x10', 'abc', '', '01', '+1', '9'.repeat(16), '9007199254740993'])(
    '4/6/7. rejects malformed or unbounded page %j', (page) => {
      expect(paginationSchema.safeParse({ page }).success).toBe(false);
    });

  it.each(['0', '101', '-5', '2.5', '1e1', '9'.repeat(400)])('5. rejects invalid pageSize %j', (pageSize) => {
    expect(paginationSchema.safeParse({ pageSize }).success).toBe(false);
  });

  it('rejects repeated parameters (array values) instead of picking one', () => {
    expect(paginationSchema.safeParse({ page: ['1', '2'] }).success).toBe(false);
  });

  it('public reviews share the cap', () => {
    expect(reviewPaginationSchema.safeParse({ page: '100' }).success).toBe(true);
    expect(reviewPaginationSchema.safeParse({ page: '101' }).success).toBe(false);
  });
});

describe('opaque cursor', () => {
  const fingerprint = filterFingerprint(base, 'newest', false);

  it('round-trips the sort and seek keys', () => {
    const token = encodeCursor('newest', ['2026-11-11 10:00:00.123', ID_A], fingerprint);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(decodeCursor(token, 'newest', fingerprint)).toEqual({ sort: 'newest', keys: ['2026-11-11 10:00:00.123', ID_A] });
  });

  it('11. rejects malformed tokens', () => {
    for (const token of ['', 'abc', 'a.b.c', '.', 'x'.repeat(2000)]) {
      expect(() => decodeCursor(token, 'newest', fingerprint)).toThrow(expect.objectContaining({ code: 'INVALID_CURSOR', statusCode: 400 }));
    }
  });

  it('12. rejects a tampered payload or signature', () => {
    const token = encodeCursor('newest', ['2026-11-11 10:00:00.123', ID_A], fingerprint);
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ v: 1, s: 'newest', k: ['1999-01-01 00:00:00', ID_B], f: fingerprint })).toString('base64url');
    expect(() => decodeCursor(`${forged}.${signature}`, 'newest', fingerprint)).toThrow(expect.objectContaining({ code: 'INVALID_CURSOR' }));
    const flipped = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A');
    expect(() => decodeCursor(`${payload}.${flipped}`, 'newest', fingerprint)).toThrow(expect.objectContaining({ code: 'INVALID_CURSOR' }));
  });

  it('rejects a correctly signed payload whose keys are not the sort’s types (no SQL reaches the database)', () => {
    const token = encodeCursor('newest', ["'; DROP TABLE products; --", ID_A], fingerprint);
    expect(() => decodeCursor(token, 'newest', fingerprint)).toThrow(expect.objectContaining({ code: 'INVALID_CURSOR' }));
  });

  it('13. rejects a cursor reused with changed filters', () => {
    const token = encodeCursor('newest', ['2026-11-11 10:00:00.123', ID_A], fingerprint);
    const changed = filterFingerprint({ ...base, category: 'laptops' }, 'newest', false);
    expect(() => decodeCursor(token, 'newest', changed)).toThrow(/different filters or sorting/);
    expect(filterFingerprint({ ...base, q: 'phone' }, 'newest', false)).not.toBe(fingerprint);
    expect(filterFingerprint(base, 'newest', true)).not.toBe(fingerprint);
  });

  it('14. rejects a cursor reused with a changed sort', () => {
    const token = encodeCursor('newest', ['2026-11-11 10:00:00.123', ID_A], fingerprint);
    expect(() => decodeCursor(token, 'price-asc', filterFingerprint(base, 'price-asc', false))).toThrow(/different filters or sorting/);
  });

  it('relevance without a query is the newest order (mirrors searchOrder)', () => {
    expect(effectiveSort({ q: '', sort: 'relevance' })).toBe('newest');
    expect(effectiveSort({ q: 'tv', sort: undefined })).toBe('relevance');
    expect(effectiveSort({ q: '', sort: undefined })).toBe('newest');
  });

  it('builds keys only from complete rows', () => {
    const row = { kCreatedAt: '2026-11-11 10:00:00.123', kId: ID_A, kPrice: '19.99', kName: 'Phone', kRank: 2 };
    expect(keysFromRow('price-asc', row)).toEqual(['19.99', '2026-11-11 10:00:00.123', ID_A]);
    expect(keysFromRow('name-asc', row)).toEqual(['Phone', ID_A]);
    expect(keysFromRow('relevance', row)).toEqual(['2', '2026-11-11 10:00:00.123', ID_A]);
    expect(keysFromRow('newest', { ...row, kId: null })).toBeNull();
  });
});

describe('seek predicates are the lexicographic "strictly after" of each ORDER BY', () => {
  it('newest: createdAt DESC, id ASC', () => {
    const sql = seekPredicate({ sort: 'newest', keys: ['2026-11-11 10:00:00.123', ID_A] }, '');
    expect(sqlText(sql)).toBe('p."createdAt" <= CAST($1 AS timestamp(3)) AND (p."createdAt" < CAST($2 AS timestamp(3)) OR (p."createdAt" = CAST($3 AS timestamp(3)) AND p."id" > CAST($4 AS uuid)))');
    expect(sql.values).toEqual(['2026-11-11 10:00:00.123', '2026-11-11 10:00:00.123', '2026-11-11 10:00:00.123', ID_A]);
  });

  it('price-asc: price ASC, then the recency tail; price-desc flips only the price comparison', () => {
    const asc = sqlText(seekPredicate({ sort: 'price-asc', keys: ['19.99', '2026-11-11 10:00:00.123', ID_A] }, ''));
    const desc = sqlText(seekPredicate({ sort: 'price-desc', keys: ['19.99', '2026-11-11 10:00:00.123', ID_A] }, ''));
    expect(asc).toContain('p."price" >= CAST($1 AS numeric(12,2)) AND (p."price" > CAST($2 AS numeric(12,2)) OR (p."price" = CAST($3 AS numeric(12,2)) AND (p."createdAt" <');
    expect(desc).toContain('p."price" <= CAST($1 AS numeric(12,2)) AND (p."price" < CAST($2 AS numeric(12,2))');
  });

  it('name-asc: name ASC, id ASC', () => {
    expect(sqlText(seekPredicate({ sort: 'name-asc', keys: ['Phone', ID_A] }, '')))
      .toBe('p."name" >= $1 AND (p."name" > $2 OR (p."name" = $3 AND p."id" > CAST($4 AS uuid)))');
  });

  it('every value is a bound parameter', () => {
    const sql = seekPredicate({ sort: 'relevance', keys: ['3', '2026-11-11 10:00:00.123', ID_A] }, "o'brien");
    expect(sql.sql).not.toContain("o'brien");
    expect(sql.sql).not.toContain(ID_A);
  });
});

describe('HTTP contract', () => {
  beforeEach(() => vi.mocked(prisma.$queryRaw).mockReset());

  it('3. page 101 answers 400 PAGE_LIMIT_EXCEEDED and never queries the database', async () => {
    for (const path of ['/api/search/products?page=101', '/api/products?page=101', '/api/products/deals?page=101']) {
      const response = await request(app).get(path);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('PAGE_LIMIT_EXCEEDED');
      expect(response.body.error.message).toMatch(/paginate=cursor/);
    }
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('4/5. malformed page or pageSize answers 400 VALIDATION_ERROR without a query', async () => {
    for (const query of ['page=-1', 'page=1.5', 'page=1e3', 'pageSize=101', 'pageSize=0', 'page=abc']) {
      const response = await request(app).get(`/api/search/products?${query}`);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('page and cursor cannot be combined', async () => {
    const response = await request(app).get('/api/search/products?paginate=cursor&page=2');
    expect(response.status).toBe(400);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('category-mix has no cursor form', async () => {
    const response = await request(app).get('/api/search/products?paginate=cursor&sort=category-mix');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CURSOR_UNSUPPORTED_SORT');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('11/12. a forged cursor answers 400 INVALID_CURSOR without a query', async () => {
    const response = await request(app).get('/api/search/products?cursor=eyJ2IjoxfQ.c2lnbmF0dXJl');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_CURSOR');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('8. empty catalog: cursor first page is empty with no next cursor', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0n }]);
    const response = await request(app).get('/api/search/products?paginate=cursor');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: [], meta: { pageSize: 20, total: 0, hasNextPage: false, nextCursor: null } });
  });

  it('22. offset responses keep their fields and only add hasNextPage/nextCursor', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ total: 0n, id: null }]);
    const response = await request(app).get('/api/search/products');
    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0, hasNextPage: false, nextCursor: null });
  });
});
