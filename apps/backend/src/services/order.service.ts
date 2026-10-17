import { Prisma, PrismaClient, type ProductStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { currentCart, emptyCart, MAX_CART_LINES, MAX_CART_QUANTITY } from './cart.service.js';
import { lockCartForUser } from './cart.lock.js';
import { InventoryService, validateInventoryPurchase, type LockedInventorySnapshot } from './inventory.service.js';
import { attemptSchema, businessDate, buyNowScopeId, checkoutRequestSchema, requestHash, savedAmountsMatch, savedPurchaseTerms } from './checkout.domain.js';
import { isSerializationConflict } from './transaction-conflict.js';
import { verifyAuthorization, type ProviderIntent } from './payment.domain.js';
import { performance } from 'node:perf_hooks';
import { logger } from '../utils/logger.js';

const include = { items: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] }, payment: true } satisfies Prisma.OrderInclude;
type StoredOrder = Prisma.OrderGetPayload<{ include: typeof include }>;
type CartProjection = Awaited<ReturnType<typeof currentCart>>['data'];
type LockedAttempt = {
  submittedAt: Date | null; cartId: string | null; cartIdentity: string; state: string; cancelRequested: boolean; orderId: string | null;
  request: Prisma.JsonValue; requestHash: string; total: Prisma.Decimal | string; shippingCost: Prisma.Decimal | string; amountCents: number;
};
type LockedWork = { state: string; leaseToken: string | null; leaseUntil: Date | null };
type LockedProductLine = { productId: string; quantity: number; categoryId: string; price: Prisma.Decimal | string; status: ProductStatus };
type LockedCategory = { id: string; isActive: boolean };
export function confirmation(order: StoredOrder) {
  return { orderReference: `ORD-${order.id.toUpperCase()}`, createdAt: order.createdAt.toISOString(), status: order.status,
    paymentMethod: order.paymentMethod, paymentState: !order.payment ? 'UNPROCESSED' : order.payment.status === 'SUCCEEDED' ? 'PAID' :
      order.payment.status === 'REFUNDED' ? 'REFUNDED' : order.payment.status === 'FAILED' ? 'FAILED' : 'PENDING',
    card: order.payment?.cardBrand && order.payment.cardLast4 ? { brand: order.payment.cardBrand, last4: order.payment.cardLast4 } : null,
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

  async list(userId: string, { page, pageSize }: { page: number; pageSize: number }) {
    const where = { userId };
    const [orders, total] = await this.database.$transaction([
      this.database.order.findMany({ where, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize, take: pageSize }),
      this.database.order.count({ where }),
    ]);
    return { data: orders.map(confirmation), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

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

  async create(_userId: string, _attempt: string, _input: unknown): Promise<never> {
    throw new AppError('Complete card payment through Checkout before creating an order.', 409, 'PAYMENT_REQUIRED');
  }

  /** Internal orchestrator capability. No route accepts provider facts or a client authorization flag. */
  async commitAuthorized(attemptId: string, intent: ProviderIntent, leaseToken: string) {
    const diagnosticsEnabled = process.env.ELECTROHUB_SQL_DIAGNOSTICS === '1';
    type StageTiming = { stage: string; startedAtEpochMs: number; endedAtEpochMs: number; elapsedMs: number; prismaOperationCount: number };
    let stageTimings: StageTiming[] = [];
    let failureStage = 'attempt_snapshot';
    const measureStage = async <T>(stage: string, prismaOperationCount: number, operation: () => T | Promise<T>): Promise<T> => {
      failureStage = stage;
      const startedAt = performance.now();
      const startedAtEpochMs = Date.now();
      try { return await operation(); }
      finally { stageTimings.push({ stage, startedAtEpochMs, endedAtEpochMs: Date.now(),
        elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100, prismaOperationCount }); }
    };
    const preflightStartedAt = performance.now();
    const snapshot = await measureStage('attempt_snapshot', 1, () =>
      // Capture path keeps its prior per-relation SQL; unordered items are the one shape whose join result order differs.
      this.database.paymentAttempt.findUnique({ where: { id: attemptId }, include: { items: true }, relationLoadStrategy: 'query' }));
    if (!snapshot) throw new AppError('Payment attempt not found.', 404, 'PAYMENT_ATTEMPT_NOT_FOUND');
    verifyAuthorization(snapshot, intent);
    const userId = snapshot.userId;
    const checkoutAttemptId = snapshot.idempotencyKey;
    const request = checkoutRequestSchema.parse(snapshot.request);
    const hash = requestHash(request);
    const existing = async (client: Prisma.TransactionClient) => {
      const order = await measureStage('order_idempotency_read', 1, () =>
        client.order.findUnique({ where: { userId_checkoutAttemptId: { userId, checkoutAttemptId } }, include }));
      if (order && order.checkoutRequestHash !== hash) throw new AppError('This checkout attempt was used for a different request.', 409, 'IDEMPOTENCY_CONFLICT');
      return order;
    };
    const result = async (order: StoredOrder, replayed: boolean, client: Prisma.TransactionClient, cartProjection?: CartProjection) =>
      ({ confirmation: confirmation(order), cart: cartProjection ?? (await currentCart(userId, client)).data, replayed });
    const prior = await existing(this.database);
    if (prior) return result(prior, true, this.database);
    const preflightDurationMs = Math.round((performance.now() - preflightStartedAt) * 100) / 100;
    const preflightTimings = stageTimings;

    for (let retry = 0; retry < 3; retry++) {
      stageTimings = [];
      const transactionRequestedAt = performance.now();
      let callbackEnteredAt = 0;
      let callbackFinishedAt = 0;
      try {
        const committed = await this.database.$transaction(async tx => {
          callbackEnteredAt = performance.now();
          try {
          const attemptRows = await measureStage('attempt_lock', 1, () => tx.$queryRaw<LockedAttempt[]>(Prisma.sql`
            SELECT "submittedAt", "cartId", "cartIdentity", "state"::text AS "state", "cancelRequested", "orderId",
              "request", "requestHash", "total", "shippingCost", "amountCents"
            FROM "payment_attempts" WHERE "id" = ${attemptId}::uuid FOR UPDATE`));
          const attempt = attemptRows[0];
          const workRows = attempt ? await measureStage('capture_work_lock', 1, () => tx.$queryRaw<LockedWork[]>(Prisma.sql`
            SELECT "state"::text AS "state", "leaseToken", "leaseUntil"
            FROM "payment_work" WHERE "attemptId" = ${attemptId}::uuid FOR UPDATE`)) : [];
          const work = workRows[0];
          if (!attempt || !work || work.leaseToken !== leaseToken || work.state !== 'LEASED' ||
            !work.leaseUntil || work.leaseUntil.getTime() <= Date.now()) {
            throw new AppError('Payment recovery is already running.', 409, 'PAYMENT_CLAIM_LOST');
          }
          const transactionRequest = checkoutRequestSchema.parse(attempt.request);
          const transactionHash = requestHash(transactionRequest);
          if (attempt.requestHash !== snapshot.requestHash || attempt.amountCents !== snapshot.amountCents ||
            new Prisma.Decimal(attempt.total).toFixed(2) !== snapshot.total.toFixed(2) ||
            new Prisma.Decimal(attempt.shippingCost).toFixed(2) !== snapshot.shippingCost.toFixed(2) ||
            attempt.cartIdentity !== snapshot.cartIdentity || attempt.cartId !== snapshot.cartId || transactionHash !== hash) {
            throw new AppError('Your checkout changed. Review it again.', 409, 'CHECKOUT_CHANGED');
          }
          const attemptItems = await measureStage('attempt_item_snapshot', 1, () => tx.paymentAttemptItem.findMany({ where: { attemptId } }));
          if (attempt.orderId) {
            const committed = await existing(tx);
            if (committed) return result(committed, true, tx);
          }
          if (attempt.cancelRequested || !['AUTHORIZED', 'AWAITING_INPUT', 'ACTION_REQUIRED', 'PROCESSING', 'DECLINED'].includes(attempt.state)) {
            throw new AppError('This payment attempt is no longer active.', 409, 'PAYMENT_ATTEMPT_SUPERSEDED');
          }
          const customer = await measureStage('customer_ownership_validation', 1, () => tx.user.findFirst({
            where: { id: userId, isActive: true, role: { name: 'CUSTOMER' } }, select: { id: true },
          }));
          if (!customer) throw new AppError('Authentication is required.', 401, 'UNAUTHENTICATED');
          const buyNowScope = transactionRequest.scope === 'BUY_NOW';
          // Only historical attempts have no cart-line generation marker.
          // A client holding a new secret cannot bypass durable submission via the legacy path.
          if (!buyNowScope && !attempt.submittedAt && attemptItems.some(item => item.snapshotCartItemId)) {
            throw new AppError('This checkout must be submitted before order completion.', 409, 'PAYMENT_SUBMISSION_REQUIRED');
          }
          const cartId = !buyNowScope ? await measureStage('cart_lock', 1, () => lockCartForUser(tx, userId)) : null;
          if (!buyNowScope && (!cartId || cartId !== attempt.cartId || cartId !== attempt.cartIdentity)) {
            throw new AppError('Your cart is empty.', 409, 'CHECKOUT_EMPTY_CART');
          }
          const duplicate = await existing(tx);
          if (duplicate) return result(duplicate, true, tx);
          const lines = buyNowScope || attempt.submittedAt ? await measureStage('product_lines_lock', 1, () => tx.$queryRaw<LockedProductLine[]>(Prisma.sql`
            SELECT pai."productId", pai."quantity", p."categoryId", pai."unitPrice" AS "price", p."status"::text AS "status"
            FROM "payment_attempt_items" pai
            JOIN "products" p ON p."id" = pai."productId"
            WHERE pai."attemptId" = ${attemptId}::uuid AND p."isTestFixture" = false
            ORDER BY p."id" FOR SHARE OF p`)) : await measureStage('product_lines_lock', 1, () => tx.$queryRaw<LockedProductLine[]>(Prisma.sql`
            SELECT ci."productId", ci."quantity", p."categoryId", p."price", p."status"::text AS "status"
            FROM "cart_items" ci
            JOIN "products" p ON p."id" = ci."productId"
            WHERE ci."cartId" = ${cartId!}::uuid AND p."isTestFixture" = false
            ORDER BY p."id" FOR SHARE OF p`));
          if (!lines.length) throw new AppError('Your cart is empty.', 409, 'CHECKOUT_EMPTY_CART');
          if (lines.length > MAX_CART_LINES) throw new AppError('Your cart exceeds checkout limits.', 409, 'CHECKOUT_INVALID_CART');
          const ids = lines.map(line => line.productId).sort();
          const categories = [...new Set(lines.map(line => line.categoryId))].sort();
          const categoryRows = categories.length ? await measureStage('category_locks', 1, () => tx.$queryRaw<LockedCategory[]>(Prisma.sql`
            SELECT "id", "isActive" FROM "categories"
            WHERE "id" IN (${Prisma.join(categories.map(id => Prisma.sql`${id}::uuid`))})
            ORDER BY "id" FOR SHARE`)) : [];
          const categoryById = new Map(categoryRows.map(category => [category.id, category]));
          const inventoryRows = await measureStage('inventory_locks', 1, () => tx.$queryRaw<LockedInventorySnapshot[]>(Prisma.sql`
            SELECT "productId", "quantity", "lowStockAt" FROM "inventory"
            WHERE "productId" IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
            ORDER BY "productId" FOR UPDATE`));
          const inventoryByProduct = new Map(inventoryRows.map(inventory => [inventory.productId, inventory]));
          const validated = await measureStage('authoritative_cart_price_stock_validation', 0, async () => {
          for (const item of lines) {
            if (item.quantity > MAX_CART_QUANTITY) throw new AppError('Invalid cart quantity.', 409, 'CHECKOUT_INVALID_CART');
            const category = categoryById.get(item.categoryId);
            if (!category) throw new AppError('A product is unavailable. Return to Cart.', 409, 'PRODUCT_UNAVAILABLE');
            validateInventoryPurchase(inventoryByProduct.get(item.productId) ?? null, item.quantity,
              item.status === 'ACTIVE' && category.isActive);
          }
          // Shared with saved-purchase retry (PaymentService.resume) so both gates apply identical terms.
          const terms = savedPurchaseTerms({ scopeId: buyNowScope ? buyNowScopeId(userId) : (cartId as string),
            expectedRevision: request.expectedRevision, deliveryMethod: transactionRequest.deliveryMethod, lines });
          if (!terms.revisionMatches) throw new AppError('Your cart or prices changed. Review the current total before placing your order.', 409, 'CHECKOUT_CHANGED');
          if (!terms.delivery || !terms.totals) throw new AppError('Choose an available delivery method.', 400, 'CHECKOUT_INVALID_DELIVERY');
          const { delivery, totals } = terms;
          if (!savedAmountsMatch(totals, attempt) ||
            hash !== attempt.requestHash || lines.length !== attemptItems.length ||
            lines.some(item => !attemptItems.some(saved => saved.productId === item.productId && saved.quantity === item.quantity &&
              saved.unitPrice.toFixed(2) === new Prisma.Decimal(item.price).toFixed(2)))) {
            throw new AppError('Your checkout changed. Review it again.', 409, 'CHECKOUT_CHANGED');
          }
          return { totals, delivery };
          });
          const { totals, delivery } = validated;
          const now = new Date(); const shipping = transactionRequest.shipping;
          const order = await measureStage('order_payment_items_create', 1, () => tx.order.create({ data: {
            userId, checkoutAttemptId, checkoutRequestHash: hash, deliveryMethod: delivery.id, paymentMethod: transactionRequest.paymentMethod,
            subtotal: totals.subtotal, shippingCost: totals.shipping, total: totals.total, currency: 'USD', status: 'AWAITING_CAPTURE',
            payment: { create: { provider: 'STRIPE', providerPaymentId: intent.id, status: 'PROCESSING', amount: attempt.total, currency: 'USD' } },
            shippingRecipient: shipping.recipient, shippingLine1: shipping.line1, shippingLine2: shipping.line2 || null,
            shippingCity: shipping.city, shippingState: shipping.state || null, shippingPostalCode: shipping.postalCode,
            shippingCountry: shipping.country, shippingPhone: shipping.phone,
            estimatedDeliveryStart: businessDate(now, delivery.minDays), estimatedDeliveryEnd: businessDate(now, delivery.maxDays),
            items: { create: lines.map(item => {
              const saved = attemptItems.find(line => line.productId === item.productId);
              if (!saved) throw new AppError('Your checkout changed.', 409, 'CHECKOUT_CHANGED');
              const price = new Prisma.Decimal(item.price);
              return { productId: item.productId, productName: saved.productName, sku: saved.sku, productImageUrl: saved.imageUrl,
                unitPrice: price, quantity: item.quantity, lineTotal: price.mul(item.quantity) };
            }) },
          }, include }));
          for (const id of ids) {
            const item = lines.find(line => line.productId === id);
            const lockedInventory = inventoryByProduct.get(id);
            if (item && lockedInventory) await measureStage('inventory_decrement', 1, () =>
              this.inventory.decreaseStock(id, item.quantity, tx, lockedInventory));
          }
          // BUY_NOW must never clear or mutate the persistent Cart.
          if (!buyNowScope && !attempt.submittedAt && cartId) await measureStage('cart_cleanup', 1, () => tx.cartItem.deleteMany({ where: { cartId } }));
          await measureStage('attempt_capture_pending_persist', 1, () => tx.paymentAttempt.update({ where: { id: attemptId }, data: { orderId: order.id, state: 'CAPTURE_PENDING',
            providerStatus: intent.status, authorizationExpiresAt: intent.captureBefore } }));
          // The already leased durable work row survives process death immediately after commit.
          await measureStage('capture_work_ready_persist', 1, () => tx.paymentWork.update({ where: { attemptId }, data: { nextRunAt: new Date(), lastError: null } }));
          const cartProjection = buyNowScope || attempt.submittedAt ? (await measureStage('buy_now_cart_projection', 1, () => currentCart(userId, tx))).data : emptyCart(cartId!);
          return result(order, false, tx, cartProjection);
          } finally {
            callbackFinishedAt = performance.now();
          }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 30000 });
        const transactionResolvedAt = performance.now();
        if (diagnosticsEnabled) {
          const callbackDurationMs = callbackFinishedAt - callbackEnteredAt;
          logger.info('Purchase transaction committed.', { event: 'order.purchase.transaction', outcome: 'committed',
            retryNumber: retry + 1, retriesCompleted: retry, retryCount: retry, preflightDurationMs,
            preflightStages: preflightTimings, acquisitionAndBeginMs: Math.round((callbackEnteredAt - transactionRequestedAt) * 100) / 100,
            stageTimings, prismaOperationCount: stageTimings.reduce((count, stage) => count + stage.prismaOperationCount, 0),
            transactionBodyMs: Math.round(callbackDurationMs * 100) / 100,
            commitAndResolutionMs: Math.round((transactionResolvedAt - callbackFinishedAt) * 100) / 100,
            transactionDurationMs: Math.round((transactionResolvedAt - transactionRequestedAt) * 100) / 100 });
        }
        return committed;
      } catch (error) {
        const failedAt = performance.now();
        const serializationConflict = isSerializationConflict(error);
        const prismaCode = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
        const metadata = error instanceof Prisma.PrismaClientKnownRequestError && error.meta && typeof error.meta === 'object'
          ? error.meta as Record<string, unknown> : null;
        const rawSqlState = metadata?.code;
        const sqlState = typeof rawSqlState === 'string' && rawSqlState !== prismaCode && /^[0-9A-Z]{5}$/.test(rawSqlState) ? rawSqlState : null;
        const willRetry = serializationConflict && retry < 2;
        const transactionOutcome = serializationConflict || prismaCode === 'P2002' || prismaCode === 'P2025' ? 'rolled_back' : 'unknown';
        if (diagnosticsEnabled) {
          const callbackDurationMs = callbackEnteredAt ? (callbackFinishedAt || failedAt) - callbackEnteredAt : 0;
          logger.error('Purchase transaction failed.', { event: 'order.purchase.transaction', outcome: 'failed', failureStage,
            prismaCode, sqlState, retryNumber: retry + 1, retriesCompleted: retry, retryCount: retry, willRetry,
            transactionOutcome, preflightDurationMs, preflightStages: preflightTimings,
            acquisitionAndBeginMs: callbackEnteredAt ? Math.round((callbackEnteredAt - transactionRequestedAt) * 100) / 100 : null,
            stageTimings, prismaOperationCount: stageTimings.reduce((count, stage) => count + stage.prismaOperationCount, 0),
            transactionBodyMs: callbackDurationMs ? Math.round(callbackDurationMs * 100) / 100 : null,
            rollbackAndResolutionMs: callbackFinishedAt ? Math.round((failedAt - callbackFinishedAt) * 100) / 100 : null,
            transactionDurationMs: Math.round((failedAt - transactionRequestedAt) * 100) / 100 });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2002') {
            const committed = await existing(this.database);
            if (committed) return result(committed, true, this.database);
          }
          if (serializationConflict && retry < 2) continue;
          if (serializationConflict || ['P2002', 'P2025'].includes(error.code)) throw new AppError('Checkout changed. Retry the same checkout attempt safely.', 409, 'CHECKOUT_CONFLICT');
        }
        throw error;
      }
    }
    throw new AppError('Checkout could not be completed.', 409, 'CHECKOUT_CONFLICT');
  }
}
