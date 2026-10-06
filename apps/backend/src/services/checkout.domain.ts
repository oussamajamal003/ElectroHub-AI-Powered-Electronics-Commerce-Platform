import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';

export const DELIVERY_VERSION = '03.5-v1';
export const deliveryMethods = [
  { id: 'STANDARD', label: 'Standard Delivery', price: '0.00', minDays: 5, maxDays: 7, estimate: '5–7 business days' },
  { id: 'EXPRESS', label: 'Express Delivery', price: '9.99', minDays: 2, maxDays: 3, estimate: '2–3 business days' },
  { id: 'OVERNIGHT', label: 'Overnight Delivery', price: '19.99', minDays: 1, maxDays: 1, estimate: 'Next business day' },
] as const;
const required = (max: number, min = 1) => z.string().trim().min(min).max(max);
const optional = (max: number) => z.string().trim().max(max).optional();
export const shippingSchema = z.object({
  recipient: required(200, 2), line1: required(255, 2), line2: optional(255), city: required(100, 2),
  state: optional(100), postalCode: required(20), country: required(100, 2),
  phone: required(32).regex(/^[+\d\s().-]+$/).refine(value => { const n = value.replace(/\D/g, '').length; return n >= 7 && n <= 15; }),
}).strict();
export const checkoutRequestSchema = z.object({ shipping: shippingSchema,
  deliveryMethod: z.enum(['STANDARD', 'EXPRESS', 'OVERNIGHT']), paymentMethod: z.literal('CARD'),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;
export const attemptSchema = z.string().uuid();
export function requestHash(request: CheckoutRequest) {
  const s = request.shipping;
  return createHash('sha256').update(JSON.stringify([s.recipient, s.line1, s.line2 ?? '', s.city, s.state ?? '',
    s.postalCode, s.country, s.phone, request.deliveryMethod, request.paymentMethod, request.expectedRevision])).digest('hex');
}
export function cartRevision(cartId: string, items: { productId: string; quantity: number; product: { price: string } | null }[]) {
  return createHash('sha256').update(JSON.stringify([DELIVERY_VERSION, deliveryMethods.map(method => [method.id, method.price, method.minDays, method.maxDays]), cartId, items.map(item =>
    [item.productId, item.quantity, item.product?.price ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))] )).digest('hex');
}
export function checkoutTotals(subtotal: string, shipping: string) {
  const value = new Prisma.Decimal(subtotal); const cost = new Prisma.Decimal(shipping); const total = value.plus(cost);
  if (value.isNegative() || cost.isNegative() || total.gt('9999999999.99')) throw new AppError('Order total exceeds supported limits.', 409, 'CHECKOUT_TOTAL_INVALID');
  return { subtotal: value.toFixed(2), shipping: cost.toFixed(2), total: total.toFixed(2), currency: 'USD' as const };
}
export function businessDate(date: Date, days: number) {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  for (let remaining = days; remaining > 0;) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (![0, 6].includes(result.getUTCDay())) remaining--;
  }
  return result;
}
