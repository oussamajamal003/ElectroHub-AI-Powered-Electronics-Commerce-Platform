import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/context/AuthContext';
import { apiClient } from '@/lib/api';
import { createQueryClient, queryKeys } from '@/lib/query';
import { CartProvider } from '@/features/cart/CartProvider';
import { useCart } from '@/features/cart/context';
import type { CartData } from '@/features/cart/types';
import { CheckoutPage } from './CheckoutPage';
import { CheckoutDraftSession } from './CheckoutDraftSession';
import { PaymentLockProvider } from './PaymentLockContext';
import { PaymentStatusPage } from './PaymentStatusPage';
import { cart, confirmation, quote, shipping } from './fixtures';
import { newDraft, readDraft, readSubmittedPurchase, readPurchaseEntry, rememberPurchaseEntries, saveDraft } from './state';
import type { PaymentOutcome, PaymentSetup } from './types';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), apiClient: vi.fn() }));
vi.mock('./stripeClient', () => ({ prefetchStripe: vi.fn() }));
const confirmEntry = vi.hoisted(() => vi.fn(async () => ({ kind: 'confirmed' as const })));
vi.mock('./StripePaymentSession', async () => {
  const React = await import('react');
  const { PaymentStep } = await import('./CheckoutComponents');
  return { StripePaymentSession: React.forwardRef(function Session(props: {
    clientSecret: string; visible: boolean; children: React.ReactNode; canContinue?: boolean; onBack(): void; onContinue(): void;
  }, ref) {
    React.useImperativeHandle(ref, () => ({ validate: async () => null, confirm: confirmEntry }));
    return <><div hidden={!props.visible}><PaymentStep ready canContinue={props.canContinue} onBack={props.onBack} onContinue={props.onContinue}>
      <p data-testid="secure-session">{props.clientSecret}</p>
    </PaymentStep></div>{props.children}</>;
  }) };
});

const userId = '11111111-1111-4111-8111-111111111111';
const attemptA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const attemptB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const firstLine = cart.items[0];
if (!firstLine?.product) throw new Error('Missing Product fixture.');
const cartB: CartData = { ...cart, revision: 'b'.repeat(64), items: [{ ...firstLine, productId: attemptB,
  quantity: 1, lineTotal: '42.00', product: { ...firstLine.product, name: 'Item B', slug: 'item-b', price: '42.00' } }],
  totalQuantity: 1, subtotal: '42.00', total: '42.00' };
const quoteB = { ...quote, cartRevision: cartB.revision, subtotal: cartB.subtotal, deliveryMethods: quote.deliveryMethods.map(method => ({
  ...method, totals: { ...method.totals, subtotal: cartB.subtotal, total: method.id === 'STANDARD' ? '42.00' : method.id === 'EXPRESS' ? '51.99' : '61.99' },
})) };
const pendingA: PaymentSetup = { attemptId: attemptA, cartRevision: cart.revision, cartIdentity: 'owned-cart', intentId: 'pi_A',
  state: 'PROCESSING', providerStatus: 'processing', failureCode: null, total: cart.total, currency: 'USD', orderReference: null,
  committed: false, cart, confirmation: null, recoveryRemainder: null, recoveryActive: false, clientSecret: null, replayed: false };
