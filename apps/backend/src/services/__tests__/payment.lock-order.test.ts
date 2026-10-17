import { describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PaymentService } from '../payment.service.js';
import { OrderService } from '../order.service.js';
import { checkoutRequestSchema, requestHash } from '../checkout.domain.js';
import type { PaymentProvider, ProviderIntent } from '../payment.domain.js';

vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../stripe.provider.js', () => ({ stripeProvider: {} }));
function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
class ModelCycle extends Error {}
class EndAtCart extends Error {}
/** Test lock graph, not a PostgreSQL executor or SSI/deadlock-detector simulation. */
class Locks {
  held = new Map<string, string>();
  waiting = new Map<string, string>();
  pending: { resource: string; owner: string; resolve: () => void }[] = [];
  trace: string[] = [];
  onWait = (_owner: string, _resource: string) => {};
  async take(owner: string, resource: string) {
    const holder = this.held.get(resource);
    this.trace.push(`${owner}:${resource}:${holder && holder !== owner ? 'wait' : 'acquire'}`);
    if (!holder || holder === owner) { this.held.set(resource, owner); return; }
    this.waiting.set(owner, holder); this.onWait(owner, resource);
    if (this.waiting.get(holder) === owner) throw new ModelCycle('Opposite lock-order cycle in source-path double');
    await new Promise<void>(resolve => { this.pending.push({ resource, owner, resolve }); });
    this.waiting.delete(owner);
  }
  release(owner: string) {
    this.waiting.delete(owner);
    for (const [resource, holder] of [...this.held]) if (holder === owner) {
      this.held.delete(resource);
      const at = this.pending.findIndex(p => p.resource === resource);
      if (at >= 0) { const [next] = this.pending.splice(at, 1); this.held.set(resource, next.owner); next.resolve(); }
    }
  }
}
function fixture(state: 'AWAITING_INPUT' | 'AUTHORIZED' = 'AWAITING_INPUT', expired = false) {
  const attemptId = '11111111-1111-4111-8111-111111111111', userId = '22222222-2222-4222-8222-222222222222';
  const key = '33333333-3333-4333-8333-333333333333';
  const request = checkoutRequestSchema.parse({ shipping: { recipient: 'Test Customer', line1: 'Test Street', city: 'Test City', country: 'US', postalCode: '00000', phone: '1234567890' },
    deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: 'a'.repeat(64) });
  const attempt = { id: attemptId, userId, cartId: key, cartIdentity: key, activeCartId: key, idempotencyKey: attemptId,
    request, requestHash: requestHash(request), state, cancelRequested: false, orderId: null, items: [], amountCents: 1000,
    total: new Prisma.Decimal(10), shippingCost: new Prisma.Decimal(0), currency: 'USD', stripeAccountId: 'acct_test',
    providerIntentId: 'pi_owned', expiresAt: new Date(Date.now() + (expired ? -1000 : 60000)) };
  const intent: ProviderIntent = { id: 'pi_owned', account: 'acct_test', attemptId, amount: 1000, currency: 'usd', captureMethod: 'manual',
    status: 'requires_capture', received: 0, capturable: 1000, livemode: false, clientSecret: null, declined: false, methodType: 'card', card: null, captureBefore: null };
  const lease = '44444444-4444-4444-8444-444444444444';
  const work = { state: 'LEASED', leaseToken: lease, leaseUntil: new Date(Date.now() + 60000) };
  const locks = new Locks(), cartHeld = signal(), purchaseWaits = signal(), cancelWaits = signal(), purchaseHolds = signal();
  let pausePurchaseForCancel = false, writes = 0, pauseSetup = true;
  const mutationRequests: Record<string, unknown>[] = [];
  locks.onWait = (owner, resource) => {
    if (owner === 'purchase' || owner === 'setup2') purchaseWaits.resolve();
    if (owner === 'cancel' && resource === 'attempt') cancelWaits.resolve();
  };
  const db = (owner: string) => {
    const tx = {
      $queryRaw: async (sql: Prisma.Sql) => {
        if (sql.sql.includes('"payment_attempts"')) { await locks.take(owner, 'attempt'); if (owner === 'purchase') purchaseHolds.resolve(); return [{ ...attempt }]; }
        if (sql.sql.includes('"payment_work"')) { await locks.take(owner, 'work'); return [work]; }
        if (sql.sql.includes('"carts"')) {
          if (owner === 'purchase' && pausePurchaseForCancel) await cancelWaits.promise;
          await locks.take(owner, 'cart');
          if (owner === 'setup' && pauseSetup) { cartHeld.resolve(); await purchaseWaits.promise; }
          if (owner === 'purchase') throw new EndAtCart('Stop before purchase effects');
          return [{ id: key }];
        }
        throw new Error('Unexpected SQL in isolated lock test');
      },
      paymentAttempt: { findUnique: vi.fn(async () => owner.startsWith('setup') ? null : { ...attempt }), findFirst: vi.fn(async () => ({ ...attempt })),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          mutationRequests.push(data);
          await locks.take(owner, 'attempt'); writes++; Object.assign(attempt, data); return { ...attempt };
        }) },
      user: { findFirst: vi.fn(async () => ({ id: userId })) },
      order: { findUnique: vi.fn(async () => null) }, paymentAttemptItem: { findMany: vi.fn(async () => []) },
    };
    return { ...tx, paymentAttempt: { ...tx.paymentAttempt, findUnique: vi.fn(async () => ({ ...attempt })) },
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>, options?: { isolationLevel?: string; timeout?: number; maxWait?: number }) => {
        if (owner !== 'cancel') expect(options).toMatchObject({ isolationLevel: 'Serializable', timeout: 30_000, maxWait: 10_000 });
        try { return await fn(tx); } finally { locks.release(owner); }
      } } as unknown as PrismaClient;
  };
  const provider = { account: vi.fn(async () => 'acct_test'), create: vi.fn(), retrieve: vi.fn(), capture: vi.fn(), cancel: vi.fn(), refund: vi.fn(), retrieveRefund: vi.fn() } satisfies PaymentProvider;
  return { attempt, intent, lease, request, key, userId, db, provider, locks, cartHeld, purchaseHolds, writes: () => writes,
    mutationRequests, withoutOverlap: () => { pauseSetup = false; },
    forCancellation: () => { pausePurchaseForCancel = true; } };
}

