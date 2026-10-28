import { Prisma, ProductStatus, type PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { projectInventory, validateInventoryPurchase } from './inventory.service.js';
import { cartRevision, buyNowScopeId, type BuyNowInput } from './checkout.domain.js';
import { lockCart, lockCartForUser } from './cart.lock.js';
import { isSerializationConflict } from './transaction-conflict.js';
import { logger } from '../utils/logger.js';

export const MAX_CART_LINES = 50;
export const MAX_CART_QUANTITY = 999;

export interface CartInputItem { productId: string; quantity: number }

function validateQuantity(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CART_QUANTITY) throw new AppError('Invalid quantity.', 400, 'INVALID_CART_QUANTITY');
}

const productSelect = {
  id: true, slug: true, name: true, sku: true, categoryId: true, price: true, status: true, isTestFixture: true,
  category: { select: { name: true, isActive: true } },
  inventory: { select: { quantity: true, lowStockAt: true } },
  images: { where: { mediaState: 'PUBLISHED' }, take: 1, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }], select: { url: true, altText: true } },
} satisfies Prisma.ProductSelect;

type CartProduct = Prisma.ProductGetPayload<{ select: typeof productSelect }>;
type CartLine = { id: string | null; productId: string; quantity: number; product: CartProduct | null };

function availability(product: CartProduct | null, quantity: number) {
  if (!product) return 'NOT_FOUND' as const;
  if (product.isTestFixture || product.status !== ProductStatus.ACTIVE || !product.category.isActive) return 'UNAVAILABLE' as const;
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
  const products = productIds.length ? await client.product.findMany({ where: { id: { in: productIds }, isTestFixture: false }, select: productSelect }) : [];
  return new Map(products.map(product => [product.id, product]));
}

export async function currentCart(userId: string, client: Prisma.TransactionClient = prisma) {
  const cart = await client.cart.findUnique({ where: { userId }, select: { id: true,
    items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, productId: true, quantity: true } },
  } });
  const products = await loadProducts(cart?.items.map(item => item.productId) ?? [], client);
  return { cart, products, data: formatCart(cart?.items.map(item => ({ ...item, product: products.get(item.productId) ?? null })) ?? [], cart?.id ?? userId) };
}

const cartResponseSelect = {
  id: true,
  items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, productId: true, quantity: true, product: { select: productSelect } } },
} satisfies Prisma.CartSelect;

/**
 * The Cart API response in a single read (cart, lines and their products), where currentCart needs two sequential
 * reads. Output is identical: a marked disposable fixture is projected as an unavailable product (null), exactly as
 * loadProducts' `isTestFixture: false` filter did. Payment and order paths keep using currentCart unchanged.
 */
export async function cartResponse(userId: string, client: Prisma.TransactionClient = prisma) {
  const cart = await client.cart.findUnique({ where: { userId }, select: cartResponseSelect });
  return formatCart(cart?.items.map(item => ({ id: item.id, productId: item.productId, quantity: item.quantity,
    product: item.product.isTestFixture ? null : item.product })) ?? [], cart?.id ?? userId);
}

export function emptyCart(cartId: string) {
  return formatCart([], cartId);
}

/** Batch projection for an owned saved purchase; no active Cart reads or writes. */
export async function purchaseItemsProjection(items: CartInputItem[], client: Prisma.TransactionClient = prisma) {
  const products = await loadProducts(items.map(item => item.productId), client);
  return { products, data: formatCart(items.map(item => ({ id: null, ...item, product: products.get(item.productId) ?? null })), 'saved-purchase') };
}

/** Server-verified, read-only projection of one BUY_NOW line (live price/availability); never reads or writes Cart items. */
export async function buyNowProjection(userId: string, buyNow: BuyNowInput, client: Prisma.TransactionClient = prisma) {
  const products = await loadProducts([buyNow.productId], client);
  const product = products.get(buyNow.productId) ?? null;
  return { products, data: formatCart([{ id: null, productId: buyNow.productId, quantity: buyNow.quantity, product }], buyNowScopeId(userId)) };
}

function requireActiveProduct(product: CartProduct | undefined): asserts product is CartProduct {
  if (!product) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
  if (product.isTestFixture || product.status !== ProductStatus.ACTIVE || !product.category.isActive) {
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

type CartOperation = 'cart_add' | 'cart_quantity_update' | 'cart_remove' | 'cart_reconcile';
type SetTransactionStage = (stage: string) => void;

async function transaction<T>(database: PrismaClient, operationName: CartOperation,
  operation: (client: Prisma.TransactionClient, setStage: SetTransactionStage) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let stage = 'transaction_begin_or_connection_acquisition';
    try {
      return await database.$transaction(async client => {
        const result = await operation(client, nextStage => { stage = nextStage; });
        stage = 'transaction_commit';
        return result;
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 30000,
      });
    }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const serializationConflict = isSerializationConflict(error);
        const retryable = serializationConflict || error.code === 'P2002';
        const willRetry = retryable && attempt < 2;
        const sqlState = typeof error.meta?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.meta.code)
          ? error.meta.code : undefined;
        logger.error('Cart transaction failed.', {
          event: 'cart.transaction.failed', operation: operationName, stage, prismaCode: error.code, sqlState,
          transactionOutcome: serializationConflict || error.code === 'P2002' ? 'rolled_back' : 'unknown',
          retryNumber: attempt + 1, retriesCompleted: attempt, willRetry,
        });
        if (attempt === 2 && serializationConflict) throw new AppError('Cart changed. Please try again.', 409, 'CART_CONFLICT');
        if (!willRetry) throw error;
      } else {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1) + Math.random() * 50));
    }
  }
  throw new AppError('Cart could not be updated.', 409, 'CART_CONFLICT');
}

