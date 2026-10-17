import { Prisma, type PaymentAttempt, type PaymentAttemptItem } from '@prisma/client';
import { AppError } from '../middleware/errorHandler.js';

export const PAYMENT_API_VERSION = '2026-09-30.endive' as const;
export const ATTEMPT_LIFETIME_MS = 30 * 60_000;
/** A submitted attempt still at card entry (nothing authorized) is abandoned this long after both its submission and its lifetime lapsed. */
export const SUBMITTED_ABANDON_GRACE_MS = 15 * 60_000;
export const WORK_LEASE_MS = 120_000;
export const MAX_PAYMENT_RETRIES = 12;
export const TERMINAL_PAYMENT_STATES = ['PAID', 'CANCELED', 'COMPENSATED', 'REFUNDED', 'INCIDENT'] as const;
export type Attempt = PaymentAttempt & { items: PaymentAttemptItem[] };
export interface ProviderIntent {
  id: string; account: string; livemode: boolean; amount: number; currency: string;
  captureMethod: string; status: string; capturable: number; received: number;
  methodType: string | null; clientSecret: string | null; attemptId: string | null;
  declined: boolean;
  card: { brand: string; last4: string } | null; captureBefore: Date | null;
}
export interface ProviderRefund { id: string; intentId: string; amount: number; status: string | null }
export interface PaymentProvider {
  account(): Promise<string>;
  create(attempt: Attempt): Promise<ProviderIntent>;
  retrieve(id: string): Promise<ProviderIntent>;
  capture(attempt: Attempt): Promise<ProviderIntent>;
  cancel(attempt: Attempt): Promise<ProviderIntent>;
  refund(attempt: Attempt, amount: number): Promise<ProviderRefund>;
  retrieveRefund(id: string): Promise<ProviderRefund>;
}
export function cents(value: string | Prisma.Decimal) {
  const amount = new Prisma.Decimal(value).mul(100);
  if (!amount.isInteger() || amount.lt(50) || amount.gt(99_999_999)) {
    throw new AppError('This order total is outside the supported card payment range.', 409, 'PAYMENT_AMOUNT_INVALID');
  }
  return amount.toNumber();
}
export function operationKey(attemptId: string, operation: 'create' | 'capture' | 'cancel' | 'refund') {
  return `electrohub:03.6:${attemptId}:${operation}`;
}
export function verifyBinding(attempt: Pick<Attempt, 'stripeAccountId' | 'providerIntentId' | 'id' | 'amountCents' | 'currency'>, intent: ProviderIntent) {
  if (intent.livemode || intent.account !== attempt.stripeAccountId || intent.id !== attempt.providerIntentId ||
    intent.attemptId !== attempt.id || intent.amount !== attempt.amountCents || intent.currency !== attempt.currency.toLowerCase() ||
    intent.captureMethod !== 'manual' || intent.methodType && intent.methodType !== 'card') {
    throw new AppError('Payment requires reconciliation before this order can proceed.', 409, 'PAYMENT_AMOUNT_MISMATCH');
  }
}
export function verifyAuthorization(attempt: Attempt, intent: ProviderIntent) {
  verifyBinding(attempt, intent);
  if (intent.status !== 'requires_capture' || intent.capturable !== attempt.amountCents || intent.received !== 0 ||
    intent.methodType !== 'card' || intent.captureBefore && intent.captureBefore.getTime() <= Date.now()) {
    throw new AppError('Payment authorization is not ready.', 409, 'PAYMENT_PENDING');
  }
}
export function retryDelay(retry: number) { return Math.min(5 * 60_000, 1_000 * 2 ** Math.min(retry, 9)); }

export type CustomerPaymentStatus = 'NOT_SUBMITTED' | 'AWAITING_CUSTOMER_ACTION' | 'PROCESSING' | 'AUTHORIZED' |
  'ORDER_PROCESSING' | 'SUCCEEDED' | 'DECLINED' | 'FAILED' | 'ABANDONED' | 'UNKNOWN';
/** Attempts the system itself ended (card entry expired, or superseded by a newer checkout): customer abandonment, never a failed card. */
/**
 * The client announces it is about to confirm with Stripe. Intent only: it is never proof Stripe received a confirmation and never a financial
 * status. A signal that Stripe still shows as unrecorded (requires_payment_method, not declined, no payment method attached, nothing received)
 * after this grace, confirmed by a fresh provider read taken after the grace, is cleared by recovery, which returns the purchase to
 * "Payment details needed" without inventing an outcome. A stale pre-confirmation snapshot alone never clears it.
 */
export const CONFIRMATION_SIGNAL_GRACE_MS = 2 * 60_000;
/**
 * The signal needs migration 20261016000000 (column "confirmationStartedAt"). Until a database has it, the column must never appear in a query:
 * the Prisma client omits it and the signal degrades to a no-op, so an unmigrated shared database keeps serving payments and purchases.
 * Enable (PAYMENT_CONFIRMATION_SIGNAL=true) only on databases where the migration is applied.
 */
