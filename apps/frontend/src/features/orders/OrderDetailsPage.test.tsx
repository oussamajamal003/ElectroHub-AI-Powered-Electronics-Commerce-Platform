import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEmailNoticeWindows } from './emailNoticeWindow';
import { ApiError, apiClient } from '@/lib/api';
import { useAuth } from '@/features/auth/context/AuthContext';
import { ConfirmationContent } from '@/features/checkout/CheckoutComponents';
import { confirmation } from '@/features/checkout/fixtures';
import { manyItemsDetails, orderDetails } from './fixtures';
import { OrderDetailsPage } from './OrderDetailsPage';
import { formatEstimate, fulfillmentBadge, paymentBadge, statusNote } from './presentation';
import type { OrderDetails } from './types';

vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiClient: vi.fn() }));
vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));

const reference = orderDetails().orderReference;
const signedIn = (id = 'customer') => vi.mocked(useAuth).mockReturnValue({ user: { id }, isSessionVerified: true, isInitializing: false, isAuthenticated: true } as ReturnType<typeof useAuth>);
const resolve = (order: OrderDetails) => vi.mocked(apiClient).mockResolvedValue({ data: order });
function renderDetails(state?: unknown, path = `/orders/${reference}`) {
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: path, state }]}><Routes>
    <Route path="/orders/:orderReference" element={<OrderDetailsPage />} />
  </Routes></MemoryRouter></QueryClientProvider>);
  return client;
}
beforeEach(() => { vi.resetAllMocks(); resetEmailNoticeWindows(); });

