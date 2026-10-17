import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PaymentService } from '../payment.service.js';

vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../stripe.provider.js', () => ({ stripeProvider: {} }));

const owner = '11111111-1111-4111-8111-111111111111';
const attemptId = '33333333-3333-4333-8333-333333333333';
const dismissedAt = new Date('2026-10-15T10:00:00.000Z');

const db = { paymentAttempt: { findFirst: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() }, $transaction: vi.fn() };
let service: PaymentService;

function row(overrides: Record<string, unknown> = {}) {
  return { id: attemptId, state: 'DECLINED', orderId: null, submittedAt: new Date('2026-10-15T09:00:00.000Z'), dismissedAt: null, work: null, ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  db.paymentAttempt.updateMany.mockResolvedValue({ count: 1 });
  service = new PaymentService(db as unknown as PrismaClient, {} as never);
});

describe('PaymentService.dismiss', () => {
  it('rejects an attempt that does not belong to the caller without revealing it exists', async () => {
    db.paymentAttempt.findFirst.mockResolvedValue(null);
    await expect(service.dismiss('other-user', attemptId)).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_NOT_FOUND' });
    expect(db.paymentAttempt.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: attemptId, userId: 'other-user' } }));
    expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
  });

  it.each(['DECLINED', 'CANCELED', 'COMPENSATED', 'REFUNDED'])('dismisses an eligible %s attempt by setting only dismissedAt', async state => {
    db.paymentAttempt.findFirst.mockResolvedValue(row({ state }));
    const result = await service.dismiss(owner, attemptId);
    expect(result.attemptId).toBe(attemptId);
    expect(Date.parse(result.dismissedAt)).not.toBeNaN();
    const call = db.paymentAttempt.updateMany.mock.calls[0][0];
    expect(Object.keys(call.data)).toEqual(['dismissedAt']);
    expect(call.where).toMatchObject({ id: attemptId, userId: owner, dismissedAt: null, orderId: null, submittedAt: { not: null }, state: { in: expect.arrayContaining([state]) } });
  });

  it('returns the existing dismissal without writing again (idempotent)', async () => {
    db.paymentAttempt.findFirst.mockResolvedValue(row({ dismissedAt }));
    await expect(service.dismiss(owner, attemptId)).resolves.toEqual({ attemptId, dismissedAt: dismissedAt.toISOString() });
    expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
  });

  it.each(['PREPARING', 'AWAITING_INPUT', 'ACTION_REQUIRED', 'PROCESSING', 'AUTHORIZED', 'CAPTURE_PENDING', 'PAID', 'CANCEL_PENDING', 'COMPENSATION_PENDING', 'REFUND_PENDING', 'INCIDENT'])(
    'refuses to dismiss a %s attempt', async state => {
      db.paymentAttempt.findFirst.mockResolvedValue(row({ state }));
      await expect(service.dismiss(owner, attemptId)).rejects.toMatchObject({ code: 'PAYMENT_NOT_DISMISSIBLE' });
      expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
    });

  it('refuses a declined attempt that was never submitted (not a failed purchase the list shows)', async () => {
    db.paymentAttempt.findFirst.mockResolvedValue(row({ state: 'DECLINED', submittedAt: null }));
    await expect(service.dismiss(owner, attemptId)).rejects.toMatchObject({ code: 'PAYMENT_NOT_DISMISSIBLE' });
    expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a submitted attempt whose work is an unknown outcome even when the state is failed', async () => {
    db.paymentAttempt.findFirst.mockResolvedValue(row({ state: 'CANCELED', work: { state: 'DONE', lastError: 'PROVIDER_UNAVAILABLE' } }));
    await expect(service.dismiss(owner, attemptId)).rejects.toMatchObject({ code: 'PAYMENT_NOT_DISMISSIBLE' });
    expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
  });

  it('refuses an attempt that already produced an Order', async () => {
    db.paymentAttempt.findFirst.mockResolvedValue(row({ orderId: 'ord-1' }));
    await expect(service.dismiss(owner, attemptId)).rejects.toMatchObject({ code: 'PAYMENT_NOT_DISMISSIBLE' });
    expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
  });

  it('refuses while a recovery lease is active', async () => {
    db.paymentAttempt.findFirst.mockResolvedValue(row({ work: { state: 'LEASED', lastError: null } }));
    await expect(service.dismiss(owner, attemptId)).rejects.toMatchObject({ code: 'PAYMENT_NOT_DISMISSIBLE' });
    expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
  });

  it('refuses an attempt whose outcome is unknown (recovery error recorded)', async () => {
    db.paymentAttempt.findFirst.mockResolvedValue(row({ work: { state: 'READY', lastError: 'PROVIDER_UNAVAILABLE' } }));
    await expect(service.dismiss(owner, attemptId)).rejects.toMatchObject({ code: 'PAYMENT_NOT_DISMISSIBLE' });
    expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
  });

  it('re-checks the guards inside the write, so a racing recovery cannot be hidden underneath', async () => {
    db.paymentAttempt.findFirst.mockResolvedValue(row());
    db.paymentAttempt.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.dismiss(owner, attemptId)).rejects.toMatchObject({ code: 'PAYMENT_NOT_DISMISSIBLE' });
    const where = db.paymentAttempt.updateMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ work: { is: null } }, { work: { is: { state: { not: 'LEASED' }, lastError: null } } }]);
  });

  it('maps a serialization conflict to a safe retryable refusal', async () => {
    db.paymentAttempt.findFirst.mockResolvedValue(row());
    db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('write conflict', { code: 'P2034', clientVersion: '6.12.0' }));
    await expect(service.dismiss(owner, attemptId)).rejects.toMatchObject({ code: 'PAYMENT_NOT_DISMISSIBLE' });
  });
});

describe('PaymentService.purchases dismissal filter', () => {
  it('excludes dismissed attempts from the customer failed-payments list', async () => {
    db.paymentAttempt.findMany.mockResolvedValue([]);
    await service.purchases(owner);
    expect(db.paymentAttempt.findMany.mock.calls[0][0].where).toMatchObject({ userId: owner, dismissedAt: null });
  });
});
