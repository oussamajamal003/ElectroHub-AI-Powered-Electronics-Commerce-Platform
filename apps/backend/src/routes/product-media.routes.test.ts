import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import productMediaRoutes from './product-media.routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { generateAccessToken } from '../utils/jwt.js';

const ids = vi.hoisted(() => ({ admin: '8f2813b4-a388-44d3-b51e-5d4c40386677', product: '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11', image: '2d6cc2b3-6a1f-4a8b-8e5f-3c9e2a1b0d22', role: 'CUSTOMER', active: true }));
const db = vi.hoisted(() => ({ user: { findFirst: vi.fn() } }));
const service = vi.hoisted(() => ({ products: vi.fn(), list: vi.fn(), upload: vi.fn(), patch: vi.fn(), retire: vi.fn(), retry: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, logSafely: vi.fn() }));
vi.mock('../services/product-media.service.js', () => ({ ProductMediaService: class { constructor() { return service; } } }));

const app = express();
app.use('/api', productMediaRoutes);
app.use(errorHandler);
const jwt = (role = 'ADMIN') => generateAccessToken({ userId: ids.admin, role });
const get = (path: string, role = 'ADMIN') => request(app).get(path).auth(jwt(role), { type: 'bearer' });
const jpeg = () => sharp({ create: { width: 160, height: 160, channels: 3, background: 'blue' } }).jpeg().toBuffer();
const stable = { id: ids.image, productId: ids.product, url: 'https://testproject.supabase.co/storage/v1/object/public/product-media/products/a.webp' };

beforeEach(() => {
  vi.resetAllMocks();
  ids.role = 'CUSTOMER'; ids.active = true;
  db.user.findFirst.mockImplementation(async () => ids.active ? { id: ids.admin, role: { name: ids.role } } : null);
  service.products.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 30, total: 0, totalPages: 0 } }); service.list.mockResolvedValue([]); service.upload.mockResolvedValue(stable);
  service.patch.mockResolvedValue(stable); service.retire.mockResolvedValue({ id: ids.image }); service.retry.mockResolvedValue(stable);
});

