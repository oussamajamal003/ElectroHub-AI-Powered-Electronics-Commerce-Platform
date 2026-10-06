import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { currentCart, MAX_CART_LINES, MAX_CART_QUANTITY } from './cart.service.js';
import { lockCart } from './cart.lock.js';
import { InventoryService, validateInventoryPurchase } from './inventory.service.js';
import { attemptSchema, businessDate, checkoutRequestSchema, checkoutTotals, deliveryMethods, requestHash } from './checkout.domain.js';
import { isSerializationConflict } from './transaction-conflict.js';

const include = { items: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] } } satisfies Prisma.OrderInclude;
type StoredOrder = Prisma.OrderGetPayload<{ include: typeof include }>;
export function confirmation(order: StoredOrder) {
  return { orderReference: `ORD-${order.id.toUpperCase()}`, createdAt: order.createdAt.toISOString(), status: order.status,
    paymentMethod: order.paymentMethod, paymentState: 'UNPROCESSED' as const,
    shipping: { recipient: order.shippingRecipient, line1: order.shippingLine1, line2: order.shippingLine2,
      city: order.shippingCity, state: order.shippingState, postalCode: order.shippingPostalCode,
      country: order.shippingCountry, phone: order.shippingPhone },
    deliveryMethod: order.deliveryMethod, estimatedDeliveryStart: order.estimatedDeliveryStart.toISOString(),
    estimatedDeliveryEnd: order.estimatedDeliveryEnd.toISOString(), currency: order.currency,
    subtotal: order.subtotal.toFixed(2), shippingCost: order.shippingCost.toFixed(2), total: order.total.toFixed(2),
    items: order.items.map(item => ({ productId: item.productId, productName: item.productName, sku: item.sku,
      imageUrl: item.productImageUrl, quantity: item.quantity, unitPrice: item.unitPrice.toFixed(2), lineTotal: item.lineTotal.toFixed(2) })) };
}

export class OrderService {
  constructor(private readonly database: PrismaClient = prisma, private readonly inventory = new InventoryService()) {}

  async getConfirmation(userId: string, reference: string) {
    const id = reference.startsWith('ORD-') ? attemptSchema.parse(reference.slice(4)).toLowerCase() : attemptSchema.parse(reference);
    const order = await this.database.order.findFirst({ where: { id, userId }, include });
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    return confirmation(order);
  }

  async getAttempt(userId: string, attempt: string) {
    const order = await this.database.order.findUnique({ where: { userId_checkoutAttemptId: { userId, checkoutAttemptId: attemptSchema.parse(attempt) } }, include });
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    return confirmation(order);
  }

