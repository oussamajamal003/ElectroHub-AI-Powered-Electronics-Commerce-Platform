import type { Tone } from './AdminUi';

/** Display labels and tones for server enums. Colour is never the only signal: every pill carries text (and an icon for alerts). */
export const orderStatusLabel: Record<string, string> = {
  AWAITING_CAPTURE: 'Awaiting payment', CONFIRMED: 'Confirmed', PREPARING: 'Preparing', OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered', CANCELLED: 'Cancelled',
};
export const orderStatusTone: Record<string, Tone> = {
  AWAITING_CAPTURE: 'warning', CONFIRMED: 'info', PREPARING: 'primary', OUT_FOR_DELIVERY: 'primary', DELIVERED: 'success', CANCELLED: 'neutral',
};
export const paymentLabel: Record<string, string> = {
  PAID: 'Paid', PROCESSING: 'Processing', PENDING: 'Pending', FAILED: 'Failed', REFUNDED: 'Refunded', UNPROCESSED: 'Not started',
};
export const paymentTone: Record<string, Tone> = { PAID: 'success', PROCESSING: 'info', PENDING: 'warning', FAILED: 'error', REFUNDED: 'neutral', UNPROCESSED: 'neutral' };

export const ORDER_STATUSES = ['AWAITING_CAPTURE', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'] as const;
export const PAYMENT_STATES = ['PAID', 'PROCESSING', 'PENDING', 'FAILED', 'REFUNDED', 'UNPROCESSED'] as const;
