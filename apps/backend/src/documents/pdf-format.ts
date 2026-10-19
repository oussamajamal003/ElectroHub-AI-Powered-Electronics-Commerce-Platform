import type { DocumentKind, DocumentSnapshotV1 } from './document.types.js';

/**
 * Deterministic presentation helpers. Money is formatted from exact decimal strings by string grouping (no Number round trip);
 * instants and dates are formatted in explicit UTC without depending on the server locale, ICU data or timezone.
 */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatMoney(amount: string): string {
  const match = /^(\d+)\.(\d{2})$/.exec(amount);
  if (!match) throw new Error('Invalid money string.');
  return `$${match[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${match[2]}`;
}

export function formatInstant(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match) throw new Error('Invalid instant.');
  return `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}, ${match[4]}:${match[5]} UTC`;
}

export function formatDay(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) throw new Error('Invalid date.');
  return `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`;
}

export const formatEstimate = (start: string, end: string) => start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`;

export const DOCUMENT_TITLES: Record<DocumentKind, { title: string; short: string; qualifier: string }> = {
  invoice: { title: 'Order invoice — commercial transaction statement', short: 'Order invoice (non-tax)', qualifier: 'Not a tax invoice' },
  receipt: { title: 'Payment receipt', short: 'Payment receipt', qualifier: 'Record of a successful card payment — not an invoice' },
  summary: { title: 'Order summary', short: 'Order summary', qualifier: 'Order record — not an invoice or proof of payment' },
};

export const FULFILLMENT_LABELS: Record<string, string> = {
  AWAITING_CAPTURE: 'Awaiting payment confirmation', CONFIRMED: 'Confirmed', PREPARING: 'Preparing', OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered', CANCELLED: 'Cancelled',
};
export const fulfillmentLabel = (status: string) => FULFILLMENT_LABELS[status] ?? 'Status unavailable';

export const DELIVERY_LABELS: Record<string, string> = { STANDARD: 'Standard Delivery', EXPRESS: 'Express Delivery', OVERNIGHT: 'Overnight Delivery' };
export const deliveryLabel = (method: string) => DELIVERY_LABELS[method] ?? 'Delivery';

const CARD_BRANDS: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover',
  diners: 'Diners Club', jcb: 'JCB', unionpay: 'UnionPay', cartes_bancaires: 'Cartes Bancaires' };
export function paymentMethodLabel(snapshot: DocumentSnapshotV1) {
  const { cardBrand, cardLast4 } = snapshot.payment;
  if (!cardBrand || !cardLast4) return 'Card payment';
  return `${CARD_BRANDS[cardBrand] ?? 'Card'} ending ${cardLast4}`;
}

/** The payment line printed on the Order Summary; only VERIFIED ever says "Paid". */
export function paymentStateLabel(snapshot: DocumentSnapshotV1) {
  const { payment, annotation } = snapshot;
  switch (payment.evidence) {
    case 'VERIFIED': return annotation.refundedAt ? 'Paid — subsequently refunded' : 'Paid';
    case 'PENDING': return 'Payment pending — not proof of payment';
    case 'NOT_RECORDED': return 'Payment not recorded';
    case 'FAILED': return 'Payment not completed';
    case 'REFUND_UNVERIFIED': return 'Refund recorded — original payment not verified';
    default: return 'Payment details unavailable';
  }
}

/** Current-state disclosures, kept separate from the original financial facts (which never change). */
export function statusNotes(snapshot: DocumentSnapshotV1): { title: string; body: string }[] {
  const notes: { title: string; body: string }[] = [];
  const { annotation, payment, kind } = snapshot;
  const verified = payment.evidence === 'VERIFIED';
  if (annotation.refundedAt && verified) {
    notes.push({ title: 'Payment subsequently refunded', body: `A refund was recorded on ${formatInstant(annotation.refundedAt)}. ` +
      (annotation.refundAmount ? `Refunded amount: ${formatMoney(annotation.refundAmount)} USD. ` : 'The refunded amount is not recorded on this document. ') +
      'The original amounts and payment date above are unchanged.' });
  } else if (annotation.refundedAt) {
    notes.push({ title: 'Refund recorded', body: `A refund was recorded on ${formatInstant(annotation.refundedAt)}. No original successful payment is confirmed for this order.` });
  }
  if (annotation.cancelled) {
    notes.push({ title: 'Order cancelled', body: verified && !annotation.refundedAt
      ? 'This order was cancelled after payment. Cancellation is not a refund, and no refund is recorded for this order.'
      : 'This order was cancelled.' });
  }
  if (kind === 'summary' && !verified) {
    notes.push({ title: 'Not proof of payment', body: 'This summary records the order as placed. It is not an invoice and does not confirm that a payment was made.' });
  }
  return notes;
}
