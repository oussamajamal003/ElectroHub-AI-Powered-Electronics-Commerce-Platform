import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PaymentService, SUBMIT_LEASE_WAIT_MS } from '../payment.service.js';
import { OrderService } from '../order.service.js';
import { InventoryService } from '../inventory.service.js';
import { currentCart } from '../cart.service.js';
import { cartRevision, checkoutRequestSchema, requestHash } from '../checkout.domain.js';
import type { Attempt, PaymentProvider, ProviderIntent } from '../payment.domain.js';

vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../stripe.provider.js', () => ({ stripeProvider: {} }));
vi.mock('../cart.service.js', async original => ({ ...await original<typeof import('../cart.service.js')>(), currentCart: vi.fn() }));

const userId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const attemptId = '33333333-3333-4333-8333-333333333333';
const productA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const productB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const leaseToken = '44444444-4444-4444-8444-444444444444';
const line = (productId: string) => ({ productId, quantity: 1, product: { price: '10.00' } });
const revisionA = cartRevision(cartId, [line(productA)]);
const revisionB = cartRevision(cartId, [line(productB)]);
const request = checkoutRequestSchema.parse({ shipping: { recipient: 'Test Customer', line1: 'Test Street', city: 'Test City',
  postalCode: '00000', country: 'US', phone: '1234567890' }, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: revisionA });
let attempt: Attempt;
const provider = { account: vi.fn(), create: vi.fn(), retrieve: vi.fn(), capture: vi.fn(), cancel: vi.fn(), refund: vi.fn(), retrieveRefund: vi.fn() } satisfies PaymentProvider;
const db = { paymentAttempt: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() }, paymentWork: { update: vi.fn() },
  paymentAttemptItem: { findMany: vi.fn(), update: vi.fn() }, user: { findFirst: vi.fn() }, order: { findUnique: vi.fn(), create: vi.fn() },
  cartItem: { deleteMany: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn() };
