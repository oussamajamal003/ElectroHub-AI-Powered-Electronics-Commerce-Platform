import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  DOCUMENT_KINDS, DOCUMENT_LIMITS, DOCUMENT_POLICY, SELLER_PROFILE_VERSION, SNAPSHOT_VERSION, TEMPLATE_VERSION,
  type DocumentKind, type DocumentSnapshotV1, type PaymentEvidence, type UnavailableReason,
} from '../documents/document.types.js';

/**
 * Task 03.9 document authority (pure; no database, provider, filesystem or clock-dependent content).
 * One eligibility function serves metadata listing and PDF rendering, so a weaker rule can never exist in one path only.
 */

/** Exactly the committed facts the document service selects (one owner-scoped joined read). */
export interface DocumentSourceOrder {
  id: string;
  userId: string;
  status: string;
  currency: string;
  subtotal: Prisma.Decimal;
  shippingCost: Prisma.Decimal;
  total: Prisma.Decimal;
  createdAt: Date;
  deliveryMethod: string;
  estimatedDeliveryStart: Date;
  estimatedDeliveryEnd: Date;
  shippingRecipient: string;
  shippingLine1: string;
  shippingLine2: string | null;
  shippingCity: string;
  shippingState: string | null;
  shippingPostalCode: string | null;
  shippingCountry: string;
  items: { id: string; productName: string; sku: string; unitPrice: Prisma.Decimal; quantity: number; lineTotal: Prisma.Decimal; createdAt: Date }[];
  payment: {
    id: string; provider: string; providerPaymentId: string | null; status: string; amount: Prisma.Decimal; currency: string;
    paidAt: Date | null; cardBrand: string | null; cardLast4: string | null; refundedAt: Date | null;
  } | null;
  paymentAttempt: {
    userId: string; providerIntentId: string | null; amountCents: number; currency: string; total: Prisma.Decimal; state: string;
    refundId: string | null; refundAmountCents: number | null;
  } | null;
}

export const SUPPORTED_CURRENCIES = ['USD'] as const;
const MAX_MONEY = new Prisma.Decimal('9999999999.99'); // Decimal(12,2)
const MAX_QUANTITY = 999;
/** Prisma's @default(now()) and the payment finalizer share the API clock; this only absorbs sub-minute ordering noise. */
const PAID_BEFORE_ORDER_TOLERANCE_MS = 60_000;
const FULFILLED_STATUSES = new Set(['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']);

export type PaymentProof =
  | { proven: true; paidAt: Date; amount: string; refundedAt: Date | null; refundAmount: string | null }
  | { proven: false; reason: UnavailableReason; evidence: PaymentEvidence };

export type SnapshotCheck = { ok: true } | { ok: false; reason: UnavailableReason };

export interface DocumentDecision {
  kind: DocumentKind;
  available: boolean;
  reason: UnavailableReason | null;
  snapshot: DocumentSnapshotV1 | null;
  contentVersion: string | null;
}

const isMoney = (value: Prisma.Decimal) => value.isFinite() && !value.isNegative() && value.decimalPlaces() <= 2 && value.lte(MAX_MONEY);
const validDate = (value: Date | null | undefined): value is Date => value instanceof Date && Number.isFinite(value.getTime());

/**
 * Valid order snapshot (V, §4.1): supported currency, bounded item lines, exact Decimal reconciliation and required address/date
 * facts. Mismatches are never repaired or balanced with an invented adjustment.
 */
export function validateOrderSnapshot(order: DocumentSourceOrder): SnapshotCheck {
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(order.currency)) return { ok: false, reason: 'UNSUPPORTED_CURRENCY' };
  if (order.items.length > DOCUMENT_LIMITS.maxItems) return { ok: false, reason: 'DOCUMENT_TOO_LARGE' };
  if (order.items.length === 0) return { ok: false, reason: 'DATA_INCOMPLETE' };
  if (!validDate(order.createdAt) || !validDate(order.estimatedDeliveryStart) || !validDate(order.estimatedDeliveryEnd) ||
    order.estimatedDeliveryEnd.getTime() < order.estimatedDeliveryStart.getTime()) return { ok: false, reason: 'DATA_INCONSISTENT' };
  if (![order.shippingRecipient, order.shippingLine1, order.shippingCity, order.shippingCountry].every(value => displayText(value).length > 0)) {
    return { ok: false, reason: 'DATA_INCOMPLETE' };
  }
  if (![order.subtotal, order.shippingCost, order.total].every(isMoney)) return { ok: false, reason: 'DATA_INCONSISTENT' };
  let sum = new Prisma.Decimal(0);
  for (const item of order.items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) return { ok: false, reason: 'DATA_INCONSISTENT' };
    if (!isMoney(item.unitPrice) || !isMoney(item.lineTotal)) return { ok: false, reason: 'DATA_INCONSISTENT' };
    if (!displayText(item.productName) || !displayText(item.sku)) return { ok: false, reason: 'DATA_INCOMPLETE' };
    if (!item.unitPrice.mul(item.quantity).eq(item.lineTotal)) return { ok: false, reason: 'DATA_INCONSISTENT' };
    sum = sum.plus(item.lineTotal);
  }
  if (!sum.eq(order.subtotal) || !order.subtotal.plus(order.shippingCost).eq(order.total)) return { ok: false, reason: 'DATA_INCONSISTENT' };
  return { ok: true };
}

