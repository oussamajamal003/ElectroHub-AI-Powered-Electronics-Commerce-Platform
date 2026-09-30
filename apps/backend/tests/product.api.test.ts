import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import routes from '../src/routes/product.routes.js';
import { AppError, errorHandler } from '../src/middleware/errorHandler.js';
import { productPaths } from '../src/docs/swagger/product.openapi.js';
import { swaggerSpec } from '../src/docs/swagger/index.js';

const services = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn() }));
vi.mock('../src/services/product.service.js', () => ({ ProductService: class { list = services.list; detail = services.detail; } }));
vi.mock('../src/services/category.service.js', () => ({ CategoryService: class { list = services.list; detail = services.detail; } }));
vi.mock('../src/services/brand.service.js', () => ({ BrandService: class { list = services.list; detail = services.detail; } }));
vi.mock('../src/utils/logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
const app = express();
app.use('/api', routes);
app.use(errorHandler);
beforeEach(() => {
  vi.resetAllMocks();
  services.list.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
  services.detail.mockResolvedValue({ slug: 'test-product', brand: null });
});

describe('Public product API contracts', () => {
  it.each(['products', 'categories', 'brands'])('serves /%s list and detail envelopes', async resource => {
    expect((await request(app).get(`/api/${resource}`)).body).toEqual({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
    expect(services.list).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect((await request(app).get(`/api/${resource}/test-product`)).body).toEqual({ data: { slug: 'test-product', brand: null } });
    expect(services.detail).toHaveBeenCalledWith('test-product');
  });
  it.each(['page=0', 'pageSize=101', 'page=1.5', 'search=phone', 'sort=price', 'brand=apple', 'page=1&page=2'])('rejects query %s before querying', async query => {
    const response = await request(app).get(`/api/products?${query}`);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(services.list).not.toHaveBeenCalled();
  });
  it('rejects invalid slugs and unsupported detail queries', async () => {
    expect((await request(app).get('/api/products/Invalid_SLUG')).status).toBe(400);
    expect((await request(app).get('/api/products/valid-slug?search=x')).status).toBe(400);
    expect(services.detail).not.toHaveBeenCalled();
  });
  it('preserves structured not-found errors', async () => {
    services.detail.mockRejectedValue(new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND'));
    const response = await request(app).get('/api/products/missing');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } });
  });
  it('sanitizes unexpected database failures', async () => {
    services.list.mockRejectedValue(new Error('Prisma SQL internal failure'));
    const response = await request(app).get('/api/products');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong. Please try again later.' } });
    expect(JSON.stringify(response.body)).not.toMatch(/Prisma|SQL|stack/);
  });
  it('documents the product and related read endpoints', () => {
    expect(Object.keys(productPaths).sort()).toEqual(['/products', '/products/deals', '/products/{slug}',
      '/products/{slug}/reviews', '/products/{slug}/reviews/me', '/reviews/me', '/categories', '/categories/{slug}', '/brands', '/brands/{slug}'].sort());
    expect(swaggerSpec).toMatchObject({ paths: productPaths, components: { schemas: {
      ProductDetail: { type: 'object' }, ProductSummary: { type: 'object' },
    } } });
  });
});