const inventory = new InventoryService();
beforeEach(() => {
  vi.resetAllMocks();
  const now = new Date();
  attempt = { id: attemptId, userId, cartId, cartIdentity: cartId, activeCartId: cartId, idempotencyKey: attemptId,
    request, requestHash: requestHash(request), revision: revisionA, state: 'AWAITING_INPUT', cancelRequested: false, orderId: null,
    total: new Prisma.Decimal(10), subtotal: new Prisma.Decimal(10), shippingCost: new Prisma.Decimal(0), amountCents: 1000,
    currency: 'USD', stripeAccountId: 'acct_test', providerIntentId: 'pi_A', providerStatus: 'requires_payment_method',
    failureCode: null, authorizationExpiresAt: null, expiresAt: new Date(Date.now() + 60000), refundId: null,
    refundAmountCents: null, compensatedAt: null, recoveryRemainder: null, submittedAt: null, confirmationStartedAt: null, restoredAt: null, dismissedAt: null, notificationReadState: null, createdAt: now, updatedAt: now,
    items: [{ id: productA, attemptId, productId: productA, productName: 'Item A', sku: 'A', imageUrl: null, sourceCartItemId: null, snapshotCartItemId: null,
      quantity: 1, unitPrice: new Prisma.Decimal(10), lineTotal: new Prisma.Decimal(10) }] };
  db.paymentAttempt.findUnique.mockImplementation(async ({ where, include }: { where: { id?: string; userId_idempotencyKey?: { idempotencyKey: string } }; include?: { work?: boolean } }) =>
    where.id || where.userId_idempotencyKey?.idempotencyKey === attemptId ? { ...attempt, ...(include?.work ? { work: null } : {}) } : null);
  db.paymentAttempt.findFirst.mockImplementation(async () => ({ ...attempt, work: null }));
  db.paymentAttemptItem.findMany.mockImplementation(async () => attempt.items);
  db.user.findFirst.mockResolvedValue({ id: userId });
  db.order.findUnique.mockResolvedValue(null);
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  db.$queryRaw.mockImplementation(async (sql: Prisma.Sql) => {
    if (sql.sql.includes('FROM "payment_attempts"')) return [{ ...attempt }];
    if (sql.sql.includes('FROM "payment_work"')) return [{ state: 'LEASED', leaseToken, leaseUntil: new Date(Date.now() + 60000) }];
    if (sql.sql.includes('FROM "carts"')) return [{ id: cartId }];
    if (sql.sql.includes('FROM "cart_items"')) return [{ productId: productB, quantity: 1, categoryId: 'category', price: '10.00', status: 'ACTIVE' }];
    if (sql.sql.includes('FROM "categories"')) return [{ id: 'category', isActive: true }];
    if (sql.sql.includes('FROM "inventory"')) return [{ productId: productB, quantity: 10, lowStockAt: 5 }];
    return [];
  });
  provider.account.mockResolvedValue('acct_test');
  vi.mocked(currentCart).mockResolvedValue({ data: { revision: revisionB, canCheckout: true, items: [line(productB)] } } as Awaited<ReturnType<typeof currentCart>>);
  vi.spyOn(inventory, 'decreaseStock').mockImplementation(async () => { throw new Error('No Inventory effect is expected in these isolation cases.'); });
});
describe('Payment/Order snapshot isolation (offline database/provider doubles)', () => {
  const prepareSubmission = () => {
    attempt.items[0].snapshotCartItemId = productA;
    db.paymentAttempt.findFirst.mockImplementation(async ({ where }: { where: { userId: string } }) =>
      where.userId === userId ? { ...attempt, work: { state: 'READY' } } : null);
    db.paymentAttempt.update.mockImplementation(async ({ data }: { data: Partial<Attempt> }) => Object.assign(attempt, data));
    db.cartItem.deleteMany.mockResolvedValue({ count: 1 });
    vi.mocked(currentCart).mockResolvedValue({ data: { revision: revisionA, canCheckout: true,
      items: [{ ...line(productA), id: productA }] } } as Awaited<ReturnType<typeof currentCart>>);
  };
  it('transfers the exact source line with Attempt/Work/Cart lock order and no provider I/O', async () => {
    prepareSubmission();
    const result = await new PaymentService(db as unknown as PrismaClient, provider).submit(userId, attemptId);
    expect(result.submittedAt).toBeTruthy();
    expect(db.paymentAttemptItem.update).toHaveBeenCalledWith({ where: { id: productA }, data: { sourceCartItemId: productA } });
    expect(db.cartItem.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { id: productA, cartId, quantity: 1 } });
    expect(attempt.activeCartId).toBeNull();
    expect(db.paymentWork.update).toHaveBeenCalledWith({ where: { attemptId }, data: { nextRunAt: expect.any(Date) } });
    const locks = db.$queryRaw.mock.calls.map(([sql]) => (sql as Prisma.Sql).sql);
    expect(locks[0]).toContain('"payment_attempts"'); expect(locks[1]).toContain('"payment_work"'); expect(locks[2]).toContain('"carts"');
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable', timeout: 30000, maxWait: 10000 });
    for (const operation of Object.values(provider)) expect(operation).not.toHaveBeenCalled();
  });
  describe('submit while the recovery worker holds a routine lease', () => {
    const leaseWait = async (work: () => { state: string; leaseUntil?: Date | null }) => {
      prepareSubmission();
      db.paymentAttempt.findFirst.mockImplementation(async ({ where }: { where: { userId: string } }) =>
        where.userId === userId ? { ...attempt, work: work() } : null);
    };
    it('waits for a live lease to clear and then submits (no 409 for a routine card-entry poll)', async () => {
      vi.useFakeTimers();
      try {
        let reads = 0;
        await leaseWait(() => (++reads <= 3 ? { state: 'LEASED', leaseUntil: new Date(Date.now() + 60_000) } : { state: 'READY' }));
        const pending = new PaymentService(db as unknown as PrismaClient, provider).submit(userId, attemptId);
        await vi.advanceTimersByTimeAsync(2_000);
        const result = await pending;
        expect(result.submittedAt).toBeTruthy(); expect(reads).toBeGreaterThan(3);
        expect(db.paymentWork.update).toHaveBeenCalledTimes(1); expect(db.cartItem.deleteMany).toHaveBeenCalledTimes(1);
      } finally { vi.useRealTimers(); }
    });
    it('still fails closed with PAYMENT_RECOVERY_PENDING if the lease never clears within the bounded wait, writing nothing', async () => {
      vi.useFakeTimers();
      try {
        await leaseWait(() => ({ state: 'LEASED', leaseUntil: new Date(Date.now() + 600_000) }));
        const pending = expect(new PaymentService(db as unknown as PrismaClient, provider).submit(userId, attemptId)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', statusCode: 409 });
        await vi.advanceTimersByTimeAsync(SUBMIT_LEASE_WAIT_MS + 1_000);
        await pending;
        expect(db.cartItem.deleteMany).not.toHaveBeenCalled(); expect(db.paymentAttempt.update).not.toHaveBeenCalled(); expect(db.paymentWork.update).not.toHaveBeenCalled();
      } finally { vi.useRealTimers(); }
    });
    it('does not treat an expired lease as a blocker, and still rejects work that is DONE or INCIDENT', async () => {
      await leaseWait(() => ({ state: 'LEASED', leaseUntil: new Date(Date.now() - 1_000) }));
      expect((await new PaymentService(db as unknown as PrismaClient, provider).submit(userId, attemptId)).submittedAt).toBeTruthy();
      for (const state of ['DONE', 'INCIDENT']) {
        attempt.submittedAt = null; vi.clearAllMocks();
        await leaseWait(() => ({ state }));
        await expect(new PaymentService(db as unknown as PrismaClient, provider).submit(userId, attemptId)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
      }
    });
  });
  it('submits Buy Now A without changing any Cart B line', async () => {
    prepareSubmission(); attempt.cartId = null; attempt.activeCartId = null; attempt.cartIdentity = userId;
    attempt.request = { ...request, scope: 'BUY_NOW', buyNow: { productId: productA, quantity: 1 } };
    attempt.items[0].snapshotCartItemId = null;
    const result = await new PaymentService(db as unknown as PrismaClient, provider).submit(userId, attemptId);
    expect(result.submittedAt).toBeTruthy(); expect(result.scope).toBe('BUY_NOW');
    expect(db.cartItem.deleteMany).not.toHaveBeenCalled(); expect(db.paymentAttemptItem.update).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
  });
  it('replays a submitted transfer without deleting newly added cart lines', async () => {
    prepareSubmission();
    const service = new PaymentService(db as unknown as PrismaClient, provider);
    await service.submit(userId, attemptId);
    vi.mocked(currentCart).mockResolvedValue({ data: { revision: revisionB, canCheckout: true, items: [line(productB)] } } as Awaited<ReturnType<typeof currentCart>>);
    const replay = await service.submit(userId, attemptId);
    // The replay returns the same accepted identity (no Cart projection on the confirmation critical path) and touches no Cart line.
    expect(replay).toMatchObject({ attemptId, submittedAt: expect.any(String) });
    expect(db.cartItem.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.paymentAttemptItem.update).toHaveBeenCalledTimes(1);
    expect(db.paymentWork.update).toHaveBeenCalledTimes(1);
  });
  it('rejects a recreated same-SKU line despite identical quantities, prices and revision', async () => {
    prepareSubmission();
    vi.mocked(currentCart).mockResolvedValue({ data: { revision: revisionA, canCheckout: true,
      items: [{ ...line(productA), id: productB }] } } as Awaited<ReturnType<typeof currentCart>>);
    await expect(new PaymentService(db as unknown as PrismaClient, provider).submit(userId, attemptId)).rejects.toMatchObject({ code: 'CHECKOUT_CHANGED' });
    expect(db.cartItem.deleteMany).not.toHaveBeenCalled(); expect(db.paymentAttemptItem.update).not.toHaveBeenCalled();
    expect(db.paymentAttempt.update).not.toHaveBeenCalled(); expect(db.paymentWork.update).not.toHaveBeenCalled();
  });
  it('rejects cross-customer submission before acquiring locks or changing ownership', async () => {
    prepareSubmission();
    await expect(new PaymentService(db as unknown as PrismaClient, provider).submit(productB, attemptId)).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_NOT_FOUND' });
    expect(db.$transaction).not.toHaveBeenCalled(); expect(db.cartItem.deleteMany).not.toHaveBeenCalled();
  });
  it('does not detach a cart while its durable payment work is leased', async () => {
    vi.useFakeTimers();
    try {
      prepareSubmission();
      db.paymentAttempt.findFirst.mockResolvedValue({ ...attempt, work: { state: 'LEASED' } });
      const pending = expect(new PaymentService(db as unknown as PrismaClient, provider).submit(userId, attemptId)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
      await vi.advanceTimersByTimeAsync(SUBMIT_LEASE_WAIT_MS + 1_000); await pending;
      expect(db.cartItem.deleteMany).not.toHaveBeenCalled(); expect(db.paymentAttempt.update).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('commits detached purchase A from its snapshot while preserving active Cart B', async () => {
    attempt.state = 'AUTHORIZED'; attempt.submittedAt = new Date(); attempt.activeCartId = null;
    const originalQuery = db.$queryRaw.getMockImplementation()!;
    db.$queryRaw.mockImplementation(async (sql: Prisma.Sql) => {
      if (sql.sql.includes('FROM "payment_attempt_items"')) return [{ productId: productA, quantity: 1, categoryId: 'category', price: '10.00', status: 'ACTIVE' }];
      if (sql.sql.includes('FROM "inventory"')) return [{ productId: productA, quantity: 10, lowStockAt: 5 }];
      return originalQuery(sql);
    });
    vi.mocked(inventory.decreaseStock).mockResolvedValue({ id: productA, productId: productA, quantity: 9, lowStockAt: 5, status: 'IN_STOCK', createdAt: new Date(), updatedAt: new Date() });
    db.order.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: leaseToken,
      createdAt: new Date(), payment: { status: 'PROCESSING', cardBrand: null, cardLast4: null },
      subtotal: attempt.subtotal, shippingCost: attempt.shippingCost, total: attempt.total,
      items: attempt.items.map(item => ({ ...item, productImageUrl: item.imageUrl })) }));
    const intent: ProviderIntent = { id: 'pi_A', account: 'acct_test', attemptId, amount: 1000, currency: 'usd', captureMethod: 'manual',
      status: 'requires_capture', received: 0, capturable: 1000, livemode: false, clientSecret: null, declined: false,
      methodType: 'card', card: null, captureBefore: null };
    const result = await new OrderService(db as unknown as PrismaClient, inventory).commitAuthorized(attemptId, intent, leaseToken);
    expect(result).toMatchObject({ replayed: false, cart: { revision: revisionB }, confirmation: { items: [{ productId: productA }] } });
    expect(db.cartItem.deleteMany).not.toHaveBeenCalled();
    expect(inventory.decreaseStock).toHaveBeenCalledExactlyOnceWith(productA, 1, db, { productId: productA, quantity: 10, lowStockAt: 5 });
    expect(db.$queryRaw.mock.calls.some(([sql]) => (sql as Prisma.Sql).sql.includes('FROM "cart_items"'))).toBe(false);
    expect(db.order.create).toHaveBeenCalledTimes(1);
    expect(provider.capture).not.toHaveBeenCalled();
  });
  it('rejects an old key replay against Cart B before retrieving or exposing Intent A', async () => {
    await expect(new PaymentService(db as unknown as PrismaClient, provider).setup(userId, attemptId, request)).rejects.toMatchObject({ code: 'CHECKOUT_CHANGED' });
    expect(provider.retrieve).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
    expect(db.paymentAttempt.create).not.toHaveBeenCalled(); expect(db.paymentAttempt.update).not.toHaveBeenCalled();
  });
  it('rejects same-hash active attempt reuse when the current locked Cart snapshot differs', async () => {
    await expect(new PaymentService(db as unknown as PrismaClient, provider).setup(userId, leaseToken, request)).rejects.toMatchObject({ code: 'CHECKOUT_CHANGED' });
    expect(provider.retrieve).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
    expect(db.paymentAttempt.update).not.toHaveBeenCalled();
  });
  it('keeps an authorized A from ordering or clearing B after the locked Cart revision changes', async () => {
    attempt.state = 'AUTHORIZED';
    const intent: ProviderIntent = { id: 'pi_A', account: 'acct_test', attemptId, amount: 1000, currency: 'usd', captureMethod: 'manual',
      status: 'requires_capture', received: 0, capturable: 1000, livemode: false, clientSecret: null, declined: false,
      methodType: 'card', card: null, captureBefore: null };
    await expect(new OrderService(db as unknown as PrismaClient, inventory).commitAuthorized(attemptId, intent, leaseToken)).rejects.toMatchObject({ code: 'CHECKOUT_CHANGED' });
    expect(db.order.create).not.toHaveBeenCalled(); expect(db.cartItem.deleteMany).not.toHaveBeenCalled();
    expect(inventory.decreaseStock).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable', maxWait: 10000, timeout: 30000 });
  });
  it('rejects authorization without submit for a new cart-line snapshot before consuming a recreated same-SKU line', async () => {
    attempt.state = 'AUTHORIZED'; attempt.items[0].snapshotCartItemId = productA;
    const intent: ProviderIntent = { id: 'pi_A', account: 'acct_test', attemptId, amount: 1000, currency: 'usd', captureMethod: 'manual',
      status: 'requires_capture', received: 0, capturable: 1000, livemode: false, clientSecret: null, declined: false,
      methodType: 'card', card: null, captureBefore: null };
    await expect(new OrderService(db as unknown as PrismaClient, inventory).commitAuthorized(attemptId, intent, leaseToken))
      .rejects.toMatchObject({ code: 'PAYMENT_SUBMISSION_REQUIRED' });
    expect(db.order.create).not.toHaveBeenCalled(); expect(db.cartItem.deleteMany).not.toHaveBeenCalled();
    expect(inventory.decreaseStock).not.toHaveBeenCalled();
  });
  it('projects A identity independently from the current Cart B revision during recovery', async () => {
    const status = await new PaymentService(db as unknown as PrismaClient, provider).status(userId, attemptId);
    expect(status).toMatchObject({ attemptId, intentId: 'pi_A', cartIdentity: cartId, cartRevision: revisionA, cart: { revision: revisionB } });
    expect(db.cartItem.deleteMany).not.toHaveBeenCalled(); expect(db.order.create).not.toHaveBeenCalled();
  });
  it('blocks B setup safely while authorized A still owns the Cart claim without reusing or canceling A', async () => {
    attempt.state = 'AUTHORIZED';
    await expect(new PaymentService(db as unknown as PrismaClient, provider).setup(userId, leaseToken,
      { ...request, expectedRevision: revisionB })).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(db.paymentAttempt.create).not.toHaveBeenCalled(); expect(db.paymentAttempt.update).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled(); expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
  });
  it('replays only committed Order A and returns current Cart B without any new purchase effects', async () => {
    attempt.orderId = leaseToken; attempt.state = 'CAPTURE_PENDING';
    db.order.findUnique.mockResolvedValue({ id: leaseToken, userId, checkoutRequestHash: requestHash(request), createdAt: new Date(),
      status: 'AWAITING_CAPTURE', paymentMethod: 'CARD', payment: { status: 'PROCESSING', cardBrand: null, cardLast4: null },
      shippingRecipient: request.shipping.recipient, shippingLine1: request.shipping.line1, shippingLine2: null,
      shippingCity: request.shipping.city, shippingState: null, shippingPostalCode: request.shipping.postalCode,
      shippingCountry: request.shipping.country, shippingPhone: request.shipping.phone, deliveryMethod: 'STANDARD',
      estimatedDeliveryStart: new Date(), estimatedDeliveryEnd: new Date(), currency: 'USD', subtotal: attempt.subtotal,
      shippingCost: attempt.shippingCost, total: attempt.total, items: attempt.items.map(item => ({ ...item, productImageUrl: item.imageUrl })) });
    const intent: ProviderIntent = { id: 'pi_A', account: 'acct_test', attemptId, amount: 1000, currency: 'usd', captureMethod: 'manual',
      status: 'requires_capture', received: 0, capturable: 1000, livemode: false, clientSecret: null, declined: false,
      methodType: 'card', card: null, captureBefore: null };
    const result = await new OrderService(db as unknown as PrismaClient, inventory).commitAuthorized(attemptId, intent, leaseToken);
    expect(result).toMatchObject({ replayed: true, confirmation: { orderReference: `ORD-${leaseToken.toUpperCase()}` }, cart: { revision: revisionB } });
    expect(db.$transaction).not.toHaveBeenCalled(); expect(db.cartItem.deleteMany).not.toHaveBeenCalled();
    expect(db.order.create).not.toHaveBeenCalled(); expect(inventory.decreaseStock).not.toHaveBeenCalled();
  });
});
