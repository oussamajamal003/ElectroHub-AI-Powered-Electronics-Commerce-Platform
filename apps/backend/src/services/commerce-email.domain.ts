/**
 * Task 03.8 commerce email contracts. Pure: no I/O, no Prisma client, no provider.
 *
 * An outbox row is one logical business event (stable `eventKey`), written in the same transaction as the authoritative
 * Order/Payment transition. Its snapshot is the immutable, minimum set of event-time facts the renderer needs; nothing is
 * re-derived later from mutable Product, address-book, account or cart records.
 */
import { z } from 'zod';

export const COMMERCE_EMAIL_TYPES = ['ORDER_CONFIRMED', 'PAYMENT_CONFIRMED', 'ORDER_PREPARING', 'ORDER_OUT_FOR_DELIVERY',
  'ORDER_DELIVERED', 'ORDER_CANCELLED', 'PAYMENT_REFUNDED'] as const;
export type CommerceEmailType = typeof COMMERCE_EMAIL_TYPES[number];
export const PAYMENT_EMAIL_TYPES: readonly CommerceEmailType[] = ['PAYMENT_CONFIRMED', 'PAYMENT_REFUNDED'];
export const TRANSITION_EMAIL_TYPES: readonly CommerceEmailType[] = ['ORDER_PREPARING', 'ORDER_OUT_FOR_DELIVERY', 'ORDER_DELIVERED', 'ORDER_CANCELLED'];
/** The two initial confirmations the customer-facing projection summarizes. */
export const CONFIRMATION_EMAIL_TYPES = ['ORDER_CONFIRMED', 'PAYMENT_CONFIRMED'] as const;

export const SNAPSHOT_VERSION = 1;
export const TEMPLATE_VERSION = 'v1';

export const eventKeys = {
  orderConfirmed: (orderId: string) => `order:${orderId}:confirmed`,
  paymentSucceeded: (paymentId: string) => `payment:${paymentId}:succeeded`,
  orderTransition: (orderId: string, transitionId: string) => `order:${orderId}:transition:${transitionId}`,
  paymentRefund: (paymentId: string, refundId: string) => `payment:${paymentId}:refund:${refundId}`,
} as const;

export const orderReference = (orderId: string) => `ORD-${orderId.toUpperCase()}`;

