import type { PaymentOutcome, SubmissionAttempt } from './types';

export function matchesPaymentAttempt(attempt: SubmissionAttempt, outcome: PaymentOutcome) {
  return (!attempt.paymentAttemptId || outcome.attemptId === attempt.paymentAttemptId) &&
    (outcome.cartRevision === undefined || outcome.cartRevision === attempt.request.expectedRevision) &&
    (!attempt.cartIdentity || outcome.cartIdentity === undefined || outcome.cartIdentity === attempt.cartIdentity) &&
    (!attempt.intentId || outcome.intentId === undefined || outcome.intentId === attempt.intentId);
}

// A provider redirect or an order reference alone is not proof of capture.
export function hasVerifiedPayment(outcome: PaymentOutcome) {
  return outcome.state === 'PAID' && outcome.committed && outcome.confirmation?.paymentState === 'PAID' &&
    (!outcome.orderReference || outcome.orderReference === outcome.confirmation.orderReference);
}

export function isResolvedPayment(outcome: PaymentOutcome) {
  if (outcome.classification === 'UNKNOWN' || outcome.classification === 'PROCESSING' || outcome.classification === 'ORDER_PROCESSING') return false;
  return hasVerifiedPayment(outcome) || (!outcome.recoveryActive &&
    ['DECLINED', 'ACTION_REQUIRED', 'CANCELED', 'COMPENSATED', 'REFUNDED'].includes(outcome.state));
}

/** Eligibility to ask /resume is distinct from proof of a failed financial outcome. */
export function canResumePaymentEntry(outcome: PaymentOutcome) {
  return !outcome.recoveryActive && outcome.retryAllowed !== false &&
    !['UNKNOWN', 'PROCESSING', 'ORDER_PROCESSING', 'SUCCEEDED'].includes(outcome.classification ?? '') &&
    ['DECLINED', 'AWAITING_INPUT', 'ACTION_REQUIRED'].includes(outcome.state);
}

// Preserve the existing bounded Checkout observation window. Continued durable
// recovery is visible outside Checkout rather than stopping reads in a loader.
export const CHECKOUT_RECOVERY_WINDOW_MS = 120_000;
