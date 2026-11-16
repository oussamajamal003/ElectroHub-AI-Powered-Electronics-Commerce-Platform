// Relative import so Playwright (no Vite aliases) can load these fixtures too.
import { confirmation } from '../checkout/fixtures';
import type { OrderDetails, OrderSummary, OrdersPageResponse } from './types';

// Synthetic, deterministic Order Management fixtures for tests, stories and mocked browser QA. No real customer data.
const reference = (n: number) => `ORD-${n.toString(16).padStart(8, '0').toUpperCase()}-0000-4000-8000-${n.toString(16).padStart(12, '0').toUpperCase()}`;
const phone = { productId: '22222222-2222-4222-8222-222222222222', productName: 'Apple iPhone 15 Pro', sku: 'DEMO-PHONE',
  imageUrl: '/images/catalog/variety/apple-phone-generic-01.jpg', quantity: 1, unitPrice: '1099.99', lineTotal: '1099.99' };
const extras = [
  { productId: '55555555-5555-4555-8555-555555555551', productName: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones', sku: 'DEMO-AUDIO', imageUrl: '/images/catalog/variety/headphones-01.jpg', quantity: 2, unitPrice: '349.99', lineTotal: '699.98' },
  { productId: '55555555-5555-4555-8555-555555555552', productName: 'USB-C Braided Charging Cable (2 m)', sku: 'DEMO-CABLE', imageUrl: null, quantity: 3, unitPrice: '19.99', lineTotal: '59.97' },
  { productId: '55555555-5555-4555-8555-555555555553', productName: 'Apple Watch Series 9 GPS 45mm Midnight Aluminium Case with Sport Band', sku: 'DEMO-WATCH', imageUrl: '/images/catalog/variety/applewatch-01.jpg', quantity: 1, unitPrice: '429.00', lineTotal: '429.00' },
  { productId: '55555555-5555-4555-8555-555555555554', productName: 'MagSafe Charger', sku: 'DEMO-MAGSAFE', imageUrl: '/missing-image-for-fallback.jpg', quantity: 1, unitPrice: '39.00', lineTotal: '39.00' },
];

export function orderSummary(n: number, overrides: Partial<OrderSummary> = {}): OrderSummary {
  return { ...confirmation, orderReference: reference(n), createdAt: new Date(Date.UTC(2026, 8, 4 + n, 12)).toISOString(), status: 'CONFIRMED', paymentState: 'PAID',
    card: { brand: 'visa', last4: '4242' }, deliveryMethod: 'STANDARD', shippingCost: '0.00', subtotal: '1099.99', total: '1099.99', items: [phone], itemCount: 1, ...overrides };
}
export const manyItemsSummary = (n: number) => orderSummary(n, { items: [phone, ...extras], itemCount: 8, subtotal: '2327.94', total: '2337.93', shippingCost: '9.99', status: 'PREPARING' });

export function ordersPage(orders: OrderSummary[], page = 1, total = orders.length, pageSize = 10): OrdersPageResponse {
  return { data: orders, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

export function orderDetails(overrides: Partial<OrderDetails> = {}): OrderDetails {
  const summary = orderSummary(0);
  return { ...summary, itemCount: 1, items: summary.items.map((item, index) => ({ id: `line-${index + 1}`, ...item })),
    shipping: { recipient: 'Alex Morgan', line1: '123 Demo Street', line2: 'Apartment 4', city: 'Demo City', state: 'CA', postalCode: '90001', country: 'United States', phone: '+1 (555) 010-2000' },
    estimatedDeliveryStart: '2026-09-10T00:00:00.000Z', estimatedDeliveryEnd: '2026-09-10T00:00:00.000Z',
    payment: { paidAt: '2026-09-04T12:01:00.000Z', refundedAt: null }, ...overrides };
}
export const manyItemsDetails = () => orderDetails({ items: [phone, ...extras].map((item, index) => ({ id: `line-${index + 1}`, ...item })), itemCount: 8,
  subtotal: '2327.94', shippingCost: '9.99', total: '2337.93', deliveryMethod: 'EXPRESS', estimatedDeliveryStart: '2026-09-08T00:00:00.000Z', estimatedDeliveryEnd: '2026-09-09T00:00:00.000Z',
  shipping: { recipient: 'Maximiliana Alexandra Montgomery-Fitzgerald', line1: '1234 Extraordinarily Long Boulevard Name That Keeps Going, Building 7, Floor 22',
    line2: 'Suite 2200, Attention: Receiving Department, Leave With Concierge', city: 'San Francisco', state: 'California', postalCode: '94105-1234', country: 'United States of America', phone: '+1 (555) 010-2000' } });
