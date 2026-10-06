import type { CartData } from '@/features/cart/types';
import type { CheckoutQuote, Confirmation, Shipping } from './types';

export const shipping: Shipping = { recipient: 'Alex Morgan', line1: '123 Demo Street', line2: 'Apartment 4', city: 'Demo City', state: '', postalCode: '12345', country: 'United States', phone: '+1 (555) 010-2000' };
export const cart: CartData = { revision: 'a'.repeat(64), items: [{ id: '11111111-1111-4111-8111-111111111111', productId: '22222222-2222-4222-8222-222222222222', quantity: 2,
  product: { name: 'Apple iPhone 15 Pro', slug: 'iphone-15-pro', category: 'Phones', price: '1099.99', image: { url: '/images/catalog/variety/apple-phone-generic-01.jpg', altText: 'Phone' } },
  availability: 'AVAILABLE', stockStatus: 'IN_STOCK', availableQuantity: 10, lineTotal: '2199.98' }], totalQuantity: 2,
  subtotal: '2199.98', shipping: '0.00', total: '2199.98', currency: 'USD', canCheckout: true };
export const quote: CheckoutQuote = { cartRevision: cart.revision, eligible: true, subtotal: cart.subtotal, currency: 'USD', blockers: [], deliveryMethods: [
  { id: 'STANDARD', label: 'Standard Delivery', price: '0.00', estimate: '5–7 business days', minDays: 5, maxDays: 7, totals: { subtotal: cart.subtotal, shipping: '0.00', total: cart.total, currency: 'USD' } },
  { id: 'EXPRESS', label: 'Express Delivery', price: '9.99', estimate: '2–3 business days', minDays: 2, maxDays: 3, totals: { subtotal: cart.subtotal, shipping: '9.99', total: '2209.97', currency: 'USD' } },
  { id: 'OVERNIGHT', label: 'Overnight Delivery', price: '19.99', estimate: 'Next business day', minDays: 1, maxDays: 1, totals: { subtotal: cart.subtotal, shipping: '19.99', total: '2219.97', currency: 'USD' } },
] };
export const confirmation: Confirmation = { orderReference: 'ORD-33333333-3333-4333-8333-333333333333', createdAt: '2026-10-06T12:00:00Z', status: 'CONFIRMED', paymentMethod: 'CARD', paymentState: 'UNPROCESSED',
  shipping, deliveryMethod: 'EXPRESS', estimatedDeliveryStart: '2026-10-08T00:00:00Z', estimatedDeliveryEnd: '2026-10-09T00:00:00Z', currency: 'USD', subtotal: '2199.98', shippingCost: '9.99', total: '2209.97',
  items: [{ productId: '22222222-2222-4222-8222-222222222222', productName: 'Apple iPhone 15 Pro', sku: 'DEMO-PHONE', imageUrl: '/images/catalog/variety/apple-phone-generic-01.jpg', quantity: 2, unitPrice: '1099.99', lineTotal: '2199.98' }] };