describe('status presentation', () => {
  it('maps every stored fulfillment state to its exact canonical badge and fails safe', () => {
    expect(['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'AWAITING_CAPTURE', 'RETURNED'].map(fulfillmentBadge))
      .toEqual(['confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled', 'awaiting_capture', 'unknown']);
  });
  it('maps payment projections independently; only PAID is paid', () => {
    expect(['PAID', 'PENDING', 'FAILED', 'REFUNDED', 'UNPROCESSED', 'SUCCEEDED'].map(paymentBadge)).toEqual(['paid', 'pending', 'failed', 'refunded', 'unprocessed', 'unknown']);
  });
  it('formats UTC business-date estimates without shifting days', () => {
    expect(formatEstimate('2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z')).toBe('Thursday, September 10');
    expect(formatEstimate('2026-09-08T00:00:00.000Z', '2026-09-09T00:00:00.000Z')).toBe('Tuesday, September 8 – Wednesday, September 9');
  });
  it('writes neutral notes without implying refunds or success', () => {
    expect(statusNote('CONFIRMED', 'PAID')).toBeNull();
    expect(statusNote('CANCELLED', 'PAID')).toBe('This order was cancelled.');
    expect(statusNote('AWAITING_CAPTURE', 'PENDING')).toMatch(/do not pay again/);
  });
});

describe('Order Details page', () => {
  it('loads the owned Order directly by reference and renders snapshot items, address, delivery and summary', async () => {
    signedIn(); resolve(orderDetails());
    renderDetails();
    const title = await screen.findByRole('heading', { level: 1, name: `Order ${reference}` });
    expect(title).toHaveFocus();
    expect(apiClient).toHaveBeenCalledWith(`/api/orders/${reference}`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByText('Placed on', { exact: false })).toHaveTextContent('Placed on September 4, 2026');
    expect(document.body).toHaveTextContent('Order status: Confirmed'); expect(document.body).toHaveTextContent('Payment status: Paid');
    const items = screen.getByRole('region', { name: 'Items (1)' });
    expect(within(items).getByText('Apple iPhone 15 Pro')).toBeVisible(); expect(items).toHaveTextContent('Qty: 1'); expect(items).toHaveTextContent('$1,099.99 each');
    const address = screen.getByRole('region', { name: 'Delivery Address' });
    expect(address).toHaveTextContent('Alex Morgan'); expect(address).toHaveTextContent('Demo City, CA, 90001');
    expect(address).toHaveTextContent('Standard Delivery · Estimated Thursday, September 10');
    const summary = screen.getByRole('region', { name: 'Order Summary' });
    expect(summary).toHaveTextContent('Free'); expect(summary).toHaveTextContent('Total paid$1,099.99'); expect(summary).toHaveTextContent('Paid with Visa ending 4242');
    expect(screen.queryByText(/Track Delivery|Tracking/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to Orders' })).toHaveAttribute('href', '/orders');
  });
  it('returns to the originating history page when it came from the list', async () => {
    signedIn(); resolve(orderDetails());
    renderDetails({ fromPage: 3 });
    await screen.findByRole('heading', { level: 1, name: /^Order ORD-/ });
    expect(screen.getByRole('link', { name: 'Back to Orders' })).toHaveAttribute('href', '/orders?page=3');
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/orders?page=3');
  });
  it.each([
    ['AWAITING_CAPTURE', 'PENDING', 'Finalizing your order', 'Pending', 'Order total'],
    ['CANCELLED', 'REFUNDED', 'Cancelled', 'Refunded', 'Order total'],
    ['CANCELLED', 'FAILED', 'Cancelled', 'Failed', 'Order total'],
    ['CONFIRMED', 'UNPROCESSED', 'Confirmed', 'Not processed', 'Order total'],
    ['OUT_FOR_DELIVERY', 'PAID', 'Out for Delivery', 'Paid', 'Total paid'],
    ['DELIVERED', 'PAID', 'Delivered', 'Paid', 'Total paid'],
  ] as const)('shows %s / %s truthfully and independently', async (status, paymentState, fulfillment, payment, totalLabel) => {
    signedIn(); resolve(orderDetails({ status, paymentState, card: paymentState === 'PAID' ? { brand: 'visa', last4: '4242' } : null,
      payment: paymentState === 'UNPROCESSED' ? null : { paidAt: null, refundedAt: paymentState === 'REFUNDED' ? '2026-09-06T00:00:00.000Z' : null } }));
    renderDetails();
    await screen.findByRole('heading', { level: 1, name: /^Order ORD-/ });
    expect(document.body).toHaveTextContent(`Order status: ${fulfillment}`); expect(document.body).toHaveTextContent(`Payment status: ${payment}`);
    expect(screen.getByRole('region', { name: 'Order Summary' })).toHaveTextContent(totalLabel);
    if (paymentState !== 'PAID') expect(screen.queryByText(/Total paid|Paid with|Paid on/)).toBeNull();
  });
  it('renders every line of a many-item Order, paid shipping, long address and image fallback', async () => {
    signedIn(); resolve(manyItemsDetails());
    renderDetails();
    const items = await screen.findByRole('region', { name: 'Items (8)' });
    expect(within(items).getAllByRole('listitem')).toHaveLength(5);
    expect(within(items).getAllByTestId('product-image-fallback').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('region', { name: 'Order Summary' })).toHaveTextContent('Shipping$9.99');
    expect(screen.getByRole('region', { name: 'Delivery Address' })).toHaveTextContent('Maximiliana Alexandra Montgomery-Fitzgerald');
    expect(screen.getByRole('region', { name: 'Delivery Address' })).toHaveTextContent('Express Delivery · Estimated Tuesday, September 8 – Wednesday, September 9');
  });
  it('never says Paid with for stored card metadata on an unpaid Order', async () => {
    signedIn(); resolve(orderDetails({ paymentState: 'PENDING', payment: { paidAt: null, refundedAt: null } }));
    renderDetails();
    const summary = await screen.findByRole('region', { name: 'Order Summary' });
    expect(summary).toHaveTextContent('Card: Visa ending 4242'); expect(summary).not.toHaveTextContent('Paid');
  });
  it('omits absent optional address lines and card metadata without placeholders', async () => {
    signedIn(); resolve(orderDetails({ shipping: { ...orderDetails().shipping, line2: null, state: null }, card: null, payment: { paidAt: null, refundedAt: null } }));
    renderDetails();
    const address = await screen.findByRole('region', { name: 'Delivery Address' });
    expect(address).toHaveTextContent('Demo City, 90001'); expect(address).not.toHaveTextContent('null');
    expect(screen.queryByText(/ending/)).toBeNull();
  });
  it.each([404, 400])('shows the same safe unavailable state for %s without a futile retry', async status => {
    signedIn(); vi.mocked(apiClient).mockRejectedValue(new ApiError(status, 'Order not found.'));
    renderDetails();
    expect(await screen.findByRole('heading', { name: 'Order not found' })).toBeVisible();
    expect(screen.getByText('We could not find this order for your account.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to Orders' })).toHaveAttribute('href', '/orders');
  });
  it('offers Retry for a network/server failure and recovers', async () => {
    signedIn(); vi.mocked(apiClient).mockRejectedValueOnce(new ApiError(503, 'Unavailable'));
    renderDetails();
    expect(await screen.findByText('This order could not be loaded.')).toBeVisible();
    resolve(orderDetails()); fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: `Order ${reference}` })).toBeVisible();
  });
  it('keeps loaded details when a background refresh fails', async () => {
    signedIn(); vi.mocked(apiClient).mockResolvedValueOnce({ data: orderDetails() });
    const client = renderDetails();
    await screen.findByRole('heading', { level: 1, name: /^Order ORD-/ });
    vi.mocked(apiClient).mockRejectedValueOnce(new ApiError(500, 'Server'));
    await act(async () => { await client.refetchQueries(); });
    expect(await screen.findByText('We could not refresh this order. Showing the last loaded details.')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Items (1)' })).toBeVisible();
  });
  it('shows a structural loader, not an error or not-found, while the read is in flight', () => {
    signedIn(); vi.mocked(apiClient).mockReturnValue(new Promise(() => undefined));
    renderDetails();
    expect(screen.getByRole('status', { name: 'Loading order details' })).toBeInTheDocument();
    expect(screen.queryByText('Order not found')).toBeNull();
  });
  it('makes no private request for guests', () => {
    vi.mocked(useAuth).mockReturnValue({ isInitializing: false, isAuthenticated: false } as ReturnType<typeof useAuth>);
    renderDetails();
    expect(screen.getByRole('heading', { name: 'Sign In Required' })).toBeVisible(); expect(apiClient).not.toHaveBeenCalled();
  });
  it('scopes the detail cache by account and reference', async () => {
    signedIn('customer-a'); resolve(orderDetails());
    const client = renderDetails();
    await screen.findByRole('heading', { level: 1, name: /^Order ORD-/ });
    expect(client.getQueryCache().findAll({ queryKey: ['orders', 'detail', 'customer-a', reference] })).toHaveLength(1);
  });
});

describe('Confirmation actions', () => {
  it('renders View Order Details then Continue Shopping outside the confirmation card, linking to the persisted reference', () => {
    render(<MemoryRouter><ConfirmationContent order={{ ...confirmation, paymentState: 'PAID' }} /></MemoryRouter>);
    const card = screen.getByRole('region', { name: 'Order confirmation' });
    const details = screen.getByRole('link', { name: 'View Order Details' });
    const shopping = screen.getByRole('link', { name: 'Continue Shopping' });
    expect(details).toHaveAttribute('href', `/orders/${confirmation.orderReference}`);
    expect(shopping).toHaveAttribute('href', '/products');
    expect(card).not.toContainElement(details); expect(card).not.toContainElement(shopping);
    expect(details.parentElement).toBe(shopping.parentElement);
    expect(card.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(details.compareDocumentPosition(shopping) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'View Order' })).toBeNull();
  });
});

