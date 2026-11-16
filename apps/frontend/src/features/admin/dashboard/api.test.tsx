import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api';
import { adminKeys } from '../shared/api';
import { useAcknowledgeAdminAlerts, type AdminAlerts } from './api';
vi.mock('@/lib/api', async original => ({ ...await original<object>(), apiClient: vi.fn() }));
const data: AdminAlerts = { lowStock: 5, outOfStock: 2, awaitingFulfillment: 3, outForDelivery: 4, preparing: 0, generatedAt: '',
  unread: { lowStock: 1, outOfStock: 2, awaitingFulfillment: 3, outForDelivery: 4, total: 10 } };
function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(adminKeys.alerts, { data });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(useAcknowledgeAdminAlerts, { wrapper }), cached: () => client.getQueryData<{ data: AdminAlerts }>(adminKeys.alerts)!.data };
}
beforeEach(() => vi.clearAllMocks());
describe('category acknowledgement cache', () => {
  it('optimistically subtracts only the selected category and keeps previously read categories read', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(apiClient).mockImplementationOnce(() => new Promise(done => { resolve = done; }) as never);
    const { result, cached } = setup();
    act(() => result.current.mutate({ outForDelivery: 4 }));
    await waitFor(() => expect(cached().unread?.total).toBe(6));
    expect(cached().unread?.lowStock).toBe(1);
    expect(cached().outForDelivery).toBe(4);
    await act(async () => resolve({ data: cached() }));
    expect(apiClient).toHaveBeenCalledWith('/api/admin/dashboard/alerts/acknowledge', { method: 'POST', data: { outForDelivery: 4 } });
  });
  it('rolls back a failed write without resolving the operational condition', async () => {
    vi.mocked(apiClient).mockRejectedValueOnce(new Error('Unavailable'));
    const { result, cached } = setup();
    await act(() => result.current.mutateAsync({ lowStock: 5 }).catch(() => undefined));
    expect(cached()).toEqual(data);
  });
  it('adopts an authoritative response containing an alert that arrived after the displayed snapshot', async () => {
    vi.mocked(apiClient).mockResolvedValueOnce({ data: { ...data, outForDelivery: 5, unread: { ...data.unread, outForDelivery: 1, total: 7 } } });
    const { result, cached } = setup();
    await act(() => result.current.mutateAsync({ outForDelivery: 4 }));
    expect(cached().outForDelivery).toBe(5);
    expect(cached().unread?.outForDelivery).toBe(1);
    expect(cached().unread?.total).toBe(7);
  });
});
