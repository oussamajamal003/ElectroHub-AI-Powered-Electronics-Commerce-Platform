import { randomUUID } from 'node:crypto';
import type { OrderStatus, PaymentStatus } from '@prisma/client';

/**
 * Task 04.5 synthetic fixtures for the DISPOSABLE PostgreSQL gate only (scripts/delivery-pg.cjs). Payment rows represent an already
 * verified state; Stripe is never contacted. Every row carries a unique suffix and is removed by `cleanup()`.
 */
export function deliveryFixtures(label: string) {
  // Imported lazily: outside the disposable runner the database client refuses to start, and these suites only skip.
  const db = () => import('../../../lib/prisma.js').then(module => module.prisma);
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];
  const orderIds: string[] = [];

  async function user(role: 'CUSTOMER' | 'ADMIN', name: string) {
    const prisma = await db();
    const roleRow = await prisma.role.upsert({ where: { name: role }, create: { name: role }, update: {} });
    const row = await prisma.user.create({ data: { roleId: roleRow.id, email: `delivery-qa-${name}-${suffix}@example.invalid`,
      firstName: 'Delivery', lastName: `QA ${name}` } });
    userIds.push(row.id);
    return row;
  }

  async function order(userId: string, status: OrderStatus, payment: PaymentStatus | null) {
    const prisma = await db();
    const row = await prisma.order.create({ data: { userId, status, subtotal: '120.00', total: '120.00', checkoutAttemptId: randomUUID(),
      checkoutRequestHash: 'd'.repeat(64), deliveryMethod: 'STANDARD', paymentMethod: 'CARD', shippingPhone: '+10000000000',
      estimatedDeliveryStart: new Date('2026-11-04T00:00:00Z'), estimatedDeliveryEnd: new Date('2026-11-06T00:00:00Z'),
      shippingRecipient: 'Delivery QA', shippingLine1: '1 QA Street', shippingCity: 'QA City', shippingCountry: 'US' } });
    orderIds.push(row.id);
    if (payment) await prisma.payment.create({ data: { orderId: row.id, status: payment, amount: '120.00',
      providerPaymentId: `delivery_qa_${randomUUID()}`, paidAt: payment === 'SUCCEEDED' ? new Date() : null } });
    return { ...row, reference: `ORD-${row.id.toUpperCase()}` };
  }

  /** Idempotent: safe to call after partial failures. Deliveries and events cascade from orders. */
  async function cleanup() {
    const prisma = await db();
    if (orderIds.length) {
      await prisma.commerceEmailOutbox.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (userIds.length) {
      await prisma.securityEvent.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    const remaining = await prisma.order.count({ where: { id: { in: orderIds } } }) + await prisma.user.count({ where: { id: { in: userIds } } });
    return remaining;
  }

  return { suffix, user, order, cleanup };
}
