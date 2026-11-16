import type { OrderStatusType } from '@/components/ui/OrderStatus';
import type { PaymentStatusType } from '@/components/ui/PaymentStatus';
import { MAX_ORDERS_PAGE, type OrderPaymentState } from './types';

const fulfillment: Record<string, OrderStatusType> = {
  AWAITING_CAPTURE: 'awaiting_capture', CONFIRMED: 'confirmed', PREPARING: 'preparing',
  OUT_FOR_DELIVERY: 'out_for_delivery', DELIVERED: 'delivered', CANCELLED: 'cancelled',
};
/** Stored Order status → canonical badge. Never derived from payment; unknown values fail safe. */
export const fulfillmentBadge = (status: string): OrderStatusType => fulfillment[status] ?? 'unknown';

const payment: Record<string, PaymentStatusType> = { UNPROCESSED: 'unprocessed', PENDING: 'pending', PAID: 'paid', FAILED: 'failed', REFUNDED: 'refunded' };
/** Server payment projection → badge. Only a stored success (`PAID`) ever reads as Paid. */
export const paymentBadge = (state: OrderPaymentState | string): PaymentStatusType => payment[state] ?? 'unknown';

/** Display-only formatting of server decimal strings; amounts are never recalculated client-side. */
export const formatMoney = (value: string, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value));
export const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
/** Delivery estimates are business dates stored at UTC midnight: format in UTC so the calendar day never shifts. */
export const formatEstimate = (start: string, end: string) => {
  const day = (value: string) => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
  return start.slice(0, 10) === end.slice(0, 10) ? day(start) : `${day(start)} – ${day(end)}`;
};
export const deliveryLabel = (method: string) =>
  ({ STANDARD: 'Standard Delivery', EXPRESS: 'Express Delivery', OVERNIGHT: 'Overnight Delivery' } as Record<string, string>)[method] ?? 'Delivery';
export const unitCount = (items: { quantity: number }[], itemCount?: number) => itemCount ?? items.reduce((sum, item) => sum + item.quantity, 0);
export const pluralize = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
export const cardBrand = (brand: string) => brand.length ? brand[0]!.toUpperCase() + brand.slice(1) : brand;

/** Neutral, truthful context for states other than a normal paid fulfillment. No financial action is offered. */
export function statusNote(status: string, paymentState: OrderPaymentState | string) {
  if (status === 'AWAITING_CAPTURE') return 'We are finalizing your order and confirming your payment. Please do not pay again.';
  if (status === 'CANCELLED') return paymentState === 'REFUNDED' ? 'This order was cancelled and its payment was refunded.' : 'This order was cancelled.';
  if (paymentState === 'FAILED') return 'Payment for this order did not complete.';
  if (paymentState === 'PENDING') return 'Payment for this order is still being confirmed. Please do not pay again.';
  if (paymentState === 'REFUNDED') return 'The payment for this order was refunded.';
  if (paymentState === 'UNPROCESSED') return 'No payment has been processed for this order.';
  return null;
}

/** Invalid or unsafe `?page=` values normalize to page 1; the backend bound still applies. */
export function readPage(value: string | null) {
  if (!value || !/^[1-9]\d{0,3}$/.test(value)) return 1;
  return Math.min(Number(value), MAX_ORDERS_PAGE);
}
