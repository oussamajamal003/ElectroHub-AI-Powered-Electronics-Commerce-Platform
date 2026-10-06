import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { CartService, resolveMergeQuantity } from '../cart.service.js';

const database = vi.hoisted(() => ({
  product: { findMany: vi.fn() },
  cart: { findUnique: vi.fn(), upsert: vi.fn() },
  cartItem: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  inventory: { update: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: database }));

const productId = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const userId = '62a990ff-7909-4bbb-b42f-8f20b6d97af4';
const product = (quantity = 5) => ({ id: productId, slug: 'phone', name: 'Phone', price: new Prisma.Decimal('19.99'),
  status: 'ACTIVE', category: { name: 'Phones', isActive: true }, inventory: { quantity },
  images: [{ url: '/phone.jpg', altText: 'Phone' }] });

function configureExistingCart(quantity: number, ownerId = userId) {
  let persistedQuantity = quantity;
  database.cart.findUnique.mockImplementation(async ({ where, select }: { where: { userId: string }; select?: { items?: unknown } }) => {
    if (where.userId !== ownerId) return null;
    return select?.items
      ? { id: 'cart-1', items: [{ id: 'line-1', productId, quantity: persistedQuantity }] }
      : { id: 'cart-1' };
  });
  database.cartItem.findUnique.mockImplementation(async ({ where }: { where: { cartId_productId: { cartId: string; productId: string } } }) => {
    if (where.cartId_productId.cartId !== 'cart-1' || where.cartId_productId.productId !== productId) return null;
    return { id: 'line-1', quantity: persistedQuantity };
  });
  database.cartItem.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: { quantity: number } }) => {
    if (where.id !== 'line-1') throw new Error('Unexpected Cart line update.');
    persistedQuantity = data.quantity;
    return { id: 'line-1', productId, quantity: persistedQuantity };
  });
  return { getPersistedQuantity: () => persistedQuantity };
}

beforeEach(() => {
  vi.resetAllMocks();
  database.$queryRaw.mockResolvedValue([]);
  database.$transaction.mockImplementation((operation: (client: typeof database) => Promise<unknown>) => operation(database));
  database.product.findMany.mockResolvedValue([product()]);
  database.cart.findUnique.mockResolvedValue(null);
  database.cart.upsert.mockResolvedValue({ id: 'cart-1' });
  database.cartItem.findUnique.mockResolvedValue(null);
  database.cartItem.findMany.mockResolvedValue([]);
  database.cartItem.count.mockResolvedValue(0);
});

