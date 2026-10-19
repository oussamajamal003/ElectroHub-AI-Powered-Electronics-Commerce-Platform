/**
 * Task 03.8 transactional producer. Every function here takes the CALLER's Prisma transaction client and only reads and
 * inserts rows inside it: the commerce email event commits or rolls back with the business transition that justifies it.
 * No provider call, rendering, network I/O or waiting happens here. Expected duplicate keys are absorbed with
 * `ON CONFLICT DO NOTHING` (which does not abort a PostgreSQL transaction); any other insert failure propagates.
 */
import { randomUUID } from 'node:crypto';
import { Prisma, type OrderStatus } from '@prisma/client';
import { AppError } from '../middleware/errorHandler.js';
import { deliveryMethods } from './checkout.domain.js';
import { commerceEmailConfig, safeEmailImageUrl } from './commerce-email.config.js';
import { SNAPSHOT_VERSION, TEMPLATE_VERSION, commerceEmailSnapshot, eventKeys, orderReference, usableRecipient,
  type CommerceEmailType, type SuppressionReason } from './commerce-email.domain.js';
import { logSafely } from '../utils/logger.js';

type Tx = Prisma.TransactionClient;
/** Database time in UTC, matching how Prisma stores `TIMESTAMP(3)` values. */
export const DB_NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
export const utc = (value: Date) => Prisma.sql`(${value.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

export interface CreatedCommerceEmail { id: string; type: CommerceEmailType; orderId: string; suppressed: boolean }
interface EventInput {
  key: string; type: CommerceEmailType; orderId: string; paymentId: string | null; userId: string; occurredAt: Date;
  transition?: { id: string; from: OrderStatus; to: OrderStatus };
  account: { email: string | null; isActive: boolean } | null;
  snapshot: Record<string, unknown>;
}

/** Producer activation switch (§13). Disabled means no event exists, and the customer projection then claims nothing. */
export function commerceEmailEnqueueEnabled() {
  const enabled = commerceEmailConfig().enqueueEnabled;
  if (!enabled) noteProducerDisabled();
  return enabled;
}

let producerSkipped = 0;
/**
 * A disabled producer must never look like a healthy one: every successful purchase in this process creates NO email events. Logged on the
 * first occurrence and every 50th afterwards (counts only, no order or customer data), so the condition is visible without flooding logs.
 */
function noteProducerDisabled() {
  producerSkipped += 1;
  if (producerSkipped === 1 || producerSkipped % 50 === 0) {
    logSafely('warn', 'Commerce email producer is disabled: payment and order events create no email events in this process.', {
      event: 'email_producer_disabled', skippedSinceStart: producerSkipped, enable: 'COMMERCE_EMAIL_ENQUEUE_ENABLED' });
  }
}

async function insertEvent(tx: Tx, input: EventInput): Promise<CreatedCommerceEmail | null> {
  const recipient = usableRecipient(input.account);
  const parsed = commerceEmailSnapshot.safeParse(input.snapshot);
  const suppression: SuppressionReason | null = 'suppression' in recipient ? recipient.suppression : parsed.success ? null : 'SNAPSHOT_INVALID';
  const snapshot = suppression
    ? { v: SNAPSHOT_VERSION, type: input.type, orderReference: orderReference(input.orderId), occurredAt: input.occurredAt.toISOString(), suppressed: true }
    : parsed.data;
  const id = randomUUID();
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO "commerce_email_outbox" ("id", "eventKey", "type", "orderId", "paymentId", "userId", "transitionId", "fromStatus", "toStatus",
      "recipient", "snapshot", "snapshotVersion", "templateVersion", "occurredAt", "dispatchState", "suppressionReason",
      "nextAttemptAt", "createdAt", "updatedAt")
    VALUES (${id}::uuid, ${input.key}, ${input.type}::"CommerceEmailType", ${input.orderId}::uuid, ${input.paymentId}::uuid, ${input.userId}::uuid,
      ${input.transition?.id ?? null}::uuid, ${input.transition?.from ?? null}, ${input.transition?.to ?? null},
      ${'recipient' in recipient ? recipient.recipient : null}, ${JSON.stringify(snapshot)}::jsonb, ${SNAPSHOT_VERSION}, ${TEMPLATE_VERSION},
      ${utc(input.occurredAt)}, ${suppression ? 'SUPPRESSED' : 'READY'}::"CommerceEmailDispatchState", ${suppression},
      ${DB_NOW}, ${DB_NOW}, ${DB_NOW})
    ON CONFLICT ("eventKey") DO NOTHING
    RETURNING "id"`);
  if (!rows.length) {
    // Idempotent replay: the original event (and its snapshot) stands. A key reused for a different aggregate is a defect.
    const existing = await tx.commerceEmailOutbox.findUnique({ where: { eventKey: input.key }, select: { type: true, orderId: true, paymentId: true } });
    if (!existing || existing.type !== input.type || existing.orderId !== input.orderId || existing.paymentId !== input.paymentId) {
      throw new AppError('Commerce email event identity conflict.', 409, 'COMMERCE_EMAIL_KEY_CONFLICT');
    }
    return null;
  }
  if (suppression) logSafely('error', 'Commerce email event suppressed at creation.', { event: 'email_event_suppressed',
    outboxId: id, type: input.type, orderId: input.orderId, reason: suppression, committed: false });
  return { id, type: input.type, orderId: input.orderId, suppressed: Boolean(suppression) };
}

