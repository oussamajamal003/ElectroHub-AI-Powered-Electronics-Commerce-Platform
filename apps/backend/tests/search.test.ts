import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchSchema, suggestionsSchema, hasDiscovery } from '../src/validators/search.validator.js';
import { searchWhere, searchOrder, relevance, escapeLike, escapeRegex } from '../src/services/search.sql.js';
import { SearchService } from '../src/services/search.service.js';
import routes from '../src/routes/search.routes.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { swaggerSpec } from '../src/docs/swagger/index.js';
const database = vi.hoisted(() => ({ $queryRaw: vi.fn(), $transaction: vi.fn(), product: { findMany: vi.fn() },
  review: { groupBy: vi.fn().mockResolvedValue([]) } }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: database }));
vi.mock('../src/utils/logger.js', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
const fixture = (id: string, total = 1n) => ({ total, id, name: 'MacBook', slug: 'macbook', price: '9999999999.99', compareAtPrice: null,
  description: null, quantity: null, category: { id: 'category', name: 'Laptops', slug: 'laptops' }, brand: null,
  images: [], reviewCount: 0n, averageRating: null });
beforeEach(() => {
  vi.resetAllMocks();
  database.$transaction.mockImplementation((callback: (transaction: typeof database) => Promise<unknown>) => callback(database));
  database.review.groupBy.mockResolvedValue([]);
});
describe('Search validation and parameterized queries', () => {
  it('normalizes whitespace without removing meaningful punctuation', () => {
    expect(searchSchema.parse({ q: '  WH-1000XM5   Sony ' })).toMatchObject({ q: 'WH-1000XM5 Sony', page: 1, pageSize: 20 });
    expect(hasDiscovery(searchSchema.parse({ sort: 'newest' }))).toBe(false);
    expect(hasDiscovery(searchSchema.parse({ minPrice: '0' }))).toBe(true);
  });
  it.each([{ q: 'a'.repeat(121) }, { page: '1001' }, { pageSize: '101' }, { page: '1.2' }, { q: ['one', 'two'] },
    { category: 'Invalid' }, { sort: 'featured' }, { minPrice: '-1' }, { minPrice: '1.234' }, { minPrice: '1e2' },
    { minPrice: '9', maxPrice: '8' }, { availability: 'stock' }, { unknown: 'x' }])('rejects malformed parameters %j', value => {
    expect(searchSchema.safeParse(value).success).toBe(false);
  });
  it('validates suggestion bounds', () => {
    expect(suggestionsSchema.parse({ q: ' mac ' })).toEqual({ q: 'mac', limit: 8 });
    for (const value of [{ q: 'a' }, { q: '  ' }, { q: 'mac', limit: '11' }, { q: 'mac', limit: '0' }]) expect(suggestionsSchema.safeParse(value).success).toBe(false);
  });
  it('uses AND across tokens and filters and parameterizes hostile input', () => {
    const input = searchSchema.parse({ q: "sony %_' OR 1=1 --", category: 'headphones', brand: 'sony', availability: 'available', minPrice: '1.20', maxPrice: '9999999999.99' });
    const where = searchWhere(input);
    expect(where.text).not.toContain(input.q);
    expect(where.text).toContain('p."status" = \'ACTIVE\' AND c."isActive" = true');
    expect(where.text).toContain('COALESCE(i."quantity", 0) > 0');
    expect(where.text).toContain('EXISTS (SELECT 1 FROM "product_specifications" ps');
    for (const field of ['group', 'name', 'value']) expect(where.text).toContain(`ps."${field}" ILIKE`);
    for (const field of ['name', 'sku', 'modelNumber', 'description']) expect(where.text).toContain(`p."${field}" ILIKE`);
    expect(where.text).toContain('b."name" ILIKE'); expect(where.text).toContain('c."name" ILIKE');
    expect(where.values).toContain('sony'); expect(where.values).toContain('headphones');
    expect(escapeLike('%_\\')).toBe('\\%\\_\\\\');
    expect(escapeRegex('a+b[1]')).toBe('a\\+b\\[1\\]');
    expect(where.text.match(/ AND /g)?.length).toBeGreaterThan(5);
  });
  it('matches one- and two-character tokens as complete terms, not accidental substrings', () => {
    const where = searchWhere(searchSchema.parse({ q: 'tt' }));
    expect(where.text).toContain('~*');
    expect(where.values).toContain('(^|[^[:alpha:]])tt([^[:alpha:]]|$)');
    expect(searchWhere(searchSchema.parse({ q: 'mm' })).values).toContain('(^|[^[:alpha:]])mm([^[:alpha:]]|$)');
    expect(where.values).not.toContain('%tt%');
  });
  it('matches specifications through EXISTS without joining or duplicating products', () => {
    const where = searchWhere(searchSchema.parse({ q: '16gb bluetooth' }));
    expect(where.text.match(/EXISTS \(SELECT 1 FROM "product_specifications"/g)).toHaveLength(2);
    expect(where.text).not.toContain('JOIN "product_specifications"');
    expect(where.values).toEqual(expect.arrayContaining(['%16gb%', '%bluetooth%']));
  });
  it('covers unavailable/missing stock, exact Decimal bounds and deterministic sorts', () => {
    expect(searchWhere(searchSchema.parse({ availability: 'unavailable' })).text).toContain('COALESCE(i."quantity", 0) <= 0');
    for (const sort of ['price-asc', 'price-desc', 'newest', 'name-asc', 'relevance']) {
      const order = searchOrder(searchSchema.parse({ q: 'mac', sort }));
      expect(order.text).toContain('p."id" ASC');
      if (sort.startsWith('price')) expect(order.text).toContain('p."price"');
    }
    const rank = relevance('mac');
    for (let priority = 0; priority <= 5; priority++) expect(rank.text).toContain(`THEN ${priority}`);
    expect(rank.values).toContain('mac%'); expect(rank.values).toContain('%mac%');
  });
});
describe('Search services', () => {
  it('returns a bounded newest-first catalog page for an empty query', async () => {
    database.$queryRaw.mockResolvedValueOnce([fixture('catalog-item')]);
    const result = await new SearchService().products(searchSchema.parse({}));
    expect(result.data.map(value => value.id)).toEqual(['catalog-item']);
    expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    expect(database.$queryRaw.mock.calls[0][0].text).toContain('p."createdAt" DESC, p."id" ASC');
    expect(database.$queryRaw.mock.calls[0][0].values.slice(-2)).toEqual([20, 0]);
    expect(database.$queryRaw).toHaveBeenCalledTimes(1);
    expect(database.$queryRaw.mock.calls[0][0].text).toContain('GROUP BY r."productId"');
  });
  it('hydrates bounded IDs in rank order with canonical exact money and nullable brand', async () => {
    database.$queryRaw.mockResolvedValueOnce([fixture('first', 21n), fixture('second', 21n)]);
    const result = await new SearchService().products(searchSchema.parse({ q: 'macbook', pageSize: '2', page: '2' }));
    expect(result.data.map(value => value.id)).toEqual(['first', 'second']);
    expect(result.data[0]).toMatchObject({ price: '9999999999.99', brand: null, primaryImage: null, availability: 'UNAVAILABLE' });
    expect(result.data[0]).not.toHaveProperty('inventory');
    expect(result.meta).toEqual({ page: 2, pageSize: 2, total: 21, totalPages: 11 });
    expect(database.$queryRaw.mock.calls[0][0].values.slice(-2)).toEqual([2, 2]);
  });
  it('returns empty beyond-end pages without product hydration', async () => {
    database.$queryRaw.mockResolvedValueOnce([{ total: 0n, id: null }]);
    expect((await new SearchService().products(searchSchema.parse({ category: 'laptops' }))).data).toEqual([]);
    expect(database.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it('returns bounded typed suggestions without internal fields', async () => {
    const suggestions = [{ id: 'one', type: 'PRODUCT', label: 'MacBook', slug: 'macbook' }];
    database.$queryRaw.mockResolvedValue(suggestions);
    expect(await new SearchService().suggestions('mac', 8)).toEqual({ data: suggestions });
    const sql = database.$queryRaw.mock.calls[0][0];
    expect(sql.text).toContain('UNION ALL'); expect(sql.text).toContain('c."isActive" = true');
    expect(sql.text).toContain('product_specifications'); expect(sql.text).toContain('ps."value" ILIKE');
    expect(sql.text.match(/EXISTS \(SELECT 1 FROM "product_specifications"/g)).toHaveLength(2);
    expect(sql.text).not.toContain('quantity'); expect(sql.values.at(-1)).toBe(8);
  });
});
describe('Search API', () => {
  const app = express(); app.set('trust proxy', 1); app.use('/api/search', routes); app.use(errorHandler);
  it('serves search and suggestion envelopes', async () => {
    database.$queryRaw.mockResolvedValueOnce([{ total: 0n, id: null }]);
    expect((await request(app).get('/api/search/products')).body.meta.totalPages).toBe(0);
    database.$queryRaw.mockResolvedValue([]);
    expect((await request(app).get('/api/search/suggestions?q=mac')).body).toEqual({ data: [] });
  });
  it.each(['/products?page=1001', '/products?sort=featured', '/products?q=a&q=b', '/suggestions?q=a', '/suggestions?q=mac&limit=11'])('returns controlled 400 for %s', async path => {
    const response = await request(app).get(`/api/search${path}`);
    expect(response.status).toBe(400); expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
  it('sanitizes unexpected failures', async () => {
    database.$queryRaw.mockRejectedValue(new Error('Prisma SQL path private'));
    const response = await request(app).get('/api/search/products?q=mac');
    expect(response.status).toBe(500); expect(response.body.error.message).toBe('Something went wrong. Please try again later.');
    expect(JSON.stringify(response.body)).not.toMatch(/Prisma|SQL|private/);
  });
  it('documents both search routes without replacing product routes', () => {
    expect(swaggerSpec).toMatchObject({ paths: { '/search/products': { get: {} }, '/search/suggestions': { get: {} }, '/products': { get: {} } } });
  });
  it('throttles excessive public searches with structured 429', async () => {
    for (let count = 0; count < 120; count++) await request(app).get('/api/search/products').set('X-Forwarded-For', '192.0.2.10');
    const response = await request(app).get('/api/search/products').set('X-Forwarded-For', '192.0.2.10');
    expect(response.status).toBe(429); expect(response.body.error.code).toBe('RATE_LIMITED');
  }, 15000);
});
