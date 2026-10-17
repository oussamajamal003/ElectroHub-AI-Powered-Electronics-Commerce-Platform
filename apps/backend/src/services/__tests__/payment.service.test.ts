import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient, type PaymentWork } from '@prisma/client';
import { PaymentService } from '../payment.service.js';
import { AppError } from '../../middleware/errorHandler.js';
import { WORK_LEASE_MS, customerPaymentStatus, operationKey, type Attempt, type PaymentProvider, type ProviderIntent } from '../payment.domain.js';
import { isSerializationConflict } from '../transaction-conflict.js';
import { cartRevision, requestHash } from '../checkout.domain.js';
import { logger, loggingHealth } from '../../utils/logger.js';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { InventoryService } from '../inventory.service.js';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const captureTools = createRequire(resolve('package.json'))('./scripts/capture-fault.cjs') as {
  deterministicProvider(initial: ProviderIntent): { capture(attempt: Attempt): Promise<ProviderIntent>; retrieve(id: string): Promise<ProviderIntent>;
    snapshot(): { effects: number; keys: string[]; state: ProviderIntent }; trace: string[] };
  captureFault(options: { mode: string; provider: object; runtime: 'test'; afterCapture?: () => Promise<void> }): {
    capture(attempt: Attempt): Promise<ProviderIntent>; assertFired(): void };
};

const commit = vi.hoisted(() => vi.fn());
vi.mock('../order.service.js', () => ({ OrderService: class { commitAuthorized = commit; getConfirmation = vi.fn().mockResolvedValue(null); } }));
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../stripe.provider.js', () => ({ stripeProvider: {} }));
const id = '11111111-1111-4111-8111-111111111111';
let attempt: Attempt;
let work: PaymentWork;
let intent: ProviderIntent;
let service: PaymentService;
const provider = { account: vi.fn(), create: vi.fn(), retrieve: vi.fn(), capture: vi.fn(), cancel: vi.fn(),
  refund: vi.fn(), retrieveRefund: vi.fn() } satisfies PaymentProvider;
const db = { paymentAttempt: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() }, paymentWork: { updateMany: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  cart: { findUnique: vi.fn() }, product: { findMany: vi.fn() },
  cartItem: { upsert: vi.fn() },
  payment: { update: vi.fn(), findUnique: vi.fn() }, user: { findUnique: vi.fn() },
  order: { update: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn() };
describe('Setup diagnostics cannot replace the financial outcome', () => {
  it('preserves validation failure when the performance logger throws', async () => {
    const log = vi.spyOn(logger, 'info').mockImplementation(() => { throw new Error('logging transport unavailable'); });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => { throw new Error('fallback sink unavailable'); });
    const failuresBefore = loggingHealth().failures;
    try {
      await expect(service.setup('customer', 'not-a-payment-key', {})).rejects.toMatchObject({ name: 'ZodError' });
      expect(provider.create).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalled();
      expect(stderr.mock.calls.join(' ')).not.toContain('logging transport unavailable');
      expect(loggingHealth()).toMatchObject({ status: 'warning', failures: failuresBefore + 1, lastCode: 'LOGGER_SYNC_FAILURE' });
    } finally { log.mockRestore(); stderr.mockRestore(); }
  });
});
beforeEach(() => {
  vi.resetAllMocks();
  const now = new Date();
  attempt = { id, userId: 'customer', cartId: 'cart', cartIdentity: 'cart', activeCartId: 'cart', idempotencyKey: id,
    requestHash: 'a'.repeat(64), revision: 'b'.repeat(64), request: {}, subtotal: new Prisma.Decimal('19.99'),
    shippingCost: new Prisma.Decimal(0), total: new Prisma.Decimal('19.99'), amountCents: 1999, currency: 'USD', stripeAccountId: 'acct_test',
    providerIntentId: 'pi_test', providerStatus: 'requires_payment_method', state: 'AWAITING_INPUT', cancelRequested: false,
    failureCode: null, authorizationExpiresAt: null, expiresAt: new Date(Date.now() + 60_000), orderId: null, refundId: null,
    refundAmountCents: null, compensatedAt: null, recoveryRemainder: null, submittedAt: null, confirmationStartedAt: null, restoredAt: null, dismissedAt: null, notificationReadState: null, createdAt: now, updatedAt: now, items: [] };
  work = { id: 'work', attemptId: id, state: 'READY', nextRunAt: new Date(0), retryCount: 0, leaseToken: null,
    leaseUntil: null, lastError: null, createdAt: now, updatedAt: now };
  intent = { id: 'pi_test', account: 'acct_test', livemode: false, amount: 1999, currency: 'usd', captureMethod: 'manual',
    status: 'requires_payment_method', capturable: 0, received: 0, methodType: null, clientSecret: null, attemptId: id,
    declined: false, card: null, captureBefore: null };
  db.paymentAttempt.findUnique.mockImplementation(async ({ include }: { include?: { work?: boolean } }) => ({ ...attempt, ...(include?.work ? { work: { ...work } } : {}) }));
  db.paymentAttempt.update.mockImplementation(async ({ data }: { data: Partial<Attempt> }) => { Object.assign(attempt, data); return { ...attempt }; });
  db.paymentAttempt.findFirst.mockImplementation(async ({ include }: { include?: { work?: boolean } }) => ({ ...attempt, ...(include?.work ? { work: { ...work } } : {}) }));
  db.paymentWork.findUnique.mockImplementation(async () => ({ ...work }));
  db.paymentWork.updateMany.mockImplementation(async ({ data }: { data: Partial<PaymentWork> }) => {
    if (work.state === 'LEASED' && work.leaseUntil && work.leaseUntil.getTime() >= Date.now()) return { count: 0 };
    Object.assign(work, data); return { count: 1 };
  });
  db.paymentWork.update.mockImplementation(async ({ data }: { data: Partial<PaymentWork> }) => { Object.assign(work, data); return { ...work }; });
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  db.cart.findUnique.mockResolvedValue({ id: 'cart', items: [] });
  db.product.findMany.mockResolvedValue([]);
  provider.retrieve.mockImplementation(async () => ({ ...intent }));
  provider.create.mockImplementation(async () => ({ ...intent }));
  provider.capture.mockImplementation(async () => { intent = { ...intent, status: 'succeeded', received: 1999, capturable: 0 }; return intent; });
  provider.cancel.mockImplementation(async () => { intent = { ...intent, status: 'canceled' }; return intent; });
  provider.refund.mockResolvedValue({ id: 're_test', intentId: 'pi_test', amount: 1999, status: 'pending' });
  provider.retrieveRefund.mockResolvedValue({ id: 're_test', intentId: 'pi_test', amount: 1999, status: 'pending' });
  commit.mockImplementation(async () => { attempt.orderId = 'order'; attempt.state = 'CAPTURE_PENDING'; });
  service = new PaymentService(db as unknown as PrismaClient, provider);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Frozen processing recovery after runner restart', () => {
  it('a fresh processor records a verified external cancellation after reclaiming an expired lease', async () => {
    Object.assign(attempt, { submittedAt: new Date(), cancelRequested: true });
    Object.assign(work, { state: 'LEASED', leaseToken: randomUUID(), leaseUntil: new Date(Date.now() - 1000) });
    Object.assign(intent, { status: 'canceled' });
    await new PaymentService(db as unknown as PrismaClient, provider).process(id);
    expect(attempt).toMatchObject({ state: 'CANCELED', providerStatus: 'canceled', orderId: null, activeCartId: null });
    expect(work.state).toBe('DONE'); expect(provider.retrieve).toHaveBeenCalledWith('pi_test');
    for (const operation of [provider.create, provider.capture, provider.cancel, provider.refund, commit]) expect(operation).not.toHaveBeenCalled();
  });
  it('does not let an unavailable first job starve later due jobs', async () => {
    db.paymentWork.findMany.mockResolvedValue([{ attemptId: id }, { attemptId: 'second' }]);
    const process = vi.spyOn(service, 'process').mockRejectedValueOnce(new Error('database transaction unavailable')).mockResolvedValueOnce(null);
    await expect(service.runBatch()).rejects.toBeInstanceOf(AggregateError);
    expect(process.mock.calls.map(([attemptId]) => attemptId)).toEqual([id, 'second']);
    expect(provider.capture).not.toHaveBeenCalled(); expect(provider.cancel).not.toHaveBeenCalled();
  });
  it('a fresh processor reclaims an expired lease and persists a verified decline without capture or cancellation', async () => {
    Object.assign(attempt, { state: 'PROCESSING', submittedAt: new Date() });
    Object.assign(work, { state: 'LEASED', leaseToken: 'dead-runner', leaseUntil: new Date(Date.now() - 1), lastError: 'PAYMENT_PROVIDER_UNKNOWN' });
    Object.assign(intent, { status: 'requires_payment_method', declined: true });
    const restarted = new PaymentService(db as unknown as PrismaClient, provider);
    await restarted.process(id);
    expect(attempt.state).toBe('DECLINED');
    expect(work).toMatchObject({ state: 'DONE', leaseToken: null, leaseUntil: null, lastError: null });
    expect(provider.retrieve).toHaveBeenCalledWith('pi_test');
    expect(provider.create).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
    expect(provider.cancel).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
    await restarted.process(id);
    expect(provider.capture).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });
  it('unknown provider readback after an expired lease remains unresolved and scheduled, never forced to failure', async () => {
    Object.assign(attempt, { state: 'PROCESSING', submittedAt: new Date() });
    Object.assign(work, { state: 'LEASED', leaseToken: 'dead-runner', leaseUntil: new Date(Date.now() - 1) });
    provider.retrieve.mockRejectedValue(new Error('Provider unavailable'));
    await new PaymentService(db as unknown as PrismaClient, provider).process(id);
    expect(attempt.state).toBe('PROCESSING');
    expect(work).toMatchObject({ state: 'READY', leaseToken: null, retryCount: 1, lastError: 'PAYMENT_PROVIDER_UNKNOWN' });
    expect(work.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    expect(provider.create).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
    expect(provider.cancel).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });
});

describe('Stale pre-decline snapshot, canceled intents and poll-driven recovery', () => {
  const submittedAwaiting = () => Object.assign(attempt, { submittedAt: new Date(), state: 'AWAITING_INPUT' });
  it('a pre-decline AWAITING_INPUT snapshot is rechecked within seconds and the decline is persisted without any confirmation', async () => {
    submittedAwaiting();
    await service.process(id); // provider has not recorded the decline yet
    expect(attempt.state).toBe('AWAITING_INPUT');
    expect(work.state).toBe('READY');
    expect(work.nextRunAt.getTime() - Date.now()).toBeLessThanOrEqual(2_100); // bounded fast recheck, not the routine 10 s
    Object.assign(intent, { declined: true }); work.nextRunAt = new Date(0); // Stripe now records the decline
    await service.process(id);
    expect(attempt).toMatchObject({ state: 'DECLINED', failureCode: 'PAYMENT_DECLINED' });
    for (const operation of [provider.create, provider.capture, provider.cancel, provider.refund, commit]) expect(operation).not.toHaveBeenCalled();
  });
  it('a restarted processor rediscovers the missed stale snapshot through due-work discovery and persists the decline', async () => {
    submittedAwaiting(); Object.assign(work, { state: 'READY', nextRunAt: new Date(Date.now() - 1) });
    Object.assign(intent, { declined: true });
    db.paymentWork.findMany.mockResolvedValue([{ attemptId: id }]);
    await new PaymentService(db as unknown as PrismaClient, provider).runBatch();
    expect(attempt.state).toBe('DECLINED');
    expect(db.paymentWork.findMany.mock.calls[0]![0].where.OR).toEqual(expect.arrayContaining([expect.objectContaining({ state: 'READY' })]));
  });
  it('a persisted decline is never overwritten by a stale worker whose lease expired', async () => {
    Object.assign(attempt, { submittedAt: new Date(), state: 'DECLINED', failureCode: 'PAYMENT_DECLINED' });
    Object.assign(work, { state: 'LEASED', leaseToken: 'stale', leaseUntil: new Date(Date.now() - 1) });
    const token = 'stale';
    await expect((service as unknown as { patch(i: string, t: string, d: object): Promise<unknown> }).patch(id, token, { state: 'AWAITING_INPUT' }))
      .rejects.toMatchObject({ code: 'PAYMENT_CLAIM_LOST' });
    expect(attempt.state).toBe('DECLINED');
  });
  it('persists a provider-canceled intent before refusing Continue to payment, creating no intent, charge or order', async () => {
    Object.assign(attempt, { submittedAt: new Date(), state: 'DECLINED', failureCode: 'PAYMENT_DECLINED' });
    Object.assign(intent, { status: 'canceled' });
    await expect(service.resume('customer', id)).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', statusCode: 409 });
    expect(attempt).toMatchObject({ state: 'CANCELED', providerStatus: 'canceled', orderId: null });
    for (const operation of [provider.create, provider.capture, provider.refund, commit]) expect(operation).not.toHaveBeenCalled();
  });
  it('purchases() drives only due, lease-claimed reconciliation for unresolved submitted attempts and never wakes or resets work', async () => {
    submittedAwaiting();
    const list = { ...db, paymentAttempt: { ...db.paymentAttempt, findMany: vi.fn().mockResolvedValue([{ ...attempt, request: {}, items: [], work: { ...work } }]) } };
    const polled = new PaymentService(list as unknown as PrismaClient, provider);
    const process = vi.spyOn(polled, 'process').mockResolvedValue(null);
    const wake = vi.spyOn(polled, 'wake');
    await polled.purchases('customer').catch(() => undefined);
    expect(process).toHaveBeenCalledExactlyOnceWith(id);
    expect(wake).not.toHaveBeenCalled();
  });
  it('purchases() does not reconcile terminal or committed purchases', async () => {
    Object.assign(attempt, { submittedAt: new Date(), state: 'DECLINED' });
    const list = { ...db, paymentAttempt: { ...db.paymentAttempt, findMany: vi.fn().mockResolvedValue([{ ...attempt, request: {}, items: [], work: { ...work } }]) } };
    const polled = new PaymentService(list as unknown as PrismaClient, provider);
    const process = vi.spyOn(polled, 'process').mockResolvedValue(null);
    await polled.purchases('customer').catch(() => undefined);
    expect(process).not.toHaveBeenCalled();
  });
});

function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
/** Row-lock scheduling double: tests actual processor boundaries, not PostgreSQL MVCC. */
function fencedSchedule(pauseBeforeWorkLock: boolean) {
  const atBoundary = signal(), resume = signal(), claimWaits = signal(), claimed = signal(), atReplacementWrite = signal(), finishReplacement = signal();
  const trace: string[] = [], writes: number[] = [];
  let workLocked = false, transactionIndex = 0, claimIndex = 0;
  let attemptTail = Promise.resolve(), releaseWork = signal();
  db.paymentWork.updateMany.mockImplementation(async ({ data }: { data: Partial<PaymentWork> }) => {
    const claimant = ++claimIndex;
    if (workLocked) { trace.push('replacement waits on Work'); claimWaits.resolve(); await releaseWork.promise; }
    if (!(work.state === 'READY' && work.nextRunAt.getTime() <= Date.now() ||
      work.state === 'LEASED' && work.leaseUntil && work.leaseUntil.getTime() < Date.now())) return { count: 0 };
    Object.assign(work, data);
    if (claimant === 2) { trace.push('replacement installs token'); claimed.resolve(); }
    return { count: 1 };
  });
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => {
    const owner = ++transactionIndex, previous = attemptTail, unlockAttempt = signal();
    attemptTail = unlockAttempt.promise;
    let ownsWork = false;
    const tx = { ...db, $queryRaw: vi.fn(async (sql: Prisma.Sql) => {
      if (sql.sql.includes('"payment_attempts"')) { await previous; trace.push(`${owner}:Attempt`); }
      if (sql.sql.includes('"payment_work"')) {
        if (owner === 1 && pauseBeforeWorkLock) { atBoundary.resolve(); await resume.promise; }
        workLocked = true; ownsWork = true; releaseWork = signal(); trace.push(`${owner}:Work`);
      }
      return [{ id }];
    }), paymentWork: { ...db.paymentWork, update: vi.fn(async ({ data }: { data: Partial<PaymentWork> }) => {
      if (owner === 1 && !pauseBeforeWorkLock) { atBoundary.resolve(); await resume.promise; }
      if (owner === 2 && pauseBeforeWorkLock) { atReplacementWrite.resolve(); await finishReplacement.promise; }
      writes.push(owner); Object.assign(work, data); return { ...work };
    }) } };
    try { return await fn(tx); }
    finally { if (ownsWork) { workLocked = false; releaseWork.resolve(); } unlockAttempt.resolve(); }
  });
  return { atBoundary, resume, claimWaits, claimed, atReplacementWrite, finishReplacement, trace, writes };
}

