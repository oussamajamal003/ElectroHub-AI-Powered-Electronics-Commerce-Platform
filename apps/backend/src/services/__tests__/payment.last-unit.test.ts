/** PR #51 last-unit presentation and pre-authorization gate (pure rules; the real-PostgreSQL race is scenario Z). */
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../middleware/errorHandler.js';
import { authorizationReleased, customerOutcomeReason, customerPaymentStatus } from '../payment.domain.js';
import { assertStillPurchasable } from '../payment.service.js';

vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../stripe.provider.js', () => ({ stripeProvider: {} }));

const base = { orderId: null, submittedAt: new Date(), providerStatus: 'canceled' };

describe('stock outcome projection', () => {
  it.each(['CART_STOCK_CONFLICT', 'PRODUCT_UNAVAILABLE', 'INVENTORY_NOT_FOUND'])('%s on a cancelled, order-less purchase is a stock outcome', failureCode => {
    expect(customerOutcomeReason({ ...base, state: 'CANCELED', failureCode })).toBe('STOCK_UNAVAILABLE');
    expect(customerOutcomeReason({ ...base, state: 'CANCEL_PENDING', failureCode })).toBe('STOCK_UNAVAILABLE');
  });
  it('never applies to a paid, committed, declined, or otherwise failed purchase', () => {
    expect(customerOutcomeReason({ ...base, state: 'PAID', orderId: 'order', failureCode: null })).toBeNull();
    expect(customerOutcomeReason({ ...base, state: 'COMPENSATED', orderId: 'order', failureCode: 'CART_STOCK_CONFLICT' })).toBeNull();
    expect(customerOutcomeReason({ ...base, state: 'DECLINED', failureCode: 'PAYMENT_DECLINED' })).toBeNull();
    expect(customerOutcomeReason({ ...base, state: 'CANCELED', failureCode: 'PAYMENT_CAPTURE_REJECTED' })).toBeNull();
    expect(customerOutcomeReason({ ...base, state: 'CANCELED', failureCode: 'PAYMENT_EXPIRED' })).toBeNull();
  });
  it('claims the authorization was released only for a provider-verified CANCELED purchase', () => {
    expect(authorizationReleased({ state: 'CANCELED', orderId: null, providerStatus: 'canceled' })).toBe(true);
    expect(authorizationReleased({ state: 'CANCEL_PENDING', orderId: null, providerStatus: 'requires_capture' })).toBe(false);
    expect(authorizationReleased({ state: 'CANCELED', orderId: null, providerStatus: 'requires_capture' })).toBe(false);
    expect(authorizationReleased({ state: 'COMPENSATED', orderId: 'order', providerStatus: 'canceled' })).toBe(false);
  });
  it('keeps the existing classification contract (additive field only)', () => {
    expect(customerPaymentStatus({ ...base, state: 'CANCELED', failureCode: 'CART_STOCK_CONFLICT' })).toBe('FAILED');
    expect(customerPaymentStatus({ ...base, state: 'CANCEL_PENDING', failureCode: 'CART_STOCK_CONFLICT' })).toBe('PROCESSING');
  });
});

describe('submit stock gate (before card confirmation; never a reservation)', () => {
  const line = (availability: string, availableQuantity: number, quantity = 1) => ({ availability, availableQuantity, quantity, product: { name: 'Last Unit Phone' } });
  const refusal = (items: Parameters<typeof assertStillPurchasable>[0]) => {
    try { assertStillPurchasable(items); } catch (error) { return error as AppError; }
    return null;
  };
  it('passes purchasable lines', () => { expect(refusal([line('AVAILABLE', 1)])).toBeNull(); });
  it('refuses a sold-out line with the standard stock 409', () => {
    expect(refusal([line('AVAILABLE', 3), line('OUT_OF_STOCK', 0)])).toMatchObject({ statusCode: 409, code: 'CART_STOCK_CONFLICT',
      message: 'Last Unit Phone is out of stock. Nothing was charged.' });
  });
  it('refuses a short line and states the available quantity', () => {
    expect(refusal([line('LOW_STOCK', 1, 2)])).toMatchObject({ statusCode: 409, code: 'CART_STOCK_CONFLICT',
      message: 'Only 1 of Last Unit Phone is available (you requested 2). Nothing was charged.' });
  });
  it.each(['UNAVAILABLE', 'NOT_FOUND'])('refuses a withdrawn line (%s) as PRODUCT_UNAVAILABLE', availability => {
    expect(refusal([line(availability, 0)])).toMatchObject({ statusCode: 409, code: 'PRODUCT_UNAVAILABLE' });
  });
});