export class CartService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async validateGuest(input: CartInputItem[]) {
    const products = await loadProducts(input.map(item => item.productId), this.database);
    return formatCart(input.map(item => ({ id: null, ...item, product: products.get(item.productId) ?? null })));
  }

  async get(userId: string) { return cartResponse(userId, this.database); }

  async add(userId: string, input: CartInputItem) {
    validateQuantity(input.quantity);
    await transaction(this.database, 'cart_add', async (client, setStage) => {
      // One statement resolves and locks the existing Cart (same row lock as before, taken before any read).
      // Creating a Cart is only needed for a customer's first add; it is then locked the same way.
      setStage('cart_lock');
      let cartId = await lockCartForUser(client, userId);
      if (!cartId) {
        setStage('cart_upsert');
        cartId = (await client.cart.upsert({ where: { userId }, create: { userId }, update: {}, select: { id: true } })).id;
        setStage('cart_lock');
        await lockCart(client, cartId);
      }
      // Existing line and line capacity from one read of this Cart's lines (at most MAX_CART_LINES rows, under the lock).
      setStage('cart_lines_lookup');
      const lines = await client.cartItem.findMany({ where: { cartId }, select: { id: true, productId: true, quantity: true } });
      const existing = lines.find(line => line.productId === input.productId);
      setStage('cart_capacity_check');
      if (!existing && lines.length >= MAX_CART_LINES) {
        throw new AppError('Cart is full.', 409, 'CART_FULL');
      }
      const quantity = (existing?.quantity ?? 0) + input.quantity;
      if (quantity > MAX_CART_QUANTITY) throw new AppError('Quantity is too large.', 400, 'INVALID_CART_QUANTITY');
      setStage('product_inventory_validation');
      const products = await loadProducts([input.productId], client);
      requirePurchasable(products.get(input.productId), quantity);
      setStage(existing ? 'cart_line_update' : 'cart_line_create');
      if (existing) await client.cartItem.update({ where: { id: existing.id }, data: { quantity } });
      else await client.cartItem.create({ data: { cartId, productId: input.productId, quantity } });
    });
    return this.get(userId);
  }

  async setQuantity(userId: string, productId: string, quantity: number) {
    validateQuantity(quantity);
    await transaction(this.database, 'cart_quantity_update', async (client, setStage) => {
      setStage('cart_lookup');
      const cart = await client.cart.findUnique({ where: { userId }, select: { id: true } });
      if (cart) { setStage('cart_lock'); await lockCart(client, cart.id); }
      setStage('cart_line_lookup');
      const existing = cart && await client.cartItem.findUnique({ where: { cartId_productId: { cartId: cart.id, productId } }, select: { id: true, quantity: true } });
      if (!existing) throw new AppError('Cart item not found.', 404, 'CART_ITEM_NOT_FOUND');
      setStage('product_inventory_validation');
      const products = await loadProducts([productId], client);
      const product = products.get(productId);
      if (quantity < existing.quantity) {
        requireCorrectableCartLine(product);
      } else {
        requirePurchasable(product, quantity);
      }
      setStage('cart_line_update');
      await client.cartItem.update({ where: { id: existing.id }, data: { quantity } });
    });
    return this.get(userId);
  }

  async remove(userId: string, productId: string) {
    await transaction(this.database, 'cart_remove', async (client, setStage) => {
      setStage('cart_lookup');
      const cart = await client.cart.findUnique({ where: { userId }, select: { id: true } });
      if (cart) {
        setStage('cart_lock');
        await lockCart(client, cart.id);
        setStage('cart_line_remove');
        await client.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
      }
    });
    return this.get(userId);
  }

  async reconcile(userId: string, input: CartInputItem[]) {
    input.forEach(item => validateQuantity(item.quantity));
    await transaction(this.database, 'cart_reconcile', async (client, setStage) => {
      setStage('cart_upsert');
      const cart = await client.cart.upsert({ where: { userId }, create: { userId }, update: {}, select: { id: true } });
      setStage('cart_lock');
      await lockCart(client, cart.id);
      setStage('cart_lines_lookup');
      const existing = await client.cartItem.findMany({ where: { cartId: cart.id }, select: { id: true, productId: true, quantity: true } });
      const byProduct = new Map(existing.map(item => [item.productId, item]));
      if (new Set([...existing.map(item => item.productId), ...input.map(item => item.productId)]).size > MAX_CART_LINES) {
        throw new AppError('Cart is full.', 409, 'CART_FULL');
      }
      setStage('product_inventory_validation');
      const products = await loadProducts(input.map(item => item.productId), client);
      for (const item of input) {
        const prior = byProduct.get(item.productId);
        const quantity = resolveMergeQuantity(prior?.quantity ?? 0, item.quantity);
        requirePurchasable(products.get(item.productId), quantity);
        if (prior && prior.quantity !== quantity) {
          setStage('cart_line_update');
          await client.cartItem.update({ where: { id: prior.id }, data: { quantity } });
        } else if (!prior) {
          setStage('cart_line_create');
          await client.cartItem.create({ data: { cartId: cart.id, productId: item.productId, quantity } });
        }
      }
    });
    return this.get(userId);
  }
}
