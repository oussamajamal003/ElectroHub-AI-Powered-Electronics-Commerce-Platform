import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api';
import { PaymentNotifications, PendingPurchases, usePresentedPaymentAttempt, type SavedPurchase } from './PaymentPurchases';
import { readSubmittedPurchase, rememberSubmittedPurchase } from './state';
vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'customer-a' }, isSessionVerified: true }) }));
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), apiClient: vi.fn() }));
const purchase: SavedPurchase = { attemptId: 'attempt-a', scope: 'CART_CHECKOUT', state: 'PROCESSING', total: '719.00', currency: 'USD',
  pending: true, unread: false, orderReference: null, items: [{ name: 'Product A', quantity: 1 }] };
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}</output>; }
function show(path = '/checkout', gcTime = 0, strict = false, initial?: SavedPurchase[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime } } });
  if (initial) client.setQueryData(['payment-purchases', 'customer-a'], { data: initial });
  const content = <QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Location />
    <PendingPurchases /><PaymentNotifications /></MemoryRouter></QueryClientProvider>;
  const view = render(strict ? <StrictMode>{content}</StrictMode> : content);
  return { ...view, client };
}
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); });
it('recovers unread notification metadata automatically after a transient list failure even when cached status is already PAID', async () => {
  const paid = { ...purchase, state: 'PAID', classification: 'SUCCEEDED', pending: false, unread: false, orderReference: 'ORD-A' };
  let reads = 0;
  vi.mocked(apiClient).mockImplementation(async () => {
    if (++reads === 1) throw Error('temporary list outage');
    return { data: [{ ...paid, unread: true }] } as never;
  });
  show('/cart', 5 * 60_000, false, [paid]);
  await screen.findByText(/could not be updated/);
  expect(screen.queryByText('Payment successful! Your order has been confirmed.')).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('Payment successful! Your order has been confirmed.')).toBeVisible(), { timeout: 22000 });
  expect(reads).toBeGreaterThanOrEqual(2);
}, 25000);
it('does not claim that no charge occurred for an authoritatively refunded purchase', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: [{ ...purchase, state: 'REFUNDED', classification: 'FAILED', pending: false, unread: false }] });
  show('/cart');
  expect(await screen.findByText('This payment was refunded. Its purchase details are saved separately from your Cart.')).toBeVisible();
  expect(screen.queryByText(/Nothing was charged/)).not.toBeInTheDocument();
});
// Task 03.6 product decision: a submitted purchase is Processing until an authoritative result; "Checkout saved" no longer exists.
it('a submitted purchase never confirmed at Stripe shows Processing with honest checking copy and only a status check', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: [{ ...purchase, state: 'AWAITING_INPUT', classification: 'PROCESSING', pending: true, retryAllowed: false, confirmationStarted: false }] });
  show('/cart');
  expect(await screen.findByText(/Checking the status of this purchase/)).toBeVisible();
  const card = document.querySelector('[data-purchase="attempt-a"]') as HTMLElement;
  expect(within(card).getByText('Processing', { exact: true })).toBeVisible();
  expect(within(card).queryByText(/confirming this payment with our payment provider/)).not.toBeInTheDocument();
  expect(within(card).getByRole('link', { name: 'Check payment status' })).toHaveAttribute('href', '/checkout?purchase=attempt-a');
  expect(screen.queryByText('Checkout saved')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Continue to payment/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/Select Continue to payment/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Dismiss payment notification' })).not.toBeInTheDocument();
});
it('a failed attempt can become pending again under the same identity, then disappear after capture', async () => {
  let rows: SavedPurchase[] = [{ ...purchase, state: 'DECLINED', classification: 'DECLINED', pending: false, unread: false, retryAllowed: true }];
  vi.mocked(apiClient).mockImplementation(async () => ({ data: rows }) as never);
  const { client } = show('/cart');
  await screen.findByRole('heading', { name: 'Failed payments' });
  rows = [{ ...purchase, state: 'CAPTURE_PENDING', classification: 'ORDER_PROCESSING', pending: true }];
  await client.invalidateQueries({ queryKey: ['payment-purchases'] });
  expect(await screen.findByRole('heading', { name: 'Pending purchases' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Failed payments' })).not.toBeInTheDocument();
  rows = [{ ...purchase, state: 'PAID', classification: 'SUCCEEDED', pending: false, unread: true, orderReference: 'ORD-A' }];
  await client.invalidateQueries({ queryKey: ['payment-purchases'] });
  expect(await screen.findByText('Payment successful! Your order has been confirmed.')).toBeVisible();
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Pending purchases' })).not.toBeInTheDocument());
});
it('an already-read captured outcome still invalidates Orders independently of toast delivery', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: [{ ...purchase, state: 'PAID', classification: 'SUCCEEDED', pending: false, unread: false }] });
  const { client } = show('/orders', 5 * 60_000);
  client.setQueryData(['orders', 'customer-a', 'list', 1, 10], { data: [] });
  await waitFor(() => expect(client.getQueryState(['orders', 'customer-a', 'list', 1, 10])?.isInvalidated).toBe(true));
  expect(screen.queryByText('Payment successful! Your order has been confirmed.')).not.toBeInTheDocument();
});
it('a new captured result withdraws an older failure notice for the same attempt', async () => {
  let rows: SavedPurchase[] = [{ ...purchase, state: 'DECLINED', classification: 'DECLINED', pending: false, unread: true }];
  vi.mocked(apiClient).mockImplementation(async () => ({ data: rows }) as never);
  const { client } = show('/cart');
  await screen.findByText('Payment was not completed. Your saved purchase details are kept in your Cart history.');
  rows = [{ ...purchase, state: 'PAID', classification: 'SUCCEEDED', pending: false, unread: true, orderReference: 'ORD-A' }];
  await client.invalidateQueries({ queryKey: ['payment-purchases'] });
  expect(await screen.findByText('Payment successful! Your order has been confirmed.')).toBeVisible();
  await waitFor(() => expect(screen.queryByText('Payment was not completed. Your saved purchase details are kept in your Cart history.')).not.toBeInTheDocument());
});
it('shows a separate informational pending purchase and no pay-again action', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: [purchase] }); show();
  expect(await screen.findByRole('heading', { name: 'Pending purchases' })).toBeVisible();
  expect(screen.getByText('Product A')).toBeVisible(); expect(screen.getByText('Qty: 1')).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Pending purchases (1)' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'View Payment Status' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^(pay|try again)/i })).not.toBeInTheDocument();
  expect(apiClient).toHaveBeenCalledTimes(1);
});
it('announces A success without navigating B and persists acknowledgement across remount', async () => {
  let read = false;
  vi.mocked(apiClient).mockImplementation(async (url, options) => {
    if (options?.method === 'POST') { expect(url).toBe('/api/checkout/payment-attempts/attempt-a/read'); expect(options.data).toEqual({ state: 'PAID' }); read = true; return undefined as never; }
    return { data: [{ ...purchase, pending: false, state: 'PAID', unread: !read, orderReference: 'ORD-A' }] } as never;
  });
  const view = show(); expect(await screen.findByText('Payment successful! Your order has been confirmed.')).toBeVisible();
  expect(screen.getByTestId('location')).toHaveTextContent('/checkout');
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss payment notification' }));
  await waitFor(() => expect(screen.queryByText('Payment successful! Your order has been confirmed.')).not.toBeInTheDocument());
  view.unmount(); show(); await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(4));
  expect(screen.queryByText('Payment successful! Your order has been confirmed.')).not.toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent('/checkout');
});
it('keeps a failed acknowledgement visible and offers an error instead of silently losing it', async () => {
  vi.mocked(apiClient).mockImplementation(async (_url, options) => {
    if (options?.method === 'POST') throw new Error('offline');
    return { data: [{ ...purchase, state: 'DECLINED', unread: true }] } as never;
  }); show(); await screen.findByText('Payment was not completed. Your saved purchase details are kept in your Cart history.');
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss payment notification' }));
  // Shown as a dismissible error notification (not raw text injected above the page).
  expect(await screen.findByText(/could not be saved/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Dismiss acknowledgement notice' })).toBeVisible();
  expect(screen.getByText('Product A')).toBeVisible();
});
it('fails closed on a malformed purchases contract instead of crashing Cart', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: {} }); show();
  expect(await screen.findByText(/Saved purchases could not be loaded/)).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Pending purchases' })).not.toBeInTheDocument();
});