describe('CartService', () => {
  it('bounds retries for raw adapter serialization conflicts and returns the Cart conflict contract', async () => {
    database.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Transaction write conflict', {
      code: 'P2010', clientVersion: '6.12.0', meta: { code: 'N/A', message: 'Transaction write conflict' },
    }));
    await expect(new CartService().add(userId, { productId, quantity: 1 })).rejects.toMatchObject({ statusCode: 409, code: 'CART_CONFLICT' });
    expect(database.$transaction).toHaveBeenCalledTimes(3); expect(database.inventory.update).not.toHaveBeenCalled();
  });
  it('add, update and remove never change the current inventory snapshot', async () => {
    const snapshot = product(6);
    database.product.findMany.mockResolvedValue([snapshot]);
    const service = new CartService();
    await service.add(userId, { productId, quantity: 1 });
    database.cart.findUnique.mockResolvedValue({ id: 'cart-1', items: [{ id: 'line-1', productId, quantity: 1 }] });
    database.cartItem.findUnique.mockResolvedValue({ id: 'line-1', quantity: 1 });
    await service.setQuantity(userId, productId, 2);
    await service.remove(userId, productId);
    expect(snapshot.inventory.quantity).toBe(6);
    expect(database.cartItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: { quantity: 2 } }));
  });
  it('keeps threshold stock status separate from insufficient requested quantity', async () => {
    const valid = await new CartService().validateGuest([{ productId, quantity: 1 }]);
    expect(valid.items[0]).toMatchObject({ stockStatus: 'LOW_STOCK', availability: 'AVAILABLE' });
    const invalid = await new CartService().validateGuest([{ productId, quantity: 6 }]);
    expect(invalid.items[0]).toMatchObject({ stockStatus: 'LOW_STOCK', availability: 'LOW_STOCK', quantity: 6 });
    database.product.findMany.mockResolvedValue([{ ...product(), inventory: null }]);
    const missing = await new CartService().validateGuest([{ productId, quantity: 1 }]);
    expect(missing.items[0]).toMatchObject({ stockStatus: null, availability: 'UNAVAILABLE' });
  });
  it('hydrates guest items in one product query with exact Decimal totals', async () => {
    const result = await new CartService().validateGuest([{ productId, quantity: 3 }]);
    expect(database.product.findMany).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ totalQuantity: 3, subtotal: '59.97', total: '59.97', shipping: '0.00', canCheckout: true });
    expect(JSON.stringify(result)).not.toContain('email');
  });
  it('keeps missing and out-of-stock lines visible but blocks checkout', async () => {
    database.product.findMany.mockResolvedValue([product(0)]);
    const result = await new CartService().validateGuest([{ productId, quantity: 2 },
      { productId: '41f516ae-8385-4dcb-9a85-90b5dc9fe363', quantity: 1 }]);
    expect(result.items.map(item => item.availability)).toEqual(['OUT_OF_STOCK', 'NOT_FOUND']);
    expect(result.canCheckout).toBe(false);
  });
  it('enforces current stock and never trusts client prices', async () => {
    database.product.findMany.mockResolvedValue([product(1)]);
    await expect(new CartService().add(userId, { productId, quantity: 2 })).rejects.toMatchObject({ code: 'CART_STOCK_CONFLICT', message: 'Only 1 item is currently available.' });
    expect(database.cartItem.create).not.toHaveBeenCalled();
  });
  it('rejects an update above current stock without changing the line', async () => {
    database.cart.findUnique.mockResolvedValue({ id: 'cart-1' });
    database.cartItem.findUnique.mockResolvedValue({ id: 'line-1', quantity: 2 });
    database.product.findMany.mockResolvedValue([product(2)]);
    await expect(new CartService().setQuantity(userId, productId, 3)).rejects.toMatchObject({ code: 'CART_STOCK_CONFLICT' });
    expect(database.cartItem.update).not.toHaveBeenCalled();
  });
  it.each([
    { existing: 3, stock: 5, requested: 2, succeeds: true },
    { existing: 3, stock: 5, requested: 3, succeeds: true },
    { existing: 3, stock: 5, requested: 4, succeeds: true },
    { existing: 3, stock: 3, requested: 4, succeeds: false },
    { existing: 5, stock: 3, requested: 4, succeeds: true },
    { existing: 5, stock: 3, requested: 3, succeeds: true },
    { existing: 5, stock: 3, requested: 2, succeeds: true },
    { existing: 5, stock: 3, requested: 6, succeeds: false },
    { existing: 3, stock: 0, requested: 2, succeeds: true },
    { existing: 3, stock: 0, requested: 1, succeeds: true },
    { existing: 3, stock: 0, requested: 4, succeeds: false },
    { existing: 1, stock: 0, requested: 2, succeeds: false },
  ])('compares requested quantity $requested with persisted quantity $existing at stock $stock', async ({ existing, stock, requested, succeeds }) => {
    const inventoryProduct = product(stock);
    const cart = configureExistingCart(existing);
    database.product.findMany.mockResolvedValue([inventoryProduct]);

    if (succeeds) {
      await new CartService().setQuantity(userId, productId, requested);
      expect(database.cartItem.update).toHaveBeenCalledWith({ where: { id: 'line-1' }, data: { quantity: requested } });
      expect(cart.getPersistedQuantity()).toBe(requested);
    } else {
      await expect(new CartService().setQuantity(userId, productId, requested)).rejects.toMatchObject({ code: 'CART_STOCK_CONFLICT' });
      expect(database.cartItem.update).not.toHaveBeenCalled();
      expect(cart.getPersistedQuantity()).toBe(existing);
    }

    expect(inventoryProduct.inventory.quantity).toBe(stock);
    expect(database.inventory.update).not.toHaveBeenCalled();
  });
  it('preserves Product, Inventory, quantity, and ownership checks for corrections', async () => {
    configureExistingCart(3);
    database.product.findMany.mockResolvedValue([{ ...product(0), inventory: null }]);
    await expect(new CartService().setQuantity(userId, productId, 2)).rejects.toMatchObject({ code: 'INVENTORY_NOT_FOUND' });

    configureExistingCart(3);
    database.product.findMany.mockResolvedValue([]);
    await expect(new CartService().setQuantity(userId, productId, 2)).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });

    configureExistingCart(3);
    database.product.findMany.mockResolvedValue([{ ...product(0), status: 'INACTIVE' }]);
    await expect(new CartService().setQuantity(userId, productId, 2)).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });

    configureExistingCart(3, 'another-user');
    await expect(new CartService().setQuantity(userId, productId, 2)).rejects.toMatchObject({ code: 'CART_ITEM_NOT_FOUND' });
    expect(database.cartItem.update).not.toHaveBeenCalled();
    expect(database.inventory.update).not.toHaveBeenCalled();
  });
  it('still rejects invalid quantities before looking up or changing the Cart', async () => {
    await expect(new CartService().setQuantity(userId, productId, 0)).rejects.toMatchObject({ code: 'INVALID_CART_QUANTITY' });
    expect(database.cart.findUnique).not.toHaveBeenCalled();
    expect(database.cartItem.update).not.toHaveBeenCalled();
  });
  it('rejects out-of-stock and inactive Product additions', async () => {
    database.product.findMany.mockResolvedValue([product(0)]);
    await expect(new CartService().add(userId, { productId, quantity: 1 })).rejects.toMatchObject({ code: 'CART_STOCK_CONFLICT', message: 'Product is out of stock.' });
    database.product.findMany.mockResolvedValue([{ ...product(), status: 'INACTIVE' }]);
    await expect(new CartService().add(userId, { productId, quantity: 1 })).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
    expect(database.cartItem.create).not.toHaveBeenCalled();
  });
  it('revalidates existing lines without silently changing or deleting them', async () => {
    database.cart.findUnique.mockResolvedValue({ id: 'cart-1', items: [{ id: 'line-1', productId, quantity: 4 }] });
    database.product.findMany.mockResolvedValue([product(2)]);
    const lowStock = await new CartService().get(userId);
    expect(lowStock.items).toMatchObject([{ quantity: 4, availableQuantity: 2, availability: 'LOW_STOCK' }]);
    expect(lowStock.canCheckout).toBe(false);
    database.product.findMany.mockResolvedValue([product(0)]);
    const outOfStock = await new CartService().get(userId);
    expect(outOfStock.items).toMatchObject([{ quantity: 4, availability: 'OUT_OF_STOCK' }]);
    expect(outOfStock.canCheckout).toBe(false);
    database.product.findMany.mockResolvedValue([{ ...product(), status: 'INACTIVE' }]);
    const unavailable = await new CartService().get(userId);
    expect(unavailable.items).toMatchObject([{ quantity: 4, availability: 'UNAVAILABLE' }]);
    expect(unavailable.canCheckout).toBe(false);
    expect(database.cartItem.update).not.toHaveBeenCalled();
    expect(database.cartItem.deleteMany).not.toHaveBeenCalled();
  });
  it('merges by maximum rather than adding again on retry', async () => {
    const existing = { id: 'line-1', productId, quantity: 2 };
    database.cartItem.findMany.mockResolvedValue([existing]);
    database.cart.findUnique.mockResolvedValue({ id: 'cart-1', items: [existing] });
    database.cartItem.update.mockImplementation(async ({ data }: { data: { quantity: number } }) => { existing.quantity = data.quantity; return existing; });
    const input = [{ productId, quantity: 3 }];
    await new CartService().reconcile(userId, input);
    await new CartService().reconcile(userId, input);
    expect(resolveMergeQuantity(3, 3)).toBe(3);
    expect(database.cartItem.create).not.toHaveBeenCalled();
    expect(database.cartItem.update).toHaveBeenCalledTimes(1);
    expect(database.cartItem.update).toHaveBeenCalledWith({ where: { id: 'line-1' }, data: { quantity: 3 } });
  });
  it('uses the authenticated user ID when selecting a Cart', async () => {
    await new CartService().get(userId);
    expect(database.cart.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId } }));
  });
  it('rejects a merge atomically when an incoming product is invalid', async () => {
    database.product.findMany.mockResolvedValue([]);
    await expect(new CartService().reconcile(userId, [{ productId, quantity: 1 }])).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
    expect(database.cartItem.create).not.toHaveBeenCalled();
  });
});