// ─── Snapshot v1 ────────────────────────────────────────────────────────────────────────────────────────────────────
const money = z.string().regex(/^\d{1,10}\.\d{2}$/, 'exact two-decimal amount');
const currency = z.string().regex(/^[A-Z]{3}$/);
const instant = z.string().datetime({ offset: false });
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().min(1).max(max);
const reference = z.string().regex(/^ORD-[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
const fulfillmentStatus = z.enum(['AWAITING_CAPTURE', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']);
const delivery = z.object({ method: z.enum(['STANDARD', 'EXPRESS', 'OVERNIGHT']), label: text(100),
  estimatedStart: dateOnly, estimatedEnd: dateOnly }).strict();
/** Only HTTPS images are ever rendered; anything else is dropped at snapshot time. */
const httpsImage = z.string().max(2048).regex(/^https:\/\/[^\s"'<>]+$/).nullable();

const base = { v: z.literal(SNAPSHOT_VERSION), orderReference: reference, occurredAt: instant, recipientName: text(100).nullable() };

export const orderConfirmedSnapshot = z.object({ ...base, type: z.literal('ORDER_CONFIRMED'),
  items: z.array(z.object({ name: text(255), sku: text(100), quantity: z.number().int().positive().max(999),
    unitPrice: money, lineTotal: money, imageUrl: httpsImage }).strict()).min(1).max(100),
  subtotal: money, shipping: money, total: money, currency, delivery,
  shippingAddress: z.object({ recipient: text(200), line1: text(255), line2: z.string().max(255).nullable(), city: text(100),
    state: z.string().max(100).nullable(), postalCode: z.string().max(20).nullable(), country: text(100) }).strict(),
}).strict();
export const paymentConfirmedSnapshot = z.object({ ...base, type: z.literal('PAYMENT_CONFIRMED'),
  amount: money, currency, paidAt: instant,
  card: z.object({ brand: z.string().regex(/^[a-z_]{1,32}$/), last4: z.string().regex(/^\d{4}$/) }).strict().nullable(),
}).strict();
const transition = { fromStatus: fulfillmentStatus, toStatus: fulfillmentStatus };
export const orderPreparingSnapshot = z.object({ ...base, type: z.literal('ORDER_PREPARING'), ...transition, delivery }).strict();
export const orderOutForDeliverySnapshot = z.object({ ...base, type: z.literal('ORDER_OUT_FOR_DELIVERY'), ...transition, delivery }).strict();
export const orderDeliveredSnapshot = z.object({ ...base, type: z.literal('ORDER_DELIVERED'), ...transition }).strict();
export const orderCancelledSnapshot = z.object({ ...base, type: z.literal('ORDER_CANCELLED'), ...transition,
  /** True only when a successful payment had been recorded for this Order before cancellation. */
  paymentConfirmed: z.boolean(),
  /** Present only when the same persisted transition recorded a verified successful refund. */
  refund: z.object({ amount: money, currency }).strict().nullable(),
}).strict();
export const paymentRefundedSnapshot = z.object({ ...base, type: z.literal('PAYMENT_REFUNDED'),
  refundId: z.string().regex(/^[A-Za-z0-9_]{1,255}$/), amount: money, currency, refundedAt: instant,
}).strict();

export const commerceEmailSnapshot = z.discriminatedUnion('type', [orderConfirmedSnapshot, paymentConfirmedSnapshot,
  orderPreparingSnapshot, orderOutForDeliverySnapshot, orderDeliveredSnapshot, orderCancelledSnapshot, paymentRefundedSnapshot]);
export type CommerceEmailSnapshot = z.infer<typeof commerceEmailSnapshot>;
export type SnapshotOf<T extends CommerceEmailType> = Extract<CommerceEmailSnapshot, { type: T }>;

/** A SUPPRESSED event keeps identity and audit context only; it is never sendable. */
export const suppressedSnapshot = z.object({ v: z.literal(SNAPSHOT_VERSION), type: z.enum(COMMERCE_EMAIL_TYPES),
  orderReference: reference, occurredAt: instant, suppressed: z.literal(true) }).strict();
export type SuppressedSnapshot = z.infer<typeof suppressedSnapshot>;

// ─── Recipient ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** SNAPSHOT_INVALID: event-time facts failed validation; the event is kept for audit and never sent, the transition still commits. */
export const SUPPRESSION_REASONS = ['RECIPIENT_UNAVAILABLE', 'ACCOUNT_INACTIVE', 'SNAPSHOT_INVALID'] as const;
export type SuppressionReason = typeof SUPPRESSION_REASONS[number];
const recipientSchema = z.string().email().max(255);
/** Trusted account email at event time, normalized; null when there is no usable address (the event is then SUPPRESSED). */
export function usableRecipient(account: { email: string | null; isActive: boolean } | null): { recipient: string } | { suppression: SuppressionReason } {
  if (!account) return { suppression: 'RECIPIENT_UNAVAILABLE' };
  if (!account.isActive) return { suppression: 'ACCOUNT_INACTIVE' };
  const normalized = account.email?.trim().toLowerCase() ?? '';
  // Deleted accounts are rewritten to this reserved domain (account-deletion.service.ts).
  if (!recipientSchema.safeParse(normalized).success || normalized.endsWith('@deleted.invalid')) return { suppression: 'RECIPIENT_UNAVAILABLE' };
  return { recipient: normalized };
}

// ─── Customer projection ────────────────────────────────────────────────────────────────────────────────────────────
export const EMAIL_CONFIRMATION_STATES = ['QUEUED', 'DELAYED', 'SENT', 'DELIVERED', 'PARTIAL', 'UNAVAILABLE'] as const;
export type EmailConfirmationState = typeof EMAIL_CONFIRMATION_STATES[number];
export interface EmailConfirmationSummary { state: EmailConfirmationState; updatedAt: string }
export type DispatchState = 'READY' | 'LEASED' | 'RETRY_WAIT' | 'ACCEPTED' | 'UNCERTAIN' | 'FAILED' | 'SUPPRESSED';
export type DeliveryState = 'UNKNOWN' | 'DELIVERED' | 'BOUNCED' | 'BLOCKED';
export interface ConfirmationEventFacts { type: string; dispatchState: DispatchState; deliveryState: DeliveryState;
  attemptCount: number; createdAt: Date; updatedAt: Date }
/** Queued work older than this is shown as delayed. Presentation only; never changes dispatch. */
export const EMAIL_DELAYED_AFTER_MS = 5 * 60_000;

/**
 * Aggregates the two initial confirmations. Precedence: both DELIVERED → DELIVERED; both accepted without bounce/block → SENT;
 * any mix of accepted and not accepted → PARTIAL; both still pending → QUEUED/DELAYED; anything else → UNAVAILABLE.
 * No rows (historical orders, enqueue disabled) → null: callers omit the object instead of inventing QUEUED.
 */
export function projectEmailConfirmation(rows: readonly ConfirmationEventFacts[], now = Date.now()): EmailConfirmationSummary | null {
  const events = CONFIRMATION_EMAIL_TYPES.map(type => rows.find(row => row.type === type));
  const present = events.filter((row): row is ConfirmationEventFacts => Boolean(row));
  if (!present.length) return null;
  const updatedAt = new Date(Math.max(...present.map(row => row.updatedAt.getTime()))).toISOString();
  const accepted = (row?: ConfirmationEventFacts) => row?.dispatchState === 'ACCEPTED' && !['BOUNCED', 'BLOCKED'].includes(row.deliveryState);
  const pending = (row?: ConfirmationEventFacts) => Boolean(row && ['READY', 'LEASED', 'RETRY_WAIT'].includes(row.dispatchState));
  if (events.every(row => accepted(row) && row!.deliveryState === 'DELIVERED')) return { state: 'DELIVERED', updatedAt };
  if (events.every(accepted)) return { state: 'SENT', updatedAt };
  if (events.some(accepted)) return { state: 'PARTIAL', updatedAt };
  if (events.every(pending)) {
    const delayed = present.some(row => row.dispatchState === 'RETRY_WAIT' || row.attemptCount > 0 || now - row.createdAt.getTime() > EMAIL_DELAYED_AFTER_MS);
    return { state: delayed ? 'DELAYED' : 'QUEUED', updatedAt };
  }
  return { state: 'UNAVAILABLE', updatedAt };
}

// ─── Retry policy ───────────────────────────────────────────────────────────────────────────────────────────────────
export const MAX_SEND_ATTEMPTS = 5;
export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000] as const;
export const MAX_RETRY_AGE_MS = 24 * 3_600_000;
export const MAX_RETRY_AFTER_MS = 3_600_000;
/** Delay after failed attempt `attemptNumber` (1-based): fixed ladder, ±10% jitter, a validated Retry-After as a floor (capped). */
export function retryDelayMs(attemptNumber: number, retryAfterMs?: number, random = Math.random) {
  const ladder = RETRY_DELAYS_MS[Math.min(Math.max(attemptNumber, 1), RETRY_DELAYS_MS.length) - 1]!;
  const jittered = Math.round(ladder * (0.9 + 0.2 * random()));
  const floor = retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? Math.min(retryAfterMs, MAX_RETRY_AFTER_MS) : 0;
  return Math.max(jittered, floor);
}

// ─── Provider outcome classification ────────────────────────────────────────────────────────────────────────────────
export type ProviderFailureCategory = 'rejected' | 'timeout' | 'network' | 'connect' | 'invalid_response' | 'configuration' | 'provider_error';
export interface ProviderSendResult { success: boolean; messageId?: string;
  failure?: { category: ProviderFailureCategory; httpStatus?: number; providerCode?: string; retryAfterMs?: number } }
export type SendClassification =
  | { kind: 'ACCEPTED'; messageId: string }
  /** Proven not accepted, temporary: bounded retry. */
  | { kind: 'RETRY'; code: string; httpStatus?: number; retryAfterMs?: number }
  /** Proven not accepted, permanent for this event: no retry. */
  | { kind: 'PERMANENT'; code: string; httpStatus?: number }
  /** Account/configuration problem: pause all commerce sends; this event is not consumed beyond its attempt. */
  | { kind: 'PAUSE'; code: string; httpStatus?: number }
  /** The provider may have accepted: never resent automatically. */
  | { kind: 'UNCERTAIN'; code: string; httpStatus?: number };

/** Decided from structured transport facts only, never from human-readable error text. Missing metadata fails to UNCERTAIN. */
export function classifySendResult(result: ProviderSendResult): SendClassification {
  if (result.success) {
    return result.messageId && /^[\x21-\x7e]{1,255}$/.test(result.messageId)
      ? { kind: 'ACCEPTED', messageId: result.messageId } : { kind: 'UNCERTAIN', code: 'PROVIDER_INVALID_SUCCESS' };
  }
  const failure = result.failure;
  if (!failure) return { kind: 'UNCERTAIN', code: 'PROVIDER_OUTCOME_UNKNOWN' };
  const httpStatus = failure.httpStatus;
  switch (failure.category) {
    case 'configuration': return { kind: 'PAUSE', code: 'PROVIDER_NOT_CONFIGURED' };
    case 'connect': return { kind: 'RETRY', code: 'PROVIDER_UNREACHABLE' };
    case 'timeout': return { kind: 'UNCERTAIN', code: 'PROVIDER_TIMEOUT' };
    case 'invalid_response': return { kind: 'UNCERTAIN', code: 'PROVIDER_INVALID_RESPONSE' };
    case 'network': case 'provider_error': return { kind: 'UNCERTAIN', code: 'PROVIDER_NETWORK' };
    case 'rejected': {
      if (httpStatus === 429) return { kind: 'RETRY', code: 'PROVIDER_RATE_LIMITED', httpStatus, retryAfterMs: failure.retryAfterMs };
      if (httpStatus === 401 || httpStatus === 403) return { kind: 'PAUSE', code: 'PROVIDER_AUTH_REJECTED', httpStatus };
      if (httpStatus === 408 || httpStatus === undefined || httpStatus >= 500) return { kind: 'UNCERTAIN', code: 'PROVIDER_SERVER_ERROR', httpStatus };
      return { kind: 'PERMANENT', code: 'PROVIDER_REJECTED', httpStatus };
    }
  }
  return { kind: 'UNCERTAIN', code: 'PROVIDER_OUTCOME_UNKNOWN' };
}

// ─── Rendering contract ─────────────────────────────────────────────────────────────────────────────────────────────
export interface RenderedCommerceEmail { subject: string; preheader: string; html: string; text: string }
export interface RenderContext { /** Validated trusted frontend origin, e.g. https://electrohub.example (no trailing slash). */ origin: string }
