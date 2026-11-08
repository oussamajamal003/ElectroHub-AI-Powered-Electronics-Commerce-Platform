import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { useAdminList } from '../shared/useAdminList';
import { adminKeys, type ItemResponse, type ListResponse, type Money } from '../shared/api';
import type { OrderStatus, PaymentState } from '../orders/api';

export type CustomerStatus = 'ACTIVE' | 'INACTIVE' | 'DELETED';
export interface AdminCustomerRow {
  id: string; name: string | null; email: string | null; status: CustomerStatus; emailVerified: boolean; createdAt: string; updatedAt: string;
  orderCount: number; lastOrderAt: string | null; paidSpend: Money[];
}
export interface AdminCustomerDetail extends AdminCustomerRow {
  region: { city: string; country: string } | null;
  recentOrders: { orderReference: string; status: OrderStatus; paymentState: PaymentState; total: string; currency: string; createdAt: string; itemCount: number }[];
}
export interface CustomerSummary { total: number; active: number; paidRevenue: Money[] }
export interface CustomerListParams { q?: string; page: number; status?: string; sort: string; order: string }

export function useAdminCustomers(params: CustomerListParams) {
  return useAdminList<ListResponse<AdminCustomerRow, { summary: CustomerSummary }>>('/api/admin/customers', adminKeys.customerList, params);
}

export function useAdminCustomer(userId: string | undefined) {
  return useQuery({
    queryKey: adminKeys.customer(userId ?? ''),
    queryFn: ({ signal }) => apiClient<ItemResponse<AdminCustomerDetail>>(`/api/admin/customers/${encodeURIComponent(userId!)}`, { signal }),
    enabled: Boolean(userId),
    retry: (count, error) => count < 2 && !(error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 404),
  });
}

export function useCustomerStatus(userId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { isActive: boolean; expectedUpdatedAt: string }) =>
      apiClient<ItemResponse<AdminCustomerDetail>>(`/api/admin/customers/${encodeURIComponent(userId)}/status`, { method: 'PATCH', data: body }),
    onSuccess: async response => {
      client.setQueryData(adminKeys.customer(userId), response);
      // Refresh every cached filter/page variant, including inactive entries. Otherwise a previously
      // visited Deactivated tab can remain fresh in cache and omit the account until a browser reload.
      await client.invalidateQueries({
        queryKey: [...adminKeys.customers, 'list'],
        refetchType: 'all',
      });
      void client.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });
}