describe('Payment lock order — actual source paths with deterministic snapshot/lock doubles', () => {
  it.each([
    { name: 'AWAITING_INPUT with current worker lease', state: 'AWAITING_INPUT' as const, expired: false },
    { name: 'fresh expired AUTHORIZED snapshot after worker admitted purchase', state: 'AUTHORIZED' as const, expired: true },
  ])('serializes setup/purchase on Attempt without reverse Cart waiting: $name', async ({ state, expired }) => {
    const f = fixture(state, expired); const setup = new PaymentService(f.db('setup'), f.provider);
    const incoming = { ...f.request, deliveryMethod: 'EXPRESS' };
    const setupResult = setup.setup(f.userId, f.key, incoming).catch(e => e);
    await f.cartHeld.promise;
    const purchaseResult = new OrderService(f.db('purchase')).commitAuthorized(f.attempt.id, f.intent, f.lease).catch(e => e);
    expect(await setupResult).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' }); expect(await purchaseResult).toBeInstanceOf(EndAtCart);
    expect(f.locks.trace.slice(0, 4)).toEqual(['setup:attempt:acquire', 'setup:work:acquire', 'setup:cart:acquire', 'purchase:attempt:wait']);
    expect(f.locks.trace).not.toContain('purchase:cart:wait');
    expect(f.writes()).toBe(0); expect(f.provider.capture).not.toHaveBeenCalled(); expect(f.provider.cancel).not.toHaveBeenCalled();
    expect(f.locks.held.size).toBe(0);
  });
  it('a fresh AUTHORIZED snapshot rejects supersession and avoids the modeled cycle', async () => {
    const f = fixture('AUTHORIZED'); const setup = new PaymentService(f.db('setup'), f.provider);
    const setupResult = setup.setup(f.userId, f.key, { ...f.request, deliveryMethod: 'EXPRESS' }).catch(e => e);
    await f.cartHeld.promise;
    const purchaseResult = new OrderService(f.db('purchase')).commitAuthorized(f.attempt.id, f.intent, f.lease).catch(e => e);
    expect(await setupResult).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' }); expect(await purchaseResult).toBeInstanceOf(EndAtCart);
    expect(f.locks.trace).not.toContain('setup:attempt:wait'); expect(f.writes()).toBe(0);
  });
  // Task 03.6: Cancel purchase is a verified exception; an AUTHORIZED purchase is refused before any lock, provider call or write.
  it('cancellation of an AUTHORIZED purchase is refused up front: no lock, no provider call, no write, no Cart order', async () => {
    const f = fixture('AUTHORIZED'); f.withoutOverlap();
    const cancel = new PaymentService(f.db('cancel'), f.provider);
    await expect(cancel.cancel(f.userId, f.attempt.id)).rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_CANCEL_NOT_ALLOWED' });
    expect(f.locks.trace).not.toContain('cancel:attempt:wait'); expect(f.locks.trace).not.toContain('cancel:cart:acquire');
    expect(f.provider.cancel).not.toHaveBeenCalled(); expect(f.provider.retrieve).not.toHaveBeenCalled();
    expect(f.writes()).toBe(0); expect(f.attempt.cancelRequested).toBe(false); expect(f.locks.held.size).toBe(0);
  });
  it('expiry never admits an AUTHORIZED release or replacement', async () => {
    const f = fixture('AUTHORIZED', true); f.withoutOverlap();
    await expect(new PaymentService(f.db('setup'), f.provider).setup(f.userId, f.key,
      { ...f.request, deliveryMethod: 'EXPRESS' })).rejects.toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(f.mutationRequests).toEqual([]);
    expect(f.writes()).toBe(0); expect(f.attempt.cancelRequested).toBe(false);
    expect(f.provider.cancel).not.toHaveBeenCalled(); expect(f.locks.held.size).toBe(0);
  });
  it('competing setup transactions wait on the owned Attempt before either can reverse Cart order', async () => {
    const f = fixture('AUTHORIZED');
    const first = new PaymentService(f.db('setup'), f.provider).setup(f.userId, f.key,
      { ...f.request, deliveryMethod: 'EXPRESS' }).catch(error => error);
    await f.cartHeld.promise;
    const second = new PaymentService(f.db('setup2'), f.provider).setup(f.userId, f.key,
      { ...f.request, deliveryMethod: 'EXPRESS' }).catch(error => error);
    expect(await first).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(await second).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING' });
    expect(f.locks.trace).toContain('setup2:attempt:wait'); expect(f.locks.trace).not.toContain('setup2:cart:wait');
    expect(f.writes()).toBe(0); expect(f.mutationRequests).toEqual([]); expect(f.locks.held.size).toBe(0);
  });
});

