import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customerPaymentStatus } from '../payment.domain.js';
import { PaymentService } from '../payment.service.js';

const ID = '11111111-1111-4111-8111-111111111111';
const base = { state: 'AWAITING_INPUT' as const, submittedAt: new Date(), orderId: null, failureCode: null, confirmationStartedAt: null as Date | null };

describe('confirmation-started classification', () => {
  it('a submitted purchase at card entry is Processing with or without the marker; the marker is not a financial status', () => {
    expect(customerPaymentStatus(base)).toBe('PROCESSING');
    expect(customerPaymentStatus({ ...base, confirmationStartedAt: new Date() })).toBe('PROCESSING');
    expect(customerPaymentStatus({ ...base, submittedAt: null })).toBe('NOT_SUBMITTED');
  });
  it('never overrides a real provider outcome or a genuine customer action', () => {
    const started = { ...base, confirmationStartedAt: new Date() };
    expect(customerPaymentStatus({ ...started, state: 'DECLINED' as never })).toBe('DECLINED');
    expect(customerPaymentStatus({ ...started, state: 'PAID' as never, orderId: 'o' as never })).toBe('SUCCEEDED');
    expect(customerPaymentStatus({ ...started, state: 'ACTION_REQUIRED' as never })).toBe('AWAITING_CUSTOMER_ACTION');
  });
});

describe('PaymentService.confirmationStarted', () => {
  beforeEach(() => { process.env.PAYMENT_CONFIRMATION_SIGNAL = 'true'; });
  afterEach(() => { delete process.env.PAYMENT_CONFIRMATION_SIGNAL; });
  const when = new Date('2026-10-16T12:00:00Z');
  const make = (claimed: number, row: { confirmationStartedAt: Date | null } | null) => {
    const db = { paymentAttempt: { findFirst: vi.fn().mockResolvedValue({ id: ID }), updateMany: vi.fn().mockResolvedValue({ count: claimed }) } };
    db.paymentAttempt.findFirst.mockResolvedValueOnce({ id: ID }).mockResolvedValueOnce(row ? { state: 'AWAITING_INPUT', submittedAt: when, orderId: null, ...row } : null);
    return { db, service: new PaymentService(db as never, {} as never) };
  };
  it('claims once with a guarded, owner-scoped update that touches no financial field', async () => {
    const { db, service } = make(1, { confirmationStartedAt: when });
    await expect(service.confirmationStarted('u', ID)).resolves.toEqual({ attemptId: ID, confirmationStartedAt: when.toISOString() });
    const call = db.paymentAttempt.updateMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({ id: ID, submittedAt: { not: null }, confirmationStartedAt: null, orderId: null, state: 'AWAITING_INPUT' });
    expect(Object.keys(call.data)).toEqual(['confirmationStartedAt']);
  });
  it('is idempotent: a duplicate request returns the first timestamp', async () => {
    const { service } = make(0, { confirmationStartedAt: when });
    await expect(service.confirmationStarted('u', ID)).resolves.toMatchObject({ confirmationStartedAt: when.toISOString() });
  });
  it('refuses a purchase that is unsubmitted, finished or cancelled instead of recording a signal', async () => {
    const { service } = make(0, { confirmationStartedAt: null });
    await expect(service.confirmationStarted('u', ID)).rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_CONFIRMATION_NOT_ALLOWED' });
  });
});

describe('on a database without the migration', () => {
  it('the signal is a harmless no-op that never touches the unmigrated column', async () => {
    delete process.env.PAYMENT_CONFIRMATION_SIGNAL;
    const db = { paymentAttempt: { findFirst: vi.fn().mockResolvedValue({ id: ID }), updateMany: vi.fn() } };
    const service = new PaymentService(db as never, {} as never);
    await expect(service.confirmationStarted('u', ID)).resolves.toEqual({ attemptId: ID, confirmationStartedAt: null });
    expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
  });
});
