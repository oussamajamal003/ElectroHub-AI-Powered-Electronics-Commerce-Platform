import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import adminRoutes from './admin.routes.js';
import { AppError, errorHandler } from '../middleware/errorHandler.js';
import { generateAccessToken } from '../utils/jwt.js';

const ids = vi.hoisted(() => ({ admin: '8f2813b4-a388-44d3-b51e-5d4c40386677', product: '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11',
  customer: '3e7dd3c4-7b2f-4c9b-9f6a-4d0f3b2c1e33', role: 'ADMIN', active: true }));
const db = vi.hoisted(() => ({ user: { findFirst: vi.fn() } }));
const catalog = vi.hoisted(() => ({ listProducts: vi.fn(), getProduct: vi.fn(), options: vi.fn(), createProduct: vi.fn(), updateProduct: vi.fn(),
  setProductStatus: vi.fn(), listCategories: vi.fn(), createCategory: vi.fn(), updateCategory: vi.fn(), setCategoryStatus: vi.fn(), deleteCategory: vi.fn() }));
const inventory = vi.hoisted(() => ({ list: vi.fn(), adjust: vi.fn(), setThreshold: vi.fn() }));
const orders = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn() }));
const customers = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), setStatus: vi.fn() }));
const dashboard = vi.hoisted(() => ({ overview: vi.fn(), alerts: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, logSafely: vi.fn() }));
vi.mock('../services/admin-catalog.service.js', () => ({ AdminCatalogService: class { constructor() { return catalog; } } }));
vi.mock('../services/admin-inventory.service.js', () => ({ AdminInventoryService: class { constructor() { return inventory; } } }));
vi.mock('../services/admin-order.service.js', () => ({ AdminOrderService: class { constructor() { return orders; } } }));
vi.mock('../services/admin-customer.service.js', () => ({ AdminCustomerService: class { constructor() { return customers; } } }));
vi.mock('../services/admin-dashboard.service.js', () => ({ AdminDashboardService: class { constructor() { return dashboard; } } }));

const app = express();
app.use(express.json());
app.use('/api', adminRoutes);
app.use(errorHandler);
const token = (role = 'ADMIN') => generateAccessToken({ userId: ids.admin, role });
const as = <T extends request.Test>(test: T, role = 'ADMIN') => test.auth(token(role), { type: 'bearer' });
const page = { page: 1, pageSize: 20, total: 0, totalPages: 0 };
const stamp = '2026-11-01T10:00:00.000Z';
const productBody = { name: 'QA 05.1 Probe Headphones', sku: 'qa-051-probe', categoryId: ids.product, price: '99.00', inventory: { quantity: 3 } };

beforeEach(() => {
  vi.resetAllMocks();
  ids.role = 'ADMIN'; ids.active = true;
  db.user.findFirst.mockImplementation(async () => ids.active ? { id: ids.admin, role: { name: ids.role } } : null);
  for (const fn of [catalog.listProducts, catalog.listCategories, inventory.list, orders.list, customers.list]) fn.mockResolvedValue({ data: [], meta: page });
});

const readRoutes = ['/api/admin/dashboard/overview', '/api/admin/dashboard/alerts', '/api/admin/catalog/options', '/api/admin/catalog/products',
  `/api/admin/catalog/products/${ids.product}`, '/api/admin/categories', '/api/admin/inventory', '/api/admin/orders',
  `/api/admin/orders/ORD-${ids.product.toUpperCase()}`, '/api/admin/customers', `/api/admin/customers/${ids.customer}`];

describe('admin operations API authorization', () => {
  it('rejects every route without a token (401) before any service call', async () => {
    for (const path of readRoutes) expect((await request(app).get(path)).status, path).toBe(401);
    expect((await request(app).post('/api/admin/catalog/products').send(productBody)).status).toBe(401);
    expect(catalog.listProducts).not.toHaveBeenCalled();
    expect(catalog.createProduct).not.toHaveBeenCalled();
  });

  it('rejects a CUSTOMER even when the token claims ADMIN: the database role decides (403)', async () => {
    ids.role = 'CUSTOMER';
    for (const path of readRoutes) expect((await as(request(app).get(path))).status, path).toBe(403);
    expect((await as(request(app).patch(`/api/admin/customers/${ids.customer}/status`).send({ isActive: false, expectedUpdatedAt: stamp }))).status).toBe(403);
    expect(customers.setStatus).not.toHaveBeenCalled();
  });

  it('rejects a deactivated administrator (401)', async () => {
    ids.active = false;
    expect((await as(request(app).get('/api/admin/catalog/products'))).status).toBe(401);
  });

  it('serves an active ADMIN with private, no-store responses', async () => {
    const response = await as(request(app).get('/api/admin/catalog/products'));
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toEqual({ data: [], meta: page });
  });

  it('leaves deeper /admin/orders/:ref/delivery paths to the delivery router', async () => {
    const response = await request(app).get(`/api/admin/orders/ORD-${ids.product.toUpperCase()}/delivery`);
    expect(response.status).toBe(404);
    expect(orders.detail).not.toHaveBeenCalled();
  });
});