const setupB: PaymentSetup = { ...pendingA, attemptId: attemptB, cartRevision: cartB.revision, intentId: 'pi_B', state: 'AWAITING_INPUT',
  providerStatus: 'requires_payment_method', total: cartB.total, cart: cartB, clientSecret: 'pi_B_secret_test' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let serverCart = cart;
let reconcileA = deferred<{ data: PaymentOutcome }>();
let setupA = deferred<{ data: PaymentSetup }>();
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear(); window.scrollTo = vi.fn();
  serverCart = cart; reconcileA = deferred(); setupA = deferred();
  vi.mocked(useAuth).mockReturnValue({ user: { id: userId, role: 'CUSTOMER' }, isAuthenticated: true, isSessionVerified: true } as ReturnType<typeof useAuth>);
  vi.mocked(apiClient).mockImplementation(async (url, options) => {
    if (url === '/api/cart') return { data: serverCart } as never;
    if (url === '/api/cart/items') { serverCart = cartB; return { data: serverCart } as never; }
    if (url === '/api/checkout') return { data: serverCart.revision === cartB.revision ? quoteB : quote } as never;
    if (url === '/api/checkout/payment-attempts') {
      return ((options?.data as { expectedRevision: string }).expectedRevision === cartB.revision ? { data: setupB } : setupA.promise) as never;
    }
    if (url === `/api/checkout/payment-attempts/${attemptA}/reconcile`) return reconcileA.promise as never;
    if (url === `/api/checkout/payment-attempts/${attemptA}`) return { data: pendingA } as never;
    throw new Error(`Unexpected offline request: ${url}`);
  });
});
function Controls() {
  const navigate = useNavigate(); const location = useLocation(); const currentCart = useCart();
  return <><output data-testid="location">{location.pathname}</output><output data-testid="search">{location.search}</output><output data-testid="entry-key">{location.key}</output><output data-testid="cart-products">{currentCart.data?.items.map(item => item.productId).join(',')}</output>
    <button onClick={() => navigate('/cart')}>Leave checkout</button><button onClick={() => navigate(-3)}>Browser Back</button>
    <button onClick={() => navigate(3)}>Browser Forward</button><button onClick={() => navigate(`/account/payment-status/${attemptA}`)}>Recover saved A</button>
    {location.pathname === '/cart' && <><button onClick={() => void currentCart.addItem(attemptB)}>Add Item B</button>
      <button onClick={() => navigate('/checkout')}>Checkout B</button></>}</>;
}
function show(path = '/checkout', cachedCart: CartData | null = cart, entryKey?: string) {
  const client = createQueryClient(); if (cachedCart) client.setQueryData(queryKeys.cart.current(userId), { data: cachedCart });
  const initialEntry = entryKey ? { pathname: path.split('?')[0], search: path.includes('?') ? `?${path.split('?')[1]}` : '', key: entryKey } : path;
  const view = render(<StrictMode><QueryClientProvider client={client}><CartProvider><MemoryRouter initialEntries={[initialEntry]}><PaymentLockProvider>
    <CheckoutDraftSession /><Controls /><Routes><Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/cart" element={<h1>Cart</h1>} /><Route path="/account/payment-status/:attemptId" element={<PaymentStatusPage />} />
      <Route path="/checkout/confirmation/:reference" element={<h1>Order A confirmed</h1>} /></Routes>
  </PaymentLockProvider></MemoryRouter></CartProvider></QueryClientProvider></StrictMode>);
  return { ...view, client };
}
it('records a durable late submit response after navigation without confirming the old form or replacing Checkout B', async () => {
  const submit = deferred<{ data: PaymentOutcome }>();
  const original = vi.mocked(apiClient).getMockImplementation()!;
  vi.mocked(apiClient).mockImplementation((url, options) => url === `/api/checkout/payment-attempts/${attemptA}/submit`
    ? submit.promise as never : original(url, options));
  saveA('setup'); show('/checkout?step=payment');
  await act(async () => { setupA.resolve({ data: { ...pendingA, state: 'AWAITING_INPUT', clientSecret: 'pi_A_secret_test' } }); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review Order' })).toBeEnabled());
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Review Order' })); });
  const submittedEntryKey = screen.getByTestId('entry-key').textContent!;
  fireEvent.click(await screen.findByRole('button', { name: /Place Order/ }));
  await waitFor(() => expect(apiClient).toHaveBeenCalledWith(`/api/checkout/payment-attempts/${attemptA}/submit`, expect.anything()));
  await leaveAndAddB(); await paymentB();
  await act(async () => { submit.resolve({ data: { ...pendingA, submittedAt: new Date().toISOString(), cart: cartB } }); });
  expect(readSubmittedPurchase(userId, 'CART_CHECKOUT')).toBe(attemptA);
  expect(readPurchaseEntry(userId, 'CART_CHECKOUT', submittedEntryKey)).toBe(attemptA);
  expect(readDraft(userId).attempt?.paymentAttemptId).toBe(attemptB);
  expect(screen.getByTestId('secure-session')).toHaveTextContent('pi_B_secret_test');
  expect(confirmEntry).not.toHaveBeenCalled();
  expect(apiClient).not.toHaveBeenCalledWith(`/api/checkout/payment-attempts/${attemptA}/reconcile`, expect.anything());
});
it('an explicit purchase status route is independent of the saved Checkout B draft and never mounts its card form', async () => {
  serverCart = cartB;
  saveDraft(userId, { ...newDraft(), shipping, shippingComplete: true, deliveryComplete: true,
    attempt: { key: attemptB, paymentAttemptId: attemptB, intentId: 'pi_B', status: 'setup',
      request: { shipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: cartB.revision } } });
  show(`/checkout?purchase=${attemptA}`, cartB);
  expect(await screen.findByRole('heading', { name: 'Checking your payment' })).toBeVisible();
  expect(readDraft(userId).attempt?.paymentAttemptId).toBe(attemptB);
  expect(screen.queryByTestId('secure-session')).not.toBeInTheDocument();
  expect(confirmEntry).not.toHaveBeenCalled();
  expect(vi.mocked(apiClient).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});
it('a submitted history entry restores A while a distinct new entry still opens Checkout B', async () => {
  serverCart = cartB;
  rememberPurchaseEntries(userId, 'CART_CHECKOUT', ['submitted-review'], attemptA);
  const reopened = show('/checkout?step=review', cartB, 'submitted-review');
  expect(await screen.findByRole('heading', { name: 'Checking your payment' })).toBeVisible();
  await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(`?purchase=${attemptA}`));
  expect(screen.getByTestId('cart-products')).toHaveTextContent(attemptB);
  expect(confirmEntry).not.toHaveBeenCalled();
  reopened.unmount();
  show('/checkout?step=shipping', cartB, 'new-checkout-b');
  expect(await screen.findByRole('heading', { name: 'Shipping Information' })).toBeVisible();
  expect(screen.queryByText('Checking your payment')).not.toBeInTheDocument();
});
function saveA(status: 'unknown' | 'setup' = 'unknown') {
  saveDraft(userId, { ...newDraft(), shipping, shippingComplete: true, deliveryComplete: true,
    attempt: { key: attemptA, paymentAttemptId: attemptA, intentId: 'pi_A', status,
      request: { shipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: cart.revision } } });
}
async function leaveAndAddB() {
  fireEvent.click(screen.getByRole('button', { name: 'Leave checkout' }));
  expect(await screen.findByRole('heading', { name: 'Cart' })).toBeVisible();
  expect(readDraft(userId).attempt).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add Item B' }));
  await waitFor(() => expect(screen.getByTestId('cart-products')).toHaveTextContent(attemptB));
  fireEvent.click(screen.getByRole('button', { name: 'Checkout B' }));
  expect(await screen.findByRole('heading', { name: 'Shipping Information' })).toBeVisible();
}
async function paymentB() {
  for (const [field, value] of Object.entries(shipping)) {
    const input = document.getElementById(`shipping-${field}`);
    if (!input) throw new Error(`Missing Shipping field ${field}`);
    fireEvent.change(input, { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Continue to Delivery' }));
  await screen.findByRole('radio', { name: /Standard Delivery/ });
  fireEvent.click(screen.getByRole('button', { name: 'Continue to Payment' }));
  expect(await screen.findByTestId('secure-session')).toHaveTextContent('pi_B_secret_test');
  expect(screen.getAllByText('$42.00').length).toBeGreaterThan(0);
  expect(screen.queryByText('Apple iPhone 15 Pro')).not.toBeInTheDocument();
}
describe('Payment/Order session isolation with production Cart and routing (offline API/Elements)', () => {
  it.each([
    ['PAID', 'shipping'], ['PAID', 'payment'], ['DECLINED', 'shipping'], ['DECLINED', 'payment'],
  ] as const)('ignores delayed A %s while B is in %s and preserves Cart B', async (state, step) => {
    saveA(); const { client } = show();
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith(`/api/checkout/payment-attempts/${attemptA}/reconcile`, expect.anything()));
    await leaveAndAddB(); if (step === 'payment') await paymentB();
    await act(async () => { reconcileA.resolve({ data: { ...pendingA, state, cart: { ...cart, items: [], totalQuantity: 0 },
      committed: state === 'PAID', confirmation: state === 'PAID' ? { ...confirmation, paymentState: 'PAID' } : null } }); });
    expect(screen.getByTestId('location')).toHaveTextContent('/checkout');
    expect(screen.getByTestId('cart-products')).toHaveTextContent(attemptB);
    expect(screen.queryByText('Order A confirmed')).not.toBeInTheDocument();
    expect(screen.queryByText('Checking your payment status…')).not.toBeInTheDocument();
    expect(client.getQueryData(queryKeys.cart.current(userId))).toEqual({ data: cartB });
    if (step === 'payment') expect(screen.getByTestId('secure-session')).toHaveTextContent('pi_B_secret_test');
  });
  it('never installs A clientSecret or draft when A setup arrives after B initializes', async () => {
    saveA('setup'); show('/checkout?step=payment');
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/api/checkout/payment-attempts', expect.anything()));
    await leaveAndAddB(); await paymentB();
    await act(async () => { setupA.resolve({ data: { ...pendingA, state: 'AWAITING_INPUT', clientSecret: 'pi_A_secret_test' } }); });
    expect(readDraft(userId).attempt?.paymentAttemptId).toBe(attemptB);
    expect(readDraft(userId).attempt?.intentId).toBe('pi_B');
    expect(screen.getByTestId('secure-session')).toHaveTextContent('pi_B_secret_test');
    expect(sessionStorage.getItem(`electrohub:checkout:v1:${userId}`)).not.toContain('pi_A_secret_test');
  });
  it('discards restored A before recovery when the authoritative Cart snapshot is B', async () => {
    saveA(); serverCart = cartB; show('/checkout', cartB);
    expect(await screen.findByRole('heading', { name: 'Shipping Information' })).toBeVisible();
    expect(apiClient).not.toHaveBeenCalledWith(`/api/checkout/payment-attempts/${attemptA}/reconcile`, expect.anything());
    expect(readDraft(userId).attempt).toBeNull();
  });
  it('keeps B isolated through Back/Forward and refresh while A stays reachable by its legacy owned route, which only redirects to Cart', async () => {
    saveA(); const view = show(); await waitFor(() => expect(apiClient).toHaveBeenCalled());
    await leaveAndAddB(); await paymentB();
    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }));
    expect(await screen.findByRole('heading', { name: 'Cart' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Browser Forward' }));
    expect(await screen.findByTestId('secure-session')).toHaveTextContent('pi_B_secret_test');
    view.unmount(); show('/checkout?step=payment', cartB);
    expect(await screen.findByTestId('secure-session')).toHaveTextContent('pi_B_secret_test');
    const requestsBefore = vi.mocked(apiClient).mock.calls.filter(([url]) => url.startsWith('/api/checkout/payment-attempts')).length;
    fireEvent.click(screen.getByRole('button', { name: 'Recover saved A' }));
    // Current contract (Scenario 1): the legacy status URL redirects to Cart with the attempt identity preserved.
    expect(await screen.findByRole('heading', { name: 'Cart' })).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('/cart');
    expect(screen.getByTestId('search')).toHaveTextContent(`?purchase=${attemptA}`);
    // The redirect adds no read, reconcile or payment setup request, so nothing new can touch B.
    expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url.startsWith('/api/checkout/payment-attempts'))).toHaveLength(requestsBefore);
    expect(screen.getByTestId('cart-products')).toHaveTextContent(attemptB);
    expect(sessionStorage.getItem(`electrohub:checkout:v1:${userId}`) ?? '').not.toContain('pi_A_secret_test');
  });
  it('rejects a setup response for the wrong snapshot instead of mounting its secure fields', async () => {
    serverCart = cartB; saveDraft(userId, { ...newDraft(), shipping, shippingComplete: true, deliveryComplete: true });
    vi.mocked(apiClient).mockImplementation(async url => {
      if (url === '/api/cart') return { data: cartB } as never;
      if (url === '/api/checkout') return { data: { ...quote, cartRevision: cartB.revision } } as never;
      return { data: { ...setupB, cartRevision: cart.revision, intentId: 'pi_A', clientSecret: 'pi_A_secret_test' } } as never;
    });
    show('/checkout?step=payment', cartB);
    expect(await screen.findByRole('alert')).toHaveTextContent('Secure payment setup could not finish');
    expect(screen.queryByTestId('secure-session')).not.toBeInTheDocument();
  });
  it.each([{ intentId: 'pi_A' }, { cartIdentity: 'foreign-cart' }])('rejects changed binding for saved B before mounting Elements: %j', async changed => {
    serverCart = cartB;
    saveDraft(userId, { ...newDraft(), shipping, shippingComplete: true, deliveryComplete: true,
      attempt: { key: attemptB, paymentAttemptId: attemptB, intentId: 'pi_B', cartIdentity: 'owned-cart', status: 'setup',
        request: { shipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: cartB.revision } } });
    vi.mocked(apiClient).mockImplementation(async url => {
      if (url === '/api/cart') return { data: cartB } as never;
      if (url === '/api/checkout') return { data: quoteB } as never;
      return { data: { ...setupB, ...changed, clientSecret: 'pi_A_secret_test' } } as never;
    });
    show('/checkout?step=payment', cartB);
    expect(await screen.findByRole('alert')).toHaveTextContent('Secure payment setup could not finish');
    expect(screen.queryByTestId('secure-session')).not.toBeInTheDocument();
  });
  it('refreshes genuinely pending A with the same attempt and never creates a replacement payment', async () => {
    saveA(); const view = show();
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith(`/api/checkout/payment-attempts/${attemptA}/reconcile`, expect.anything()));
    view.unmount(); show();
    await waitFor(() => expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url.endsWith('/reconcile'))).toHaveLength(2));
    expect(readDraft(userId).attempt?.paymentAttemptId).toBe(attemptA);
    expect(screen.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
    expect(apiClient).not.toHaveBeenCalledWith('/api/checkout/payment-attempts', expect.anything());
  });
  it('cannot redirect B from the legacy status route: it issues no detached read for A that could complete late', async () => {
    serverCart = cartB; show(`/account/payment-status/${attemptA}`, cartB);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/cart'));
    expect(screen.getByTestId('search')).toHaveTextContent(`?purchase=${attemptA}`);
    await leaveAndAddB(); await paymentB();
    // Nothing was started for A by the redirect, so no A result can arrive and navigate away from B.
    expect(apiClient).not.toHaveBeenCalledWith(`/api/checkout/payment-attempts/${attemptA}`, expect.anything());
    expect(apiClient).not.toHaveBeenCalledWith(`/api/checkout/payment-attempts/${attemptA}/reconcile`, expect.anything());
    expect(screen.getByTestId('location')).toHaveTextContent('/checkout');
    expect(screen.getByTestId('secure-session')).toHaveTextContent('pi_B_secret_test');
    expect(screen.queryByText('Order A confirmed')).not.toBeInTheDocument();
  });
  it('waits for the Cart snapshot on refresh before restoring any saved recovery', async () => {
    const readCart = deferred<{ data: CartData }>();
    const implementation = vi.mocked(apiClient).getMockImplementation()!;
    vi.mocked(apiClient).mockImplementation((url, options) => url === '/api/cart'
      ? readCart.promise as ReturnType<typeof apiClient> : implementation(url, options));
    saveA(); show('/checkout', null);
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/api/cart', { signal: undefined }));
    expect(apiClient).not.toHaveBeenCalledWith(`/api/checkout/payment-attempts/${attemptA}/reconcile`, expect.anything());
    expect(screen.queryByText('Checking your payment status…')).not.toBeInTheDocument();
    await act(async () => { readCart.resolve({ data: cartB }); });
    expect(await screen.findByRole('heading', { name: 'Shipping Information' })).toBeVisible();
    expect(readDraft(userId).attempt).toBeNull();
    expect(apiClient).not.toHaveBeenCalledWith(`/api/checkout/payment-attempts/${attemptA}/reconcile`, expect.anything());
  });
  it('rechecks authoritative Cart after A confirmation and keeps a newly changed B snapshot', async () => {
    saveA(); show();
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith(`/api/checkout/payment-attempts/${attemptA}/reconcile`, expect.anything()));
    serverCart = cartB;
    await act(async () => { reconcileA.resolve({ data: { ...pendingA, state: 'PAID', committed: true,
      cart: { ...cart, items: [], totalQuantity: 0 }, confirmation: { ...confirmation, paymentState: 'PAID' } } }); });
    expect(await screen.findByRole('heading', { name: 'Shipping Information' })).toBeVisible();
    expect(screen.getByTestId('cart-products')).toHaveTextContent(attemptB);
    expect(screen.queryByText('Order A confirmed')).not.toBeInTheDocument();
  });
});