describe('Durable payment processor (mocked DB/provider; not real transaction proof)', () => {
  it('does not queue another worker for a provider-confirmed persisted decline', async () => {
    attempt.state = 'DECLINED'; attempt.failureCode = 'PAYMENT_DECLINED'; intent.declined = true;
    const process = vi.spyOn(service, 'process');
    const result = await service.reconcile(attempt.userId, id);
    expect(result).toMatchObject({ state: 'DECLINED', recoveryActive: false, committed: false });
    expect(provider.retrieve).toHaveBeenCalledTimes(1); expect(process).not.toHaveBeenCalled();
    expect(db.paymentWork.updateMany).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
    expect(provider.capture).not.toHaveBeenCalled(); expect(provider.cancel).not.toHaveBeenCalled();
  });
  it('keeps late authorization reachable rather than trusting a stale persisted decline', async () => {
    attempt.state = 'DECLINED'; intent.status = 'requires_capture'; intent.capturable = 1999; intent.methodType = 'card';
    const process = vi.spyOn(service, 'process').mockResolvedValue(intent);
    const result = await service.reconcile(attempt.userId, id);
    expect(result.recoveryActive).toBe(true); expect(process).toHaveBeenCalledWith(id);
  });
  it('fails closed when confirming a persisted decline has an unknown provider outcome', async () => {
    attempt.state = 'DECLINED'; provider.retrieve.mockRejectedValue(new Error('unknown transport'));
    const process = vi.spyOn(service, 'process');
    await expect(service.reconcile(attempt.userId, id)).rejects.toThrow('unknown transport');
    expect(process).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled(); expect(provider.cancel).not.toHaveBeenCalled();
  });
  it.each(['requires_capture', 'processing'] as const)('discards a prior expiry-only cancellation after authoritative %s readback', async status => {
    Object.assign(attempt, { state: 'CANCEL_PENDING', cancelRequested: true, failureCode: 'PAYMENT_EXPIRED', expiresAt: new Date(0) });
    Object.assign(intent, { status, capturable: status === 'requires_capture' ? 1999 : 0, methodType: 'card' });
    await service.process(id);
    expect(attempt).toMatchObject({ cancelRequested: false, failureCode: null, providerIntentId: 'pi_test',
      state: status === 'requires_capture' ? 'PAID' : 'PROCESSING' });
    expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled(); expect(provider.refund).not.toHaveBeenCalled();
    expect(provider.capture).toHaveBeenCalledTimes(status === 'requires_capture' ? 1 : 0);
    await service.process(id);
    expect(provider.capture).toHaveBeenCalledTimes(status === 'requires_capture' ? 1 : 0);
  });
  it('retains a prior expiry decision without cancellation when provider truth is unknown', async () => {
    Object.assign(attempt, { state: 'CANCEL_PENDING', cancelRequested: true, failureCode: 'PAYMENT_EXPIRED', expiresAt: new Date(0) });
    provider.retrieve.mockRejectedValue(new Error('Unknown readback'));
    await service.process(id);
    expect(attempt).toMatchObject({ providerIntentId: 'pi_test', state: 'CANCEL_PENDING', cancelRequested: true });
    expect(work).toMatchObject({ state: 'READY', retryCount: 1 });
    expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled(); expect(provider.refund).not.toHaveBeenCalled();
  });
  it('resolves captured committed work despite a prior expiry flag without cancellation or refund', async () => {
    Object.assign(attempt, { state: 'CAPTURE_PENDING', orderId: 'order', cancelRequested: true, failureCode: 'PAYMENT_EXPIRED', expiresAt: new Date(0) });
    Object.assign(intent, { status: 'succeeded', received: 1999, capturable: 0 });
    await service.process(id);
    expect(attempt).toMatchObject({ state: 'PAID', cancelRequested: false, failureCode: null, providerIntentId: 'pi_test' });
    expect(work.state).toBe('DONE'); expect(db.payment.update).toHaveBeenCalledTimes(1);
    expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.refund).not.toHaveBeenCalled();
    expect(provider.capture).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
  });
  it('reconciles an old expiry cancellation only when provider truth remains unsubmitted', async () => {
    Object.assign(attempt, { state: 'CANCEL_PENDING', cancelRequested: true, failureCode: 'PAYMENT_EXPIRED', expiresAt: new Date(0) });
    await service.process(id);
    expect(provider.cancel).toHaveBeenCalledTimes(1); expect(provider.capture).not.toHaveBeenCalled();
    expect(attempt.state).toBe('CANCELED'); expect(work.state).toBe('DONE');
  });
  it('does not apply a stale expiry flag to a newer authorized database state', async () => {
    Object.assign(attempt, { state: 'CANCEL_PENDING', cancelRequested: true, failureCode: 'PAYMENT_EXPIRED', expiresAt: new Date(0) });
    provider.retrieve.mockImplementationOnce(async () => { attempt.state = 'AUTHORIZED'; return { ...intent }; });
    await service.process(id);
    expect(attempt.state).toBe('AUTHORIZED'); expect(db.paymentAttempt.update).not.toHaveBeenCalled();
    expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
  });
  it('holds Work through completion so expiry reclamation cannot replace its token mid-transaction', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); attempt.state = 'PAID';
    const schedule = fencedSchedule(false), first = service.process(id);
    await schedule.atBoundary.promise;
    vi.setSystemTime(Date.now() + WORK_LEASE_MS + 1);
    const replacement = new PaymentService(db as unknown as PrismaClient, provider).process(id);
    // Yield at actual claim boundary: an unlocked claim installs a token instead of waiting.
    await Promise.race([schedule.claimWaits.promise, schedule.claimed.promise]);
    expect(schedule.trace).toContain('replacement waits on Work');
    expect(schedule.trace).not.toContain('replacement installs token');
    schedule.resume.resolve(); await Promise.all([first, replacement]);
    expect(schedule.writes).toEqual([1]); expect(work).toMatchObject({ state: 'DONE', leaseToken: null });
    expect(schedule.trace.slice(0, 2)).toEqual(['1:Attempt', '1:Work']);
    expect(provider.retrieve).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
  });
  it('rejects the old token when replacement claimed before the Work lock, preserving it through stale rollback/reentry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); attempt.state = 'PAID';
    const schedule = fencedSchedule(true), first = service.process(id);
    await schedule.atBoundary.promise;
    const oldToken = work.leaseToken; vi.setSystemTime(Date.now() + WORK_LEASE_MS + 1);
    const replacement = new PaymentService(db as unknown as PrismaClient, provider).process(id);
    await schedule.claimed.promise; const newToken = work.leaseToken;
    expect(newToken).not.toBe(oldToken);
    schedule.resume.resolve(); await first; await schedule.atReplacementWrite.promise;
    expect(schedule.writes).toEqual([]); expect(work.leaseToken).toBe(newToken);
    const repeated = service.process(id); // A competing claim waits for the current transaction.
    await schedule.claimWaits.promise;
    expect(schedule.writes).toEqual([]); expect(work.leaseToken).toBe(newToken);
    schedule.finishReplacement.resolve(); await Promise.all([replacement, repeated]);
    expect(schedule.writes).toEqual([2]); expect(work.state).toBe('DONE');
    expect(provider.capture).not.toHaveBeenCalled(); expect(provider.cancel).not.toHaveBeenCalled();
  });
  it('does not retry a durable completion whose commit acknowledgement is unknown', async () => {
    attempt.state = 'PAID';
    db.paymentWork.updateMany.mockImplementation(async ({ data }: { data: Partial<PaymentWork> }) => {
      if (work.state !== 'READY') return { count: 0 };
      Object.assign(work, data); return { count: 1 };
    });
    db.$transaction.mockImplementationOnce(async (fn: (tx: typeof db) => Promise<unknown>) => {
      await fn(db); // Model durable commit followed by a lost acknowledgement.
      throw new Prisma.PrismaClientKnownRequestError('Commit acknowledgement unknown', { code: 'P2028', clientVersion: 'test' });
    });
    await service.process(id); await service.process(id);
    expect(work).toMatchObject({ state: 'DONE', leaseToken: null, retryCount: 0 });
    expect(db.paymentWork.update).toHaveBeenCalledTimes(1); expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(provider.retrieve).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
  });
  it('preserves an expired AUTHORIZED attempt and commits its provider-verified authorization', async () => {
    attempt.state = 'AUTHORIZED'; attempt.expiresAt = new Date(Date.now() - 1);
    Object.assign(intent, { status: 'requires_capture', capturable: 1999, methodType: 'card' });
    await service.process(id);
    expect(provider.cancel).not.toHaveBeenCalled();
    expect(attempt).toMatchObject({ state: 'PAID', failureCode: null, orderId: 'order' });
    expect(intent.status).toBe('succeeded');
    expect(commit).toHaveBeenCalledTimes(1); expect(provider.capture).toHaveBeenCalledTimes(1);
    expect(provider.create).not.toHaveBeenCalled(); expect(provider.refund).not.toHaveBeenCalled();
    expect(work.state).toBe('DONE');
  });
  it('revalidates protected state and expiry decision atomically after a provider-read overlap', async () => {
    attempt.expiresAt = new Date(0);
    provider.retrieve.mockImplementationOnce(async () => {
      // The initial database snapshot preceded this authorization transition.
      attempt.state = 'AUTHORIZED'; return { ...intent };
    });
    await service.process(id);
    expect(attempt.state).toBe('AUTHORIZED'); expect(attempt.providerIntentId).toBe('pi_test');
    expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled(); expect(work.state).toBe('READY');
    expect(db.paymentAttempt.update).not.toHaveBeenCalled();
  });
  it.each(['processing', 'requires_capture'] as const)('does not cancel an expired card-entry snapshot after authoritative %s readback', async status => {
    attempt.expiresAt = new Date(0); intent.status = status;
    if (status === 'requires_capture') { intent.capturable = 1999; intent.methodType = 'card'; }
    await service.process(id);
    expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
    expect(attempt.providerIntentId).toBe('pi_test');
    expect(attempt.state).toBe(status === 'processing' ? 'PROCESSING' : 'PAID');
  });
  it('still expires verified unsubmitted card entry under its current lease', async () => {
    attempt.expiresAt = new Date(0);
    await service.process(id);
    expect(provider.cancel).toHaveBeenCalledTimes(1); expect(provider.capture).not.toHaveBeenCalled();
    expect(attempt.state).toBe('CANCELED'); expect(work.state).toBe('DONE');
  });
  it('re-reads a freshly submitted attempt quickly when Stripe still shows no payment error, so a decline that landed after the read is not delayed', async () => {
    Object.assign(attempt, { submittedAt: new Date(), expiresAt: new Date(Date.now() + 10 * 60_000) });
    await service.process(id);
    expect(attempt.state).toBe('AWAITING_INPUT'); expect(work.nextRunAt.getTime() - Date.now()).toBeLessThanOrEqual(2_500);
  });
  it('keeps the routine cadence for an unsubmitted card-entry attempt', async () => {
    await service.process(id);
    expect(work.nextRunAt.getTime() - Date.now()).toBeGreaterThan(8_000);
    expect(work.nextRunAt.getTime() - Date.now()).toBeLessThanOrEqual(10_500);
  });
  // Regression (DEV 2026-10-17, MacBook aab01e3a / Buds2 bf43a065): a saved checkout nobody is confirming was re-leased every ~10 s,
  // keeping its work row LEASED a large share of the time and blocking Continue to payment.
  it('backs off an idle saved checkout (submitted, no confirmation announced, past the recheck window) to 60 s', async () => {
    Object.assign(attempt, { submittedAt: new Date(Date.now() - 4 * 60_000), expiresAt: new Date(Date.now() + 10 * 60_000) });
    await service.process(id);
    expect(attempt.state).toBe('AWAITING_INPUT'); expect(work.nextRunAt.getTime() - Date.now()).toBeGreaterThan(55_000);
    expect(provider.cancel).not.toHaveBeenCalled();
  });
  it('keeps the routine cadence once a confirmation has been announced', async () => {
    Object.assign(attempt, { submittedAt: new Date(Date.now() - 4 * 60_000), confirmationStartedAt: new Date(Date.now() - 30_000),
      expiresAt: new Date(Date.now() + 10 * 60_000) });
    await service.process(id);
    expect(work.nextRunAt.getTime() - Date.now()).toBeLessThanOrEqual(10_500);
  });
  // Task 03.6 final lifecycle: Place Order -> Processing -> Payment failed / Paid. A submitted purchase whose card confirmation never reached
  // Stripe (MacBook aab01e3a, Buds2 bf43a065, MacBook Starlight aac568f8, iPad 5c9261c5 / 327705a5) is recorded as verified evidence only: it
  // stays Processing and becomes eligible for the server-verified Cancel purchase. Never Payment failed without provider evidence.
  describe('verified never-confirmed submission (confirmation signal enabled)', () => {
    const minutes = (value: number) => new Date(Date.now() - value * 60_000);
    beforeEach(() => { process.env.PAYMENT_CONFIRMATION_SIGNAL = 'true'; });
    afterEach(() => { delete process.env.PAYMENT_CONFIRMATION_SIGNAL; });
    const submittedLongAgo = () => Object.assign(attempt, { submittedAt: minutes(11), expiresAt: new Date(Date.now() + 10 * 60_000) });
    const verified = () => Object.assign(attempt, { failureCode: 'PAYMENT_NOT_CONFIRMED', submittedAt: minutes(30), expiresAt: new Date(Date.now() + 10 * 60_000) });
    it('records NOT_CONFIRMED evidence but stays Processing: nothing cancelled, created, failed or declined', async () => {
      submittedLongAgo();
      await service.process(id);
      expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
      expect(attempt.state).toBe('AWAITING_INPUT'); expect(attempt.failureCode).toBe('PAYMENT_NOT_CONFIRMED');
      expect(customerPaymentStatus(attempt)).toBe('PROCESSING');
    });
    it('stays exactly as it is on later passes while Stripe still records nothing', async () => {
      verified(); await service.process(id); work.nextRunAt = new Date(0); work.state = 'READY'; await service.process(id);
      expect(attempt.state).toBe('AWAITING_INPUT'); expect(attempt.failureCode).toBe('PAYMENT_NOT_CONFIRMED'); expect(provider.cancel).not.toHaveBeenCalled();
    });
    it.each([
      ['a real decline', { declined: true }, 'DECLINED', 'PAYMENT_DECLINED', 'DECLINED'],
      ['provider processing', { status: 'processing', methodType: 'card' }, 'PROCESSING', null, 'PROCESSING'],
    ] as const)('follows provider truth when Stripe later records %s', async (_label, provided, state, code, classification) => {
      verified(); Object.assign(intent, provided);
      await service.process(id);
      expect(attempt.state).toBe(state); expect(attempt.failureCode).toBe(code); expect(customerPaymentStatus(attempt)).toBe(classification);
      expect(provider.cancel).not.toHaveBeenCalled();
    });
    it('leaves a submission inside the grace alone: a slow submit (8-37 s in DEV) followed by a late announcement is never cut off', async () => {
      Object.assign(attempt, { submittedAt: minutes(5), expiresAt: new Date(Date.now() + 10 * 60_000) });
      await service.process(id);
      expect(attempt.failureCode).toBeNull(); expect(customerPaymentStatus(attempt)).toBe('PROCESSING');
    });
    it.each([
      ['a confirmation was announced recently (Stripe.js may still be confirming)', { confirmationStartedAt: minutes(1) }, {}],
      ['Stripe has a payment method attached', {}, { methodType: 'card' }],
      ['Stripe is processing', {}, { status: 'processing', methodType: 'card' }],
    ] as const)('never records NOT_CONFIRMED when %s', async (_label, row, provided) => {
      submittedLongAgo(); Object.assign(attempt, row); Object.assign(intent, provided);
      await service.process(id);
      expect(attempt.failureCode === 'PAYMENT_NOT_CONFIRMED').toBe(false); expect(provider.cancel).not.toHaveBeenCalled();
    });
    it('a real Stripe decline is Payment failed (PAYMENT_DECLINED), never NOT_CONFIRMED and never lapsed or cancelled', async () => {
      Object.assign(attempt, { submittedAt: minutes(120), expiresAt: minutes(90) }); Object.assign(intent, { declined: true });
      await service.process(id);
      expect(provider.cancel).not.toHaveBeenCalled(); expect(attempt.state).toBe('DECLINED'); expect(customerPaymentStatus(attempt)).toBe('DECLINED');
    });
    it('never applies without the confirmation signal (no marker evidence)', async () => {
      delete process.env.PAYMENT_CONFIRMATION_SIGNAL; submittedLongAgo();
      await service.process(id);
      expect(attempt.state).toBe('AWAITING_INPUT'); expect(attempt.failureCode).toBeNull();
    });
    it('a lapsed 3DS purchase is a cancelled PAYMENT_EXPIRED record, excluded from active lists (ABANDONED), never relabelled Payment failed', async () => {
      Object.assign(attempt, { state: 'ACTION_REQUIRED', submittedAt: minutes(120), expiresAt: minutes(90) }); Object.assign(intent, { status: 'requires_action', methodType: 'card' });
      await service.process(id);
      expect(provider.cancel).toHaveBeenCalledTimes(1); expect(attempt.failureCode).toBe('PAYMENT_EXPIRED'); expect(customerPaymentStatus(attempt)).toBe('ABANDONED');
    });

    describe('Cancel purchase (server-verified exception)', () => {
      beforeEach(() => { verified(); vi.spyOn(service, 'status').mockResolvedValue({ attemptId: id } as never); });
      it('an eligible purchase is cancelled at Stripe through the fenced worker and leaves the active lists; nothing is charged', async () => {
        await expect(service.cancel('customer', id)).resolves.toMatchObject({ attemptId: id });
        expect(provider.retrieve).toHaveBeenCalled(); expect(provider.cancel).toHaveBeenCalledTimes(1); expect(provider.capture).not.toHaveBeenCalled();
        expect(attempt.state).toBe('CANCELED'); expect(attempt.failureCode).toBe('PAYMENT_CANCELED_BY_CUSTOMER'); expect(customerPaymentStatus(attempt)).toBe('ABANDONED');
      });
      it.each([
        ['not verified as never-confirmed', { failureCode: null }, {}],
        ['a confirmation was announced', { confirmationStartedAt: minutes(1) }, {}],
        ['an order exists', { orderId: 'order' }, {}],
        ['cancellation already requested', { cancelRequested: true }, {}],
        ['the purchase was declined', { state: 'DECLINED', failureCode: 'PAYMENT_DECLINED' }, {}],
        ['Stripe now records a decline', {}, { declined: true }],
        ['Stripe now has a payment method attached', {}, { methodType: 'card' }],
        ['Stripe is processing', {}, { status: 'processing', methodType: 'card' }],
        ['Stripe holds an authorization', {}, { status: 'requires_capture', capturable: 1999, methodType: 'card' }],
      ] as const)('is refused (409) when %s, with no write and no provider cancellation', async (_label, row, provided) => {
        Object.assign(attempt, row); Object.assign(intent, provided);
        const requestedBefore = attempt.cancelRequested;
        await expect(service.cancel('customer', id)).rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_CANCEL_NOT_ALLOWED' });
        expect(provider.cancel).not.toHaveBeenCalled(); expect(attempt.cancelRequested).toBe(requestedBefore);
      });
      it('is refused while a recovery pass holds the lease (no race with the worker)', async () => {
        Object.assign(work, { state: 'LEASED', leaseToken: 'other', leaseUntil: new Date(Date.now() + 60_000) });
        await expect(service.cancel('customer', id)).rejects.toMatchObject({ code: 'PAYMENT_CANCEL_NOT_ALLOWED' });
        expect(attempt.cancelRequested).toBe(false); expect(provider.cancel).not.toHaveBeenCalled();
      });
      it.each([
        ['an authorization', { status: 'requires_capture', capturable: 1999, methodType: 'card' }],
        ['a decline', { declined: true }],
      ] as const)('provider truth wins over a recorded cancellation request: %s observed by the worker is never cancelled', async (_label, provided) => {
        Object.assign(attempt, { cancelRequested: true, failureCode: 'PAYMENT_CANCELED_BY_CUSTOMER' }); Object.assign(intent, provided);
        await service.process(id).catch(() => undefined);
        expect(provider.cancel).not.toHaveBeenCalled(); expect(attempt.cancelRequested).toBe(false);
        expect(attempt.failureCode === 'PAYMENT_CANCELED_BY_CUSTOMER').toBe(false);
      });
    });
  });
  describe('a submitted attempt abandoned at card entry', () => {
    const minutes = (value: number) => new Date(Date.now() - value * 60_000);
    const abandoned = () => Object.assign(attempt, { submittedAt: minutes(120), expiresAt: minutes(90) });
    it('is cancelled by the existing workflow once lifetime and grace have passed and Stripe still shows no payment method', async () => {
      abandoned();
      await service.process(id);
      expect(provider.cancel).toHaveBeenCalledTimes(1); expect(provider.capture).not.toHaveBeenCalled(); expect(provider.refund).not.toHaveBeenCalled();
      expect(attempt.state).toBe('CANCELED'); expect(work.state).toBe('DONE');
    });
    it('is left alone inside the grace window, so a confirmation still in flight is never cancelled', async () => {
      Object.assign(attempt, { submittedAt: minutes(5), expiresAt: minutes(1) });
      await service.process(id);
      expect(provider.cancel).not.toHaveBeenCalled(); expect(attempt.state).toBe('AWAITING_INPUT');
    });
    it.each([['requires_action', 'ACTION_REQUIRED'], ['requires_confirmation', 'AWAITING_INPUT'], ['requires_action', 'AWAITING_INPUT']] as const)(
      'also lapses an abandoned submission whose intent is %s while the attempt is %s', async (status, state) => {
        abandoned(); attempt.state = state; intent.status = status;
        await service.process(id);
        expect(provider.cancel).toHaveBeenCalledTimes(1); expect(provider.capture).not.toHaveBeenCalled();
        expect(attempt.state).toBe('CANCELED');
      });
    it.each([['processing', 0, 0], ['requires_capture', 0, 1999], ['succeeded', 1999, 0], ['requires_payment_method', 1999, 0], ['requires_payment_method', 0, 1999]] as const)(
      'is never cancelled when Stripe reports %s (received %i, capturable %i)', async (status, received, capturable) => {
        abandoned(); Object.assign(intent, { status, received, capturable, methodType: capturable ? 'card' : null });
        await service.process(id);
        expect(provider.cancel).not.toHaveBeenCalled();
      });
    it('is never cancelled when an order exists or a cancellation/failure was already decided', async () => {
      abandoned(); attempt.orderId = 'order';
      await service.process(id);
      expect(provider.cancel).not.toHaveBeenCalled();
    });
    describe('with a recorded confirmation-started signal', () => {
      const inside = () => Object.assign(attempt, { submittedAt: minutes(5), expiresAt: minutes(1) });
      it('keeps a fresh signal and cancels nothing, even for an otherwise abandoned attempt', async () => {
        abandoned(); Object.assign(attempt, { confirmationStartedAt: minutes(0.5) });
        await service.process(id);
        expect(provider.cancel).not.toHaveBeenCalled(); expect(attempt.confirmationStartedAt).not.toBeNull(); expect(attempt.state).toBe('AWAITING_INPUT');
      });
      it('clears only the marker when Stripe still shows no recorded confirmation after the grace, inventing no outcome', async () => {
        inside(); Object.assign(attempt, { confirmationStartedAt: minutes(3) });
        await service.process(id);
        expect(attempt.confirmationStartedAt).toBeNull(); expect(attempt.state).toBe('AWAITING_INPUT');
        expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled(); expect(attempt.orderId).toBeNull();
      });
      it.each([['processing', 0, 0], ['requires_action', 0, 0], ['requires_capture', 0, 1999]] as const)(
        'keeps the marker when Stripe reports %s: the confirmation did reach Stripe', async (status, received, capturable) => {
          inside(); Object.assign(attempt, { confirmationStartedAt: minutes(3) }); Object.assign(intent, { status, received, capturable, methodType: 'card' });
          await service.process(id);
          expect(attempt.confirmationStartedAt).not.toBeNull(); expect(provider.cancel).not.toHaveBeenCalled();
        });
      // Regression (Processing -> Checkout saved): the worker's first read can predate the browser's Stripe confirmation by milliseconds.
      it('a pre-decline snapshot never clears the marker: the fresh read finds the decline and the purchase becomes Failed, not Checkout saved', async () => {
        inside(); Object.assign(attempt, { confirmationStartedAt: minutes(3) });
        provider.retrieve.mockResolvedValueOnce({ ...intent }).mockResolvedValueOnce({ ...intent, declined: true });
        await service.process(id);
        expect(provider.retrieve).toHaveBeenCalledTimes(2);
        expect(attempt.state).toBe('DECLINED'); expect(attempt.failureCode).toBe('PAYMENT_DECLINED');
        expect(customerPaymentStatus(attempt)).toBe('DECLINED');
        expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
      });
      it('a confirmation authorized after the stale read is reconciled as provider truth and never regresses to card entry', async () => {
        inside(); Object.assign(attempt, { confirmationStartedAt: minutes(3) });
        provider.retrieve.mockResolvedValueOnce({ ...intent }).mockResolvedValueOnce({ ...intent, status: 'processing', methodType: 'card' });
        await service.process(id);
        expect(attempt.confirmationStartedAt).not.toBeNull(); expect(attempt.state).toBe('PROCESSING');
        expect(customerPaymentStatus(attempt)).toBe('PROCESSING'); expect(provider.cancel).not.toHaveBeenCalled();
      });
      it('keeps the marker while Stripe has a payment method attached (confirmation recorded, outcome pending)', async () => {
        inside(); Object.assign(attempt, { confirmationStartedAt: minutes(3) }); Object.assign(intent, { methodType: 'card' });
        await service.process(id);
        expect(attempt.confirmationStartedAt).not.toBeNull(); expect(provider.cancel).not.toHaveBeenCalled();
      });
    });
  });
  it('keeps explicit cancellation distinct from local AUTHORIZED expiry', async () => {
    Object.assign(attempt, { state: 'AUTHORIZED', cancelRequested: true, failureCode: 'PAYMENT_ATTEMPT_SUPERSEDED', expiresAt: new Date(0) });
    Object.assign(intent, { status: 'requires_capture', capturable: 1999, methodType: 'card' });
    await service.process(id);
    expect(provider.cancel).toHaveBeenCalledTimes(1); expect(provider.capture).not.toHaveBeenCalled();
    expect(attempt.failureCode).toBe('PAYMENT_ATTEMPT_SUPERSEDED'); expect(attempt.state).toBe('CANCELED');
  });
  it('isolated runtime injects its durable guard into the actual PaymentService processor', async () => {
    const requireScript = createRequire(resolve('package.json'));
    const budgetTools = requireScript('./scripts/acceptance-budget.cjs') as { openBudget(options: object): unknown };
    const installation = requireScript('./scripts/acceptance-installation.cjs') as { installAcceptance(options: object): { runOnce(): Promise<unknown>; close(): void } };
    const safety = requireScript('./scripts/stripe-gate-safety.cjs') as { sourceFingerprint(root: string): string };
    const runId = randomUUID(); const userId = randomUUID(); const accountId = 'acct_1UEZW5KiVgdl63pN';
    const config = { runId, approvedRunId: runId, attemptId: id, userId, accountId, amountCents: 1349,
      scenario: 'POST_PROVIDER_CAPTURE_RESPONSE_LOSS', projectRef: 'pzxekjybdiulzmssalfo', sourceFingerprint: safety.sourceFingerprint(resolve('.')) };
    const directory = resolve('.cache/stripe-acceptance-budget', runId);
    budgetTools.openBudget({ directory, config, initialize: true });
    Object.assign(attempt, { userId, stripeAccountId: accountId, amountCents: 1349, state: 'PREPARING', providerIntentId: null });
    Object.assign(intent, { account: accountId, amount: 1349 }); work.id = randomUUID(); provider.account.mockResolvedValue(accountId);
    const runtime = installation.installAcceptance({ directory, provider, database: db,
      manifest: { config, role: 'runner', ownerPid: process.pid, parentPid: process.ppid, executable: process.execPath,
        cwd: process.cwd(), workId: work.id, browserSessionId: randomUUID() },
      serviceFactory: (database: PrismaClient, adapter: PaymentProvider) => new PaymentService(database, adapter) });
    try {
      await runtime.runOnce(); expect(provider.create).toHaveBeenCalledTimes(1); expect(attempt.state).toBe('AWAITING_INPUT');
      work.id = randomUUID(); await expect(runtime.runOnce()).rejects.toThrow(); expect(provider.create).toHaveBeenCalledTimes(1);
    } finally { runtime.close(); }
  // Durable filesystem receipts can exceed Vitest's default deadline on Windows.
  // This allowance changes no provider budget, lease or guard assertion.
  }, 20_000);
  it('reconciles an explicit PRE fault without inferring capture success', async () => {
    Object.assign(intent, { status: 'requires_capture', capturable: 1999, methodType: 'card' });
    const double = captureTools.deterministicProvider(intent);
    const fault = captureTools.captureFault({ mode: 'PRE_PROVIDER_CAPTURE_FAILURE', provider: double, runtime: 'test' });
    provider.retrieve.mockImplementation(key => double.retrieve(key)); provider.capture.mockImplementation(fault.capture);
    await service.process(id); fault.assertFired();
    expect(double.snapshot().effects).toBe(0); expect(attempt.state).toBe('CAPTURE_PENDING');
    expect(db.order.update).not.toHaveBeenCalled(); expect(db.payment.update).not.toHaveBeenCalled();
  });
  it('reconciles explicit POST response loss without repeating purchase or provider capture', async () => {
    let inventoryQuantity = 2; let orders = 0; let payments = 0;
    commit.mockImplementation(async () => {
      inventoryQuantity--; orders++; payments++; attempt.orderId = 'order'; attempt.state = 'CAPTURE_PENDING';
    });
    Object.assign(intent, { status: 'requires_capture', capturable: 1999, methodType: 'card' });
    const double = captureTools.deterministicProvider(intent);
    const fault = captureTools.captureFault({ mode: 'POST_PROVIDER_CAPTURE_RESPONSE_LOSS', provider: double, runtime: 'test' });
    provider.retrieve.mockImplementation(key => double.retrieve(key)); provider.capture.mockImplementation(fault.capture);
    await service.process(id); fault.assertFired();
    expect(double.snapshot().effects).toBe(1); expect(attempt.state).toBe('CAPTURE_PENDING');
    expect(db.order.update).not.toHaveBeenCalled(); expect(db.payment.update).not.toHaveBeenCalled();
    work.nextRunAt = new Date(0); await service.process(id); await service.process(id);
    expect(attempt.state).toBe('PAID'); expect(work.state).toBe('DONE');
    expect(commit).toHaveBeenCalledTimes(1); expect(provider.capture).toHaveBeenCalledTimes(1);
    expect(double.snapshot().keys).toEqual([operationKey(id, 'capture')]);
    expect(provider.create).not.toHaveBeenCalled(); expect(provider.cancel).not.toHaveBeenCalled();
    expect(db.order.update).toHaveBeenCalledTimes(1); expect(db.payment.update).toHaveBeenCalledTimes(1);
    expect({ inventoryQuantity, orders, payments }).toEqual({ inventoryQuantity: 1, orders: 1, payments: 1 });
  });
  it('replaces an interrupted POST worker after lease expiry and rejects its stale completion', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    attempt.orderId = 'order'; attempt.state = 'CAPTURE_PENDING';
    Object.assign(intent, { status: 'requires_capture', capturable: 1999, methodType: 'card' });
    const double = captureTools.deterministicProvider(intent);
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const fault = captureTools.captureFault({ mode: 'POST_PROVIDER_CAPTURE_RESPONSE_LOSS', provider: double, runtime: 'test', afterCapture: () => barrier });
    provider.retrieve.mockImplementation(key => double.retrieve(key)); provider.capture.mockImplementation(fault.capture);
    const workerA = service.process(id);
    await vi.waitFor(() => expect(double.snapshot().effects).toBe(1));
    const tokenA = work.leaseToken; expect(tokenA).not.toBeNull();
    expect(attempt.state).toBe('CAPTURE_PENDING'); expect(db.payment.update).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + WORK_LEASE_MS + 1);
    let tokenB: string | null = null;
    provider.retrieve.mockImplementation(async key => { tokenB = work.leaseToken; return double.retrieve(key); });
    await new PaymentService(db as unknown as PrismaClient, provider).process(id);
    expect(tokenB).not.toBeNull(); expect(tokenB).not.toBe(tokenA);
    expect(attempt.state).toBe('PAID'); expect(work.state).toBe('DONE');
    release(); await workerA; fault.assertFired();
    expect(attempt.state).toBe('PAID'); expect(work.state).toBe('DONE');
    expect(work.leaseToken).toBeNull(); expect(double.snapshot().effects).toBe(1);
    expect(provider.capture).toHaveBeenCalledTimes(1); expect(commit).not.toHaveBeenCalled();
    expect(db.order.update).toHaveBeenCalledTimes(1); expect(db.payment.update).toHaveBeenCalledTimes(1);
  });
  it('recovers a lost authorization response from provider truth without a second authorization', async () => {
    Object.assign(intent, { status: 'requires_capture', capturable: 1999, methodType: 'card' });
    provider.retrieve.mockRejectedValueOnce(new Error('authorization response unavailable'));
    await service.process(id);
    expect(attempt.orderId).toBeNull(); expect(work.state).toBe('READY');
    expect(attempt.state).toBe('AWAITING_INPUT'); expect(attempt.failureCode).toBeNull();
    expect(commit).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
    work.nextRunAt = new Date(0); await service.process(id);
    expect(attempt.state).toBe('PAID'); expect(work.state).toBe('DONE');
    expect(commit).toHaveBeenCalledTimes(1); expect(provider.capture).toHaveBeenCalledTimes(1);
    expect(provider.create).not.toHaveBeenCalled(); expect(provider.cancel).not.toHaveBeenCalled();
  });
  it('discovers a capture that succeeded before its response was lost without capturing twice', async () => {
    Object.assign(intent, { status: 'requires_capture', capturable: 1999, methodType: 'card' });
    provider.capture.mockImplementationOnce(async () => {
      Object.assign(intent, { status: 'succeeded', received: 1999, capturable: 0 });
      throw new Error('response lost after provider committed capture');
    });
    await service.process(id);
    expect(attempt.state).toBe('CAPTURE_PENDING'); expect(attempt.orderId).toBe('order');
    expect(db.payment.update).not.toHaveBeenCalled(); expect(provider.cancel).not.toHaveBeenCalled();
    work.nextRunAt = new Date(0); await service.process(id);
    expect(attempt.state).toBe('PAID'); expect(work.state).toBe('DONE');
    expect(commit).toHaveBeenCalledTimes(1); expect(provider.capture).toHaveBeenCalledTimes(1);
    expect(db.payment.update).toHaveBeenCalledTimes(1); expect(provider.refund).not.toHaveBeenCalled();
  });
  it('preserves a current lease when a webhook wake precedes the local transition', async () => {
    Object.assign(intent, { status: 'requires_capture', capturable: 1999, methodType: 'card' });
    let release!: (value: ProviderIntent) => void;
    provider.retrieve.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const running = service.process(id);
    await vi.waitFor(() => expect(provider.retrieve).toHaveBeenCalledTimes(1));
    const token = work.leaseToken; await service.wake(id);
    await new PaymentService(db as unknown as PrismaClient, provider).process(id);
    expect(work.state).toBe('LEASED'); expect(work.leaseToken).toBe(token);
    expect(provider.capture).not.toHaveBeenCalled();
    release({ ...intent }); await running;
    expect(attempt.state).toBe('PAID'); expect(commit).toHaveBeenCalledTimes(1);
    expect(provider.capture).toHaveBeenCalledTimes(1);
  });
  it('reconciles out-of-order wakes against current provider state rather than stale event status', async () => {
    intent.status = 'processing'; await service.process(id);
    expect(attempt.state).toBe('PROCESSING'); expect(commit).not.toHaveBeenCalled();
    Object.assign(intent, { status: 'requires_capture', capturable: 1999, methodType: 'card' });
    await service.wake(id); await service.process(id);
    expect(attempt.state).toBe('PAID');
    // A delayed failure notification may wake work, but cannot supply provider facts.
    await service.wake(id); await service.process(id); await service.wake(id); await service.process(id);
    expect(attempt.state).toBe('PAID'); expect(work.state).toBe('DONE');
    expect(commit).toHaveBeenCalledTimes(1); expect(provider.capture).toHaveBeenCalledTimes(1);
    expect(db.payment.update).toHaveBeenCalledTimes(1); expect(provider.cancel).not.toHaveBeenCalled();
  });
  it('rolls back modeled compensation failure and retries stock restoration exactly once', async () => {
    attempt.orderId = 'order'; attempt.state = 'CAPTURE_PENDING';
    attempt.request = { scope: 'BUY_NOW', buyNow: { productId: id, quantity: 2 } };
    attempt.items = [{ id, attemptId: id, productId: id, quantity: 2, productName: 'Fixture', sku: 'fixture',
      imageUrl: null, sourceCartItemId: null, snapshotCartItemId: null, unitPrice: new Prisma.Decimal('10'), lineTotal: new Prisma.Decimal('20') }];
    intent.status = 'canceled'; let quantity = 8; let orderState = 'AWAITING_CAPTURE'; let paymentState = 'PROCESSING'; let fail = true;
    db.$queryRaw.mockResolvedValue([{ categoryId: id }]); db.user.findUnique.mockResolvedValue({ isActive: true });
    db.payment.findUnique.mockImplementation(async () => ({ status: paymentState }));
    db.order.update.mockImplementation(async ({ data }) => { orderState = data.status; });
    db.payment.update.mockImplementation(async ({ data }) => {
      if (fail) { fail = false; throw new Error('compensation persistence unavailable'); }
      paymentState = data.status;
    });
    vi.spyOn(InventoryService.prototype, 'increaseStock').mockImplementation(async (_product, added) => {
      quantity += added; return { id, productId: id, quantity, lowStockAt: 5, status: 'IN_STOCK', createdAt: new Date(), updatedAt: new Date() };
    });
    // Explicit transactional rollback model: not a substitute for physical PostgreSQL.
    db.$transaction.mockImplementation(async (operation: (tx: typeof db) => Promise<unknown>) => {
      const snapshot = { attempt: { ...attempt }, work: { ...work }, quantity, orderState, paymentState };
      try { return await operation(db); } catch (error) {
        Object.assign(attempt, snapshot.attempt); Object.assign(work, snapshot.work);
        quantity = snapshot.quantity; orderState = snapshot.orderState; paymentState = snapshot.paymentState; throw error;
      }
    });
    await service.process(id);
    expect(attempt.state).toBe('COMPENSATION_PENDING'); expect(attempt.compensatedAt).toBeNull();
    expect(quantity).toBe(8); expect(orderState).toBe('AWAITING_CAPTURE'); expect(paymentState).toBe('PROCESSING');
    expect(work.state).toBe('READY'); work.nextRunAt = new Date(0); await service.process(id);
    expect(attempt.state).toBe('COMPENSATED'); expect(quantity).toBe(10);
    expect(orderState).toBe('CANCELLED'); expect(paymentState).toBe('FAILED');
    await service.wake(id); await service.process(id); expect(quantity).toBe(10);
    expect(provider.capture).not.toHaveBeenCalled(); expect(provider.cancel).not.toHaveBeenCalled();
    expect(db.cart.findUnique).not.toHaveBeenCalled();
  });
  it('does not load unused payment line items on status polling', async () => {
    await service.status(attempt.userId, id);
    expect(db.paymentAttempt.findFirst).toHaveBeenCalledWith({ where: { id, userId: attempt.userId }, include: { work: true } });
  });
  const setupRequest = { shipping: { recipient: 'Test Customer', line1: '123 Test Street', city: 'Test City', postalCode: '12345',
    country: 'United States', phone: '+1 555 010 2000' }, deliveryMethod: 'STANDARD' as const, paymentMethod: 'CARD' as const, expectedRevision: 'b'.repeat(64) };
  const replaySnapshot = () => {
    const productId = '22222222-2222-4222-8222-222222222222';
    db.$queryRaw.mockResolvedValue([{ id: 'cart' }]);
    db.cart.findUnique.mockResolvedValue({ id: 'cart', items: [{ id: 'line', productId, quantity: 1 }] });
    db.product.findMany.mockResolvedValue([{ id: productId, name: 'Item A', slug: 'item-a', sku: 'A', categoryId: 'category',
      price: new Prisma.Decimal('19.99'), status: 'ACTIVE', isTestFixture: false, category: { name: 'Category', isActive: true },
      inventory: { quantity: 10, lowStockAt: 5 }, images: [] }]);
    const input = { ...setupRequest, expectedRevision: cartRevision('cart', [{ productId, quantity: 1, product: { price: '19.99' } }]) };
    attempt.revision = input.expectedRevision; attempt.request = input; attempt.requestHash = requestHash(input);
    return input;
  };
  it('measures the eligible setup replay with controlled database/provider latency', async () => {
    const input = replaySnapshot(); intent.clientSecret = 'fixture_entry_secret';
    provider.account.mockResolvedValue('acct_test');
    const databaseMethods = [db.paymentAttempt.findUnique, db.paymentAttempt.findFirst, db.paymentAttempt.update,
      db.paymentWork.updateMany, db.paymentWork.update, db.cart.findUnique, db.product.findMany, db.$queryRaw];
    for (const method of databaseMethods) {
      const implementation = method.getMockImplementation();
      method.mockImplementation(async (...args) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return implementation?.(...args);
      });
    }
    provider.retrieve.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 20)); return { ...intent };
    });
    const logs = vi.spyOn(logger, 'info');
    const started = performance.now();
    const response = await service.setup(attempt.userId, attempt.idempotencyKey, input, 'controlled-setup-benchmark');
    const durationMs = performance.now() - started;
    expect(response.clientSecret).toBe(intent.clientSecret);
    expect(db.paymentWork.updateMany).not.toHaveBeenCalled();
    expect(db.paymentAttempt.update).not.toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const calls: readonly (readonly unknown[])[] = logs.mock.calls;
    const report = calls.map(call => call[1]).find(value => value && typeof value === 'object' && Reflect.get(value, 'event') === 'payment.setup.performance');
    expect(report).toBeDefined();
    expect(JSON.stringify(report)).not.toContain(intent.clientSecret);
    expect(JSON.stringify(report)).not.toContain(attempt.userId);
    const label = process.env.SETUP_BENCHMARK_LABEL;
    if (label === 'before' || label === 'after') {
      mkdirSync('test-results/task-03.6', { recursive: true });
      writeFileSync(`test-results/task-03.6/setup-${label}.json`, JSON.stringify({ classification: 'OFFLINE MOCKED',
        injectedDatabaseOperationMs: 10, injectedProviderRetrieveMs: 20, durationMs,
        databaseOperationCount: databaseMethods.reduce((count, method) => count + method.mock.calls.length, 0),
        transactionCount: db.$transaction.mock.calls.length, workerClaimCount: db.paymentWork.updateMany.mock.calls.length,
        providerCreateCount: provider.create.mock.calls.length, providerCaptureCount: provider.capture.mock.calls.length,
        stages: report }, null, 2));
    }
  });
  it('returns the same eligible attempt when setup performance logging fails', async () => {
    const input = replaySnapshot(); intent.clientSecret = 'fixture_entry_secret'; provider.account.mockResolvedValue('acct_test');
    const log = vi.spyOn(logger, 'info').mockImplementation(() => { throw new Error('log sink unavailable'); });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const response = await service.setup(attempt.userId, attempt.idempotencyKey, input, 'setup_log_failure');
      expect(response.attemptId).toBe(attempt.id);
      expect(response.clientSecret).toBe('fixture_entry_secret');
      expect(provider.create).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalled();
      expect(stderr.mock.calls.join(' ')).not.toContain('fixture_entry_secret');
    } finally { log.mockRestore(); stderr.mockRestore(); }
  });
  it.each(['processing', 'requires_capture'] as const)('does not shortcut provider %s into reusable card entry', async status => {
    const input = replaySnapshot(); provider.account.mockResolvedValue('acct_test');
    intent.status = status;
    if (status === 'requires_capture') { intent.capturable = 1999; intent.methodType = 'card'; }
    const processing = vi.spyOn(service, 'process');
    const response = await service.setup(attempt.userId, attempt.idempotencyKey, input);
    expect(processing).toHaveBeenCalledTimes(1);
    expect(response.clientSecret).toBeNull();
  });
  it('does not return entry credentials while another worker owns the live lease', async () => {
    const input = replaySnapshot(); provider.account.mockResolvedValue('acct_test');
    intent.clientSecret = 'fixture_entry_secret';
    work.state = 'LEASED'; work.leaseToken = 'another-worker'; work.leaseUntil = new Date(Date.now() + 60_000);
    const processing = vi.spyOn(service, 'process');
    const response = await service.setup(attempt.userId, attempt.idempotencyKey, input);
    expect(response.clientSecret).toBeNull();
    expect(response).toMatchObject({ state: 'AWAITING_INPUT', recoveryActive: true, attemptId: id });
    expect(processing).toHaveBeenCalledTimes(1);
    expect(provider.capture).not.toHaveBeenCalled();
  });
  it('uses the committed initial entry snapshot without a redundant status query', async () => {
    attempt.providerIntentId = null; provider.account.mockResolvedValue('acct_test'); intent.clientSecret = 'fixture_entry_secret';
    db.$transaction.mockResolvedValueOnce({ ...attempt });
    const response = await service.setup(attempt.userId, attempt.idempotencyKey, setupRequest);
    expect(response.clientSecret).toBe(intent.clientSecret);
    expect(db.paymentAttempt.findFirst).not.toHaveBeenCalled();
    expect(attempt.providerIntentId).toBe(intent.id); expect(work.leaseToken).toBeNull();
    expect(provider.create).toHaveBeenCalledTimes(1); expect(provider.capture).not.toHaveBeenCalled();
  });
  it('retries a definite serializable abort with the same attempt identity', async () => {
    const serializationConflict = new Prisma.PrismaClientKnownRequestError('Transaction write conflict', {
      code: 'P2034', clientVersion: 'test',
    });
    db.$transaction.mockRejectedValueOnce(serializationConflict).mockResolvedValueOnce(attempt);
    provider.account.mockResolvedValue('acct_test');
    const processing = vi.spyOn(service, 'process').mockResolvedValue(intent);

    const response = await service.setup(attempt.userId, attempt.idempotencyKey, setupRequest);

    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.$transaction).toHaveBeenNthCalledWith(1, expect.any(Function), expect.objectContaining({ isolationLevel: 'Serializable' }));
    expect(db.$transaction).toHaveBeenNthCalledWith(2, expect.any(Function), expect.objectContaining({ isolationLevel: 'Serializable' }));
    expect(processing).toHaveBeenCalledTimes(1);
    expect(processing).toHaveBeenCalledWith(attempt.id);
    expect(response.attemptId).toBe(attempt.id);
  });
  it('does not blindly retry an uncertain Prisma transaction outcome', async () => {
    const uncertain = new Prisma.PrismaClientKnownRequestError('Transaction outcome unknown', {
      code: 'P2028', clientVersion: 'test',
    });
    db.$transaction.mockRejectedValue(uncertain);
    provider.account.mockResolvedValue('acct_test');
    const processing = vi.spyOn(service, 'process');

    await expect(service.setup(attempt.userId, attempt.idempotencyKey, setupRequest)).rejects.toBe(uncertain);

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(processing).not.toHaveBeenCalled();
  });
  it('classifies only transaction-aborting serialization/deadlock errors as retryable', () => {
    const knownError = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError('db failure', {
      code, clientVersion: 'test', meta,
    });
    expect(isSerializationConflict(knownError('P2034'))).toBe(true);
    expect(isSerializationConflict(knownError('P2010', { code: '40001' }))).toBe(true);
    expect(isSerializationConflict(knownError('P2010', { code: '40P01' }))).toBe(true);
    expect(isSerializationConflict(knownError('P2010', { message: 'Transaction write conflict' }))).toBe(true);
    expect(isSerializationConflict(knownError('P2028'))).toBe(false);
    expect(isSerializationConflict(new Error('connection lost during commit'))).toBe(false);
  });
  it('finishes work from the fenced attempt snapshot without a redundant state read', async () => {
    await service.process(id);
    expect(db.paymentAttempt.findUnique).toHaveBeenCalledTimes(2);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
  it('persists a newly created ordinary card intent and releases its worker lease atomically', async () => {
    attempt.providerIntentId = null;
    await service.process(id);
    expect(db.paymentAttempt.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id }, data: expect.objectContaining({
      providerIntentId: intent.id, providerStatus: intent.status, state: 'AWAITING_INPUT',
    }) }));
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(attempt.providerIntentId).toBe(intent.id);
    expect(work.state).toBe('READY');
  });
  it.each([
    ['requires_payment_method', false, 'AWAITING_INPUT'], ['requires_payment_method', true, 'DECLINED'],
    ['requires_action', false, 'ACTION_REQUIRED'], ['processing', false, 'PROCESSING'],
  ])('maps %s without a premature Order or capture', async (status, declined, expected) => {
    Object.assign(intent, { status, declined }); await service.process(id);
    expect(attempt.state).toBe(expected); expect(commit).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
    expect(db.payment.update).not.toHaveBeenCalled(); expect(work.state).toBe(expected === 'DECLINED' ? 'DONE' : 'READY');
  });
  it('commits only verified authorization, then captures and persists full provider success', async () => {
    Object.assign(intent, { status: 'requires_capture', capturable: 1999, methodType: 'card', card: { brand: 'visa', last4: '4242' } });
    await service.process(id);
    expect(commit).toHaveBeenCalledTimes(1); expect(provider.capture).toHaveBeenCalledTimes(1);
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(provider.capture.mock.invocationCallOrder[0] ?? 0);
    expect(db.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCEEDED', cardLast4: '4242' }) }));
    expect(attempt.state).toBe('PAID'); expect(attempt.activeCartId).toBeNull(); expect(work.state).toBe('DONE');
  });
  it('does not repeat effects after a resolved paid outcome', async () => {
    attempt.state = 'PAID'; await service.process(id);
    expect(provider.retrieve).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });
  it('retains committed state on a capture timeout and discovers success without capturing again', async () => {
    Object.assign(intent, { status: 'requires_capture', capturable: 1999, methodType: 'card' });
    provider.capture.mockRejectedValueOnce(new Error('transport unknown'));
    await service.process(id); expect(attempt.state).toBe('CAPTURE_PENDING'); expect(attempt.orderId).toBe('order');
    expect(work.retryCount).toBe(1); expect(provider.cancel).not.toHaveBeenCalled();
    intent.status = 'succeeded'; intent.received = 1999; work.nextRunAt = new Date(0);
    await service.process(id); expect(attempt.state).toBe('PAID'); expect(commit).toHaveBeenCalledTimes(1);
    expect(provider.capture).toHaveBeenCalledTimes(1);
  });
  it('recovers a discarded setup response by the same key without worker or provider writes', async () => {
    const input = replaySnapshot(); intent.clientSecret = 'fixture_entry_secret'; provider.account.mockResolvedValue('acct_test');
    // The server finishes; the transport discards this result, rather than failing a provider call.
    await service.setup(attempt.userId, attempt.idempotencyKey, input);
    const recovered = await service.setup(attempt.userId, attempt.idempotencyKey, input);
    expect(recovered.attemptId).toBe(id); expect(recovered.clientSecret).toBe(intent.clientSecret);
    expect(db.paymentAttempt.update).not.toHaveBeenCalled(); expect(db.paymentWork.updateMany).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
  it('restarts committed capture work after real lease expiry and fences the delayed previous worker', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    attempt.orderId = 'order'; attempt.state = 'CAPTURE_PENDING';
    Object.assign(intent, { status: 'requires_capture', capturable: 1999, methodType: 'card' });
    let releaseOldRead!: (value: ProviderIntent) => void;
    const oldRead = new Promise<ProviderIntent>(resolve => { releaseOldRead = resolve; });
    provider.retrieve.mockReturnValueOnce(oldRead);
    const oldWorker = service.process(id);
    await vi.waitFor(() => expect(provider.retrieve).toHaveBeenCalledTimes(1));
    const oldToken = work.leaseToken;
    const replacement = new PaymentService(db as unknown as PrismaClient, provider);
    await replacement.process(id);
    expect(provider.capture).not.toHaveBeenCalled(); // Live lease is not reclaimed.
    vi.setSystemTime(Date.now() + WORK_LEASE_MS + 1);
    await replacement.process(id);
    expect(work.leaseToken).toBeNull(); expect(attempt.state).toBe('PAID');
    expect(provider.capture).toHaveBeenCalledTimes(1); expect(commit).not.toHaveBeenCalled();
    releaseOldRead({ ...intent, status: 'requires_capture', received: 0, capturable: 1999 });
    await oldWorker;
    expect(provider.capture).toHaveBeenCalledTimes(1); expect(attempt.state).toBe('PAID');
    expect(db.order.update).toHaveBeenCalledTimes(1); expect(db.payment.update).toHaveBeenCalledTimes(1);
    expect(oldToken).not.toBeNull();
  });
  it('fences stale completion when the lease expires during capture and replacement resumes the same provider operation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    attempt.orderId = 'order'; attempt.state = 'CAPTURE_PENDING';
    Object.assign(intent, { status: 'requires_capture', capturable: 1999, methodType: 'card' });
    let finishCapture!: (value: ProviderIntent) => void;
    const inFlight = new Promise<ProviderIntent>(resolve => { finishCapture = resolve; });
    const keyedOperations = new Map<string, Promise<ProviderIntent>>(); let effects = 0;
    // Model Stripe's idempotency contract; actual adapter key use is separately reviewed.
    provider.capture.mockImplementation(async purchase => {
      const key = operationKey(purchase.id, 'capture');
      if (!keyedOperations.has(key)) { effects++; keyedOperations.set(key, inFlight); }
      return keyedOperations.get(key)!;
    });
    const oldWorker = service.process(id);
    await vi.waitFor(() => expect(provider.capture).toHaveBeenCalledTimes(1));
    vi.setSystemTime(Date.now() + WORK_LEASE_MS + 1);
    const replacement = new PaymentService(db as unknown as PrismaClient, provider).process(id);
    await vi.waitFor(() => expect(provider.capture).toHaveBeenCalledTimes(2));
    intent = { ...intent, status: 'succeeded', received: 1999, capturable: 0 };
    finishCapture(intent); await Promise.all([oldWorker, replacement]);
    expect(keyedOperations.size).toBe(1); expect(effects).toBe(1);
    expect(attempt.state).toBe('PAID'); expect(work.state).toBe('DONE');
    expect(db.order.update).toHaveBeenCalledTimes(1); expect(db.payment.update).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled(); expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.refund).not.toHaveBeenCalled();
  });
  it('uses the identical provider capture identity and amount after an uncertain transport result', async () => {
    const actual = await vi.importActual<typeof import('../stripe.provider.js')>('../stripe.provider.js');
    const boundary = new actual.StripeProvider();
    const transport = vi.spyOn(boundary.sdk().paymentIntents, 'capture').mockRejectedValue(new Error('controlled-unknown-transport'));
    await expect(boundary.capture(attempt)).rejects.toThrow('controlled-unknown-transport');
    await expect(boundary.capture(attempt)).rejects.toThrow('controlled-unknown-transport');
    const options = { idempotencyKey: operationKey(id, 'capture') };
    expect(transport).toHaveBeenNthCalledWith(1, 'pi_test', { amount_to_capture: 1999, expand: ['payment_method', 'latest_charge'] }, options);
    expect(transport).toHaveBeenNthCalledWith(2, 'pi_test', { amount_to_capture: 1999, expand: ['payment_method', 'latest_charge'] }, options);
    expect(db.order.update).not.toHaveBeenCalled(); expect(db.payment.update).not.toHaveBeenCalled();
    expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.refund).not.toHaveBeenCalled();
  });
  it('does not downgrade Paid or repeat capture when a stale webhook wakes completed work', async () => {
    attempt.orderId = 'order'; attempt.state = 'PAID'; work.state = 'DONE';
    await service.wake(id); await service.process(id);
    expect(attempt.state).toBe('PAID'); expect(work.state).toBe('DONE');
    expect(provider.capture).not.toHaveBeenCalled(); expect(provider.cancel).not.toHaveBeenCalled();
    expect(db.order.update).not.toHaveBeenCalled(); expect(db.payment.update).not.toHaveBeenCalled();
  });
  it('compensates a definitively rejected Buy Now capture once without touching the ordinary Cart', async () => {
    attempt.orderId = 'order'; attempt.state = 'CAPTURE_PENDING';
    attempt.subtotal = new Prisma.Decimal('20.00'); attempt.total = new Prisma.Decimal('20.00'); attempt.amountCents = 2000;
    attempt.request = { scope: 'BUY_NOW', buyNow: { productId: id, quantity: 2 } };
    attempt.items = [{ id, attemptId: id, productId: id, quantity: 2, productName: 'Fixture', sku: 'fixture',
      imageUrl: null, sourceCartItemId: null, snapshotCartItemId: null, unitPrice: new Prisma.Decimal('10.00'), lineTotal: new Prisma.Decimal('20.00') }];
    Object.assign(intent, { amount: 2000, status: 'requires_capture', capturable: 2000, methodType: 'card' });
    provider.capture.mockRejectedValueOnce(new AppError('Definitive rejection', 409, 'PAYMENT_CAPTURE_REJECTED'));
    db.$queryRaw.mockResolvedValue([{ categoryId: id }]);
    db.payment.findUnique.mockResolvedValue({ status: 'PROCESSING' });
    db.user.findUnique.mockResolvedValue({ isActive: true });
    let quantity = 8;
    const restore = vi.spyOn(InventoryService.prototype, 'increaseStock').mockImplementation(async (_product, added) => {
      quantity += added;
      return { id, productId: id, quantity, lowStockAt: 5, status: 'IN_STOCK', createdAt: new Date(), updatedAt: new Date() };
    });
    await service.process(id);
    expect(intent.status).toBe('canceled'); expect(intent.received).toBe(0);
    expect(attempt.state).toBe('COMPENSATED'); expect(attempt.compensatedAt).not.toBeNull();
    expect(db.order.update).toHaveBeenCalledWith({ where: { id: 'order' }, data: { status: 'CANCELLED' } });
    expect(db.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
    expect(quantity).toBe(10); expect(restore).toHaveBeenCalledTimes(1);
    expect(db.cart.findUnique).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
    await service.wake(id); await service.process(id);
    expect(quantity).toBe(10); expect(restore).toHaveBeenCalledTimes(1);
    expect(provider.capture).toHaveBeenCalledTimes(1); expect(provider.cancel).toHaveBeenCalledTimes(1);
    expect(db.payment.update).toHaveBeenCalledTimes(1); expect(db.order.update).toHaveBeenCalledTimes(1);
  });
  it('durably cancels a pre-commit stock conflict without capture', async () => {
    Object.assign(intent, { status: 'requires_capture', capturable: 1999, methodType: 'card' });
    commit.mockRejectedValue(new AppError('Stock changed', 409, 'INVENTORY_CONFLICT'));
    await service.process(id); expect(attempt.state).toBe('CANCELED'); expect(attempt.failureCode).toBe('INVENTORY_CONFLICT');
    expect(provider.cancel).toHaveBeenCalledTimes(1); expect(provider.capture).not.toHaveBeenCalled(); expect(attempt.orderId).toBeNull();
  });
  it.each([false, true])('compensates A once without modifying a newer populated Cart (empty original Cart: %s)', async empty => {
    const productA = '22222222-2222-4222-8222-222222222222';
    const productB = '33333333-3333-4333-8333-333333333333';
    const product = (productId: string) => ({ id: productId, name: productId === productA ? 'Item A' : 'Item B', sku: productId,
      slug: productId, categoryId: 'category', price: new Prisma.Decimal('19.99'), status: 'ACTIVE', isTestFixture: false,
      category: { name: 'Category', isActive: true }, inventory: { quantity: 10, lowStockAt: 5 }, images: [] });
    const now = new Date();
    attempt.orderId = 'order'; attempt.state = 'CAPTURE_PENDING';
    attempt.items = [{ id: productA, attemptId: id, productId: productA, quantity: 1, unitPrice: new Prisma.Decimal('19.99'),
      lineTotal: new Prisma.Decimal('19.99'), productName: 'Item A', sku: 'A', imageUrl: null, sourceCartItemId: null, snapshotCartItemId: null }];
    intent.status = 'requires_capture'; intent.capturable = 1999; intent.methodType = 'card';
    db.cart.findUnique.mockResolvedValue({ id: 'cart', items: empty ? [] : [{ id: 'line-b', productId: productB, quantity: 1 }] });
    db.product.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map(product));
    db.$queryRaw.mockResolvedValue([{ categoryId: 'category' }]);
    db.user.findUnique.mockResolvedValue({ isActive: true });
    db.payment.findUnique.mockResolvedValue({ status: 'PROCESSING' });
    provider.capture.mockRejectedValue(new AppError('Capture rejected.', 409, 'PAYMENT_CAPTURE_REJECTED'));
    const inventory = new InventoryService();
    const restored = vi.spyOn(inventory, 'increaseStock').mockResolvedValue({ id: 'inventory-a', productId: productA,
      quantity: 10, lowStockAt: 5, status: 'IN_STOCK', createdAt: now, updatedAt: now });
    const processor = new PaymentService(db as unknown as PrismaClient, provider, inventory);
    await processor.process(id);
    expect(attempt.state).toBe('COMPENSATED');
    expect(restored).toHaveBeenCalledTimes(1);
    expect(restored).toHaveBeenCalledWith(productA, 1, expect.anything());
    expect(db.cartItem.upsert).toHaveBeenCalledTimes(empty ? 1 : 0);
    expect(attempt.recoveryRemainder).toEqual(empty ? [] : [{ productId: productA, quantity: 1 }]);
    await processor.wake(id); await processor.process(id);
    expect(restored).toHaveBeenCalledTimes(1); expect(provider.capture).toHaveBeenCalledTimes(1);
    expect(db.cartItem.upsert).toHaveBeenCalledTimes(empty ? 1 : 0);
  });
  it('does not cancel on an unknown transaction failure', async () => {
    Object.assign(intent, { status: 'requires_capture', capturable: 1999, methodType: 'card' });
    commit.mockRejectedValue(new Error('database connection')); await service.process(id);
    expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled(); expect(work.state).toBe('READY');
  });
  it('reconciles P2028 purchase outcomes without canceling the authorized intent', async () => {
    Object.assign(intent, { status: 'requires_capture', capturable: 1999, methodType: 'card' });
    commit.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Transaction outcome unknown', { code: 'P2028', clientVersion: 'test' }));
    await service.process(id);
    expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
    expect(work.state).toBe('READY'); expect(work.retryCount).toBe(1);
  });
  it.each([{ amount: 2000 }, { currency: 'eur' }, { captureMethod: 'automatic' }, { methodType: 'sepa_debit' }])('cancels mismatched intent %j before purchase', async change => {
    Object.assign(intent, { status: 'requires_capture', capturable: 1999, methodType: 'card' }, change);
    await service.process(id); expect(commit).not.toHaveBeenCalled(); expect(provider.capture).not.toHaveBeenCalled();
    expect(attempt.state).toBe('CANCELED');
  });
  it.each([{ account: 'acct_other' }, { livemode: true }, { attemptId: 'other' }, { id: 'pi_other' }])('does not mutate foreign provider identity %j', async change => {
    Object.assign(intent, change); await service.process(id);
    expect(attempt.state).toBe('INCIDENT'); expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.refund).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
  it('retries an unknown create with the same persisted attempt rather than replacing its identity', async () => {
    attempt.providerIntentId = null; provider.create.mockRejectedValueOnce(new Error('unknown create'));
    await service.process(id); expect(attempt.providerIntentId).toBeNull(); expect(work.retryCount).toBe(1);
    work.nextRunAt = new Date(0); await service.process(id);
    expect(provider.create).toHaveBeenCalledTimes(2); expect(provider.create.mock.calls.every(([saved]) => saved.id === id)).toBe(true);
    expect(attempt.providerIntentId).toBe('pi_test');
  });
  it('never recreates an uncertain intent beyond the guaranteed provider key window', async () => {
    attempt.providerIntentId = null; attempt.createdAt = new Date(0); await service.process(id);
    expect(attempt.state).toBe('INCIDENT'); expect(provider.create).not.toHaveBeenCalled();
  });
  it('does not process a current competing lease', async () => {
    work.state = 'LEASED'; work.leaseToken = 'other'; work.leaseUntil = new Date(Date.now() + 60_000);
    await service.process(id); expect(provider.retrieve).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });
  it.each(['AUTHORIZED', 'DECLINED'] as const)('distinguishes pending authorization from a provider-confirmed %s outcome', async state => {
    attempt.state = state;
    if (state === 'DECLINED') { attempt.failureCode = 'PAYMENT_DECLINED'; intent.declined = true; }
    db.paymentWork.updateMany.mockResolvedValue({ count: 1 });
    const processing = vi.spyOn(service, 'process').mockReturnValue(new Promise<ProviderIntent | null>(() => {}));

    const response = await service.reconcile(attempt.userId, id);

    expect(response.state).toBe(state);
    expect(response.committed).toBe(false);
    expect(response.recoveryActive).toBe(state === 'AUTHORIZED');
    if (state === 'AUTHORIZED') {
      expect(db.paymentWork.updateMany).toHaveBeenCalledTimes(1);
      expect(processing).toHaveBeenCalledWith(id);
    } else {
      expect(provider.retrieve).toHaveBeenCalledTimes(1);
      expect(db.paymentWork.updateMany).not.toHaveBeenCalled();
      expect(processing).not.toHaveBeenCalled();
    }
  });
  it('reports only a currently leased worker as active recovery', async () => {
    work.state = 'LEASED'; work.leaseUntil = new Date(Date.now() + 60_000);
    expect((await service.status(attempt.userId, id)).recoveryActive).toBe(true);
    work.leaseUntil = new Date(Date.now() - 1);
    expect((await service.status(attempt.userId, id)).recoveryActive).toBe(false);
    work.state = 'READY'; work.leaseUntil = null;
    expect((await service.status(attempt.userId, id)).recoveryActive).toBe(false);
  });
  it('fences a stale worker after its provider read', async () => {
    provider.retrieve.mockImplementation(async () => { work.leaseToken = 'new-worker'; return intent; });
    await service.process(id); expect(db.paymentAttempt.update).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });
  it('persists refund identity and amount, then retrieves the same refund on retry', async () => {
    intent.status = 'succeeded'; intent.received = 1999;
    await service.process(id); expect(attempt.state).toBe('REFUND_PENDING'); expect(attempt.refundId).toBe('re_test');
    expect(attempt.refundAmountCents).toBe(1999); expect(db.payment.update).not.toHaveBeenCalled();
    work.nextRunAt = new Date(0); await service.process(id);
    expect(provider.refund).toHaveBeenCalledTimes(1); expect(provider.retrieveRefund).toHaveBeenCalledWith('re_test');
  });
  it('bounds repeated provider failures and preserves an incident for explicit recovery', async () => {
    const log = vi.spyOn(logger, 'error');
    work.retryCount = 11; provider.retrieve.mockRejectedValue(new Error('unknown')); await service.process(id);
    expect(work.state).toBe('INCIDENT'); expect(work.retryCount).toBe(12); expect(attempt.state).toBe('INCIDENT');
    expect(attempt.activeCartId).toBe('cart'); expect(work.lastError).toBe('PAYMENT_PROVIDER_UNKNOWN');
    expect(log).toHaveBeenCalledWith('Payment recovery requires operator investigation.', expect.objectContaining({
      event: 'payment.recovery.escalation', attemptId: id, reason: 'RETRY_BUDGET_EXHAUSTED',
    }));
  });
  it.each(['failed', 'succeeded'] as const)('rechecks a previously refunded attempt when provider refund later reports %s', async status => {
    Object.assign(attempt, { state: 'REFUNDED', refundId: 're_test', refundAmountCents: 1999, orderId: 'order', compensatedAt: new Date(), activeCartId: null });
    Object.assign(intent, { status: 'succeeded', received: 1999 });
    provider.retrieveRefund.mockResolvedValue({ id: 're_test', intentId: 'pi_test', amount: 1999, status });
    await service.process(id);
    expect(provider.retrieveRefund).toHaveBeenCalledWith('re_test');
    expect(attempt.state).toBe(status === 'failed' ? 'INCIDENT' : 'REFUNDED');
    expect(provider.refund).not.toHaveBeenCalled();
    if (status === 'failed') expect(db.payment.update).toHaveBeenCalledWith({ where: { orderId: 'order' },
      data: { status: 'PROCESSING', refundedAt: null, failureReason: 'PAYMENT_REFUND_INCIDENT' } });
    else expect(db.payment.update).not.toHaveBeenCalled();
    expect(db.order.update).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });
});
