import express from 'express';
import request, { type Test } from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import routes from './search.routes.js';
import { requestId } from '../middleware/requestId.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { IMAGE_SEARCH_MAX_BYTES } from '../middleware/imageSearchUpload.js';
import { AiServiceError, type ImageSearchInput } from '../integrations/ai/ai.client.js';
import { logger } from '../utils/logger.js';

/** winston's LogMethod overloads do not expose call tuples; tests read them through this narrow view. */
const callsOf = (spy: unknown) => (spy as { mock: { calls: unknown[][] } }).mock.calls;

const database = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: database }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, logSafely: vi.fn() }));
// The per-IP limiter has its own file (search.image.ratelimit.test.ts); here every test needs a fresh budget.
vi.mock('../middleware/rateLimiter.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../middleware/rateLimiter.js')>()),
  imageSearchRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
const ai = vi.hoisted(() => ({
  client: null as null | { imageSearch: ReturnType<typeof vi.fn> },
}));
vi.mock('../integrations/ai/ai.client.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../integrations/ai/ai.client.js')>()),
  getAiServiceClient: () => ai.client,
}));

const P1 = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const P2 = '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11';
const P3 = '2d6cc2b3-6a1f-4a8b-8e5f-3c9e2a1b0d22';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
const MAX_JPEG = Buffer.concat([JPEG, Buffer.alloc(IMAGE_SEARCH_MAX_BYTES - JPEG.length)]);

const app = express();
app.use(requestId);
app.use('/api/search', routes);
app.use(errorHandler);

const row = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, name: `Product ${id.slice(0, 4)}`, slug: `product-${id.slice(0, 4)}`, price: '1299.50', compareAtPrice: null,
  description: 'Desc', quantity: 4, lowStockAt: 2, category: { id: 'c', name: 'Laptops', slug: 'laptops' },
  brand: null, images: [], reviewCount: 0n, averageRating: null, ...overrides,
});
const aiResult = (productIds: string[]) => ({
  matches: productIds.map((productId, index) => ({ productId, score: 0.9 - index * 0.1, rank: index + 1 })),
  modelVersion: 'clip-v1.0', embeddingVersion: 'emb_2026.10',
});

function queryArgs() {
  const [call] = database.$queryRaw.mock.calls[0] as [{ text: string; values: unknown[] }];
  return call;
}

beforeEach(() => {
  vi.resetAllMocks();
  ai.client = { imageSearch: vi.fn().mockResolvedValue(aiResult([])) };
  database.$queryRaw.mockResolvedValue([]);
});