/** Logged by callers only after their transaction committed: the log is never the queue. */
export function logCreatedEvents(events: readonly (CreatedCommerceEmail | null)[]) {
  for (const created of events) if (created) logSafely('info', 'Commerce email event created.', { event: 'email_event_created',
    outboxId: created.id, type: created.type, orderId: created.orderId, templateVersion: TEMPLATE_VERSION, suppressed: created.suppressed });
}

const decimal = (value: Prisma.Decimal) => value.toFixed(2);
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const firstName = (value: string | null | undefined) => value?.trim().slice(0, 100) || null;
async function orderFacts(tx: Tx, orderId: string) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: {
    items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, payment: true,
    user: { select: { email: true, isActive: true, firstName: true } } } });
  if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
  return order;
}
type OrderFacts = Awaited<ReturnType<typeof orderFacts>>;
const delivery = (order: OrderFacts) => ({ method: order.deliveryMethod,
  label: deliveryMethods.find(method => method.id === order.deliveryMethod)?.label ?? order.deliveryMethod,
  estimatedStart: dateOnly(order.estimatedDeliveryStart), estimatedEnd: dateOnly(order.estimatedDeliveryEnd) });
const common = (order: OrderFacts, occurredAt: Date) => ({ v: SNAPSHOT_VERSION, orderReference: orderReference(order.id),
  occurredAt: occurredAt.toISOString(), recipientName: firstName(order.user.firstName) });

/**
 * ORDER_CONFIRMED + PAYMENT_CONFIRMED, from the committed Order's immutable purchase snapshot and the verified Payment, inside the
 * payment finalization transaction (PaymentService.markPaid). `card` is the provider-verified brand/last4 just persisted.
 */
export async function enqueuePaymentSucceeded(tx: Tx, input: { orderId: string; paidAt: Date; card: { brand: string; last4: string } | null }) {
  if (!commerceEmailEnqueueEnabled()) return [];
  const order = await orderFacts(tx, input.orderId);
  if (!order.payment || order.payment.status !== 'SUCCEEDED' || order.status !== 'CONFIRMED') {
    throw new AppError('Payment confirmation emails require a confirmed paid order.', 409, 'COMMERCE_EMAIL_NOT_AUTHORITATIVE');
  }
  const account = order.user;
  const base = common(order, input.paidAt);
  // Optional product images are kept only from approved asset hosts; an unsafe image is dropped, never the email.
  const imageSources = commerceEmailConfig().imageSources;
  const card = input.card && /^[a-z_]{1,32}$/.test(input.card.brand) && /^\d{4}$/.test(input.card.last4) ? input.card : null;
  return [
    await insertEvent(tx, { key: eventKeys.orderConfirmed(order.id), type: 'ORDER_CONFIRMED', orderId: order.id, paymentId: null,
      userId: order.userId, occurredAt: input.paidAt, account, snapshot: { ...base, type: 'ORDER_CONFIRMED',
        items: order.items.map(item => ({ name: item.productName, sku: item.sku, quantity: item.quantity, unitPrice: decimal(item.unitPrice),
          lineTotal: decimal(item.lineTotal), imageUrl: safeEmailImageUrl(item.productImageUrl, imageSources) })),
        subtotal: decimal(order.subtotal), shipping: decimal(order.shippingCost), total: decimal(order.total), currency: order.currency,
        delivery: delivery(order),
        shippingAddress: { recipient: order.shippingRecipient, line1: order.shippingLine1, line2: order.shippingLine2, city: order.shippingCity,
          state: order.shippingState, postalCode: order.shippingPostalCode, country: order.shippingCountry } } }),
    await insertEvent(tx, { key: eventKeys.paymentSucceeded(order.payment.id), type: 'PAYMENT_CONFIRMED', orderId: order.id,
      paymentId: order.payment.id, userId: order.userId, occurredAt: input.paidAt, account, snapshot: { ...base, type: 'PAYMENT_CONFIRMED',
        amount: decimal(order.payment.amount), currency: order.payment.currency, paidAt: input.paidAt.toISOString(), card } }),
  ];
}

