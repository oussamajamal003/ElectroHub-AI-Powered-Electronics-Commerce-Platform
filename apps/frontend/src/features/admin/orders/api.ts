import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { useAdminList } from '../shared/useAdminList';
import { adminKeys, type ItemResponse, type ListResponse } from '../shared/api';

export type OrderStatus = 'AWAITING_CAPTURE' | 'CONFIRMED' | 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';
export type PaymentState = 'PAID' | 'PROCESSING' | 'PENDING' | 'FAILED' | 'REFUNDED' | 'UNPROCESSED';

export interface AdminOrderRow {
  orderReference: string; status: OrderStatus; paymentState: PaymentState; total: string; currency: string; createdAt: string;
  deliveryMethod: string; itemCount: number; customer: { id: string; name: string | null; email: string };
  delivery: { trackingReference: string; revision: number } | null;
}
export interface AdminOrderDetail {
  orderReference: string; status: OrderStatus; createdAt: string; updatedAt: string; currency: string;
  subtotal: string; shippingCost: string; total: string; deliveryMethod: string; paymentMethod: string;
  estimatedDeliveryStart: string; estimatedDeliveryEnd: string;
  customer: { id: string; name: string | null; email: string; isActive: boolean };
  shipping: { recipient: string; line1: string; line2: string | null; city: string; state: string | null; postalCode: string | null; country: string; phone: string };
  items: { id: string; productId: string; productName: string; sku: string; imageUrl: string | null; quantity: number; unitPrice: string; lineTotal: string }[];
  itemCount: number;
  payment: { state: PaymentState; amount: string | null; currency: string; paidAt: string | null; refundedAt: string | null; card: { brand: string; last4: string } | null };
  delivery: { availability: string; paymentEligible: boolean; canStart: boolean; allowedNextStatus: string | null; revision: number | null;
    trackingReference: string | null; estimatedAt: string | null; deliveredAt: string | null; isSimulated: boolean };
}
export interface OrderListParams { q?: string; page: number; status?: string; payment?: string; customerId?: string; sort: string; order: string }

export function useAdminOrders(params: OrderListParams) {
  return useAdminList<ListResponse<AdminOrderRow, { statusCounts: Partial<Record<OrderStatus, number>> }>>('/api/admin/orders', adminKeys.orderList, params);
}

export function useAdminOrder(orderReference: string | undefined) {
  return useQuery({
    queryKey: adminKeys.order(orderReference ?? ''),
    queryFn: ({ signal }) => apiClient<ItemResponse<AdminOrderDetail>>(`/api/admin/orders/${encodeURIComponent(orderReference!)}`, { signal }),
    enabled: Boolean(orderReference),
    retry: (count, error) => count < 2 && !(error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 404),
  });
}
