import { randomUUID } from 'node:crypto';
import { logContext } from '../utils/logContext.js';
import { Prisma, PrismaClient, type PaymentAttemptState } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { buyNowProjection, purchaseItemsProjection, currentCart, MAX_CART_LINES, MAX_CART_QUANTITY } from './cart.service.js';
import { lockCart, lockCartForUser } from './cart.lock.js';
import { checkoutRequestSchema, attemptSchema, buyNowScopeId, checkoutTotals, deliveryMethods, isBuyNowRequest, requestHash, savedAmountsMatch, savedPurchaseTerms } from './checkout.domain.js';
import { InventoryService } from './inventory.service.js';
import { OrderService } from './order.service.js';
import { stripeProvider } from './stripe.provider.js';
import { ATTEMPT_LIFETIME_MS, SUBMITTED_ABANDON_GRACE_MS, WORK_LEASE_MS, MAX_PAYMENT_RETRIES, TERMINAL_PAYMENT_STATES,
  cents, retryDelay, customerPaymentStatus, ABANDONMENT_FAILURE_CODES, NOT_CONFIRMED_FAILURE_CODE, CANCELED_BY_CUSTOMER_FAILURE_CODE, NEVER_CONFIRMED_GRACE_MS, CONFIRMATION_SIGNAL_GRACE_MS, SUBMITTED_UNRESOLVED_WINDOW_MS, confirmationSignalEnabled, verifyBinding, type Attempt, type PaymentProvider, type ProviderIntent } from './payment.domain.js';
import { isSerializationConflict } from './transaction-conflict.js';
import { redactDeliveryForDeletedOwner } from './delivery-privacy.js';
import { enqueueCancellation, enqueuePaymentSucceeded, logCreatedEvents } from './commerce-email.producer.js';
import { logSafely } from '../utils/logger.js';
import { paymentIsolation, type PaymentIsolationDecision } from '../payment-isolation.js';
import { performance } from 'node:perf_hooks';
import { PaymentSetupTiming, PAYMENT_SETUP_TRANSACTION_MAX_WAIT_MS, PAYMENT_SETUP_TRANSACTION_TIMEOUT_MS,
  PAYMENT_TRANSACTION_MAX_WAIT_MS, PAYMENT_TRANSACTION_TIMEOUT_MS, paymentOperation, paymentTransactionEntered } from './payment.setup-timing.js';

const attemptInclude = { items: { orderBy: { productId: 'asc' as const } } } satisfies Prisma.PaymentAttemptInclude;
// Status projection uses scalar purchase facts and work state, never line items.
// Loading those items adds a hosted-DB round trip to every Checkout poll.
const statusInclude = { work: true } satisfies Prisma.PaymentAttemptInclude;
type StatusAttempt = Prisma.PaymentAttemptGetPayload<{ include: typeof statusInclude }>;
const terminal = (state: string) => (TERMINAL_PAYMENT_STATES as readonly string[]).includes(state);
// DECLINED is a definitive result of the last confirmation, but the same Intent
// remains retryable. A lost webhook after a later confirmation must not strand
// its DONE row forever. Only provider retrieval (never confirmation) is retried.
const duePaymentWork = (now: Date): Prisma.PaymentWorkWhereInput => ({ OR: [
  { state: 'READY', nextRunAt: { lte: now } },
  { state: 'LEASED', leaseUntil: { lt: now } },
  { state: 'DONE', nextRunAt: { lte: now }, attempt: { state: 'DECLINED', submittedAt: { not: null }, providerIntentId: { not: null } } },
] });
const awaitingCardEntry = (attempt: Pick<Attempt, 'state' | 'orderId' | 'cancelRequested' | 'failureCode' | 'providerIntentId' | 'expiresAt'>) =>
  attempt.state === 'AWAITING_INPUT' && !attempt.orderId && !attempt.cancelRequested && !attempt.failureCode &&
  Boolean(attempt.providerIntentId) && attempt.expiresAt.getTime() > Date.now();
// Setup lifetime limits card entry, not a provider authorization or asynchronous recovery.
const expiryCancellation = (attempt: Pick<Attempt, 'cancelRequested' | 'failureCode'>) =>
  attempt.cancelRequested && attempt.failureCode === 'PAYMENT_EXPIRED';
const explicitCancellation = (attempt: Pick<Attempt, 'cancelRequested' | 'failureCode'>) =>
  attempt.cancelRequested && !expiryCancellation(attempt);
const expiredCardEntry = (attempt: Pick<Attempt, 'state' | 'orderId' | 'expiresAt' | 'cancelRequested' | 'failureCode' | 'submittedAt'>, intent: ProviderIntent) =>
  !attempt.submittedAt && !attempt.orderId && attempt.expiresAt.getTime() <= Date.now() &&
  (['PREPARING', 'AWAITING_INPUT', 'ACTION_REQUIRED', 'DECLINED'].includes(attempt.state) ||
    attempt.state === 'CANCEL_PENDING' && expiryCancellation(attempt)) &&
  ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status);
/**
 * A customer who clicked Place Order but never completed card confirmation (or abandoned 3DS) leaves the attempt at AWAITING_INPUT/ACTION_REQUIRED with a
 * submission stamp, which `expiredCardEntry` deliberately skips. Without this it would sit in Processing forever. It lapses only
 * when Stripe itself still reports no payment method, nothing received and nothing authorized, long after both lifetimes ended,
 * so a confirmation that is actually in flight (processing, requires_action, requires_capture, succeeded) is never cancelled.
 */
const abandonedSubmission = (attempt: Pick<Attempt, 'state' | 'orderId' | 'expiresAt' | 'cancelRequested' | 'failureCode' | 'submittedAt' | 'confirmationStartedAt'>, intent: ProviderIntent) =>
  Boolean(attempt.submittedAt) && (!attempt.confirmationStartedAt || attempt.confirmationStartedAt.getTime() + CONFIRMATION_SIGNAL_GRACE_MS <= Date.now()) && ['AWAITING_INPUT', 'ACTION_REQUIRED'].includes(attempt.state) && !attempt.orderId && !attempt.cancelRequested && !attempt.failureCode &&
  attempt.expiresAt.getTime() + SUBMITTED_ABANDON_GRACE_MS <= Date.now() && attempt.submittedAt!.getTime() + SUBMITTED_ABANDON_GRACE_MS <= Date.now() &&
  ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status) && intent.received === 0 && intent.capturable === 0 &&
  // A confirmed card that Stripe declined is a failed payment, never an abandoned or incomplete purchase.
  !intent.declined;
/** Stripe recorded nothing for this intent: no decline, no attached payment method, nothing received or authorized. */
const unrecordedConfirmation = (intent: ProviderIntent) => intent.status === 'requires_payment_method' && !intent.declined &&
  !intent.methodType && intent.received === 0 && intent.capturable === 0;
/**
 * Verified never-confirmed submission (Task 03.6 MacBook/Buds2/iPad incidents): Place Order was accepted but no confirmation was announced, and
 * Stripe records nothing for the intent. Recorded as internal evidence (NOT_CONFIRMED) only: the purchase stays Processing and becomes
 * eligible for the server-verified Cancel purchase. Nothing is cancelled or failed automatically. Decided again on the locked row.
 */
const neverConfirmedSubmission = (attempt: Pick<Attempt, 'state' | 'orderId' | 'cancelRequested' | 'failureCode' | 'submittedAt' | 'confirmationStartedAt'>, intent: ProviderIntent) =>
  confirmationSignalEnabled() && attempt.state === 'AWAITING_INPUT' && Boolean(attempt.submittedAt) && !attempt.confirmationStartedAt &&
  !attempt.orderId && !attempt.cancelRequested && !attempt.failureCode && attempt.submittedAt!.getTime() + NEVER_CONFIRMED_GRACE_MS <= Date.now() &&
  unrecordedConfirmation(intent);
const lapsedWithoutPayment = (attempt: Pick<Attempt, 'state' | 'orderId' | 'expiresAt' | 'cancelRequested' | 'failureCode' | 'submittedAt' | 'confirmationStartedAt'>, intent: ProviderIntent) =>
  expiredCardEntry(attempt, intent) || abandonedSubmission(attempt, intent);
/** A verified NOT_CONFIRMED purchase while Stripe still records nothing: unchanged (Processing, cancellable). */
const notConfirmedStillUnrecorded = (attempt: Pick<Attempt, 'state' | 'failureCode' | 'orderId'>, intent: ProviderIntent) =>
  attempt.state === 'AWAITING_INPUT' && attempt.failureCode === NOT_CONFIRMED_FAILURE_CODE && !attempt.orderId && unrecordedConfirmation(intent);
/**
 * Server-side eligibility for Cancel purchase (never inferred on the client): a submitted purchase that recovery has VERIFIED never reached
 * Stripe, with no confirmation announced, no order and no cancellation already requested. cancel() re-verifies against a fresh provider read.
 */
const cancelEligible = (attempt: Pick<Attempt, 'state' | 'submittedAt' | 'orderId' | 'cancelRequested' | 'failureCode' | 'confirmationStartedAt'>) =>
  attempt.state === 'AWAITING_INPUT' && Boolean(attempt.submittedAt) && !attempt.orderId && !attempt.cancelRequested &&
  attempt.failureCode === NOT_CONFIRMED_FAILURE_CODE && !attempt.confirmationStartedAt;
/** A customer cancellation request; provider truth (decline, authorization, capture) always takes precedence over it. */
const customerCancellation = (attempt: Pick<Attempt, 'cancelRequested' | 'failureCode'>) =>
  attempt.cancelRequested && attempt.failureCode === CANCELED_BY_CUSTOMER_FAILURE_CODE;

/**
 * The recovery worker leases an attempt's work row for every routine card-entry check (about every 10 s, for about a second).
 * A customer pressing Place Order during that lease is not a recovery conflict, so submit waits briefly for the lease to clear.
 */
export const SUBMIT_LEASE_WAIT_MS = 5_000;
/**
 * The browser confirms with Stripe independently of the worker, so a worker read can land just BEFORE a decline and persist the pre-decline
 * AWAITING_INPUT. Right after submission such a state is re-read quickly (not after the routine 10 s) so an authoritative decline reaches the
 * customer promptly; the persisted value is never treated as the outcome.
 */
export const SUBMITTED_RECHECK_MS = 2_000;
const SUBMITTED_RECHECK_WINDOW_MS = SUBMITTED_UNRESOLVED_WINDOW_MS;
const submittedAwaitingProvider = (attempt: Pick<Attempt, 'state' | 'submittedAt'>) =>
  attempt.state === 'AWAITING_INPUT' && Boolean(attempt.submittedAt) && Date.now() - attempt.submittedAt!.getTime() < SUBMITTED_RECHECK_WINDOW_MS;
/**
 * A submitted purchase past the recheck window with no confirmation announced is a saved checkout waiting for the customer, not a payment in
 * flight. Rechecking it every 10 s kept its work row leased much of the time (DEV 2026-10-17: lease p50 4.3 s, p90 10.6 s), which blocked
 * Payment recovery reads. A 60 s cadence still detects lapse; a customer confirmation is followed by an explicit reconcile that wakes the work.
 */
const idleSavedCheckout = (attempt: Pick<Attempt, 'state' | 'submittedAt' | 'orderId' | 'cancelRequested'> & { confirmationStartedAt?: Date | null }) =>
  attempt.state === 'AWAITING_INPUT' && Boolean(attempt.submittedAt) && !attempt.confirmationStartedAt && !attempt.orderId && !attempt.cancelRequested &&
  Date.now() - attempt.submittedAt!.getTime() >= SUBMITTED_RECHECK_WINDOW_MS;
