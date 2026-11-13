import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { adminKeys, type ItemResponse, type Money } from '../shared/api';
import type { AdminOrderRow } from '../orders/api';

export const ADMIN_ALERT_CATEGORIES = ['lowStock', 'outOfStock', 'awaitingFulfillment', 'outForDelivery'] as const;
export type AdminAlertCategory = typeof ADMIN_ALERT_CATEGORIES[number];
export type AdminAlertUnread = Record<AdminAlertCategory, number> & { total: number };
/** Counts are live operational state (never changed by reading); `unread` is this administrator's remainder after their acknowledged baseline. */
export interface AdminAlerts { lowStock: number; outOfStock: number; awaitingFulfillment: number; preparing: number; outForDelivery: number; unread?: AdminAlertUnread; generatedAt: string }
export interface DashboardOverview {
  generatedAt: string;
  window: { days: number; since: string; timezone: string };
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

const noUnread: AdminAlertUnread = { lowStock: 0, outOfStock: 0, awaitingFulfillment: 0, outForDelivery: 0, total: 0 };

/**
 * Acknowledges ONE alert category (the one the administrator opened) with the count they were shown. The server clamps it to its own
 * count, so an alert that arrived meanwhile stays unread, and every other category is left untouched. The badge drops immediately; a
 * failure restores the previous state, re-reads the server and surfaces the error. Operational counts are never altered.
 */
export function useAcknowledgeAdminAlerts() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (seen: Partial<Record<AdminAlertCategory, number>>) =>
      apiClient<ItemResponse<AdminAlerts>>('/api/admin/dashboard/alerts/acknowledge', { method: 'POST', data: seen }),
    onMutate: async seen => {
      // A refetch that started before this click would overwrite the optimistic state with the pre-acknowledgement payload.
      await client.cancelQueries({ queryKey: adminKeys.alerts });
      const previous = client.getQueryData<ItemResponse<AdminAlerts>>(adminKeys.alerts);
      if (previous) {
        const current = previous.data;
        const unread = { ...noUnread, ...current.unread };
        for (const category of ADMIN_ALERT_CATEGORIES) {
          const shown = seen[category];
          // Mirrors the server: the new baseline is at least what was shown, so unread can only fall to count - shown.
          if (shown !== undefined) unread[category] = Math.min(unread[category], Math.max(0, current[category] - shown));
        }
        unread.total = ADMIN_ALERT_CATEGORIES.reduce((sum, category) => sum + unread[category], 0);
        client.setQueryData<ItemResponse<AdminAlerts>>(adminKeys.alerts, { ...previous, data: { ...current, unread } });
      }
      return { previous };
    },
    onError: (_error, _seen, context) => {
      if (context?.previous) client.setQueryData(adminKeys.alerts, context.previous);
      void client.invalidateQueries({ queryKey: adminKeys.alerts });
    },
    onSuccess: response => client.setQueryData(adminKeys.alerts, response),
  });
}
