import { Prisma, PrismaClient, type PaymentStatus } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { parseOrderReference } from './order.service.js';
import { DeliveryService } from './delivery.service.js';
import type { orderListSchema, PAYMENT_STATES } from '../validators/admin.validator.js';

/**
 * Task 05.1 admin order projections (read-only). Order history, line snapshots and payments are never written here: fulfillment
 * progress goes through the existing revisioned delivery API (DeliveryService → transitionFulfillment), and payment state is the
 * stored provider-authoritative Payment row. Provider ids, failure reasons, request hashes and attempt keys are never serialized.
 */
type OrderList = z.infer<typeof orderListSchema>;
export type PaymentState = (typeof PAYMENT_STATES)[number];
const reference = (id: string) => `ORD-${id.toUpperCase()}`;
const iso = (value: Date | null | undefined) => value ? value.toISOString() : null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same projection as customer Order Details and Delivery: PAID only for a stored SUCCEEDED payment. */
export function paymentState(status: PaymentStatus | null | undefined): PaymentState {
  return !status ? 'UNPROCESSED' : status === 'SUCCEEDED' ? 'PAID' : status === 'REFUNDED' ? 'REFUNDED' : status === 'FAILED' ? 'FAILED' : 'PENDING';
}

function paymentWhere(state: PaymentState): Prisma.OrderWhereInput {
  switch (state) {
    case 'UNPROCESSED': return { payment: { is: null } };
    case 'PAID': return { payment: { is: { status: 'SUCCEEDED' } } };
    case 'REFUNDED': return { payment: { is: { status: 'REFUNDED' } } };
    case 'FAILED': return { payment: { is: { status: 'FAILED' } } };
    case 'PENDING': return { payment: { is: { status: { in: ['PENDING', 'PROCESSING'] } } } };
  }
}

/** Search: a complete order reference (ORD-<uuid> or the bare UUID), or the customer's name/email/recipient. */
export function orderSearch(q: string): Prisma.OrderWhereInput {
  const bare = q.replace(/^ord-/i, '').toLowerCase();
  const or: Prisma.OrderWhereInput[] = [
    { user: { email: { contains: q, mode: 'insensitive' } } },
    { user: { firstName: { contains: q, mode: 'insensitive' } } },
    { user: { lastName: { contains: q, mode: 'insensitive' } } },
    { shippingRecipient: { contains: q, mode: 'insensitive' } },
  ];
  if (UUID.test(bare)) or.unshift({ id: bare });
  return { OR: or };
}

const listSelect = {
  id: true, status: true, total: true, currency: true, createdAt: true, deliveryMethod: true,
  user: { select: { id: true, email: true, firstName: true, lastName: true } },
  payment: { select: { status: true } },
  delivery: { select: { status: true, trackingCode: true, revision: true } },
  items: { select: { quantity: true } },
} satisfies Prisma.OrderSelect;
type ListRow = Prisma.OrderGetPayload<{ select: typeof listSelect }>;

export function projectOrderRow(row: ListRow) {
  return {
    orderReference: reference(row.id), status: row.status, paymentState: paymentState(row.payment?.status),
    total: row.total.toFixed(2), currency: row.currency, createdAt: row.createdAt.toISOString(), deliveryMethod: row.deliveryMethod,
    itemCount: row.items.reduce((sum, item) => sum + item.quantity, 0),
    customer: { id: row.user.id, name: [row.user.firstName, row.user.lastName].filter(Boolean).join(' ') || null, email: row.user.email },
    delivery: row.delivery ? { trackingReference: row.delivery.trackingCode, revision: row.delivery.revision } : null,
  };
}

export class AdminOrderService {
  constructor(private readonly db: PrismaClient = prisma, private readonly deliveries = new DeliveryService()) {}

