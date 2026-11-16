import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customerPaymentStatus } from '../payment.domain.js';
import { PaymentService } from '../payment.service.js';
import { purchaseItemsProjection } from '../cart.service.js';

vi.mock('../cart.service.js', async original => ({ ...await original<typeof import('../cart.service.js')>(), purchaseItemsProjection: vi.fn() }));

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
    // The stock gate's transaction finds nothing to gate here (null): these cases cover the claim itself.
    const db = { $transaction: vi.fn().mockResolvedValue(null), paymentAttempt: { findFirst: vi.fn().mockResolvedValue({ id: ID }), updateMany: vi.fn().mockResolvedValue({ count: claimed }) } };
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
    const db = { $transaction: vi.fn().mockResolvedValue(null), paymentAttempt: { findFirst: vi.fn().mockResolvedValue({ id: ID }), updateMany: vi.fn() } };
    const service = new PaymentService(db as never, {} as never);
    await expect(service.confirmationStarted('u', ID)).resolves.toEqual({ attemptId: ID, confirmationStartedAt: null });
    expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
  });
});

describe('stock gate right before card confirmation (PR #51 last unit)', () => {
  const submitted = { id: ID, state: 'AWAITING_INPUT', submittedAt: new Date(), confirmationStartedAt: null, orderId: null, cancelRequested: false,
    items: [{ productId: 'p1', productName: 'Last Unit Phone', quantity: 1 }] };
  const make = (availability: string, availableQuantity: number) => {
    const tx = { $queryRaw: vi.fn(), paymentAttempt: { findFirst: vi.fn().mockResolvedValue(submitted), update: vi.fn() } };
    const db = { $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
      paymentAttempt: { findFirst: vi.fn().mockResolvedValue({ ...submitted, confirmationStartedAt: new Date() }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      paymentWork: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    vi.mocked(purchaseItemsProjection).mockResolvedValue({ data: { items: [{ productId: 'p1', availability, availableQuantity }] } } as never);
    const service = new PaymentService(db as never, {} as never);
    const process = vi.spyOn(service, 'process').mockResolvedValue(null);
    return { tx, db, service, process };
  };
  it('refuses a sold-out item with the standard 409, records the cancellation durably first, never marks confirmation, and settles it now', async () => {
    const { tx, db, service, process } = make('OUT_OF_STOCK', 0);
    await expect(service.confirmationStarted('u', ID)).rejects.toMatchObject({ statusCode: 409, code: 'CART_STOCK_CONFLICT',
      message: 'Last Unit Phone is out of stock. Nothing was charged.' });
    expect(tx.paymentAttempt.update).toHaveBeenCalledWith({ where: { id: ID }, data: { cancelRequested: true, failureCode: 'CART_STOCK_CONFLICT' } });
    expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
    expect(db.paymentWork.updateMany).toHaveBeenCalledTimes(1); expect(process).toHaveBeenCalledWith(ID);
    expect(tx.paymentAttempt.update.mock.invocationCallOrder[0]!).toBeLessThan(process.mock.invocationCallOrder[0]!);
  });
  it('refuses a withdrawn item as PRODUCT_UNAVAILABLE', async () => {
    const { service } = make('UNAVAILABLE', 0);
    await expect(service.confirmationStarted('u', ID)).rejects.toMatchObject({ statusCode: 409, code: 'PRODUCT_UNAVAILABLE' });
  });
  it('lets an in-stock purchase record its confirmation signal untouched', async () => {
    const { tx, db, service, process } = make('AVAILABLE', 3);
    globalThis.process.env.PAYMENT_CONFIRMATION_SIGNAL = 'true';
    try { await expect(service.confirmationStarted('u', ID)).resolves.toMatchObject({ attemptId: ID }); }
    finally { delete globalThis.process.env.PAYMENT_CONFIRMATION_SIGNAL; }
    expect(tx.paymentAttempt.update).not.toHaveBeenCalled(); expect(db.paymentAttempt.updateMany).toHaveBeenCalledTimes(1); expect(process).not.toHaveBeenCalled();
  });
  it.each([['CART_STOCK_CONFLICT', 'CART_STOCK_CONFLICT'], ['PRODUCT_UNAVAILABLE', 'PRODUCT_UNAVAILABLE'], ['INVENTORY_NOT_FOUND', 'PRODUCT_UNAVAILABLE']])(
    'keeps refusing a purchase already lost to stock (%s), signal flag on or off, without re-cancelling or claiming "not charged"', async (failureCode, code) => {
      for (const flag of [undefined, 'true']) {
        const { tx, db, service, process } = make('OUT_OF_STOCK', 0);
        tx.paymentAttempt.findFirst.mockResolvedValue({ ...submitted, state: 'CANCELED', cancelRequested: true, failureCode });
        if (flag) globalThis.process.env.PAYMENT_CONFIRMATION_SIGNAL = flag;
        try {
          const error = await service.confirmationStarted('u', ID).then(() => null, (reason: unknown) => reason);
          expect(error).toMatchObject({ statusCode: 409, code }); expect(String((error as Error).message)).not.toMatch(/not charged/i);
        } finally { delete globalThis.process.env.PAYMENT_CONFIRMATION_SIGNAL; }
        expect(tx.paymentAttempt.update).not.toHaveBeenCalled(); expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
        expect(db.paymentWork.updateMany).not.toHaveBeenCalled(); expect(process).not.toHaveBeenCalled();
      }
    });
  it('does not treat a non-stock cancellation as sold out', async () => {
    const { tx, service, process } = make('AVAILABLE', 3);
    tx.paymentAttempt.findFirst.mockResolvedValue({ ...submitted, cancelRequested: true, failureCode: 'CANCELED_BY_CUSTOMER' });
    await expect(service.confirmationStarted('u', ID)).resolves.toMatchObject({ attemptId: ID, confirmationStartedAt: null });
    expect(process).not.toHaveBeenCalled();
  });
});
