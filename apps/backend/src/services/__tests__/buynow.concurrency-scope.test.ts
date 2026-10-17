/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PaymentService } from '../payment.service.js';
import { OrderService } from '../order.service.js';
import { InventoryService } from '../inventory.service.js';
import type { Attempt, PaymentProvider, ProviderIntent } from '../payment.domain.js';
import { buyNowScopeId, cartRevision } from '../checkout.domain.js';

vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../stripe.provider.js', () => ({ stripeProvider: {} }));

describe('Buy Now Concurrency, Scope Collisions & Nullable Cart Recovery', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const cartId = '22222222-2222-4222-8222-222222222222';
  const productAId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const productBId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  let db: Record<string, any>;
  let provider: PaymentProvider;
  let inventory: InventoryService;
  let paymentService: PaymentService;
  let orderService: OrderService;
  let attemptsMap: Map<string, any>;
  let workMap: Map<string, any>;
  let cartItemsMap: Map<string, any>;

  const mockProductA = {
    id: productAId,
    name: 'Product A',
    sku: 'SKU-A',
    price: new Prisma.Decimal('99.99'),
    status: 'ACTIVE',
    categoryId: 'cat-1',
    category: { id: 'cat-1', name: 'Cat 1', isActive: true },
    inventory: { id: 'inv-a', productId: productAId, quantity: 10, lowStockAt: 2 },
    images: [{ url: 'https://img.test/a.jpg' }],
  };

  const mockProductB = {
    id: productBId,
    name: 'Product B',
    sku: 'SKU-B',
    price: new Prisma.Decimal('149.99'),
    status: 'ACTIVE',
    categoryId: 'cat-1',
    category: { id: 'cat-1', name: 'Cat 1', isActive: true },
    inventory: { id: 'inv-b', productId: productBId, quantity: 5, lowStockAt: 2 },
    images: [{ url: 'https://img.test/b.jpg' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    attemptsMap = new Map<string, any>();
    workMap = new Map<string, any>();
    cartItemsMap = new Map<string, any>();

    // Initial persistent cart has Product A with quantity 2
    cartItemsMap.set(`${cartId}_${productAId}`, {
      id: 'cart-item-1',
      cartId,
      productId: productAId,
      quantity: 2,
      product: mockProductA,
    });

    db = {
      user: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          if (where.id === userId && where.isActive) return { id: userId, role: { name: 'CUSTOMER' } };
          return null;
        }),
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          if (where.id === userId) return { id: userId, isActive: true };
          return null;
        }),
      },
      cart: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          if (where.userId === userId) {
            const items = Array.from(cartItemsMap.values()).filter(i => i.cartId === cartId);
            return { id: cartId, userId, items };
          }
          return null;
        }),
      },
      cartItem: {
        findMany: vi.fn().mockImplementation(async () => Array.from(cartItemsMap.values())),
        deleteMany: vi.fn().mockImplementation(async ({ where }) => {
          let count = 0;
          for (const [key, val] of Array.from(cartItemsMap.entries())) {
            if (val.cartId === where.cartId) {
              cartItemsMap.delete(key);
              count++;
            }
          }
          return { count };
        }),
        upsert: vi.fn().mockImplementation(async ({ create, update, where }) => {
          const key = `${where.cartId_productId.cartId}_${where.cartId_productId.productId}`;
          const existing = cartItemsMap.get(key);
          if (existing) {
            existing.quantity += update.quantity.increment ?? 0;
            return existing;
          }
          cartItemsMap.set(key, { id: 'upserted', ...create });
          return cartItemsMap.get(key);
        }),
      },
      product: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          if (where.id === productAId) return mockProductA;
          if (where.id === productBId) return mockProductB;
          return null;
        }),
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          const res = [];
          if (where?.id?.in?.includes(productAId)) res.push(mockProductA);
          if (where?.id?.in?.includes(productBId)) res.push(mockProductB);
          return res;
        }),
      },
      inventory: {
        findUnique: vi.fn(),
      },
      paymentAttempt: {
        findUnique: vi.fn().mockImplementation(async ({ where, include }) => {
          if (where.id) {
            const a = attemptsMap.get(where.id);
            if (!a) return null;
            return { ...a, ...(include?.work ? { work: workMap.get(a.id) } : {}) };
          }
          if (where.userId_idempotencyKey) {
            for (const a of attemptsMap.values()) {
              if (a.userId === where.userId_idempotencyKey.userId && a.idempotencyKey === where.userId_idempotencyKey.idempotencyKey) {
                return { ...a, ...(include?.work ? { work: workMap.get(a.id) } : {}) };
              }
            }
          }
          return null;
        }),
        findFirst: vi.fn().mockImplementation(async ({ where, include }) => {
          if (where.id) {
            const a = attemptsMap.get(where.id);
            if (!a || (where.userId && a.userId !== where.userId)) return null;
            return { ...a, ...(include?.work ? { work: workMap.get(a.id) } : {}) };
          }
          if (where.activeCartId !== undefined) {
            for (const a of attemptsMap.values()) {
              if (a.activeCartId === where.activeCartId && a.activeCartId !== null) {
                return { ...a, ...(include?.work ? { work: workMap.get(a.id) } : {}) };
              }
            }
            return null;
          }
          return null;
        }),
        create: vi.fn().mockImplementation(async ({ data, include }) => {
          const index = attemptsMap.size + 1;
          const newId = `11111111-2222-4333-8444-${String(index).padStart(12, '0')}`;
          const createdItems = data.items?.create?.map((i: any, idx: number) => ({
            id: `22222222-3333-4444-8555-${String(idx + 1).padStart(12, '0')}`,
            attemptId: newId,
            ...i,
          })) ?? [];
          const a = {
            id: newId,
            cancelRequested: false,
            orderId: null,
            ...data,
            subtotal: new Prisma.Decimal(data.subtotal),
            shippingCost: new Prisma.Decimal(data.shippingCost),
            total: new Prisma.Decimal(data.total),
            items: createdItems,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          attemptsMap.set(newId, a);
          if (data.work?.create) {
            workMap.set(newId, {
              id: `work-${newId}`,
              attemptId: newId,
              state: 'READY',
              nextRunAt: new Date(),
              retryCount: 0,
              leaseToken: null,
              leaseUntil: null,
              lastError: null,
            });
          }
          return { ...a, ...(include?.work ? { work: workMap.get(newId) } : {}) };
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const a = attemptsMap.get(where.id);
          if (!a) return null;
          Object.assign(a, data);
          return a;
        }),
      },
      paymentAttemptItem: {
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          const a = attemptsMap.get(where.attemptId);
          return a?.items ?? [];
        }),
      },
      paymentWork: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => workMap.get(where.attemptId) ?? null),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const w = workMap.get(where.attemptId);
          if (w) Object.assign(w, data);
          return w;
        }),
        updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
          const w = workMap.get(where.attemptId);
          if (!w) return { count: 0 };
          Object.assign(w, data);
          return { count: 1 };
        }),
      },
      order: {
        findUnique: vi.fn().mockImplementation(async () => null),
        findFirst: vi.fn().mockImplementation(async () => null),
        create: vi.fn().mockImplementation(async ({ data }) => ({
          id: 'ord-123',
          ...data,
          subtotal: new Prisma.Decimal(data.subtotal),
          shippingCost: new Prisma.Decimal(data.shippingCost),
          total: new Prisma.Decimal(data.total),
          createdAt: new Date(),
          updatedAt: new Date(),
          items: data.items.create.map((item: any) => ({
            ...item,
            unitPrice: new Prisma.Decimal(item.unitPrice),
            lineTotal: new Prisma.Decimal(item.lineTotal),
          })),
        })),
        update: vi.fn().mockImplementation(async ({ where, data }) => ({ id: where.id, ...data })),
      },
      payment: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => ({ orderId: where.orderId, status: 'PROCESSING' })),
        update: vi.fn().mockImplementation(async ({ where, data }) => ({ orderId: where.orderId, ...data })),
      },
      $transaction: vi.fn().mockImplementation(async (callback: any) => callback(db)),
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockImplementation(async (sql: any) => {
        const text = typeof sql === 'string' ? sql : sql?.strings?.join('?') ?? '';
        if (text.includes('FROM "carts"')) return [{ id: cartId }];
        if (text.includes('FROM "payment_attempts"')) {
          const first = Array.from(attemptsMap.values())[0];
          return first ? [{
            cartId: first.cartId,
            cartIdentity: first.cartIdentity,
            state: 'AUTHORIZED',
            cancelRequested: first.cancelRequested ?? false,
            orderId: first.orderId ?? null,
            request: first.request,
            requestHash: first.requestHash,
            total: first.total,
            shippingCost: first.shippingCost,
            amountCents: first.amountCents,
          }] : [];
        }
        if (text.includes('FROM "payment_work"')) {
          const first = Array.from(workMap.values())[0];
          return first ? [{
            state: first.state,
            leaseToken: first.leaseToken,
            leaseUntil: first.leaseUntil,
          }] : [];
        }
        if (text.includes('FROM "payment_attempt_items"')) {
          return [{
            productId: mockProductA.id,
            quantity: 1,
            categoryId: mockProductA.categoryId,
            price: mockProductA.price,
            status: mockProductA.status,
          }];
        }
        if (text.includes('FROM "cart_items"')) {
          return [{
            productId: mockProductA.id,
            quantity: 2,
            categoryId: mockProductA.categoryId,
            price: mockProductA.price,
            status: mockProductA.status,
          }];
        }
        if (text.includes('FROM "categories"')) return [{ id: 'cat-1', isActive: true }];
        if (text.includes('FROM "inventory"')) return [{ productId: mockProductA.id, quantity: 10, lowStockAt: 2 }];
        if (text.includes('FROM "products"')) return [{ categoryId: 'cat-1' }];
        return [];
      }),
    };

    provider = {
      account: vi.fn().mockResolvedValue('acct_test'),
      create: vi.fn().mockImplementation(async (att: Attempt) => ({
        id: `pi_${att.id}`,
        account: att.stripeAccountId,
        livemode: false,
        amount: att.amountCents,
        currency: 'usd',
        captureMethod: 'manual',
        status: 'requires_payment_method',
        capturable: 0,
        received: 0,
        methodType: null,
        clientSecret: 'secret_test',
        attemptId: att.id,
        declined: false,
        card: null,
        captureBefore: null,
      })),
      retrieve: vi.fn().mockImplementation(async (id: string) => {
        const attemptId = id.startsWith('pi_') ? id.slice(3) : id;
        return {
          id,
          account: 'acct_test',
          livemode: false,
          amount: 9999,
          currency: 'usd',
          captureMethod: 'manual',
          status: 'requires_payment_method',
          capturable: 0,
          received: 0,
          methodType: null,
          clientSecret: 'secret_test',
          attemptId,
          declined: false,
          card: null,
          captureBefore: null,
        };
      }),
      capture: vi.fn(),
      cancel: vi.fn(),
      refund: vi.fn(),
      retrieveRefund: vi.fn(),
    };

    inventory = new InventoryService();
    vi.spyOn(inventory, 'decreaseStock').mockResolvedValue(undefined as any);
    vi.spyOn(inventory, 'increaseStock').mockResolvedValue(undefined as any);

    paymentService = new PaymentService(db as unknown as PrismaClient, provider, inventory);
    orderService = new OrderService(db as unknown as PrismaClient, inventory);
  });

  const baseShipping = {
    recipient: 'Jane Doe',
    line1: '456 Market St',
    city: 'San Francisco',
    postalCode: '94105',
    country: 'United States',
    phone: '+1 555 123 4567',
  };

  it('creates Buy Now payment attempt with cartId: null, activeCartId: null, and cartIdentity: userId', async () => {
    const buyNowRevision = cartRevision(buyNowScopeId(userId), [{
      productId: productAId,
      quantity: 1,
      product: { price: '99.99' },
    }]);

    const request = {
      shipping: baseShipping,
      deliveryMethod: 'STANDARD',
      paymentMethod: 'CARD',
      expectedRevision: buyNowRevision,
      scope: 'BUY_NOW',
      buyNow: { productId: productAId, quantity: 1 },
    };

    const idempotencyKey = '33333333-3333-4333-8333-333333333333';
    const result = await paymentService.setup(userId, idempotencyKey, request);

    expect(result.attemptId).toBeDefined();

    // Verify Prisma paymentAttempt.create payload:
    expect(db.paymentAttempt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId,
        cartId: null,
        activeCartId: null,
        cartIdentity: userId,
        idempotencyKey,
      }),
    }));

    // Verify carts table was NOT locked or inserted into:
    expect(db.$executeRaw).not.toHaveBeenCalled();
    const calls = db.$queryRaw.mock.calls.map((c: any) => c[0]?.strings?.join('?') ?? '');
    expect(calls.some((c: string) => c.includes('SELECT "id" FROM "carts" WHERE "id" ='))).toBe(false);
  });

  it('permits concurrent Buy Now attempts without activeCartId collision or mutex blocking', async () => {
    // Attempt 1 for Product A
    const revA = cartRevision(buyNowScopeId(userId), [{ productId: productAId, quantity: 1, product: { price: '99.99' } }]);
    const reqA = { shipping: baseShipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: revA, scope: 'BUY_NOW', buyNow: { productId: productAId, quantity: 1 } };
    const keyA = '44444444-4444-4444-8444-444444444444';

    // Attempt 2 for Product B
    const revB = cartRevision(buyNowScopeId(userId), [{ productId: productBId, quantity: 2, product: { price: '149.99' } }]);
    const reqB = { shipping: baseShipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: revB, scope: 'BUY_NOW', buyNow: { productId: productBId, quantity: 2 } };
    const keyB = '55555555-5555-4555-8555-555555555555';

    const [resA, resB] = await Promise.all([
      paymentService.setup(userId, keyA, reqA),
      paymentService.setup(userId, keyB, reqB),
    ]);

    expect(resA.attemptId).toBe('11111111-2222-4333-8444-000000000001');
    expect(resB.attemptId).toBe('11111111-2222-4333-8444-000000000002');
    expect(resA.attemptId).not.toBe(resB.attemptId);

    // Both attempts have activeCartId: null
    const createdCalls = db.paymentAttempt.create.mock.calls;
    expect(createdCalls[0][0].data.activeCartId).toBeNull();
    expect(createdCalls[1][0].data.activeCartId).toBeNull();

    // Independent snapshot items
    expect(createdCalls[0][0].data.items.create[0].productId).toBe(productAId);
    expect(createdCalls[1][0].data.items.create[0].productId).toBe(productBId);
  });

  it('prevents cross-scope collisions: active CART_CHECKOUT is not superseded or blocked by BUY_NOW', async () => {
    // 1. Create a regular Cart Checkout attempt
    const cartRev = cartRevision(cartId, [{ productId: productAId, quantity: 2, product: { price: '99.99' } }]);
    const cartReq = { shipping: baseShipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: cartRev, scope: 'CART_CHECKOUT' };
    const cartKey = '66666666-6666-4666-8666-666666666666';

    const cartAttempt = await paymentService.setup(userId, cartKey, cartReq);
    expect(cartAttempt.attemptId).toBe('11111111-2222-4333-8444-000000000001');

    // Verify regular cart checkout claimed activeCartId: cartId
    expect(db.paymentAttempt.create).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        cartId,
        activeCartId: cartId,
        cartIdentity: cartId,
      }),
    }));

    // 2. Now user performs a Buy Now checkout in parallel
    const buyRev = cartRevision(buyNowScopeId(userId), [{ productId: productBId, quantity: 1, product: { price: '149.99' } }]);
    const buyReq = { shipping: baseShipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: buyRev, scope: 'BUY_NOW', buyNow: { productId: productBId, quantity: 1 } };
    const buyKey = '77777777-7777-4777-8777-777777777777';

    const buyAttempt = await paymentService.setup(userId, buyKey, buyReq);
    expect(buyAttempt.attemptId).toBe('11111111-2222-4333-8444-000000000002');

    // Buy Now has activeCartId: null, so it did NOT collide with att-1
    expect(db.paymentAttempt.create).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        cartId: null,
        activeCartId: null,
        cartIdentity: userId,
      }),
    }));

    // Cart checkout attempt att-1 was NOT canceled or superseded
    const att1 = await db.paymentAttempt.findUnique({ where: { id: '11111111-2222-4333-8444-000000000001' } });
    expect(att1.cancelRequested).toBe(false);
    expect(att1.activeCartId).toBe(cartId);

    // Persistent cart lines are intact
    const currentCartLines = await db.cartItem.findMany();
    expect(currentCartLines.length).toBe(1);
    expect(currentCartLines[0].productId).toBe(productAId);
    expect(currentCartLines[0].quantity).toBe(2);
  });

  it('OrderService commitAuthorized executes BUY_NOW without locking or mutating persistent cart', async () => {
    const buyRev = cartRevision(buyNowScopeId(userId), [{ productId: productAId, quantity: 1, product: { price: '99.99' } }]);
    const buyReq = { shipping: baseShipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: buyRev, scope: 'BUY_NOW', buyNow: { productId: productAId, quantity: 1 } };
    const key = '88888888-8888-4888-8888-888888888888';

    const created = await paymentService.setup(userId, key, buyReq);

    const intent: ProviderIntent = {
      id: `pi_${created.attemptId}`,
      account: 'acct_test',
      livemode: false,
      amount: 9999,
      currency: 'usd',
      captureMethod: 'manual',
      status: 'requires_capture',
      capturable: 9999,
      received: 0,
      methodType: 'card',
      clientSecret: 'secret_test',
      attemptId: created.attemptId,
      declined: false,
      card: { brand: 'visa', last4: '4242' },
      captureBefore: new Date(Date.now() + 60_000),
    };

    const work = workMap.get(created.attemptId);
    work.state = 'LEASED';
    work.leaseToken = 'lease-token-123';
    work.leaseUntil = new Date(Date.now() + 60_000);

    // Commit authorized order for the BUY_NOW attempt
    const result = await orderService.commitAuthorized(created.attemptId, intent, 'lease-token-123');

    expect(result.confirmation).toBeDefined();
    expect(result.confirmation.orderReference).toMatch(/^ORD-/);

    // Stock was decreased for the purchased product
    expect(inventory.decreaseStock).toHaveBeenCalledWith(productAId, 1, expect.anything(), expect.anything());

    // cartItem.deleteMany was NOT called (zero persistent cart mutation)
    expect(db.cartItem.deleteMany).not.toHaveBeenCalled();

    // Persistent cart still contains Product A with quantity 2
    const cartLines = await db.cartItem.findMany();
    expect(cartLines.length).toBe(1);
    expect(cartLines[0].quantity).toBe(2);
  });

  it('PaymentService compensation for BUY_NOW restores inventory stock with zero cart locks and zero cart mutation', async () => {
    const buyRev = cartRevision(buyNowScopeId(userId), [{ productId: productAId, quantity: 1, product: { price: '99.99' } }]);
    const buyReq = { shipping: baseShipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: buyRev, scope: 'BUY_NOW', buyNow: { productId: productAId, quantity: 1 } };
    const key = '99999999-9999-4999-8999-999999999999';

    const setupResult = await paymentService.setup(userId, key, buyReq);
    const attemptRecord = attemptsMap.get(setupResult.attemptId);

    // Simulate an authorized and committed order that subsequently requires compensation (e.g. refund/cancellation)
    attemptRecord.orderId = 'ord-comp-1';
    attemptRecord.state = 'AUTHORIZED';
    attemptRecord.activeCartId = null;

    const workRecord = workMap.get(setupResult.attemptId);
    workRecord.state = 'LEASED';
    workRecord.leaseToken = 'token-comp';
    workRecord.leaseUntil = new Date(Date.now() + 60_000);

    // Invoke compensation via private compensate path (tested through cancel/refund workflow)
    // Directly testing compensate behavior:
    await (paymentService as any).compensate(attemptRecord, 'token-comp', false);

    // 1. Inventory stock is restored
    expect(inventory.increaseStock).toHaveBeenCalledWith(productAId, 1, expect.anything());

    // 2. Order status is CANCELLED
    expect(db.order.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ord-comp-1' },
      data: { status: 'CANCELLED' },
    }));

    // 3. Payment status is FAILED
    expect(db.payment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { orderId: 'ord-comp-1' },
      data: expect.objectContaining({ status: 'FAILED', failureReason: 'PAYMENT_COMPENSATED' }),
    }));

    // 4. PaymentAttempt is COMPENSATED with activeCartId: null
    expect(db.paymentAttempt.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: setupResult.attemptId },
      data: expect.objectContaining({
        state: 'COMPENSATED',
        activeCartId: null,
      }),
    }));

    // 5. Zero persistent cart mutation or locking
    expect(db.cartItem.upsert).not.toHaveBeenCalled();
    const cartLines = await db.cartItem.findMany();
    expect(cartLines.length).toBe(1);
    expect(cartLines[0].quantity).toBe(2);
  });
});