/** Resume waits out a recovery pass; sized from observed DEV lease durations (p90 10.6 s) and kept inside the client's 25 s resume deadline. */
export const RESUME_LEASE_WAIT_MS = 12_000;
const SUBMIT_LEASE_POLL_MS = 250;
/** A list read reconciles a purchase only when its due work is this overdue, i.e. the durable runner is not keeping up. */
export const POLL_RECONCILE_OVERDUE_MS = 30_000;
class SubmitWorkLeased extends Error {}
export class PaymentSetupBlockedError extends AppError {
  constructor(public readonly recovery: { attemptId: string; state: string; workState: string | null;
    workId?: string | null; lease: 'active' | 'expired' | 'missing' | 'none' }, public readonly canReconcile = false) {
    super('An existing payment is unresolved. Checking its status before starting another payment.', 409, 'PAYMENT_RECOVERY_PENDING');
    Object.setPrototypeOf(this, PaymentSetupBlockedError.prototype);
  }
}
const setupBlocker = (attempt: Pick<Attempt, 'id' | 'state' | 'orderId' | 'providerIntentId'>, work?: { id?: string; state: string; leaseUntil: Date | null }) => {
  const lease = work?.state === 'LEASED' ? !work.leaseUntil ? 'missing' :
    new Date(work.leaseUntil).getTime() > Date.now() ? 'active' : 'expired' : 'none';
  return new PaymentSetupBlockedError({ attemptId: attempt.id, state: attempt.state, workId: work?.id ?? null, workState: work?.state ?? null, lease },
    Boolean(work && (['READY', 'DONE'].includes(work.state) || lease === 'expired') && !attempt.orderId &&
      attempt.providerIntentId && (attempt.state === 'CANCEL_PENDING' || ['AWAITING_INPUT', 'DECLINED'].includes(attempt.state))));
};

/**
 * A saved purchase may only be retried on the terms it was priced with: the current revision (DELIVERY_VERSION,
 * delivery terms, scope, line prices), the saved delivery method, shipping fee, total and authorized cents must all
 * still match. Never re-prices: a mismatch is the existing 409 CHECKOUT_CHANGED. No I/O, no writes.
 */
function assertSavedTermsCurrent(userId: string,
  saved: Pick<Attempt, 'request' | 'cartId' | 'total' | 'shippingCost' | 'amountCents'>,
  items: readonly { productId: string; quantity: number; unitPrice: Prisma.Decimal }[]) {
  const request = checkoutRequestSchema.safeParse(saved.request);
  const scopeId = request.success ? (request.data.scope === 'BUY_NOW' ? buyNowScopeId(userId) : saved.cartId) : null;
  const terms = request.success && scopeId ? savedPurchaseTerms({ scopeId, expectedRevision: request.data.expectedRevision,
    deliveryMethod: request.data.deliveryMethod, lines: items.map(item => ({ productId: item.productId, quantity: item.quantity, price: item.unitPrice })) }) : null;
  if (!terms?.revisionMatches || !terms.totals || !savedAmountsMatch(terms.totals, saved) || cents(terms.totals.total) !== saved.amountCents) {
    throw new AppError('Saved purchase delivery terms or pricing changed. Nothing was charged.', 409, 'CHECKOUT_CHANGED');
  }
}

/** /submit response: the accepted purchase's identity (all the client needs to hand off to Stripe confirmation). */
type SubmitIdentity = { attemptId: string; checkoutId: string; cartIdentity: string; cartRevision: string; intentId: string | null;
  state: PaymentAttemptState; classification: 'PROCESSING'; scope: 'BUY_NOW' | 'CART_CHECKOUT'; submittedAt: string; committed: boolean;
  recoveryActive: boolean };
export type PaymentWorkScope = readonly string[] | { readonly createdSince: Date };
/** PaymentWork filter for a worker scope. A governed boundary selects by the attempt's immutable creation time. */
export function paymentWorkScopeWhere(scope?: PaymentWorkScope): Prisma.PaymentWorkWhereInput {
  if (!scope) return {};
  if (Array.isArray(scope)) return { attemptId: { in: [...scope] } };
  return { attempt: { createdAt: { gte: (scope as { createdSince: Date }).createdSince } } };
}

export class PaymentService {
  constructor(private readonly database: PrismaClient = prisma, private readonly provider: PaymentProvider = stripeProvider,
    private readonly inventory = new InventoryService(), private readonly isolation: () => PaymentIsolationDecision = paymentIsolation) {}

  /** Payment isolation boundary (see payment-isolation.ts): every payment write fails closed unless this process may mutate its target. */
  private assertMutationsAllowed() {
    const decision = this.isolation();
    if (!decision.allowed) throw new AppError('Payments are unavailable in this environment.', 503, 'PAYMENT_MUTATIONS_DISABLED');
  }
  private mutationsAllowed() { return this.isolation().allowed; }

  private async owned(userId: string, id: string) {
    const attempt = await this.database.paymentAttempt.findFirst({ where: { id: attemptSchema.parse(id), userId }, include: attemptInclude });
    if (!attempt) throw new AppError('Payment attempt not found.', 404, 'PAYMENT_ATTEMPT_NOT_FOUND');
    return attempt;
  }
  private async ownedStatus(userId: string, id: string): Promise<StatusAttempt> {
    const attempt = await this.database.paymentAttempt.findFirst({ where: { id: attemptSchema.parse(id), userId }, include: statusInclude });
    if (!attempt) throw new AppError('Payment attempt not found.', 404, 'PAYMENT_ATTEMPT_NOT_FOUND');
    return attempt;
  }
  private async projectStatus(userId: string, attempt: StatusAttempt, recoveryActive = false) {
    const [cart, confirmation] = await Promise.all([
      paymentOperation('cart_projection', 'database', () => currentCart(userId, this.database)).then(value => value.data),
      attempt.orderId ? new OrderService(this.database).getConfirmation(userId, attempt.orderId) : Promise.resolve(null),
    ]);
    const classification = customerPaymentStatus(attempt, attempt.work);
    return { classification, checkoutId: attempt.id, scope: attempt.request && typeof attempt.request === 'object' && !Array.isArray(attempt.request) && attempt.request.scope === 'BUY_NOW' ? 'BUY_NOW' : 'CART_CHECKOUT',
      submittedAt: attempt.submittedAt?.toISOString() ?? null, confirmationStartedAt: attempt.confirmationStartedAt?.toISOString() ?? null, updatedAt: attempt.updatedAt?.toISOString() ?? null,
      retryAllowed: ['DECLINED', 'AWAITING_CUSTOMER_ACTION', 'NOT_SUBMITTED'].includes(classification) && !attempt.orderId && !attempt.cancelRequested,
      cancelable: cancelEligible(attempt),
      attemptId: attempt.id, cartIdentity: attempt.cartIdentity, cartRevision: attempt.revision, intentId: attempt.providerIntentId,
      state: attempt.state, providerStatus: attempt.providerStatus,
      failureCode: attempt.failureCode, total: attempt.total.toFixed(2), currency: attempt.currency,
      orderReference: attempt.orderId ? `ORD-${attempt.orderId.toUpperCase()}` : null,
      committed: Boolean(attempt.orderId), cart, recoveryRemainder: attempt.recoveryRemainder,
      recoveryActive: recoveryActive || (attempt.work?.state === 'LEASED' && Boolean(attempt.work.leaseUntil && attempt.work.leaseUntil.getTime() > Date.now())),
      confirmation };
  }
  async status(userId: string, id: string) {
    return this.projectStatus(userId, await this.ownedStatus(userId, id));
  }

  /**
   * Records, once and race-safely, that this owner's client is about to confirm the PaymentIntent. Creates no attempt, intent or order and changes
   * no financial state; a repeated call returns the first timestamp. Refused unless the purchase is submitted and still awaiting card input.
   */
  async confirmationStarted(userId: string, id: string) {
    this.assertMutationsAllowed();
    await this.owned(userId, id);
    if (!confirmationSignalEnabled()) return { attemptId: id, confirmationStartedAt: null };
    const claimed = await this.database.paymentAttempt.updateMany({ where: { id, userId, submittedAt: { not: null }, confirmationStartedAt: null, orderId: null,
      cancelRequested: false, state: 'AWAITING_INPUT' }, data: { confirmationStartedAt: new Date() } });
    const attempt = await this.database.paymentAttempt.findFirst({ where: { id, userId }, select: { state: true, submittedAt: true, orderId: true, confirmationStartedAt: true } });
    if (!attempt?.confirmationStartedAt) throw new AppError('This payment can no longer be confirmed from here.', 409, 'PAYMENT_CONFIRMATION_NOT_ALLOWED');
    void claimed;
    return { attemptId: id, confirmationStartedAt: attempt.confirmationStartedAt.toISOString() };
  }