export const confirmationSignalEnabled = (environment: NodeJS.ProcessEnv = process.env) => environment.PAYMENT_CONFIRMATION_SIGNAL === 'true';
/**
 * Without the signal (flag off / legacy schema) a submitted AWAITING_INPUT cannot be told apart from a card already being confirmed at Stripe.
 * For this window after submission it is reported as unresolved processing (read-only; recovery keeps reconciling provider truth),
 * and only afterwards falls back to "Payment details needed". No outcome is invented either way.
 */
export const SUBMITTED_UNRESOLVED_WINDOW_MS = 3 * 60_000;
/** Legacy (2026-10-17 only): a submitted purchase the client released or recovery cancelled before payment. No new rows get this code. */
export const INCOMPLETE_FAILURE_CODE = 'PAYMENT_INCOMPLETE';
/** The customer cancelled a verified never-confirmed purchase (Cancel purchase); its PaymentIntent was cancelled with nothing received. */
export const CANCELED_BY_CUSTOMER_FAILURE_CODE = 'PAYMENT_CANCELED_BY_CUSTOMER';
/**
 * Purchases that ended with NO provider decline and NO payment (system expiry, superseded setup, legacy release, customer cancellation of a
 * verified never-confirmed purchase). Documented presentation rule (Task 03.6): they are excluded from the customer's active payment lists
 * (never relabelled Payment failed, which requires provider evidence). Records are preserved; abandoned CART items stay restorable via
 * restore() where eligible.
 */
export const ABANDONMENT_FAILURE_CODES = ['PAYMENT_EXPIRED', 'PAYMENT_SETUP_SUPERSEDED', INCOMPLETE_FAILURE_CODE, CANCELED_BY_CUSTOMER_FAILURE_CODE] as const;
/**
 * Internal evidence only (the purchase stays AWAITING_INPUT, customer-facing Processing): recovery verified, after NEVER_CONFIRMED_GRACE_MS,
 * that card confirmation never reached Stripe (no confirmation announced; Stripe shows no decline, no payment method, nothing received or
 * authorized). It is NOT a payment failure. It enables the server-verified Cancel purchase exception; it is cleared automatically if Stripe
 * later records any confirmation (decline, processing, authorization).
 */
export const NOT_CONFIRMED_FAILURE_CODE = 'PAYMENT_NOT_CONFIRMED';
/**
 * A submitted purchase with no confirmation announced this long after submission, while Stripe records nothing for its intent, never had its
 * card confirmed: the client announces (durably) before Stripe.js is ever asked to confirm. Sized well beyond observed DEV submit latency
 * (8.5-37 s). Applies only where the confirmation signal is enabled, because only there is "no marker" evidence.
 */
export const NEVER_CONFIRMED_GRACE_MS = 10 * 60_000;
/** A failed provider read cannot turn stale card-entry/decline facts into a final outcome. */
export function customerPaymentStatus(attempt: Pick<Attempt, 'state' | 'submittedAt' | 'orderId'> & { failureCode?: string | null; confirmationStartedAt?: Date | null },
  work?: { state: string; lastError?: string | null } | null): CustomerPaymentStatus {
  if (attempt.state === 'PAID') return 'SUCCEEDED';
  if (attempt.state === 'CANCELED' && !attempt.orderId && (ABANDONMENT_FAILURE_CODES as readonly string[]).includes(attempt.failureCode ?? '')) return 'ABANDONED';
  if (['CANCELED', 'COMPENSATED', 'REFUNDED'].includes(attempt.state)) return 'FAILED';
  if (attempt.state === 'INCIDENT' || work?.lastError) return 'UNKNOWN';
  if (attempt.state === 'CAPTURE_PENDING' || attempt.orderId) return 'ORDER_PROCESSING';
  if (attempt.state === 'AUTHORIZED') return 'AUTHORIZED';
  if (attempt.state === 'DECLINED') return 'DECLINED';
  // A work lease is a routine recovery read (worker, webhook or poll-driven), not a payment fact: it never promotes a saved card entry
  // to Processing, otherwise every reconciliation pass flips "Checkout saved" to "Processing" and back.
  if (attempt.state === 'ACTION_REQUIRED') return 'AWAITING_CUSTOMER_ACTION';
  // Product decision (Task 03.6): once Place Order is accepted the purchase is never shown as a saved card entry again. A submitted purchase
  // still at card entry is Processing (checked by recovery) until Stripe resolves it or the abandonment policy ends it. Whether confirmation
  // actually reached Stripe stays internal (confirmationStartedAt) and only changes the copy, never the outcome.
  if (attempt.state === 'AWAITING_INPUT') return attempt.submittedAt ? 'PROCESSING' : 'NOT_SUBMITTED';
  if (attempt.state === 'PREPARING' && !attempt.submittedAt) return 'NOT_SUBMITTED';
  return 'PROCESSING';
}
