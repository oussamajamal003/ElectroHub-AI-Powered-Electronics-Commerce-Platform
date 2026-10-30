import express, { type NextFunction, type Request, type Response } from 'express';
import request, { type Test } from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import routes from './recommendation.routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { requestId } from '../middleware/requestId.js';
import { issueImpressionToken, verifyImpressionToken } from '../services/recommendation-token.js';

const ids = vi.hoisted(() => ({ customer: '9de3d92a-d180-41f2-8bd1-ad6f9a6d1e99' }));
const service = vi.hoisted(() => ({
  productSections: vi.fn(), popular: vi.fn(), forCart: vi.fn(), forUser: vi.fn(), preferences: vi.fn(), setPreferences: vi.fn(),
  recentlyViewed: vi.fn(), removeRecentlyViewed: vi.fn(), clearRecentlyViewed: vi.fn(), recordInteraction: vi.fn(), recordEvents: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, logSafely: vi.fn() }));
// Real exports (limits and constants) stay in place; only the service instance is replaced.
vi.mock('../services/recommendation.service.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/recommendation.service.js')>()),
  recommendationService: service,
}));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!req.headers.authorization) { res.status(401).json({ error: 'Unauthenticated' }); return; }
    req.user = { userId: ids.customer, role: req.headers.authorization === 'admin' ? 'ADMIN' : 'CUSTOMER' };
    next();
  },
  requireRole: (required: string) => (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role !== required) { res.status(403).json({ error: 'Forbidden: Insufficient permissions' }); return; }
    next();
  },
}));

const app = express();
app.use(express.json());
app.use(requestId);
app.use('/api', routes);
app.use(errorHandler);

const PRODUCT = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const OTHER_USER = '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11';
const uuidFor = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const customerAuth = (req: Test) => req.set('Authorization', 'customer');

beforeEach(() => {
  vi.clearAllMocks();
  service.productSections.mockResolvedValue({ sections: [] });
  service.forUser.mockResolvedValue({ mode: 'RECOMMENDED_FOR_YOU', items: [] });
  service.forCart.mockResolvedValue({ mode: 'FREQUENTLY_BOUGHT_TOGETHER', items: [] });
  service.preferences.mockResolvedValue({ personalizationEnabled: false, updatedAt: null });
  service.setPreferences.mockResolvedValue({ personalizationEnabled: false, updatedAt: null });
  service.clearRecentlyViewed.mockResolvedValue(undefined);
  service.removeRecentlyViewed.mockResolvedValue(undefined);
  service.recordInteraction.mockResolvedValue({ recorded: true, reason: null });
  service.recordEvents.mockResolvedValue({ accepted: 1 });
});

describe('GET /api/products/:slug/recommendations', () => {
  it('rejects a bad slug, out-of-range limits, a non-numeric limit and unknown query keys with 400', async () => {
    const paths = [
      '/api/products/Bad_Slug/recommendations',
      '/api/products/good-slug/recommendations?limit=0',
      '/api/products/good-slug/recommendations?limit=13',
      '/api/products/good-slug/recommendations?limit=abc',
      '/api/products/good-slug/recommendations?userId=someone',
    ];
    for (const path of paths) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(service.productSections).not.toHaveBeenCalled();
  });

  it('prevents caching of attribution batches, uses the default limit, and returns the service payload', async () => {
    service.productSections.mockResolvedValue({ sections: [{ mode: 'SIMILAR_PRODUCTS' }] });
    const res = await request(app).get('/api/products/good-slug/recommendations');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(service.productSections).toHaveBeenCalledWith('good-slug', 4, expect.any(String));
    expect(res.body).toEqual({ data: { sections: [{ mode: 'SIMILAR_PRODUCTS' }] } });
  });

  it('accepts the maximum limit of 12', async () => {
    expect((await request(app).get('/api/products/good-slug/recommendations?limit=12')).status).toBe(200);
    expect(service.productSections).toHaveBeenCalledWith('good-slug', 12, expect.any(String));
  });
});