it('retains the last verified pending purchase when a background read fails and resolves on later truth', async () => {
  const rows = [purchase]; let unavailable = false;
  vi.mocked(apiClient).mockImplementation(async () => {
    if (unavailable) throw Error('network unavailable');
    return { data: rows } as never;
  });
  const { client } = show('/cart'); await screen.findByText('Product A'); unavailable = true;
  await client.invalidateQueries({ queryKey: ['payment-purchases'] });
  expect(await screen.findByText(/could not be updated/)).toBeVisible(); expect(screen.getByText('Product A')).toBeVisible();
  expect(screen.queryByText('Payment failed')).not.toBeInTheDocument();
  unavailable = false; rows[0] = { ...purchase, state: 'DECLINED', classification: 'DECLINED', pending: false, retryAllowed: true };
  await client.invalidateQueries({ queryKey: ['payment-purchases'] });
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Pending purchases' })).not.toBeInTheDocument());
  expect(screen.getByRole('heading', { name: 'Failed payments' })).toBeVisible();
  expect(screen.getByRole('link', { name: /^Try Again/ })).toHaveAttribute('href', '/checkout?step=payment');
});

it('records a committed toast presentation in the customer cache before dismissal', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('storage denied'); });
  try {
    vi.mocked(apiClient).mockResolvedValue({ data: [{ ...purchase, pending: false, state: 'PAID', unread: true, orderReference: 'ORD-A' }] });
    // Match the application's five-minute cache retention. A gcTime=0 test
    // client immediately deletes this unobserved acknowledgement cache entry.
    const { client } = show('/', 5 * 60_000); await screen.findByText('Payment successful! Your order has been confirmed.');
    await waitFor(() => expect(client.getQueryData(['payment-notice-presented', 'customer-a'])).toContain('electrohub.payment-notice.customer-a.attempt-a.PAID'));
    expect(vi.mocked(apiClient).mock.calls.every(([, options]) => !options?.method)).toBe(true);
  } finally { storage.mockRestore(); }
});