describe('admin operations API validation', () => {
  it('whitelists list queries and rejects unknown or out-of-range parameters', async () => {
    for (const query of ['pageSize=51', 'page=0', 'sort=password', 'status=DELETED', 'role=ADMIN', 'stock=SOME']) {
      expect((await as(request(app).get(`/api/admin/catalog/products?${query}`))).status, query).toBe(400);
    }
    expect(catalog.listProducts).not.toHaveBeenCalled();
    expect((await as(request(app).get('/api/admin/catalog/products?q=%20headphones%20&sort=price&order=desc&pageSize=50'))).status).toBe(200);
    expect(catalog.listProducts).toHaveBeenCalledWith(expect.objectContaining({ q: 'headphones', sort: 'price', order: 'desc', pageSize: 50, page: 1 }));
  });

  it('rejects product bodies carrying authority fields or invalid prices with field-level errors', async () => {
    const smuggled = await as(request(app).post('/api/admin/catalog/products').send({ ...productBody, isTestFixture: true }));
    expect(smuggled.status).toBe(400);
    expect(smuggled.body.error.code).toBe('VALIDATION_ERROR');
    const price = await as(request(app).post('/api/admin/catalog/products').send({ ...productBody, price: '0', compareAtPrice: null }));
    expect(price.status).toBe(400);
    expect(price.body.error.fields).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'price' })]));
    const compare = await as(request(app).post('/api/admin/catalog/products').send({ ...productBody, compareAtPrice: '50.00' }));
    expect(compare.body.error.fields).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'compareAtPrice' })]));
    expect(catalog.createProduct).not.toHaveBeenCalled();
  });

  it('creates a product as a draft by default, upper-cases the SKU and answers 201', async () => {
    catalog.createProduct.mockResolvedValue({ id: ids.product });
    const response = await as(request(app).post('/api/admin/catalog/products').send(productBody));
    expect(response.status).toBe(201);
    expect(catalog.createProduct).toHaveBeenCalledWith(ids.admin, expect.objectContaining({ sku: 'QA-051-PROBE', status: 'INACTIVE',
      inventory: { quantity: 3, lowStockAt: 5 }, specifications: [] }));
  });

  it('answers 404 for malformed ids without reaching the service', async () => {
    expect((await as(request(app).get('/api/admin/catalog/products/not-a-uuid'))).status).toBe(404);
    expect((await as(request(app).get('/api/admin/customers/123'))).status).toBe(404);
    expect(catalog.getProduct).not.toHaveBeenCalled();
    expect(customers.detail).not.toHaveBeenCalled();
  });

  it('requires an expected version on every write', async () => {
    expect((await as(request(app).patch(`/api/admin/catalog/products/${ids.product}/status`).send({ status: 'INACTIVE' }))).status).toBe(400);
    expect((await as(request(app).patch(`/api/admin/customers/${ids.customer}/status`).send({ isActive: false }))).status).toBe(400);
    expect((await as(request(app).post(`/api/admin/inventory/${ids.product}/adjustments`).send({ operation: 'RESTOCK', quantity: 5 }))).status).toBe(400);
    expect((await as(request(app).post(`/api/admin/inventory/${ids.product}/adjustments`)
      .send({ operation: 'RESTOCK', quantity: 0, expectedQuantity: 4 }))).status).toBe(400);
    expect(catalog.setProductStatus).not.toHaveBeenCalled();
    expect(customers.setStatus).not.toHaveBeenCalled();
    expect(inventory.adjust).not.toHaveBeenCalled();
  });

  it('accepts only the 7/30/90 day dashboard windows', async () => {
    dashboard.overview.mockResolvedValue({});
    expect((await as(request(app).get('/api/admin/dashboard/overview?days=365'))).status).toBe(400);
    expect((await as(request(app).get('/api/admin/dashboard/overview?days=7'))).status).toBe(200);
    expect(dashboard.overview).toHaveBeenCalledWith(7);
  });
});

describe('admin operations API conflicts and envelopes', () => {
  it('returns the current stock with an INVENTORY_CONFLICT so the screen can re-decide', async () => {
    const current = { productId: ids.product, quantity: 2, lowStockAt: 5 };
    inventory.adjust.mockRejectedValue(Object.assign(new AppError('Stock changed since you loaded it.', 409, 'INVENTORY_CONFLICT'), { current }));
    const response = await as(request(app).post(`/api/admin/inventory/${ids.product}/adjustments`).send({ operation: 'RESTOCK', quantity: 5, expectedQuantity: 4 }));
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: { code: 'INVENTORY_CONFLICT', message: 'Stock changed since you loaded it.' }, data: current });
  });

  it('passes service conflicts through the standard error envelope', async () => {
    catalog.deleteCategory.mockRejectedValue(new AppError('Products still use this category.', 409, 'CATEGORY_IN_USE'));
    const response = await as(request(app).delete(`/api/admin/categories/${ids.product}`));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CATEGORY_IN_USE');
  });

  it('deletes an unused category with 204 and no body', async () => {
    catalog.deleteCategory.mockResolvedValue(undefined);
    const response = await as(request(app).delete(`/api/admin/categories/${ids.product}`));
    expect(response.status).toBe(204);
    expect(catalog.deleteCategory).toHaveBeenCalledWith(ids.admin, ids.product);
  });

  it('passes the authenticated admin id (never a client value) to customer status changes', async () => {
    customers.setStatus.mockResolvedValue({ id: ids.customer, status: 'INACTIVE' });
    const response = await as(request(app).patch(`/api/admin/customers/${ids.customer}/status`).send({ isActive: false, expectedUpdatedAt: stamp }));
    expect(response.status).toBe(200);
    expect(customers.setStatus).toHaveBeenCalledWith(ids.admin, ids.customer, false, stamp);
    const smuggled = await as(request(app).patch(`/api/admin/customers/${ids.customer}/status`).send({ isActive: true, expectedUpdatedAt: stamp, role: 'ADMIN' }));
    expect(smuggled.status).toBe(400);
  });
});
