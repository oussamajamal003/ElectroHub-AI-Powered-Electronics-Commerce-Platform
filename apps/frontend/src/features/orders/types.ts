import type { Confirmation } from '@/features/checkout/types';

/** Stored Order status (Prisma `OrderStatus`). Unknown future values are handled by the status mapper. */
export type FulfillmentStatus = 'AWAITING_CAPTURE' | 'CONFIRMED' | 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';
export type OrderPaymentState = Confirmation['paymentState'];

/** `GET /api/orders` card: the compatible Confirmation shape plus `itemCount` (sum of quantities). */
export interface OrderSummary extends Confirmation { itemCount?: number }
export interface OrdersPageResponse { data: OrderSummary[]; meta?: { page: number; pageSize: number; total: number; totalPages: number } }

/** `GET /api/orders/:orderReference`: allowlisted purchase-time snapshot. */
export interface OrderDetails extends Omit<Confirmation, 'items'> {
  itemCount: number;
  items: (Confirmation['items'][number] & { id: string })[];
  payment: { paidAt: string | null; refundedAt: string | null } | null;
}

export const ORDERS_PAGE_SIZE = 10;
/** Backend page bound (order.validator.ts). */
export const MAX_ORDERS_PAGE = 1000;