it('StrictMode replay and repeated reads produce one terminal toast and no early server acknowledgement', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: [{ ...purchase, pending: false, state: 'PAID', unread: true, orderReference: 'ORD-A' }] });
  const { client } = show('/', 5 * 60_000, true);
  await screen.findByRole('button', { name: 'Dismiss payment notification' });
  await client.invalidateQueries({ queryKey: ['payment-purchases'] });
  expect(screen.getAllByRole('button', { name: 'Dismiss payment notification' })).toHaveLength(1);
  expect(vi.mocked(apiClient).mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

it.each(['/', '/products', '/cart', '/checkout'].flatMap(path => ['PAID', 'DECLINED'].map(state => [path, state])))('reports A %s / %s without changing current navigation or Cart B', async (path, state) => {
  vi.mocked(apiClient).mockResolvedValue({ data: [{ ...purchase, state, unread: true, pending: state !== 'PAID', orderReference: state === 'PAID' ? 'ORD-A' : null }] });
  show(path);
  expect(await screen.findByText(state === 'PAID' ? 'Payment successful! Your order has been confirmed.' : 'Payment was not completed. Your saved purchase details are kept in your Cart history.')).toBeVisible();
  expect(screen.getByTestId('location').textContent).toBe(path);
  expect(vi.mocked(apiClient).mock.calls.every(([url, options]) => ['/api/checkout/payment-attempts', '/api/checkout/payment-capability'].includes(String(url)) && !options?.method)).toBe(true);
  expect(screen.queryByRole('button', { name: /^(pay|try again)/i })).not.toBeInTheDocument();
});

it('uses Processing for submitted purchases awaiting customer action without inventing a terminal outcome', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: [{ ...purchase, state: 'ACTION_REQUIRED', classification: 'AWAITING_CUSTOMER_ACTION' }] });
  show(); expect(await screen.findByText('Processing')).toBeVisible();
  expect(screen.queryByText('Checkout saved')).not.toBeInTheDocument();
  expect(screen.queryByText('Action required')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Payment verification in progress' })).not.toBeInTheDocument();
});
it.each([['PROCESSING', 'AWAITING_INPUT', 'Processing'], ['PROCESSING', 'PROCESSING', 'Processing'], ['UNKNOWN', 'INCIDENT', 'Awaiting confirmation']])(
  'an unresolved %s purchase observes only: %s label, progress indicator, no payment or retry action', async (classification, state, label) => {
    vi.mocked(apiClient).mockResolvedValue({ data: [{ ...purchase, state, classification, retryAllowed: false }] });
    show('/cart'); expect(await screen.findByText(label)).toBeVisible();
    const card = document.querySelector('[data-purchase="attempt-a"]') as HTMLElement;
    expect(Boolean(card.querySelector('[class*="purchaseProgress"]'))).toBe(true);
    expect(within(card).getByRole('link', { name: 'Check payment status' })).toHaveAttribute('href', '/checkout?purchase=attempt-a');
    expect(card.querySelectorAll('a')).toHaveLength(1);
    expect(card.querySelector('button')).toBeNull();
    expect(within(card).queryByRole('link', { name: /Try Again|Continue payment/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Continue payment|Action required|Try Again/)).not.toBeInTheDocument();
  });

it.each(['PAID', 'DECLINED'])('animates %s out of pending on Cart, notifies once via the global toast, and keeps failure history without Try Again', async state => {
  let rows = [purchase]; vi.mocked(apiClient).mockImplementation(async () => ({ data: rows }) as never);
  const { client } = show('/cart'); await screen.findByText('Product A');
  rows = [{ ...purchase, state, classification: state === 'PAID' ? 'SUCCEEDED' : 'DECLINED', pending: false, unread: true, retryAllowed: state === 'DECLINED' }];
  await client.invalidateQueries({ queryKey: ['payment-purchases'] });
  expect(await screen.findByText(state === 'PAID' ? 'Payment confirmed' : 'Payment failed')).toBeVisible();
  expect(await screen.findAllByRole('button', { name: 'Dismiss payment notification' })).toHaveLength(1);
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Pending purchases' })).not.toBeInTheDocument());
  expect(screen.getAllByRole('button', { name: 'Dismiss payment notification' })).toHaveLength(1);
  if (state === 'DECLINED') {
    expect(screen.getByRole('heading', { name: 'Failed payments' })).toBeVisible();
    expect(screen.getByRole('link', { name: /^Try Again/ })).toHaveAttribute('href', '/checkout?step=payment');
  } else expect(screen.queryByRole('link', { name: /^Try Again/ })).not.toBeInTheDocument(); // Paid: never a retry
});
it('already declined purchases render only in durable Saved purchases', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: [{ ...purchase, state: 'DECLINED', classification: 'DECLINED', pending: false, retryAllowed: true }] });
  show('/cart'); await screen.findByRole('heading', { name: 'Failed payments' });
  expect(screen.queryByRole('heading', { name: 'Pending purchases' })).not.toBeInTheDocument();
  expect(screen.getByText('Product A')).toBeVisible();
  expect(screen.getByText('Payment failed')).toBeVisible();
  expect(screen.getByRole('link', { name: /^Try Again/ })).toHaveAttribute('href', '/checkout?step=payment');
});

