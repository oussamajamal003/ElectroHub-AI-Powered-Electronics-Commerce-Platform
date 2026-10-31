import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/context/AuthContext';
import { apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import type { AdminDeliveryRow, AdminDeliverySnapshot, AdminDeliveryUpdate, CustomerDeliverySnapshot, DeliveryStage } from './types';

/** 04.5 has no socket yet: while a parcel is out for delivery, a visible tab re-reads every 60 s (04.7 replaces this with live updates). */
export const OUT_FOR_DELIVERY_POLL_MS = 60_000;

/**
 * Customer snapshot, scoped to the signed-in account and reference. Nothing private is requested until the session is verified, and a
 * key change (account switch, other order) never shows the previous order's data.
 */
export function useDeliverySnapshot(orderReference: string) {
  const { user, isSessionVerified, isLoggingOut } = useAuth();
  return useQuery({
    queryKey: queryKeys.delivery.snapshot(user?.id ?? '', orderReference),
    queryFn: ({ signal }) => apiClient<{ data: CustomerDeliverySnapshot }>(`/api/orders/${encodeURIComponent(orderReference)}/delivery`, { signal }),
    enabled: Boolean(user && isSessionVerified && !isLoggingOut && orderReference),
    retry: false, staleTime: 10_000, refetchOnWindowFocus: true,
    refetchInterval: query => query.state.data?.data.status === 'OUT_FOR_DELIVERY' && !query.state.error ? OUT_FOR_DELIVERY_POLL_MS : false,
    refetchIntervalInBackground: false,
  });
}

const adminPath = (orderReference: string) => `/api/admin/orders/${encodeURIComponent(orderReference)}/delivery`;

export function useAdminDeliveries(status: DeliveryStage | 'ALL', page: number, pageSize = 20) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status !== 'ALL') params.set('status', status);
  return useQuery({
    queryKey: queryKeys.delivery.adminList(status, page),
    queryFn: ({ signal }) => apiClient<{ data: AdminDeliveryRow[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }>(
      `/api/admin/deliveries?${params.toString()}`, { signal }),
    staleTime: 15_000, placeholderData: previous => previous,
  });
}

export function useAdminDelivery(orderReference: string) {
  return useQuery({
    queryKey: queryKeys.delivery.admin(orderReference),
    queryFn: ({ signal }) => apiClient<{ data: AdminDeliverySnapshot }>(adminPath(orderReference), { signal }),
    enabled: Boolean(orderReference), retry: false, staleTime: 5_000,
  });
}

export function useAdminDeliveryMutations(orderReference: string) {
  const client = useQueryClient();
  const settle = (snapshot: AdminDeliverySnapshot) => {
    client.setQueryData(queryKeys.delivery.admin(orderReference), { data: snapshot });
    void client.invalidateQueries({ queryKey: queryKeys.delivery.adminAll });
  };
  const start = useMutation({
    mutationFn: () => apiClient<{ data: AdminDeliverySnapshot }>(adminPath(orderReference), { method: 'POST', data: {} }),
    onSuccess: response => settle(response.data),
  });
  const update = useMutation({
    mutationFn: (body: AdminDeliveryUpdate) => apiClient<{ data: AdminDeliverySnapshot; meta: { changed: boolean } }>(adminPath(orderReference),
      { method: 'PATCH', data: body }),
    onSuccess: response => settle(response.data),
  });
  return { start, update };
}
