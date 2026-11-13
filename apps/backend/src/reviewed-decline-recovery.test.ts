import type { PrismaClient } from '@prisma/client';
import { beforeEach, expect, it, vi } from 'vitest';
import { reconcileReviewedDecline } from './reviewed-decline-recovery.js';

const permission = vi.hoisted(() => ({ allowed: true }));
vi.mock('./payment-isolation.js', () => ({ paymentIsolation: () => permission }));
const id = '11111111-1111-4111-8111-111111111111';
const attempt = () => ({ id, state: 'DECLINED', failureCode: 'PAYMENT_DECLINED', providerStatus: 'requires_payment_method',
  submittedAt: new Date(), cancelRequested: false, orderId: null, providerIntentId: 'pi_declined', stripeAccountId: 'acct_test',
  amountCents: 100, currency: 'USD', work: { state: 'READY', leaseToken: null, leaseUntil: null, lastError: null } });
const intent = () => ({ id: 'pi_declined', account: 'acct_test', livemode: false, amount: 100, currency: 'usd', captureMethod: 'manual',
  status: 'requires_payment_method', declined: true, received: 0, capturable: 0, methodType: 'card', clientSecret: null, attemptId: id });
function harness() {
  const findUnique = vi.fn().mockResolvedValue(attempt());
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const tx = { $queryRaw: vi.fn().mockResolvedValue([{ id }]), paymentAttempt: { findUnique }, paymentWork: { updateMany } };
  const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<number>) => callback(tx));
  const db = { paymentAttempt: { findUnique }, $transaction: transaction } as unknown as PrismaClient;
  const retrieve = vi.fn().mockResolvedValue(intent());
  return { db, retrieve, updateMany, findUnique, transaction };
}
beforeEach(() => { permission.allowed = true; });

it('finishes only one reviewed work row after fresh bound decline verification; no financial method exists on this boundary', async () => {
  const h = harness(); expect(await reconcileReviewedDecline(h.db, { retrieve: h.retrieve }, [id])).toBe(1);
  expect(h.retrieve).toHaveBeenCalledOnce();
  expect(h.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ attemptId: id, state: 'READY', leaseToken: null }),
    data: expect.objectContaining({ state: 'DONE' }) }));
});
it('requires live isolation permission and exactly one canonical ID before database/provider work', async () => {
  for (const scope of [[], [id, id], ['not-an-id']]) {
    const h = harness(); await expect(reconcileReviewedDecline(h.db, { retrieve: h.retrieve }, scope)).rejects.toMatchObject({ code: 'REVIEWED_DECLINE_CHANGED' });
    expect(h.findUnique).not.toHaveBeenCalled();
  }
  permission.allowed = false; const h = harness();
  await expect(reconcileReviewedDecline(h.db, { retrieve: h.retrieve }, [id])).rejects.toMatchObject({ code: 'REVIEWED_DECLINE_CHANGED' });
  expect(h.findUnique).not.toHaveBeenCalled();
});
it.each([{ status: 'requires_capture', capturable: 100 }, { status: 'succeeded', received: 100 }, { livemode: true },
  { declined: false }, { received: 1 }, { amount: 200 }, { attemptId: 'other' }])('provider drift %j never reaches a work write', async patch => {
  const h = harness(); h.retrieve.mockResolvedValue({ ...intent(), ...patch });
  await expect(reconcileReviewedDecline(h.db, { retrieve: h.retrieve }, [id])).rejects.toBeDefined();
  expect(h.updateMany).not.toHaveBeenCalled();
});
it.each([{ state: 'AUTHORIZED' }, { orderId: 'new-order' }, { cancelRequested: true },
  { work: { state: 'LEASED', leaseToken: 'owner', leaseUntil: new Date(), lastError: null } }])('rechecks locked state %j and refuses concurrent changes', async patch => {
  const h = harness(); h.findUnique.mockResolvedValueOnce(attempt()).mockResolvedValueOnce({ ...attempt(), ...patch });
  await expect(reconcileReviewedDecline(h.db, { retrieve: h.retrieve }, [id])).rejects.toMatchObject({ code: 'REVIEWED_DECLINE_CHANGED' });
  expect(h.updateMany).not.toHaveBeenCalled();
});
it('a completed row is a no-op, and ambiguous provider failure is never marked complete', async () => {
  const h = harness(); h.findUnique.mockResolvedValue({ ...attempt(), work: { ...attempt().work, state: 'DONE' } });
  expect(await reconcileReviewedDecline(h.db, { retrieve: h.retrieve }, [id])).toBe(0); expect(h.retrieve).not.toHaveBeenCalled();
  const unknown = harness(); unknown.retrieve.mockRejectedValue(new Error('timeout'));
  await expect(reconcileReviewedDecline(unknown.db, { retrieve: unknown.retrieve }, [id])).rejects.toThrow('timeout');
  expect(unknown.updateMany).not.toHaveBeenCalled();
});
