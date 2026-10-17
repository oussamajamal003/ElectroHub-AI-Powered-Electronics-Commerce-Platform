import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/context/AuthContext';
import { CartContext, type CartContextValue } from '@/features/cart/context';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import { apiClient, ApiError } from '@/lib/api';
import { createQueryClient } from '@/lib/query';
import { CheckoutPage } from './CheckoutPage';
import { cart, confirmation, quote, shipping } from './fixtures';
import { draftKey, newDraft, readSubmittedPurchase, rememberSubmittedPurchase, saveDraft } from './state';
import { saveBuyNow } from './buyNow';
import { announceConfirmation } from './confirmationSignal';
import { CheckoutDraftSession } from './CheckoutDraftSession';
import { queryKeys } from '@/lib/query';
import type { CartData } from '@/features/cart/types';
import type { CheckoutQuote, CheckoutScope, PaymentSetup } from './types';
import { PaymentLockProvider, usePaymentLock } from './PaymentLockContext';
import { CHECKOUT_RECOVERY_WINDOW_MS } from './paymentPresentation';
import { endPaymentObservation, observedPaymentIds } from './paymentObservation';
const actions = vi.hoisted(() => ({ validate: vi.fn(), confirm: vi.fn(), retryCart: vi.fn<() => Promise<CartData | undefined>>(), onErrors: [] as Array<() => void> }));
vi.mock('./confirmationSignal', async importOriginal => ({ ...(await importOriginal<object>()), announceConfirmation: vi.fn(async () => undefined) }));
vi.mock('./StripePaymentSession', async () => {
  const React = await import('react'); const { PaymentStep } = await import('./CheckoutComponents');
  return {
    StripePaymentSession: React.forwardRef(function FakeSession(props: { visible: boolean; children: React.ReactNode; canContinue?: boolean; onBack(): void; onContinue(): void; onError(): void }, ref) {
      // One identity per mounted form, like the real secure entry.
      const [instance] = React.useState(() => Symbol('fake-entry'));
      React.useImperativeHandle(ref, () => ({ instance, validate: () => actions.validate(), confirm: (before?: () => Promise<void>) => actions.confirm(before) }), [instance]);
      actions.onErrors.push(props.onError);
      return <><div hidden={!props.visible}><PaymentStep ready canContinue={props.canContinue} onBack={props.onBack} onContinue={props.onContinue}><p>Mock Stripe-owned secure entry</p></PaymentStep></div>{props.children}</>;
    }),
  };
});
vi.mock('./stripeClient', () => ({ prefetchStripe: vi.fn() }));
const attemptId = '55555555-5555-4555-8555-555555555555';
const endpointForRecovery = '/api/checkout/payment-attempts';
const emptyCart = { ...cart, items: [], totalQuantity: 0, subtotal: '0.00', total: '0.00', canCheckout: false };
const setup: PaymentSetup = { attemptId, state: 'AWAITING_INPUT', providerStatus: 'requires_payment_method', failureCode: null,
  total: cart.total, currency: 'USD', orderReference: null, committed: false, cart, recoveryRemainder: null,
  confirmation: null, recoveryActive: false, clientSecret: 'mock-transient-secret', replayed: false };

vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), apiClient: vi.fn() }));
const userId = 'customer';
beforeEach(() => {
  for (const id of observedPaymentIds(userId)) endPaymentObservation(userId, id);
  vi.clearAllMocks(); actions.onErrors.length = 0; sessionStorage.clear(); window.scrollTo = vi.fn();
  actions.validate.mockResolvedValue(null); actions.confirm.mockResolvedValue({ kind: 'confirmed' });
  actions.retryCart.mockResolvedValue(undefined);
  vi.mocked(useAuth).mockReturnValue({ user: { id: userId, role: 'CUSTOMER' }, isAuthenticated: true, isSessionVerified: true, isInitializing: false } as ReturnType<typeof useAuth>);
  vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/submit')) return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never;
    if (endpoint === '/api/checkout') return { data: quote } as never;
    if (endpoint === '/api/checkout/payment-attempts') return { data: setup } as never;
    if (endpoint.includes('/attempts/')) throw new ApiError(404, 'Order not found');
    throw new Error(`Unexpected test request ${endpoint}`);
  });
});
function show(path: string | { pathname: string; search?: string; state?: unknown } = '/checkout?step=shipping', initial: CartData = cart, reuseScope = false, controlMutation = false) {
  const client = createQueryClient();
  function CartFixture({ children }: { children: React.ReactNode }) {
    const [data, setData] = useState(initial);
    const [mutating, setMutating] = useState(false);
    const value: CartContextValue = { data, totalQuantity: data.totalQuantity, isGuest: false, isLoggingOut: false, isLoading: false, isError: false, isMutating: mutating,
      pendingProductIds: [], pendingRemoveProductIds: [], mergeError: null, pendingGuestItems: [], addItem: vi.fn(), setQuantity: vi.fn(), removeItem: vi.fn(), retry: async () => {
        const refreshed = await actions.retryCart();
        if (refreshed) { client.setQueryData(queryKeys.cart.current(userId), { data: refreshed }); setData(refreshed); }
      }, validateRoute: vi.fn(), retryMerge: vi.fn(), removePendingGuestItem: vi.fn(),
      submitCheckout: async operation => { const response = await operation(); setData(response.cart); return response.result; } };
    return <CartContext.Provider value={value}>{controlMutation && <><button onClick={() => setMutating(true)}>Start Cart update</button><button onClick={() => setMutating(false)}>Finish Cart update</button></>}{children}</CartContext.Provider>;
  }
  function PaymentLockProbe() { const lock = usePaymentLock(); return <span data-testid="payment-lock-state">{lock.paymentState}</span>; }
  function CartReturn() { const navigate = useNavigate(); return <><h1>Cart return</h1><button onClick={() => navigate('/checkout')}>Proceed to Checkout</button></>; }
  function ReusedCheckoutRoute() {
    const [scope, setScope] = useState<CheckoutScope>('CART_CHECKOUT');
    return <><button onClick={() => setScope(current => current === 'CART_CHECKOUT' ? 'BUY_NOW' : 'CART_CHECKOUT')}>Switch checkout scope</button><CheckoutPage scope={scope} /></>;
  }
  render(<QueryClientProvider client={client}><CartFixture><MemoryRouter initialEntries={[path]}><PaymentLockProvider><PaymentLockProbe /><Routes>
    <Route element={<ProtectedRoute requireVerifiedSession requiredRole="CUSTOMER" redirectTo="/cart" preserveReturnPath />}>
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/checkout/buy-now" element={<CheckoutPage scope="BUY_NOW" />} />
      {reuseScope && <Route path="/checkout/reused" element={<ReusedCheckoutRoute />} />}
    </Route>
    <Route path="/cart" element={<CartReturn />} /><Route path="/checkout/confirmation/:reference" element={<h1>Persisted Confirmation</h1>} />
    <Route path="/account/payment-status/:attemptId" element={<h1>Account payment status</h1>} />
  </Routes></PaymentLockProvider></MemoryRouter></CartFixture></QueryClientProvider>);
  return client;
}
function reviewedDraft() { saveDraft(userId, { ...newDraft(), shipping, shippingComplete: true, deliveryComplete: true, paymentComplete: true }); }
/** A new checkout after a submitted purchase starts clean: the submitted purchase's address is not carried over. */
function enterFreshShipping() {
  expect(document.getElementById('shipping-recipient')).toHaveValue('');
  for (const [field, value] of Object.entries(shipping)) fireEvent.change(document.getElementById(`shipping-${field}`)!, { target: { value } });
}
async function enterReview() {
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Payment Method' })).toBeVisible());
  // Re-query: the pre-setup placeholder button is replaced when the secure session mounts.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review Order' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Review Order' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Place Order/ })).toBeEnabled());
}
describe('Checkout page integration', () => {
  it('editing shipping cannot issue cancellation for the saved authorized purchase', async () => {
    const oldRequest = { shipping: { ...shipping, city: 'Previous City' }, deliveryMethod: 'STANDARD' as const,
      paymentMethod: 'CARD' as const, expectedRevision: cart.revision };
    saveDraft(userId, { ...newDraft(), shipping, shippingComplete: true, deliveryComplete: true,
      attempt: { key: attemptId, paymentAttemptId: attemptId, request: oldRequest, status: 'setup' } });
    vi.mocked(apiClient).mockImplementation(async url => {
      if (url.endsWith('/submit')) return { data: { ...setup, attemptId: url.split('/').at(-2) } } as never;
      if (url === '/api/checkout') return { data: quote } as never;
      if (url === `${endpointForRecovery}/${attemptId}`) return { data: { ...setup, state: 'AUTHORIZED' } } as never;
      throw new Error(`Unauthorized test operation ${url}`);
    });
    show('/checkout?step=payment');
    expect(await screen.findByRole('alert')).toHaveTextContent('Checking its status');
    expect(screen.getByRole('link', { name: 'Check saved payment' })).toHaveAttribute('href', `/account/payment-status/${attemptId}?scope=CART_CHECKOUT`);
    expect(screen.getByRole('button', { name: 'Review Order' })).toBeDisabled();
    expect(vi.mocked(apiClient).mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
    expect(actions.confirm).not.toHaveBeenCalled();
  });
  it('observes a foreign old checkout release without installing its Cart or confirmation, then resumes the exact setup key', async () => {
    reviewedDraft(); const oldId = '99999999-9999-4999-8999-999999999999';
    const keys: string[] = []; let reads = 0;
    vi.mocked(apiClient).mockImplementation(async (url, options) => {
      if (url.endsWith('/submit')) return { data: { ...setup, attemptId: url.split('/').at(-2) } } as never;
      if (url === '/api/checkout') return { data: quote } as never;
      if (url === endpointForRecovery) {
        keys.push(new Headers(options?.headers).get('Idempotency-Key')!);
        if (keys.length === 1) throw new ApiError(409, 'Existing payment unresolved', { error: { recovery: { attemptId: oldId } } }, 'PAYMENT_RECOVERY_PENDING');
        return { data: { ...setup, cartRevision: cart.revision, intentId: 'pi_current' } } as never;
      }
      if (url === `${endpointForRecovery}/${oldId}`) {
        reads++;
        return { data: { ...setup, attemptId: oldId, state: 'CANCELED', cart: emptyCart, confirmation,
          intentId: 'pi_old', cartRevision: 'a'.repeat(64) } } as never;
      }
      throw new Error(`Unexpected ${url}`);
    });
    show('/checkout?step=payment');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review Order' })).toBeEnabled(), { timeout: 5000 });
    expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]); expect(reads).toBe(1);
    expect(actions.retryCart).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Persisted Confirmation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry payment setup' })).not.toBeInTheDocument();
    expect(actions.confirm).not.toHaveBeenCalled();
  });
  it('does not detach an authorized blocker or start a second payment on unknown blocker readback', async () => {
    reviewedDraft(); const oldId = '99999999-9999-4999-8999-999999999999'; let setups = 0;
    vi.mocked(apiClient).mockImplementation(async url => {
      if (url.endsWith('/submit')) return { data: { ...setup, attemptId: url.split('/').at(-2) } } as never;
      if (url === '/api/checkout') return { data: quote } as never;
      if (url === endpointForRecovery) { setups++; throw new ApiError(409, 'Existing payment unresolved',
        { error: { recovery: { attemptId: oldId, state: 'AUTHORIZED' } } }, 'PAYMENT_RECOVERY_PENDING'); }
      if (url === `${endpointForRecovery}/${oldId}`) throw new ApiError(503, 'Unavailable readback');
      throw new Error(`Unexpected ${url}`);
    });
    show('/checkout?step=payment');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('previous payment status could not be verified'));
    expect(setups).toBe(1); expect(screen.getByRole('button', { name: 'Review Order' })).toBeDisabled();
    expect(actions.confirm).not.toHaveBeenCalled();
  });
  it.each(['CART_CHECKOUT', 'BUY_NOW'] as const)('classifies an asynchronous confirmed decline promptly and restores ready entry in %s', async scope => {
    const buyNow = { productId: cart.items[0]!.productId, quantity: 2 };
    if (scope === 'BUY_NOW') saveBuyNow(buyNow);
    saveDraft(userId, { ...newDraft(), shipping, shippingComplete: true, deliveryComplete: true, paymentComplete: true }, scope);
    let setups = 0; let statusReads = 0; let reconciles = 0; let quoteReads = 0;
    const nextId = '77777777-7777-4777-8777-777777777777';
    vi.mocked(apiClient).mockImplementation(async (url, options) => {
      if (url.endsWith('/submit')) return { data: { ...setup, attemptId: url.split('/').at(-2) } } as never;
      if (url === '/api/checkout/payment-capability') return { data: { paymentsEnabled: true } } as never;
      if (url.startsWith('/api/checkout') && !url.includes('payment-attempts')) {
        quoteReads++;
        if (quoteReads === 2) throw new ApiError(503, 'Transient quote failure');
        return { data: scope === 'BUY_NOW' ? { ...quote, scope, summary: cart } : quote } as never;
      }
      if (url === endpointForRecovery) {
        setups++;
        if (scope === 'BUY_NOW') expect(options?.data).toMatchObject({ scope, buyNow });
        return { data: { ...setup, attemptId: setups === 1 ? attemptId : nextId, intentId: setups === 1 ? 'pi_current' : 'pi_new', cartRevision: cart.revision } } as never;
      }
      if (url.endsWith('/reconcile')) { reconciles++; return { data: { ...setup, intentId: 'pi_current', recoveryActive: true } } as never; }
      if (url === `${endpointForRecovery}/${attemptId}`) { statusReads++; return { data: { ...setup, intentId: 'pi_current', state: 'DECLINED', providerStatus: 'requires_payment_method', failureCode: 'PAYMENT_DECLINED' } } as never; }
      throw new Error(`Unexpected ${url}`);
    });
    show(`${scope === 'BUY_NOW' ? '/checkout/buy-now' : '/checkout'}?step=review`); await enterReview();
    fireEvent.click(screen.getByRole('button', { name: /Place Order/ }));
    expect(await screen.findByRole('heading', { name: 'Payment Failed' })).toBeVisible();
    expect(statusReads).toBe(1); expect(reconciles).toBe(1);
    expect(screen.queryByText('Account payment status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review Order' })).toBeEnabled());
    expect(setups).toBe(2); expect(quoteReads).toBe(3); expect(actions.confirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Refresh totals' })).not.toBeInTheDocument();
  });

  it('automatically retries read-only totals recovery once but preserves a genuine unavailable backend', async () => {
    reviewedDraft(); let reads = 0;
    vi.mocked(apiClient).mockImplementation(async url => {
      if (url.endsWith('/submit')) return { data: { ...setup, attemptId: url.split('/').at(-2) } } as never;
      if (url === '/api/checkout') { reads++; throw new ApiError(503, 'Unavailable'); }
      throw new Error(`Unexpected payment operation ${url}`);
    });
    show('/checkout?step=payment');
    await waitFor(() => expect(reads).toBe(4), { timeout: 4000 });
    expect(screen.getByRole('button', { name: 'Review Order' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh totals' })).toBeEnabled();
    expect(vi.mocked(apiClient).mock.calls.some(([url]) => url === endpointForRecovery)).toBe(false);
  });
  it('identifies pending Cart work without inventing a validation error and starts setup when it finishes', async () => {
    reviewedDraft(); show('/checkout?step=delivery', cart, false, true);
    await screen.findByRole('radio', { name: /Standard Delivery/ });
    fireEvent.click(screen.getByRole('button', { name: 'Start Cart update' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Payment' }));
    expect(screen.getByRole('status')).toHaveTextContent('An earlier Cart or checkout update is still finishing');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh totals' })).toBeEnabled();
    expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url === '/api/checkout/payment-attempts')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Finish Cart update' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review Order' })).toBeEnabled());
    expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url === '/api/checkout/payment-attempts')).toHaveLength(1);
  });
  it('provides an in-section error and refresh action when Cart and quote eligibility disagree', async () => {
    reviewedDraft(); show('/checkout?step=payment', { ...cart, canCheckout: false });
    expect(await screen.findByRole('alert')).toHaveTextContent('Cart availability is not verified');
    expect(screen.getByRole('button', { name: 'Refresh totals' })).toBeEnabled();
    expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url === '/api/checkout/payment-attempts')).toHaveLength(0);
  });
  it('starts secure setup when quote eligibility recovers without a revision change', async () => {
    reviewedDraft();
    let eligible = false;
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/submit')) return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never;
      if (endpoint === '/api/checkout') return { data: { ...quote, eligible } } as never;
      if (endpoint === '/api/checkout/payment-attempts') return { data: setup } as never;
      throw new Error('Unexpected request');
    });
    show('/checkout?step=payment');
    await screen.findByText('Your Cart needs review before payment. Check quantities, availability and current prices.');
    expect(screen.queryByRole('status', { name: 'Loading secure payment form' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Your Cart needs review');
    expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url === '/api/checkout/payment-attempts')).toHaveLength(0);
    eligible = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh totals' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review Order' })).toBeEnabled());
    expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url === '/api/checkout/payment-attempts')).toHaveLength(1);
  });
  it('places the Home > Cart > Checkout breadcrumb above the title and stepper', () => {
    show();
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const title = screen.getByRole('heading', { name: 'Checkout', level: 1 });
    const stepper = screen.getByRole('navigation', { name: 'Checkout steps' });
    expect(breadcrumb.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.compareDocumentPosition(stepper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(breadcrumb).toHaveTextContent('HomeCartCheckout');
  });
  it('does not authorize checkout from cached identity until session verification', () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: userId, role: 'CUSTOMER' }, isAuthenticated: true, isSessionVerified: false, isInitializing: false } as ReturnType<typeof useAuth>);
    show(); expect(screen.getByRole('status')).toBeInTheDocument(); expect(apiClient).not.toHaveBeenCalled();
  });
  it('redirects guest to Cart and protects direct future steps', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, isAuthenticated: false, isSessionVerified: true, isInitializing: false } as ReturnType<typeof useAuth>);
    show(); expect(screen.getByText('Cart return')).toBeVisible(); expect(apiClient).not.toHaveBeenCalled();
  });
  it('uses one quote across steps and updates paid delivery totals immediately', async () => {
    saveDraft(userId, { ...newDraft(), shipping, shippingComplete: true }); show('/checkout?step=delivery');
    await screen.findByRole('radio', { name: /Express Delivery/ });
    fireEvent.click(screen.getByRole('radio', { name: /Express Delivery/ })); expect(screen.getByText('$2,209.97')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Payment' })); await enterReview();
    expect(screen.getByText(/123 Demo Street/)).toBeVisible(); expect(actions.confirm).not.toHaveBeenCalled();
    expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url === '/api/checkout')).toHaveLength(1);
  });
  it('saves the attempt before POST and blocks duplicate clicks until authoritative commit', async () => {
    reviewedDraft(); let resolve: ((value: unknown) => void) | undefined;
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/submit')) return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never;
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/checkout/payment-attempts') return { data: setup } as never;
      return new Promise(done => { resolve = done; });
    });
    show('/checkout?step=review'); await enterReview(); const button = await screen.findByRole('button', { name: /Place Order/ });
    await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button); fireEvent.click(button);
    await screen.findByText('Processing your order…');
    expect(JSON.parse(sessionStorage.getItem('electrohub:checkout:v1:customer') ?? '{}').draft.attempt.key).toMatch(/^[a-f0-9-]{36}$/);
    const observed = { genericSuccess: false };
    const observer = new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node => node.textContent?.includes('Payment confirmed')))) observed.genericSuccess = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    await waitFor(() => expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url.endsWith('/reconcile'))).toHaveLength(1));
    expect(actions.confirm).toHaveBeenCalledTimes(1); expect(vi.mocked(apiClient).mock.calls.some(([url]) => url === '/api/orders')).toBe(false);
    if (!resolve) throw new Error('Missing pending reconcile');
    resolve({ data: { ...setup, state: 'PAID', committed: true, orderReference: confirmation.orderReference,
      confirmation: { ...confirmation, paymentState: 'PAID' }, cart: emptyCart, recoveryActive: false } });
    await screen.findByText('Persisted Confirmation');
    await act(async () => { await Promise.resolve(); });
    observer.disconnect();
    expect(observed.genericSuccess).toBe(false);
    expect(sessionStorage.getItem('electrohub:checkout:v1:customer')).toBeNull();
  });
  it('shows Processing for a pending reconciliation, then confirms the verified same attempt', async () => {
    reviewedDraft();
    let resolveStatus: ((value: unknown) => void) | undefined;
    let statusReads = 0;
    const processingSnapshot = { ...setup, state: 'PROCESSING' as const, recoveryActive: true };
    const paid = { ...setup, state: 'PAID' as const, committed: true, orderReference: confirmation.orderReference,
      confirmation: { ...confirmation, paymentState: 'PAID' as const }, cart: emptyCart, recoveryActive: false };
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/submit')) return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never;
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/checkout/payment-attempts') return { data: setup } as never;
      if (endpoint === `/api/checkout/payment-attempts/${attemptId}/reconcile`) return { data: processingSnapshot } as never;
      if (endpoint === `/api/checkout/payment-attempts/${attemptId}`) {
        statusReads++;
        if (statusReads === 1) return new Promise(resolve => { resolveStatus = resolve; });
        return { data: paid } as never;
      }
      throw new Error(`Unexpected request ${endpoint}`);
    });

    show('/checkout?step=review');
    await enterReview();
    fireEvent.click(await screen.findByRole('button', { name: /Place Order/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /Processing your order/ })).toBeVisible());
    expect(screen.queryByRole('heading', { name: 'Payment Failed' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
    await waitFor(() => expect(resolveStatus).toBeDefined());

    await act(async () => { resolveStatus?.({ data: paid }); });
    await screen.findByText('Persisted Confirmation');
    expect(screen.queryByRole('heading', { name: 'Payment Failed' })).not.toBeInTheDocument();
    expect(actions.confirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url.endsWith('/reconcile'))).toHaveLength(1);
    expect(statusReads).toBe(1);
  });
  it('ignores a delayed old-attempt status response after the customer starts a fresh retry', async () => {
    const nextId = '77777777-7777-4777-8777-777777777777';
    let setupCount = 0;
    let statusReads = 0;
    let resolveOldRead: ((value: unknown) => void) | undefined;
    const declined = { ...setup, state: 'DECLINED' as const, failureCode: 'PAYMENT_DECLINED', recoveryActive: false };
    const oldPaid = { ...setup, state: 'PAID' as const, committed: true, orderReference: confirmation.orderReference,
      confirmation: { ...confirmation, paymentState: 'PAID' as const }, cart: emptyCart, recoveryActive: false };
    reviewedDraft();
    actions.confirm.mockResolvedValue({ kind: 'provider-error', message: 'The card was declined.' });
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/submit')) return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never;
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/checkout/payment-attempts') return { data: setupCount++ === 0 ? setup : { ...setup, attemptId: nextId } } as never;
      if (endpoint === `/api/checkout/payment-attempts/${attemptId}/reconcile`) return { data: declined } as never;
      if (endpoint === `/api/checkout/payment-attempts/${attemptId}`) {
        statusReads++;
        return new Promise(resolve => { resolveOldRead = resolve; });
      }
      throw new Error(`Unexpected request ${endpoint}`);
    });

    show('/checkout?step=review');
    await enterReview();
    fireEvent.click(await screen.findByRole('button', { name: /Place Order/ }));
    expect(await screen.findByRole('heading', { name: 'Payment Failed' })).toBeVisible();
    await waitFor(() => expect(resolveOldRead).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    await screen.findByText('Mock Stripe-owned secure entry');
    await waitFor(() => expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url === '/api/checkout/payment-attempts')).toHaveLength(2));

    await act(async () => { resolveOldRead?.({ data: oldPaid }); });
    expect(screen.queryByText('Persisted Confirmation')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Payment confirmed' })).not.toBeInTheDocument();
    expect(screen.getByText('Mock Stripe-owned secure entry')).toBeVisible();
    expect(statusReads).toBe(1);
  });
  it.each(['Try Again', 'Return to Cart'])('reconciles decline then submits a fresh usable attempt via %s (mocked payment)', async action => {
    const nextId = '66666666-6666-4666-8666-666666666666'; let setups = 0;
    reviewedDraft(); actions.confirm.mockResolvedValueOnce({ kind: 'provider-error', message: 'The card could not be authorized.' }).mockResolvedValue({ kind: 'confirmed' });
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/submit')) return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never;
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/checkout/payment-attempts') return { data: setups++ === 0 ? setup : { ...setup, attemptId: nextId, clientSecret: 'pi_next_secret_fixture' } } as never;
      if (endpoint === `/api/checkout/payment-attempts/${attemptId}/reconcile`) return { data: { ...setup, state: 'DECLINED', failureCode: 'PAYMENT_DECLINED', recoveryActive: false } } as never;
      if (endpoint === `/api/checkout/payment-attempts/${nextId}/reconcile`) return { data: { ...setup, attemptId: nextId, state: 'PAID', committed: true,
        confirmation: { ...confirmation, paymentState: 'PAID' }, cart: emptyCart } } as never;
      throw new Error(`Unexpected test request ${endpoint}`);
    });
    show('/checkout?step=review'); await enterReview();
    fireEvent.click(await screen.findByRole('button', { name: /Place Order/ }));
    await screen.findByRole('heading', { name: 'Payment Failed' });
    expect(screen.getByText('Your payment was declined. Please check your card details or try a different card.')).toBeVisible();
    expect(screen.getByText('Payment not processed')).toBeVisible();
    expect(screen.getByText('Your purchase has been preserved. You can try again or use another card.')).toBeVisible();
    expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url.endsWith('/reconcile'))).toHaveLength(1);
    expect(vi.mocked(apiClient).mock.calls.some(([url]) => url === '/api/orders')).toBe(false);
    expect(screen.getAllByRole('heading', { name: 'Payment Failed' })).toHaveLength(1);
    expect(screen.queryByText('The card could not be authorized.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check payment status' })).not.toBeInTheDocument();
    const keys = vi.mocked(apiClient).mock.calls.filter(([url]) => url === '/api/checkout/payment-attempts').map(([, options]) => new Headers(options?.headers).get('Idempotency-Key'));
    const staleElementError = actions.onErrors[0];
    if (action === 'Try Again') fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    else {
      fireEvent.click(screen.getByRole('link', { name: 'Return to Cart' }));
      fireEvent.click(screen.getByRole('button', { name: 'Proceed to Checkout' }));
      enterFreshShipping();
      fireEvent.click(screen.getByRole('button', { name: 'Continue to Delivery' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Continue to Payment' }));
    }
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review Order' })).toBeEnabled());
    if (action === 'Try Again') {
      act(() => staleElementError?.());
      expect(screen.queryByText('Secure card entry could not load. Retry payment setup.')).not.toBeInTheDocument();
    }
    const resumedKeys = vi.mocked(apiClient).mock.calls.filter(([url]) => url === '/api/checkout/payment-attempts').map(([, options]) => new Headers(options?.headers).get('Idempotency-Key'));
    expect(resumedKeys).toHaveLength(2);
    expect(resumedKeys[0]).toBe(keys[0]);
    expect(resumedKeys[1]).not.toBe(resumedKeys[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Review Order' }));
    const place = await screen.findByRole('button', { name: /Place Order/ });
    fireEvent.click(place); fireEvent.click(place);
    await screen.findByText('Persisted Confirmation');
    expect(actions.confirm).toHaveBeenCalledTimes(2);
    expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url === `/api/checkout/payment-attempts/${nextId}/reconcile`)).toHaveLength(1);
  });

  it('keeps one setup skeleton for PREPARING and resumes the same attempt when ready', async () => {
    reviewedDraft();
    vi.mocked(apiClient).mockImplementation(async (endpoint, options) => {
      if (endpoint.endsWith('/submit')) return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never;
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/checkout/payment-attempts' && vi.mocked(apiClient).mock.calls.filter(([url]) => url === endpoint).length === 1) {
        return { data: { ...setup, state: 'PREPARING', clientSecret: null } } as never;
      }
      if (endpoint === `/api/checkout/payment-attempts/${attemptId}`) return { data: { ...setup, state: 'AWAITING_INPUT' } } as never;
      if (endpoint === '/api/checkout/payment-attempts') return { data: setup } as never;
      throw new Error(`Unexpected setup test request ${endpoint} ${String(options?.method ?? '')}`);
    });
    show('/checkout?step=payment');
    expect(await screen.findByRole('status', { name: 'Loading secure payment form' })).toBeVisible();
    expect(screen.queryByText(/setup is pending/i)).not.toBeInTheDocument();
    await screen.findByText('Mock Stripe-owned secure entry', {}, { timeout: 5000 });
    const calls = vi.mocked(apiClient).mock.calls.filter(([url]) => url === '/api/checkout/payment-attempts');
    expect(calls).toHaveLength(2);
    expect(new Headers(calls[0]?.[1]?.headers).get('Idempotency-Key')).toBe(new Headers(calls[1]?.[1]?.headers).get('Idempotency-Key'));
  });

  it('replaces setup loading with one actionable retry after a sanitized setup failure', async () => {
    reviewedDraft(); let setupRequests = 0;
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/submit')) return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never;
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/checkout/payment-attempts') { setupRequests += 1; throw new ApiError(503, 'Payment setup unavailable'); }
      throw new Error(`Unexpected setup failure test request ${endpoint}`);
    });
    show('/checkout?step=payment');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Secure payment setup could not finish. Your saved attempt is safe. Retry payment setup to resume it.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByRole('status', { name: 'Loading secure payment form' })).not.toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry payment setup' });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    await waitFor(() => expect(setupRequests).toBe(2));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Retry payment setup' })).toBeEnabled();
  });

  it('automatically resumes current secure entry after Cart re-entry while its setup lease resolves', async () => {
    reviewedDraft(); const nextId = '77777777-7777-4777-8777-777777777777';
    const keys: (string | null)[] = [];
    let finishStatus: ((value: { data: PaymentSetup }) => void) | undefined;
    vi.mocked(apiClient).mockImplementation(async (url, options) => {
      if (url.endsWith('/submit')) return { data: { ...setup, attemptId: url.split('/').at(-2) } } as never;
      if (url === '/api/checkout') return { data: quote } as never;
      if (url === endpointForRecovery) {
        keys.push(new Headers(options?.headers).get('Idempotency-Key'));
        return { data: keys.length === 1 ? setup : { ...setup, attemptId: nextId,
          clientSecret: keys.length === 2 ? null : 'current-secure-entry', recoveryActive: keys.length === 2 } } as never;
      }
      if (url.endsWith('/reconcile')) return { data: { ...setup, state: 'DECLINED', failureCode: 'PAYMENT_DECLINED' } } as never;
      if (url === `${endpointForRecovery}/${nextId}`) return new Promise(resolve => { finishStatus = resolve; });
      throw new Error(`Unexpected ${url}`);
    });
    show('/checkout?step=review'); await enterReview(); fireEvent.click(screen.getByRole('button', { name: /Place Order/ }));
    fireEvent.click(await screen.findByRole('link', { name: 'Return to Cart' }));
    fireEvent.click(screen.getByRole('button', { name: 'Proceed to Checkout' }));
    enterFreshShipping();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Delivery' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to Payment' }));
    await waitFor(() => expect(finishStatus).toBeDefined());
    expect(screen.getByRole('button', { name: 'Review Order' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Retry payment setup' })).not.toBeInTheDocument();
    await act(async () => { finishStatus?.({ data: { ...setup, attemptId: nextId, clientSecret: null } }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review Order' })).toBeEnabled());
    expect(keys).toHaveLength(3); expect(keys[1]).not.toBe(keys[0]); expect(keys[2]).toBe(keys[1]);
    expect(actions.confirm).toHaveBeenCalledTimes(1);
  });

  it.each(['CANCELED', 'DECLINED'] as const)('automatically revalidates and replaces a confirmed %s setup once', async state => {
    reviewedDraft(); const keys: (string | null)[] = [];
    vi.mocked(apiClient).mockImplementation(async (url, options) => {
      if (url.endsWith('/submit')) return { data: { ...setup, attemptId: url.split('/').at(-2) } } as never;
      if (url === '/api/checkout') return { data: quote } as never;
      if (url === endpointForRecovery) {
        keys.push(new Headers(options?.headers).get('Idempotency-Key'));
        return { data: keys.length === 1 ? { ...setup, state, clientSecret: null, failureCode: 'PAYMENT_EXPIRED' }
          : { ...setup, attemptId: '77777777-7777-4777-8777-777777777777' } } as never;
      }
      throw new Error(`Unexpected ${url}`);
    });
    show('/checkout?step=payment');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review Order' })).toBeEnabled());
    expect(keys).toHaveLength(2); expect(keys[1]).not.toBe(keys[0]);
    expect(actions.retryCart).toHaveBeenCalledTimes(1); expect(actions.confirm).not.toHaveBeenCalled();
    expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url === '/api/checkout')).toHaveLength(2);
  });

  it('waits for the current quote instead of setting up from a stale cached quote', async () => {
    reviewedDraft(); let resolveQuote: ((value: { data: CheckoutQuote }) => void) | undefined;
    vi.mocked(apiClient).mockImplementation(async url => {
      if (url.endsWith('/submit')) return { data: { ...setup, attemptId: url.split('/').at(-2) } } as never;
      if (url === '/api/checkout') return new Promise(resolve => { resolveQuote = resolve; });
      if (url === endpointForRecovery) return { data: setup } as never;
      throw new Error(`Unexpected ${url}`);
    });
    const client = show('/checkout?step=payment');
    act(() => { client.setQueryData(queryKeys.checkout.current(userId, cart.revision), { data: quote }); });
    await waitFor(() => expect(resolveQuote).toBeDefined());
    expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url === endpointForRecovery)).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Review Order' })).toBeDisabled();
    await act(async () => { resolveQuote?.({ data: quote }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review Order' })).toBeEnabled());
    expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url === endpointForRecovery)).toHaveLength(1);
  });

  it.each(['AUTHORIZED', 'CAPTURE_PENDING', 'PROCESSING'] as const)('preserves a %s setup in recovery without another setup or authorization', async state => {
    reviewedDraft(); let setupCalls = 0;
    const resolving = { ...setup, state, clientSecret: null, recoveryActive: true, committed: state === 'CAPTURE_PENDING' };
    vi.mocked(apiClient).mockImplementation(async url => {
      if (url.endsWith('/submit')) return { data: { ...setup, attemptId: url.split('/').at(-2) } } as never;
      if (url === '/api/checkout') return { data: quote } as never;
      if (url === endpointForRecovery) { setupCalls++; return { data: resolving } as never; }
      if (url === `${endpointForRecovery}/${attemptId}`) return { data: resolving } as never;
      throw new Error(`Unexpected financial callback ${url}`);
    });
    show('/checkout?step=payment');
    await waitFor(() => expect(screen.getByRole('heading', { name: /Checking your payment/ })).toBeVisible());
    expect(screen.queryByRole('button', { name: 'Review Order' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry payment setup' })).not.toBeInTheDocument();
    expect(setupCalls).toBe(1); expect(actions.confirm).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(draftKey(userId))!).draft.attempt.paymentAttemptId).toBe(attemptId);
  });

  it('retains an ambiguous setup key across quote refresh and deduplicates explicit retries', async () => {
    reviewedDraft(); const keys: (string | null)[] = []; let quoteReads = 0;
    vi.mocked(apiClient).mockImplementation(async (url, options) => {
      if (url.endsWith('/submit')) return { data: { ...setup, attemptId: url.split('/').at(-2) } } as never;
      if (url === '/api/checkout') { quoteReads++; return { data: quote } as never; }
      if (url === endpointForRecovery) {
        keys.push(new Headers(options?.headers).get('Idempotency-Key'));
        if (keys.length === 1) throw new ApiError(0, 'Connection lost');
        return { data: setup } as never;
      }
      throw new Error(`Unexpected ${url}`);
    });
    const client = show('/checkout?step=payment');
    await screen.findByRole('button', { name: 'Retry payment setup' });
    await act(async () => { await client.invalidateQueries({ queryKey: ['checkout', userId] }); });
    expect(quoteReads).toBe(2); expect(keys).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Review Order' })).toBeDisabled();
    const retry = screen.getByRole('button', { name: 'Retry payment setup' });
    fireEvent.click(retry); fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review Order' })).toBeEnabled());
    expect(keys).toHaveLength(2); expect(keys[1]).toBe(keys[0]); expect(actions.confirm).not.toHaveBeenCalled();
  });

  it('stops automatic replacement after one confirmed terminal recovery', async () => {
    reviewedDraft(); let setupCalls = 0;
    vi.mocked(apiClient).mockImplementation(async url => {
      if (url.endsWith('/submit')) return { data: { ...setup, attemptId: url.split('/').at(-2) } } as never;
      if (url === '/api/checkout') return { data: quote } as never;
      if (url === endpointForRecovery) { setupCalls++; return { data: { ...setup, state: 'CANCELED', clientSecret: null } } as never; }
      if (url === `${endpointForRecovery}/${attemptId}`) return { data: { ...setup, state: 'CANCELED' } } as never;
      throw new Error(`Unexpected ${url}`);
    });
    show('/checkout?step=payment');
    expect(await screen.findByRole('heading', { name: 'Payment failed' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeEnabled();
    expect(setupCalls).toBe(2); expect(actions.retryCart).toHaveBeenCalledTimes(1); expect(actions.confirm).not.toHaveBeenCalled();
  });

  it('retains setup identity and exposes failed lease-status readback without resubmitting', async () => {
    reviewedDraft(); let setups = 0; let reads = 0;
    vi.mocked(apiClient).mockImplementation(async url => {
      if (url.endsWith('/submit')) return { data: { ...setup, attemptId: url.split('/').at(-2) } } as never;
      if (url === '/api/checkout') return { data: quote } as never;
      if (url === endpointForRecovery) { setups++; return { data: { ...setup, clientSecret: null, recoveryActive: true } } as never; }
      if (url === `${endpointForRecovery}/${attemptId}`) { reads++; throw new ApiError(503, 'Unavailable'); }
      throw new Error(`Unexpected ${url}`);
    });
    show('/checkout?step=payment');
    expect(await screen.findByRole('alert')).toHaveTextContent('Current payment setup could not be checked');
    expect(screen.getByRole('button', { name: 'Review Order' })).toBeDisabled();
    expect(setups).toBe(1); expect(reads).toBe(1); expect(actions.confirm).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(draftKey(userId))!).draft.attempt.paymentAttemptId).toBe(attemptId);
  });

  it('keeps Review Order unavailable until current Checkout validation passes', async () => {
    reviewedDraft();
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/submit')) return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never;
      if (endpoint === '/api/checkout') return { data: { ...quote, eligible: false } } as never;
      throw new Error(`Unexpected request while checkout is invalid: ${endpoint}`);
    });
    show('/checkout?step=payment');
    const reviewButton = await screen.findByRole('button', { name: 'Review Order' });
    expect(reviewButton).toBeDisabled();
    expect(apiClient).not.toHaveBeenCalledWith('/api/checkout/payment-attempts', expect.anything());
  });
  it('keeps pre-confirmation validation errors local and retryable', async () => {
    reviewedDraft(); actions.confirm.mockResolvedValue({ kind: 'validation-error', message: 'Check the secure card form.' });
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/submit')) return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never;
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/checkout/payment-attempts') return { data: setup } as never;
      throw new Error(`Unexpected request after local validation: ${endpoint}`);
    });
    show('/checkout?step=review'); await enterReview();
    fireEvent.click(await screen.findByRole('button', { name: /Place Order/ }));
    await screen.findByText('Check the secure card form.');
    expect(vi.mocked(apiClient).mock.calls.some(([url]) => url.endsWith('/reconcile'))).toBe(false);
    expect(screen.queryByRole('heading', { name: 'Payment failed' })).not.toBeInTheDocument();
  });
  it('holds the navigation lock for a leased recovery worker and releases it when recovery is queued', async () => {
    reviewedDraft(); let resolveStatus: ((value: unknown) => void) | undefined;
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/submit')) return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never;
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/checkout/payment-attempts') return { data: setup } as never;
      if (endpoint.endsWith('/reconcile')) return { data: { ...setup, state: 'AUTHORIZED', recoveryActive: true } } as never;
      if (endpoint === `/api/checkout/payment-attempts/${attemptId}`) return new Promise(done => { resolveStatus = done; });
      throw new Error(`Unexpected test request ${endpoint}`);
    });
    show('/checkout?step=review'); await enterReview();
    fireEvent.click(await screen.findByRole('button', { name: /Place Order/ }));
    await waitFor(() => expect(screen.getByTestId('payment-lock-state')).toHaveTextContent('COMMITTING_ORDER'));
    await waitFor(() => expect(resolveStatus).toBeDefined());
    resolveStatus?.({ data: { ...setup, state: 'AUTHORIZED', recoveryActive: false } });
    await waitFor(() => expect(screen.getByTestId('payment-lock-state')).toHaveTextContent('IDLE'));
  });
  it('keeps the exact attempt for uncertain outcomes and recovers before empty Cart', async () => {
    reviewedDraft();
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/submit')) return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never;
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/checkout/payment-attempts') return { data: setup } as never;
      if (endpoint.endsWith('/reconcile')) throw new ApiError(0, 'Disconnected');
      throw new ApiError(404, 'Not found');
    });
    show('/checkout?step=review'); await enterReview(); const button = await screen.findByRole('button', { name: /Place Order/ });
    await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
    // Stage 1 ends when the request settles; a settled disconnect is shown as unconfirmed (not failure, not permanent checking).
    expect(await screen.findByRole('heading', { name: 'We couldn’t confirm your payment yet' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: /Processing your order/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Check payment status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Return to Cart' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Payment Failed' })).not.toBeInTheDocument();
    expect(screen.queryByText('Your cart is empty')).not.toBeInTheDocument();
    const saved = JSON.parse(sessionStorage.getItem('electrohub:checkout:v1:customer') ?? '{}'); expect(saved.draft.attempt.status).toBe('unknown');
    const post = vi.mocked(apiClient).mock.calls.find(([url]) => url === '/api/checkout/payment-attempts'); expect(post?.[1]?.headers).toEqual({ 'Idempotency-Key': saved.draft.attempt.key, 'X-Request-ID': expect.any(String) });
    expect(saved.draft.attempt.request).toEqual(post?.[1]?.data);
    expect(JSON.stringify(saved)).not.toContain('mock-transient-secret');
  });
  it('keeps usable Review content during background totals revalidation and blocks changed totals', async () => {
    reviewedDraft(); let resolve: ((value: unknown) => void) | undefined; let reads = 0;
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/submit')) return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never;
      if (endpoint === '/api/checkout/payment-attempts') return { data: setup } as never;
      if (endpoint !== '/api/checkout') throw new Error('Unexpected endpoint');
      if (++reads === 1) return { data: quote } as never;
      return new Promise(done => { resolve = done; });
    });
    const client = show('/checkout?step=review'); await enterReview(); const button = await screen.findByRole('button', { name: /Place Order/ });
    await waitFor(() => expect(button).toBeEnabled());
    const refresh = client.refetchQueries({ queryKey: queryKeys.checkout.current(userId, cart.revision) });
    await waitFor(() => expect(button).toBeDisabled());
    expect(screen.getByText(/123 Demo Street/)).toBeVisible(); expect(screen.queryByText('Processing your order…')).not.toBeInTheDocument();
    if (!resolve) throw new Error('Missing quote refresh'); resolve({ data: { ...quote, cartRevision: 'b'.repeat(64) } }); await refresh;
    await screen.findByText(/Your Cart needs review/); expect(button).toBeDisabled();
  });
  it('preserves draft during auth restoration and clears it on verified identity transition', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={createQueryClient()}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
    reviewedDraft(); const view = render(<CheckoutDraftSession />, { wrapper });
    vi.mocked(useAuth).mockReturnValue({ user: null, isSessionVerified: false } as ReturnType<typeof useAuth>);
    view.rerender(<CheckoutDraftSession />); expect(sessionStorage.getItem(draftKey(userId))).not.toBeNull();
    vi.mocked(useAuth).mockReturnValue({ user: null, isSessionVerified: true } as ReturnType<typeof useAuth>);
    view.rerender(<CheckoutDraftSession />); expect(sessionStorage.getItem(draftKey(userId))).toBeNull();
  });

  it('executes Buy Now checkout independently of persistent cart', async () => {
    const buyNowProduct = {
      productId: '99999999-9999-4999-8999-999999999999',
      quantity: 1,
    };
    saveBuyNow(buyNowProduct);
    const buyNowCart: CartData = {
      revision: 'b'.repeat(64),
      items: [{
        id: 'buy-now-item-1',
        productId: buyNowProduct.productId,
        quantity: 1,
        product: {
          name: 'Sony WH-1000XM5',
          slug: 'sony-wh-1000xm5',
          category: 'Audio',
          price: '399.99',
          image: { url: '/sony.jpg', altText: 'Sony' },
        },
        availability: 'AVAILABLE',
        stockStatus: 'IN_STOCK',
        availableQuantity: 5,
        lineTotal: '399.99',
      }],
      totalQuantity: 1,
      subtotal: '399.99',
      shipping: '0.00',
      total: '399.99',
      currency: 'USD',
      canCheckout: true,
    };
    const buyNowQuote: CheckoutQuote = {
      scope: 'BUY_NOW',
      summary: buyNowCart,
      cartRevision: buyNowCart.revision,
      eligible: true,
      subtotal: buyNowCart.subtotal,
      currency: 'USD',
      blockers: [],
      deliveryMethods: [
        { id: 'STANDARD', label: 'Standard Delivery', price: '0.00', estimate: '5–7 business days', minDays: 5, maxDays: 7, totals: { subtotal: '399.99', shipping: '0.00', total: '399.99', currency: 'USD' } },
      ],
    };
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/submit')) return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never;
      if (endpoint.startsWith('/api/checkout?scope=BUY_NOW')) return { data: buyNowQuote } as never;
      if (endpoint === '/api/checkout') return { data: quote } as never;
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    show('/checkout/buy-now?step=shipping', cart);
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(breadcrumb).toHaveTextContent('HomeBuy Now Checkout');
    expect(screen.queryByRole('link', { name: 'Cart' })).not.toBeInTheDocument();

    expect(await screen.findByText('Sony WH-1000XM5')).toBeVisible();
    expect(screen.queryByText('Apple iPhone 15 Pro')).not.toBeInTheDocument();
  });

  it('resets terminal presentation on fresh checkout re-entry after payment failure', async () => {
    const prevRequest = {
      shipping,
      deliveryMethod: 'STANDARD' as const,
      paymentMethod: 'CARD' as const,
      expectedRevision: quote.cartRevision,
    };
    saveDraft(userId, {
      ...newDraft(),
      shipping,
      attempt: {
        key: attemptId,
        paymentAttemptId: attemptId,
        request: prevRequest,
        status: 'unknown',
      },
    });
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/submit')) return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never;
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === `/api/checkout/payment-attempts/${attemptId}/reconcile`) {
        return { data: { ...setup, state: 'DECLINED', failureCode: 'PAYMENT_DECLINED', recoveryActive: false } } as never;
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });
    show('/checkout?step=shipping');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Shipping Information' })).toBeVisible();
    });
    expect(screen.queryByRole('heading', { name: 'Payment Failed' })).not.toBeInTheDocument();
  });
  it('clears a confirmed decline synchronously before Return to Cart and fresh Checkout render', async () => {
    reviewedDraft();
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/submit')) return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never;
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/checkout/payment-attempts') return { data: setup } as never;
      if (endpoint === `/api/checkout/payment-attempts/${attemptId}/reconcile`) {
        return { data: { ...setup, state: 'DECLINED', failureCode: 'PAYMENT_DECLINED', recoveryActive: false } } as never;
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });
    show('/checkout?step=review');
    await enterReview();
    fireEvent.click(await screen.findByRole('button', { name: /Place Order/ }));
    const failureHeading = await screen.findByRole('heading', { name: 'Payment Failed' });
    expect(failureHeading).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'Return to Cart' }));
    expect(JSON.parse(sessionStorage.getItem(draftKey(userId)) ?? '{}').draft.attempt).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Payment Failed' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Proceed to Checkout' }));
    expect(screen.queryByRole('heading', { name: 'Payment Failed' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shipping Information' })).toBeVisible();
  });

  it.each(['/checkout', '/checkout?step=shipping'])('only selects Shipping on re-entry/reload at %s while preserving address and Express', async path => {
    saveDraft(userId, { ...newDraft(), shipping, deliveryMethod: 'EXPRESS', shippingComplete: true, deliveryComplete: true, paymentComplete: true });
    show(path);
    const selected = screen.getByRole('navigation', { name: 'Checkout steps' }).querySelectorAll('[aria-current="step"]');
    expect(selected).toHaveLength(1); expect(selected[0]).toHaveTextContent('Shipping');
    expect(screen.getByRole('button', { name: /2\. Delivery/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: /2\. Delivery/ }).className).not.toContain('doneStep');
    expect(screen.getByLabelText(/Full Name/)).toHaveValue(shipping.recipient);
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Delivery' }));
    expect(await screen.findByRole('radio', { name: /Express Delivery/ })).toBeChecked();
    expect(screen.getByText('$2,209.97')).toBeVisible();
  });

  it('a reload on Review never restores Review: it returns to card entry on the same attempt, with no Place Order until the card is re-entered', async () => {
    saveDraft(userId, { ...newDraft(), shipping, shippingComplete: true, deliveryComplete: true, paymentComplete: true, reviewReached: true,
      attempt: { key: attemptId, paymentAttemptId: attemptId, status: 'setup', request: { shipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: cart.revision } } });
    let release: (() => void) | undefined;
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/checkout/payment-attempts') { await new Promise<void>(resolve => { release = resolve; }); return { data: setup } as never; }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });
    show('/checkout?step=review');
    expect(screen.queryByRole('button', { name: /Place Order/ })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Payment Method' })).toBeVisible();
    expect(await screen.findByText(/card details are not kept/)).toBeVisible();
    expect(JSON.parse(sessionStorage.getItem(draftKey(userId)) ?? '{}').draft.paymentComplete).toBe(false);
    await waitFor(() => expect(release).toBeDefined()); release?.();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review Order' })).toBeEnabled());
    expect(vi.mocked(apiClient).mock.calls.filter(([url, options]) => url === '/api/checkout/payment-attempts' && options?.method === 'POST')).toHaveLength(1);
    expect(vi.mocked(apiClient).mock.calls.find(([url]) => url === '/api/checkout/payment-attempts')?.[1]?.headers).toMatchObject({ 'Idempotency-Key': attemptId });
    expect(screen.queryByRole('button', { name: /Place Order/ })).not.toBeInTheDocument();
    await enterReview();
  });

  it('revalidates the revised Cart/quote once before concurrent Try Again clicks create one fresh session', async () => {
    reviewedDraft(); let setups = 0; let quoteReads = 0;
    const nextId = '77777777-7777-4777-8777-777777777777';
    const revisedCart = { ...cart, revision: 'b'.repeat(64) };
    let releaseCart: ((value: CartData) => void) | undefined;
    let releaseQuote: ((value: { data: CheckoutQuote }) => void) | undefined;
    actions.retryCart.mockImplementation(() => new Promise(resolve => { releaseCart = resolve; }));
    vi.mocked(apiClient).mockImplementation(async (url, options) => {
      if (url.endsWith('/submit')) return { data: { ...setup, attemptId: url.split('/').at(-2) } } as never;
      if (url === '/api/checkout') return quoteReads++ === 0 ? { data: quote } as never
        : new Promise(resolve => { releaseQuote = resolve; });
      if (url === '/api/checkout/payment-attempts') {
        if (setups++ > 0) expect((options?.data as { expectedRevision: string }).expectedRevision).toBe(revisedCart.revision);
        return { data: setups === 1 ? setup : { ...setup, attemptId: nextId, cart: revisedCart, clientSecret: 'retry-session-secret' } } as never;
      }
      if (url.endsWith('/reconcile')) return { data: { ...setup, state: 'DECLINED', cart: revisedCart, failureCode: 'PAYMENT_DECLINED' } } as never;
      throw new Error(`Unexpected ${url}`);
    });
    show('/checkout?step=review'); await enterReview();
    fireEvent.click(screen.getByRole('button', { name: /Place Order/ }));
    const retry = await screen.findByRole('button', { name: 'Try Again' });
    fireEvent.click(retry); fireEvent.click(retry);
    await waitFor(() => expect(releaseCart).toBeDefined()); expect(setups).toBe(1);
    await act(async () => { releaseCart?.(revisedCart); });
    await waitFor(() => expect(releaseQuote).toBeDefined());
    expect(JSON.parse(sessionStorage.getItem(draftKey(userId))!).draft.attempt.paymentAttemptId).toBe(attemptId);
    expect(setups).toBe(1);
    await act(async () => { releaseQuote?.({ data: { ...quote, cartRevision: revisedCart.revision } }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review Order' })).toBeEnabled());
    expect(setups).toBe(2); expect(actions.retryCart).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Refresh totals' })).not.toBeInTheDocument();
    expect(screen.getByText('Mock Stripe-owned secure entry')).toBeVisible();
  });

  it.each(['CANCELED', 'AWAITING_INPUT'] as const)('safely resumes %s using fresh prerequisites and the appropriate setup identity', async state => {
    reviewedDraft(); const keys: (string | null)[] = [];
    vi.mocked(apiClient).mockImplementation(async (url, options) => {
      if (url.endsWith('/submit')) return { data: { ...setup, attemptId: url.split('/').at(-2) } } as never;
      if (url === '/api/checkout') return { data: quote } as never;
      if (url === '/api/checkout/payment-attempts') {
        keys.push(new Headers(options?.headers).get('Idempotency-Key'));
        return { data: setup } as never;
      }
      if (url.endsWith('/reconcile')) return { data: { ...setup, state, failureCode: state === 'CANCELED' ? 'PAYMENT_EXPIRED' : null } } as never;
      throw new Error(`Unexpected ${url}`);
    });
    show('/checkout?step=review'); await enterReview(); fireEvent.click(screen.getByRole('button', { name: /Place Order/ }));
    if (state === 'AWAITING_INPUT') {
      expect(await screen.findByRole('heading', { name: 'Checking your payment' })).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
      expect(keys).toHaveLength(1);
      expect(actions.confirm).toHaveBeenCalledTimes(1);
      return;
    }
    fireEvent.click(await screen.findByRole('button', { name: 'Try Again' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review Order' })).toBeEnabled());
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
    expect(actions.confirm).toHaveBeenCalledTimes(1);
  });

  it('retains the failed attempt and shows a bounded actionable error when retry revalidation fails', async () => {
    reviewedDraft(); let quoteReads = 0; let setups = 0;
    vi.mocked(apiClient).mockImplementation(async url => {
      if (url.endsWith('/submit')) return { data: { ...setup, attemptId: url.split('/').at(-2) } } as never;
      if (url === '/api/checkout') {
        if (quoteReads++ > 0) throw new ApiError(503, 'Unavailable');
        return { data: quote } as never;
      }
      if (url === '/api/checkout/payment-attempts') { setups++; return { data: setup } as never; }
      if (url.endsWith('/reconcile')) return { data: { ...setup, state: 'DECLINED', failureCode: 'PAYMENT_DECLINED' } } as never;
      throw new Error(`Unexpected ${url}`);
    });
    show('/checkout?step=review'); await enterReview(); fireEvent.click(screen.getByRole('button', { name: /Place Order/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Try Again' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be revalidated');
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeEnabled();
    expect(JSON.parse(sessionStorage.getItem(draftKey(userId))!).draft.attempt.paymentAttemptId).toBe(attemptId);
    expect(setups).toBe(1); expect(quoteReads).toBe(3); expect(actions.confirm).toHaveBeenCalledTimes(1);
  });

  it.each(['AUTHORIZED', 'CAPTURE_PENDING'] as const)('never offers retry or starts another setup while %s is resolving', async state => {
    reviewedDraft(); let setups = 0;
    vi.mocked(apiClient).mockImplementation(async url => {
      if (url.endsWith('/submit')) return { data: { ...setup, attemptId: url.split('/').at(-2) } } as never;
      if (url === '/api/checkout') return { data: quote } as never;
      if (url === '/api/checkout/payment-attempts') { setups++; return { data: setup } as never; }
      if (url.includes(`/payment-attempts/${attemptId}`)) return { data: { ...setup, state, recoveryActive: true, committed: state === 'CAPTURE_PENDING' } } as never;
      throw new Error(`Unexpected ${url}`);
    });
    show('/checkout?step=review'); await enterReview(); fireEvent.click(screen.getByRole('button', { name: /Place Order/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /Checking your payment/ })).toBeVisible());
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
    expect(setups).toBe(1); expect(actions.confirm).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(draftKey(userId))!).draft.attempt.paymentAttemptId).toBe(attemptId);
  });

  it('resets terminal presentation when Router reuses Checkout for another scope', async () => {
    reviewedDraft();
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/submit')) return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never;
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/checkout/payment-attempts') return { data: setup } as never;
      if (endpoint === `/api/checkout/payment-attempts/${attemptId}/reconcile`) {
        return { data: { ...setup, state: 'DECLINED', failureCode: 'PAYMENT_DECLINED', recoveryActive: false } } as never;
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });
    show('/checkout/reused?step=review', cart, true);
    await enterReview();
    fireEvent.click(screen.getByRole('button', { name: /Place Order/ }));
    expect(await screen.findByRole('heading', { name: 'Payment Failed' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Switch checkout scope' }));
    expect(await screen.findByRole('heading', { name: 'Nothing to buy' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Payment Failed' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Switch checkout scope' }));
    expect(await screen.findByRole('heading', { name: 'Shipping Information' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Payment Failed' })).not.toBeInTheDocument();
  });

  it('renders empty cart state on fresh checkout navigation when cart is empty', () => {
    show('/checkout', emptyCart);
    expect(screen.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
    expect(screen.getByText('Add products before starting checkout.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Continue Shopping' })).toHaveAttribute('href', '/products');
  });

  it('renders nothing to buy on Buy Now checkout if session storage has no item', () => {
    show('/checkout/buy-now');
    expect(screen.getByRole('heading', { name: 'Nothing to buy' })).toBeVisible();
    expect(screen.getByText('Choose a product to buy now.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Continue Shopping' })).toHaveAttribute('href', '/products');
  });

  it('BUG 1: confirmed decline stops status polling and immediately displays Payment Failed with functional Try Again', async () => {
    reviewedDraft();
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/submit')) return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never;
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/checkout/payment-attempts') return { data: setup } as never;
      if (endpoint === `/api/checkout/payment-attempts/${attemptId}/reconcile`) {
        return { data: { ...setup, state: 'DECLINED', failureCode: 'PAYMENT_DECLINED', recoveryActive: false } } as never;
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    show('/checkout?step=review');
    await enterReview();
    fireEvent.click(await screen.findByRole('button', { name: /Place Order/ }));

    expect(await screen.findByRole('heading', { name: 'Payment Failed' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: /Processing your order/ })).not.toBeInTheDocument();

    const tryAgain = screen.getByRole('button', { name: 'Try Again' });
    expect(tryAgain).toBeVisible();
    expect(tryAgain).toBeEnabled();

    fireEvent.click(tryAgain);
    await screen.findByText('Mock Stripe-owned secure entry');
    expect(screen.queryByRole('heading', { name: 'Payment Failed' })).not.toBeInTheDocument();
  });

  it('fresh Checkout entry retains unresolved durable attempts instead of clearing them as old failure UI', async () => {
    saveDraft(userId, {
      ...newDraft(),
      shipping,
      shippingComplete: true,
      deliveryComplete: true,
      paymentComplete: true,
      reviewReached: true,
      attempt: { key: crypto.randomUUID(), request: { shipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: cart.revision }, status: 'unknown', paymentAttemptId: attemptId },
    });

    vi.mocked(apiClient).mockImplementation(async () => ({ data: { ...setup, state: 'CAPTURE_PENDING', committed: true, recoveryActive: true } }) as never);
    show('/checkout');
    expect(screen.getByRole('heading', { name: /Checking your payment/ })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Shipping Information' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Payment Failed' })).not.toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(apiClient).mock.calls.some(([url]) => url.endsWith('/reconcile'))).toBe(true));
    expect(JSON.parse(sessionStorage.getItem(draftKey(userId)) ?? '{}').draft.attempt.paymentAttemptId).toBe(attemptId);
  });

  it('moves unresolved payment to read-only account recovery after the existing Checkout window, preserving identity and unlocking navigation', async () => {
    reviewedDraft();
    let resolveReconcile: ((value: unknown) => void) | undefined;
    vi.mocked(apiClient).mockImplementation(async url => {
      if (url.endsWith('/submit')) return { data: { ...setup, attemptId: url.split('/').at(-2) } } as never;
      if (url === '/api/checkout') return { data: quote } as never;
      if (url === '/api/checkout/payment-attempts') return { data: setup } as never;
      if (url.endsWith('/reconcile')) return new Promise(resolve => { resolveReconcile = resolve; });
      return new Promise(() => {});
    });
    show('/checkout?step=review'); await enterReview();
    fireEvent.click(screen.getByRole('button', { name: /Place Order/ }));
    await waitFor(() => expect(resolveReconcile).toBeDefined());
    vi.useFakeTimers();
    try {
      await act(async () => { resolveReconcile?.({ data: { ...setup, state: 'CAPTURE_PENDING', committed: true, recoveryActive: true } }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(CHECKOUT_RECOVERY_WINDOW_MS + 1); });
      expect(screen.getByRole('heading', { name: 'Cart return' })).toBeVisible();
      expect(screen.getByTestId('payment-lock-state')).toHaveTextContent('IDLE');
      expect(JSON.parse(sessionStorage.getItem(draftKey(userId)) ?? '{}').draft.attempt.paymentAttemptId).toBe(attemptId);
      expect(actions.confirm).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

});

describe('Scenario 1 addendum: submitted Payment Failed → Try Again (mocked payment, no real Stripe)', () => {
  const submittedAt = '2026-10-14T10:00:00.000Z';
  const savedA = { ...setup, state: 'DECLINED' as const, clientSecret: 'mock-resumed-secret-a', replayed: true, submittedAt, total: '329.00',
    request: { shipping: { ...shipping, recipient: 'Saved Person A', city: 'Saved City A' }, deliveryMethod: 'EXPRESS', paymentMethod: 'CARD', expectedRevision: cart.revision },
    items: [{ name: 'Saved Watch A', quantity: 2, imageUrl: null }, { name: 'Saved Strap A', quantity: 1, imageUrl: null }] };
  const savedB = { ...savedA, attemptId: '66666666-6666-4666-8666-666666666666', clientSecret: 'mock-resumed-secret-b', total: '49.00',
    request: { ...savedA.request, shipping: { ...shipping, recipient: 'Saved Person B', city: 'Saved City B' }, deliveryMethod: 'STANDARD' },
    items: [{ name: 'Saved Mouse B', quantity: 1, imageUrl: null }] };
  const calls = (match: (url: string, method?: string) => boolean) => vi.mocked(apiClient).mock.calls.filter(([url, options]) => match(String(url), options?.method));
  function api(resume: (id: string) => Promise<unknown>, reconcile: (id: string, count: number) => object = (id, count) => ({ ...setup, attemptId: id, submittedAt, state: 'DECLINED', retryAllowed: true, updatedAt: new Date(Date.parse(submittedAt) + count * 1000).toISOString() })) {
    let reconciles = 0;
    vi.mocked(apiClient).mockImplementation(async (endpoint, options) => {
      const id = String(endpoint).split('/').at(-2) ?? '';
      if (endpoint.endsWith('/submit')) return { data: { ...setup, submittedAt, attemptId: id } } as never;
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/checkout/payment-attempts' && options?.method === 'POST') return { data: setup } as never;
      if (endpoint.endsWith('/resume')) return resume(id) as never;
      if (endpoint.endsWith('/read')) return undefined as never;
      if (endpoint.endsWith('/reconcile')) return { data: reconcile(id, ++reconciles) } as never;
      const statusId = String(endpoint).match(/^\/api\/checkout\/payment-attempts\/([0-9a-f-]{36})$/)?.[1];
      if (statusId && !options?.method) return { data: { ...(statusId === savedB.attemptId ? savedB : savedA),
        clientSecret: null, updatedAt: submittedAt } } as never;
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });
  }
  const entryFor = (id: string) => ({ pathname: '/checkout', search: '?step=payment', state: { retryPurchase: id } });

  it('Payment Failed → Try Again opens the Payment step for the same saved attempt, not the active Cart, with no new setup', async () => {
    api(async () => ({ data: savedA }));
    reviewedDraft(); show('/checkout?step=review'); await enterReview();
    fireEvent.click(await screen.findByRole('button', { name: /Place Order/ }));
    expect(await screen.findByRole('heading', { name: 'Payment Failed' })).toBeVisible();
    const setups = calls((url, method) => url === '/api/checkout/payment-attempts' && method === 'POST').length;
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByRole('heading', { name: 'Payment Method' })).toBeVisible();
    expect(screen.getByText('Saved Watch A')).toBeVisible(); expect(screen.getByText('Saved Strap A')).toBeVisible();
    expect(screen.queryByText(/Your cart is empty|Complete your saved purchase|Checking retry eligibility/)).not.toBeInTheDocument();
    expect(calls(url => url.endsWith(`/${attemptId}/resume`))).toHaveLength(1);
    expect(calls((url, method) => url === '/api/checkout/payment-attempts' && method === 'POST')).toHaveLength(setups);
    // This scope's draft no longer carries A's terminal attempt.
    expect(JSON.parse(sessionStorage.getItem(draftKey(userId)) ?? '{}').draft?.attempt ?? null).toBeNull();
  });

  it('a Cart entry with an EMPTY active Cart restores the exact saved items, quantities, shipping and delivery', async () => {
    api(async () => ({ data: savedA }));
    show(entryFor(attemptId), emptyCart);
    expect(await screen.findByRole('heading', { name: 'Payment Method' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Your cart is empty' })).not.toBeInTheDocument();
    expect(screen.getByText('Saved Watch A')).toBeVisible(); expect(screen.getByText('Qty: 2')).toBeVisible();
    expect(screen.getAllByText('$329.00').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Delivery Method' })).toBeVisible();
    expect(screen.getAllByText(/Express/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Shipping Information' })).toBeVisible();
    expect(screen.getAllByText(/Saved Person A/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Delivery' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to Payment' }));
    expect(await screen.findByRole('heading', { name: 'Payment Method' })).toBeVisible();
    expect(calls(url => url.endsWith('/resume'))).toHaveLength(1); // step navigation keeps the purchase identity
    expect(calls(url => url.startsWith('/api/cart'))).toHaveLength(0);
  });

  it('a different failed purchase B restores its own, different saved data', async () => {
    api(async id => ({ data: id === savedB.attemptId ? savedB : savedA }));
    show(entryFor(savedB.attemptId), emptyCart);
    expect(await screen.findByText('Saved Mouse B')).toBeVisible();
    expect(screen.queryByText('Saved Watch A')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Saved Person B/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Saved Person A/)).not.toBeInTheDocument();
    expect(calls(url => url.endsWith('/resume')).map(([url]) => url)).toEqual([`/api/checkout/payment-attempts/${savedB.attemptId}/resume`]);
  });

  it('Payment → Review → Place Order confirms once on the same attempt; a second decline returns to Payment Failed', async () => {
    api(async () => ({ data: savedA }));
    show(entryFor(attemptId), emptyCart);
    fireEvent.click(await screen.findByRole('button', { name: 'Review Order' }));
    expect(await screen.findByRole('heading', { name: 'Review Your Order' })).toBeVisible();
    expect(actions.confirm).not.toHaveBeenCalled(); // retry never submits on its own
    fireEvent.click(screen.getByRole('button', { name: /Place Order/ }));
    expect(await screen.findByRole('heading', { name: 'Payment Failed' })).toBeVisible();
    expect(actions.confirm).toHaveBeenCalledTimes(1);
    expect(calls(url => url.endsWith('/submit'))).toHaveLength(0);
    expect(calls(url => url.endsWith(`/${attemptId}/reconcile`))).toHaveLength(1);
    expect(calls((url, method) => url === '/api/checkout/payment-attempts' && method === 'POST')).toHaveLength(0);
    await waitFor(() => expect(calls((url, method) => url.endsWith(`/${attemptId}/read`) && method === 'POST')).toHaveLength(1));
  });

  it('an authoritative refusal shows a truthful state with no secure entry and no new attempt', async () => {
    api(async () => { throw new ApiError(409, 'refused', undefined, 'CHECKOUT_CHANGED'); });
    show(entryFor(attemptId), emptyCart);
    expect(await screen.findByRole('heading', { name: 'This purchase can’t be paid again right now' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Payment Method' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your cart is empty' })).not.toBeInTheDocument();
    expect(calls((url, method) => url === '/api/checkout/payment-attempts' && method === 'POST')).toHaveLength(0);
  });

  it('an unreachable service is recoverable and never shown as a failure', async () => {
    let fail = true; api(async () => { if (fail) throw new ApiError(503, 'unavailable'); return { data: savedA }; });
    show(entryFor(attemptId), emptyCart);
    expect(await screen.findByRole('heading', { name: 'We couldn’t load this saved purchase' })).toBeVisible();
    expect(screen.queryByText(/Payment Failed|declined/)).not.toBeInTheDocument();
    fail = false; fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Saved Watch A')).toBeVisible();
  });

  it('a backend-disallowed retry offers no Try Again and never resumes', async () => {
    api(async () => ({ data: savedA }), id => ({ ...setup, attemptId: id, submittedAt, state: 'DECLINED', retryAllowed: false }));
    reviewedDraft(); show('/checkout?step=review'); await enterReview();
    fireEvent.click(await screen.findByRole('button', { name: /Place Order/ }));
    expect(await screen.findByRole('heading', { name: 'Payment Failed' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
    expect(calls(url => url.endsWith('/resume'))).toHaveLength(0);
  });
});

describe('Returning to Checkout after a purchase was submitted from it', () => {
  const status = (state: string) => ({ ...setup, state, clientSecret: undefined, recoveryActive: false, committed: false });
  // Acknowledging a result the customer saw (/read) is the one allowed write; submit, setup and reconcile never happen here.
  const posts = () => vi.mocked(apiClient).mock.calls.filter(([endpoint, options]) => options?.method === 'POST' && !String(endpoint).endsWith('/read'));
  function api(read: () => unknown) {
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint === `/api/checkout/payment-attempts/${attemptId}`) return { data: read() } as never;
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });
  }
  it('an empty Cart with a remembered unresolved purchase restores it from its status, read-only, never "Your cart is empty"', async () => {
    rememberSubmittedPurchase(userId, 'CART_CHECKOUT', attemptId); api(() => status('PROCESSING'));
    show('/checkout?step=shipping', emptyCart);
    expect(await screen.findByRole('heading', { name: 'Checking your payment' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Your cart is empty' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Place Order|Continue payment|Review Order/ })).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0); // no submit, setup or reconcile
  });
  it('shows a loader, not an empty Cart, while the purchase status is being resolved', async () => {
    rememberSubmittedPurchase(userId, 'CART_CHECKOUT', attemptId); let release: (() => void) | undefined;
    vi.mocked(apiClient).mockImplementation(() => new Promise(resolve => { release = () => resolve({ data: status('PROCESSING') } as never); }));
    show('/checkout?step=shipping', emptyCart);
    expect(screen.queryByRole('heading', { name: 'Your cart is empty' })).not.toBeInTheDocument();
    await waitFor(() => expect(release).toBeDefined()); release?.();
    expect(await screen.findByRole('heading', { name: 'Checking your payment' })).toBeVisible();
  });
  it('a confirmed decline shows the failed-purchase state with Try Again', async () => {
    rememberSubmittedPurchase(userId, 'CART_CHECKOUT', attemptId); api(() => ({ ...status('DECLINED'), submittedAt: new Date().toISOString(), retryAllowed: true }));
    show('/checkout?step=shipping', emptyCart);
    expect(await screen.findByRole('heading', { name: 'Payment Failed' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeVisible(); expect(posts()).toHaveLength(0);
  });
  it('a failed status read claims no outcome and offers a safe retry', async () => {
    rememberSubmittedPurchase(userId, 'CART_CHECKOUT', attemptId);
    vi.mocked(apiClient).mockRejectedValue(new ApiError(503, 'down'));
    show('/checkout?step=shipping', emptyCart);
    expect(await screen.findByRole('heading', { name: 'We couldn’t verify your payment right now' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: /Payment Failed|Your cart is empty/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
  it('a purchase the server does not recognise is forgotten and the ordinary empty Cart is shown', async () => {
    rememberSubmittedPurchase(userId, 'CART_CHECKOUT', attemptId);
    vi.mocked(apiClient).mockRejectedValue(new ApiError(404, 'Payment attempt not found'));
    show('/checkout?step=shipping', emptyCart);
    expect(await screen.findByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
    await waitFor(() => expect(readSubmittedPurchase(userId, 'CART_CHECKOUT')).toBeNull());
  });
  it('without a remembered purchase an empty Cart is still just empty, and a Cart with items opens Checkout B, never purchase A', async () => {
    show('/checkout?step=shipping', emptyCart);
    expect(await screen.findByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
    expect(vi.mocked(apiClient)).not.toHaveBeenCalledWith(expect.stringContaining(attemptId), expect.anything());
  });
  it('Cart B (items present) opens Checkout B even while A is remembered, and never reads A', async () => {
    rememberSubmittedPurchase(userId, 'CART_CHECKOUT', attemptId);
    show('/checkout?step=shipping');
    expect(await screen.findByRole('heading', { name: 'Shipping Information' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Checking your payment' })).not.toBeInTheDocument();
    expect(vi.mocked(apiClient).mock.calls.some(([endpoint]) => String(endpoint).includes(`/${attemptId}`))).toBe(false);
  });
});

describe('A refused submit (nothing submitted) returns to Review instead of recovering', () => {
  it('shows a retry message, keeps Place Order available, never starts reconcile or a Processing/Checking screen, and clears the submitted pointer', async () => {
    reviewedDraft(); const calls2: string[] = [];
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      calls2.push(endpoint);
      if (endpoint.endsWith('/submit')) throw new ApiError(409, 'Check this payment before continuing.');
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/checkout/payment-attempts') return { data: setup } as never;
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });
    show('/checkout?step=review'); await enterReview();
    fireEvent.click(await screen.findByRole('button', { name: /Place Order/ }));
    expect(await screen.findByText(/Secure payment could not start\. Nothing was charged/)).toBeVisible();
    expect(screen.queryByRole('heading', { name: /Checking your payment|Processing/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Place Order/ })).toBeEnabled();
    expect(calls2.some(endpoint => endpoint.endsWith('/reconcile'))).toBe(false);
    expect(readSubmittedPurchase(userId, 'CART_CHECKOUT')).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(draftKey(userId)) ?? '{}').draft.attempt.status).toBe('setup');
  });
});

// Task 03.6 final closure — handoff contract after a slow /submit (DEV incidents: MacBook 8.5 s, Buds2 19.1 s, iPad 24.1 s, MacBook Starlight
// 11.4 s; each committed /submit was followed by no confirmation-started, leaving a submitted purchase Stripe never saw).
describe('Place Order handoff after a slow /submit', () => {
  const urls = () => vi.mocked(apiClient).mock.calls.map(([url]) => String(url));
  function slowSubmit() {
    let release!: () => void; const gate = new Promise<void>(done => { release = done; });
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.endsWith('/submit')) { await gate; return { data: { ...setup, attemptId: endpoint.split('/').at(-2) } } as never; }
      if (endpoint.endsWith('/reconcile')) return { data: { ...setup, state: 'AWAITING_INPUT' } } as never;
      if (endpoint.endsWith('/release-unconfirmed')) return { data: { ...setup } } as never;
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/checkout/payment-attempts') return { data: setup } as never;
      if (endpoint.includes('/attempts/')) return { data: { ...setup, state: 'AWAITING_INPUT' } } as never;
      throw new Error(`Unexpected test request ${endpoint}`);
    });
    return () => release();
  }
  async function placeOrder() {
    reviewedDraft(); show('/checkout?step=review'); await enterReview();
    const button = await screen.findByRole('button', { name: /Place Order/ });
    await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
    await waitFor(() => expect(urls().some(url => url.endsWith('/submit'))).toBe(true));
  }
  it('the same secure form still mounted when a slow submit returns: confirmation proceeds exactly once and nothing is released', async () => {
    const finish = slowSubmit(); await placeOrder();
    await act(async () => { finish(); });
    await waitFor(() => expect(actions.confirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(urls().filter(url => url.endsWith('/reconcile'))).toHaveLength(1));
    expect(urls().some(url => /release|cancel/.test(url))).toBe(false);
  });
  it('the customer left (Checkout unmounted) before a slow submit returned: never confirms in the background and never releases or cancels it', async () => {
    const finish = slowSubmit(); await placeOrder();
    cleanup();
    await act(async () => { finish(); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(actions.confirm).not.toHaveBeenCalled(); expect(announceConfirmation).not.toHaveBeenCalled();
    expect(urls().some(url => /release|cancel|reconcile/.test(url))).toBe(false);
    // The accepted purchase stays discoverable (Pending purchases -> Processing) for recovery to resolve.
    expect(readSubmittedPurchase(userId, 'CART_CHECKOUT')).toBe(attemptId);
  });
  it('a confirmation signal that cannot be recorded never reaches Stripe and never releases the purchase', async () => {
    vi.mocked(announceConfirmation).mockRejectedValueOnce(new Error('uncertain'));
    let providerReached = false;
    actions.confirm.mockImplementation(async (before?: () => Promise<void>) => { await before?.(); providerReached = true; return { kind: 'confirmed' }; });
    const finish = slowSubmit(); await placeOrder();
    await act(async () => { finish(); });
    await waitFor(() => expect(actions.confirm).toHaveBeenCalledTimes(1));
    expect(providerReached).toBe(false);
    expect(urls().some(url => /release|cancel/.test(url))).toBe(false);
  });
});

// P0: "Secure payment setup could not finish… Retry" was shown for an intentional 503 PAYMENT_MUTATIONS_DISABLED (payment isolation).
describe('payment-write-disabled environment', () => {
  it('a refused setup shows the maintenance state with no retry, never a payment failure, and does not retry on its own', async () => {
    let setups = 0;
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/checkout/payment-capability') return { data: { paymentsEnabled: true } } as never; // not yet known as disabled
      if (endpoint === '/api/checkout/payment-attempts') { setups++; throw new ApiError(503, 'Payments are unavailable in this environment.', undefined, 'PAYMENT_MUTATIONS_DISABLED'); }
      throw new Error(`Unexpected test request ${endpoint}`);
    });
    reviewedDraft(); show('/checkout?step=payment');
    expect(await screen.findByText(/switched off on this server/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry payment setup' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Secure payment setup could not finish/)).not.toBeInTheDocument();
    expect(screen.queryByText(/declined|Payment Failed/i)).not.toBeInTheDocument();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(setups).toBe(1);
  });
  it('when the backend reports payments disabled up front, checkout never attempts payment setup', async () => {
    let setups = 0;
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/checkout/payment-capability') return { data: { paymentsEnabled: false } } as never;
      if (endpoint === '/api/checkout/payment-attempts') { setups++; return { data: setup } as never; }
      throw new Error(`Unexpected test request ${endpoint}`);
    });
    reviewedDraft(); show('/checkout?step=payment');
    expect(await screen.findByText(/switched off on this server/)).toBeVisible();
    expect(setups).toBe(0); expect(actions.confirm).not.toHaveBeenCalled();
  });
});
