import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api';
import { useAuth } from '@/features/auth/context/AuthContext';
import { manyItemsSummary, orderSummary, ordersPage } from '@/features/orders/fixtures';
import { readPage } from '@/features/orders/presentation';
import { OrdersPage } from './OrdersPage';

vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiClient: vi.fn() }));
vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));

const signedIn = (id = 'customer') => vi.mocked(useAuth).mockReturnValue({ user: { id }, isSessionVerified: true, isInitializing: false, isAuthenticated: true } as ReturnType<typeof useAuth>);
let location = '';
function Where() { location = useLocation().pathname + useLocation().search; return null; }
function renderOrders(path = '/orders', client = new QueryClient()) {
  const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/orders" element={<><OrdersPage /><Where /></>} /><Route path="/orders/:ref" element={<Where />} />
  </Routes></MemoryRouter></QueryClientProvider>);
  return { ...view, client };
}
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined); });

describe('Orders session boundary', () => {
  it('does not flash the guest card, an empty state or a zero count while authentication initializes', () => {
    vi.mocked(useAuth).mockReturnValue({ isInitializing: true, isAuthenticated: false } as ReturnType<typeof useAuth>);
    renderOrders();
    expect(screen.getByRole('status', { name: 'Checking sign-in status' })).toBeInTheDocument();
    expect(screen.queryByText('Sign In Required')).not.toBeInTheDocument();
    expect(screen.queryByText('You have no orders yet.')).not.toBeInTheDocument();
    expect(screen.queryByText(/0 orders/)).not.toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });
  it('offers a session retry when verification is unavailable', () => {
    const retrySession = vi.fn();
    vi.mocked(useAuth).mockReturnValue({ isInitializing: true, sessionUnavailable: true, retrySession, isAuthenticated: false } as unknown as ReturnType<typeof useAuth>);
    renderOrders(); fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retrySession).toHaveBeenCalledOnce(); expect(apiClient).not.toHaveBeenCalled();
  });
  it('shows the sign-in card and opens the existing auth experience without a private request', () => {
    vi.mocked(useAuth).mockReturnValue({ isInitializing: false, isAuthenticated: false } as ReturnType<typeof useAuth>);
    const onOpen = vi.fn(); window.addEventListener('electrohub:open-auth', onOpen, { once: true });
    renderOrders();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(onOpen).toHaveBeenCalledOnce(); expect(apiClient).not.toHaveBeenCalled();
  });
});