/**
 * ORDER_CANCELLED (and PAYMENT_REFUNDED when the same transition recorded a verified successful refund), inside the transaction
 * that persisted the cancellation (PaymentService.compensate). `fromStatus` is the Order status read before that write.
 */
export async function enqueueCancellation(tx: Tx, input: { orderId: string; fromStatus: OrderStatus; cancelledAt: Date; paymentConfirmed: boolean;
  refund: { id: string; amountCents: number; refundedAt: Date } | null }) {
  if (!commerceEmailEnqueueEnabled() || input.fromStatus === 'CANCELLED') return [];
  const order = await orderFacts(tx, input.orderId);
  if (order.status !== 'CANCELLED') throw new AppError('Cancellation email requires a persisted cancellation.', 409, 'COMMERCE_EMAIL_NOT_AUTHORITATIVE');
  const refund = input.refund && order.payment?.status === 'REFUNDED' ? input.refund : null;
  const refundAmount = refund ? new Prisma.Decimal(refund.amountCents).div(100).toFixed(2) : null;
  const transitionId = randomUUID();
  const created = [await insertEvent(tx, { key: eventKeys.orderTransition(order.id, transitionId), type: 'ORDER_CANCELLED', orderId: order.id,
    paymentId: null, userId: order.userId, occurredAt: input.cancelledAt, transition: { id: transitionId, from: input.fromStatus, to: 'CANCELLED' },
    account: order.user, snapshot: { ...common(order, input.cancelledAt), type: 'ORDER_CANCELLED', fromStatus: input.fromStatus, toStatus: 'CANCELLED',
      paymentConfirmed: input.paymentConfirmed, refund: refund && refundAmount ? { amount: refundAmount, currency: order.currency } : null } })];
  if (refund && refundAmount && order.payment) created.push(await insertEvent(tx, { key: eventKeys.paymentRefund(order.payment.id, refund.id),
    type: 'PAYMENT_REFUNDED', orderId: order.id, paymentId: order.payment.id, userId: order.userId, occurredAt: refund.refundedAt, account: order.user,
    snapshot: { ...common(order, refund.refundedAt), type: 'PAYMENT_REFUNDED', refundId: refund.id, amount: refundAmount, currency: order.currency,
      refundedAt: refund.refundedAt.toISOString() } }));
  return created;
}

const FULFILLMENT_TRANSITIONS: Partial<Record<OrderStatus, { to: OrderStatus; type: CommerceEmailType }>> = {
  CONFIRMED: { to: 'PREPARING', type: 'ORDER_PREPARING' },
  PREPARING: { to: 'OUT_FOR_DELIVERY', type: 'ORDER_OUT_FOR_DELIVERY' },
  OUT_FOR_DELIVERY: { to: 'DELIVERED', type: 'ORDER_DELIVERED' },
};
/**
 * Producer contract for the future fulfillment writer (Task 05.4): performs ONE genuine forward Order status transition under the Order
 * row lock and records its notification in the same caller transaction. Replaying an already-reached status is a no-op that emits
 * nothing; a later genuine transition always receives a new transition identity. No route exposes this in Task 03.8.
 */
export async function transitionFulfillment(tx: Tx, input: { orderId: string; to: OrderStatus; occurredAt?: Date; transitionId?: string }) {
  const rows = await tx.$queryRaw<{ status: OrderStatus }[]>(Prisma.sql`SELECT "status"::text AS "status" FROM "orders" WHERE "id" = ${input.orderId}::uuid FOR UPDATE`);
  const from = rows[0]?.status;
  if (!from) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
  if (from === input.to) return { changed: false as const, event: null };
  const next = FULFILLMENT_TRANSITIONS[from];
  if (!next || next.to !== input.to) throw new AppError('This order status change is not allowed.', 409, 'ORDER_TRANSITION_INVALID');
  await tx.order.update({ where: { id: input.orderId }, data: { status: input.to } });
  if (!commerceEmailEnqueueEnabled()) return { changed: true as const, event: null };
  const occurredAt = input.occurredAt ?? new Date();
  const transitionId = input.transitionId ?? randomUUID();
  const order = await orderFacts(tx, input.orderId);
  const transition = { fromStatus: from, toStatus: input.to };
  const snapshot = next.type === 'ORDER_DELIVERED' ? { ...common(order, occurredAt), type: next.type, ...transition }
    : { ...common(order, occurredAt), type: next.type, ...transition, delivery: delivery(order) };
  const event = await insertEvent(tx, { key: eventKeys.orderTransition(order.id, transitionId), type: next.type, orderId: order.id, paymentId: null,
    userId: order.userId, occurredAt, transition: { id: transitionId, from, to: input.to }, account: order.user, snapshot });
  return { changed: true as const, event };
}
