import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { WishlistService } from '../wishlist.service.js';

const database = vi.hoisted(() => ({ product: { findMany: vi.fn() }, review: { groupBy: vi.fn() },
  wishlist: { findUnique: vi.fn(), create: vi.fn() }, wishlistItem: { create: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() }, $transaction: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({ prisma: database }));
const productId = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const otherId = '41f516ae-8385-4dcb-9a85-90b5dc9fe363';
const product = { id: productId, name: 'Phone', slug: 'phone', description: 'Phone description', status: 'ACTIVE',
  price: new Prisma.Decimal('19.99'), compareAtPrice: new Prisma.Decimal('29.99'), inventory: { quantity: 0 },
  category: { id: 'category', name: 'Phones', slug: 'phones' }, brand: null, images: [] };
beforeEach(() => {
  vi.resetAllMocks();
  database.$transaction.mockImplementation((operation: (client: typeof database) => Promise<unknown>) => operation(database));
  database.product.findMany.mockResolvedValue([product]); database.review.groupBy.mockResolvedValue([]);
  database.wishlist.findUnique.mockResolvedValue(null); database.wishlist.create.mockResolvedValue({ id: 'wishlist' });
});
describe('Wishlist service', () => {
  it('batch hydrates current Decimal summaries and keeps out-of-stock products', async () => {
    const result = await new WishlistService().validate([productId, productId, otherId]);
    expect(result).toMatchObject({ totalItems: 2, items: [{ availability: 'OUT_OF_STOCK', product: { price: '19.99' } }, { product: null, availability: 'UNAVAILABLE' }] });
    expect(database.product.findMany).toHaveBeenCalledTimes(1); expect(database.review.groupBy).toHaveBeenCalledTimes(1);
    expect(database.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE', category: { isActive: true } }) }));
  });
  it('derives reads from the principal and preserves unavailable saved entries', async () => {
    database.wishlist.findUnique.mockResolvedValue({ id: 'wishlist', items: [{ productId: otherId }] });
    const result = await new WishlistService().get('owner');
    expect(database.wishlist.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'owner' } }));
    expect(result.items[0].product).toBeNull(); expect(database.wishlistItem.deleteMany).not.toHaveBeenCalled();
  });
  it('allows out-of-stock saves without inventory or Cart writes', async () => {
    const result = await new WishlistService().add('owner', productId);
    expect(result.created).toBe(true); expect(result.data.items[0].availability).toBe('OUT_OF_STOCK');
    expect(database.wishlistItem.create).toHaveBeenCalledWith({ data: { wishlistId: 'wishlist', productId } });
  });
  it('duplicate Add is idempotent', async () => {
    database.wishlist.findUnique.mockResolvedValue({ id: 'wishlist', items: [{ productId }] });
    expect((await new WishlistService().add('owner', productId)).created).toBe(false);
    expect(database.wishlistItem.create).not.toHaveBeenCalled();
  });
  it('rejects missing/inactive new products', async () => {
    database.product.findMany.mockResolvedValue([]);
    await expect(new WishlistService().add('owner', otherId)).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
    expect(database.wishlistItem.create).not.toHaveBeenCalled();
  });
  it('bounds additions atomically', async () => {
    database.wishlist.findUnique.mockResolvedValue({ id: 'wishlist', items: Array.from({ length: 50 }, (_, index) => ({ productId: String(index) })) });
    await expect(new WishlistService().add('owner', productId)).rejects.toMatchObject({ code: 'WISHLIST_CAPACITY' });
    expect(database.wishlistItem.create).not.toHaveBeenCalled();
  });
  it('Remove is idempotent and owner scoped', async () => {
    database.wishlist.findUnique.mockResolvedValue({ id: 'wishlist', items: [{ productId }, { productId: otherId }] });
    expect((await new WishlistService().remove('owner', productId)).items.map(item => item.productId)).toEqual([otherId]);
    expect(database.wishlistItem.deleteMany).toHaveBeenCalledWith({ where: { wishlistId: 'wishlist', productId } });
  });
  it('set union preserves server entries and returns unresolved guests safely', async () => {
    database.wishlist.findUnique.mockResolvedValue({ id: 'wishlist', items: [{ productId: otherId }] });
    const missing = '62a990ff-7909-4bbb-b42f-8f20b6d97af4';
    const result = await new WishlistService().reconcile('owner', [productId, productId, missing]);
    expect(result.items.map(item => item.productId)).toEqual([otherId, productId]);
    expect(result.unresolved).toEqual([{ productId: missing, reason: 'UNAVAILABLE' }]);
    expect(database.wishlistItem.createMany).toHaveBeenCalledWith({ data: [{ wishlistId: 'wishlist', productId }], skipDuplicates: true });
  });
  it('retries serializable conflicts without duplicate rows', async () => {
    database.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: 'test' }));
    await new WishlistService().add('owner', productId);
    expect(database.$transaction).toHaveBeenCalledTimes(2); expect(database.wishlistItem.create).toHaveBeenCalledTimes(1);
  });
  it('union over capacity leaves both sources untouched', async () => {
    database.wishlist.findUnique.mockResolvedValue({ id: 'wishlist', items: Array.from({ length: 50 }, (_, index) => ({ productId: String(index) })) });
    await expect(new WishlistService().reconcile('owner', [productId])).rejects.toMatchObject({ code: 'WISHLIST_CAPACITY' });
    expect(database.wishlistItem.createMany).not.toHaveBeenCalled();
  });
});
