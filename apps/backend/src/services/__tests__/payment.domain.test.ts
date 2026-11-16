import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { customerPaymentStatus, cents, operationKey, retryDelay, verifyAuthorization, verifyBinding, type Attempt, type ProviderIntent } from '../payment.domain.js';

const attempt = { id: 'attempt', stripeAccountId: 'acct_test', providerIntentId: 'pi_test', amountCents: 1999, currency: 'USD' } as Attempt;
const intent: ProviderIntent = { id: 'pi_test', account: 'acct_test', livemode: false, amount: 1999, currency: 'usd',
  captureMethod: 'manual', status: 'requires_capture', capturable: 1999, received: 0, methodType: 'card',
  clientSecret: null, attemptId: 'attempt', declined: false, card: null, captureBefore: new Date(Date.now() + 60_000) };

describe('Payment authority and exact money', () => {
  it.each([['0.50', 50], ['19.99', 1999], ['999999.99', 99999999]])('converts %s exactly', (value, expected) => {
    expect(cents(new Prisma.Decimal(value))).toBe(expected);
  });
  it.each(['0', '-1', '0.49', '1.001', '1000000'])('rejects unsupported money %s', value => {
    expect(() => cents(value)).toThrow(expect.objectContaining({ code: 'PAYMENT_AMOUNT_INVALID' }));
  });
  it('accepts only full unexpired card authorization', () => expect(() => verifyAuthorization(attempt, intent)).not.toThrow());
  it.each([
    { livemode: true }, { account: 'acct_other' }, { id: 'pi_other' }, { attemptId: 'other' }, { amount: 2000 },
    { currency: 'eur' }, { captureMethod: 'automatic' }, { methodType: 'sepa_debit' },
  ])('rejects a mismatched provider binding %j', change => {
    expect(() => verifyBinding(attempt, { ...intent, ...change })).toThrow(expect.objectContaining({ code: 'PAYMENT_AMOUNT_MISMATCH' }));
  });
  it.each([{ status: 'succeeded' }, { status: 'processing' }, { capturable: 1998 }, { received: 1 },
    { methodType: null }, { captureBefore: new Date(0) }])('rejects non-authorized state %j', change => {
    expect(() => verifyAuthorization(attempt, { ...intent, ...change })).toThrow(expect.objectContaining({ code: 'PAYMENT_PENDING' }));
  });
  it('uses distinct stable keys for every irreversible provider operation', () => {
    const keys = ['create', 'capture', 'cancel', 'refund'].map(operation => operationKey('a', operation as 'create' | 'capture' | 'cancel' | 'refund'));
    expect(new Set(keys).size).toBe(4); expect(operationKey('a', 'capture')).toBe(keys[1]);
  });
  it('bounds retry backoff without a hot retry loop', () => {
    expect(retryDelay(1)).toBe(2000); expect(retryDelay(12)).toBe(300000);
  });
});

it('keeps a stale decline unknown while provider recovery has failed', () => {
  expect(customerPaymentStatus({ ...attempt, state: 'DECLINED', orderId: null, submittedAt: new Date() }, { state: 'READY', lastError: 'PAYMENT_PROVIDER_UNKNOWN' })).toBe('UNKNOWN');
});
it('does not turn a verified decline into Processing during a periodic provider recheck', () => {
  expect(customerPaymentStatus({ ...attempt, state: 'DECLINED', orderId: null, submittedAt: new Date() }, { state: 'LEASED' })).toBe('DECLINED');
});
it('distinguishes authorization and order persistence from captured success', () => {
  expect(customerPaymentStatus({ ...attempt, state: 'AUTHORIZED', orderId: null, submittedAt: new Date() })).toBe('AUTHORIZED');
  expect(customerPaymentStatus({ ...attempt, state: 'CAPTURE_PENDING', orderId: 'order-a', submittedAt: new Date() })).toBe('ORDER_PROCESSING');
});

// Regression (Checkout saved -> Processing -> Checkout saved): a routine recovery lease is not a payment fact.
it('a work lease never flips a saved card entry or an unsubmitted checkout to Processing', () => {
  const lease = { state: 'LEASED' };
  expect(customerPaymentStatus({ ...attempt, state: 'AWAITING_INPUT', orderId: null, submittedAt: new Date() }, lease)).toBe('PROCESSING');
  expect(customerPaymentStatus({ ...attempt, state: 'AWAITING_INPUT', orderId: null, submittedAt: new Date() }, null)).toBe('PROCESSING');
  expect(customerPaymentStatus({ ...attempt, state: 'AWAITING_INPUT', orderId: null, submittedAt: null }, lease)).toBe('NOT_SUBMITTED');
  expect(customerPaymentStatus({ ...attempt, state: 'ACTION_REQUIRED', orderId: null, submittedAt: new Date() }, lease)).toBe('AWAITING_CUSTOMER_ACTION');
  // An announced confirmation and genuinely in-flight states stay Processing with or without a lease.
  expect(customerPaymentStatus({ ...attempt, state: 'AWAITING_INPUT', orderId: null, submittedAt: new Date(), confirmationStartedAt: new Date() }, lease)).toBe('PROCESSING');
  expect(customerPaymentStatus({ ...attempt, state: 'PROCESSING', orderId: null, submittedAt: new Date() }, lease)).toBe('PROCESSING');
});