describe('POST /api/search/image upload validation', () => {
  it('requires exactly one image part', async () => {
    const res = await request(app).post('/api/search/image').send({ image: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IMAGE_REQUIRED');
    expect(ai.client?.imageSearch).not.toHaveBeenCalled();
  });

  it('rejects an empty file as missing', async () => {
    const res = await request(app).post('/api/search/image').attach('image', Buffer.alloc(0), { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IMAGE_REQUIRED');
  });

  it.each([
    ['two files', (r: Test) => r.attach('image', JPEG, 'a.jpg').attach('image', JPEG, 'b.jpg')],
    ['a file in another field', (r: Test) => r.attach('photo', JPEG, 'a.jpg')],
    ['an extra text field', (r: Test) => r.attach('image', JPEG, 'a.jpg').field('note', 'hello')],
  ])('rejects %s with 400 before any upstream call', async (_label, build) => {
    const res = await build(request(app).post('/api/search/image'));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toMatch(/^IMAGE_/);
    expect(ai.client?.imageSearch).not.toHaveBeenCalled();
  });

  it('rejects a GIF disguised with an image extension using the sniffed bytes (415)', async () => {
    const res = await request(app).post('/api/search/image').attach('image', GIF, { filename: 'fake.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('IMAGE_SEARCH_UNSUPPORTED_TYPE');
    expect(ai.client?.imageSearch).not.toHaveBeenCalled();
  });

  it('accepts exactly 8 MiB and rejects one byte more with 413', async () => {
    const ok = await request(app).post('/api/search/image').attach('image', MAX_JPEG, { filename: 'max.jpg', contentType: 'image/jpeg' });
    expect(ok.status).toBe(200);
    expect(ai.client?.imageSearch).toHaveBeenCalledTimes(1);
    expect((ai.client?.imageSearch.mock.calls[0][0] as ImageSearchInput).image.byteLength).toBe(IMAGE_SEARCH_MAX_BYTES);

    const tooBig = Buffer.concat([MAX_JPEG, Buffer.from([0x00])]);
    const res = await request(app).post('/api/search/image').attach('image', tooBig, { filename: 'big.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('IMAGE_TOO_LARGE');
    expect(ai.client?.imageSearch).toHaveBeenCalledTimes(1);
  }, 30_000);

  it.each(['0', '25', 'abc', '1.5', '-3'])('rejects limit=%s', async limit => {
    const res = await request(app).post(`/api/search/image?limit=${limit}`).attach('image', JPEG, 'a.jpg');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(ai.client?.imageSearch).not.toHaveBeenCalled();
  });

  it('caps the AI call to the requested limit and sends the sniffed type with a generic upstream filename input', async () => {
    const res = await request(app).post('/api/search/image?limit=24').attach('image', PNG, { filename: 'Sony-WH1000XM5.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(ai.client?.imageSearch).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'image/png', topK: 24 }));
  });

  it('uses the default limit of 12 when none is supplied', async () => {
    await request(app).post('/api/search/image').attach('image', JPEG, 'a.jpg');
    expect(ai.client?.imageSearch).toHaveBeenCalledWith(expect.objectContaining({ topK: 12 }));
  });
});

describe('POST /api/search/image resolution', () => {
  it('returns catalog ProductSummary items in AI rank order using database price and stock', async () => {
    ai.client!.imageSearch.mockResolvedValue(aiResult([P3, P1]));
    database.$queryRaw.mockResolvedValue([row(P1, { price: '99.00', quantity: 0 }), row(P3, { price: '1299.50' })]);

    const res = await request(app).post('/api/search/image').attach('image', JPEG, 'a.jpg');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.items.map((item: { id: string }) => item.id)).toEqual([P3, P1]);
    expect(res.body.data.items[0]).toMatchObject({ id: P3, price: '1299.50', currency: 'USD', availability: 'AVAILABLE' });
    // Out of stock stays visible with an honest state; the price is the database value, not an AI-provided one.
    expect(res.body.data.items[1]).toMatchObject({ id: P1, price: '99.00', availability: 'UNAVAILABLE' });
    expect(res.body.data.items[0]).not.toHaveProperty('score');
    expect(res.body.data.items[0]).not.toHaveProperty('rank');
    expect(res.body.meta).toEqual({ modelVersion: 'clip-v1.0', embeddingVersion: 'emb_2026.10', count: 2 });
  });

  it('drops hidden, unknown and forged ids, keeps the rest in order, and logs counts only', async () => {
    const forged = '3e4d5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b';
    ai.client!.imageSearch.mockResolvedValue(aiResult([P1, P2, P3]));
    // P2 is hidden or inactive: the database never returns it. The forged row was never requested and must be ignored.
    database.$queryRaw.mockResolvedValue([row(P3), row(P1), row(forged)]);

    const res = await request(app).post('/api/search/image').attach('image', JPEG, 'a.jpg');

    expect(res.status).toBe(200);
    expect(res.body.data.items.map((item: { id: string }) => item.id)).toEqual([P1, P3]);
    expect(res.body.meta.count).toBe(2);
    const resolved = callsOf(logger.info).find(([event]) => event === 'IMAGE_SEARCH_RESOLVED');
    expect(resolved?.[1]).toMatchObject({ candidateCount: 3, resultCount: 2, droppedCount: 1 });
    expect(JSON.stringify(resolved)).not.toContain(P1);
  });

  it('uses one bounded query with the shared storefront visibility rule and dedupes candidate ids', async () => {
    ai.client!.imageSearch.mockResolvedValue(aiResult([P1, P1, P2]));
    database.$queryRaw.mockResolvedValue([row(P1), row(P2)]);

    const res = await request(app).post('/api/search/image').attach('image', JPEG, 'a.jpg');

    expect(res.status).toBe(200);
    expect(database.$queryRaw).toHaveBeenCalledTimes(1);
    const { text, values } = queryArgs();
    expect(text).toContain('p."status" = \'ACTIVE\' AND p."isTestFixture" = false AND p."storefrontVisible" = true AND c."isActive" = true');
    expect(values.filter(Array.isArray)).toEqual([[P1, P2], [P1, P2]]);
    expect(res.body.data.items.map((item: { id: string }) => item.id)).toEqual([P1, P2]);
  });

  it('skips the catalog query when the AI returns no matches', async () => {
    const res = await request(app).post('/api/search/image').attach('image', JPEG, 'a.jpg');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { items: [] }, meta: { modelVersion: 'clip-v1.0', embeddingVersion: 'emb_2026.10', count: 0 } });
    expect(database.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('POST /api/search/image failure envelope', () => {
  it('reports unavailable when visual search is not configured, without touching the catalog', async () => {
    ai.client = null;
    const res = await request(app).post('/api/search/image').attach('image', JPEG, 'a.jpg');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: { code: 'IMAGE_SEARCH_UNAVAILABLE', message: expect.any(String) } });
    expect(database.$queryRaw).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, unknown>, number, string]>([
    ['timeout', {}, 504, 'IMAGE_SEARCH_TIMEOUT'],
    ['rate_limited', { statusCode: 429, retryAfterMs: 4000 }, 429, 'IMAGE_SEARCH_BUSY'],
    ['rejected', { statusCode: 413 }, 413, 'IMAGE_TOO_LARGE'],
    ['rejected', { statusCode: 415 }, 415, 'IMAGE_SEARCH_UNSUPPORTED_TYPE'],
    ['rejected', { statusCode: 422 }, 422, 'IMAGE_UNREADABLE'],
    ['rejected', { statusCode: 400 }, 503, 'IMAGE_SEARCH_UNAVAILABLE'],
    ['unavailable', { statusCode: 503 }, 503, 'IMAGE_SEARCH_UNAVAILABLE'],
    ['unavailable', { statusCode: 504 }, 504, 'IMAGE_SEARCH_TIMEOUT'],
    ['unauthorized', { statusCode: 401 }, 503, 'IMAGE_SEARCH_UNAVAILABLE'],
    ['environment_mismatch', { statusCode: 403 }, 503, 'IMAGE_SEARCH_UNAVAILABLE'],
    ['invalid_response', {}, 503, 'IMAGE_SEARCH_UNAVAILABLE'],
    ['response_too_large', {}, 503, 'IMAGE_SEARCH_UNAVAILABLE'],
    ['network', {}, 503, 'IMAGE_SEARCH_UNAVAILABLE'],
    ['connect', {}, 503, 'IMAGE_SEARCH_UNAVAILABLE'],
  ])('maps AI %s (%j) to HTTP %i %s', async (category, details, status, code) => {
    ai.client!.imageSearch.mockRejectedValue(new AiServiceError(category as ConstructorParameters<typeof AiServiceError>[0], details));
    const res = await request(app).post('/api/search/image').attach('image', JPEG, 'a.jpg');
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(JSON.stringify(res.body)).not.toMatch(/AI_SERVICE|127\.0\.0\.1|stack|at /);
  });

  it('sends Retry-After when the AI service is busy', async () => {
    ai.client!.imageSearch.mockRejectedValue(new AiServiceError('rate_limited', { statusCode: 429, retryAfterMs: 4000 }));
    const res = await request(app).post('/api/search/image').attach('image', JPEG, 'a.jpg');
    expect(res.headers['retry-after']).toBe('4');
  });

  it('falls back to a generic 500 for unexpected catalog failures without leaking details', async () => {
    database.$queryRaw.mockRejectedValue(new Error('connection to db.internal:5432 failed'));
    ai.client!.imageSearch.mockResolvedValue(aiResult([P1]));
    const res = await request(app).post('/api/search/image').attach('image', JPEG, 'a.jpg');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('db.internal');
  });

  it('stops work when the client disconnects mid-search and never writes a response', async () => {
    let observed: AbortSignal | undefined;
    ai.client!.imageSearch.mockImplementation((input: ImageSearchInput) => {
      observed = input.signal;
      return new Promise((_resolve, reject) => {
        input.signal?.addEventListener('abort', () => reject(new AiServiceError('aborted')), { once: true });
      });
    });
    const pending = request(app).post('/api/search/image').attach('image', JPEG, 'a.jpg');
    const outcome = pending.then(() => 'answered', () => 'closed');
    await vi.waitFor(() => expect(observed).toBeDefined());
    pending.abort();
    expect(await outcome).toBe('closed');
    await vi.waitFor(() => expect(observed?.aborted).toBe(true));
    expect(database.$queryRaw).not.toHaveBeenCalled();
  });
});