const notProven = (reason: UnavailableReason, evidence: PaymentEvidence): PaymentProof => ({ proven: false, reason, evidence });

/**
 * Verified original payment (P, §4.1). Persisted Payment facts only: no Stripe call, no repair of a missing paidAt, and a
 * REFUNDED enum alone never establishes the original purchase payment (unexpected-capture compensation produces it without a
 * normal finalization).
 */
export function verifyOriginalPayment(order: DocumentSourceOrder): PaymentProof {
  const payment = order.payment;
  if (!payment) return notProven('PAYMENT_NOT_CONFIRMED', 'NOT_RECORDED');
  if (payment.status === 'PENDING' || payment.status === 'PROCESSING') return notProven('PAYMENT_NOT_CONFIRMED', 'PENDING');
  if (payment.status === 'FAILED') return notProven('PAYMENT_NOT_CONFIRMED', 'FAILED');
  if (payment.status !== 'SUCCEEDED' && payment.status !== 'REFUNDED') return notProven('DATA_INCONSISTENT', 'UNAVAILABLE');
  const refunded = payment.status === 'REFUNDED';
  if (payment.paidAt === null) return refunded ? notProven('HISTORICAL_PAYMENT_UNVERIFIED', 'REFUND_UNVERIFIED') : notProven('DATA_INCOMPLETE', 'UNAVAILABLE');
  if (!validDate(payment.paidAt)) return notProven('DATA_INCONSISTENT', 'UNAVAILABLE');
  if (!payment.providerPaymentId || payment.provider !== 'STRIPE') return notProven('DATA_INCOMPLETE', 'UNAVAILABLE');
  if (payment.currency !== order.currency || !isMoney(payment.amount) || !payment.amount.isPositive() || !payment.amount.eq(order.total)) {
    return notProven('DATA_INCONSISTENT', 'UNAVAILABLE');
  }
  if (payment.paidAt.getTime() < order.createdAt.getTime() - PAID_BEFORE_ORDER_TOLERANCE_MS) return notProven('DATA_INCONSISTENT', 'UNAVAILABLE');
  if (!FULFILLED_STATUSES.has(order.status)) return notProven('DATA_INCONSISTENT', 'UNAVAILABLE');
  if (!refunded && payment.refundedAt !== null) return notProven('DATA_INCONSISTENT', 'UNAVAILABLE');
  if (refunded && payment.refundedAt === null) return notProven('DATA_INCOMPLETE', 'UNAVAILABLE');
  if (refunded && (!validDate(payment.refundedAt) || payment.refundedAt!.getTime() < payment.paidAt.getTime())) return notProven('DATA_INCONSISTENT', 'UNAVAILABLE');
  const attempt = order.paymentAttempt;
  // A missing historical attempt is not disqualifying when the Payment row itself carries complete success facts (legacy path).
  if (attempt) {
    if (attempt.userId !== order.userId || attempt.providerIntentId !== payment.providerPaymentId || attempt.currency !== payment.currency ||
      !attempt.total.eq(order.total) || order.total.mul(100).toFixed(0) !== String(attempt.amountCents)) return notProven('DATA_INCONSISTENT', 'UNAVAILABLE');
    if (attempt.state !== (refunded ? 'REFUNDED' : 'PAID')) return notProven('DATA_INCONSISTENT', 'UNAVAILABLE');
  }
  return { proven: true, paidAt: payment.paidAt, amount: payment.amount.toFixed(2), refundedAt: refunded ? payment.refundedAt : null,
    refundAmount: refunded ? verifiedRefundAmount(order) : null };
}

/** Exact refund amount only from a bound, persisted successful refund outcome; otherwise null ("Refund recorded", no amount). */
function verifiedRefundAmount(order: DocumentSourceOrder) {
  const attempt = order.paymentAttempt;
  const cents = attempt?.refundAmountCents;
  if (!attempt || attempt.state !== 'REFUNDED' || !attempt.refundId || typeof cents !== 'number' || !Number.isSafeInteger(cents) ||
    cents <= 0 || cents > attempt.amountCents) return null;
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** Summary-only payment situation when P is not proven (never asserts a paid state). */
function evidenceOf(proof: PaymentProof): PaymentEvidence { return proof.proven ? 'VERIFIED' : proof.evidence; }

/**
 * Display normalization policy (comparison and rendering only; stored facts are never mutated): NFC, C0/C1 controls become a
 * space, and explicit bidi embedding/override/isolate controls are removed so a saved value cannot reorder references or numbers.
 */
export function displayText(value: string | null | undefined) {
  if (!value) return '';
  return value.normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C]/g, '')
    .replace(/\s+/g, ' ').trim();
}

