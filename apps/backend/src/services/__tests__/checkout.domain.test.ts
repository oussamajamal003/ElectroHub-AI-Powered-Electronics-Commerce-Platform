import { describe, expect, it } from 'vitest';
import { businessDate, buyNowSchema, buyNowScopeId, cartRevision, checkoutRequestSchema, checkoutTotals, deliveryMethods, isBuyNowRequest, requestHash, shippingSchema } from '../checkout.domain.js';
const shipping = { recipient: 'Jane Customer', line1: '123 Example Street', city: 'Beirut', postalCode: '1100', country: 'Lebanon', phone: '+961 70 123 456' };
describe('Checkout domain', () => {
  it.each(Object.keys(shipping))('requires a nonblank %s', key => {
    expect(shippingSchema.safeParse({ ...shipping, [key]: '   ' }).success).toBe(false);
  });
  it.each(['+961 70 123 456', '+44 (20) 1234-5678', '00961 70123456'])('supports international phone %s', phone => {
    expect(shippingSchema.parse({ ...shipping, phone }).phone).toBe(phone);
  });
  it.each(['123', '1234567890123456', '<script>'])('rejects invalid phone %s', phone => {
    expect(shippingSchema.safeParse({ ...shipping, phone }).success).toBe(false);
  });
  it('trims fields and rejects oversized values', () => {
    expect(shippingSchema.parse({ ...shipping, recipient: ' Jane Customer ' }).recipient).toBe('Jane Customer');
    expect(shippingSchema.safeParse({ ...shipping, line1: 'a'.repeat(256) }).success).toBe(false);
  });
  it.each([['recipient', 2, 200], ['line1', 2, 255], ['line2', 0, 255], ['city', 2, 100], ['state', 0, 100], ['postalCode', 1, 20], ['country', 2, 100], ['phone', 1, 32]] as const)('enforces %s length boundaries after trimming', (field, min, max) => {
    const atMax = field === 'phone' ? '+' + '('.repeat(20) + '15550102000' : 'x'.repeat(max);
    expect(shippingSchema.safeParse({ ...shipping, [field]: atMax }).success).toBe(true);
    const oversized = field === 'phone' ? '+' + '('.repeat(max) + '15550102000' : 'x'.repeat(max + 1);
    expect(shippingSchema.safeParse({ ...shipping, [field]: oversized }).success).toBe(false);
    if (min > 0) expect(shippingSchema.safeParse({ ...shipping, [field]: 'x'.repeat(min - 1) }).success).toBe(false);
  });
  it.each(deliveryMethods)('owns $id delivery price and exact Decimal totals', method => {
    expect(checkoutTotals('0.30', method.price).total).toBe(method.id === 'STANDARD' ? '0.30' : method.id === 'EXPRESS' ? '10.29' : '20.29');
  });
  it('rejects negative/overflow money', () => {
    expect(() => checkoutTotals('-1.00', '0.00')).toThrow();
    expect(() => checkoutTotals('9999999999.99', '9.99')).toThrow();
  });
  it('requires a revision and refuses client price/payment tampering', () => {
    const request = { shipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: 'a'.repeat(64) };
    expect(checkoutRequestSchema.safeParse(request).success).toBe(true);
    for (const extra of [{ total: '0.00' }, { shippingPrice: 0 }, { cardNumber: 'raw' }, { status: 'PAID' }, { userId: 'other' }]) {
      expect(checkoutRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false);
    }
    expect(checkoutRequestSchema.safeParse({ ...request, deliveryMethod: 'FAKE' }).success).toBe(false);
  });
  it('economic revision changes with price/quantity and ignores insertion order', () => {
    const a = { productId: 'a', quantity: 1, product: { price: '19.99' } };
    const b = { productId: 'b', quantity: 2, product: { price: '1.00' } };
    expect(cartRevision('cart', [a, b])).toBe(cartRevision('cart', [b, a]));
    expect(cartRevision('cart', [a])).not.toBe(cartRevision('cart', [{ ...a, quantity: 2 }]));
    expect(cartRevision('cart', [a])).not.toBe(cartRevision('cart', [{ ...a, product: { price: '20.00' } }]));
  });
  it('canonical request hashes normalize optional empty values and detect changes', () => {
    const base = checkoutRequestSchema.parse({ shipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: 'a'.repeat(64) });
    expect(requestHash(base)).toBe(requestHash({ ...base, shipping: { ...base.shipping, state: '', line2: '' } }));
    expect(requestHash(base)).not.toBe(requestHash({ ...base, deliveryMethod: 'EXPRESS' }));
  });
  it('delivery estimates skip weekends using UTC dates', () => {
    expect(businessDate(new Date('2026-10-09T22:00:00Z'), 1).toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });
  it('validates Buy Now payload and enforces product uuid and positive quantity', () => {
    const valid = { productId: '99999999-9999-4999-8999-999999999999', quantity: 2 };
    expect(buyNowSchema.safeParse(valid).success).toBe(true);
    expect(buyNowSchema.safeParse({ productId: 'invalid', quantity: 1 }).success).toBe(false);
    expect(buyNowSchema.safeParse({ productId: valid.productId, quantity: 0 }).success).toBe(false);
    expect(buyNowSchema.safeParse({ productId: valid.productId, quantity: -1 }).success).toBe(false);
    expect(buyNowSchema.safeParse({ productId: valid.productId, quantity: 1000 }).success).toBe(false);
    expect(buyNowSchema.safeParse({ productId: valid.productId, quantity: 1.5 }).success).toBe(false);
  });
  it('enforces consistency between checkout scope and buyNow payload', () => {
    const base = { shipping, deliveryMethod: 'STANDARD' as const, paymentMethod: 'CARD' as const, expectedRevision: 'a'.repeat(64) };
    const buyNow = { productId: '99999999-9999-4999-8999-999999999999', quantity: 1 };
    expect(checkoutRequestSchema.safeParse(base).success).toBe(true);
    expect(checkoutRequestSchema.safeParse({ ...base, scope: 'CART_CHECKOUT' }).success).toBe(true);
    expect(checkoutRequestSchema.safeParse({ ...base, scope: 'BUY_NOW', buyNow }).success).toBe(true);
    expect(checkoutRequestSchema.safeParse({ ...base, scope: 'BUY_NOW' }).success).toBe(false);
    expect(checkoutRequestSchema.safeParse({ ...base, scope: 'CART_CHECKOUT', buyNow }).success).toBe(false);
    expect(checkoutRequestSchema.safeParse({ ...base, buyNow }).success).toBe(false);
  });
  it('detects buy now requests and scopes hashes correctly', () => {
    const base = checkoutRequestSchema.parse({ shipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: 'a'.repeat(64) });
    const buyNowReq = checkoutRequestSchema.parse({
      ...base,
      scope: 'BUY_NOW',
      buyNow: { productId: '99999999-9999-4999-8999-999999999999', quantity: 1 },
    });
    expect(isBuyNowRequest(base)).toBe(false);
    expect(isBuyNowRequest(buyNowReq)).toBe(true);
    expect(requestHash(buyNowReq)).not.toBe(requestHash(base));
    expect(buyNowScopeId('usr-123')).toBe('buy-now:usr-123');
  });
});
