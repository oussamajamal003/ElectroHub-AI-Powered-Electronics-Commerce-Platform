import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import cartRoutes from './cart.routes.js';
import { errorHandler } from '../middleware/errorHandler.js';

const fixture = vi.hoisted(() => ({
  userId: '62a990ff-7909-4bbb-b42f-8f20b6d97af4',
  productId: '8f2813b4-a388-44d3-b51e-5d4c40386677',
  quantity: 3,
  stock: 0,
  active: true,
  inventoryPresent: true,
}));
const database = vi.hoisted(() => ({
  product: { findMany: vi.fn() },
  cart: { findUnique: vi.fn() },
  cartItem: { findUnique: vi.fn(), update: vi.fn() },
  inventory: { update: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({ prisma: database }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { userId: fixture.userId, role: 'CUSTOMER' };
    next();
  },
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const app = express();
app.use(express.json());
app.use('/api', cartRoutes);
app.use(errorHandler);

beforeEach(() => {
  vi.resetAllMocks();
  fixture.quantity = 3;
  fixture.stock = 0;
  fixture.active = true;
  fixture.inventoryPresent = true;
  database.$transaction.mockImplementation(async (operation: (client: typeof database) => Promise<unknown>) => operation(database));
  database.cart.findUnique.mockImplementation(async ({ where, select }: { where: { userId: string }; select?: { items?: unknown } }) => {
    if (where.userId !== fixture.userId) return null;
    return select?.items
      ? { id: 'cart-1', items: [{ id: 'line-1', productId: fixture.productId, quantity: fixture.quantity }] }
      : { id: 'cart-1' };
  });
  database.cartItem.findUnique.mockImplementation(async ({ where }: { where: { cartId_productId: { cartId: string; productId: string } } }) => {
    if (where.cartId_productId.cartId !== 'cart-1' || where.cartId_productId.productId !== fixture.productId) return null;
    return { id: 'line-1', quantity: fixture.quantity };
  });
  database.cartItem.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: { quantity: number } }) => {
    expect(where.id).toBe('line-1');
    fixture.quantity = data.quantity;
    return { id: 'line-1', productId: fixture.productId, quantity: fixture.quantity };
  });
  database.product.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => {
    if (!where.id.in.includes(fixture.productId)) return [];
    return [{
      id: fixture.productId,
      slug: 'phone',
      name: 'Phone',
      price: new Prisma.Decimal('19.99'),
      status: fixture.active ? 'ACTIVE' : 'INACTIVE',
      category: { name: 'Phones', isActive: true },
      inventory: fixture.inventoryPresent ? { quantity: fixture.stock, lowStockAt: 5 } : null,
      images: [],
    }];
  });
});

describe('authenticated Cart quantity correction route', () => {
  it('persists a genuine OOS decrement through PATCH while keeping checkout blocked and Inventory unchanged', async () => {
    const response = await request(app).patch(`/api/cart/items/${fixture.productId}`).send({ quantity: 2 });

    expect(response.status).toBe(200);
    expect(response.body.data.items).toMatchObject([{ productId: fixture.productId, quantity: 2, availability: 'OUT_OF_STOCK' }]);
    expect(response.body.data.canCheckout).toBe(false);
    expect(fixture.quantity).toBe(2);
    expect(fixture.stock).toBe(0);
    expect(database.inventory.update).not.toHaveBeenCalled();
  });

  it('rejects an OOS increase with the existing sanitized 409 contract after a successful correction', async () => {
    fixture.quantity = 2;

    const response = await request(app).patch(`/api/cart/items/${fixture.productId}`).send({ quantity: 3 });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: { code: 'CART_STOCK_CONFLICT', message: 'Product is out of stock.' } });
    expect(fixture.quantity).toBe(2);
    expect(fixture.stock).toBe(0);
    expect(database.inventory.update).not.toHaveBeenCalled();
  });

  it('does not trust a client-provided decrement flag', async () => {
    const response = await request(app).patch(`/api/cart/items/${fixture.productId}`).send({ quantity: 4, decrement: true });

    expect(response.status).toBe(400);
    expect(fixture.quantity).toBe(3);
    expect(database.cartItem.update).not.toHaveBeenCalled();
  });
});
