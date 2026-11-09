import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  overview: vi.fn(), products: vi.fn(), categories: vi.fn(), inventory: vi.fn(), recommendations: vi.fn(),
  imageSearch: vi.fn(), deliveries: vi.fn(), customers: vi.fn(),
}));
vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../services/admin-analytics.service.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/admin-analytics.service.js')>();
  return { ...actual, adminAnalyticsService: service };
});
vi.mock('../middleware/adminGuard.js', () => ({
  // Stand-in for the shared chain (covered by the guard's own tests): role is taken from a test header.
  adminGuard: [
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const role = req.headers['x-test-role'];
      if (!role) { res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in.' } }); return; }
      if (role !== 'ADMIN') { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No.' } }); return; }
      res.set('Cache-Control', 'private, no-store');
      next();
    },
  ],
}));

import analyticsRoutes from './admin-analytics.routes.js';

const envelope = { data: {}, meta: { period: '30d', timezone: 'UTC' } };
const endpoints = ['overview', 'products', 'categories', 'inventory', 'recommendations', 'image-search', 'deliveries', 'customers'] as const;
const serviceFor = {
  overview: service.overview, products: service.products, categories: service.categories, inventory: service.inventory,
  recommendations: service.recommendations, 'image-search': service.imageSearch, deliveries: service.deliveries, customers: service.customers,
};

const app = express();
app.use('/api', analyticsRoutes);

beforeEach(() => {
  vi.resetAllMocks();
  for (const fn of Object.values(serviceFor)) fn.mockResolvedValue(envelope);
});

describe('admin analytics API authorization', () => {
  it('rejects every endpoint without a session before any service call', async () => {
    for (const path of endpoints) expect((await request(app).get(`/api/admin/analytics/${path}`)).status, path).toBe(401);
    for (const fn of Object.values(serviceFor)) expect(fn).not.toHaveBeenCalled();
  });

  it('rejects a non-administrator (403) and serves an ADMIN with private, no-store responses', async () => {
    for (const path of endpoints) expect((await request(app).get(`/api/admin/analytics/${path}`).set('x-test-role', 'CUSTOMER')).status).toBe(403);
    expect(service.overview).not.toHaveBeenCalled();
    const response = await request(app).get('/api/admin/analytics/overview').set('x-test-role', 'ADMIN');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toEqual(envelope);
  });
});

describe('admin analytics API query validation', () => {
  it('defaults to 30d and accepts each whitelisted period', async () => {
    await request(app).get('/api/admin/analytics/overview').set('x-test-role', 'ADMIN');
    expect(service.overview).toHaveBeenLastCalledWith('30d');
    for (const period of ['7d', '30d', '90d', '12m']) {
      const response = await request(app).get(`/api/admin/analytics/products?period=${period}`).set('x-test-role', 'ADMIN');
      expect(response.status).toBe(200);
      expect(service.products).toHaveBeenLastCalledWith(period);
    }
  });

  it('rejects unsupported periods and unknown parameters with 400 before any query runs', async () => {
    for (const query of ['period=1y', 'period=', 'period=30d&userId=1', 'period=30d&currency=USD', 'PERIOD=7d']) {
      const response = await request(app).get(`/api/admin/analytics/overview?${query}`).set('x-test-role', 'ADMIN');
      expect(response.status, query).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
    expect(service.overview).not.toHaveBeenCalled();
  });

  it('answers 500 through the error path without leaking internals when a single panel fails', async () => {
    service.imageSearch.mockRejectedValue(new Error('relation analytics_events does not exist'));
    const response = await request(app).get('/api/admin/analytics/image-search').set('x-test-role', 'ADMIN');
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('analytics_events');
    expect((await request(app).get('/api/admin/analytics/products').set('x-test-role', 'ADMIN')).status).toBe(200);
  });
});