it('simultaneous Cart outcomes exit independently with one toast each and durable failure history', async () => {
  let rows = [purchase, { ...purchase, attemptId: 'attempt-c' }];
  vi.mocked(apiClient).mockImplementation(async () => ({ data: rows }) as never);
  const { client } = show('/cart'); await screen.findByRole('heading', { name: 'Pending purchases' });
  rows = [{ ...purchase, state: 'PAID', classification: 'SUCCEEDED', pending: false, unread: true }, { ...purchase, attemptId: 'attempt-c', state: 'DECLINED', classification: 'DECLINED', pending: false, unread: true, retryAllowed: true }];
  await client.invalidateQueries({ queryKey: ['payment-purchases'] });
  expect(await screen.findByText('Payment confirmed')).toBeVisible(); expect(screen.getByText('Payment failed')).toBeVisible();
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Pending purchases' })).not.toBeInTheDocument());
  expect(screen.getByRole('heading', { name: 'Failed payments' })).toBeVisible();
  expect(screen.getAllByRole('link', { name: /^Try Again/ })).toHaveLength(1); // only the failed purchase c; paid a has none
  expect(screen.getAllByRole('button', { name: 'Dismiss payment notification' })).toHaveLength(2);
});

it('a stale pending read after a confirmed outcome never reintroduces the pending card', async () => {
  let rows: SavedPurchase[] = [purchase]; vi.mocked(apiClient).mockImplementation(async () => ({ data: rows }) as never);
  const { client } = show('/cart'); await screen.findByRole('heading', { name: 'Pending purchases' });
  rows = [{ ...purchase, state: 'PAID', classification: 'SUCCEEDED', pending: false, unread: true, orderReference: 'ORD-A' }];
  await client.invalidateQueries({ queryKey: ['payment-purchases'] });
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Pending purchases' })).not.toBeInTheDocument());
  rows = [purchase]; // a late read that predates the outcome
  await client.invalidateQueries({ queryKey: ['payment-purchases'] });
  await waitFor(() => expect(vi.mocked(apiClient).mock.calls.filter(([, options]) => !options?.method)).toHaveLength(3));
  expect(screen.queryByRole('heading', { name: 'Pending purchases' })).not.toBeInTheDocument();
});

it('an UNKNOWN attempt keeps its pending card and never produces a toast or Try Again', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: [{ ...purchase, classification: 'UNKNOWN', unread: true }] });
  show('/cart'); expect(await screen.findByText('Awaiting confirmation')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Pending purchases' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Dismiss payment notification' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /^Try Again/ })).not.toBeInTheDocument();
});

it('a failed status read keeps the pending card and never produces a toast or failure', async () => {
  let fail = false; vi.mocked(apiClient).mockImplementation(async () => { if (fail) throw Error('503'); return { data: [purchase] } as never; });
  const { client } = show('/cart'); await screen.findByText('Product A'); fail = true;
  await client.invalidateQueries({ queryKey: ['payment-purchases'] });
  expect(await screen.findByText(/could not be updated/)).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Pending purchases' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Dismiss payment notification' })).not.toBeInTheDocument();
  expect(screen.queryByText('Payment failed')).not.toBeInTheDocument();
});

it('the close icon dismisses one toast immediately and the other auto-dismisses at 5 s, each acknowledged once', async () => {
  vi.mocked(apiClient).mockImplementation(async (_url, options) => options?.method === 'POST' ? undefined as never
    : { data: [{ ...purchase, pending: false, state: 'PAID', unread: true, orderReference: 'ORD-A' }, { ...purchase, attemptId: 'attempt-c', state: 'DECLINED', pending: false, unread: true }] } as never);
  // Fake timers from first render so Radix's 5 s timer is controlled; shouldAdvanceTime lets queries settle.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    show('/cart', 5 * 60_000);
    expect(await screen.findAllByRole('button', { name: 'Dismiss payment notification' })).toHaveLength(2);
    const acks = () => vi.mocked(apiClient).mock.calls.filter(([, options]) => options?.method === 'POST').length;
    const [, closeFailure] = screen.getAllByRole('button', { name: 'Dismiss payment notification' }); fireEvent.click(closeFailure!);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getAllByRole('button', { name: 'Dismiss payment notification' })).toHaveLength(1);
    expect(acks()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_800); });
    expect(screen.getAllByRole('button', { name: 'Dismiss payment notification' })).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.queryByRole('button', { name: 'Dismiss payment notification' })).not.toBeInTheDocument();
    expect(acks()).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.queryByRole('button', { name: 'Dismiss payment notification' })).not.toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});

