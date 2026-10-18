import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PaymentService } from '../payment.service.js';
import { requestHash } from '../checkout.domain.js';
import type { Attempt, PaymentProvider, ProviderIntent } from '../payment.domain.js';

const projection = vi.hoisted(() => vi.fn());
const commit = vi.hoisted(() => vi.fn());
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../stripe.provider.js', () => ({ stripeProvider: {} }));
vi.mock('../cart.service.js', () => ({ currentCart: projection, buyNowProjection: projection, MAX_CART_LINES: 50, MAX_CART_QUANTITY: 999 }));
vi.mock('../order.service.js', () => ({ OrderService: class { getConfirmation = vi.fn(); commitAuthorized = commit; } }));
const oldId = '11111111-1111-4111-8111-111111111111';
const nextId = '22222222-2222-4222-8222-222222222222';
const newKey = '33333333-3333-4333-8333-333333333333';
const request = { shipping: { recipient: 'Test Customer', line1: '123 Test Street', city: 'Test City', postalCode: '12345',
  country: 'United States', phone: '+1 555 010 2000' }, deliveryMethod: 'STANDARD' as const, paymentMethod: 'CARD' as const, expectedRevision: 'b'.repeat(64) };
let records: Map<string, Attempt>;
let service: PaymentService;
const db = { user: { findFirst: vi.fn() }, paymentAttempt: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  paymentWork: { updateMany: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  payment: { update: vi.fn(), findUnique: vi.fn() }, order: { update: vi.fn(), findUnique: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn() };
const provider = { account: vi.fn(), create: vi.fn(), retrieve: vi.fn(), capture: vi.fn(), cancel: vi.fn(),
  refund: vi.fn(), retrieveRefund: vi.fn() } satisfies PaymentProvider;
function intent(attempt: Attempt): ProviderIntent {
  return { id: attempt.providerIntentId ?? `pi_${attempt.id}`, attemptId: attempt.id, account: 'acct_test', livemode: false,
    amount: attempt.amountCents, currency: 'usd', captureMethod: 'manual', status: attempt.providerStatus ?? 'requires_payment_method',
    capturable: 0, received: 0, methodType: 'card', clientSecret: `pi_${attempt.id}_secret_fixture`,
    declined: attempt.state === 'DECLINED', card: null, captureBefore: null };
}
beforeEach(() => {
  vi.resetAllMocks();
  const now = new Date();
  records = new Map([[oldId, { id: oldId, userId: 'customer', cartId: 'cart', cartIdentity: 'cart', activeCartId: 'cart', idempotencyKey: oldId,
    requestHash: requestHash(request), revision: request.expectedRevision, request, subtotal: new Prisma.Decimal('19.99'), shippingCost: new Prisma.Decimal(0),
    total: new Prisma.Decimal('19.99'), amountCents: 1999, currency: 'USD', stripeAccountId: 'acct_test', providerIntentId: 'pi_old',
    providerStatus: 'requires_payment_method', state: 'DECLINED', cancelRequested: false, failureCode: 'PAYMENT_DECLINED',
    authorizationExpiresAt: null, expiresAt: new Date(Date.now() + 60_000), orderId: null, refundId: null, refundAmountCents: null,
    compensatedAt: null, recoveryRemainder: null, submittedAt: null, confirmationStartedAt: null, restoredAt: null, dismissedAt: null, notificationReadState: null, createdAt: now, updatedAt: now, items: [] }]]);
  db.user.findFirst.mockResolvedValue({ id: 'customer' });
  db.$queryRaw.mockImplementation(async (sql: Prisma.Sql) => {
    if (sql.sql.includes('"payment_attempts"')) return [...records.values()].filter(r => r.activeCartId === 'cart').map(r => ({ id: r.id }));
    if (sql.sql.includes('"payment_work"')) return [{ state: 'READY' }];
    return [{ id: 'cart' }];
  });
  db.$transaction.mockImplementation(async operation => operation(db));
  db.paymentAttempt.findUnique.mockImplementation(async ({ where }) => where.userId_idempotencyKey
    ? [...records.values()].find(record => record.idempotencyKey === where.userId_idempotencyKey.idempotencyKey) ?? null : records.get(where.id));
  db.paymentAttempt.findFirst.mockImplementation(async ({ where }) => where.activeCartId
    ? [...records.values()].find(record => record.activeCartId === where.activeCartId) ?? null : records.get(where.id));
  db.paymentAttempt.update.mockImplementation(async ({ where, data }) => {
    const record = records.get(where.id); if (!record) throw new Error('Missing fixture attempt'); Object.assign(record, data); return record;
  });
  db.paymentAttempt.create.mockImplementation(async ({ data }) => {
    const old = records.get(oldId); if (!old) throw new Error('Missing fixture attempt');
    const created: Attempt = { ...old, ...data, subtotal: new Prisma.Decimal(data.subtotal), shippingCost: new Prisma.Decimal(data.shippingCost),
      total: new Prisma.Decimal(data.total), id: nextId, providerIntentId: null, providerStatus: null, state: 'PREPARING',
      cancelRequested: false, failureCode: null, items: [] };
    records.set(nextId, created); return created;
  });
  provider.account.mockResolvedValue('acct_test');
  projection.mockResolvedValue({ data: { items: [{ productId: 'product', quantity: 1 }], canCheckout: true, subtotal: '19.99', revision: request.expectedRevision },
    products: new Map([['product', { price: new Prisma.Decimal('19.99'), name: 'Normal product', sku: 'NORMAL', images: [] }]]) });
  service = new PaymentService(db as unknown as PrismaClient, provider);
  vi.spyOn(service, 'process').mockImplementation(async id => {
    const record = records.get(id); if (!record) throw new Error('Missing fixture attempt');
    if (record.state === 'PREPARING') { record.state = 'AWAITING_INPUT'; record.providerStatus = 'requires_payment_method'; record.providerIntentId = `pi_${id}`; }
    return intent(record);
  });
});

/** Executes actual setup/process; only persistence, provider and purchase commit are doubled. */
function enableProcessor(status: 'requires_capture' | 'requires_payment_method' | 'processing') {
  vi.mocked(service.process).mockRestore();
  const work = { state: 'READY', leaseToken: null as string | null, leaseUntil: null as Date | null,
    retryCount: 0, nextRunAt: new Date(0) };
  const record = records.get(oldId)!;
  const works = new Map([[oldId, work]]);
  const workFor = (id: string) => {
    if (!works.has(id)) works.set(id, { state: 'READY', leaseToken: null, leaseUntil: null, retryCount: 0, nextRunAt: new Date(0) });
    return works.get(id)!;
  };
  let current: ProviderIntent = { ...intent(record), status, methodType: 'card',
    capturable: status === 'requires_capture' ? record.amountCents : 0 };
  db.paymentWork.updateMany.mockImplementation(async ({ where, data }) => {
    const selected = workFor(where.attemptId);
    if (typeof where.state === 'string' && selected.state !== where.state) return { count: 0 };
    if (where.state?.in && !where.state.in.includes(selected.state)) return { count: 0 };
    if (!where.state && !(selected.state === 'READY' && selected.nextRunAt.getTime() <= Date.now() ||
      selected.state === 'LEASED' && selected.leaseUntil && selected.leaseUntil.getTime() < Date.now())) return { count: 0 };
    Object.assign(selected, data); return { count: 1 };
  });
  db.paymentWork.update.mockImplementation(async ({ where, data }) => { const selected = workFor(where.attemptId); Object.assign(selected, data); return { ...selected }; });
  db.paymentWork.findUnique.mockImplementation(async ({ where }) => ({ ...workFor(where.attemptId) }));
  db.paymentAttempt.findUnique.mockImplementation(async ({ where, include }) => {
    const found = where.userId_idempotencyKey
      ? [...records.values()].find(r => r.idempotencyKey === where.userId_idempotencyKey.idempotencyKey) : records.get(where.id);
    return found ? { ...found, ...(include?.work ? { work: { ...workFor(found.id) } } : {}) } : null;
  });
  db.paymentAttempt.findFirst.mockImplementation(async ({ where, include }) => {
    const found = where.activeCartId ? [...records.values()].find(r => r.activeCartId === where.activeCartId) : records.get(where.id);
    return found ? { ...found, ...(include?.work ? { work: { ...workFor(found.id) } } : {}) } : null;
  });
  const others = new Map<string, ProviderIntent>();
  provider.create.mockImplementation(async attempt => { const created = { ...intent(attempt), declined: false }; others.set(created.id, created); return { ...created }; });
  provider.retrieve.mockImplementation(async id => {
    const selected = id === current.id ? current : others.get(id);
    if (!selected) throw new Error('Unknown test Intent identity');
    return { ...selected };
  });
  provider.capture.mockImplementation(async () => {
    current = { ...current, status: 'succeeded', received: record.amountCents, capturable: 0 }; return { ...current };
  });
  provider.cancel.mockImplementation(async () => { current = { ...current, status: 'canceled', capturable: 0 }; return { ...current }; });
  db.$queryRaw.mockImplementation(async (sql: Prisma.Sql) => {
    if (sql.sql.includes('"payment_attempts"')) return [...records.values()].filter(r => r.activeCartId === 'cart').map(r => ({ id: r.id }));
    if (sql.sql.includes('"payment_work"')) return [{ ...workFor(String(sql.values[0])) }];
    return [{ id: 'cart' }];
  });
  commit.mockImplementation(async () => { record.orderId = 'order'; record.state = 'CAPTURE_PENDING'; });
  return { work, record };
}

describe('Attempt selection after decline (mocked DB/provider, not real payment evidence)', () => {
  it('expired awaiting setup reconciles late authorization without replacement or cancellation', async () => {
    Object.assign(records.get(oldId)!, { state: 'AWAITING_INPUT', failureCode: null, expiresAt: new Date(0) });
    const { record, work } = enableProcessor('requires_capture');
    const result = await service.setup('customer', newKey, request);
    expect(result).toMatchObject({ attemptId: oldId, state: 'PAID', clientSecret: null, replayed: true });
    expect(record).toMatchObject({ providerIntentId: 'pi_old', idempotencyKey: oldId, cancelRequested: false, state: 'PAID' });
    expect(records.size).toBe(1); expect(work.state).toBe('DONE');
    expect(db.paymentAttempt.create).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
    expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.refund).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(1); expect(provider.capture).toHaveBeenCalledTimes(1);
    expect(db.payment.update).toHaveBeenCalledTimes(1); expect(db.order.update).toHaveBeenCalledTimes(1);
    await service.setup('customer', oldId, request); await service.process(oldId);
    expect(commit).toHaveBeenCalledTimes(1); expect(provider.capture).toHaveBeenCalledTimes(1);
  });
  it('authorization after setup observed awaiting input still retains the original attempt', async () => {
    Object.assign(records.get(oldId)!, { state: 'AWAITING_INPUT', failureCode: null, expiresAt: new Date(0) });
    const { record } = enableProcessor('requires_capture');
    const read = provider.retrieve.getMockImplementation()!;
    provider.retrieve.mockImplementation(async key => { record.state = 'AUTHORIZED'; return read(key); });
    await service.setup('customer', newKey, request);
    expect(record.state).toBe('PAID'); expect(db.paymentAttempt.create).not.toHaveBeenCalled();
    expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
  });
  it('expired setup with unknown provider readback preserves identity and blocks destructive operations', async () => {
    Object.assign(records.get(oldId)!, { state: 'AWAITING_INPUT', failureCode: null, expiresAt: new Date(0) });
    const { record, work } = enableProcessor('requires_capture');
    provider.retrieve.mockRejectedValue(new Error('Unknown provider outcome'));
    await expect(service.setup('customer', newKey, request)).rejects.toThrow('Unknown provider outcome');
    expect(record.activeCartId).toBe('cart'); expect(record.cancelRequested).toBe(false);
    expect(work.state).toBe('READY'); expect(work.retryCount).toBe(1); expect(records.size).toBe(1);
    expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled(); expect(provider.refund).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });
  it('expired unsubmitted setup cancels only after readback and a later setup releases terminal history', async () => {
    Object.assign(records.get(oldId)!, { state: 'AWAITING_INPUT', failureCode: null, expiresAt: new Date(0) });
    const { record } = enableProcessor('requires_payment_method');
    const response = await service.setup('customer', newKey, request);
    expect(response).toMatchObject({ attemptId: oldId, state: 'CANCELED', clientSecret: null });
    expect(provider.cancel).toHaveBeenCalledTimes(1); expect(db.paymentAttempt.create).not.toHaveBeenCalled();
    expect(provider.retrieve.mock.invocationCallOrder[0]).toBeLessThan(provider.cancel.mock.invocationCallOrder[0]!);
    expect(provider.capture).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
    // Next request uses the existing terminal-release path; prepare stays intercepted.
    vi.spyOn(service, 'process').mockResolvedValue(null);
    await service.setup('customer', nextId, request);
    expect(record.activeCartId).toBeNull(); expect(db.paymentAttempt.create).toHaveBeenCalledTimes(1);
  });
  it('abandoned card entry whose READY work is scheduled in the future is still released for a changed checkout', async () => {
    // Real-stack acceptance (2026-10-15): the durable worker reschedules an abandoned AWAITING_INPUT attempt 10 s ahead on
    // every pass; the release path re-armed only DONE work, so its claim was a no-op and setup returned PAYMENT_RECOVERY_PENDING.
    Object.assign(records.get(oldId)!, { state: 'AWAITING_INPUT', failureCode: null });
    const { work } = enableProcessor('requires_payment_method');
    work.nextRunAt = new Date(Date.now() + 10_000);
    const response = await service.setup('customer', newKey, { ...request, deliveryMethod: 'EXPRESS' });
    expect(response.attemptId).toBe(nextId);
    expect(records.get(oldId)).toMatchObject({ state: 'CANCELED', activeCartId: null });
    expect(provider.cancel).toHaveBeenCalledTimes(1); expect(provider.create).toHaveBeenCalledTimes(1); expect(provider.capture).not.toHaveBeenCalled();
  });
  it('changed checkout details reconcile expired card entry before creating current checkout', async () => {
    Object.assign(records.get(oldId)!, { state: 'AWAITING_INPUT', failureCode: null, expiresAt: new Date(0) });
    enableProcessor('requires_payment_method');
    const response = await service.setup('customer', newKey, { ...request, deliveryMethod: 'EXPRESS' });
    expect(response).toMatchObject({ attemptId: nextId, state: 'AWAITING_INPUT', total: '29.98' });
    expect(records.get(oldId)).toMatchObject({ activeCartId: null, state: 'CANCELED', providerIntentId: 'pi_old' });
    expect(provider.cancel).toHaveBeenCalledTimes(1); expect(provider.create).toHaveBeenCalledTimes(1);
    expect(provider.capture).not.toHaveBeenCalled();
  });
  it('reclaims only an expired exact lease through the production claim and fencing path', async () => {
    const { work } = enableProcessor('requires_payment_method');
    work.state = 'LEASED'; work.leaseToken = 'stale'; work.leaseUntil = new Date(0);
    const response = await service.setup('customer', newKey, request);
    expect(response.attemptId).toBe(nextId); expect(work).toMatchObject({ state: 'DONE', leaseToken: null });
    expect(db.paymentWork.updateMany.mock.calls.some(([args]) => args.where.attemptId === oldId && args.where.OR)).toBe(true);
    expect(provider.cancel).toHaveBeenCalledTimes(1); expect(provider.capture).not.toHaveBeenCalled();
  });
  it('does not steal an active lease or initialize another payment', async () => {
    const { work } = enableProcessor('requires_payment_method');
    work.state = 'LEASED'; work.leaseToken = 'owned'; work.leaseUntil = new Date(Date.now() + 60000);
    await expect(service.setup('customer', newKey, request)).rejects.toMatchObject({ recovery: { attemptId: oldId, lease: 'active' } });
    expect(work.leaseToken).toBe('owned'); expect(provider.retrieve).not.toHaveBeenCalled();
    expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
  });
  it('reports orphaned work instead of inventing a claim or clearing payment state', async () => {
    enableProcessor('requires_payment_method');
    db.$queryRaw.mockImplementation(async (sql: Prisma.Sql) => sql.sql.includes('"payment_work"') ? [] :
      sql.sql.includes('"payment_attempts"') ? [{ id: oldId }] : [{ id: 'cart' }]);
    await expect(service.setup('customer', newKey, request)).rejects.toMatchObject({ recovery: { attemptId: oldId, workState: null } });
    expect(db.paymentAttempt.update).not.toHaveBeenCalled(); expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
  });
  it.each(['requires_capture', 'processing'] as const)('protects stale local decline when provider is %s', async status => {
    enableProcessor(status);
    await expect(service.setup('customer', newKey, request)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(records.get(oldId)?.activeCartId).toBe('cart'); expect(provider.retrieve).toHaveBeenCalledTimes(1);
    expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
  });
  it('unknown blocker readback preserves the original identity and all retry accounting', async () => {
    const { work } = enableProcessor('requires_payment_method'); work.retryCount = 4;
    provider.retrieve.mockRejectedValue(new Error('Unknown readback'));
    await expect(service.setup('customer', newKey, request)).rejects.toThrow('Unknown readback');
    expect(records.size).toBe(1); expect(work.retryCount).toBe(4);
    expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
  });
  it('an unknown cancellation response retains recovery ownership and forbids replacement', async () => {
    const { record, work } = enableProcessor('requires_payment_method');
    provider.cancel.mockRejectedValue(new Error('Unknown cancellation outcome'));
    await expect(service.setup('customer', newKey, request)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(record).toMatchObject({ state: 'CANCEL_PENDING', activeCartId: 'cart', providerIntentId: 'pi_old' });
    expect(work).toMatchObject({ state: 'READY', retryCount: 1, leaseToken: null });
    expect(provider.cancel).toHaveBeenCalledTimes(1); expect(records.size).toBe(1);
    expect(provider.create).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
  });
  it('a newer authorized database transition defeats setup release based on older provider card-entry truth', async () => {
    const { record } = enableProcessor('requires_payment_method');
    const read = provider.retrieve.getMockImplementation()!; let reads = 0;
    provider.retrieve.mockImplementation(async id => {
      const value = await read(id);
      if (++reads === 2) record.state = 'AUTHORIZED';
      return value;
    });
    await expect(service.setup('customer', newKey, request)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(record.state).toBe('AUTHORIZED'); expect(record.activeCartId).toBe('cart');
    expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
  });
  it('canceled history does not block a new key and repeated setup creates one Intent', async () => {
    enableProcessor('requires_payment_method'); Object.assign(records.get(oldId)!, { state: 'CANCELED', providerStatus: 'canceled' });
    const first = await service.setup('customer', newKey, request);
    const replay = await service.setup('customer', newKey, request);
    expect(first.attemptId).toBe(nextId); expect(replay.attemptId).toBe(nextId);
    expect(db.paymentAttempt.create).toHaveBeenCalledTimes(1); expect(provider.create).toHaveBeenCalledTimes(1);
    expect(provider.capture).not.toHaveBeenCalled(); expect(provider.cancel).not.toHaveBeenCalled();
  });
  it('new PaymentWork is due on the application clock so the inline setup claim cannot miss it', async () => {
    // Real PostgreSQL 17 acceptance (2026-10-15): the column default ran up to ~1 ms ahead of Date.now(), so the claim
    // (nextRunAt <= now) skipped the fresh work and setup returned an attempt stuck in PREPARING.
    enableProcessor('requires_payment_method'); Object.assign(records.get(oldId)!, { state: 'CANCELED', providerStatus: 'canceled' });
    const before = Date.now();
    await service.setup('customer', newKey, request);
    const work = db.paymentAttempt.create.mock.calls[0]?.[0].data.work.create;
    expect(work.nextRunAt).toBeInstanceOf(Date);
    expect(work.nextRunAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(work.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
  it('a cancellation request alone cannot release Cart ownership before provider cancellation is confirmed', async () => {
    enableProcessor('requires_capture');
    Object.assign(records.get(oldId)!, { state: 'CANCEL_PENDING', cancelRequested: true });
    await expect(service.setup('customer', newKey, request)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(records.get(oldId)?.activeCartId).toBe('cart'); expect(db.paymentAttempt.create).not.toHaveBeenCalled();
    expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
  });
  it('confirmed cancellation-pending work finishes under its own fence before new setup', async () => {
    enableProcessor('requires_payment_method');
    Object.assign(records.get(oldId)!, { state: 'CANCEL_PENDING', cancelRequested: true });
    const response = await service.setup('customer', newKey, request);
    expect(response).toMatchObject({ attemptId: nextId, state: 'AWAITING_INPUT' });
    expect(records.get(oldId)).toMatchObject({ state: 'CANCELED', activeCartId: null });
    expect(provider.cancel).toHaveBeenCalledTimes(1); expect(provider.create).toHaveBeenCalledTimes(1);
  });
  it('creates a different attempt/intent for a fresh key even when Cart and Shipping are unchanged', async () => {
    enableProcessor('requires_payment_method');
    const response = await service.setup('customer', newKey, request);
    expect(response.attemptId).toBe(nextId);
    expect(response.clientSecret).toBe(`pi_${nextId}_secret_fixture`);
    expect(response.replayed).toBe(false);
    expect(records.get(oldId)).toMatchObject({ state: 'CANCELED', cancelRequested: true, activeCartId: null, providerIntentId: 'pi_old' });
    expect(db.paymentAttempt.create).toHaveBeenCalledTimes(1);
    expect(provider.cancel).toHaveBeenCalledTimes(1); expect(provider.create).toHaveBeenCalledTimes(1);
    expect(provider.capture).not.toHaveBeenCalled();
  });
  it('replays a declined key as history without returning its secret or creating another intent', async () => {
    const response = await service.setup('customer', oldId, request);
    expect(response).toMatchObject({ attemptId: oldId, state: 'DECLINED', clientSecret: null, replayed: true });
    expect(db.paymentAttempt.create).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled();
  });
  it('still reuses compatible awaiting-input setup without making duplicate attempts', async () => {
    Object.assign(records.get(oldId)!, { state: 'AWAITING_INPUT', failureCode: null });
    const response = await service.setup('customer', newKey, request);
    expect(response).toMatchObject({ attemptId: oldId, replayed: true });
    expect(db.paymentAttempt.create).not.toHaveBeenCalled();
  });
  it('reuses an expired AUTHORIZED identity rather than replacing or canceling it', async () => {
    Object.assign(records.get(oldId)!, { state: 'AUTHORIZED', failureCode: null, expiresAt: new Date(0), providerStatus: 'requires_capture' });
    const response = await service.setup('customer', newKey, request);
    expect(response).toMatchObject({ attemptId: oldId, state: 'AUTHORIZED', replayed: true, clientSecret: null });
    expect(db.paymentAttempt.create).not.toHaveBeenCalled(); expect(db.paymentAttempt.update).not.toHaveBeenCalled();
    expect(records.get(oldId)?.providerIntentId).toBe('pi_old'); expect(provider.cancel).not.toHaveBeenCalled();
  });
  it.each(['AUTHORIZED', 'PROCESSING', 'CAPTURE_PENDING', 'INCIDENT'] as const)('does not expire/supersede financially protected %s', async state => {
    Object.assign(records.get(oldId)!, { state, failureCode: null, expiresAt: new Date(0) });
    await expect(service.setup('customer', newKey, { ...request, deliveryMethod: 'EXPRESS' })).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(db.paymentAttempt.update).not.toHaveBeenCalled(); expect(db.paymentAttempt.create).not.toHaveBeenCalled();
    expect(provider.cancel).not.toHaveBeenCalled(); expect(service.process).not.toHaveBeenCalled();
  });
  it('revalidates an authorization transition after the candidate lock is acquired', async () => {
    const old = records.get(oldId)!;
    db.$queryRaw.mockImplementationOnce(async () => {
      Object.assign(old, { state: 'AUTHORIZED', failureCode: null, expiresAt: new Date(0) });
      return [{ id: oldId }];
    });
    await expect(service.setup('customer', newKey, { ...request, deliveryMethod: 'EXPRESS' })).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(old.state).toBe('AUTHORIZED'); expect(old.activeCartId).toBe('cart');
    expect(db.paymentAttempt.update).not.toHaveBeenCalled(); expect(db.paymentAttempt.create).not.toHaveBeenCalled();
  });
  it.each(['replacement', 'appeared'] as const)('aborts a candidate that %s without locking a different Attempt under Cart', async change => {
    if (change === 'appeared') db.$queryRaw.mockResolvedValueOnce([]);
    else db.paymentAttempt.findFirst.mockResolvedValueOnce({ ...records.get(oldId)!, id: nextId });
    await expect(service.setup('customer', newKey, request)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(db.paymentAttempt.update).not.toHaveBeenCalled(); expect(db.paymentAttempt.create).not.toHaveBeenCalled();
    const queries = db.$queryRaw.mock.calls.map(call => (call[0] as Prisma.Sql).sql);
    expect(queries.at(-1)).toContain('"carts"');
    expect(queries.filter(sql => sql.includes('FOR UPDATE OF pa'))).toHaveLength(1);
    expect(db.$transaction).toHaveBeenCalledTimes(1); // No new arbitrary candidate-change retry.
  });
  it.each(['userId', 'cartId'] as const)('rejects a foreign active %s binding before mutation', async field => {
    Object.assign(records.get(oldId)!, { [field]: 'foreign' });
    await expect(service.setup('customer', newKey, request)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(db.paymentAttempt.update).not.toHaveBeenCalled(); expect(db.paymentAttempt.create).not.toHaveBeenCalled();
  });
  it.each(['LEASED', 'INCIDENT', null] as const)('cannot supersede an attempt with unavailable/unresolved work %s', async workState => {
    db.$queryRaw.mockImplementation(async (sql: Prisma.Sql) => {
      if (sql.sql.includes('"payment_attempts"')) return [{ id: oldId }];
      if (sql.sql.includes('"payment_work"')) return workState ? [{ state: workState }] : [];
      return [{ id: 'cart' }];
    });
    await expect(service.setup('customer', newKey, request)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(db.paymentAttempt.update).not.toHaveBeenCalled(); expect(db.paymentAttempt.create).not.toHaveBeenCalled();
  });
  it('concurrent compatible setup requests reuse one attempt without new setup effects', async () => {
    Object.assign(records.get(oldId)!, { state: 'AWAITING_INPUT', failureCode: null });
    const responses = await Promise.all([service.setup('customer', newKey, request), service.setup('customer', nextId, request)]);
    expect(responses.map(response => response.attemptId)).toEqual([oldId, oldId]);
    expect(records.size).toBe(1); expect(db.paymentAttempt.create).not.toHaveBeenCalled();
    expect(db.paymentAttempt.update).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
  });
  it('does not wake an aborted supersession when the bounded retry discovers authorization', async () => {
    const before = { ...records.get(oldId)! };
    db.$transaction.mockImplementationOnce(async operation => {
      try { await operation(db); } catch (error) {
        expect(error).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
      }
      // Model confirmed rollback, then a separate worker's authorization transition.
      records = new Map([[oldId, { ...before, state: 'AUTHORIZED', failureCode: null, providerStatus: 'requires_capture' }]]);
      throw new Prisma.PrismaClientKnownRequestError('Confirmed serialization abort', { code: 'P2034', clientVersion: 'test' });
    });
    const wake = vi.spyOn(service, 'wake').mockResolvedValue(undefined);
    const response = await service.setup('customer', newKey, request);
    expect(response).toMatchObject({ attemptId: oldId, state: 'AUTHORIZED', replayed: true });
    expect(wake).not.toHaveBeenCalled(); expect(service.process).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledTimes(2); expect(records.size).toBe(1);
    expect(records.get(oldId)?.cancelRequested).toBe(false);
  });
  it.each(['CAPTURE_PENDING', 'PAID'] as const)('never returns card-entry credentials for %s', async state => {
    Object.assign(records.get(oldId)!, { state, orderId: 'order', providerStatus: state === 'PAID' ? 'succeeded' : 'requires_capture' });
    const response = await service.setup('customer', oldId, request);
    expect(response.clientSecret).toBeNull();
    expect(db.paymentAttempt.create).not.toHaveBeenCalled();
  });
});
