import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PaymentService } from '../payment.service.js';
import { currentCart, purchaseItemsProjection } from '../cart.service.js';
import type { Attempt, PaymentProvider, ProviderIntent } from '../payment.domain.js';
import { cartRevision, deliveryMethods, savedAmountsMatch, savedPurchaseTerms } from '../checkout.domain.js';
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../stripe.provider.js', () => ({ stripeProvider: {} }));
vi.mock('../cart.service.js', async original => ({ ...await original<typeof import('../cart.service.js')>(), currentCart: vi.fn(), purchaseItemsProjection: vi.fn() }));
const id = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
let attempt: Attempt; let intent: ProviderIntent;
const db = { paymentAttempt: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  cart: { upsert: vi.fn() }, cartItem: { upsert: vi.fn() }, $transaction: vi.fn(), $queryRaw: vi.fn() };
const provider = { account: vi.fn(), create: vi.fn(), retrieve: vi.fn(), capture: vi.fn(), cancel: vi.fn(), refund: vi.fn(), retrieveRefund: vi.fn() } satisfies PaymentProvider;
let service: PaymentService;
beforeEach(() => {
  vi.resetAllMocks(); const now = new Date();
  attempt = { id, userId: id, cartId: id, cartIdentity: id, activeCartId: null, idempotencyKey: id,
    requestHash: 'a'.repeat(64), revision: 'b'.repeat(64), request: { shipping: { recipient: 'Test Person', line1: 'Test Street', city: 'Test City', country: 'US', postalCode: '00000', phone: '1234567890' }, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: 'b'.repeat(64) },
    state: 'DECLINED', providerIntentId: 'pi_saved', providerStatus: 'requires_payment_method', stripeAccountId: 'acct_test',
    total: new Prisma.Decimal(10), subtotal: new Prisma.Decimal(10), shippingCost: new Prisma.Decimal(0), amountCents: 1000, currency: 'USD',
    cancelRequested: false, failureCode: 'PAYMENT_DECLINED', orderId: null, authorizationExpiresAt: null,
    expiresAt: now, createdAt: now, updatedAt: now, submittedAt: now, confirmationStartedAt: null, restoredAt: null, dismissedAt: null, notificationReadState: null,
    refundId: null, refundAmountCents: null, compensatedAt: null, recoveryRemainder: null,
    items: [{ id: productId, attemptId: id, productId, quantity: 1, unitPrice: new Prisma.Decimal(10), lineTotal: new Prisma.Decimal(10),
      productName: 'Item A', sku: 'A', imageUrl: null, sourceCartItemId: productId, snapshotCartItemId: productId }] };
  intent = { id: 'pi_saved', account: 'acct_test', attemptId: id, amount: 1000, currency: 'usd', captureMethod: 'manual',
    status: 'requires_payment_method', received: 0, capturable: 0, livemode: false, clientSecret: 'offline_secret', declined: true,
    methodType: 'card', card: null, captureBefore: null };
  db.paymentAttempt.findFirst.mockImplementation(async ({ where }: { where: { userId: string } }) => where.userId === id ? { ...attempt, work: { state: 'READY' } } : null);
  db.paymentAttempt.update.mockImplementation(async ({ data }: { data: Partial<Attempt> }) => Object.assign(attempt, data));
  db.paymentAttempt.findMany.mockImplementation(async () => [attempt]);
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  db.cart.upsert.mockResolvedValue({ id });
  // The saved revision is the canonical one the purchase was priced with (current delivery terms).
  (attempt.request as { expectedRevision: string }).expectedRevision = cartRevision(id, attempt.items.map(item => ({ productId: item.productId, quantity: item.quantity, product: { price: item.unitPrice.toFixed(2) } })));
  provider.retrieve.mockImplementation(async () => ({ ...intent }));
  vi.mocked(currentCart).mockResolvedValue({ data: { revision: 'cart-b', canCheckout: true, items: [{ productId, quantity: 2 }] } } as Awaited<ReturnType<typeof currentCart>>);
  vi.mocked(purchaseItemsProjection).mockResolvedValue({ products: new Map([[productId, { price: new Prisma.Decimal(10) }]]), data: { canCheckout: true, items: [{ product: { price: '10.00' } }] } } as Awaited<ReturnType<typeof purchaseItemsProjection>>);
  service = new PaymentService(db as unknown as PrismaClient, provider);
});
describe('Saved purchase retry, restoration and notifications (offline doubles)', () => {
  it('reuses the verified intent and saved shipping without modifying Cart B', async () => {
    const result = await service.resume(id, id);
    expect(result.clientSecret).toBe('offline_secret'); expect(result.request).toEqual(attempt.request);
    expect(provider.retrieve).toHaveBeenCalledExactlyOnceWith('pi_saved');
    expect(provider.create).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
    expect(db.cartItem.upsert).not.toHaveBeenCalled(); expect(db.cart.upsert).not.toHaveBeenCalled();
  });
  it.each(['processing', 'requires_capture', 'succeeded'])('rejects retry of provider %s without new authorization', async status => {
    intent.status = status;
    await expect(service.resume(id, id)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(db.$transaction).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
  });
  it('does not expose a secret when the provider binding is wrong', async () => {
    intent.attemptId = productId;
    await expect(service.resume(id, id)).rejects.toMatchObject({ code: 'PAYMENT_AMOUNT_MISMATCH' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects unknown provider retrieval and never creates a replacement intent', async () => {
    provider.retrieve.mockRejectedValue(new Error('network lost'));
    await expect(service.resume(id, id)).rejects.toThrow('network lost');
    expect(provider.create).not.toHaveBeenCalled(); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('fails closed on price/stock changes without overwriting snapshot or Cart B', async () => {
    vi.mocked(purchaseItemsProjection).mockResolvedValue({ data: { canCheckout: false, items: [] } } as unknown as Awaited<ReturnType<typeof purchaseItemsProjection>>);
    await expect(service.resume(id, id)).rejects.toMatchObject({ code: 'CHECKOUT_CHANGED' });
    expect(db.$transaction).not.toHaveBeenCalled(); expect(db.cartItem.upsert).not.toHaveBeenCalled();
  });
  it('adds canceled purchase quantities once without overwriting newer same-SKU cart quantities', async () => {
    attempt.state = 'CANCELED'; intent.status = 'canceled';
    await service.restore(id, id); await service.restore(id, id);
    expect(db.cartItem.upsert).toHaveBeenCalledExactlyOnceWith({ where: { cartId_productId: { cartId: id, productId } },
      create: { cartId: id, productId, quantity: 3 }, update: { quantity: 3 } });
    expect(attempt.restoredAt).toBeInstanceOf(Date);
    expect(provider.create).not.toHaveBeenCalled();
  });
  it.each(['CANCELED', 'COMPENSATED', 'REFUNDED'] as const)('never restores a Buy Now purchase into the active Cart (%s)', async state => {
    Object.assign(attempt, { state, request: { scope: 'BUY_NOW', buyNow: { productId, quantity: 1 } } }); intent.status = 'canceled';
    await expect(service.restore(id, id)).rejects.toMatchObject({ code: 'PURCHASE_NOT_RESTORABLE', statusCode: 409 });
    expect(db.cartItem.upsert).not.toHaveBeenCalled(); expect(db.$transaction).not.toHaveBeenCalled(); expect(provider.retrieve).not.toHaveBeenCalled();
    expect(attempt.restoredAt).toBeFalsy();
  });
  it('rejects restoration until cancellation is provider verified', async () => {
    attempt.state = 'CANCELED'; intent.status = 'requires_capture'; intent.capturable = 1000;
    await expect(service.restore(id, id)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(db.cartItem.upsert).not.toHaveBeenCalled();
  });
  it('never lists a purchase that ended without payment or decline evidence (documented exclusion rule; records preserved)', async () => {
    await service.purchases(id);
    const where = db.paymentAttempt.findMany.mock.calls.at(-1)?.[0]?.where;
    expect(where.NOT).toEqual({ state: 'CANCELED', failureCode: { in: ['PAYMENT_EXPIRED', 'PAYMENT_SETUP_SUPERSEDED', 'PAYMENT_INCOMPLETE', 'PAYMENT_CANCELED_BY_CUSTOMER'] } });
    expect(where.userId).toBe(id);
    expect(where.submittedAt).toEqual({ not: null }); // an unsubmitted checkout draft is never a customer-visible purchase
  });
  it('denies another customer status, resume, restore and acknowledgement', async () => {
    for (const operation of ['status', 'resume', 'restore'] as const) await expect(service[operation](productId, id)).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_NOT_FOUND' });
    await expect(service.acknowledge(productId, id, 'DECLINED')).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_NOT_FOUND' });
    expect(provider.retrieve).not.toHaveBeenCalled(); expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
  });
  it('persists acknowledgement for the exact customer and outcome, never marking a newer outcome read', async () => {
    await service.acknowledge(id, id, 'DECLINED');
    expect(db.paymentAttempt.updateMany).toHaveBeenCalledExactlyOnceWith({ where: { id, userId: id, state: 'DECLINED' }, data: { notificationReadState: 'DECLINED' } });
    const rows = await service.purchases(id);
    expect(rows[0]).toMatchObject({ attemptId: id, unread: true, pending: false });
    expect(JSON.stringify(rows)).not.toMatch(/clientSecret|leaseToken|shipping/);
  });
});

describe('Duplicate and concurrent resume of one saved purchase (offline doubles, explicit barriers)', () => {
  const conflict = () => new Prisma.PrismaClientKnownRequestError('Transaction write conflict', { code: 'P2034', clientVersion: 'test' });
  /** Holds the provider read so a second request provably arrives while the first is in flight. */
  function heldProviderRead() {
    let release!: () => void; const reached = new Promise<void>(arrived => {
      provider.retrieve.mockImplementation(() => { arrived(); return new Promise(resolve => { release = () => resolve({ ...intent }); }); });
    });
    return { reached, release: () => release() };
  }
  const noFinancialEffects = () => {
    for (const operation of ['create', 'capture', 'cancel', 'refund'] as const) expect(provider[operation]).not.toHaveBeenCalled();
    expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled(); expect(db.cartItem.upsert).not.toHaveBeenCalled();
  };
  // Task 03.6 product decision: a submitted purchase still at card entry is Processing; it never reopens card entry ("Continue to payment").
  it('refuses to reopen card entry for a submitted purchase Stripe has not declined, with no transaction or write', async () => {
    attempt.state = 'AWAITING_INPUT'; intent.declined = false;
    await expect(service.resume(id, id)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(provider.retrieve).toHaveBeenCalledTimes(1); expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.paymentAttempt.update).not.toHaveBeenCalled(); noFinancialEffects();
  });
  it('a decline Stripe recorded before the worker persisted it still opens Try Again and is persisted as DECLINED', async () => {
    attempt.state = 'AWAITING_INPUT'; intent.declined = true;
    await expect(service.resume(id, id)).resolves.toMatchObject({ attemptId: id, clientSecret: 'offline_secret' });
    expect(db.paymentAttempt.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'DECLINED', failureCode: 'PAYMENT_DECLINED' }) }));
    noFinancialEffects();
  });
  it('a verified never-confirmed purchase (still Processing) never reopens card entry through resume', async () => {
    attempt.state = 'AWAITING_INPUT'; attempt.failureCode = 'PAYMENT_NOT_CONFIRMED'; intent.declined = false;
    await expect(service.resume(id, id)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(db.$transaction).not.toHaveBeenCalled(); noFinancialEffects();
  });
  it('concurrent duplicates share one execution: one provider read, one locked transaction, one write, same result', async () => {
    const barrier = heldProviderRead();
    const first = service.resume(id, id); await barrier.reached;
    const duplicate = service.resume(id, id); const third = service.resume(id, id);
    barrier.release();
    const results = await Promise.all([first, duplicate, third]);
    expect(results[1]).toBe(results[0]); expect(results[2]).toBe(results[0]);
    expect(results[0]).toMatchObject({ attemptId: id, clientSecret: 'offline_secret' });
    expect(provider.retrieve).toHaveBeenCalledTimes(1); expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.paymentAttempt.update).toHaveBeenCalledTimes(1);
    expect(Object.keys(db.paymentAttempt.update.mock.calls[0]![0].data)).toEqual(['expiresAt']);
    noFinancialEffects();
  });
  it('never shares an in-flight result with another customer', async () => {
    const barrier = heldProviderRead();
    const owner = service.resume(id, id); await barrier.reached;
    await expect(service.resume(productId, id)).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_NOT_FOUND' });
    barrier.release();
    await expect(owner).resolves.toMatchObject({ clientSecret: 'offline_secret' });
    expect(provider.retrieve).toHaveBeenCalledTimes(1);
  });
  it('does not cache: a later request re-reads owned eligibility instead of replaying the earlier result', async () => {
    await service.resume(id, id);
    attempt.state = 'PROCESSING';
    await expect(service.resume(id, id)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(provider.retrieve).toHaveBeenCalledTimes(1);
  });
  it('a failed execution rejects every joined caller and is not retained', async () => {
    let fail!: (error: Error) => void;
    provider.retrieve.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const first = service.resume(id, id); const duplicate = service.resume(id, id);
    await vi.waitFor(() => expect(provider.retrieve).toHaveBeenCalledTimes(1));
    fail(new Error('network lost'));
    await expect(first).rejects.toThrow('network lost'); await expect(duplicate).rejects.toThrow('network lost');
    await expect(service.resume(id, id)).resolves.toMatchObject({ clientSecret: 'offline_secret' });
    expect(db.$transaction).toHaveBeenCalledTimes(1); noFinancialEffects();
  });
  it('a serialization conflict from a cross-instance duplicate is retried under fresh locks without a second provider call', async () => {
    db.$transaction.mockRejectedValueOnce(conflict());
    await expect(service.resume(id, id)).resolves.toMatchObject({ attemptId: id, clientSecret: 'offline_secret' });
    expect(db.$transaction).toHaveBeenCalledTimes(2); expect(provider.retrieve).toHaveBeenCalledTimes(1);
    expect(db.paymentAttempt.update).toHaveBeenCalledTimes(1); noFinancialEffects();
  });
  it('the retry re-reads eligibility: a winner that started recovery makes the loser fail closed', async () => {
    db.$transaction.mockRejectedValueOnce(conflict());
    db.paymentAttempt.findFirst.mockImplementation(async () => db.$transaction.mock.calls.length < 2
      ? { ...attempt, work: { state: 'READY' } } : { ...attempt, work: { state: 'LEASED' } });
    await expect(service.resume(id, id)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(db.paymentAttempt.update).not.toHaveBeenCalled(); noFinancialEffects();
  }, 25_000);
  it('a routine recovery lease that clears is waited out: Continue to payment reaches card entry instead of a recovery refusal', async () => {
    let reads = 0;
    db.paymentAttempt.findFirst.mockImplementation(async () => ({ ...attempt, work: db.$transaction.mock.calls.length && reads++ < 2
      ? { state: 'LEASED', leaseUntil: new Date(Date.now() + 60_000) } : { state: 'READY' } }));
    await expect(service.resume(id, id)).resolves.toMatchObject({ attemptId: id, clientSecret: 'offline_secret' });
    expect(provider.retrieve).toHaveBeenCalledTimes(1); expect(db.paymentAttempt.update).toHaveBeenCalledTimes(1); noFinancialEffects();
  });
  it('a persistent conflict is bounded to three attempts and surfaces without any provider mutation', async () => {
    db.$transaction.mockRejectedValue(conflict());
    await expect(service.resume(id, id)).rejects.toMatchObject({ code: 'P2034' });
    expect(db.$transaction).toHaveBeenCalledTimes(3); expect(provider.retrieve).toHaveBeenCalledTimes(1); noFinancialEffects();
  });
  it('a non-conflict database failure (for example P2028) is not retried', async () => {
    db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Transaction expired', { code: 'P2028', clientVersion: 'test' }));
    await expect(service.resume(id, id)).rejects.toMatchObject({ code: 'P2028' });
    expect(db.$transaction).toHaveBeenCalledTimes(1); noFinancialEffects();
  });
});

// Task 03.6 final rule: a verified never-confirmed purchase is Processing with Cancel purchase (server-computed), never Try Again or Payment failed.
it('projects a verified never-confirmed purchase as Processing with Cancel purchase, and nothing else as cancelable', async () => {
  const verified = { ...attempt, state: 'AWAITING_INPUT', failureCode: 'PAYMENT_NOT_CONFIRMED', confirmationStartedAt: null, work: { state: 'READY', lastError: null, nextRunAt: new Date(0) } };
  db.paymentAttempt.findMany.mockResolvedValue([verified]);
  expect((await service.purchases(id))[0]).toMatchObject({ classification: 'PROCESSING', pending: true, retryAllowed: false, cancelable: true });
  db.paymentAttempt.findMany.mockResolvedValue([{ ...verified, failureCode: null }]);
  expect((await service.purchases(id))[0]).toMatchObject({ classification: 'PROCESSING', cancelable: false });
  db.paymentAttempt.findMany.mockResolvedValue([{ ...attempt, state: 'DECLINED', failureCode: 'PAYMENT_DECLINED', work: { state: 'DONE', lastError: null, nextRunAt: new Date(0) } }]);
  expect((await service.purchases(id))[0]).toMatchObject({ classification: 'DECLINED', retryAllowed: true, cancelable: false });
  expect(provider.retrieve).not.toHaveBeenCalled(); expect(db.paymentAttempt.update).not.toHaveBeenCalled();
});
it('a list read reconciles only work the durable runner left overdue; ordinary reads make no provider calls', async () => {
  const processing = { ...attempt, state: 'AWAITING_INPUT', failureCode: null };
  const process = vi.spyOn(service, 'process').mockResolvedValue(null);
  db.paymentAttempt.findMany.mockResolvedValue([{ ...processing, work: { state: 'READY', lastError: null, nextRunAt: new Date(Date.now() - 5_000) } }]);
  await service.purchases(id); expect(process).not.toHaveBeenCalled();
  db.paymentAttempt.findMany.mockResolvedValue([{ ...processing, work: { state: 'LEASED', lastError: null, nextRunAt: new Date(0) } }]);
  await service.purchases(id); expect(process).not.toHaveBeenCalled();
  db.paymentAttempt.findMany.mockResolvedValue([{ ...processing, work: { state: 'READY', lastError: null, nextRunAt: new Date(Date.now() - 60_000) } }]);
  await service.purchases(id); expect(process).toHaveBeenCalledTimes(1);
});
it('purchase projection distinguishes retryable decline from unknown without financial effects', async () => {
  db.paymentAttempt.findMany.mockResolvedValue([{ ...attempt, state: 'DECLINED', work: { state: 'READY', lastError: null } }]);
  expect((await service.purchases(id))[0]).toMatchObject({ classification: 'DECLINED', pending: false, retryAllowed: true });
  db.paymentAttempt.findMany.mockResolvedValue([{ ...attempt, state: 'DECLINED', work: { state: 'READY', lastError: 'UNKNOWN_PROVIDER_OUTCOME' } }]);
  expect((await service.purchases(id))[0]).toMatchObject({ classification: 'UNKNOWN', pending: true, retryAllowed: false });
  expect(provider.retrieve).not.toHaveBeenCalled(); expect(db.paymentAttempt.update).not.toHaveBeenCalled();
});

describe('Saved delivery terms are revalidated before card confirmation (offline doubles)', () => {
  type Method = { id: string; price: string; minDays: number; maxDays: number };
  const methods = deliveryMethods as unknown as Method[]; const original = methods.map(method => ({ ...method }));
  afterEach(() => { methods.splice(0, methods.length, ...original.map(method => ({ ...method }))); });
  const noMutation = () => {
    expect(db.paymentAttempt.update).not.toHaveBeenCalled(); expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
    expect(db.cartItem.upsert).not.toHaveBeenCalled(); expect(db.cart.upsert).not.toHaveBeenCalled();
    for (const operation of ['create', 'capture', 'cancel', 'refund'] as const) expect(provider[operation]).not.toHaveBeenCalled();
  };
  const standard = () => methods.find(method => method.id === 'STANDARD')!;

  it('unchanged terms: resumes the SAME attempt and intent for the SAME amount, extending only expiry', async () => {
    const snapshot = () => ({ amountCents: attempt.amountCents, total: attempt.total.toFixed(2), shippingCost: attempt.shippingCost.toFixed(2), providerIntentId: attempt.providerIntentId, request: JSON.stringify(attempt.request) });
    const before = snapshot();
    const result = await service.resume(id, id);
    expect(result).toMatchObject({ attemptId: id, clientSecret: 'offline_secret' });
    expect(provider.retrieve).toHaveBeenCalledExactlyOnceWith('pi_saved'); expect(provider.create).not.toHaveBeenCalled();
    expect(db.paymentAttempt.update).toHaveBeenCalledTimes(1);
    expect(Object.keys(db.paymentAttempt.update.mock.calls[0]![0].data)).toEqual(['expiresAt']);
    expect(snapshot()).toEqual(before);
  });
  it('changed shipping fee for the saved method: 409 CHECKOUT_CHANGED before any lock or write', async () => {
    standard().price = '4.99';
    await expect(service.resume(id, id)).rejects.toMatchObject({ statusCode: 409, code: 'CHECKOUT_CHANGED' });
    expect(db.$transaction).not.toHaveBeenCalled(); expect(provider.retrieve).toHaveBeenCalledTimes(1); noMutation();
  });
  it('changed terms of another method also invalidate the revision, exactly as order commit would', async () => {
    methods.find(method => method.id === 'OVERNIGHT')!.price = '24.99';
    await expect(service.resume(id, id)).rejects.toMatchObject({ code: 'CHECKOUT_CHANGED' }); noMutation();
  });
  it('retired delivery method: 409 CHECKOUT_CHANGED', async () => {
    methods.splice(methods.findIndex(method => method.id === 'STANDARD'), 1);
    await expect(service.resume(id, id)).rejects.toMatchObject({ code: 'CHECKOUT_CHANGED' });
    expect(db.$transaction).not.toHaveBeenCalled(); noMutation();
  });
  it('purchase priced under a previous DELIVERY_VERSION: 409 CHECKOUT_CHANGED', async () => {
    // Same canonical revision recipe as cartRevision, produced under the previous version string.
    const previous = createHash('sha256').update(JSON.stringify(['03.4-v0', original.map(method => [method.id, method.price, method.minDays, method.maxDays]), id,
      attempt.items.map(item => [item.productId, item.quantity, item.unitPrice.toFixed(2)])])).digest('hex');
    (attempt.request as { expectedRevision: string }).expectedRevision = previous;
    await expect(service.resume(id, id)).rejects.toMatchObject({ code: 'CHECKOUT_CHANGED' }); noMutation();
  });
  it('saved amounts that no longer equal canonical totals are rejected, never re-priced', async () => {
    // The provider binding still matches (so the existing guard passes); only the canonical totals disagree.
    attempt.amountCents = 1099; intent.amount = 1099;
    await expect(service.resume(id, id)).rejects.toMatchObject({ code: 'CHECKOUT_CHANGED' }); noMutation();
    expect(attempt.amountCents).toBe(1099);
  });
  it('terms changing between the preflight and the locked re-check write nothing', async () => {
    db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => { standard().price = '4.99'; return fn(db); });
    await expect(service.resume(id, id)).rejects.toMatchObject({ code: 'CHECKOUT_CHANGED' });
    expect(db.$transaction).toHaveBeenCalledTimes(1); noMutation();
  });
  it('existing guards stay authoritative over the new check (authorized intent, in-flight state, recovery lease)', async () => {
    standard().price = '4.99';
    intent.status = 'requires_capture'; intent.capturable = 1000;
    await expect(service.resume(id, id)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    intent.status = 'requires_payment_method'; intent.capturable = 0; attempt.state = 'PROCESSING';
    await expect(service.resume(id, id)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(db.$transaction).not.toHaveBeenCalled(); noMutation();
    // A recovery lease found under the locks wins even when terms are current.
    methods.splice(0, methods.length, ...original.map(method => ({ ...method }))); attempt.state = 'DECLINED';
    db.paymentAttempt.findFirst.mockImplementation(async () => ({ ...attempt, work: { state: db.$transaction.mock.calls.length ? 'LEASED' : 'READY' } }));
    await expect(service.resume(id, id)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(db.paymentAttempt.update).not.toHaveBeenCalled();
   }, 25_000);
  it('existing availability/unit-price failure keeps its code and message and is reported first', async () => {
    standard().price = '4.99';
    vi.mocked(purchaseItemsProjection).mockResolvedValue({ products: new Map([[productId, { price: new Prisma.Decimal(11) }]]), data: { canCheckout: true, items: [] } } as unknown as Awaited<ReturnType<typeof purchaseItemsProjection>>);
    await expect(service.resume(id, id)).rejects.toMatchObject({ code: 'CHECKOUT_CHANGED', message: 'Saved purchase availability or pricing changed. Contact support before retrying.' });
    noMutation();
  });
  it('concurrent duplicates with stale terms share one rejected execution: one provider read, no transaction, no write', async () => {
    standard().price = '4.99';
    const results = await Promise.allSettled([service.resume(id, id), service.resume(id, id), service.resume(id, id)]);
    expect(results.every(result => result.status === 'rejected' && (result.reason as { code?: string }).code === 'CHECKOUT_CHANGED')).toBe(true);
    expect(provider.retrieve).toHaveBeenCalledTimes(1); expect(db.$transaction).not.toHaveBeenCalled(); noMutation();
  });
});

describe('savedPurchaseTerms: one rule set for saved-purchase retry and order commit', () => {
  const lines = [{ productId, quantity: 2, price: new Prisma.Decimal('10.00') }];
  const revision = cartRevision(id, lines.map(line => ({ productId: line.productId, quantity: line.quantity, product: { price: '10.00' } })));
  it('computes canonical totals and revision for the saved method', () => {
    const terms = savedPurchaseTerms({ scopeId: id, expectedRevision: revision, deliveryMethod: 'EXPRESS', lines });
    expect(terms.revisionMatches).toBe(true); expect(terms.delivery?.id).toBe('EXPRESS');
    expect(terms.totals).toEqual({ subtotal: '20.00', shipping: '9.99', total: '29.99', currency: 'USD' });
    expect(savedAmountsMatch(terms.totals!, { total: '29.99', shippingCost: '9.99' })).toBe(true);
    expect(savedAmountsMatch(terms.totals!, { total: new Prisma.Decimal('29.99'), shippingCost: new Prisma.Decimal('12.99') })).toBe(false);
  });
  it('flags scope, line-price and unknown-method drift exactly where order commit branches', () => {
    expect(savedPurchaseTerms({ scopeId: productId, expectedRevision: revision, deliveryMethod: 'EXPRESS', lines }).revisionMatches).toBe(false);
    expect(savedPurchaseTerms({ scopeId: id, expectedRevision: revision, deliveryMethod: 'EXPRESS', lines: [{ ...lines[0]!, price: '10.01' }] }).revisionMatches).toBe(false);
    const unknown = savedPurchaseTerms({ scopeId: id, expectedRevision: revision, deliveryMethod: 'DRONE', lines });
    expect(unknown.delivery).toBeNull(); expect(unknown.totals).toBeNull();
  });
});
