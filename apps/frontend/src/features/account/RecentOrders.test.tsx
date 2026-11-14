import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecentOrders } from './RecentOrders';
import { apiClient } from '@/lib/api';
import { useAuth } from '@/features/auth/context/AuthContext';
import { queryKeys } from '@/lib/query';
import { ORDERS_PAGE_SIZE } from '@/features/orders/types';
vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiClient: vi.fn() }));
vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));
const order = { orderReference: 'ORD-SYNTHETIC', createdAt: '2026-11-01T10:00:00Z', total: '12.00', currency: 'USD', status: 'PREPARING', paymentState: 'PAID' };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const content = <QueryClientProvider client={client}><MemoryRouter><RecentOrders /></MemoryRouter></QueryClientProvider>;
  return { client, content, ...render(content) };
}
describe('Recent account orders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'customer-a' }, isSessionVerified: true, isLoggingOut: false } as ReturnType<typeof useAuth>);
  });
  it('shows genuine loading, then the returned order without a premature empty state', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(apiClient).mockReturnValue(new Promise(done => { resolve = done; }));
    setup();
    expect(screen.getByRole('status', { name: 'Loading recent orders' })).toBeVisible();
    expect(screen.queryByText('No orders yet')).not.toBeInTheDocument();
    await act(async () => resolve({ data: [order] }));
    expect(await screen.findByRole('link', { name: 'ORD-SYNTHETIC' })).toHaveAttribute('href', '/orders/ORD-SYNTHETIC');
    expect(screen.queryByRole('status', { name: 'Loading recent orders' })).not.toBeInTheDocument();
  });
  it('stops skeletons on failure and retries to a confirmed empty state', async () => {
    vi.mocked(apiClient).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [] });
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.queryByRole('status', { name: 'Loading recent orders' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No orders yet')).toBeVisible();
  });
  it('keeps known orders during background refetch but never carries them to another user', async () => {
    vi.mocked(apiClient).mockResolvedValueOnce({ data: [order] });
    const view = setup();
    await screen.findByText('ORD-SYNTHETIC');
    vi.mocked(apiClient).mockReturnValue(new Promise(() => {}));
    act(() => { void view.client.invalidateQueries({ queryKey: queryKeys.orders.list('customer-a', 1, ORDERS_PAGE_SIZE) }); });
    expect(screen.getByText('ORD-SYNTHETIC')).toBeVisible();
    expect(screen.queryByRole('status', { name: 'Loading recent orders' })).not.toBeInTheDocument();
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'customer-b' }, isSessionVerified: true, isLoggingOut: false } as ReturnType<typeof useAuth>);
    view.rerender(view.content);
    // Force a new render element because the provider tree is otherwise referentially identical.
    view.rerender(<QueryClientProvider client={view.client}><MemoryRouter><RecentOrders /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(screen.queryByText('ORD-SYNTHETIC')).not.toBeInTheDocument());
    expect(screen.getByRole('status', { name: 'Loading recent orders' })).toBeVisible();
  });
});