it('no toast while Checkout presents the attempt; one toast after leaving before the result, never repeated', async () => {
  function Presenting({ id }: { id: string }) { usePresentedPaymentAttempt(id); return <p>Processing your order…</p>; }
  vi.mocked(apiClient).mockResolvedValue({ data: [{ ...purchase, state: 'DECLINED', classification: 'DECLINED', pending: false, unread: true }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 5 * 60_000 } } });
  const tree = (presenting: boolean) => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/checkout']}>
    {presenting && <Presenting id="attempt-a" />}<PaymentNotifications /></MemoryRouter></QueryClientProvider>;
  const view = render(tree(true));
  await waitFor(() => expect(apiClient).toHaveBeenCalled());
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(screen.queryByRole('button', { name: 'Dismiss payment notification' })).not.toBeInTheDocument();
  view.rerender(tree(false)); // customer navigated Home before Checkout observed the result
  expect(await screen.findAllByRole('button', { name: 'Dismiss payment notification' })).toHaveLength(1);
  await client.invalidateQueries({ queryKey: ['payment-purchases'] });
  expect(screen.getAllByRole('button', { name: 'Dismiss payment notification' })).toHaveLength(1);
});

it('groups a multi-item failed purchase into ONE card with one Try Again; a non-retryable failure has none', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: [
    { ...purchase, state: 'DECLINED', classification: 'DECLINED', pending: false, retryAllowed: true, total: '378.00',
      items: [{ name: 'Watch', quantity: 1 }, { name: 'Strap', quantity: 2 }] },
    { ...purchase, attemptId: 'attempt-x', state: 'CANCELED', classification: 'FAILED', pending: false, retryAllowed: false, items: [{ name: 'Mouse', quantity: 1 }] }] });
  const { container } = show('/cart'); await screen.findByRole('heading', { name: 'Failed payments' });
  expect(container.querySelectorAll('article[data-purchase]')).toHaveLength(2);
  const grouped = container.querySelector('article[data-purchase="attempt-a"]') as HTMLElement;
  expect(grouped).toHaveTextContent('Watch'); expect(grouped).toHaveTextContent('Strap'); expect(grouped).toHaveTextContent('Qty: 2');
  expect(grouped).toHaveTextContent('$378.00');
  expect(screen.getAllByRole('link', { name: /^Try Again/ })).toHaveLength(1);
  const canceled = container.querySelector('article[data-purchase="attempt-x"]') as HTMLElement;
  expect(canceled).toHaveTextContent('This purchase did not complete.');
  expect(canceled).not.toHaveTextContent('Nothing was charged');
  expect(within(canceled).queryByRole('link', { name: /^Try Again/ })).not.toBeInTheDocument();
});

it('pending purchases never show Try Again', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: [purchase, { ...purchase, attemptId: 'attempt-u', classification: 'UNKNOWN' }] });
  show('/cart'); await screen.findByRole('heading', { name: 'Pending purchases' });
  expect(screen.queryByRole('link', { name: /^Try Again/ })).not.toBeInTheDocument();
});

it('keeps reading a known submitted attempt while its purchases projection is temporarily empty', async () => {
  const { pendingPollInterval } = await import('./PaymentPurchases');
  const seen = new Map<string, number>(); const known = new Set(['missing-projection']);
  expect(pendingPollInterval([], 1000, seen, known)).toBe(15_000);
  expect(pendingPollInterval([], 1000 + 6 * 60_000, seen, known)).toBe(60_000);
  expect(pendingPollInterval([], 1000 + 35 * 60_000, seen, known)).toBe(120_000);
  expect(pendingPollInterval([], 1000, seen, new Set())).toBe(false);
});

it('late results stay discoverable after five minutes with bounded backoff, and stop once nothing is pending', async () => {
  const { pendingPollInterval } = await import('./PaymentPurchases');
  const seen = new Map<string, number>(); const start = 1_000_000; const min = 60_000;
  // Server timestamps (even skewed or old) never shorten observation; backoff follows this tab's own watch time.
  expect(pendingPollInterval([{ ...purchase, submittedAt: '2020-01-01T00:00:00.000Z' }], start, seen)).toBe(15_000);
  expect(pendingPollInterval([purchase], start + 4 * min, seen)).toBe(15_000);
  expect(pendingPollInterval([purchase], start + 6 * min, seen)).toBe(60_000);
  expect(pendingPollInterval([purchase], start + 90 * min, seen)).toBe(120_000);
  expect(pendingPollInterval([{ ...purchase, classification: 'UNKNOWN' }], start + 600 * min, seen)).toBe(120_000); // never a time cap
  expect(pendingPollInterval([purchase, { ...purchase, attemptId: 'attempt-new' }], start + 600 * min, seen)).toBe(15_000); // a new purchase is watched closely
  expect(pendingPollInterval([{ ...purchase, pending: false, state: 'DECLINED' }], start, seen)).toBe(false);
  expect(pendingPollInterval([], start, seen)).toBe(false);
});
it('a hidden tab neither presents nor records the notice; it appears, once, when the tab becomes visible', async () => {
  const state = { hidden: true };
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state.hidden ? 'hidden' : 'visible' });
  try {
    vi.mocked(apiClient).mockImplementation(async (_url, options) => options?.method === 'POST' ? undefined as never
      : { data: [{ ...purchase, pending: false, state: 'PAID', classification: 'SUCCEEDED', unread: true, orderReference: 'ORD-A' }] } as never);
    const { client } = show();
    await waitFor(() => expect(apiClient).toHaveBeenCalled()); await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(screen.queryByText('Payment successful! Your order has been confirmed.')).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0); expect(client.getQueryData(['payment-notice-presented', 'customer-a'])).toBeUndefined();
    state.hidden = false; act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(await screen.findByText('Payment successful! Your order has been confirmed.')).toBeVisible();
    expect(screen.getAllByText('Payment successful! Your order has been confirmed.')).toHaveLength(1);
  } finally { Reflect.deleteProperty(document, 'visibilityState'); }
});

