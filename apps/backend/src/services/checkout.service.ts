import { currentCart } from './cart.service.js';
import { checkoutTotals, deliveryMethods } from './checkout.domain.js';

export class CheckoutService {
  async get(userId: string) {
    const { data } = await currentCart(userId);
    return { cartRevision: data.revision, eligible: data.canCheckout, subtotal: data.subtotal, currency: data.currency,
      blockers: data.items.filter(item => item.availability !== 'AVAILABLE').map(item => ({ productId: item.productId, availability: item.availability })),
      deliveryMethods: deliveryMethods.map(method => ({ ...method, totals: checkoutTotals(data.subtotal, method.price) })) };
  }
}
