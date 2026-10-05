import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { loadReviewAggregates, mapProductSummary, productSummarySelect, publicProductWhere } from './product.service.js';

export const MAX_WISHLIST_ITEMS = 50;

async function hydrate(productIds: string[], client: Prisma.TransactionClient = prisma) {
  const products = productIds.length ? await client.product.findMany({
    where: { ...publicProductWhere, id: { in: productIds } }, select: productSummarySelect,
  }) : [];
  const ratings = await loadReviewAggregates(client, products.map(product => product.id));
  const byId = new Map(products.map(product => [product.id, mapProductSummary(product, ratings.get(product.id))]));
  const items = productIds.map(productId => {
    const product = byId.get(productId) ?? null;
    return { productId, product, availability: !product ? 'UNAVAILABLE' as const :
      product.stockStatus === null ? 'UNAVAILABLE' as const : product.availability === 'AVAILABLE' ? 'AVAILABLE' as const : 'OUT_OF_STOCK' as const };
  });
  return { items, totalItems: items.length };
}

async function current(userId: string, client: Prisma.TransactionClient) {
  return client.wishlist.findUnique({ where: { userId }, select: { id: true,
    items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { productId: true } },
  } });
}

async function transaction<Result>(operation: (client: Prisma.TransactionClient) => Promise<Result>): Promise<Result> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 30000,
      });
    } catch (error) {
      if (attempt === 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034', 'P2028'].includes(error.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1) + Math.random() * 50));
    }
  }
  throw new AppError('Wishlist could not be updated. Please retry.', 409, 'WISHLIST_CONFLICT');
}

export class WishlistService {
  async validate(productIds: string[]) { return hydrate([...new Set(productIds)]); }

  async get(userId: string) {
    const wishlist = await current(userId, prisma);
    return hydrate(wishlist?.items.map(item => item.productId) ?? []);
  }

  async add(userId: string, productId: string) {
    return transaction(async client => {
      const existing = await current(userId, client);
      const ids = existing?.items.map(item => item.productId) ?? [];
      if (ids.includes(productId)) return { created: false, data: await hydrate(ids, client) };
      if (ids.length >= MAX_WISHLIST_ITEMS) throw new AppError('You can save up to 50 products.', 409, 'WISHLIST_CAPACITY');
      const valid = await hydrate([productId], client);
      if (!valid.items[0]?.product) throw new AppError('This product is unavailable.', 409, 'PRODUCT_UNAVAILABLE');
      const wishlist = existing ?? await client.wishlist.create({ data: { userId }, select: { id: true } });
      await client.wishlistItem.create({ data: { wishlistId: wishlist.id, productId } });
      return { created: true, data: await hydrate([...ids, productId], client) };
    });
  }

  async remove(userId: string, productId: string) {
    return transaction(async client => {
      const wishlist = await current(userId, client);
      if (wishlist) await client.wishlistItem.deleteMany({ where: { wishlistId: wishlist.id, productId } });
      return hydrate(wishlist?.items.map(item => item.productId).filter(id => id !== productId) ?? [], client);
    });
  }

  async reconcile(userId: string, productIds: string[]) {
    return transaction(async client => {
      const existing = await current(userId, client);
      const serverIds = existing?.items.map(item => item.productId) ?? [];
      const guest = await hydrate([...new Set(productIds)], client);
      const accepted = guest.items.filter(item => item.product || serverIds.includes(item.productId)).map(item => item.productId);
      const union = [...new Set([...serverIds, ...accepted])];
      if (union.length > MAX_WISHLIST_ITEMS) throw new AppError('You can save up to 50 products. Remove some items and retry.', 409, 'WISHLIST_CAPACITY');
      if (union.length) {
        const wishlist = existing ?? await client.wishlist.create({ data: { userId }, select: { id: true } });
        await client.wishlistItem.createMany({ data: accepted.map(productId => ({ wishlistId: wishlist.id, productId })), skipDuplicates: true });
      }
      return { ...await hydrate(union, client), unresolved: guest.items.filter(item => !accepted.includes(item.productId))
        .map(item => ({ productId: item.productId, reason: 'UNAVAILABLE' as const })) };
    });
  }
}