const uuidA = '11111111-1111-4111-8111-111111111111'; const uuidC = '33333333-3333-4333-8333-333333333333';
it.each(['PAID', 'DECLINED'])('a presented %s toast clears the checkout pointer of that purchase so an empty Checkout never shows it again', async state => {
  rememberSubmittedPurchase('customer-a', 'CART_CHECKOUT', uuidA);
  vi.mocked(apiClient).mockImplementation(async (_url, options) => options?.method === 'POST' ? undefined as never
    : { data: [{ ...purchase, attemptId: uuidA, state, classification: state === 'PAID' ? 'SUCCEEDED' : 'DECLINED', pending: false, unread: true, orderReference: state === 'PAID' ? 'ORD-A' : null }] } as never);
  show();
  expect(await screen.findByRole('button', { name: 'Dismiss payment notification' })).toBeVisible();
  await waitFor(() => expect(readSubmittedPurchase('customer-a', 'CART_CHECKOUT')).toBeNull());
});
it('a toast for another purchase never clears the pointer of an unresolved purchase', async () => {
  rememberSubmittedPurchase('customer-a', 'CART_CHECKOUT', uuidA);
  vi.mocked(apiClient).mockImplementation(async (_url, options) => options?.method === 'POST' ? undefined as never : { data: [
    { ...purchase, attemptId: uuidA, state: 'PROCESSING', classification: 'PROCESSING', pending: true, unread: false },
    { ...purchase, attemptId: uuidC, state: 'PAID', classification: 'SUCCEEDED', pending: false, unread: true, orderReference: 'ORD-C' }] } as never);
  show();
  expect(await screen.findByRole('button', { name: 'Dismiss payment notification' })).toBeVisible();
  expect(readSubmittedPurchase('customer-a', 'CART_CHECKOUT')).toBe(uuidA);
});
it('a pointer for a purchase whose result was not terminal is untouched by a non-terminal notice identity', async () => {
  rememberSubmittedPurchase('customer-a', 'CART_CHECKOUT', uuidA);
  vi.mocked(apiClient).mockResolvedValue({ data: [{ ...purchase, attemptId: uuidA, state: 'PROCESSING', classification: 'UNKNOWN', pending: true, unread: true }] });
  show(); await waitFor(() => expect(apiClient).toHaveBeenCalled());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  expect(screen.queryByRole('button', { name: 'Dismiss payment notification' })).not.toBeInTheDocument();
  expect(readSubmittedPurchase('customer-a', 'CART_CHECKOUT')).toBe(uuidA);
});

it('an overdue purchase offers a status check without promising automatic resolution or inventing an outcome', async () => {
  const old = new Date(Date.now() - 3 * 3_600_000).toISOString(); const fresh = new Date(Date.now() - 60_000).toISOString();
  vi.mocked(apiClient).mockResolvedValue({ data: [{ ...purchase, attemptId: 'abcdef12-0000-4000-8000-000000000000', submittedAt: old },
    { ...purchase, attemptId: 'fedcba98-0000-4000-8000-000000000000', submittedAt: fresh }] });
  show('/cart');
  expect(await screen.findByText(/Payment confirmation needs attention/)).toBeVisible();
  expect(screen.getByText(/Support reference: ABCDEF12/)).toBeVisible();
  expect(screen.queryByText(/taking longer than expected|still checking it automatically/)).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Check payment status' })).toHaveLength(2);
  expect(screen.getAllByText(/confirming this payment with our payment provider/)).toHaveLength(1);
  expect(screen.queryByRole('link', { name: /Continue payment|Try Again/ })).not.toBeInTheDocument();
});

it('a confirmation that reached the provider says so, and a bank verification request offers only a status check', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: [
    { ...purchase, state: 'AWAITING_INPUT', classification: 'PROCESSING', pending: true, retryAllowed: false, confirmationStarted: true },
    { ...purchase, attemptId: 'attempt-b', checkoutId: 'attempt-b', state: 'ACTION_REQUIRED', classification: 'AWAITING_CUSTOMER_ACTION', pending: true, retryAllowed: true }] });
  show('/cart');
  expect(await screen.findByText(/extra verification step/)).toBeVisible();
  const card = document.querySelector('[data-purchase="attempt-a"]') as HTMLElement;
  expect(within(card).getByText(/confirming this payment with our payment provider/)).toBeVisible();
  const verify = document.querySelector('[data-purchase="attempt-b"]') as HTMLElement;
  expect(within(verify).getByText('Processing', { exact: true })).toBeVisible();
  expect(within(verify).getByRole('link', { name: 'Check payment status' })).toHaveAttribute('href', '/checkout?purchase=attempt-b');
  expect(screen.queryByText('Checkout saved')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Continue to payment/ })).not.toBeInTheDocument();
});

