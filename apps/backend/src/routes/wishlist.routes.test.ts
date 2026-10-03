import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';
import routes from './wishlist.routes.js';
import { errorHandler } from '../middleware/errorHandler.js';

const service = vi.hoisted(() => ({ get: vi.fn(), add: vi.fn(), remove: vi.fn(), validate: vi.fn(), reconcile: vi.fn() }));
vi.mock('../services/wishlist.service.js', () => ({ MAX_WISHLIST_ITEMS: 50, WishlistService: class { constructor() { return service; } } }));
vi.mock('../middleware/auth.js', () => ({ requireAuth: (req: Request, res: Response, next: NextFunction) => {
  if (!req.headers.authorization) { res.status(401).json({ error: 'Unauthenticated' }); return; }
  req.user = { userId: 'owner', role: req.headers.authorization === 'admin' ? 'ADMIN' : 'CUSTOMER' }; next();
}, requireRole: () => (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'CUSTOMER') { res.status(403).json({ error: 'Forbidden' }); return; } next();
} }));
const app = express(); app.use(express.json()); app.use('/api', routes); app.use(errorHandler);
const productId = '8f2813b4-a388-44d3-b51e-5d4c40386677';
beforeEach(() => { vi.clearAllMocks(); service.get.mockResolvedValue({ items: [], totalItems: 0 }); service.validate.mockResolvedValue({ items: [], totalItems: 0 }); });
it('public hydration deduplicates UUIDs and rejects ownership fields', async () => {
  expect((await request(app).post('/api/wishlist/validate').send({ productIds: [productId, productId] })).status).toBe(200);
  expect(service.validate).toHaveBeenCalledWith([productId]);
  expect((await request(app).post('/api/wishlist/validate').send({ productIds: [], userId: 'other' })).status).toBe(400);
});
it('requires a customer and derives ownership from the principal', async () => {
  expect((await request(app).get('/api/wishlist')).status).toBe(401);
  expect((await request(app).get('/api/wishlist').set('Authorization', 'admin')).status).toBe(403);
  expect((await request(app).get('/api/wishlist').set('Authorization', 'customer')).status).toBe(200);
  expect(service.get).toHaveBeenCalledWith('owner');
  expect((await request(app).get('/api/wishlist?userId=other').set('Authorization', 'customer')).status).toBe(400);
});
it('validates strict Add/Remove input and distinguishes newly saved status', async () => {
  expect((await request(app).post('/api/wishlist/items').set('Authorization', 'customer').send({ productId, userId: 'other' })).status).toBe(400);
  expect((await request(app).delete('/api/wishlist/items/not-a-uuid').set('Authorization', 'customer')).status).toBe(400);
  service.add.mockResolvedValueOnce({ created: true, data: { items: [] } }).mockResolvedValueOnce({ created: false, data: { items: [] } });
  expect((await request(app).post('/api/wishlist/items').set('Authorization', 'customer').send({ productId })).status).toBe(201);
  expect((await request(app).post('/api/wishlist/items').set('Authorization', 'customer').send({ productId })).status).toBe(200);
});
