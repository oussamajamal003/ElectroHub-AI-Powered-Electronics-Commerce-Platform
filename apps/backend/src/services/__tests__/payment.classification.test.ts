import { describe, expect, it } from 'vitest';
import { customerPaymentStatus } from '../payment.domain.js';

const attempt = (patch: Record<string, unknown>) => ({ state: 'AWAITING_INPUT' as const, submittedAt: new Date(), orderId: null, failureCode: null, ...patch }) as Parameters<typeof customerPaymentStatus>[0];

describe('Abandonment, card decline and unknown outcomes are never mixed', () => {
  it('classifies a system-ended card-entry attempt as ABANDONED, never FAILED or DECLINED', () => {
    expect(customerPaymentStatus(attempt({ state: 'CANCELED', failureCode: 'PAYMENT_EXPIRED', submittedAt: null }))).toBe('ABANDONED');
    expect(customerPaymentStatus(attempt({ state: 'CANCELED', failureCode: 'PAYMENT_SETUP_SUPERSEDED' }))).toBe('ABANDONED');
  });
  // Task 03.6 final rule: Payment failed requires provider evidence. Purchases that ended with no payment and no decline are excluded from active
  // lists (ABANDONED); a verified never-confirmed purchase stays Processing (with the server-verified Cancel purchase).
  it('never relabels a purchase that ended without payment or decline evidence as Payment failed', () => {
    for (const failureCode of ['PAYMENT_EXPIRED', 'PAYMENT_INCOMPLETE', 'PAYMENT_CANCELED_BY_CUSTOMER', 'PAYMENT_SETUP_SUPERSEDED']) {
      expect(customerPaymentStatus(attempt({ state: 'CANCELED', failureCode }))).toBe('ABANDONED');
    }
    expect(customerPaymentStatus(attempt({ state: 'AWAITING_INPUT', failureCode: 'PAYMENT_NOT_CONFIRMED' }))).toBe('PROCESSING');
    expect(customerPaymentStatus(attempt({ state: 'DECLINED', failureCode: 'PAYMENT_DECLINED' }))).toBe('DECLINED');
  });
  it('keeps genuine failures as failures', () => {
    expect(customerPaymentStatus(attempt({ state: 'DECLINED', failureCode: 'PAYMENT_DECLINED' }))).toBe('DECLINED');
    expect(customerPaymentStatus(attempt({ state: 'CANCELED', failureCode: 'PAYMENT_DECLINED' }))).toBe('FAILED');
    expect(customerPaymentStatus(attempt({ state: 'COMPENSATED', orderId: 'order' }))).toBe('FAILED');
    expect(customerPaymentStatus(attempt({ state: 'CANCELED', failureCode: 'PAYMENT_EXPIRED', orderId: 'order' }))).toBe('FAILED'); // an order existed: not mere abandonment
  });
  it('keeps unknown and in-flight outcomes unknown or pending, and success as success', () => {
    expect(customerPaymentStatus(attempt({ state: 'INCIDENT' }))).toBe('UNKNOWN');
    expect(customerPaymentStatus(attempt({ state: 'AWAITING_INPUT' }))).toBe('PROCESSING'); // submitted: checked, never "Checkout saved"
    expect(customerPaymentStatus(attempt({ state: 'PAID', orderId: 'order' }))).toBe('SUCCEEDED');
  });
});