describe('GET /api/me/recommendations', () => {
  it('requires a customer session: 401 when anonymous and 403 for an administrator, both private', async () => {
    const anonymous = await request(app).get('/api/me/recommendations');
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers['cache-control']).toBe('private, no-store');
    const admin = await request(app).get('/api/me/recommendations').set('Authorization', 'admin');
    expect(admin.status).toBe(403);
    expect(service.forUser).not.toHaveBeenCalled();
  });

  it('derives the user from the session, never from the query string, and sends private headers', async () => {
    const spoofed = await customerAuth(request(app).get(`/api/me/recommendations?userId=${OTHER_USER}`));
    expect(spoofed.status).toBe(400);
    expect(service.forUser).not.toHaveBeenCalled();

    const res = await customerAuth(request(app).get('/api/me/recommendations?limit=3'));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers.vary).toBe('Authorization');
    expect(service.forUser).toHaveBeenCalledTimes(1);
    expect(service.forUser).toHaveBeenCalledWith(ids.customer, 3, expect.any(String));
  });
});

describe('attribution response caching', () => {
  it('issues independent non-cacheable batches to separate clients for the same product', async () => {
    service.productSections.mockImplementation(async () => ({ sections: [{
      impressionToken: issueImpressionToken({ mode: 'SIMILAR_PRODUCTS', strategy: 'EMBEDDING_SIMILARITY',
        surface: 'product_detail', productIds: [PRODUCT] }),
    }] }));
    const first = await request(app).get('/api/products/good-slug/recommendations');
    const second = await request(app).get('/api/products/good-slug/recommendations');
    expect(first.headers['cache-control']).toBe('private, no-store');
    expect(second.headers['cache-control']).toBe('private, no-store');
    const a = verifyImpressionToken(first.body.data.sections[0].impressionToken);
    const b = verifyImpressionToken(second.body.data.sections[0].impressionToken);
    expect(a?.productIds).toEqual([PRODUCT]);
    expect(b?.productIds).toEqual([PRODUCT]);
    expect(a?.batchId).toBeTruthy();
    expect(b?.batchId).toBeTruthy();
    expect(a?.batchId).not.toBe(b?.batchId);
  });

  it('also disables caching for popular recommendation batches', async () => {
    service.popular.mockResolvedValue({ items: [] });
    const res = await request(app).get('/api/recommendations/popular');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
});

describe('product interactions', () => {
  const body = { productId: PRODUCT, eventType: 'VIEW', surface: 'product_detail', idempotencyKey: 'view-2026-10-28-01' };
  const post = (payload: Record<string, unknown>) => customerAuth(request(app).post('/api/product-interactions')).send(payload);

  it('requires authentication', async () => {
    expect((await request(app).post('/api/product-interactions').send(body)).status).toBe(401);
    expect(service.recordInteraction).not.toHaveBeenCalled();
  });

  it('rejects a client-sent userId, the PURCHASE event type and malformed idempotency keys with 400', async () => {
    expect((await post({ ...body, userId: OTHER_USER })).status).toBe(400);
    expect((await post({ ...body, eventType: 'PURCHASE' })).status).toBe(400);
    expect((await post({ ...body, idempotencyKey: 'bad key!' })).status).toBe(400);
    expect(service.recordInteraction).not.toHaveBeenCalled();
  });

  it('records the event for the session user with 201, and 200 for a duplicate', async () => {
    const created = await post(body);
    expect(created.status).toBe(201);
    expect(service.recordInteraction).toHaveBeenCalledWith(ids.customer, body);
    service.recordInteraction.mockResolvedValueOnce({ recorded: false, reason: 'DUPLICATE' });
    expect((await post(body)).status).toBe(200);
  });
});

describe('recommendation events', () => {
  const token = 'token-with-enough-length-0123456789';
  const event = { productId: PRODUCT, type: 'IMPRESSION' };
  const post = (payload: Record<string, unknown>) => request(app).post('/api/recommendations/events').send(payload);

  it('caps a batch at 24 events and rejects unknown types, empty batches and short tokens', async () => {
    const many = Array.from({ length: 25 }, () => event);
    expect((await post({ token, events: many })).status).toBe(400);
    expect((await post({ token, events: [{ productId: PRODUCT, type: 'PURCHASE' }] })).status).toBe(400);
    expect((await post({ token, events: [] })).status).toBe(400);
    expect((await post({ token: 'short', events: [event] })).status).toBe(400);
    expect(service.recordEvents).not.toHaveBeenCalled();
  });

  it('accepts a full batch of 24 with 202, normalising product ids to lowercase', async () => {
    const full = Array.from({ length: 24 }, () => event);
    expect((await post({ token, events: full })).status).toBe(202);
    expect(service.recordEvents).toHaveBeenLastCalledWith(token, full);

    service.recordEvents.mockResolvedValueOnce({ accepted: 1 });
    const res = await post({ token, events: [{ productId: PRODUCT.toUpperCase(), type: 'CLICK' }] });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ data: { accepted: 1 } });
    expect(service.recordEvents).toHaveBeenLastCalledWith(token, [{ productId: PRODUCT, type: 'CLICK' }]);
  });
});

