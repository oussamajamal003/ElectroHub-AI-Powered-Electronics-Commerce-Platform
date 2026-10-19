import { Prisma } from '@prisma/client';
import type { DocumentSourceOrder } from '../order-document.domain.js';

/** Synthetic Task 03.9 facts only (no real customer data). Amounts are exact strings; every total reconciles unless overridden. */
const d = (value: string) => new Prisma.Decimal(value);
export const ORDER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
export const USER_ID = '11111111-1111-4111-8111-111111111111';
export const PAYMENT_ID = '22222222-2222-4222-8222-222222222222';

export function line(index: number, unitPrice = '19.99', quantity = 1, name = `Synthetic product ${index + 1}`) {
  return { id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, productName: name, sku: `EH-SYN-${String(index + 1).padStart(4, '0')}`,
    unitPrice: d(unitPrice), quantity, lineTotal: d(unitPrice).mul(quantity), createdAt: new Date(Date.UTC(2026, 9, 1, 10, 0, 0, index)) };
}

export function paidOrder(overrides: Partial<DocumentSourceOrder> = {}, items = [line(0, '1299.00', 1, 'ElectroBook Pro 14 laptop'), line(1, '24.50', 2, 'USB-C braided cable 2 m')]): DocumentSourceOrder {
  const subtotal = items.reduce((sum, item) => sum.plus(item.lineTotal), d('0'));
  const shippingCost = d('9.99');
  const total = subtotal.plus(shippingCost);
  return {
    id: ORDER_ID, userId: USER_ID, status: 'CONFIRMED', currency: 'USD', subtotal, shippingCost, total,
    createdAt: new Date('2026-10-01T10:00:00.000Z'), deliveryMethod: 'EXPRESS',
    estimatedDeliveryStart: new Date('2026-10-05T00:00:00.000Z'), estimatedDeliveryEnd: new Date('2026-10-07T00:00:00.000Z'),
    shippingRecipient: 'Alex Example', shippingLine1: '100 Synthetic Street', shippingLine2: 'Suite 4', shippingCity: 'Testville',
    shippingState: 'CA', shippingPostalCode: '90001', shippingCountry: 'United States', items,
    payment: { id: PAYMENT_ID, provider: 'STRIPE', providerPaymentId: 'pi_synthetic_0001', status: 'SUCCEEDED', amount: total, currency: 'USD',
      paidAt: new Date('2026-10-01T10:00:05.000Z'), cardBrand: 'visa', cardLast4: '4242', refundedAt: null },
    paymentAttempt: { userId: USER_ID, providerIntentId: 'pi_synthetic_0001', amountCents: Number(total.mul(100).toFixed(0)), currency: 'USD',
      total, state: 'PAID', refundId: null, refundAmountCents: null },
    ...overrides,
  };
}

/** Payment/attempt overrides on top of a paid order, keeping the order facts identical. */
export function withPayment(order: DocumentSourceOrder, payment: Partial<NonNullable<DocumentSourceOrder['payment']>> | null,
  attempt?: Partial<NonNullable<DocumentSourceOrder['paymentAttempt']>> | null): DocumentSourceOrder {
  return { ...order, payment: payment === null ? null : { ...order.payment!, ...payment },
    paymentAttempt: attempt === null ? null : attempt === undefined ? order.paymentAttempt : { ...order.paymentAttempt!, ...attempt } };
}