describe('Email confirmation notice placement', () => {
  const updatedAt = '2026-09-04T12:02:00.000Z';
  it('places one notice after the header and before the details grid for a PAID Order', async () => {
    signedIn(); resolve(orderDetails({ createdAt: new Date().toISOString(), emailConfirmation: { state: 'SENT', updatedAt } }));
    renderDetails();
    const title = await screen.findByRole('heading', { level: 1, name: `Order ${reference}` });
    const notice = screen.getByRole('heading', { level: 2, name: 'Email confirmations' });
    const header = title.closest('header');
    const items = screen.getByRole('region', { name: 'Items (1)' });
    expect(screen.getByText('Your order and payment confirmations have been sent. Check your inbox or spam folder.')).toBeVisible();
    expect(screen.getAllByRole('heading', { name: 'Email confirmations' })).toHaveLength(1);
    expect(header).not.toBeNull();
    expect((header?.compareDocumentPosition(notice) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(items) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows UNAVAILABLE calmly: no alert, and items, totals and address still render', async () => {
    signedIn(); resolve(orderDetails({ createdAt: new Date().toISOString(), emailConfirmation: { state: 'UNAVAILABLE', updatedAt } }));
    renderDetails();
    await screen.findByRole('heading', { level: 1, name: `Order ${reference}` });
    expect(screen.getByText('Your purchase is confirmed. We couldn’t confirm email delivery. Your order details are available here.')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('region', { name: 'Items (1)' })).toHaveTextContent('Apple iPhone 15 Pro');
    expect(screen.getByRole('region', { name: 'Order Summary' })).toHaveTextContent('Total paid$1,099.99');
    expect(screen.getByRole('region', { name: 'Delivery Address' })).toHaveTextContent('Alex Morgan');
  });

  it('shows no email notice for an unpaid Order', async () => {
    signedIn(); resolve(orderDetails({ paymentState: 'PENDING', payment: { paidAt: null, refundedAt: null }, emailConfirmation: { state: 'QUEUED', updatedAt } }));
    renderDetails();
    await screen.findByRole('heading', { level: 1, name: `Order ${reference}` });
    expect(screen.queryByRole('heading', { name: 'Email confirmations' })).toBeNull();
  });

  it('makes no request of its own: the page issues exactly one detail read', async () => {
    signedIn(); resolve(orderDetails({ createdAt: new Date().toISOString(), emailConfirmation: { state: 'QUEUED', updatedAt } }));
    renderDetails();
    await screen.findByRole('heading', { level: 2, name: 'Email confirmations' });
    expect(apiClient).toHaveBeenCalledTimes(1);
  });
});

describe('Confirmation email notice placement', () => {
  it('sits between the order card and the outside actions, and UNAVAILABLE is not a payment error', () => {
    render(<MemoryRouter><ConfirmationContent order={{ ...confirmation, paymentState: 'PAID', emailConfirmation: { state: 'UNAVAILABLE', updatedAt: '2026-10-06T12:02:00.000Z' } }} /></MemoryRouter>);
    const card = screen.getByRole('region', { name: 'Order confirmation' });
    const notice = screen.getByRole('heading', { level: 2, name: 'Email confirmations' });
    const details = screen.getByRole('link', { name: 'View Order Details' });
    expect(card).not.toContainElement(notice);
    expect(card.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/payment (failed|error)/i)).toBeNull();
  });
});