export const canonicalReference = (orderId: string) => `ORD-${orderId.toUpperCase()}`;
const isoDate = (value: Date) => value.toISOString().slice(0, 10);

/** Deterministic, non-sequential receipt reference derived from the internal Payment identity (which is never exposed). */
export const receiptReference = (paymentId: string) =>
  `RCT-${createHash('sha256').update(`electrohub-receipt:${paymentId}`).digest('hex').slice(0, 12).toUpperCase()}`;

/** Server-generated filename: brand + canonical reference + fixed kind. No customer data, ASCII only, <=120 bytes. */
export const documentFilename = (orderReference: string, kind: DocumentKind) => `ElectroHub-${orderReference}-${kind}.pdf`;

/** Stable JSON: sorted object keys, arrays in their canonical (already sorted) order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const contentVersionOf = (snapshot: DocumentSnapshotV1) =>
  `v1.${createHash('sha256').update(canonicalJson(snapshot)).digest('hex').slice(0, 32)}`;

/** Brand + last four only when both are present and well-formed; otherwise "Card payment" with no placeholder digits. */
function validatedCard(brand: string | null, last4: string | null) {
  return brand && /^[a-z_]{1,32}$/i.test(brand) && last4 && /^\d{4}$/.test(last4)
    ? { cardBrand: brand.toLowerCase(), cardLast4: last4 } : { cardBrand: null, cardLast4: null };
}

function snapshotFor(kind: DocumentKind, order: DocumentSourceOrder, proof: PaymentProof, assetVersion: string): DocumentSnapshotV1 {
  const items = [...order.items].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const locality = [displayText(order.shippingCity), [displayText(order.shippingState), displayText(order.shippingPostalCode)].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
  const receipt = kind === 'receipt';
  const payment = order.payment;
  return {
    version: SNAPSHOT_VERSION, kind, policy: DOCUMENT_POLICY, templateVersion: TEMPLATE_VERSION, assetVersion,
    sellerProfileVersion: SELLER_PROFILE_VERSION, testTransaction: true,
    orderReference: canonicalReference(order.id), purchaseDate: order.createdAt.toISOString(), fulfillmentStatus: order.status,
    currency: 'USD',
    items: receipt ? [] : items.map(item => ({ name: displayText(item.productName), sku: displayText(item.sku), quantity: item.quantity,
      unitPrice: item.unitPrice.toFixed(2), lineTotal: item.lineTotal.toFixed(2) })),
    subtotal: order.subtotal.toFixed(2), shipping: order.shippingCost.toFixed(2), total: order.total.toFixed(2),
    delivery: receipt ? null : { method: order.deliveryMethod, estimateStart: isoDate(order.estimatedDeliveryStart), estimateEnd: isoDate(order.estimatedDeliveryEnd) },
    // Receipts omit shipping identity (§5.3); no phone number is printed on any document.
    shipTo: receipt ? null : { recipient: displayText(order.shippingRecipient),
      lines: [displayText(order.shippingLine1), displayText(order.shippingLine2), locality, displayText(order.shippingCountry)].filter(Boolean) },
    payment: proof.proven ? {
      evidence: 'VERIFIED', paidAt: proof.paidAt.toISOString(), amount: proof.amount, receiptReference: receiptReference(payment!.id),
      ...validatedCard(payment!.cardBrand, payment!.cardLast4),
    } : { evidence: evidenceOf(proof), paidAt: null, amount: null, receiptReference: null, cardBrand: null, cardLast4: null },
    annotation: {
      cancelled: order.status === 'CANCELLED',
      refundedAt: proof.proven ? proof.refundedAt?.toISOString() ?? null
        : payment?.status === 'REFUNDED' && validDate(payment.refundedAt) ? payment.refundedAt.toISOString() : null,
      refundAmount: proof.proven ? proof.refundAmount : null,
    },
  };
}

/**
 * The single eligibility matrix (§4.2). Invoice and receipt require V + P; the Order Summary requires V only and states the
 * actual payment situation. Returns all three kinds in fixed order.
 */
export function evaluateDocuments(order: DocumentSourceOrder, assetVersion: string): DocumentDecision[] {
  const check = validateOrderSnapshot(order);
  const proof = check.ok ? verifyOriginalPayment(order) : null;
  return DOCUMENT_KINDS.map(kind => {
    if (!check.ok) return { kind, available: false, reason: check.reason, snapshot: null, contentVersion: null };
    if (kind !== 'summary' && !proof!.proven) return { kind, available: false, reason: proof!.reason, snapshot: null, contentVersion: null };
    const snapshot = snapshotFor(kind, order, proof!, assetVersion);
    if (Buffer.byteLength(canonicalJson(snapshot), 'utf8') > DOCUMENT_LIMITS.maxCanonicalBytes) {
      return { kind, available: false, reason: 'DOCUMENT_TOO_LARGE' as const, snapshot: null, contentVersion: null };
    }
    return { kind, available: true, reason: null, snapshot, contentVersion: contentVersionOf(snapshot) };
  });
}