  /** Transfer only the validated cart generation before exposing confirmation to Stripe.js.
   * No provider I/O occurs under these locks. Lost responses replay the same attempt.
   */
  async submit(userId: string, id: string) {
    this.assertMutationsAllowed();
    await this.owned(userId, id);
    const leaseWaitDeadline = Date.now() + SUBMIT_LEASE_WAIT_MS;
    let accepted: SubmitIdentity | null = null;
    for (let retry = 0; ; retry++) {
      try {
        accepted = await this.database.$transaction(async tx => {
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "payment_attempts" WHERE "id" = ${id}::uuid FOR UPDATE`);
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "payment_work" WHERE "attemptId" = ${id}::uuid FOR UPDATE`);
          const attempt = await tx.paymentAttempt.findFirst({ where: { id, userId }, include: { ...attemptInclude, work: true } });
          if (!attempt) throw new AppError('Payment not found.', 404, 'PAYMENT_ATTEMPT_NOT_FOUND');
          // Identity only, from this locked read: the client needs nothing more to hand off to Stripe confirmation.
          const identity = (submittedAt: Date): SubmitIdentity => ({ attemptId: attempt.id, checkoutId: attempt.id, cartIdentity: attempt.cartIdentity,
            cartRevision: attempt.revision, intentId: attempt.providerIntentId, state: attempt.state, classification: 'PROCESSING',
            scope: checkoutRequestSchema.parse(attempt.request).scope === 'BUY_NOW' ? 'BUY_NOW' : 'CART_CHECKOUT',
            submittedAt: submittedAt.toISOString(), committed: Boolean(attempt.orderId), recoveryActive: false });
          if (attempt.submittedAt) return identity(attempt.submittedAt);
          if (attempt.state !== 'AWAITING_INPUT' || attempt.cancelRequested || attempt.orderId ||
            !attempt.providerIntentId || attempt.expiresAt.getTime() <= Date.now() ||
            !['READY', 'LEASED'].includes(attempt.work?.state ?? '')) {
            throw new AppError('Check this payment before continuing.', 409, 'PAYMENT_RECOVERY_PENDING');
          }
          // A live lease means a worker pass is in flight; an expired one is reclaimed by the next batch and does not block.
          if (attempt.work?.state === 'LEASED' && (!attempt.work.leaseUntil || attempt.work.leaseUntil.getTime() > Date.now())) throw new SubmitWorkLeased();
          const request = checkoutRequestSchema.parse(attempt.request);
          if (request.scope !== 'BUY_NOW') {
            const cartId = await lockCartForUser(tx, userId);
            if (!cartId || cartId !== attempt.cartId || attempt.activeCartId !== cartId) {
              throw new AppError('Checkout changed.', 409, 'CHECKOUT_CHANGED');
            }
            const current = await currentCart(userId, tx);
            if (!current.data.canCheckout || current.data.revision !== attempt.revision ||
              current.data.items.length !== attempt.items.length) throw new AppError('Checkout changed.', 409, 'CHECKOUT_CHANGED');
            for (const item of attempt.items) {
              const line = current.data.items.find(line => line.productId === item.productId);
              if (!line?.id || line.id !== item.snapshotCartItemId || line.quantity !== item.quantity) throw new AppError('Checkout changed.', 409, 'CHECKOUT_CHANGED');
              await tx.paymentAttemptItem.update({ where: { id: item.id }, data: { sourceCartItemId: line.id } });
              const removed = await tx.cartItem.deleteMany({ where: { id: line.id, cartId, quantity: item.quantity } });
              if (removed.count !== 1) throw new AppError('Checkout changed.', 409, 'CHECKOUT_CHANGED');
            }
          }
          const submittedAt = new Date();
          await tx.paymentAttempt.update({ where: { id }, data: { submittedAt, activeCartId: null } });
          await tx.paymentWork.update({ where: { attemptId: id }, data: { nextRunAt: submittedAt } });
          return identity(submittedAt);
        }, { isolationLevel: 'Serializable', timeout: PAYMENT_TRANSACTION_TIMEOUT_MS, maxWait: PAYMENT_TRANSACTION_MAX_WAIT_MS });
        break;
      } catch (error) {
        if (error instanceof SubmitWorkLeased) {
          if (Date.now() >= leaseWaitDeadline) throw new AppError('Check this payment before continuing.', 409, 'PAYMENT_RECOVERY_PENDING');
          await new Promise(resolve => setTimeout(resolve, SUBMIT_LEASE_POLL_MS)); retry--; continue;
        }
        if (isSerializationConflict(error) && retry < 2) continue; throw error;
      }
    }
    // Task 03.6: the full status projection (attempt re-read, Cart projection, order lookup) used to run here, after commit, on the critical
    // path before Stripe confirmation could start (several remote round trips; /submit took 8.5-37 s in DEV). The handoff needs identity only.
    return accepted!;
  }


  // Duplicate resume requests for one owned attempt (double-mounted page, reload, second tab on
  // this instance) share one execution instead of queueing behind each other's row locks.
  // Keyed by owner, so a result is never shared across customers. Cross-instance duplicates are
  // still serialized by the attempt/work row locks below.
  private readonly resumesInFlight = new Map<string, Promise<Awaited<ReturnType<PaymentService['resumeOnce']>>>>();
  /** Reuse the SAME provider intent; no replacement authorization and no Cart writes. */
  resume(userId: string, id: string) {
    const key = `${userId}:${id}`;
    const active = this.resumesInFlight.get(key);
    if (active) return active;
    const execution = this.resumeOnce(userId, id).finally(() => { this.resumesInFlight.delete(key); });
    this.resumesInFlight.set(key, execution);
    return execution;
  }
  private async resumeOnce(userId: string, id: string) {
    this.assertMutationsAllowed();
    const attempt = await this.owned(userId, id);
    if (!attempt.submittedAt || attempt.orderId || attempt.cancelRequested ||
      !['DECLINED', 'AWAITING_INPUT', 'ACTION_REQUIRED'].includes(attempt.state) || !attempt.providerIntentId) {
      throw new AppError('This purchase cannot be retried yet.', 409, 'PAYMENT_RECOVERY_PENDING');
    }
    const intent = await this.provider.retrieve(attempt.providerIntentId);
    verifyBinding(attempt, intent);
    if (intent.status === 'canceled' && !intent.received && !intent.capturable) {
      // Stripe ended this intent (for example after repeated declines). Persist that provider fact through the lease-fenced worker BEFORE
      // refusing, so the purchase leaves 'Payment details needed' and becomes a failed purchase. No new intent or charge is created here.
      await this.wake(id);
      await this.process(id).catch((error: unknown) => logSafely('error', 'Canceled intent persistence deferred to the durable runner.', {
        event: 'payment.recovery.background_failed', attemptId: id, error }));
    }
    if (!['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status) || intent.received || intent.capturable) {
      throw new AppError('Check the saved payment before retrying.', 409, 'PAYMENT_RECOVERY_PENDING');
    }
    // A submitted purchase reopens card entry only after a decline or a bank verification request. One merely still at card entry is being
    // checked (Processing) and is resolved by recovery or the abandonment policy, never by a second customer-initiated payment.
    if (attempt.state === 'AWAITING_INPUT' && !(intent.status === 'requires_payment_method' && intent.declined)) {
      throw new AppError('This payment is still being checked.', 409, 'PAYMENT_RECOVERY_PENDING');
    }
    // Revalidate the saved purchase, never replace it with the active cart.
    const projection = await purchaseItemsProjection(attempt.items, this.database);
    if (!projection.data.canCheckout || attempt.items.some(item =>
      projection.products.get(item.productId)?.price.toFixed(2) !== item.unitPrice.toFixed(2))) {
      throw new AppError('Saved purchase availability or pricing changed. Contact support before retrying.', 409, 'CHECKOUT_CHANGED');
    }
    // Delivery terms are revalidated BEFORE card confirmation, with the same rules order commit applies afterwards.
    assertSavedTermsCurrent(userId, attempt, attempt.items);
    // A concurrent resume of the same attempt (another instance or tab) commits first and aborts this
    // snapshot. The retry re-reads eligibility under the locks; the only write is the idempotent lifetime extension.
    // A routine recovery lease (worker or poll-driven reconcile; several seconds against DEV) is waited out like submit does; refusing on it left
    // a saved-purchase retry observing a purchase that was never being paid.
    const leaseWaitDeadline = Date.now() + RESUME_LEASE_WAIT_MS;
    for (let retry = 0; ; retry++) {
      try {
        await this.database.$transaction(async tx => {
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "payment_attempts" WHERE "id" = ${id}::uuid FOR UPDATE`);
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "payment_work" WHERE "attemptId" = ${id}::uuid FOR UPDATE`);
          const latest = await tx.paymentAttempt.findFirst({ where: { id, userId }, include: { work: true } });
          const activeLease = latest?.work?.state === 'LEASED' && (!latest.work.leaseUntil || latest.work.leaseUntil.getTime() > Date.now());
          if (activeLease && latest && !latest.orderId && !latest.cancelRequested && latest.providerIntentId === intent.id &&
            ['DECLINED', 'AWAITING_INPUT', 'ACTION_REQUIRED'].includes(latest.state)) throw new SubmitWorkLeased();
          if (!latest || latest.orderId || latest.cancelRequested || latest.providerIntentId !== intent.id ||
            activeLease || !['DECLINED', 'AWAITING_INPUT', 'ACTION_REQUIRED'].includes(latest.state)) {
            throw new AppError('Payment recovery is running.', 409, 'PAYMENT_RECOVERY_PENDING');
          }
          // Re-checked under the locks immediately before the only permitted write; a mismatch writes nothing.
          assertSavedTermsCurrent(userId, latest, attempt.items);
          const data: Prisma.PaymentAttemptUpdateInput = { expiresAt: new Date(Date.now() + ATTEMPT_LIFETIME_MS) };
          if (intent.status === 'requires_payment_method' && intent.declined && latest.state === 'AWAITING_INPUT') {
            data.state = 'DECLINED';
            data.failureCode = 'PAYMENT_DECLINED';
          }
          await tx.paymentAttempt.update({ where: { id }, data });
        }, { isolationLevel: 'Serializable', timeout: PAYMENT_TRANSACTION_TIMEOUT_MS, maxWait: PAYMENT_TRANSACTION_MAX_WAIT_MS });
        break;
      } catch (error) {
        if (error instanceof SubmitWorkLeased) {
          if (Date.now() >= leaseWaitDeadline) throw new AppError('Payment recovery is running.', 409, 'PAYMENT_RECOVERY_PENDING');
          await new Promise(resolve => setTimeout(resolve, SUBMIT_LEASE_POLL_MS)); retry--; continue;
        }
        if (isSerializationConflict(error) && retry < 2) continue; throw error;
      }
    }
    // Display-only: the same delivery definition the quote uses, so the retry review can show what was selected.
    const savedRequest = attempt.request;
    const savedMethod = typeof savedRequest === 'object' && savedRequest !== null && !Array.isArray(savedRequest) && 'deliveryMethod' in savedRequest ? savedRequest.deliveryMethod : undefined;
    const selectedDelivery = deliveryMethods.find(method => method.id === savedMethod);
    return { ...(await this.status(userId, id)), clientSecret: intent.clientSecret, request: attempt.request,
      delivery: selectedDelivery ? { label: selectedDelivery.label, estimate: selectedDelivery.estimate, price: selectedDelivery.price } : null,
      items: attempt.items.map(item => ({ name: item.productName, quantity: item.quantity, imageUrl: item.imageUrl })), replayed: true };
  }

  /** Explicit terminal restoration, once per attempt; additive to newer cart quantities. */
  async restore(userId: string, id: string) {
    this.assertMutationsAllowed();
    const attempt = await this.owned(userId, id);
    // Buy Now items never belong to the Active Cart, so restoring one would silently add its product to the customer's Cart.
    if (typeof attempt.request === 'object' && attempt.request !== null && !Array.isArray(attempt.request) && attempt.request.scope === 'BUY_NOW') {
      throw new AppError('A Buy Now purchase is never added to your Cart. Start Buy Now again from the product page.', 409, 'PURCHASE_NOT_RESTORABLE');
    }
    if (!attempt.submittedAt || !['CANCELED', 'COMPENSATED', 'REFUNDED'].includes(attempt.state) || !attempt.providerIntentId) {
      throw new AppError('This purchase cannot be restored yet.', 409, 'PAYMENT_RECOVERY_PENDING');
    }
    const intent = await this.provider.retrieve(attempt.providerIntentId);
    verifyBinding(attempt, intent);
    if (attempt.state === 'REFUNDED') {
      const refund = attempt.refundId ? await this.provider.retrieveRefund(attempt.refundId) : null;
      if (!refund || refund.status !== 'succeeded' || refund.intentId !== intent.id || refund.amount !== attempt.amountCents) {
        throw new AppError('Refund verification is pending.', 409, 'PAYMENT_RECOVERY_PENDING');
      }
    } else if (intent.status !== 'canceled' || intent.received || intent.capturable) {
      throw new AppError('Payment verification is pending.', 409, 'PAYMENT_RECOVERY_PENDING');
    }
    await this.database.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "payment_attempts" WHERE "id" = ${id}::uuid FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "payment_work" WHERE "attemptId" = ${id}::uuid FOR UPDATE`);
      const latest = await tx.paymentAttempt.findFirst({ where: { id, userId }, include: { work: true } });
      if (!latest || latest.state !== attempt.state || latest.work?.state === 'LEASED') throw new AppError('Recovery is running.', 409, 'PAYMENT_RECOVERY_PENDING');
      if (latest.restoredAt) return;
      const cart = await tx.cart.upsert({ where: { userId }, create: { userId }, update: {}, select: { id: true } });
      await lockCart(tx, cart.id);
      const current = await currentCart(userId, tx);
      if (new Set([...current.data.items.map(item => item.productId), ...attempt.items.map(item => item.productId)]).size > MAX_CART_LINES) {
        throw new AppError('Make room in Cart before restoring this purchase.', 409, 'CART_FULL');
      }
      const restoredItems = attempt.items.map(item => ({ productId: item.productId,
        quantity: (current.data.items.find(line => line.productId === item.productId)?.quantity ?? 0) + item.quantity }));
      if (restoredItems.some(item => item.quantity > MAX_CART_QUANTITY)) throw new AppError('Cart quantity limit exceeded.', 409, 'INVALID_CART_QUANTITY');
      if (!(await purchaseItemsProjection(restoredItems, tx)).data.canCheckout) {
        throw new AppError('Saved items are unavailable in this quantity.', 409, 'CHECKOUT_CHANGED');
      }
      for (const item of restoredItems) {
        await tx.cartItem.upsert({ where: { cartId_productId: { cartId: cart.id, productId: item.productId } },
          create: { cartId: cart.id, productId: item.productId, quantity: item.quantity }, update: { quantity: item.quantity } });
      }
      await tx.paymentAttempt.update({ where: { id }, data: { restoredAt: new Date() } });
    }, { isolationLevel: 'Serializable', timeout: PAYMENT_TRANSACTION_TIMEOUT_MS, maxWait: PAYMENT_TRANSACTION_MAX_WAIT_MS });
    return this.status(userId, id);
  }

  async purchases(userId: string) {
    const outcomeStates: PaymentAttemptState[] = ['PAID', 'DECLINED', 'CANCELED', 'COMPENSATED', 'REFUNDED'];
    const attempts = await this.database.paymentAttempt.findMany({ where: { userId, submittedAt: { not: null }, dismissedAt: null,
      // Abandonment is not a failed card: attempts the system itself cancelled (expired, or superseded by a newer checkout) never show as
      // Pending or Failed and never raise a failure toast. Only genuine provider declines and real order failures are customer-visible failures.
      // (Submitted lapses with PAYMENT_EXPIRED are incomplete purchases and stay listed; superseded setups remain hidden.)
      NOT: { state: 'CANCELED', failureCode: { in: [...ABANDONMENT_FAILURE_CODES] } }, OR: [
      { state: { not: 'PAID' }, restoredAt: null },
      ...outcomeStates.map(state => ({ state, OR: [{ notificationReadState: null }, { notificationReadState: { not: state } }] })),
    ] }, include: { ...attemptInclude, work: true }, orderBy: { createdAt: 'desc' } });
    // Read-only (Task 03.8): a GET never claims work, calls the provider or finalizes a payment (finalization now also creates email
    // events). Overdue recovery is driven by the runners and by the explicit POST recoverOverdue() below.
    return attempts.map(attempt => ({ attemptId: attempt.id, checkoutId: attempt.id,
      scope: checkoutRequestSchema.parse(attempt.request).scope ?? 'CART_CHECKOUT',
      state: attempt.state, classification: customerPaymentStatus(attempt, attempt.work), total: attempt.total.toFixed(2), currency: attempt.currency,
      updatedAt: attempt.updatedAt?.toISOString() ?? null,
      orderReference: attempt.state === 'PAID' && attempt.orderId ? `ORD-${attempt.orderId.toUpperCase()}` : null,
      unread: ['SUCCEEDED', 'DECLINED', 'FAILED'].includes(customerPaymentStatus(attempt, attempt.work)) && attempt.notificationReadState !== attempt.state,
      pending: !['SUCCEEDED', 'DECLINED', 'FAILED', 'ABANDONED'].includes(customerPaymentStatus(attempt, attempt.work)) && !attempt.restoredAt,
      // Try Again: a provider decline or a bank verification. Cancel purchase: only a recovery-verified never-confirmed purchase.
      retryAllowed: ['DECLINED', 'AWAITING_CUSTOMER_ACTION'].includes(customerPaymentStatus(attempt, attempt.work)) && !attempt.orderId && !attempt.cancelRequested,
      cancelable: cancelEligible(attempt),
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      // Copy only: distinguishes "confirming with the provider" from "checking the status of this purchase"; never an outcome.
      confirmationStarted: Boolean(attempt.confirmationStartedAt),
      items: attempt.items.map(item => ({ name: item.productName, quantity: item.quantity, imageUrl: item.imageUrl })) }));
  }

  /**
   * Recovery must not depend on one live runner: the customer's purchases view asks for overdue unresolved submitted purchases to be
   * reconciled now. Moved out of the GET list read (Task 03.8) with unchanged semantics: process() only claims DUE work under a lease
   * (no wake, no retry-budget reset, no blind retry), only work overdue by more than a runner cycle, at most five, owner-scoped.
   */
  async recoverOverdue(userId: string) {
    this.assertMutationsAllowed();
    const overdue = new Date(Date.now() - POLL_RECONCILE_OVERDUE_MS);
    const due = await this.database.paymentAttempt.findMany({ where: { userId, submittedAt: { not: null }, orderId: null, cancelRequested: false,
      state: { in: ['AWAITING_INPUT', 'ACTION_REQUIRED', 'PROCESSING'] }, providerIntentId: { not: null },
      work: { is: { state: 'READY', nextRunAt: { lte: overdue } } } }, select: { id: true }, orderBy: { createdAt: 'desc' }, take: 5 });
    for (const attempt of due) {
      void this.process(attempt.id).catch((error: unknown) => logSafely('error', 'Poll-driven reconciliation deferred to the durable runner.', {
        event: 'payment.recovery.background_failed', attemptId: attempt.id, error }));
    }
    return { scheduled: due.length };
  }

  /**
   * Customer hide for a failed purchase card. Sets only `dismissedAt`; never deletes or changes payment, order,
   * Cart, stock or Stripe records. Idempotent. Guards are re-checked inside the write so a racing recovery or
   * resume cannot be hidden underneath.
   */
  async dismiss(userId: string, id: string) {
    this.assertMutationsAllowed();
    const attemptId = attemptSchema.parse(id);
    // Same states the customer list shows as failed: DECLINED, plus CANCELED/COMPENSATED/REFUNDED (customerPaymentStatus FAILED).
    const dismissible: PaymentAttemptState[] = ['DECLINED', 'CANCELED', 'COMPENSATED', 'REFUNDED'];
    const notDismissible = () => new AppError('This payment cannot be dismissed right now.', 409, 'PAYMENT_NOT_DISMISSIBLE');
    try {
      return await this.database.$transaction(async tx => {
        const attempt = await tx.paymentAttempt.findFirst({ where: { id: attemptId, userId },
          select: { id: true, state: true, orderId: true, submittedAt: true, dismissedAt: true, work: { select: { state: true, lastError: true } } } });
        if (!attempt) throw new AppError('Payment attempt not found.', 404, 'PAYMENT_ATTEMPT_NOT_FOUND');
        if (attempt.dismissedAt) return { attemptId, dismissedAt: attempt.dismissedAt.toISOString() };
        // The list only shows submitted purchases whose customer classification is a failure; dismissal must match that exactly.
        const classification = customerPaymentStatus(attempt, attempt.work);
        if (!['DECLINED', 'FAILED'].includes(classification) || !dismissible.includes(attempt.state) || !attempt.submittedAt ||
          attempt.orderId || attempt.work?.state === 'LEASED' || attempt.work?.lastError) throw notDismissible();
        const dismissedAt = new Date();
        const claimed = await tx.paymentAttempt.updateMany({
          where: { id: attemptId, userId, dismissedAt: null, orderId: null, submittedAt: { not: null }, state: { in: dismissible },
            OR: [{ work: { is: null } }, { work: { is: { state: { not: 'LEASED' }, lastError: null } } }] },
          data: { dismissedAt } });
        if (claimed.count !== 1) throw notDismissible();
        return { attemptId, dismissedAt: dismissedAt.toISOString() };
      }, { isolationLevel: 'Serializable', timeout: PAYMENT_TRANSACTION_TIMEOUT_MS, maxWait: PAYMENT_TRANSACTION_MAX_WAIT_MS });
    } catch (error) {
      if (isSerializationConflict(error)) throw notDismissible();
      throw error;
    }
  }

  async acknowledge(userId: string, id: string, state: PaymentAttemptState) {
    this.assertMutationsAllowed();
    await this.ownedStatus(userId, id);
    await this.database.paymentAttempt.updateMany({ where: { id, userId, state },
      data: { notificationReadState: state } });
  }

  async setup(userId: string, key: string, input: unknown, correlationId?: string) {
    this.assertMutationsAllowed();
    const timing = new PaymentSetupTiming(correlationId);
    return timing.run(async () => {
      try { const result = await this.setupMeasured(userId, key, input, timing); timing.complete('success'); return result; }
      catch (error) { timing.markFailure('setup_unmeasured', error); timing.complete('error'); throw error; }
      finally { logSafely('info', 'Payment setup performance.', timing.report()); }
    });
  }
  private async setupMeasured(userId: string, key: string, input: unknown, timing: PaymentSetupTiming) {
    const idempotencyKey = attemptSchema.parse(key); const request = checkoutRequestSchema.parse(input);
    const hash = requestHash(request); const account = await paymentOperation('stripe.account', 'stripe', () => this.provider.account());
    let saved: Attempt | null = null; let replayed = false;
    let reconciledBlocker = false;
    for (let retry = 0; retry < 3; retry++) {
      // Decisions made by an aborted transaction must not escape a later successful retry.
      replayed = false;
      let transactionStage = 'transaction_begin_or_connection_acquisition';
      try {
        const transactionStarted = performance.now();
        saved = await paymentOperation('setup_transaction', 'database', () => this.database.$transaction(async tx => {
          paymentTransactionEntered(transactionStarted);
          transactionStage = 'idempotency_lookup';
          const prior = await paymentOperation('idempotency_lookup', 'database', () => tx.paymentAttempt.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } }, include: attemptInclude }));
          if (prior) {
            if (prior.requestHash !== hash) throw new AppError('This payment key was used for different checkout details.', 409, 'IDEMPOTENCY_CONFLICT');
            if (!prior.submittedAt && !prior.orderId && !terminal(prior.state)) {
              transactionStage = 'replay_snapshot_validation';
              const cartId = isBuyNowRequest(request) ? null : await paymentOperation('replay_cart_lock', 'database', () => lockCartForUser(tx, userId));
              if (!isBuyNowRequest(request) && (!cartId || cartId !== prior.cartId || cartId !== prior.cartIdentity)) {
                throw new AppError('Your cart changed. Review it again.', 409, 'CHECKOUT_CHANGED');
              }
              const current = await paymentOperation('replay_snapshot', 'database', () => isBuyNowRequest(request) && request.buyNow
                ? buyNowProjection(userId, request.buyNow, tx) : currentCart(userId, tx));
              if (current.data.revision !== prior.revision || !current.data.canCheckout) {
                throw new AppError('Your cart changed. Review it again.', 409, 'CHECKOUT_CHANGED');
              }
            }
            replayed = true; transactionStage = 'transaction_commit'; return prior;
          }
          transactionStage = 'customer_validation';
          const customer = await paymentOperation('customer_validation', 'database', () => tx.user.findFirst({ where: { id: userId, isActive: true, role: { name: 'CUSTOMER' } }, select: { id: true } }));
          if (!customer) throw new AppError('Sign in again to continue.', 401, 'UNAUTHENTICATED');
          const buyNow = request.scope === 'BUY_NOW' ? request.buyNow ?? null : null;
          // Discover/lock only the existing owned candidate without locking Cart.
          // Serializable row-version conflicts abort through the existing bounded retry policy.
          transactionStage = 'active_attempt_lock';
          const candidates = buyNow ? [] : await paymentOperation('active_attempt_lock', 'database', () => tx.$queryRaw<{ id: string }[]>(Prisma.sql`
            SELECT pa."id" FROM "payment_attempts" pa JOIN "carts" c ON c."id" = pa."activeCartId"
            WHERE c."userId" = ${userId}::uuid AND pa."userId" = ${userId}::uuid FOR UPDATE OF pa`));
          const candidateId = candidates[0]?.id ?? null;
          transactionStage = 'active_work_lock';
          const workRows = candidateId ? await paymentOperation('active_work_lock', 'database', () => tx.$queryRaw<{ id: string; state: string; leaseUntil: Date | null }[]>(Prisma.sql`
            SELECT "id", "state"::text AS "state", "leaseUntil" FROM "payment_work" WHERE "attemptId" = ${candidateId}::uuid FOR UPDATE`)) : [];
          transactionStage = 'cart_lock';
          const cartId = buyNow ? null : await paymentOperation('cart_lock', 'database', () => lockCartForUser(tx, userId));
          if (!buyNow && !cartId) throw new AppError('Your cart is empty.', 409, 'CHECKOUT_EMPTY_CART');
          transactionStage = 'active_attempt_lookup';
          const active = cartId ? await paymentOperation('active_attempt_lookup', 'database', () => tx.paymentAttempt.findFirst({ where: { activeCartId: cartId }, include: attemptInclude })) : null;
          if ((active?.id ?? null) !== candidateId || active && (active.userId !== userId || active.cartId !== cartId)) {
            // Never acquire a replacement Attempt while holding Cart. No arbitrary retry.
            throw new AppError('Another payment attempt is active. Resolve it before starting a new checkout.', 409, 'PAYMENT_RECOVERY_PENDING');
          }
          if (active) {
            const workState = workRows[0]?.state ?? '';
            const leaseExpired = workState === 'LEASED' && Boolean(workRows[0]?.leaseUntil && new Date(workRows[0].leaseUntil).getTime() <= Date.now());
            const workAvailable = ['READY', 'DONE'].includes(workState) || leaseExpired;
            const replaceable = !active.orderId && !active.cancelRequested && workAvailable &&
              ['AWAITING_INPUT', 'DECLINED'].includes(active.state) &&
              (!active.failureCode || active.failureCode === 'PAYMENT_DECLINED');
            if (terminal(active.state) && active.state !== 'INCIDENT') {
              transactionStage = 'stale_attempt_release';
              await tx.paymentAttempt.update({
                where: { id: active.id },
                data: { activeCartId: null },
              });
            } else if (active.userId === userId && active.requestHash === hash && !terminal(active.state) &&
              active.state !== 'DECLINED' && active.failureCode !== 'PAYMENT_DECLINED' && !active.cancelRequested) {
              transactionStage = 'active_snapshot_validation';
              const current = await paymentOperation('active_snapshot', 'database', () => currentCart(userId, tx));
              if (current.data.revision !== active.revision || !current.data.canCheckout) {
                throw new AppError('Your cart changed. Review it again.', 409, 'CHECKOUT_CHANGED');
              }
              // The revision ignores line identity, but submit requires it (a recreated line is rejected). Replaying an unsubmitted card-entry
              // attempt whose Cart lines were removed and re-added would strand the customer in CHECKOUT_CHANGED until it expires, so release it
              // through the normal supersede path instead and let a fresh attempt be created from the current lines.
              const sameLines = !active.submittedAt && !buyNow ? active.items.every(item => {
                // Compare only when both identities are known (legacy rows and fixtures may carry none).
                const line = current.data.items.find(candidate => candidate.productId === item.productId);
                return !item.snapshotCartItemId || !line?.id || line.id === item.snapshotCartItemId;
              }) : true;
              if (!sameLines) {
                if (replaceable) throw setupBlocker(active, workRows[0]);
                throw new AppError('Your cart changed. Review it again.', 409, 'CHECKOUT_CHANGED');
              }
              replayed = true; transactionStage = 'transaction_commit';
              return active;
            } else if (replaceable && (active.state === 'DECLINED' || active.expiresAt.getTime() > Date.now())) {
              // Release only after provider readback and fenced cancellation have
              // established a terminal outcome, never from a stale local decline.
              throw setupBlocker(active, workRows[0]);
            } else {
              // Expired nonterminal identity remains bound until reconciliation.
              // It may already be authorized at Stripe despite the local snapshot.
              throw setupBlocker(active, workRows[0]);
            }
          }
          transactionStage = 'cart_product_inventory_snapshot';
          const current = await paymentOperation('purchase_snapshot', 'database', () => buyNow ? buyNowProjection(userId, buyNow, tx) : currentCart(userId, tx));
          if (!current.data.items.length || !current.data.canCheckout) throw new AppError('Review product availability in Cart.', 409, 'CHECKOUT_INVALID_CART');
          if (current.data.revision !== request.expectedRevision) throw new AppError('Your cart changed. Review it again.', 409, 'CHECKOUT_CHANGED');
          const delivery = deliveryMethods.find(method => method.id === request.deliveryMethod);
          if (!delivery) throw new AppError('Choose a delivery method.', 400, 'CHECKOUT_INVALID_DELIVERY');
          const totals = checkoutTotals(current.data.subtotal, delivery.price);
          transactionStage = 'attempt_create';
          const created = await paymentOperation('attempt_create', 'database', () => tx.paymentAttempt.create({ data: {
            userId,
            cartId: buyNow ? null : cartId,
            cartIdentity: buyNow ? userId : (cartId as string),
            activeCartId: buyNow ? null : cartId,
            idempotencyKey,
            requestHash: hash,
            revision: request.expectedRevision,
            request,
            subtotal: totals.subtotal,
            shippingCost: totals.shipping,
            total: totals.total,
            amountCents: cents(totals.total),
            currency: 'USD',
            stripeAccountId: account,
            expiresAt: new Date(Date.now() + ATTEMPT_LIFETIME_MS),
            // Claims compare nextRunAt with the application clock; the column's database default can be ahead of it
            // (ms rounding, host clock skew), which made the inline setup claim miss and left the attempt PREPARING.
            work: { create: { nextRunAt: new Date() } },
            items: { create: current.data.items.map(item => {
              const product = current.products.get(item.productId);
              if (!product) throw new AppError('Product unavailable.', 409, 'PRODUCT_UNAVAILABLE');
              return {
                snapshotCartItemId: item.id,
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: product.price,
                lineTotal: product.price.mul(item.quantity),
                productName: product.name,
                sku: product.sku,
                imageUrl: product.images[0]?.url ?? null,
              };
            }) },
          }, include: attemptInclude }));
          transactionStage = 'transaction_commit';
          return created;
        }, { isolationLevel: 'Serializable', timeout: PAYMENT_SETUP_TRANSACTION_TIMEOUT_MS, maxWait: PAYMENT_SETUP_TRANSACTION_MAX_WAIT_MS }));
        break;
      } catch (error) {
        timing.markFailure(transactionStage, error, true);
        if (error instanceof PaymentSetupBlockedError) {
          logSafely('info', 'Payment setup blocked by owned recovery.', { event: 'payment.setup.blocked', correlationId: timing.correlationId, ...error.recovery });
          if (error.canReconcile && !reconciledBlocker && retry < 2) {
            reconciledBlocker = true;
            const candidate = await this.owned(userId, error.recovery.attemptId);
            const truth = await paymentOperation('stripe.retrieve', 'stripe', () => this.provider.retrieve(candidate.providerIntentId!));
            verifyBinding(candidate, truth);
            if (!['requires_payment_method', 'requires_confirmation', 'canceled'].includes(truth.status) || truth.received || truth.capturable) throw error;
            // The setup transaction threw before mutation and has rolled back.
            // Resume ONLY its locked owned candidate through the normal atomic claim.
            // Do not reset unknown retry accounting or steal a current lease. READY work is re-armed too: the durable
            // worker reschedules an abandoned card entry 10 s ahead on every pass, and a not-yet-due row would make the
            // claim below a silent no-op, leaving the customer blocked with PAYMENT_RECOVERY_PENDING.
            await this.database.paymentWork.updateMany({ where: { attemptId: error.recovery.attemptId, state: { in: ['DONE', 'READY'] } },
              data: { state: 'READY', nextRunAt: new Date() } });
            await this.process(error.recovery.attemptId, undefined, true);
            const latest = await this.ownedStatus(userId, error.recovery.attemptId);
            if (terminal(latest.state) && latest.state !== 'INCIDENT' && !latest.orderId) continue;
            throw setupBlocker(latest, latest.work ?? undefined);
          }
        }
        const serializationConflict = isSerializationConflict(error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          const sqlState = typeof error.meta?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.meta.code)
            ? error.meta.code : undefined;
          logSafely('error', 'Payment setup transaction failed.', {
            event: 'payment.setup.transaction_failed', correlationId: timing.correlationId, operation: 'setup_transaction', stage: transactionStage, prismaCode: error.code, sqlState,
            retryable: serializationConflict, transactionAborted: serializationConflict,
            retryNumber: retry + 1, willRetry: serializationConflict && retry < 2,
          });
        }
        if (serializationConflict && retry < 2) continue;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const prior = await this.database.paymentAttempt.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } }, include: attemptInclude });
          if (prior?.requestHash === hash) { saved = prior; replayed = true; break; }
          throw new AppError('A payment attempt already exists. Resolve it first.', 409, 'PAYMENT_RECOVERY_PENDING');
        }
        throw error;
      }
    }
    if (!saved) throw new AppError('Checkout changed. Retry setup safely.', 409, 'CHECKOUT_CONFLICT');
    if (replayed && awaitingCardEntry(saved)) {
      // Rendering an already persisted, unsubmitted intent needs a provider read,
      // not another worker lease, state write and fenced transaction.
      const existingIntent = await paymentOperation('stripe.retrieve', 'stripe', () => this.provider.retrieve(saved!.providerIntentId!));
      let bound = true;
      try { verifyBinding(saved, existingIntent); } catch { bound = false; }
      if (bound && !existingIntent.declined && existingIntent.received === 0 && existingIntent.capturable === 0 &&
        ['requires_payment_method', 'requires_confirmation'].includes(existingIntent.status)) {
        const latest = await paymentOperation('attempt_status_read', 'database', () => this.ownedStatus(userId, saved!.id));
        const leased = latest.work?.state === 'LEASED' && latest.work.leaseUntil && latest.work.leaseUntil.getTime() > Date.now();
        if (awaitingCardEntry(latest) && !leased && latest.providerIntentId === existingIntent.id) {
          verifyBinding(latest, existingIntent);
          return { ...(await this.projectStatus(userId, latest)), clientSecret: existingIntent.clientSecret, replayed };
        }
      }
    }
    let prepared: StatusAttempt | null = null;
    const intent = await paymentOperation('inline_worker', 'application', () => saved!.providerIntentId
      ? this.process(saved!.id) : this.process(saved!.id, snapshot => { prepared = snapshot; }));
    // Initial card setup can use the exact scalar/work snapshot just committed
    // by its fenced worker. Other outcomes still perform an owned status read.
    const latest: StatusAttempt = prepared ?? await paymentOperation('attempt_status_read', 'database', () => this.ownedStatus(userId, saved!.id));
    const currentIntent = !terminal(latest.state) && !latest.cancelRequested && latest.providerIntentId
      ? intent?.id === latest.providerIntentId ? intent : await paymentOperation('stripe.retrieve', 'stripe', () => this.provider.retrieve(latest.providerIntentId!)) : null;
    if (currentIntent) verifyBinding(latest, currentIntent);
    // A new checkout must not mount Elements for the prior failed or completed operation.
    const workerActive = latest.work?.state === 'LEASED' && latest.work.leaseUntil && latest.work.leaseUntil.getTime() > Date.now();
    const canEnterCard = currentIntent && !workerActive && !latest.orderId && latest.expiresAt.getTime() > Date.now() &&
      ['AWAITING_INPUT', 'ACTION_REQUIRED'].includes(latest.state) && !currentIntent.declined &&
      ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(currentIntent.status);
    return { ...(await this.projectStatus(userId, latest)), clientSecret: canEnterCard ? currentIntent.clientSecret : null, replayed };
  }

  async reconcile(userId: string, id: string) {
    this.assertMutationsAllowed();
    const attempt = await this.ownedStatus(userId, id);
    // A persisted decline is not pending work. Revalidate provider truth before
    // skipping a wake: the customer may have authorized the same Intent since.
    if (attempt.state === 'DECLINED' && !attempt.orderId && !attempt.cancelRequested && attempt.providerIntentId) {
      const intent = await paymentOperation('stripe.retrieve', 'stripe', () => this.provider.retrieve(attempt.providerIntentId!));
      verifyBinding(attempt, intent);
      if (intent.status === 'requires_payment_method' && intent.declined && intent.received === 0 && intent.capturable === 0) {
        const latest = await this.ownedStatus(userId, id);
        if (latest.state === 'DECLINED' && !latest.orderId && !latest.cancelRequested && latest.providerIntentId === intent.id) {
          return this.projectStatus(userId, latest);
        }
      }
    }
    let recoveryScheduled = false;
    if (!terminal(attempt.state) || attempt.state === 'INCIDENT') {
      await this.wake(attempt.id);
      // Provider calls and the purchase transaction remain durable worker work;
      // an HTTP reconciliation request only wakes it and returns owned state.
      void this.process(attempt.id).catch((error: unknown) => {
        logSafely('error', 'Payment reconciliation remains queued for the durable runner.', {
          event: 'payment.recovery.background_failed', attemptId: attempt.id, error,
        });
      });
      recoveryScheduled = true;
    }
    return this.projectStatus(userId, attempt, recoveryScheduled);
  }
  /**
   * Cancel purchase (rare recovery exception). Allowed only when recovery has verified the purchase never reached Stripe (cancelEligible), and
   * re-verified now against a FRESH provider read: no decline, no payment method, nothing received or authorized. The request is recorded under
   * the attempt and work row locks (an active recovery lease, a late confirmation announcement, an order or any state change refuses it), and
   * the lease-fenced worker cancels the intent; a provider decline or authorization observed there still wins. Never refunds, never charges.
   */
  async cancel(userId: string, id: string) {
    this.assertMutationsAllowed();
    const attempt = await this.owned(userId, id);
    const refuse = () => new AppError('This purchase can’t be cancelled. Check its payment status.', 409, 'PAYMENT_CANCEL_NOT_ALLOWED');
    if (!cancelEligible(attempt) || !attempt.providerIntentId) throw refuse();
    const intent = await paymentOperation('stripe.retrieve', 'stripe', () => this.provider.retrieve(attempt.providerIntentId!));
    verifyBinding(attempt, intent);
    if (!unrecordedConfirmation(intent)) throw refuse();
    await this.database.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "payment_attempts" WHERE "id" = ${id}::uuid FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "payment_work" WHERE "attemptId" = ${id}::uuid FOR UPDATE`);
      const latest = await tx.paymentAttempt.findFirst({ where: { id, userId }, include: { work: true } });
      const activeLease = latest?.work?.state === 'LEASED' && (!latest.work.leaseUntil || latest.work.leaseUntil.getTime() > Date.now());
      if (!latest || activeLease || !cancelEligible(latest) || latest.providerIntentId !== intent.id) throw refuse();
      await tx.paymentAttempt.update({ where: { id }, data: { cancelRequested: true, failureCode: CANCELED_BY_CUSTOMER_FAILURE_CODE } });
    }, { isolationLevel: 'Serializable', timeout: PAYMENT_TRANSACTION_TIMEOUT_MS, maxWait: PAYMENT_TRANSACTION_MAX_WAIT_MS });
    logSafely('info', 'Customer cancellation of a verified never-confirmed purchase requested.', { event: 'payment.cancel.requested', attemptId: id });
    await this.wake(id);
    await this.process(id).catch((error: unknown) => logSafely('error', 'Cancellation deferred to the durable runner.', {
      event: 'payment.recovery.background_failed', attemptId: id, error }));
    return this.status(userId, id);
  }
  async wake(id: string) {
    this.assertMutationsAllowed();
    await this.database.paymentWork.updateMany({ where: { attemptId: id, state: { in: ['READY', 'DONE', 'INCIDENT'] } },
      data: { state: 'READY', nextRunAt: new Date(), retryCount: 0 } });
  }
  private async fenced<T>(id: string, token: string, operation: (tx: Prisma.TransactionClient, attempt: Attempt) => Promise<T>) {
    return paymentOperation('worker_fenced_transaction', 'database', () => this.database.$transaction(async tx => {
      await paymentOperation('worker_attempt_lock', 'database', () => tx.$queryRaw(Prisma.sql`SELECT "id" FROM "payment_attempts" WHERE "id" = ${id}::uuid FOR UPDATE`));
      // Claims commit independently. Hold Work through validation and every write so
      // an expired lease cannot be reclaimed between this check and completion.
      await paymentOperation('worker_work_lock', 'database', () => tx.$queryRaw(Prisma.sql`SELECT "id" FROM "payment_work" WHERE "attemptId" = ${id}::uuid FOR UPDATE`));
      const attempt = await paymentOperation('worker_fence_read', 'database', () => tx.paymentAttempt.findUnique({ where: { id }, include: { ...attemptInclude, work: true } }));
      if (!attempt || attempt.work?.state !== 'LEASED' || attempt.work.leaseToken !== token ||
        !attempt.work.leaseUntil || attempt.work.leaseUntil.getTime() <= Date.now()) throw new AppError('Payment worker claim expired.', 409, 'PAYMENT_CLAIM_LOST');
      return operation(tx, attempt);
    }, { timeout: PAYMENT_TRANSACTION_TIMEOUT_MS, maxWait: PAYMENT_TRANSACTION_MAX_WAIT_MS }));
  }
  private async patch(id: string, token: string, data: Prisma.PaymentAttemptUpdateInput) {
    return this.fenced(id, token, tx => tx.paymentAttempt.update({ where: { id }, data, include: attemptInclude }));
  }
  private async assertCurrentClaim(id: string, token: string) {
    const work = await this.database.paymentWork.findUnique({ where: { attemptId: id } });
    if (work?.state !== 'LEASED' || work.leaseToken !== token || !work.leaseUntil || work.leaseUntil.getTime() <= Date.now()) {
      throw new AppError('Payment worker claim expired.', 409, 'PAYMENT_CLAIM_LOST');
    }
  }
  private async patchAndFinish(id: string, token: string, data: Prisma.PaymentAttemptUpdateInput, done: boolean) {
    const result = await this.fenced(id, token, async tx => {
      const updated = await tx.paymentAttempt.update({ where: { id }, data });
      const work = await tx.paymentWork.update({ where: { attemptId: id }, data: { state: done ? 'DONE' : 'READY',
        nextRunAt: new Date(Date.now() + (updated.state === 'DECLINED' || idleSavedCheckout(updated) ? 60_000 : submittedAwaitingProvider(updated) ? SUBMITTED_RECHECK_MS : 10_000)), retryCount: 0, leaseToken: null, leaseUntil: null, lastError: null } });
      return { ...updated, work };
    });
    logSafely('info', 'Payment outcome persisted.', { event: 'payment.outcome.persisted', attemptId: id,
      providerIntentId: result.providerIntentId, orderId: result.orderId, state: result.state, workState: result.work.state,
      leaseId: token, workerInstanceId: logContext.getStore()?.workerInstanceId ?? null, correlationId: logContext.getStore()?.requestId ?? null });
    return result;
  }

  /** Shared browser/webhook/runner state machine; claim gates writes, provider keys gate irreversible retries. */
  async process(id: string, onPrepared?: (snapshot: StatusAttempt) => void, releaseCardEntry = false): Promise<ProviderIntent | null> {
    // Never claims, reads the provider for, or writes a payment this process may not mutate (no lease is taken, so nothing is held).
    if (!this.mutationsAllowed()) return null;
    const token = randomUUID(); const now = new Date();
    const claim = await paymentOperation('worker_claim', 'database', () => this.database.paymentWork.updateMany({ where: { attemptId: id, ...duePaymentWork(now) },
      data: { state: 'LEASED', leaseToken: token, leaseUntil: new Date(Date.now() + WORK_LEASE_MS) } }));
    if (!claim.count) return null;
    logSafely('info', 'Payment work claimed.', { event: 'payment.work.claimed', attemptId: id, leaseId: token,
      workerInstanceId: logContext.getStore()?.workerInstanceId ?? null,
      correlationId: logContext.getStore()?.requestId ?? null });
    let intent: ProviderIntent | null = null;
    try {
      let attempt = await paymentOperation('worker_attempt_read', 'database', () => this.database.paymentAttempt.findUnique({ where: { id }, include: attemptInclude }));
      if (!attempt) return null;
      let createdIntentNeedsPersistence = false;
      let workFinished = false;
      // Stripe can report a refund as succeeded before a later refund.failed event.
      // A webhook wake must recheck that existing refund, never repeat compensation.
      if (terminal(attempt.state) && !['INCIDENT', 'REFUNDED'].includes(attempt.state)) { await this.finishWork(id, token, true); return null; }
      if (!attempt.providerIntentId) {
        // Never recreate a lost create outcome beyond Stripe's guaranteed idempotency window.
        if (Date.now() - attempt.createdAt.getTime() > 23 * 60 * 60_000) {
          await this.patch(id, token, { state: 'INCIDENT', failureCode: 'PAYMENT_CREATE_IDENTITY_EXPIRED' });
          await this.finishWork(id, token, true); return null;
        }
        intent = await paymentOperation('stripe.create', 'stripe', () => this.provider.create(attempt!));
        if (intent.livemode || intent.account !== attempt.stripeAccountId || intent.attemptId !== id) {
          await this.patch(id, token, { state: 'INCIDENT', failureCode: 'PAYMENT_PROVIDER_BINDING_INVALID' });
          await this.finishWork(id, token, true); return null;
        }
        attempt = { ...attempt, providerIntentId: intent.id, providerStatus: intent.status, state: 'AWAITING_INPUT' };
        createdIntentNeedsPersistence = true;
      } else intent = await paymentOperation('stripe.retrieve', 'stripe', () => this.provider.retrieve(attempt!.providerIntentId!));
      logSafely('info', 'Payment provider observed.', { event: 'payment.provider.observed', attemptId: id,
        workerInstanceId: logContext.getStore()?.workerInstanceId ?? null,
        providerIntentId: intent.id, providerStatus: intent.status, providerDeclined: intent.declined, paymentMethodAttached: Boolean(intent.methodType), leaseId: token, correlationId: logContext.getStore()?.requestId ?? null });
      if (intent.livemode || intent.account !== attempt.stripeAccountId || intent.id !== attempt.providerIntentId || intent.attemptId !== id) {
        await this.patch(id, token, { ...(createdIntentNeedsPersistence ? { providerIntentId: intent.id } : {}),
          state: 'INCIDENT', failureCode: 'PAYMENT_PROVIDER_BINDING_INVALID' });
        await this.finishWork(id, token, true); return null;
      }
      let compatible = true;
      try { verifyBinding(attempt, intent); } catch { compatible = false; }
      if (compatible && (expiryCancellation(attempt) || customerCancellation(attempt) || attempt.cancelRequested && attempt.failureCode === 'PAYMENT_SETUP_SUPERSEDED') &&
        ['requires_capture', 'processing', 'succeeded'].includes(intent.status) ||
        // A Stripe decline recorded meanwhile is a Payment failed (Try Again), never a cancelled purchase.
        compatible && customerCancellation(attempt) && intent.status === 'requires_payment_method' && intent.declined && !intent.received && !intent.capturable) {
        // Older setup decisions may already have persisted an expiry cancellation.
        // Provider authorization/recovery takes precedence over that local decision.
        attempt = await this.fenced(id, token, async (tx, latest) => expiryCancellation(latest) || customerCancellation(latest) ||
          latest.cancelRequested && latest.failureCode === 'PAYMENT_SETUP_SUPERSEDED'
          ? tx.paymentAttempt.update({ where: { id }, data: { cancelRequested: false, failureCode: null }, include: attemptInclude })
          : latest);
      }
      if (releaseCardEntry && compatible && ['requires_payment_method', 'requires_confirmation'].includes(intent.status) &&
        intent.received === 0 && intent.capturable === 0) {
        attempt = await this.fenced(id, token, async (tx, latest) => {
          verifyBinding(latest, intent!);
          return !latest.orderId &&
          ['AWAITING_INPUT', 'DECLINED'].includes(latest.state) && !latest.cancelRequested &&
          (!latest.failureCode || latest.failureCode === 'PAYMENT_DECLINED')
          ? tx.paymentAttempt.update({ where: { id }, data: { cancelRequested: true, failureCode: 'PAYMENT_SETUP_SUPERSEDED' }, include: attemptInclude })
          : latest;
        });
        if (attempt.orderId || !['AWAITING_INPUT', 'DECLINED', 'CANCEL_PENDING'].includes(attempt.state)) {
          await this.finishWork(id, token, false); return intent;
        }
      }
      const canPersistWithFinalState = createdIntentNeedsPersistence && compatible && !attempt.cancelRequested && !attempt.orderId &&
        attempt.expiresAt.getTime() > Date.now() && ['requires_payment_method', 'requires_action', 'processing'].includes(intent.status);
      if (createdIntentNeedsPersistence && !canPersistWithFinalState) {
        attempt = await this.patch(id, token, { providerIntentId: intent.id, providerStatus: intent.status, state: 'AWAITING_INPUT' });
        createdIntentNeedsPersistence = false;
      }
      if (compatible && attempt.confirmationStartedAt && attempt.state === 'AWAITING_INPUT' && !attempt.orderId && !attempt.cancelRequested &&
        attempt.confirmationStartedAt.getTime() + CONFIRMATION_SIGNAL_GRACE_MS <= Date.now() && unrecordedConfirmation(intent)) {
        // The snapshot above may predate a confirmation or decline that Stripe recorded during this pass. Only a fresh read taken after the
        // grace, still showing nothing recorded, proves confirmation never reached Stripe; anything else is reconciled as provider truth.
        const fresh = await paymentOperation('stripe.retrieve', 'stripe', () => this.provider.retrieve(attempt!.providerIntentId!));
        const sameIntent = fresh.id === intent.id && fresh.attemptId === id && !fresh.livemode && fresh.account === intent.account;
        if (sameIntent) {
          try { verifyBinding(attempt, fresh); intent = fresh; } catch { compatible = false; }
        }
        if (sameIntent && compatible && unrecordedConfirmation(intent)) {
          // Clear the intent marker only (no outcome is invented); a late provider result is still reconciled normally and Stripe rejects a
          // second confirmation of a paid intent.
          attempt = await this.fenced(id, token, async (tx, latest) => latest.confirmationStartedAt && latest.state === 'AWAITING_INPUT' && !latest.orderId
            ? tx.paymentAttempt.update({ where: { id }, data: { confirmationStartedAt: null }, include: attemptInclude }) : latest);
        }
      }
      if (intent.status === 'succeeded') {
        if (compatible && intent.received === attempt.amountCents && attempt.orderId && !attempt.refundId && !attempt.compensatedAt) {
          await this.markPaid(attempt, token, intent);
        } else await this.refundUnexpected(attempt, token, intent);
      } else if (intent.status === 'canceled') {
        if (attempt.orderId) await this.compensate(attempt, token, false);
        else await this.patch(id, token, { state: 'CANCELED', providerStatus: 'canceled', activeCartId: null });
      } else if (compatible && neverConfirmedSubmission(attempt, intent)) {
        // Decided on the locked row: a confirmation announced meanwhile (marker set / state changed) wins and nothing is written.
        await this.fenced(id, token, async (tx, latest) => neverConfirmedSubmission(latest, intent!)
          ? tx.paymentAttempt.update({ where: { id }, data: { failureCode: NOT_CONFIRMED_FAILURE_CODE, providerStatus: intent!.status } })
          : null);
        await this.finishWork(id, token, false); return intent;
      } else if (compatible && notConfirmedStillUnrecorded(attempt, intent)) {
        await this.finishWork(id, token, false); return intent;
      } else if (!compatible || explicitCancellation(attempt) || lapsedWithoutPayment(attempt, intent)) {
        // Revalidate and persist the cancellation decision in the SAME fenced transaction.
        // A state transition during provider retrieval must not be overwritten by stale expiry.
        const cancellation = await this.fenced(id, token, async (tx, latest) => {
          if (compatible && !explicitCancellation(latest) && !lapsedWithoutPayment(latest, intent!)) return null;
          return tx.paymentAttempt.update({ where: { id }, data: { state: 'CANCEL_PENDING',
            failureCode: compatible ? latest.failureCode ?? 'PAYMENT_EXPIRED' : 'PAYMENT_AMOUNT_MISMATCH' }, include: attemptInclude });
        });
        if (!cancellation) {
          await this.finishWork(id, token, false); return intent;
        }
        attempt = cancellation;
        intent = await paymentOperation('stripe.cancel', 'stripe', () => this.provider.cancel(attempt!));
        // A fresh read decides compensation; cancellation submission alone proves nothing.
        intent = await paymentOperation('stripe.retrieve', 'stripe', () => this.provider.retrieve(intent!.id));
        if (intent.status === 'canceled') {
          if (attempt.orderId) await this.compensate(attempt, token, false);
          else await this.patch(id, token, { state: 'CANCELED', providerStatus: 'canceled', activeCartId: null });
        }
      } else if (intent.status === 'requires_capture') {
        if (!attempt.orderId) {
          await this.patch(id, token, { state: 'AUTHORIZED', providerStatus: intent.status, authorizationExpiresAt: intent.captureBefore });
          try { await new OrderService(this.database, this.inventory).commitAuthorized(id, intent, token); }
          catch (error) {
            if (error instanceof AppError && error.code !== 'PAYMENT_CLAIM_LOST' && error.statusCode < 500) {
              await this.patch(id, token, { cancelRequested: true, state: 'CANCEL_PENDING', failureCode: error.code ?? 'CHECKOUT_CONFLICT' });
              intent = await paymentOperation('stripe.cancel', 'stripe', () => this.provider.cancel(attempt!));
              if (intent.status === 'canceled') await this.patch(id, token, { state: 'CANCELED', providerStatus: 'canceled', activeCartId: null });
              await this.finishWork(id, token, intent.status === 'canceled'); return intent;
            }
            throw error;
          }
          const committed = await this.database.paymentAttempt.findUnique({ where: { id }, include: attemptInclude });
          if (!committed) throw new AppError('Payment recovery is pending.', 503, 'PAYMENT_RECOVERY_PENDING');
          attempt = committed;
        }
        // This is the immutable CAPTURE decision recorded by the purchase commit.
        await this.assertCurrentClaim(id, token);
        try { intent = await paymentOperation('stripe.capture', 'stripe', () => this.provider.capture(attempt!)); }
        catch (error) {
          if (!(error instanceof AppError) || error.code !== 'PAYMENT_CAPTURE_REJECTED') throw error;
          await this.patch(id, token, { state: 'CANCEL_PENDING', cancelRequested: true, failureCode: error.code });
          // Persist cancellation before touching the provider; a crash resumes this decision rather than another capture.
          intent = await paymentOperation('stripe.retrieve', 'stripe', () => this.provider.retrieve(attempt!.providerIntentId ?? ''));
          if (intent.status !== 'succeeded' && intent.status !== 'canceled') intent = await paymentOperation('stripe.cancel', 'stripe', () => this.provider.cancel(attempt!));
        }
        intent = await paymentOperation('stripe.retrieve', 'stripe', () => this.provider.retrieve(intent!.id));
        if (intent.status === 'succeeded') {
          verifyBinding(attempt, intent);
          if (intent.received === attempt.amountCents) await this.markPaid(attempt, token, intent);
          else await this.refundUnexpected(attempt, token, intent);
        } else if (intent.status === 'canceled') await this.compensate(attempt, token, false);
      } else {
        if (!['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing'].includes(intent.status) || intent.received || intent.capturable) {
          throw new AppError('Payment outcome requires verification.', 503, 'PAYMENT_PROVIDER_UNKNOWN');
        }
        const state = intent.status === 'requires_action' ? 'ACTION_REQUIRED' : intent.status === 'processing' ? 'PROCESSING' :
          intent.status === 'requires_payment_method' && intent.declined ? 'DECLINED' : 'AWAITING_INPUT';
        // A committed purchase cannot revert to ordinary card entry.
        const persistedState = attempt.orderId ? 'CAPTURE_PENDING' : state;
        const persisted = await this.patchAndFinish(id, token, { ...(canPersistWithFinalState ? { providerIntentId: intent.id } : {}),
          state: persistedState, providerStatus: intent.status, failureCode: intent.declined ? 'PAYMENT_DECLINED' : null }, terminal(persistedState) || persistedState === 'DECLINED');
        if (canPersistWithFinalState && persisted.state === 'AWAITING_INPUT') onPrepared?.(persisted);
        workFinished = true;
      }
      if (!workFinished) await this.finishWork(id, token);
      return intent;
    } catch (error) {
      if (error instanceof AppError && error.code === 'PAYMENT_CLAIM_LOST') return null;
      const work = await this.database.paymentWork.findUnique({ where: { attemptId: id } });
      if (work?.leaseToken !== token || !work.leaseUntil || work.leaseUntil.getTime() <= Date.now()) return null;
      const retry = work.retryCount + 1;
      const code = error instanceof AppError ? error.code ?? 'PAYMENT_RECOVERY_PENDING' : 'PAYMENT_PROVIDER_UNKNOWN';
      const category = error instanceof Prisma.PrismaClientKnownRequestError ? `PRISMA_${error.code}` :
        error && typeof error === 'object' && 'type' in error && typeof error.type === 'string' && /^Stripe[A-Za-z]+Error$/.test(error.type)
          ? error.type : error instanceof AppError ? 'APPLICATION' : 'UNKNOWN';
      const safeField = (field: string) => error && typeof error === 'object' && field in error &&
        typeof Reflect.get(error, field) === 'string' && /^[a-z_][a-z_.]{0,79}$/.test(Reflect.get(error, field)) ? Reflect.get(error, field) as string : null;
      logSafely('error', 'Payment work requires reconciliation.', { event: 'payment.recovery.pending', attemptId: id, category, code, retry,
        providerCode: category.startsWith('Stripe') ? safeField('code') : null,
        providerParameter: category.startsWith('Stripe') ? safeField('param') : null });
      await this.fenced(id, token, async (tx, attempt) => {
        if (retry >= MAX_PAYMENT_RETRIES) await tx.paymentAttempt.update({ where: { id }, data: { state: 'INCIDENT', failureCode: code } });
        await tx.paymentWork.update({ where: { attemptId: id }, data: { state: retry >= MAX_PAYMENT_RETRIES ? 'INCIDENT' : 'READY',
          retryCount: retry, nextRunAt: new Date(Date.now() + retryDelay(retry)), leaseToken: null, leaseUntil: null, lastError: code } });
        // Committed purchase state survives unknown capture and process restart.
        void attempt;
      });
      if (retry >= MAX_PAYMENT_RETRIES) logSafely('error', 'Payment recovery requires operator investigation.', {
        event: 'payment.recovery.escalation', attemptId: id, reason: 'RETRY_BUDGET_EXHAUSTED', retry,
        action: 'VERIFY_PROVIDER_AND_RECOVERY_WORK', code,
      });
      return null;
    }
  }
  private async finishWork(id: string, token: string, done?: boolean) {
    await this.fenced(id, token, async (tx, attempt) => {
      const isDone = done ?? terminal(attempt.state);
      await tx.paymentWork.update({ where: { attemptId: id }, data: { state: isDone ? 'DONE' : 'READY',
        nextRunAt: new Date(Date.now() + 10_000), retryCount: 0, leaseToken: null, leaseUntil: null, lastError: null } });
    });
  }
  private async markPaid(attempt: Attempt, token: string, intent: ProviderIntent) {
    verifyBinding(attempt, intent);
    if (intent.status !== 'succeeded' || intent.received !== attempt.amountCents) throw new AppError('Payment is pending.', 409, 'PAYMENT_PENDING');
    const emails = await this.fenced(attempt.id, token, async (tx, latest) => {
      if (!latest.orderId || latest.compensatedAt || latest.refundId) throw new AppError('Payment requires recovery.', 409, 'PAYMENT_RECOVERY_PENDING');
      // A replayed finalization keeps the first successful payment time (it is also the email events' occurredAt).
      const prior = await tx.payment.findUnique({ where: { orderId: latest.orderId }, select: { paidAt: true, status: true } });
      const paidAt = prior?.status === 'SUCCEEDED' && prior.paidAt ? prior.paidAt : new Date();
      await tx.payment.update({ where: { orderId: latest.orderId }, data: { status: 'SUCCEEDED', paidAt, failureReason: null,
        cardBrand: intent.card?.brand ?? null, cardLast4: intent.card?.last4 ?? null } });
      await tx.order.update({ where: { id: latest.orderId }, data: { status: 'CONFIRMED' } });
      await tx.paymentAttempt.update({ where: { id: latest.id }, data: { state: 'PAID', providerStatus: 'succeeded', activeCartId: null, failureCode: null } });
      // Task 03.8: both confirmation events commit atomically with this finalization (never sent here). An unexpected insert
      // failure rolls the whole finalization back; durable recovery then re-reads the already captured intent (no new charge).
      return enqueuePaymentSucceeded(tx, { orderId: latest.orderId, paidAt, card: intent.card });
    });
    logCreatedEvents(emails);
    logSafely('info', 'Captured payment persisted.', { event: 'payment.outcome.persisted', attemptId: attempt.id,
      providerIntentId: intent.id, orderId: attempt.orderId, state: 'PAID', leaseId: token,
      workerInstanceId: logContext.getStore()?.workerInstanceId ?? null,
      correlationId: logContext.getStore()?.requestId ?? null });
  }
  private async refundUnexpected(attempt: Attempt, token: string, intent: ProviderIntent) {
    if (intent.received <= 0) throw new AppError('Captured amount requires review.', 409, 'PAYMENT_RECOVERY_PENDING');
    let saved = await this.patch(attempt.id, token, { state: 'REFUND_PENDING', failureCode: 'PAYMENT_CONSISTENCY_INCIDENT',
      refundAmountCents: attempt.refundAmountCents ?? intent.received });
    const refund = saved.refundId ? await paymentOperation('stripe.retrieveRefund', 'stripe', () => this.provider.retrieveRefund(saved.refundId!))
      : await paymentOperation('stripe.refund', 'stripe', () => this.provider.refund(saved, saved.refundAmountCents ?? intent.received));
    if (refund.intentId !== intent.id || refund.amount !== saved.refundAmountCents) throw new AppError('Refund requires reconciliation.', 409, 'PAYMENT_RECOVERY_PENDING');
    if (!saved.refundId) saved = await this.patch(saved.id, token, { refundId: refund.id });
    if (refund.status === 'succeeded') {
      if (saved.orderId && !saved.compensatedAt) await this.compensate(saved, token, true);
      else await this.patch(saved.id, token, { state: 'REFUNDED', activeCartId: null, providerStatus: 'succeeded' });
    } else if (refund.status === 'failed' || refund.status === 'canceled') {
      await this.fenced(saved.id, token, async (tx, latest) => {
        if (latest.orderId) await tx.payment.update({ where: { orderId: latest.orderId },
          data: { status: 'PROCESSING', refundedAt: null, failureReason: 'PAYMENT_REFUND_INCIDENT' } });
        await tx.paymentAttempt.update({ where: { id: latest.id },
          data: { state: 'INCIDENT', failureCode: 'PAYMENT_REFUND_INCIDENT' } });
      });
    }
  }
  private async compensate(attempt: Attempt, token: string, refunded: boolean) {
    await this.patch(attempt.id, token, { state: refunded ? 'REFUND_PENDING' : 'COMPENSATION_PENDING' });
    const emails = await this.fenced(attempt.id, token, async (tx, latest) => {
      if (!latest.orderId || latest.compensatedAt) return [];
      const payment = await tx.payment.findUnique({ where: { orderId: latest.orderId } });
      if (payment?.status === 'SUCCEEDED' && !refunded) throw new AppError('Captured payment cannot be released.', 409, 'PAYMENT_RECOVERY_PENDING');
      const buyNowScope = isBuyNowRequest(latest.request);
      const cart = !buyNowScope ? await tx.cart.findUnique({ where: { userId: latest.userId } }) : null;
      if (cart) await lockCart(tx, cart.id);
      const ids = latest.items.map(item => item.productId).sort();
      const sqlIds = Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`));
      const productRows = await tx.$queryRaw<{ categoryId: string }[]>(Prisma.sql`SELECT "categoryId" FROM "products" WHERE "id" IN (${sqlIds}) ORDER BY "id" FOR SHARE`);
      const categoryIds = [...new Set(productRows.map(product => product.categoryId))].sort();
      if (categoryIds.length) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "categories" WHERE "id" IN (${Prisma.join(categoryIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR SHARE`);
      await tx.$queryRaw(Prisma.sql`SELECT "productId" FROM "inventory" WHERE "productId" IN (${sqlIds}) ORDER BY "productId" FOR UPDATE`);
      for (const item of latest.items) await this.inventory.increaseStock(item.productId, item.quantity, tx);
      const restoredProducts = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, isTestFixture: true,
        category: { select: { isActive: true } }, inventory: { select: { quantity: true } } } });
      const restored = new Map(restoredProducts.map(product => [product.id, product]));
      const remainder: { productId: string; quantity: number }[] = [];
      const customer = await tx.user.findUnique({ where: { id: latest.userId }, select: { isActive: true } });
      const current = cart && customer?.isActive && !buyNowScope ? await currentCart(latest.userId, tx) : null;
      const restoreCart = Boolean(!latest.submittedAt && cart && cart.id === latest.cartId && cart.id === latest.cartIdentity && current && !current.data.items.length);
      let lineCount = current?.data.items.length ?? MAX_CART_LINES;
      for (const item of latest.items) {
        const old = current?.data.items.find(line => line.productId === item.productId);
        const product = restored.get(item.productId);
        const available = product && !product.isTestFixture && product.status === 'ACTIVE' && product.category.isActive ? product.inventory?.quantity ?? 0 : 0;
        // BUY_NOW compensation only restores stock; it must never merge purchased lines into the persistent Cart.
        const add = !buyNowScope && restoreCart && cart && current && (old || lineCount < MAX_CART_LINES) ? Math.max(0, Math.min(item.quantity,
          MAX_CART_QUANTITY - (old?.quantity ?? 0), available - (old?.quantity ?? 0))) : 0;
        if (add && cart) {
          await tx.cartItem.upsert({ where: { cartId_productId: { cartId: cart.id, productId: item.productId } },
            create: { cartId: cart.id, productId: item.productId, quantity: add }, update: { quantity: { increment: add } } });
          if (!old) lineCount++;
        }
        if (add < item.quantity && !buyNowScope) remainder.push({ productId: item.productId, quantity: item.quantity - add });
      }
      const before = await tx.order.findUnique({ where: { id: latest.orderId }, select: { status: true } });
      const cancelledAt = new Date();
      await tx.order.update({ where: { id: latest.orderId }, data: { status: 'CANCELLED' } });
      // Task 04.5: cancelling for an anonymized owner ends the need for retained shipping/location data (privacy only, no payment write).
      await redactDeliveryForDeletedOwner(tx, latest.orderId);
      await tx.payment.update({ where: { orderId: latest.orderId }, data: { status: refunded ? 'REFUNDED' : 'FAILED',
        refundedAt: refunded ? cancelledAt : null, failureReason: 'PAYMENT_COMPENSATED' } });
      await tx.paymentAttempt.update({ where: { id: latest.id }, data: { state: refunded ? 'REFUNDED' : 'COMPENSATED',
        compensatedAt: cancelledAt, activeCartId: null, recoveryRemainder: remainder } });
      // Task 03.8: the cancellation (and, only when this transition records a verified refund, the refund) events commit with it.
      // compensatedAt above makes a replay return early, so a retried compensation never emits a second event.
      if (!before) return [];
      return enqueueCancellation(tx, { orderId: latest.orderId, fromStatus: before.status, cancelledAt, paymentConfirmed: Boolean(payment?.paidAt),
        refund: refunded && latest.refundId && latest.refundAmountCents ? { id: latest.refundId, amountCents: latest.refundAmountCents, refundedAt: cancelledAt } : null });
    });
    logCreatedEvents(emails);
  }

  /** `scope`: exact attempt IDs, or (governed DEV) only attempts created at/after a boundary. Undefined = unscoped (production). */
  async runBatch(scope?: PaymentWorkScope) {
    if (!this.mutationsAllowed()) return 0;
    const now = new Date();
    const due = await this.database.paymentWork.findMany({ where: { ...paymentWorkScopeWhere(scope), ...duePaymentWork(now) },
      orderBy: { nextRunAt: 'asc' }, take: 10, select: { attemptId: true } });
    const failures: unknown[] = [];
    for (const work of due) {
      try { await logContext.run({ ...logContext.getStore(), requestId: randomUUID() }, () => this.process(work.attemptId)); }
      catch (error) {
        failures.push(error);
        logSafely('error', 'Payment recovery job could not finish; remaining jobs will continue.', {
          event: 'payment.recovery.job_failed', attemptId: work.attemptId, error,
        });
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Payment recovery batch has unfinished jobs.');
    return due.length;
  }
}
export const paymentService = new PaymentService();
