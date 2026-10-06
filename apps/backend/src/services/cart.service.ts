import { Prisma, ProductStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { projectInventory, validateInventoryPurchase } from './inventory.service.js';
import { cartRevision } from './checkout.domain.js';
import { lockCart } from './cart.lock.js';
import { isSerializationConflict } from './transaction-conflict.js';

export const MAX_CART_LINES = 50;
export const MAX_CART_QUANTITY = 999;

export interface CartInputItem { productId: string; quantity: number }

function validateQuantity(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CART_QUANTITY) throw new AppError('Invalid quantity.', 400, 'INVALID_CART_QUANTITY');
}

const productSelect = {
  id: true, slug: true, name: true, sku: true, categoryId: true, price: true, status: true,
  category: { select: { name: true, isActive: true } },
  inventory: { select: { quantity: true, lowStockAt: true } },
  images: { take: 1, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }], select: { url: true, altText: true } },
} satisfies Prisma.ProductSelect;

type CartProduct = Prisma.ProductGetPayload<{ select: typeof productSelect }>;
type CartLine = { id: string | null; productId: string; quantity: number; product: CartProduct | null };

function availability(product: CartProduct | null, quantity: number) {
  if (!product) return 'NOT_FOUND' as const;
  if (product.status !== ProductStatus.ACTIVE || !product.category.isActive) return 'UNAVAILABLE' as const;
  if (projectInventory(product.inventory).stockStatus === null) return 'UNAVAILABLE' as const;
  const stock = product.inventory?.quantity ?? 0;
  if (stock < 1) return 'OUT_OF_STOCK' as const;
  if (quantity > stock) return 'LOW_STOCK' as const;
  return 'AVAILABLE' as const;
}

export function resolveMergeQuantity(serverQuantity: number, guestQuantity: number) {
  return Math.max(serverQuantity, guestQuantity);
}

function formatCart(lines: CartLine[], cartId = 'guest') {
  let subtotal = new Prisma.Decimal(0);
  let totalQuantity = 0;
  const items = lines.map(({ id, productId, quantity, product }) => {
    const state = availability(product, quantity);
    const lineTotal = product ? product.price.mul(quantity) : null;
    if (lineTotal) subtotal = subtotal.plus(lineTotal);
    totalQuantity += quantity;
    return {
      id, productId, quantity,
      product: product ? {
        slug: product.slug, name: product.name, category: product.category.name,
        price: product.price.toFixed(2), image: product.images[0] ?? null,
      } : null,
      availableQuantity: projectInventory(product?.inventory).availableQuantity,
      stockStatus: product && product.status === ProductStatus.ACTIVE && product.category.isActive ? projectInventory(product.inventory).stockStatus : null,
      availability: state,
      lineTotal: lineTotal?.toFixed(2) ?? null,
    };
  });
  return { revision: cartRevision(cartId, items), items, totalQuantity, subtotal: subtotal.toFixed(2), shipping: '0.00',
    total: subtotal.toFixed(2), currency: 'USD' as const,
    canCheckout: items.length > 0 && items.every(item => item.availability === 'AVAILABLE') };
}

async function loadProducts(productIds: string[], client: Prisma.TransactionClient = prisma) {
  const products = productIds.length ? await client.product.findMany({ where: { id: { in: productIds } }, select: productSelect }) : [];
  return new Map(products.map(product => [product.id, product]));
}

export async function currentCart(userId: string, client: Prisma.TransactionClient = prisma) {
  const cart = await client.cart.findUnique({ where: { userId }, select: { id: true,
    items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, productId: true, quantity: true } },
  } });
  const products = await loadProducts(cart?.items.map(item => item.productId) ?? [], client);
  return { cart, products, data: formatCart(cart?.items.map(item => ({ ...item, product: products.get(item.productId) ?? null })) ?? [], cart?.id ?? userId) };
}

function requireActiveProduct(product: CartProduct | undefined): asserts product is CartProduct {
  if (!product) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
  if (product.status !== ProductStatus.ACTIVE || !product.category.isActive) {
    throw new AppError('Product is unavailable.', 409, 'PRODUCT_UNAVAILABLE');
  }
}

function requirePurchasable(product: CartProduct | undefined, quantity: number) {
  requireActiveProduct(product);
  validateInventoryPurchase(product.inventory, quantity);
}

function requireCorrectableCartLine(product: CartProduct | undefined) {
  requireActiveProduct(product);
  if (projectInventory(product.inventory).stockStatus === null) {
    throw new AppError('Inventory is unavailable.', 409, 'INVENTORY_NOT_FOUND');
  }
}

