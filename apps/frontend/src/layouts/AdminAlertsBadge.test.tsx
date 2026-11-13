import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminLayout } from './AdminLayout';
import { useAdminAuth } from '@/features/auth/context/AuthContext';
import { apiClient } from '@/lib/api';
import { adminKeys } from '@/features/admin/shared/api';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAdminAuth: vi.fn() }));
vi.mock('@/features/admin/dashboard/useAdminInventoryLiveUpdates', () => ({ useAdminInventoryLiveUpdates: vi.fn() }));
vi.mock('@/lib/api', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/api')>()), apiClient: vi.fn() }));

const CATEGORIES = ['lowStock', 'outOfStock', 'awaitingFulfillment', 'outForDelivery'] as const;
type Category = typeof CATEGORIES[number];

/** Models the server: live operational counts, plus this administrator's acknowledged baseline per category. */
function server(initial: Record<Category, number>) {
  const live = { ...initial, preparing: 0 };
  const baseline: Record<Category, number> = { lowStock: 0, outOfStock: 0, awaitingFulfillment: 0, outForDelivery: 0 };
  const snapshot = () => {
    const unread = Object.fromEntries(CATEGORIES.map(key => [key, Math.max(0, live[key] - baseline[key])])) as Record<Category, number>;
    return { data: { ...live, unread: { ...unread, total: CATEGORIES.reduce((sum, key) => sum + unread[key], 0) }, generatedAt: '' } };
  };
  const state = { fail: false, acknowledged: [] as unknown[] };
  vi.mocked(apiClient).mockImplementation((async (path: string, options?: { method?: string; data?: Partial<Record<Category, number>> }) => {
    if (path === '/api/admin/dashboard/alerts/acknowledge') {
      state.acknowledged.push(options?.data);
      if (state.fail) throw new Error('boom');
      for (const key of CATEGORIES) {
        const shown = options?.data?.[key];
        if (shown !== undefined) baseline[key] = Math.max(Math.min(baseline[key], live[key]), Math.min(shown, live[key]));
      }
      return snapshot();
    }
    if (path === '/api/admin/dashboard/alerts') return snapshot();
    throw new Error(`unexpected ${path}`);
  }) as never);
  return { live, state, baseline };
}

function Where() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/admin']}>
    <Routes><Route element={<AdminLayout />}><Route path="/admin/*" element={<Where />} /></Route></Routes>
  </MemoryRouter></QueryClientProvider>);
  return client;
}

const counts = (lowStock: number, outOfStock: number, awaitingFulfillment: number, outForDelivery = 0) => ({ lowStock, outOfStock, awaitingFulfillment, outForDelivery });
const bell = (name: string | RegExp) => screen.findByRole('button', { name, hidden: true });

describe('admin alerts unread badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(useAdminAuth).mockReturnValue({ user: { id: 'a', email: 'admin@example.test', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN' }, logout: vi.fn() } as unknown as ReturnType<typeof useAdminAuth>);
  });

  it('shows the aggregate unread (all four categories) and opening the bell acknowledges nothing', async () => {
    const { state } = server(counts(2, 1, 3, 4));
    renderLayout();
    const trigger = await bell('Alerts: 10 unread');
    expect(trigger).toHaveTextContent('10');
    await userEvent.click(trigger);
    expect(await screen.findByText('Low stock')).toBeInTheDocument();
    expect(screen.getByText(/· 4 new/)).toBeInTheDocument();                 // out for delivery has its own unread now
    expect(screen.queryByRole('menuitem', { name: /See all alerts/ })).not.toBeInTheDocument();
    expect(screen.getByText('Live counts from orders and inventory. Refreshed every minute.')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(await bell('Alerts: 10 unread')).toBeInTheDocument();
    expect(state.acknowledged).toEqual([]);
  });

  it.each([
    ['Out of stock', 'outOfStock', '/admin/inventory?status=OUT_OF_STOCK', 9],
    ['Low stock', 'lowStock', '/admin/inventory?status=LOW_STOCK', 8],
    ['Paid orders awaiting fulfillment', 'awaitingFulfillment', '/admin/orders?status=CONFIRMED&payment=PAID', 7],
    ['Out for delivery', 'outForDelivery', '/admin/deliveries?status=OUT_FOR_DELIVERY', 6],
  ] as const)('choosing "%s" acknowledges only that category, then navigates to its queue', async (label, key, to, remaining) => {
    const { state } = server(counts(2, 1, 3, 4));
    renderLayout();
    await userEvent.click(await bell('Alerts: 10 unread'));
    await userEvent.click(await screen.findByRole('menuitem', { name: new RegExp(`^${label}`) }));
    expect(state.acknowledged).toEqual([{ [key]: counts(2, 1, 3, 4)[key] }]);
    expect(screen.getByTestId('location')).toHaveTextContent(to);
    expect(await bell(`Alerts: ${remaining} unread`)).toBeInTheDocument();
  });

  it('keeps the other categories unread and the operational counts unchanged, across a refetch', async () => {
    server(counts(2, 1, 3, 0));
    const client = renderLayout();
    await userEvent.click(await bell('Alerts: 6 unread'));
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Low stock/ }));
    await bell('Alerts: 4 unread');
    await act(async () => { await client.refetchQueries({ queryKey: adminKeys.alerts }); });
    await userEvent.click(await bell('Alerts: 4 unread'));
    const low = await screen.findByRole('menuitem', { name: /^Low stock/ });
    expect(low).not.toHaveTextContent(/new/);
    expect(low).toHaveTextContent('2');                                          // still 2 low-stock products: reading never resolves them
    expect(screen.getByRole('menuitem', { name: /^Out of stock/ })).toHaveTextContent('· 1 new');
    expect(screen.getByRole('menuitem', { name: /^Paid orders/ })).toHaveTextContent('· 3 new');
  });

  it('increments again when a new alert arrives in an acknowledged category', async () => {
    const { live } = server(counts(1, 0, 0));
    const client = renderLayout();
    await userEvent.click(await bell('Alerts: 1 unread'));
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Low stock/ }));
    await bell(/Alerts: no unread/);
    live.lowStock = 3;
    await act(async () => { await client.refetchQueries({ queryKey: adminKeys.alerts }); });
    expect(await bell('Alerts: 2 unread')).toBeInTheDocument();
  });

  it('rolls the badge back and tells the administrator when marking a category as read fails', async () => {
    const { state } = server(counts(1, 1, 0));
    state.fail = true;
    renderLayout();
    await userEvent.click(await bell('Alerts: 2 unread'));
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Low stock/ }));
    await waitFor(() => expect(state.acknowledged).toHaveLength(1));
    expect(await bell('Alerts: 2 unread')).toBeInTheDocument();
    await userEvent.click(await bell('Alerts: 2 unread'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be marked as read/i);
  });

  it('does not send an acknowledgement for a category with nothing unread', async () => {
    const { state } = server(counts(0, 0, 0, 2));
    renderLayout();
    await userEvent.click(await bell('Alerts: 2 unread'));
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Low stock/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/inventory?status=LOW_STOCK');
    expect(state.acknowledged).toEqual([]);
  });
});
