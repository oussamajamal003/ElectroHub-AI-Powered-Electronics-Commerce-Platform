import Stripe from 'stripe';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { logSafely } from '../utils/logger.js';
import { paymentIsolation } from '../payment-isolation.js';
import { PAYMENT_API_VERSION, operationKey, type Attempt, type PaymentProvider, type ProviderIntent } from './payment.domain.js';

/** Payment isolation boundary: no provider mutation from a process that may not mutate its payment target. */
function assertProviderMutationAllowed() {
  if (!paymentIsolation().allowed) throw new AppError('Payments are unavailable in this environment.', 503, 'PAYMENT_MUTATIONS_DISABLED');
}

/** Only this boundary talks to Stripe. Never call it while holding a DB transaction. */
export class StripeProvider implements PaymentProvider {
  private client: Stripe | null = null;
  private accountPromise: Promise<string> | null = null;
  sdk(): Stripe {
    if (!env.STRIPE_SECRET_KEY || !/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)) {
      throw new AppError('Test card payments are unavailable. Please try again later.', 503, 'PAYMENT_CONFIGURATION_UNAVAILABLE');
    }
    if (!this.client) {
      this.client = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: PAYMENT_API_VERSION, timeout: 10_000, maxNetworkRetries: 0 });
      this.client.on('request', (event: Stripe.RequestEvent) => logSafely('info', 'Stripe request started', {
        operation: 'stripe.request', method: event.method,
      }));
      this.client.on('response', (event: Stripe.ResponseEvent) => {
        const level = event.status >= 400 ? 'error' : 'info';
        logSafely(level, 'Stripe request completed', { operation: 'stripe.response', statusCode: event.status,
          durationMs: event.elapsed, providerRequestId: event.request_id,
          code: event.status >= 400 ? `STRIPE_HTTP_${event.status}` : undefined });
      });
    }
    return this.client;
  }
  account() {
    return this.accountPromise ??= this.sdk().accounts.retrieveCurrent().then(account => account.id).catch((error: unknown) => {
      logSafely('error', 'Stripe account lookup failed', { operation: 'stripe.account.failed', error });
      this.accountPromise = null;
      throw new AppError('Payment provider is temporarily unavailable.', 503, 'PAYMENT_UNAVAILABLE');
    });
  }
  private async project(intent: Stripe.PaymentIntent): Promise<ProviderIntent> {
    const method = typeof intent.payment_method === 'object' ? intent.payment_method : null;
    const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
    const card = charge?.payment_method_details?.card ?? (method?.type === 'card' ? method.card : null);
    const authorization = charge?.payment_method_details?.card;
    return { id: intent.id, account: await this.account(), livemode: intent.livemode, amount: intent.amount, currency: intent.currency,
      captureMethod: intent.capture_method, status: intent.status, capturable: intent.amount_capturable, received: intent.amount_received,
      methodType: method?.type ?? null, clientSecret: intent.client_secret, attemptId: intent.metadata.attemptId ?? null,
      declined: intent.status === 'requires_payment_method' && Boolean(intent.last_payment_error),
      card: card?.brand && card.last4 ? { brand: card.brand, last4: card.last4 } : null,
      captureBefore: authorization?.capture_before ? new Date(authorization.capture_before * 1000) : null };
  }
  async create(attempt: Attempt) {
    assertProviderMutationAllowed();
    return this.project(await this.sdk().paymentIntents.create({ amount: attempt.amountCents, currency: 'usd', capture_method: 'manual',
      allowed_payment_method_types: ['card'], metadata: { attemptId: attempt.id },
      expand: ['payment_method', 'latest_charge'] }, { idempotencyKey: operationKey(attempt.id, 'create') }));
  }
  async retrieve(id: string) {
    return this.project(await this.sdk().paymentIntents.retrieve(id, { expand: ['payment_method', 'latest_charge'] }));
  }
  async capture(attempt: Attempt) {
    assertProviderMutationAllowed();
    if (!attempt.providerIntentId) throw new AppError('Payment is pending.', 409, 'PAYMENT_PENDING');
    try {
      return this.project(await this.sdk().paymentIntents.capture(attempt.providerIntentId, { amount_to_capture: attempt.amountCents,
        expand: ['payment_method', 'latest_charge'] }, { idempotencyKey: operationKey(attempt.id, 'capture') }));
    } catch (error) {
      logSafely('error', 'Stripe capture failed', { operation: 'stripe.capture.failed', error });
      // A transport/5xx failure remains unknown. Only a provider-confirmed card rejection permits cancellation.
      if (error instanceof Stripe.errors.StripeCardError) throw new AppError('Card capture was rejected.', 409, 'PAYMENT_CAPTURE_REJECTED');
      throw error;
    }
  }
  async cancel(attempt: Attempt) {
    assertProviderMutationAllowed();
    if (!attempt.providerIntentId) throw new AppError('Payment is pending.', 409, 'PAYMENT_PENDING');
    return this.project(await this.sdk().paymentIntents.cancel(attempt.providerIntentId, {}, { idempotencyKey: operationKey(attempt.id, 'cancel') }));
  }
  async refund(attempt: Attempt, amount: number) {
    assertProviderMutationAllowed();
    if (!attempt.providerIntentId) throw new AppError('Payment requires recovery.', 409, 'PAYMENT_RECOVERY_PENDING');
    const refund = await this.sdk().refunds.create({ payment_intent: attempt.providerIntentId, amount,
      metadata: { attemptId: attempt.id } }, { idempotencyKey: operationKey(attempt.id, 'refund') });
    return { id: refund.id, intentId: String(refund.payment_intent), amount: refund.amount, status: refund.status };
  }
  async retrieveRefund(id: string) {
    const refund = await this.sdk().refunds.retrieve(id);
    return { id: refund.id, intentId: String(refund.payment_intent), amount: refund.amount, status: refund.status };
  }
}

export const stripeProvider = new StripeProvider();
