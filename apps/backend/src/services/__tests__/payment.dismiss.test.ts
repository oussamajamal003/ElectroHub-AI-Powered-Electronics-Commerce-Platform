import { currentShippingSnapshot } from '../shipping-config.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PaymentService } from '../payment.service.js';

vi.mock('../shipping-config.js', async original => ({ ...await original<typeof import('../shipping-config.js')>(), loadShippingConfig: vi.fn(async () => currentShippingSnapshot()) }));
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
    expect(call.where).toMatchObject({ id: attemptId, userId: owner, dismissedAt: null, submittedAt: { not: null }, state: { in: expect.arrayContaining([state]) } });
    expect(call.where.AND[0]).toEqual({ OR: [{ orderId: null }, { state: { in: ['COMPENSATED', 'REFUNDED'] }, compensatedAt: { not: null } }] });
  });

  it.each(['COMPENSATED', 'REFUNDED'])('dismisses a %s attempt whose Order was compensated (stock restored), setting only dismissedAt', async state => {
    db.paymentAttempt.findFirst.mockResolvedValue(row({ state, orderId: 'ord-1', compensatedAt: new Date('2026-10-15T09:30:00.000Z'), work: { state: 'DONE', lastError: null } }));
    await expect(service.dismiss(owner, attemptId)).resolves.toMatchObject({ attemptId });
    expect(Object.keys(db.paymentAttempt.updateMany.mock.calls[0][0].data)).toEqual(['dismissedAt']);
  });

  it.each(['COMPENSATED', 'REFUNDED'])('refuses a %s Order-backed attempt whose compensation has not committed', async state => {
    db.paymentAttempt.findFirst.mockResolvedValue(row({ state, orderId: 'ord-1', compensatedAt: null }));
    await expect(service.dismiss(owner, attemptId)).rejects.toMatchObject({ code: 'PAYMENT_NOT_DISMISSIBLE' });
    expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
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

  it.each(['DECLINED', 'CANCELED'])('refuses a %s attempt that already produced an Order (not a compensated failure)', async state => {
    db.paymentAttempt.findFirst.mockResolvedValue(row({ state, orderId: 'ord-1', compensatedAt: new Date() }));
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
    expect(where.AND[1]).toEqual({ OR: [{ work: { is: null } }, { work: { is: { state: { not: 'LEASED' }, lastError: null } } }] });
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

  it('projects server-side dismissibility so the card never offers a Remove the server refuses', async () => {
    const base = { userId: owner, total: new Prisma.Decimal('10.00'), currency: 'USD', request: { shipping: { recipient: 'Test Person', line1: 'Test Street', city: 'Test City', country: 'US', postalCode: '00000', phone: '1234567890' },
        deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: 'b'.repeat(64) }, items: [], updatedAt: new Date(), restoredAt: null,
      notificationReadState: null, cancelRequested: false, failureCode: null, confirmationStartedAt: null, submittedAt: new Date(), compensatedAt: null, orderId: null, work: null };
    db.paymentAttempt.findMany.mockResolvedValue([
      { ...base, id: 'declined', state: 'DECLINED' },
      { ...base, id: 'compensated', state: 'COMPENSATED', orderId: 'ord-1', compensatedAt: new Date(), work: { state: 'DONE', lastError: null } },
      { ...base, id: 'compensating', state: 'COMPENSATION_PENDING', orderId: 'ord-2', work: { state: 'READY', lastError: null } },
      { ...base, id: 'unknown', state: 'CANCELED', work: { state: 'READY', lastError: 'PROVIDER_UNAVAILABLE' } },
      { ...base, id: 'paid', state: 'PAID', orderId: 'ord-3' },
      { ...base, id: 'declined-with-order', state: 'DECLINED', orderId: 'ord-4' },
      { ...base, id: 'declined-leased', state: 'DECLINED', work: { state: 'LEASED', lastError: null } },
    ]);
    const list = await service.purchases(owner);
    expect(Object.fromEntries(list.map(item => [item.attemptId, item.dismissible]))).toEqual({ declined: true, compensated: true, compensating: false,
      unknown: false, paid: false, 'declined-with-order': false, 'declined-leased': true });
  });
});
