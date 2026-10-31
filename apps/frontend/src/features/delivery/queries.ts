import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/context/AuthContext';
import { apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import type { AdminDeliveryRow, AdminDeliverySnapshot, AdminDeliveryUpdate, CustomerDeliverySnapshot, DeliverySimulationStatus, DeliveryStage } from './types';

/**
 * Task 04.7 fallback: while live updates are not subscribed (socket paused, unavailable or not yet connected), a visible tab re-reads an
 * active delivery every 60 s. Polling stops while the socket is subscribed and for finished deliveries.
 */
export const OUT_FOR_DELIVERY_POLL_MS = 60_000;
const ACTIVE = new Set(['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY']);

/**
 * Customer snapshot, scoped to the signed-in account and reference. Nothing private is requested until the session is verified, and a
 * key change (account switch, other order) never shows the previous order's data.
 */
export function useDeliverySnapshot(orderReference: string, live = false) {
  const { user, isSessionVerified, isLoggingOut } = useAuth();
  return useQuery({
    queryKey: queryKeys.delivery.snapshot(user?.id ?? '', orderReference),
    queryFn: ({ signal }) => apiClient<{ data: CustomerDeliverySnapshot }>(`/api/orders/${encodeURIComponent(orderReference)}/delivery`, { signal }),
    enabled: Boolean(user && isSessionVerified && !isLoggingOut && orderReference),
    retry: false, staleTime: 10_000, refetchOnWindowFocus: true,
    refetchInterval: query => {
      const data = query.state.data?.data;
      return !live && data && ACTIVE.has(data.status) && (data.availability === 'AVAILABLE' || data.availability === 'NOT_STARTED') && !query.state.error
        ? OUT_FOR_DELIVERY_POLL_MS : false;
    },
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

/** Task 04.7 demo tools (ADMIN). The server decides availability (flag, non-production, disposable database); the page only explains it. */
export function useDeliverySimulation(orderReference: string) {
  const client = useQueryClient();
  const key = [...queryKeys.delivery.admin(orderReference), 'simulation'] as const;
  const status = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => apiClient<{ data: DeliverySimulationStatus }>(`${adminPath(orderReference)}/simulation`, { signal }),
    enabled: Boolean(orderReference), retry: false, staleTime: 5_000,
    refetchInterval: query => query.state.data?.data.running ? 5_000 : false,
  });
  const settle = (data: DeliverySimulationStatus) => {
    client.setQueryData(key, { data });
    void client.invalidateQueries({ queryKey: queryKeys.delivery.admin(orderReference), exact: true });
  };
  const start = useMutation({
    mutationFn: (routeId: string) => apiClient<{ data: DeliverySimulationStatus }>(`${adminPath(orderReference)}/simulation`, { method: 'POST', data: { routeId } }),
    onSuccess: response => settle(response.data),
  });
  const stop = useMutation({
    mutationFn: () => apiClient<{ data: DeliverySimulationStatus }>(`${adminPath(orderReference)}/simulation`, { method: 'DELETE' }),
    onSuccess: response => settle(response.data),
  });
  return { status, start, stop };
}