  async list(query: OrderList) {
    // Status chips count within every other active filter (search, payment, customer), so each chip matches the rows it selects.
    const scope: Prisma.OrderWhereInput[] = [];
    if (query.q) scope.push(orderSearch(query.q));
    if (query.payment) scope.push(paymentWhere(query.payment));
    if (query.customerId) scope.push({ userId: query.customerId });
    const and = query.status ? [...scope, { status: query.status }] : scope;
    const where: Prisma.OrderWhereInput = and.length ? { AND: and } : {};
    const [rows, total, groups] = await Promise.all([
      this.db.order.findMany({ where, orderBy: [{ [query.sort]: query.order }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize,
        take: query.pageSize, select: listSelect }),
      this.db.order.count({ where }),
      this.db.order.groupBy({ by: ['status'], where: scope.length ? { AND: scope } : {}, _count: { _all: true } }),
    ]);
    const statusCounts = Object.fromEntries(groups.map(group => [group.status, group._count._all]));
    return { data: rows.map(projectOrderRow), meta: { page: query.page, pageSize: query.pageSize, total,
      totalPages: Math.ceil(total / query.pageSize), statusCounts } };
  }

  async detail(orderReference: string) {
    const id = parseOrderReference(orderReference);
    const order = await this.db.order.findUnique({ where: { id }, include: {
      items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      payment: { select: { status: true, amount: true, currency: true, paidAt: true, refundedAt: true, cardBrand: true, cardLast4: true,
        createdAt: true } },
      user: { select: { id: true, email: true, firstName: true, lastName: true, isActive: true } },
    } });
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    // The delivery block (state, allowed next step, revision) is the approved 04.5 admin projection, not a second state machine.
    const delivery = await this.deliveries.getAdminSnapshot(reference(id));
    return {
      orderReference: reference(order.id), status: order.status, createdAt: order.createdAt.toISOString(), updatedAt: order.updatedAt.toISOString(),
      currency: order.currency, subtotal: order.subtotal.toFixed(2), shippingCost: order.shippingCost.toFixed(2), total: order.total.toFixed(2),
      deliveryMethod: order.deliveryMethod, paymentMethod: order.paymentMethod,
      estimatedDeliveryStart: order.estimatedDeliveryStart.toISOString(), estimatedDeliveryEnd: order.estimatedDeliveryEnd.toISOString(),
      customer: { id: order.user.id, name: [order.user.firstName, order.user.lastName].filter(Boolean).join(' ') || null,
        email: order.user.email, isActive: order.user.isActive },
      shipping: { recipient: order.shippingRecipient, line1: order.shippingLine1, line2: order.shippingLine2, city: order.shippingCity,
        state: order.shippingState, postalCode: order.shippingPostalCode, country: order.shippingCountry, phone: order.shippingPhone },
      items: order.items.map(item => ({ id: item.id, productId: item.productId, productName: item.productName, sku: item.sku,
        imageUrl: item.productImageUrl, quantity: item.quantity, unitPrice: item.unitPrice.toFixed(2), lineTotal: item.lineTotal.toFixed(2) })),
      itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
      payment: { state: paymentState(order.payment?.status), amount: order.payment?.amount.toFixed(2) ?? null,
        currency: order.payment?.currency ?? order.currency, paidAt: iso(order.payment?.paidAt), refundedAt: iso(order.payment?.refundedAt),
        card: order.payment?.cardBrand && order.payment.cardLast4 ? { brand: order.payment.cardBrand, last4: order.payment.cardLast4 } : null },
      delivery: { availability: delivery.availability, paymentEligible: delivery.paymentEligible, canStart: delivery.canStart,
        allowedNextStatus: delivery.allowedNextStatus, revision: delivery.current?.revision ?? null,
        trackingReference: delivery.current?.trackingReference ?? null, estimatedAt: delivery.current?.estimatedAt ?? null,
        deliveredAt: delivery.current?.deliveredAt ?? null, isSimulated: delivery.isSimulated },
    };
  }
}
