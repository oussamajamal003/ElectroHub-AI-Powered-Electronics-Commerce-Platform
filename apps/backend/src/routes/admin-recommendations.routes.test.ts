import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import adminRecommendationsRoutes from './admin-recommendations.routes.js';
import { AppError, errorHandler } from '../middleware/errorHandler.js';
import { generateAccessToken } from '../utils/jwt.js';

const ids = vi.hoisted(() => ({ admin: '8f2813b4-a388-44d3-b51e-5d4c40386677', pin: '5a9ff5e6-9d4c-4dbe-9b8c-6f2b5d4e3a55',
  product: '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11', role: 'ADMIN', active: true }));
const db = vi.hoisted(() => ({ user: { findFirst: vi.fn() } }));
const sessions = vi.hoisted(() => ({ session: '5a1e2c3d-4b5f-4a6b-8c7d-9e0f1a2b3c4d', find: vi.fn() }));
const service = vi.hoisted(() => ({ overview: vi.fn(), configurations: vi.fn(), updateSection: vi.fn(), preview: vi.fn(),
  listPins: vi.fn(), createPin: vi.fn(), updatePin: vi.fn(), deletePin: vi.fn() }));

vi.mock('../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../services/admin-session.js', () => ({ findActiveAdminSession: sessions.find, touchAdminSession: vi.fn(), hasRecentStepUp: vi.fn(() => true) }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, logSafely: vi.fn() }));
vi.mock('../services/recommendation-admin.service.js', () => ({ recommendationAdminService: service }));

const app = express();
app.use(express.json());
app.use('/api', adminRecommendationsRoutes);
app.use(errorHandler);

const token = (role = 'ADMIN') => generateAccessToken(role === 'ADMIN'
  ? { userId: ids.admin, role, sessionId: sessions.session } : { userId: ids.admin, role });
const as = <T extends request.Test>(test: T, role = 'ADMIN') => test.auth(token(role), { type: 'bearer' });

const configRow = { surface: 'home', mode: 'POPULAR_PRODUCTS', enabled: true, itemLimit: 12, version: 2, updatedAt: null, configured: true };
const pinView = { id: ids.pin, productId: ids.product, surface: 'home', position: 0, startsAt: null, endsAt: null, enabled: true, version: 1, state: 'ACTIVE' };

beforeEach(() => {
  vi.resetAllMocks();
  ids.role = 'ADMIN'; ids.active = true;
  db.user.findFirst.mockImplementation(async () => (ids.active ? { id: ids.admin, role: { name: ids.role } } : null));
  sessions.find.mockResolvedValue({ familyId: sessions.session, userId: ids.admin } as never);
});

