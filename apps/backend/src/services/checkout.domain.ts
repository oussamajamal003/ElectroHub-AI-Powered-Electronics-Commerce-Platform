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
export const buyNowSchema = z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(999) }).strict();
export type BuyNowInput = z.infer<typeof buyNowSchema>;
/** CART_CHECKOUT purchases the persistent Cart; BUY_NOW purchases exactly one server-verified Product line and never reads/mutates Cart items. */
export const checkoutRequestSchema = z.object({ shipping: shippingSchema,
  deliveryMethod: z.enum(['STANDARD', 'EXPRESS', 'OVERNIGHT']), paymentMethod: z.literal('CARD'),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
  scope: z.enum(['CART_CHECKOUT', 'BUY_NOW']).optional(), buyNow: buyNowSchema.optional(),
}).strict().refine(request => (request.scope === 'BUY_NOW') === Boolean(request.buyNow), { message: 'Invalid checkout scope.' });
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;
export const attemptSchema = z.string().uuid();
export const isBuyNowRequest = (request: unknown): boolean => typeof request === 'object' && request !== null &&
  (request as { scope?: unknown }).scope === 'BUY_NOW';
/** Revision namespace for a BUY_NOW quote; cannot collide with a Cart revision because the id is not a Cart uuid. */
export const buyNowScopeId = (userId: string) => `buy-now:${userId}`;
export function requestHash(request: CheckoutRequest) {
  const s = request.shipping;
  const base: unknown[] = [s.recipient, s.line1, s.line2 ?? '', s.city, s.state ?? '',
    s.postalCode, s.country, s.phone, request.deliveryMethod, request.paymentMethod, request.expectedRevision];
  if (request.scope === 'BUY_NOW' && request.buyNow) base.push('BUY_NOW', request.buyNow.productId, request.buyNow.quantity);
  return createHash('sha256').update(JSON.stringify(base)).digest('hex');
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
/**
 * Saved purchase terms evaluated against the current canonical pricing. Pure and side-effect free:
 * the same rules gate a saved-purchase retry before card confirmation and the final order commit.
 * `revisionMatches` covers DELIVERY_VERSION, every delivery method's terms, scope and line prices;
 * `delivery` is null when the saved method no longer exists; `totals` is null unless the revision matches and the method exists.
 */
export function savedPurchaseTerms(input: { scopeId: string; expectedRevision: string; deliveryMethod: string;
  lines: readonly { productId: string; quantity: number; price: Prisma.Decimal | string }[] }) {
  let subtotal = new Prisma.Decimal(0);
  for (const line of input.lines) subtotal = subtotal.plus(new Prisma.Decimal(line.price).mul(line.quantity));
  const revisionMatches = cartRevision(input.scopeId, input.lines.map(line => ({ productId: line.productId, quantity: line.quantity,
    product: { price: new Prisma.Decimal(line.price).toFixed(2) } }))) === input.expectedRevision;
  const delivery = deliveryMethods.find(method => method.id === input.deliveryMethod) ?? null;
  // Totals only after the revision matches, preserving order commit's error precedence
  // (revision → delivery → totals); checkoutTotals may itself throw CHECKOUT_TOTAL_INVALID.
  const totals = revisionMatches && delivery ? checkoutTotals(subtotal.toFixed(2), delivery.price) : null;
  return { revisionMatches, delivery, totals };
}
/** The immutable saved amounts still equal the canonical totals (never re-priced). */
export function savedAmountsMatch(totals: { total: string; shipping: string }, saved: { total: Prisma.Decimal | string; shippingCost: Prisma.Decimal | string }) {
  return totals.total === new Prisma.Decimal(saved.total).toFixed(2) && totals.shipping === new Prisma.Decimal(saved.shippingCost).toFixed(2);
}
export function businessDate(date: Date, days: number) {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  for (let remaining = days; remaining > 0;) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (![0, 6].includes(result.getUTCDay())) remaining--;
  }
  return result;
}