// Task 03.6 product decision: after Place Order only Processing, Payment failed (Try Again) and Paid. A never-confirmed purchase is Payment failed.
const notConfirmed = { ...purchase, state: 'DECLINED', classification: 'FAILED' as const, pending: false, unread: false, retryAllowed: true };
// Task 03.6: no "Incomplete purchases" section, "Not completed" badge or "Restore items" anywhere; both kinds are Payment failed + Try Again.
it('shows a provider decline and a never-confirmed purchase only under Failed payments, as Payment failed with Try Again', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: [
    { ...purchase, attemptId: 'declined-a', checkoutId: 'declined-a', state: 'DECLINED', classification: 'DECLINED', pending: false, unread: false, retryAllowed: true },
    { ...notConfirmed, attemptId: 'not-confirmed-b', checkoutId: 'not-confirmed-b' }] });
  show('/cart');
  const failedSection = (await screen.findByRole('heading', { name: 'Failed payments' })).closest('section') as HTMLElement;
  expect(within(failedSection).getAllByText('Payment failed')).toHaveLength(2);
  expect(within(failedSection).getAllByRole('link', { name: /Try Again/ })).toHaveLength(2);
  expect(screen.queryByRole('heading', { name: 'Incomplete purchases' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Not completed|Restore items|closed before payment completed|No payment was taken for these purchases/)).not.toBeInTheDocument();
});

// P0: a payment-write-disabled backend (payment isolation) is a maintenance state, not a payment failure or a completed action.
it('while payment writes are disabled, the trash icon stays on every failed card but explains instead of removing; no write is sent', async () => {
  vi.mocked(apiClient).mockImplementation(async url => String(url) === '/api/checkout/payment-capability'
    ? { data: { paymentsEnabled: false } } as never
    : { data: [{ ...purchase, attemptId: 'declined-a', checkoutId: 'declined-a', state: 'DECLINED', classification: 'DECLINED', pending: false, unread: false, retryAllowed: true }] } as never);
  show('/cart');
  const trash = await screen.findByRole('button', { name: /Remove failed payment/ });
  // No Cart-level banner: the restriction is explained only where the customer acts.
  expect(screen.queryByText(/switched off on this server/)).not.toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('link', { name: /Try Again/ })).not.toBeInTheDocument());
  await act(async () => { fireEvent.click(trash); });
  expect(await screen.findByRole('heading', { name: 'Remove this failed payment?' })).toBeInTheDocument();
  expect(screen.getAllByText(/switched off on this server/).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  expect(vi.mocked(apiClient).mock.calls.every(([, options]) => !(options as { method?: string } | undefined)?.method)).toBe(true);
});
it('a refused dismissal on a disabled backend explains the restriction, keeps the purchase and never claims removal', async () => {
  const { ApiError } = await import('@/lib/api');
  vi.mocked(apiClient).mockImplementation(async (url, options) => {
    if (String(url).endsWith('/dismiss')) throw new ApiError(503, 'Payments are unavailable in this environment.', undefined, 'PAYMENT_MUTATIONS_DISABLED');
    if (String(url) === '/api/checkout/payment-capability') return { data: { paymentsEnabled: true } } as never; // capability not yet refreshed
    void options; return { data: [notConfirmed] } as never;
  });
  show('/cart');
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Remove failed payment/ }, { timeout: 5_000 })); });
  expect(await screen.findByRole('heading', { name: 'Remove this failed payment?' })).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove' })); });
  expect(await screen.findByText(/switched off on this server/, {}, { timeout: 5_000 })).toBeVisible();
  // The refusal itself claims nothing about charges (the card keeps its own provider-evidence copy).
  expect(within(screen.getByRole('dialog')).queryByText(/Nothing was charged|Please try again\. Your/)).not.toBeInTheDocument();
  expect(document.querySelector('[data-purchase="attempt-a"]')).not.toBeNull();
  expect(vi.mocked(apiClient).mock.calls.filter(([url]) => String(url).endsWith('/dismiss'))).toHaveLength(1);
});
it('a dropped purchases read (for example a restarting dev server) is retried before any error is shown', async () => {
  let reads = 0;
  vi.mocked(apiClient).mockImplementation(async () => { if (++reads === 1) throw new TypeError('Failed to fetch'); return { data: [purchase] } as never; });
  show('/cart');
  expect(await screen.findByRole('heading', { name: 'Pending purchases' }, { timeout: 4_000 })).toBeVisible();
  expect(screen.queryByText(/could not be updated|could not be loaded/)).not.toBeInTheDocument();
  expect(reads).toBe(2);
});

