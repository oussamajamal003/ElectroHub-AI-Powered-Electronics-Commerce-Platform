import { buyNowProjection, currentCart } from './cart.service.js';
import { checkoutTotals, type BuyNowInput } from './checkout.domain.js';
import { loadShippingConfig, shippingQuotes } from './shipping-config.js';

export class CheckoutService {
  async get(userId: string, buyNow?: BuyNowInput) {
    const { data } = buyNow ? await buyNowProjection(userId, buyNow) : await currentCart(userId);
    // Quotes come from the configured snapshot: disabled methods are absent and STANDARD is free at/above the threshold.
    const shipping = await loadShippingConfig();
    return { cartRevision: data.revision, eligible: data.canCheckout, subtotal: data.subtotal, currency: data.currency,
      blockers: data.items.filter(item => item.availability !== 'AVAILABLE').map(item => ({ productId: item.productId, availability: item.availability })),
      deliveryMethods: shippingQuotes(data.subtotal, shipping).map(method => ({ ...method, totals: checkoutTotals(data.subtotal, method.price) })),
      // Additive: only BUY_NOW quotes carry their own scoped line summary (the Cart is never used for it).
      ...(buyNow ? { scope: 'BUY_NOW' as const, summary: data } : {}) };
  }
}
