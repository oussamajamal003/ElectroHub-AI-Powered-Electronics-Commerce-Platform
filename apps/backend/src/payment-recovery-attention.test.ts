import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { paymentRecoveryAttention } from './payment-recovery-attention.js';
import { PaymentService, paymentWorkScopeWhere } from './services/payment.service.js';

// The owner-isolated incident attempt must be unreachable by a scoped worker: neither its attention scan nor its batch claim
// query can select a row outside the frozen supervisor scope.
const scope = Object.freeze(['11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333']) as string[];
const isolated = '22222222-2222-4222-8222-222222222222';

describe('scoped worker queries exclude the isolated backlog attempt', () => {
  it('restricts the attention scan to the exact scope', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await paymentRecoveryAttention({ paymentWork: { findMany } } as unknown as PrismaClient, scope);
    const where = findMany.mock.calls[0]![0].where;
    expect(where.attemptId).toEqual({ in: scope });
    expect(where.attemptId.in).not.toContain(isolated);
  });

  it('restricts the batch claim selection to the exact scope', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new PaymentService({ paymentWork: { findMany } } as unknown as PrismaClient);
    await service.runBatch(scope).catch(() => undefined);
    expect(findMany).toHaveBeenCalled();
    for (const [query] of findMany.mock.calls) expect(query.where.attemptId).toEqual({ in: scope });
  });
});

describe('governed DEV scope selects only attempts created at/after the approved boundary', () => {
  const createdSince = new Date('2026-10-20T17:00:00.000Z');
  it('applies the same creation-time filter to the batch claim and the attention scan, never an unscoped query', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await new PaymentService({ paymentWork: { findMany } } as unknown as PrismaClient).runBatch({ createdSince }).catch(() => undefined);
    await paymentRecoveryAttention({ paymentWork: { findMany } } as unknown as PrismaClient, { createdSince });
    expect(findMany).toHaveBeenCalledTimes(2);
    for (const [query] of findMany.mock.calls) {
      expect(query.where.attempt).toEqual({ createdAt: { gte: createdSince } });
      expect(query.where.attemptId).toBeUndefined();
    }
  });
  it('maps every scope form explicitly', () => {
    expect(paymentWorkScopeWhere(undefined)).toEqual({});
    expect(paymentWorkScopeWhere(scope)).toEqual({ attemptId: { in: scope } });
    expect(paymentWorkScopeWhere({ createdSince })).toEqual({ attempt: { createdAt: { gte: createdSince } } });
  });
});

// Task 04.0 follow-up: an expired-lease DECLINED row is finished by the existing worker claim, scoped to the one reviewed attempt.
describe('expired-lease recovery of one DECLINED attempt', () => {
  const id = '384a8c53-c4bf-4924-92e0-e2c000870a8d';
  const attempt = { id, state: 'DECLINED', failureCode: 'PAYMENT_DECLINED', providerStatus: 'requires_payment_method', providerIntentId: 'pi_declined',
    stripeAccountId: 'acct_test', amountCents: 150, currency: 'USD', orderId: null, cancelRequested: false, submittedAt: new Date('2026-10-14T19:58:31Z'),
    confirmationStartedAt: null, expiresAt: new Date('2026-10-14T20:28:31Z'), createdAt: new Date('2026-10-14T19:58:00Z'), refundId: null, compensatedAt: null, items: [] };
  const intent = { id: 'pi_declined', account: 'acct_test', livemode: false, amount: 150, currency: 'usd', captureMethod: 'manual', status: 'requires_payment_method',
    capturable: 0, received: 0, methodType: 'card', clientSecret: null, attemptId: id, declined: true, card: null, captureBefore: null };
  const harness = (providerIntent: typeof intent) => {
    let token = '';
    const writes: { attempt: unknown[]; work: unknown[] } = { attempt: [], work: [] };
    const updateMany = vi.fn(async ({ data }) => { token = data.leaseToken; return { count: 1 }; });
    const tx = {
      $queryRaw: vi.fn(async () => []),
      paymentAttempt: {
        findUnique: vi.fn(async () => ({ ...attempt, work: { state: 'LEASED', leaseToken: token, leaseUntil: new Date(Date.now() + 60_000) } })),
        update: vi.fn(async ({ data }) => { writes.attempt.push(data); return { ...attempt, ...data }; }),
      },
      paymentWork: { update: vi.fn(async ({ data }) => { writes.work.push(data); return { attemptId: id, ...data }; }) },
    };
    const database = { paymentWork: { updateMany }, paymentAttempt: { findUnique: vi.fn(async () => attempt) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const provider = { retrieve: vi.fn(async () => providerIntent), create: vi.fn(), capture: vi.fn(), cancel: vi.fn(), refund: vi.fn(), retrieveRefund: vi.fn(), account: vi.fn() };
    const service = new PaymentService(database as unknown as PrismaClient, provider as never, undefined, () => ({ allowed: true }) as never);
    return { service, updateMany, writes, provider };
  };

  it('claims only through the expired-lease clause and finishes the work DONE as DECLINED, with no order, cancel or capture', async () => {
    const { service, updateMany, writes, provider } = harness(intent);
    await service.process(id);
    const where = updateMany.mock.calls[0]![0].where;
    expect(where.attemptId).toBe(id);
    expect(where.OR).toContainEqual({ state: 'LEASED', leaseUntil: { lt: expect.any(Date) } });
    expect(writes.attempt).toEqual([{ state: 'DECLINED', providerStatus: 'requires_payment_method', failureCode: 'PAYMENT_DECLINED' }]);
    expect(writes.work).toHaveLength(1);
    expect(writes.work[0]).toMatchObject({ state: 'DONE', leaseToken: null, leaseUntil: null, lastError: null, retryCount: 0 });
    expect(provider.capture).not.toHaveBeenCalled(); expect(provider.cancel).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
  });

  it('never widens the batch to the DONE+DECLINED recheck rows outside the one reviewed attempt', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await new PaymentService({ paymentWork: { findMany } } as unknown as PrismaClient).runBatch([id]).catch(() => undefined);
    expect(findMany.mock.calls[0]![0].where.attemptId).toEqual({ in: [id] });
  });
});