  async create(userId: string, attempt: string, input: unknown) {
    const checkoutAttemptId = attemptSchema.parse(attempt);
    const request = checkoutRequestSchema.parse(input);
    const hash = requestHash(request);
    const existing = async (client: Prisma.TransactionClient) => {
      const order = await client.order.findUnique({ where: { userId_checkoutAttemptId: { userId, checkoutAttemptId } }, include });
      if (order && order.checkoutRequestHash !== hash) throw new AppError('This checkout attempt was used for a different request.', 409, 'IDEMPOTENCY_CONFLICT');
      return order;
    };
    const result = async (order: StoredOrder, replayed: boolean, client: Prisma.TransactionClient) =>
      ({ confirmation: confirmation(order), cart: (await currentCart(userId, client)).data, replayed });
    const prior = await existing(this.database);
    if (prior) return result(prior, true, this.database);

    for (let retry = 0; retry < 3; retry++) {
      try {
        return await this.database.$transaction(async tx => {
          const customer = await tx.user.findFirst({ where: { id: userId, isActive: true, role: { name: 'CUSTOMER' } }, select: { id: true } });
          if (!customer) throw new AppError('Authentication is required.', 401, 'UNAUTHENTICATED');
          const cart = await tx.cart.findUnique({ where: { userId }, select: { id: true } });
          if (!cart) throw new AppError('Your cart is empty.', 409, 'CHECKOUT_EMPTY_CART');
          await lockCart(tx, cart.id);
          const duplicate = await existing(tx);
          if (duplicate) return result(duplicate, true, tx);
          const lines = await tx.cartItem.findMany({ where: { cartId: cart.id }, select: { productId: true } });
          if (!lines.length) throw new AppError('Your cart is empty.', 409, 'CHECKOUT_EMPTY_CART');
          if (lines.length > MAX_CART_LINES) throw new AppError('Your cart exceeds checkout limits.', 409, 'CHECKOUT_INVALID_CART');
          const ids = lines.map(line => line.productId).sort();
          const sqlIds = Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`));
          const products = await tx.$queryRaw<{ categoryId: string }[]>(Prisma.sql`SELECT "categoryId" FROM "products" WHERE "id" IN (${sqlIds}) ORDER BY "id" FOR SHARE`);
          const categories = [...new Set(products.map(product => product.categoryId))].sort();
          if (categories.length) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "categories" WHERE "id" IN (${Prisma.join(categories.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR SHARE`);
          await tx.$queryRaw(Prisma.sql`SELECT "productId" FROM "inventory" WHERE "productId" IN (${sqlIds}) ORDER BY "productId" FOR UPDATE`);
          const current = await currentCart(userId, tx);
          for (const item of current.data.items) {
            if (item.quantity > MAX_CART_QUANTITY) throw new AppError('Invalid cart quantity.', 409, 'CHECKOUT_INVALID_CART');
            const product = current.products.get(item.productId);
            if (!product) throw new AppError('A product is unavailable. Return to Cart.', 409, 'PRODUCT_UNAVAILABLE');
            validateInventoryPurchase(product.inventory, item.quantity, product.status === 'ACTIVE' && product.category.isActive);
          }
          if (current.data.revision !== request.expectedRevision) throw new AppError('Your cart or prices changed. Review the current total before placing your order.', 409, 'CHECKOUT_CHANGED');
          const delivery = deliveryMethods.find(method => method.id === request.deliveryMethod);
          if (!delivery) throw new AppError('Choose an available delivery method.', 400, 'CHECKOUT_INVALID_DELIVERY');
          const totals = checkoutTotals(current.data.subtotal, delivery.price);
          const now = new Date(); const shipping = request.shipping;
          const order = await tx.order.create({ data: {
            userId, checkoutAttemptId, checkoutRequestHash: hash, deliveryMethod: delivery.id, paymentMethod: request.paymentMethod,
            subtotal: totals.subtotal, shippingCost: totals.shipping, total: totals.total, currency: 'USD', status: 'CONFIRMED',
            shippingRecipient: shipping.recipient, shippingLine1: shipping.line1, shippingLine2: shipping.line2 || null,
            shippingCity: shipping.city, shippingState: shipping.state || null, shippingPostalCode: shipping.postalCode,
            shippingCountry: shipping.country, shippingPhone: shipping.phone,
            estimatedDeliveryStart: businessDate(now, delivery.minDays), estimatedDeliveryEnd: businessDate(now, delivery.maxDays),
            items: { create: current.data.items.map(item => {
              const product = current.products.get(item.productId);
              if (!product) throw new AppError('A product is unavailable.', 409, 'PRODUCT_UNAVAILABLE');
              return { productId: product.id, productName: product.name, sku: product.sku, productImageUrl: product.images[0]?.url ?? null,
                unitPrice: product.price, quantity: item.quantity, lineTotal: product.price.mul(item.quantity) };
            }) },
          }, include });
          for (const id of ids) {
            const item = current.data.items.find(line => line.productId === id);
            if (item) await this.inventory.decreaseStock(id, item.quantity, tx);
          }
          await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
          return result(order, false, tx);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 30000 });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2002') {
            const committed = await existing(this.database);
            if (committed) return result(committed, true, this.database);
          }
          if (isSerializationConflict(error) && retry < 2) continue;
          if (isSerializationConflict(error) || ['P2002', 'P2028', 'P2025'].includes(error.code)) throw new AppError('Checkout changed. Retry the same checkout attempt safely.', 409, 'CHECKOUT_CONFLICT');
        }
        throw error;
      }
    }
    throw new AppError('Checkout could not be completed.', 409, 'CHECKOUT_CONFLICT');
  }
}
