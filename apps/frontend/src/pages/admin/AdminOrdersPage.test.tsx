import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminOrders, type AdminOrderRow } from '@/features/admin/orders/api';
import { AdminOrdersPage } from './AdminOrdersPage';

vi.mock('@/features/admin/orders/api', async importOriginal => ({ ...await importOriginal<object>(), useAdminOrders: vi.fn() }));

const REF = 'ORD-1C5BB1A2-5F0E-4F7A-9D4E-2B8D1F0A9C11';
const CUSTOMER = '3e7dd3c4-7b2f-4c9b-9f6a-4d0f3b2c1e33';
const row: AdminOrderRow = {
  orderReference: REF, status: 'CONFIRMED', paymentState: 'PAID', total: '99.00', currency: 'USD', createdAt: '2026-11-01T10:00:00.000Z',
  deliveryMethod: 'STANDARD', itemCount: 1, customer: { id: CUSTOMER, name: 'QA Customer', email: 'qa.customer@example.test' }, delivery: null,
};
const meta = { page: 1, pageSize: 20, total: 1, totalPages: 1, statusCounts: { CONFIRMED: 1 } };

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

function renderPage(path: string, rows: AdminOrderRow[] = [row]) {
  vi.mocked(useAdminOrders).mockReturnValue({ data: { data: rows, meta: { ...meta, total: rows.length,
    totalPages: rows.length ? 1 : 0, statusCounts: rows.length ? { CONFIRMED: rows.length } : {} } }, isPending: false,
    isError: false, isFetching: false, isPlaceholderData: false, refetch: vi.fn() } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>
    <LocationProbe /><Routes>
      <Route path="/admin/orders" element={<AdminOrdersPage />} />
      <Route path="/admin/orders/:orderReference" element={<p>Order details route</p>} />
    </Routes>
  </MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, media: '', onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('AdminOrdersPage email deep links', () => {
  it('clears conflicting URL filters, exact-lookups the requested order and focuses its highlighted row', async () => {
    renderPage(`/admin/orders?focus=${REF}&q=old-search&status=CANCELLED&payment=FAILED&customerId=${CUSTOMER}&page=12`);

    const rowElement = await screen.findByRole('row', { name: `Order ${REF}, ready to view details` });
    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent(`q=${REF}&focus=${REF}`));
    expect(useAdminOrders).toHaveBeenCalledWith(expect.objectContaining({ orderReference: REF, page: 1 }), true);
    expect(useAdminOrders).toHaveBeenCalledWith(expect.not.objectContaining({ q: 'old-search', status: 'CANCELLED', payment: 'FAILED', customerId: CUSTOMER }), true);
    expect(rowElement).toHaveAttribute('tabindex', '-1');
    expect(rowElement).toHaveFocus();
    expect(rowElement).toHaveClass(/focusedOrderRow/);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(screen.getByText(`Order ${REF} found. Its row is highlighted below.`)).toHaveAttribute('role', 'status');

    const details = screen.getByRole('link', { name: `View details for order ${REF}` });
    expect(details).toHaveAttribute('href', `/admin/orders/${REF}`);
    fireEvent.click(details);
    expect(await screen.findByText('Order details route')).toBeInTheDocument();
  });

  it('uses a static scroll and highlight affordance when reduced motion is requested', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, media: '(prefers-reduced-motion: reduce)', onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })));
    renderPage(`/admin/orders?focus=${REF}`);

    const rowElement = await screen.findByRole('row', { name: `Order ${REF}, ready to view details` });
    await waitFor(() => expect(rowElement).toHaveClass(/focusedOrderRow/));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
    expect(rowElement).toHaveFocus();
  });

  it('shows an unavailable state for malformed or deleted references without querying order data', async () => {
    renderPage('/admin/orders?focus=javascript%3Aalert(1)', []);
    expect(await screen.findByRole('alert')).toHaveTextContent('Order not found or unavailable');
    expect(useAdminOrders).toHaveBeenCalledWith(expect.anything(), false);
    expect(screen.queryByRole('row', { name: new RegExp(REF) })).not.toBeInTheDocument();

    cleanup();
    vi.mocked(useAdminOrders).mockReturnValue({ data: { data: [], meta: { ...meta, total: 0, totalPages: 0, statusCounts: {} } },
      isPending: false, isError: false, isFetching: false, isPlaceholderData: false, refetch: vi.fn() } as never);
    renderPage(`/admin/orders?focus=${REF}`, []);
    expect(await screen.findByText('The order may have been deleted or the reference may no longer be available.')).toBeInTheDocument();
  });

  it('removes the temporary row highlight after three seconds', async () => {
    vi.useFakeTimers();
    renderPage(`/admin/orders?focus=${REF}`);
    const rowElement = screen.getByRole('row', { name: `Order ${REF}, ready to view details` });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(rowElement).toHaveClass(/focusedOrderRow/);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(rowElement).not.toHaveClass(/focusedOrderRow/);
  });
});