describe('admin recommendation routes authorization', () => {
  it('rejects every route without a token (401) before any service call', async () => {
    const paths = ['/api/admin/recommendations/overview', '/api/admin/recommendations/configurations', '/api/admin/recommendations/featured'];
    for (const path of paths) expect((await request(app).get(path)).status, path).toBe(401);
    expect((await request(app).post('/api/admin/recommendations/featured').send({})).status).toBe(401);
    expect(service.createPin).not.toHaveBeenCalled();
    expect(service.updateSection).not.toHaveBeenCalled();
  });

  it('rejects a CUSTOMER even when the token claims ADMIN: the database role decides (403)', async () => {
    ids.role = 'CUSTOMER';
    expect((await as(request(app).get('/api/admin/recommendations/overview'))).status).toBe(403);
    expect((await as(request(app).patch(`/api/admin/recommendations/configurations/home/POPULAR_PRODUCTS`).send({ enabled: false, expectedVersion: 0 }))).status).toBe(403);
    expect(service.overview).not.toHaveBeenCalled();
    expect(service.updateSection).not.toHaveBeenCalled();
  });

  it('serves private, non-cacheable responses to an administrator', async () => {
    service.overview.mockResolvedValue({ totals: {}, breakdown: [] });
    const response = await as(request(app).get('/api/admin/recommendations/overview'));
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
});

describe('admin recommendation routes', () => {
  it('returns the overview inside the data envelope and validates the period and surface query', async () => {
    service.overview.mockResolvedValue({ period: '30d', totals: { impressions: 0 }, breakdown: [] });
    const ok = await as(request(app).get('/api/admin/recommendations/overview?period=30d&surface=home'));
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ period: '30d' });
    expect(service.overview).toHaveBeenCalledWith('30d', 'home');

    const bad = await as(request(app).get('/api/admin/recommendations/overview?period=1y'));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(service.overview).toHaveBeenCalledTimes(1);
  });

  it('lists configurations with the matrix returned by the service', async () => {
    service.configurations.mockResolvedValue([configRow]);
    const response = await as(request(app).get('/api/admin/recommendations/configurations'));
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([configRow]);
  });

  it('answers 400 for an unsupported surface/mode pair or a non-strict body, without calling the service', async () => {
    const badMode = await as(request(app).patch('/api/admin/recommendations/configurations/home/NOT_A_MODE').send({ enabled: false, expectedVersion: 0 }));
    expect(badMode.status).toBe(400);
    expect(badMode.body.error.code).toBe('VALIDATION_ERROR');

    const extra = await as(request(app).patch('/api/admin/recommendations/configurations/home/POPULAR_PRODUCTS').send({ enabled: false, expectedVersion: 0, role: 'ADMIN' }));
    expect(extra.status).toBe(400);

    const empty = await as(request(app).patch('/api/admin/recommendations/configurations/home/POPULAR_PRODUCTS').send({ expectedVersion: 0 }));
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');

    const overLimit = await as(request(app).patch('/api/admin/recommendations/configurations/home/POPULAR_PRODUCTS').send({ itemLimit: 13, expectedVersion: 0 }));
    expect(overLimit.status).toBe(400);
    expect(service.updateSection).not.toHaveBeenCalled();
  });

  it('updates a section and returns the new version', async () => {
    service.updateSection.mockResolvedValue({ ...configRow, enabled: false, version: 3 });
    const response = await as(request(app).patch('/api/admin/recommendations/configurations/home/POPULAR_PRODUCTS')
      .send({ enabled: false, expectedVersion: 2 }));
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ enabled: false, version: 3 });
    expect(service.updateSection).toHaveBeenCalledWith('home', 'POPULAR_PRODUCTS', { enabled: false, expectedVersion: 2 },
      expect.objectContaining({ userId: ids.admin }));
  });

  it('maps a stale section version to 409 VERSION_CONFLICT', async () => {
    service.updateSection.mockRejectedValue(new AppError('This section changed. Reload and try again.', 409, 'VERSION_CONFLICT'));
    const response = await as(request(app).patch('/api/admin/recommendations/configurations/home/POPULAR_PRODUCTS')
      .send({ enabled: false, expectedVersion: 1 }));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('previews without a write and rejects a missing preview product with 400', async () => {
    service.preview.mockResolvedValue({ recorded: false, sections: [] });
    const ok = await as(request(app).get('/api/admin/recommendations/preview?surface=home&limit=4'));
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ recorded: false });
    expect(service.preview).toHaveBeenCalledWith(expect.objectContaining({ surface: 'home', limit: 4 }));

    const bad = await as(request(app).get('/api/admin/recommendations/preview?surface=home&limit=99'));
    expect(bad.status).toBe(400);
  });

  it('lists featured pins with the per-surface maximum in meta', async () => {
    service.listPins.mockResolvedValue([pinView]);
    const response = await as(request(app).get('/api/admin/recommendations/featured?surface=home'));
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([pinView]);
    expect(response.body.meta).toEqual({ maxPerSurface: 8 });
  });

  it('creates a pin with 201 and passes the server-resolved actor', async () => {
    service.createPin.mockResolvedValue(pinView);
    const response = await as(request(app).post('/api/admin/recommendations/featured')
      .send({ productId: ids.product, surface: 'home', position: 0, enabled: true }));
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ id: ids.pin, state: 'ACTIVE' });
    expect(service.createPin).toHaveBeenCalledWith(expect.objectContaining({ productId: ids.product, startsAt: null, endsAt: null }),
      expect.objectContaining({ userId: ids.admin }));
  });

  it('rejects a pin without a valid product id or with an unknown field (400) and never trusts a client role', async () => {
    const noProduct = await as(request(app).post('/api/admin/recommendations/featured').send({ surface: 'home' }));
    expect(noProduct.status).toBe(400);
    const smuggled = await as(request(app).post('/api/admin/recommendations/featured')
      .send({ productId: ids.product, surface: 'home', userId: 'someone-else' }));
    expect(smuggled.status).toBe(400);
    expect(service.createPin).not.toHaveBeenCalled();
  });

  it('answers 409 PIN_EXISTS and 422 PRODUCT_NOT_ELIGIBLE from the service unchanged', async () => {
    service.createPin.mockRejectedValueOnce(new AppError('Already pinned here.', 409, 'PIN_EXISTS'));
    const exists = await as(request(app).post('/api/admin/recommendations/featured').send({ productId: ids.product, surface: 'home' }));
    expect(exists.status).toBe(409);
    expect(exists.body.error.code).toBe('PIN_EXISTS');

    service.createPin.mockRejectedValueOnce(new AppError('Not eligible.', 422, 'PRODUCT_NOT_ELIGIBLE'));
    const ineligible = await as(request(app).post('/api/admin/recommendations/featured').send({ productId: ids.product, surface: 'home' }));
    expect(ineligible.status).toBe(422);
  });

  it('updates a pin with a version guard and deletes it with 204', async () => {
    service.updatePin.mockResolvedValue({ ...pinView, position: 2, version: 2 });
    const patched = await as(request(app).patch(`/api/admin/recommendations/featured/${ids.pin}`).send({ expectedVersion: 1, position: 2 }));
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ position: 2, version: 2 });

    const noChange = await as(request(app).patch(`/api/admin/recommendations/featured/${ids.pin}`).send({ expectedVersion: 1 }));
    expect(noChange.status).toBe(400);

    service.deletePin.mockResolvedValue(undefined);
    const deleted = await as(request(app).delete(`/api/admin/recommendations/featured/${ids.pin}?expectedVersion=2`));
    expect(deleted.status).toBe(204);
    expect(service.deletePin).toHaveBeenCalledWith(ids.pin, expect.objectContaining({ userId: ids.admin }), 2);
  });

  it('rejects a malformed pin id before the service is reached', async () => {
    const response = await as(request(app).patch('/api/admin/recommendations/featured/not-a-uuid').send({ expectedVersion: 1, position: 1 }));
    expect(response.status).toBe(400);
    expect(service.updatePin).not.toHaveBeenCalled();
  });
});