// Task 03.6 final acceptance: EVERY failed-payment card shows the trash icon (Cart, Buy Now, single and multi-item, FAILED and DECLINED).
it('renders the trash icon and Payment failed on every failed-payment card', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: [
    { ...purchase, attemptId: 'f1', checkoutId: 'f1', state: 'DECLINED', classification: 'DECLINED', pending: false, unread: false, retryAllowed: true },
    { ...purchase, attemptId: 'f2', checkoutId: 'f2', scope: 'BUY_NOW', state: 'DECLINED', classification: 'DECLINED', pending: false, unread: false, retryAllowed: true },
    { ...purchase, attemptId: 'f3', checkoutId: 'f3', state: 'COMPENSATED', classification: 'FAILED', pending: false, unread: false, retryAllowed: false,
      items: [{ name: 'Product A', quantity: 1 }, { name: 'Product B', quantity: 2 }] }] });
  show('/cart');
  const failedSection = (await screen.findByRole('heading', { name: 'Failed payments' })).closest('section') as HTMLElement;
  for (const id of ['f1', 'f2', 'f3']) {
    const card = failedSection.querySelector(`[data-purchase="${id}"]`) as HTMLElement;
    expect(within(card).getByText('Payment failed')).toBeVisible();
    expect(within(card).getByRole('button', { name: /^Remove failed payment for / })).toBeVisible();
  }
});
it('the remove dialog uses the agreed copy; Cancel keeps the card and sends nothing', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: [{ ...purchase, state: 'DECLINED', classification: 'DECLINED', pending: false, unread: false, retryAllowed: true }] });
  show('/cart');
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Remove failed payment/ })); });
  expect(await screen.findByText('Remove this failed payment from your list? Your payment history will be preserved.')).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
  expect(document.querySelector('[data-purchase="attempt-a"]')).not.toBeNull();
  expect(vi.mocked(apiClient).mock.calls.some(([url]) => String(url).endsWith('/dismiss'))).toBe(false);
});

// Task 03.6: Cancel purchase is a rare, server-verified exception on a Processing purchase (cancelable comes only from the backend).
const verifiedProcessing = { ...purchase, state: 'AWAITING_INPUT', classification: 'PROCESSING' as const, pending: true, retryAllowed: false, cancelable: true };
it('shows Cancel purchase only when the backend marks the Processing purchase cancelable', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: [verifiedProcessing, { ...purchase, attemptId: 'p2', checkoutId: 'p2', state: 'AWAITING_INPUT', classification: 'PROCESSING', pending: true }] });
  show('/cart');
  const cancelable = await waitFor(() => { const card = document.querySelector('[data-purchase="attempt-a"]') as HTMLElement; expect(card).toBeTruthy(); return card; });
  expect(within(cancelable).getByText('Processing', { exact: true })).toBeVisible();
  expect(within(cancelable).getByRole('link', { name: 'Check payment status' })).toBeVisible();
  expect(within(cancelable).getByRole('button', { name: /Cancel purchase/ })).toBeVisible();
  const ordinary = document.querySelector('[data-purchase="p2"]') as HTMLElement;
  expect(within(ordinary).queryByRole('button', { name: /Cancel purchase/ })).not.toBeInTheDocument();
});
it('cancelling asks for confirmation, then cancels and (explicitly) returns the items to the Cart once the server confirms the cancellation', async () => {
  let rows: SavedPurchase[] = [verifiedProcessing];
  vi.mocked(apiClient).mockImplementation(async (url, options) => {
    const method = (options as { method?: string } | undefined)?.method;
    if (String(url).endsWith('/cancel') && method === 'POST') { rows = []; return { data: { attemptId: 'attempt-a', state: 'CANCELED' } } as never; }
    if (String(url).endsWith('/restore') && method === 'POST') return { data: { attemptId: 'attempt-a', state: 'CANCELED' } } as never;
    return { data: rows } as never;
  });
  show('/cart');
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Cancel purchase: / })); });
  expect(await screen.findByRole('heading', { name: 'Cancel this purchase?' })).toBeInTheDocument();
  expect(vi.mocked(apiClient).mock.calls.some(([url]) => String(url).endsWith('/cancel'))).toBe(false);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel purchase' })); });
  await waitFor(() => expect(document.querySelector('[data-purchase="attempt-a"]')).toBeNull());
  const posts = vi.mocked(apiClient).mock.calls.filter(([, options]) => (options as { method?: string } | undefined)?.method === 'POST').map(([url]) => String(url));
  expect(posts).toEqual(['/api/checkout/payment-attempts/attempt-a/cancel', '/api/checkout/payment-attempts/attempt-a/restore']);
});
it('a refused cancellation keeps the purchase Processing and explains why; nothing else is sent', async () => {
  const { ApiError } = await import('@/lib/api');
  vi.mocked(apiClient).mockImplementation(async (url, options) => {
    if (String(url).endsWith('/cancel') && (options as { method?: string } | undefined)?.method === 'POST') throw new ApiError(409, 'no', undefined, 'PAYMENT_CANCEL_NOT_ALLOWED');
    return { data: [verifiedProcessing] } as never;
  });
  show('/cart');
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Cancel purchase: / })); });
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Cancel purchase' })); });
  expect(await screen.findByText(/can’t be cancelled now/)).toBeInTheDocument();
  expect(document.querySelector('[data-purchase="attempt-a"]')).not.toBeNull();
  expect(vi.mocked(apiClient).mock.calls.some(([url]) => String(url).endsWith('/restore'))).toBe(false);
});
it('a Buy Now purchase never offers to return items to the Cart', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: [{ ...verifiedProcessing, scope: 'BUY_NOW' }] });
  show('/cart');
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Cancel purchase: / })); });
  expect(await screen.findByRole('heading', { name: 'Cancel this purchase?' })).toBeInTheDocument();
  expect(screen.queryByLabelText(/Return its items to my Cart/)).not.toBeInTheDocument();
});