describe('cart recommendations', () => {
  const post = (payload: Record<string, unknown>) => request(app).post('/api/recommendations/cart').send(payload);

  it('rejects more than 50 products, non-UUID ids, empty carts and extra fields with 400', async () => {
    const tooMany = Array.from({ length: 51 }, (_, index) => uuidFor(index + 1));
    expect((await post({ productIds: tooMany })).status).toBe(400);
    expect((await post({ productIds: ['not-a-uuid'] })).status).toBe(400);
    expect((await post({ productIds: [] })).status).toBe(400);
    expect((await post({ productIds: [PRODUCT], userId: OTHER_USER })).status).toBe(400);
    expect(service.forCart).not.toHaveBeenCalled();
  });

  it('answers with private no-store, deduplicates ids, and accepts exactly 50 unique products', async () => {
    const res = await post({ productIds: [uuidFor(1), uuidFor(1), uuidFor(2)] });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(service.forCart).toHaveBeenLastCalledWith([uuidFor(1), uuidFor(2)], 4);

    const fifty = Array.from({ length: 50 }, (_, index) => uuidFor(index + 1));
    expect((await post({ productIds: fifty })).status).toBe(200);
    expect(service.forCart).toHaveBeenLastCalledWith(fifty, 4);
  });
});

describe('recommendation preferences', () => {
  const patch = (payload: Record<string, unknown>) => customerAuth(request(app).patch('/api/me/recommendation-preferences')).send(payload);

  it('requires authentication and a strict boolean personalizationEnabled', async () => {
    expect((await request(app).patch('/api/me/recommendation-preferences').send({ personalizationEnabled: true })).status).toBe(401);
    expect((await patch({ personalizationEnabled: 'yes' })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ personalizationEnabled: true, userId: OTHER_USER })).status).toBe(400);
    expect(service.setPreferences).not.toHaveBeenCalled();
  });

  it('saves a boolean choice for the session user', async () => {
    const res = await patch({ personalizationEnabled: false });
    expect(res.status).toBe(200);
    expect(service.setPreferences).toHaveBeenCalledWith(ids.customer, false);
  });
});

describe('recently viewed', () => {
  it('removes one product for the session user and rejects unauthenticated or malformed requests', async () => {
    const path = `/api/me/recently-viewed/${PRODUCT}`;
    expect((await request(app).delete(path)).status).toBe(401);
    expect((await customerAuth(request(app).delete('/api/me/recently-viewed/not-a-uuid'))).status).toBe(400);
    expect(service.removeRecentlyViewed).not.toHaveBeenCalled();

    const res = await customerAuth(request(app).delete(path));
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(service.removeRecentlyViewed).toHaveBeenCalledWith(ids.customer, PRODUCT);
  });

  it('clears the list with 204 for the session user and requires authentication', async () => {
    expect((await request(app).delete('/api/me/recently-viewed')).status).toBe(401);
    const res = await customerAuth(request(app).delete('/api/me/recently-viewed'));
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(service.clearRecentlyViewed).toHaveBeenCalledWith(ids.customer);
  });
});