describe('product media route authentication and authorization', () => {
  it('rejects unauthenticated requests before reaching service methods', async () => {
    expect((await request(app).get('/api/admin/products')).status).toBe(401);
    expect((await request(app).get(`/api/admin/products/${ids.product}/images`)).status).toBe(401);
    expect(service.products).not.toHaveBeenCalled(); expect(service.list).not.toHaveBeenCalled();
  });

  it('ignores the client JWT role and enforces the database-confirmed role', async () => {
    ids.role = 'CUSTOMER';
    const response = await request(app).get('/api/admin/products').auth(jwt('ADMIN'), { type: 'bearer' });
    expect(response.status).toBe(403);
    expect(service.products).not.toHaveBeenCalled();
  });

  it('rejects inactive accounts and does not dispatch an upload', async () => {
    ids.role = 'ADMIN'; ids.active = false;
    const response = await request(app).post(`/api/admin/products/${ids.product}/images`).auth(jwt(), { type: 'bearer' });
    expect(response.status).toBe(401);
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('allows active database ADMIN and applies private no-store caching', async () => {
    ids.role = 'ADMIN';
    const response = await get('/api/admin/products');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toEqual({ data: [], meta: { page: 1, pageSize: 30, total: 0, totalPages: 0 } });
    expect(service.products).toHaveBeenCalledWith('', 1, 30);
  });

  it('passes bounded search and pagination to the service while keeping products in the data array', async () => {
    ids.role = 'ADMIN';
    service.products.mockResolvedValueOnce({ data: [{ id: ids.product, name: 'Acer Predator Cestus 330', slug: 'acer-predator-cestus-330' }],
      meta: { page: 2, pageSize: 50, total: 79, totalPages: 2 } });

    const response = await get('/api/admin/products?q=acer&page=2&pageSize=50');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body).toEqual({ data: [{ id: ids.product, name: 'Acer Predator Cestus 330', slug: 'acer-predator-cestus-330' }],
      meta: { page: 2, pageSize: 50, total: 79, totalPages: 2 } });
    expect(service.products).toHaveBeenCalledWith('acer', 2, 50);
  });

  it('rejects invalid pagination bounds before querying products', async () => {
    ids.role = 'ADMIN';
    for (const query of ['page=0', 'page=1.5', 'pageSize=0', 'pageSize=51']) {
      const response = await get(`/api/admin/products?${query}`);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('MEDIA_REQUEST_INVALID');
    }
    expect(service.products).not.toHaveBeenCalled();
  });
});

describe('product media request validation', () => {
  beforeEach(() => { ids.role = 'ADMIN'; });

  it('rejects malformed product and image UUIDs before service calls', async () => {
    expect((await get('/api/admin/products/not-a-uuid/images')).status).toBe(400);
    expect((await get(`/api/admin/products/${ids.product}/images`)).status).toBe(200);
    expect((await request(app).patch(`/api/admin/products/${ids.product}/images/not-a-uuid`).auth(jwt(), { type: 'bearer' })
      .set('If-Match', '"2026-10-01T00:00:00.000Z"').send({ altText: 'Front' })).status).toBe(400);
    expect(service.list).toHaveBeenCalledTimes(1);
    expect(service.patch).not.toHaveBeenCalled();
  });

  it('requires valid If-Match for replacement, patch and retirement', async () => {
    const replace = await request(app).put(`/api/admin/products/${ids.product}/images/${ids.image}/file`)
      .auth(jwt(), { type: 'bearer' }).set('Idempotency-Key', ids.image).attach('file', await jpeg(), { filename: 'a.jpg', contentType: 'image/jpeg' });
    const patch = await request(app).patch(`/api/admin/products/${ids.product}/images/${ids.image}`)
      .auth(jwt(), { type: 'bearer' }).send({ altText: 'Front' });
    const retire = await request(app).delete(`/api/admin/products/${ids.product}/images/${ids.image}`).auth(jwt(), { type: 'bearer' });
    expect([replace, patch, retire].map(result => [result.status, result.body.error.code])).toEqual([
      [409, 'MEDIA_REVISION_REQUIRED'], [409, 'MEDIA_REVISION_REQUIRED'], [409, 'MEDIA_REVISION_REQUIRED'],
    ]);
    expect(service.upload).not.toHaveBeenCalled(); expect(service.patch).not.toHaveBeenCalled(); expect(service.retire).not.toHaveBeenCalled();
  });

  it('rejects missing idempotency key, malformed JSON metadata, oversized alt text and unexpected multipart fields', async () => {
    const bytes = await jpeg();
    const missingKey = await request(app).post(`/api/admin/products/${ids.product}/images`).auth(jwt(), { type: 'bearer' })
      .attach('file', bytes, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    const invalidAlt = await request(app).post(`/api/admin/products/${ids.product}/images`).auth(jwt(), { type: 'bearer' })
      .set('Idempotency-Key', ids.image).attach('file', bytes, { filename: 'photo.jpg', contentType: 'image/jpeg' }).field('altText', 'x'.repeat(256));
    const extraField = await request(app).post(`/api/admin/products/${ids.product}/images`).auth(jwt(), { type: 'bearer' })
      .set('Idempotency-Key', ids.image).attach('file', bytes, { filename: 'photo.jpg', contentType: 'image/jpeg' }).field('productId', ids.product);
    expect(missingKey.status).toBe(400);
    expect(invalidAlt.status).toBe(400);
    expect(extraField.status).toBe(400);
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('requires exactly one file under the supported multipart field', async () => {
    const bytes = await jpeg();
    const noFile = await request(app).post(`/api/admin/products/${ids.product}/images`).auth(jwt(), { type: 'bearer' }).set('Idempotency-Key', ids.image);
    const wrongField = await request(app).post(`/api/admin/products/${ids.product}/images`).auth(jwt(), { type: 'bearer' })
      .set('Idempotency-Key', ids.image).attach('photo', bytes, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    const duplicates = await request(app).post(`/api/admin/products/${ids.product}/images`).auth(jwt(), { type: 'bearer' })
      .set('Idempotency-Key', ids.image).attach('file', bytes, { filename: 'one.jpg', contentType: 'image/jpeg' })
      .attach('file', bytes, { filename: 'two.jpg', contentType: 'image/jpeg' });
    expect(noFile.body.error.code).toBe('MEDIA_FILE_REQUIRED');
    expect(wrongField.status).toBe(400);
    expect(duplicates.status).toBe(400);
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('passes only route-scoped IDs and supported metadata to service on upload', async () => {
    const bytes = await jpeg(); ids.role = 'ADMIN';
    const response = await request(app).post(`/api/admin/products/${ids.product}/images`).auth(jwt(), { type: 'bearer' })
      .set('Idempotency-Key', ids.image).attach('file', bytes, { filename: '../../spoof.jpg', contentType: 'image/jpeg' }).field('altText', 'Front');
    expect(response.status).toBe(201);
    expect(service.upload).toHaveBeenCalledWith(expect.objectContaining({
      actorId: ids.admin, productId: ids.product, key: ids.image, mime: 'image/jpeg', altText: 'Front', bytes: expect.any(Buffer),
    }));
    expect(service.upload.mock.calls[0]?.[0]).not.toHaveProperty('storagePath');
  });
});