describe('My Orders history', () => {
  it('shows a loading count, then the centered true empty state only after a settled zero-total response', async () => {
    signedIn(); let resolve: (value: unknown) => void = () => undefined;
    vi.mocked(apiClient).mockReturnValue(new Promise(done => { resolve = done; }));
    renderOrders();
    expect(screen.getByRole('heading', { level: 1, name: 'My Orders' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading your orders' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Order count loading' })).toBeInTheDocument();
    expect(screen.queryByText('You have no orders yet.')).not.toBeInTheDocument();
    await act(async () => resolve(ordersPage([], 1, 0)));
    expect(await screen.findByText('You have no orders yet.')).toBeVisible();
    expect(screen.getByText('0 orders')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Explore Products' })).toHaveAttribute('href', '/products');
    expect(apiClient).toHaveBeenCalledWith('/api/orders?page=1&pageSize=10', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it('shows a retryable error, never the empty state, when the first read fails', async () => {
    signedIn(); vi.mocked(apiClient).mockRejectedValueOnce(new ApiError(500, 'Something went wrong.'));
    renderOrders();
    expect(await screen.findByText('Your orders could not be loaded.')).toBeVisible();
    expect(screen.queryByText('You have no orders yet.')).not.toBeInTheDocument();
    expect(screen.queryByText(/orders?$/)).not.toBeInTheDocument();
    vi.mocked(apiClient).mockResolvedValueOnce(ordersPage([orderSummary(1)]));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: /ORD-00000001/ })).toBeInTheDocument();
  });
  it('renders a card with the real reference link, independent badges, preview, date, total and unit count', async () => {
    signedIn(); const order = manyItemsSummary(1);
    vi.mocked(apiClient).mockResolvedValue(ordersPage([order]));
    renderOrders();
    const link = await screen.findByRole('link', { name: order.orderReference });
    expect(link).toHaveAttribute('href', `/orders/${order.orderReference}`);
    // The heading and article are named by the reference alone (no action text leaking into the headings list).
    expect(screen.getByRole('heading', { level: 2, name: order.orderReference })).toContainElement(link);
    expect(screen.getByRole('article', { name: order.orderReference })).toBeInTheDocument();
    const card = link.closest('article')!;
    expect(within(card).getByText('Order status:', { exact: false })).toBeInTheDocument();
    expect(card).toHaveTextContent('Order status: Preparing'); expect(card).toHaveTextContent('Payment status: Paid');
    expect(within(card).getAllByRole('img')).toHaveLength(4);
    expect(within(card).getByLabelText('and 1 more product')).toHaveTextContent('+1');
    expect(card).toHaveTextContent('September 5, 2026'); expect(card).toHaveTextContent('$2,337.93'); expect(within(card).getByText('8')).toBeInTheDocument();
    expect(screen.getByText('1 order')).toBeVisible();
    // Exactly one interactive target per card.
    expect(within(card).getAllByRole('link')).toHaveLength(1); expect(within(card).queryByRole('button')).toBeNull();
  });
  it('never labels a pending or legacy unprocessed Order as paid', async () => {
    signedIn();
    vi.mocked(apiClient).mockResolvedValue(ordersPage([orderSummary(1, { status: 'AWAITING_CAPTURE', paymentState: 'PENDING' }), orderSummary(2, { paymentState: 'UNPROCESSED', card: null })]));
    renderOrders();
    const cards = await screen.findAllByRole('article');
    expect(cards[0]).toHaveTextContent('Order status: Finalizing your order'); expect(cards[0]).toHaveTextContent('Payment status: Pending');
    expect(cards[1]).toHaveTextContent('Order status: Confirmed'); expect(cards[1]).toHaveTextContent('Payment status: Not processed');
    expect(screen.queryByText('Total paid')).toBeNull();
  });
  it('keeps the total Order count (not the page length), pages through the URL and passes the list page to details', async () => {
    signedIn();
    vi.mocked(apiClient).mockImplementation(async (url: string) => {
      const page = Number(new URL(url, 'http://local').searchParams.get('page'));
      return ordersPage([orderSummary(page)], page, 25);
    });
    renderOrders();
    expect(await screen.findByText('25 orders')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Go to previous page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));
    await waitFor(() => expect(location).toBe('/orders?page=2'));
    expect(await screen.findByRole('link', { name: /ORD-00000002/ })).toBeInTheDocument();
    expect(screen.getByText('25 orders')).toBeVisible();
    expect(apiClient).toHaveBeenLastCalledWith('/api/orders?page=2&pageSize=10', expect.anything());
    fireEvent.click(screen.getByRole('link', { name: /ORD-00000002/ }));
    expect(location).toBe(`/orders/${orderSummary(2).orderReference}`);
  });
  it('reads a bookmarked page and normalizes unsafe page values', async () => {
    expect([readPage('3'), readPage('0'), readPage('-1'), readPage('1.5'), readPage('abc'), readPage('99999'), readPage(null)]).toEqual([3, 1, 1, 1, 1, 1, 1]);
    signedIn(); vi.mocked(apiClient).mockResolvedValue(ordersPage([orderSummary(21)], 3, 25));
    renderOrders('/orders?page=3');
    await screen.findByRole('link', { name: /ORD-00000015/ });
    expect(apiClient).toHaveBeenCalledWith('/api/orders?page=3&pageSize=10', expect.anything());
  });
  it('offers a bounded return for an out-of-range page instead of the first-purchase empty state', async () => {
    signedIn(); vi.mocked(apiClient).mockResolvedValue({ data: [], meta: { page: 9, pageSize: 10, total: 12, totalPages: 2 } });
    renderOrders('/orders?page=9');
    expect(await screen.findByText('There are no orders on page 9.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to page 2' })).toHaveAttribute('href', '/orders?page=2');
    expect(screen.queryByText('You have no orders yet.')).toBeNull(); expect(screen.getByText('12 orders')).toBeVisible();
  });
  it('keeps loaded orders and reports a failed background refresh separately', async () => {
    signedIn(); vi.mocked(apiClient).mockResolvedValueOnce(ordersPage([orderSummary(1)]));
    const { client } = renderOrders();
    await screen.findByRole('link', { name: /ORD-00000001/ });
    vi.mocked(apiClient).mockRejectedValueOnce(new ApiError(503, 'Unavailable'));
    await act(async () => { await client.refetchQueries(); });
    expect(await screen.findByText('We could not refresh your orders. Showing the last loaded list.')).toBeVisible();
    expect(screen.getByRole('link', { name: /ORD-00000001/ })).toBeInTheDocument();
    expect(screen.queryByText('Your orders could not be loaded.')).toBeNull();
  });
  it('scopes cached history by account: another customer never sees the previous list as placeholder data', async () => {
    signedIn('customer-a'); vi.mocked(apiClient).mockResolvedValueOnce(ordersPage([orderSummary(1)]));
    const client = new QueryClient();
    const view = renderOrders('/orders', client);
    await screen.findByRole('link', { name: /ORD-00000001/ });
    signedIn('customer-b'); vi.mocked(apiClient).mockReturnValueOnce(new Promise(() => undefined));
    view.rerender(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/orders']}><Routes><Route path="/orders" element={<OrdersPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    expect(screen.queryByRole('link', { name: /ORD-00000001/ })).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading your orders' })).toBeInTheDocument();
    expect(client.getQueryCache().findAll({ queryKey: ['orders', 'list', 'customer-b'] })).toHaveLength(1);
  });
  it('fails closed when a response has no pagination metadata: orders render, no crash, no pager', async () => {
    signedIn(); vi.mocked(apiClient).mockResolvedValue({ data: [orderSummary(1, { itemCount: undefined })] });
    renderOrders();
    expect(await screen.findByRole('link', { name: /ORD-00000001/ })).toBeInTheDocument();
    expect(screen.getByText('1 order')).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Order history pages' })).not.toBeInTheDocument();
  });
  it('links back to Account', async () => {
    signedIn(); vi.mocked(apiClient).mockResolvedValue(ordersPage([], 1, 0));
    renderOrders(); await screen.findByText('You have no orders yet.');
    expect(screen.getByRole('link', { name: 'Back to Account' })).toHaveAttribute('href', '/account');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('HomeAccountMy Orders');
  });
});
