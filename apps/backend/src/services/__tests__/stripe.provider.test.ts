import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { StripeProvider } from '../stripe.provider.js';
import { operationKey, type Attempt } from '../payment.domain.js';
const vars = vi.hoisted(() => ({ key: 'sk_test_disposable_unit' }));
vi.mock('../../config/env.js', () => ({ env: { get STRIPE_SECRET_KEY() { return vars.key; } } }));
const attempt = { id: 'attempt', amountCents: 1999, providerIntentId: 'pi_test' } as Attempt;
const result: Stripe.Response<Stripe.PaymentIntent> = { id: 'pi_test', object: 'payment_intent', livemode: false, amount: 1999, currency: 'usd', capture_method: 'manual', status: 'succeeded',
  amount_capturable: 0, amount_received: 1999, payment_method: null, latest_charge: null, metadata: { attemptId: 'attempt' },
  client_secret: null, last_payment_error: null, allowed_payment_method_types: ['card'], payment_method_types: ['card'],
  application: null, application_fee_amount: null, automatic_payment_methods: null, canceled_at: null, cancellation_reason: null,
  confirmation_method: 'automatic', created: 1, customer: null, customer_account: null, description: null,
  excluded_payment_method_types: null, managed_payments: null, next_action: null, on_behalf_of: null,
  payment_method_configuration_details: null, payment_method_options: null, payment_record: null, processing: null,
  receipt_email: null, review: null, setup_future_usage: null, shipping: null, source: null, statement_descriptor: null,
  statement_descriptor_suffix: null, transfer_data: null, transfer_group: null,
  lastResponse: { headers: {}, requestId: 'req_unit', statusCode: 200, apiVersion: '2026-09-30.endive', idempotencyKey: 'unit' } };
beforeEach(() => { vi.restoreAllMocks(); vars.key = 'sk_test_disposable_unit'; });
describe('Official SDK provider boundary (SDK calls mocked)', () => {
  it('refuses live keys without opening a provider client', () => {
    vars.key = 'sk_live_never_use'; expect(() => new StripeProvider().sdk()).toThrow(expect.objectContaining({ code: 'PAYMENT_CONFIGURATION_UNAVAILABLE' }));
  });
  it('creates only server-cent USD manual card allowlist with a stable operation key', async () => {
    const provider = new StripeProvider(); vi.spyOn(provider, 'account').mockResolvedValue('acct_test');
    const create = vi.spyOn(provider.sdk().paymentIntents, 'create').mockResolvedValue(result);
    await provider.create(attempt);
    expect(create).toHaveBeenCalledWith({ amount: 1999, currency: 'usd', capture_method: 'manual', allowed_payment_method_types: ['card'],
      metadata: { attemptId: 'attempt' }, expand: ['payment_method', 'latest_charge'] }, { idempotencyKey: operationKey('attempt', 'create') });
  });
  it('uses supported single capture without the multi-capture-only final_capture parameter', async () => {
    const provider = new StripeProvider(); vi.spyOn(provider, 'account').mockResolvedValue('acct_test');
    const capture = vi.spyOn(provider.sdk().paymentIntents, 'capture').mockResolvedValue(result);
    await provider.capture(attempt);
    expect(capture).toHaveBeenCalledWith('pi_test', { amount_to_capture: 1999, expand: ['payment_method', 'latest_charge'] },
      { idempotencyKey: operationKey('attempt', 'capture') });
  });
  it('maps only a confirmed card rejection to definitive capture rejection', async () => {
    const provider = new StripeProvider();
    vi.spyOn(provider.sdk().paymentIntents, 'capture').mockRejectedValue(new Stripe.errors.StripeCardError({ message: 'synthetic rejection' }));
    await expect(provider.capture(attempt)).rejects.toMatchObject({ code: 'PAYMENT_CAPTURE_REJECTED' });
  });
  it('keeps a connection error unknown instead of claiming a decline', async () => {
    const provider = new StripeProvider(); const failure = new Stripe.errors.StripeConnectionError({ message: 'synthetic network failure' });
    vi.spyOn(provider.sdk().paymentIntents, 'capture').mockRejectedValue(failure);
    await expect(provider.capture(attempt)).rejects.toBe(failure);
  });
});