async function transaction<T>(operation: (client: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 30000,
      });
    }
    catch (error) {
      if (attempt === 2 && isSerializationConflict(error)) throw new AppError('Cart changed. Please try again.', 409, 'CART_CONFLICT');
      if (attempt === 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        !(isSerializationConflict(error) || ['P2002', 'P2028'].includes(error.code))) throw error;
      await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1) + Math.random() * 50));
    }
  }
  throw new AppError('Cart could not be updated.', 409, 'CART_CONFLICT');
}

export class CartService {
  async validateGuest(input: CartInputItem[]) {
    const products = await loadProducts(input.map(item => item.productId));
    return formatCart(input.map(item => ({ id: null, ...item, product: products.get(item.productId) ?? null })));
  }

  async get(userId: string) { return (await currentCart(userId)).data; }

  async add(userId: string, input: CartInputItem) {
    validateQuantity(input.quantity);
    await transaction(async client => {
      const cart = await client.cart.upsert({ where: { userId }, create: { userId }, update: {}, select: { id: true } });
      await lockCart(client, cart.id);
      const existing = await client.cartItem.findUnique({ where: { cartId_productId: { cartId: cart.id, productId: input.productId } }, select: { id: true, quantity: true } });
      if (!existing && await client.cartItem.count({ where: { cartId: cart.id } }) >= MAX_CART_LINES) {
        throw new AppError('Cart is full.', 409, 'CART_FULL');
      }
      const quantity = (existing?.quantity ?? 0) + input.quantity;
      if (quantity > MAX_CART_QUANTITY) throw new AppError('Quantity is too large.', 400, 'INVALID_CART_QUANTITY');
      const products = await loadProducts([input.productId], client);
      requirePurchasable(products.get(input.productId), quantity);
      if (existing) await client.cartItem.update({ where: { id: existing.id }, data: { quantity } });
      else await client.cartItem.create({ data: { cartId: cart.id, productId: input.productId, quantity } });
    });
    return this.get(userId);
  }

  async setQuantity(userId: string, productId: string, quantity: number) {
    validateQuantity(quantity);
    await transaction(async client => {
      const cart = await client.cart.findUnique({ where: { userId }, select: { id: true } });
      if (cart) await lockCart(client, cart.id);
      const existing = cart && await client.cartItem.findUnique({ where: { cartId_productId: { cartId: cart.id, productId } }, select: { id: true, quantity: true } });
      if (!existing) throw new AppError('Cart item not found.', 404, 'CART_ITEM_NOT_FOUND');
      const products = await loadProducts([productId], client);
      const product = products.get(productId);
      if (quantity < existing.quantity) {
        requireCorrectableCartLine(product);
      } else {
        requirePurchasable(product, quantity);
      }
      await client.cartItem.update({ where: { id: existing.id }, data: { quantity } });
    });
    return this.get(userId);
  }

  async remove(userId: string, productId: string) {
    await transaction(async client => {
      const cart = await client.cart.findUnique({ where: { userId }, select: { id: true } });
      if (cart) {
        await lockCart(client, cart.id);
        await client.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
      }
    });
    return this.get(userId);
  }

  async reconcile(userId: string, input: CartInputItem[]) {
    input.forEach(item => validateQuantity(item.quantity));
    await transaction(async client => {
      const cart = await client.cart.upsert({ where: { userId }, create: { userId }, update: {}, select: { id: true } });
      await lockCart(client, cart.id);
      const existing = await client.cartItem.findMany({ where: { cartId: cart.id }, select: { id: true, productId: true, quantity: true } });
      const byProduct = new Map(existing.map(item => [item.productId, item]));
      if (new Set([...existing.map(item => item.productId), ...input.map(item => item.productId)]).size > MAX_CART_LINES) {
        throw new AppError('Cart is full.', 409, 'CART_FULL');
      }
      const products = await loadProducts(input.map(item => item.productId), client);
      for (const item of input) {
        const prior = byProduct.get(item.productId);
        const quantity = resolveMergeQuantity(prior?.quantity ?? 0, item.quantity);
        requirePurchasable(products.get(item.productId), quantity);
        if (prior && prior.quantity !== quantity) await client.cartItem.update({ where: { id: prior.id }, data: { quantity } });
        else if (!prior) await client.cartItem.create({ data: { cartId: cart.id, productId: item.productId, quantity } });
      }
    });
    return this.get(userId);
  }
}
