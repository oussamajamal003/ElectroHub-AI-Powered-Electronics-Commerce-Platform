import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { adminKeys, type ItemResponse, type Money } from '../shared/api';
import type { AdminOrderRow } from '../orders/api';

export interface AdminAlerts { lowStock: number; outOfStock: number; awaitingFulfillment: number; preparing: number; outForDelivery: number; generatedAt: string }
export interface DashboardOverview {
  generatedAt: string;
  window: { days: number; since: string; timezone: 'UTC' };
  revenue: (Money & { payments: number })[];
  revenueSeries: (Money & { day: string; payments: number })[];
  orders: { total: number; inWindow: number; byStatus: Record<string, number> };
  products: { total: number; sellable: number };
  customers: { total: number; active: number };
  inventory: { inStock: number; lowStock: number; outOfStock: number; untracked: number;
    attention: { productId: string; name: string; sku: string; quantity: number; lowStockAt: number; stockStatus: string }[] };
  fulfillment: { awaitingFulfillment: number; preparing: number; outForDelivery: number };
  trends: {
    revenue: { currency: string; current: string; previous: string; today: string }[];
    orders: DashboardCount; products: DashboardCount; customers: DashboardCount;
  };
  recentOrders: AdminOrderRow[];
}
/** Rows created in the last 30 UTC days, the 30 days before, and today. */
export interface DashboardCount { current: number; previous: number; today: number }

export function useDashboard(days: number) {
  return useQuery({
    queryKey: adminKeys.dashboard(days),
    queryFn: ({ signal }) => apiClient<ItemResponse<DashboardOverview>>(`/api/admin/dashboard/overview?days=${days}`, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** Header alerts: real operational counts, refreshed every minute while the console is open (no unread semantics). */
export function useAdminAlerts(enabled = true) {
  return useQuery({
    queryKey: adminKeys.alerts,
    queryFn: ({ signal }) => apiClient<ItemResponse<AdminAlerts>>('/api/admin/dashboard/alerts', { signal }),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
