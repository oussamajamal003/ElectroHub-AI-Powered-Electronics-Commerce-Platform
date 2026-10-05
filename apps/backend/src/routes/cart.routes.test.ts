import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import cartRoutes from './cart.routes.js';
import { AppError, errorHandler } from '../middleware/errorHandler.js';

const userId = '62a990ff-7909-4bbb-b42f-8f20b6d97af4';
const productId = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const service = vi.hoisted(() => ({ get: vi.fn(), add: vi.fn(), setQuantity: vi.fn(), remove: vi.fn(), reconcile: vi.fn(), validateGuest: vi.fn() }));
vi.mock('../services/cart.service.js', () => ({ CartService: class { constructor() { return service; } }, MAX_CART_LINES: 50, MAX_CART_QUANTITY: 999 }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => { req.user = { userId, role: 'CUSTOMER' }; next(); },
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
const app = express();
app.use(express.json());
app.use('/api', cartRoutes);
app.use(errorHandler);

beforeEach(() => { vi.clearAllMocks(); service.get.mockResolvedValue({ items: [] }); service.add.mockResolvedValue({ items: [] }); service.validateGuest.mockResolvedValue({ items: [] }); });

describe('Cart routes', () => {
  it('returns sanitized server stock conflicts for authenticated Add and quantity update', async () => {
    service.add.mockRejectedValue(new AppError('Only 3 items are currently available.', 409, 'CART_STOCK_CONFLICT'));
    service.setQuantity.mockRejectedValue(new AppError('Only 3 items are currently available.', 409, 'CART_STOCK_CONFLICT'));
    for (const response of [await request(app).post('/api/cart/items').send({ productId, quantity: 4 }), await request(app).patch(`/api/cart/items/${productId}`).send({ quantity: 4 })]) {
      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: { code: 'CART_STOCK_CONFLICT', message: 'Only 3 items are currently available.' } });
    }
    expect(service.add).toHaveBeenCalledWith(userId, { productId, quantity: 4 });
    expect(service.setQuantity).toHaveBeenCalledWith(userId, productId, 4);
  });
  it('uses the authenticated principal rather than a caller-selected User ID', async () => {
    const response = await request(app).get(`/api/cart?userId=${productId}`);
    expect(response.status).toBe(200);
    expect(service.get).toHaveBeenCalledWith(userId);
  });
  it('rejects extra fields and invalid quantities at the API boundary', async () => {
    const otherUser = await request(app).post('/api/cart/items').send({ productId, quantity: 1, userId: productId });
    const invalidQuantity = await request(app).post('/api/cart/items').send({ productId, quantity: 0 });
    const oversizedQuantity = await request(app).post('/api/cart/items').send({ productId, quantity: 1000 });
    expect(otherUser.status).toBe(400);
    expect(invalidQuantity.status).toBe(400);
    expect(oversizedQuantity.status).toBe(400);
    expect(service.add).not.toHaveBeenCalled();
  });
  it('enforces update quantity boundaries before calling the service', async () => {
    const minimum = await request(app).patch(`/api/cart/items/${productId}`).send({ quantity: 0 });
    const maximum = await request(app).patch(`/api/cart/items/${productId}`).send({ quantity: 1000 });
    expect(minimum.status).toBe(400);
    expect(maximum.status).toBe(400);
    expect(service.setQuantity).not.toHaveBeenCalled();
  });
  it('bounds and deduplicates the public guest validation input', async () => {
    const response = await request(app).post('/api/cart/validate').send({ items: [{ productId, quantity: 1 }, { productId, quantity: 2 }] });
    expect(response.status).toBe(400);
    expect(service.validateGuest).not.toHaveBeenCalled();
  });
});
