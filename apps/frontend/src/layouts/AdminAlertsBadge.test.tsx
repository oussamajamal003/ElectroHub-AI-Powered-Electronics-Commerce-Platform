import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminLayout } from './AdminLayout';
import { useAdminAuth } from '@/features/auth/context/AuthContext';
import { apiClient } from '@/lib/api';
import { adminKeys } from '@/features/admin/shared/api';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAdminAuth: vi.fn() }));
vi.mock('@/features/admin/dashboard/useAdminInventoryLiveUpdates', () => ({ useAdminInventoryLiveUpdates: vi.fn() }));
vi.mock('@/lib/api', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/api')>()), apiClient: vi.fn() }));

/** Models the server: live operational counts, plus this administrator's acknowledged baseline. */
function server(initial: { lowStock: number; outOfStock: number; awaitingFulfillment: number }) {
  const live = { ...initial, preparing: 0, outForDelivery: 0 };
  const baseline = { lowStock: 0, outOfStock: 0, awaitingFulfillment: 0 };
  const snapshot = () => {
    const unread = { lowStock: Math.max(0, live.lowStock - baseline.lowStock), outOfStock: Math.max(0, live.outOfStock - baseline.outOfStock),
      awaitingFulfillment: Math.max(0, live.awaitingFulfillment - baseline.awaitingFulfillment), total: 0 };
    unread.total = unread.lowStock + unread.outOfStock + unread.awaitingFulfillment;
    return { data: { ...live, unread, generatedAt: '' } };
  };
  const state = { fail: false, acknowledged: [] as unknown[] };
  vi.mocked(apiClient).mockImplementation((async (path: string, options?: { method?: string; data?: Record<string, number> }) => {
    if (path === '/api/admin/dashboard/alerts/acknowledge') {
      state.acknowledged.push(options?.data);
      if (state.fail) throw new Error('boom');
      for (const key of ['lowStock', 'outOfStock', 'awaitingFulfillment'] as const) baseline[key] = Math.max(baseline[key], Math.min(options!.data![key]!, live[key]));
      return snapshot();
    }
    if (path === '/api/admin/dashboard/alerts') return snapshot();
    throw new Error(`unexpected ${path}`);
  }) as never);
  return { live, state };
}

function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/admin']}>
    <Routes><Route element={<AdminLayout />}><Route path="/admin/*" element={<p>Page body</p>} /></Route></Routes>
  </MemoryRouter></QueryClientProvider>);
  return client;
}

describe('admin alerts unread badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(useAdminAuth).mockReturnValue({ user: { id: 'a', email: 'admin@example.test', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN' }, logout: vi.fn() } as unknown as ReturnType<typeof useAdminAuth>);
  });

  it('shows the unread total, clears it when the alerts are opened, keeps the read history and stays cleared after a refetch', async () => {
    server({ lowStock: 2, outOfStock: 1, awaitingFulfillment: 3 });
    const client = renderLayout();
    const bell = await screen.findByRole('button', { name: 'Alerts: 6 unread' });
    expect(bell).toHaveTextContent('6');
    await userEvent.click(bell);
    // The menu is the read history: operational counts stay, with this session's "new" markers.
    expect(await screen.findByText('Low stock')).toBeInTheDocument();
    expect(screen.getByText(/2 new/)).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'See all alerts' })).toHaveAttribute('href', '/admin');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Alerts: no unread, 6 items need attention', hidden: true })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Alerts: no unread/, hidden: true })).not.toHaveTextContent('6');
    expect(vi.mocked(apiClient)).toHaveBeenCalledWith('/api/admin/dashboard/alerts/acknowledge', expect.objectContaining({ method: 'POST', data: { lowStock: 2, outOfStock: 1, awaitingFulfillment: 3 } }));
    // A background refetch (or refresh) re-reads the server's persisted state and must not bring the badge back.
    await act(async () => { await client.refetchQueries({ queryKey: adminKeys.alerts }); });
    expect(screen.getByRole('button', { name: /Alerts: no unread/, hidden: true })).toBeInTheDocument();
  });

  it('increments again when a new alert arrives after everything was read', async () => {
    const { live } = server({ lowStock: 1, outOfStock: 0, awaitingFulfillment: 0 });
    const client = renderLayout();
    await userEvent.click(await screen.findByRole('button', { name: 'Alerts: 1 unread' }));
    await screen.findByRole('button', { name: /Alerts: no unread/, hidden: true });
    await userEvent.keyboard('{Escape}');
    live.awaitingFulfillment = 2;
    await act(async () => { await client.refetchQueries({ queryKey: adminKeys.alerts }); });
    expect(await screen.findByRole('button', { name: 'Alerts: 2 unread', hidden: true })).toBeInTheDocument();
  });

  it('restores the unread count and tells the administrator when marking as read fails', async () => {
    const { state } = server({ lowStock: 1, outOfStock: 1, awaitingFulfillment: 0 });
    state.fail = true;
    renderLayout();
    await userEvent.click(await screen.findByRole('button', { name: 'Alerts: 2 unread', hidden: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be marked as read/i);
    expect(screen.getByRole('button', { name: 'Alerts: 2 unread', hidden: true })).toBeInTheDocument();
  });

  it('does not acknowledge when there is nothing unread', async () => {
    const { state } = server({ lowStock: 0, outOfStock: 0, awaitingFulfillment: 0 });
    renderLayout();
    await userEvent.click(await screen.findByRole('button', { name: 'Alerts: nothing needs attention' }));
    expect(state.acknowledged).toEqual([]);
  });
});