/** Design specimen ONLY. Not installed in PaymentService; does not emulate PostgreSQL snapshots/SSI.
 * Stops at the validated lock boundary: it cannot create, cancel or supersede an attempt.
 * A real Serializable implementation must abort/retry when row-version validation fails.
 */
type Candidate = { id: string; userId: string; cartId: string; state: string; expired: boolean };
async function proposedBoundary(locks: Locks, owner: string, candidate: Candidate | null,
  current: () => Candidate | null, userId = 'customer', cartId = 'cart') {
  if (candidate && (candidate.userId !== userId || candidate.cartId !== cartId)) throw Error('OWNERSHIP_MISMATCH');
  if (candidate) await locks.take(owner, `attempt:${candidate.id}`);
  await locks.take(owner, 'cart');
  const active = current();
  if ((active?.id ?? null) !== (candidate?.id ?? null)) throw Error('CANDIDATE_CHANGED_ABORT');
  if (active && (active.userId !== userId || active.cartId !== cartId)) throw Error('OWNERSHIP_MISMATCH');
  // Expiry must not override an authorization/recovery guard. No cancellation is performed here.
  if (active && !['AWAITING_INPUT', 'DECLINED'].includes(active.state)) throw Error('PAYMENT_RECOVERY_PENDING');
  return active?.id ?? null;
}
describe('Attempt-before-Cart design boundary — offline specimen, not an implemented financial fix', () => {
  const candidate = (): Candidate => ({ id: 'old', userId: 'customer', cartId: 'cart', state: 'AWAITING_INPUT', expired: false });
  it('rechecks state after a competing authorization holder releases Attempt', async () => {
    const locks = new Locks(), active = candidate(), queued = signal();
    await locks.take('worker', 'attempt:old');
    locks.onWait = () => queued.resolve();
    const setup = proposedBoundary(locks, 'setup', { ...active }, () => active).catch(error => error);
    await queued.promise; active.state = 'AUTHORIZED'; locks.release('worker');
    expect(await setup).toMatchObject({ message: 'PAYMENT_RECOVERY_PENDING' });
    expect(locks.trace.indexOf('setup:attempt:old:wait')).toBeLessThan(locks.trace.indexOf('setup:cart:acquire'));
    locks.release('setup'); expect(locks.held.size).toBe(0);
  });
  it('rejects an expired AUTHORIZED candidate before any release/supersession decision', async () => {
    const locks = new Locks(), active = { ...candidate(), state: 'AUTHORIZED', expired: true };
    await expect(proposedBoundary(locks, 'setup', active, () => active)).rejects.toThrow('PAYMENT_RECOVERY_PENDING');
    locks.release('setup'); expect(locks.held.size).toBe(0);
  });
  it.each([true, false])('aborts changed active candidate without locking its new Attempt under Cart (initial candidate: %s)', async existed => {
    const locks = new Locks(), old = existed ? candidate() : null, active = { ...candidate(), id: 'replacement' };
    if (old) await locks.take('worker', 'attempt:old');
    const result = proposedBoundary(locks, 'setup', old, () => active).catch(error => error);
    locks.release('worker');
    expect(await result).toMatchObject({ message: 'CANDIDATE_CHANGED_ABORT' });
    expect(locks.trace.some(entry => entry.includes('attempt:replacement'))).toBe(false);
    locks.release('setup'); expect(locks.held.size).toBe(0);
  });
  it('serializes competing setup boundaries on the same Attempt, leaving no reverse Cart wait', async () => {
    const locks = new Locks(), active = candidate(), queued = signal();
    expect(await proposedBoundary(locks, 'first', active, () => active)).toBe('old');
    locks.onWait = () => queued.resolve();
    const second = proposedBoundary(locks, 'second', active, () => active);
    await queued.promise; expect(locks.trace).not.toContain('second:cart:wait');
    locks.release('first'); expect(await second).toBe('old');
    locks.release('second'); expect(locks.held.size).toBe(0);
  });
  it.each([{ userId: 'foreign' }, { cartId: 'foreign' }])('rejects foreign candidate binding before taking locks: %j', async binding => {
    const locks = new Locks(), active = { ...candidate(), ...binding };
    await expect(proposedBoundary(locks, 'setup', active, () => active)).rejects.toThrow('OWNERSHIP_MISMATCH');
    expect(locks.trace).toEqual([]);
  });
});
