import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/context/AuthContext';
import { CartContext, type CartContextValue } from '@/features/cart/context';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import { apiClient, ApiError } from '@/lib/api';
import { createQueryClient } from '@/lib/query';
import { CheckoutPage } from './CheckoutPage';
import { cart, confirmation, quote, shipping } from './fixtures';
import { draftKey, newDraft, saveDraft } from './state';
import { CheckoutDraftSession } from './CheckoutDraftSession';
import { queryKeys } from '@/lib/query';
import type { CartData } from '@/features/cart/types';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), apiClient: vi.fn() }));
const userId = 'customer';
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); window.scrollTo = vi.fn();
  vi.mocked(useAuth).mockReturnValue({ user: { id: userId, role: 'CUSTOMER' }, isAuthenticated: true, isSessionVerified: true, isInitializing: false } as ReturnType<typeof useAuth>);
  vi.mocked(apiClient).mockImplementation(async endpoint => {
    if (endpoint === '/api/checkout') return { data: quote } as never;
    if (endpoint.includes('/attempts/')) throw new ApiError(404, 'Order not found');
    throw new Error(`Unexpected test request ${endpoint}`);
  });
});
function show(path = '/checkout?step=shipping', initial: CartData = cart) {
  const client = createQueryClient();
  function CartFixture({ children }: { children: React.ReactNode }) {
    const [data, setData] = useState(initial);
    const value: CartContextValue = { data, totalQuantity: data.totalQuantity, isGuest: false, isLoggingOut: false, isLoading: false, isError: false, isMutating: false,
      pendingProductIds: [], pendingRemoveProductIds: [], mergeError: null, pendingGuestItems: [], addItem: vi.fn(), setQuantity: vi.fn(), removeItem: vi.fn(), retry: vi.fn(), retryMerge: vi.fn(), removePendingGuestItem: vi.fn(),
      submitCheckout: async operation => { const response = await operation(); setData(response.cart); return response.result; } };
    return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
  }
  render(<QueryClientProvider client={client}><CartFixture><MemoryRouter initialEntries={[path]}><Routes>
    <Route element={<ProtectedRoute requireVerifiedSession requiredRole="CUSTOMER" redirectTo="/cart" preserveReturnPath />}><Route path="/checkout" element={<CheckoutPage />} /></Route>
    <Route path="/cart" element={<h1>Cart return</h1>} /><Route path="/checkout/confirmation/:reference" element={<h1>Persisted Confirmation</h1>} />
  </Routes></MemoryRouter></CartFixture></QueryClientProvider>);
  return client;
}
function reviewedDraft() { saveDraft(userId, { ...newDraft(), shipping, shippingComplete: true, deliveryComplete: true, paymentComplete: true }); }
describe('Checkout page integration', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Payment' })); fireEvent.click(screen.getByRole('button', { name: 'Review Order' }));
    expect(screen.getByText('Review Your Order')).toBeVisible(); expect(screen.getByText(/123 Demo Street/)).toBeVisible();
    expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url === '/api/checkout')).toHaveLength(1);
  });
  it('saves the attempt before POST and blocks duplicate clicks until authoritative commit', async () => {
    reviewedDraft(); let resolve!: (value: unknown) => void;
    vi.mocked(apiClient).mockImplementation(async endpoint => endpoint === '/api/checkout' ? { data: quote } as never : new Promise(done => { resolve = done; }));
    show('/checkout?step=review'); const button = await screen.findByRole('button', { name: /Place Order/ });
    await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button); fireEvent.click(button);
    await screen.findByText('Processing your order…');
    expect(JSON.parse(sessionStorage.getItem('electrohub:checkout:v1:customer') ?? '{}').draft.attempt.key).toMatch(/^[a-f0-9-]{36}$/);
    expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url === '/api/orders')).toHaveLength(1);
    resolve({ data: { confirmation, cart: { ...cart, items: [], totalQuantity: 0, subtotal: '0.00', total: '0.00', canCheckout: false }, replayed: false } });
    await screen.findByText('Persisted Confirmation'); expect(sessionStorage.getItem('electrohub:checkout:v1:customer')).toBeNull();
  });
  it('keeps the exact attempt for uncertain outcomes and recovers before empty Cart', async () => {
    reviewedDraft();
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint === '/api/checkout') return { data: quote } as never;
      if (endpoint === '/api/orders') throw new ApiError(0, 'Disconnected');
      throw new ApiError(404, 'Not found');
    });
    show('/checkout?step=review'); const button = await screen.findByRole('button', { name: /Place Order/ });
    await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
    await screen.findByRole('button', { name: 'Retry same checkout attempt' });
    expect(screen.queryByText('Your cart is empty')).not.toBeInTheDocument();
    const saved = JSON.parse(sessionStorage.getItem('electrohub:checkout:v1:customer') ?? '{}'); expect(saved.draft.attempt.status).toBe('unknown');
    const post = vi.mocked(apiClient).mock.calls.find(([url]) => url === '/api/orders'); expect(post?.[1]?.headers).toEqual({ 'Idempotency-Key': saved.draft.attempt.key });
    expect(saved.draft.attempt.request).toEqual(post?.[1]?.data);
  });
  it('keeps usable Review content during background totals revalidation and blocks changed totals', async () => {
    reviewedDraft(); let resolve!: (value: unknown) => void; let reads = 0;
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint !== '/api/checkout') throw new Error('Unexpected endpoint');
      if (++reads === 1) return { data: quote } as never;
      return new Promise(done => { resolve = done; });
    });
    const client = show('/checkout?step=review'); const button = await screen.findByRole('button', { name: /Place Order/ });
    await waitFor(() => expect(button).toBeEnabled());
    const refresh = client.refetchQueries({ queryKey: queryKeys.checkout.current(userId, cart.revision) });
    await waitFor(() => expect(button).toBeDisabled());
    expect(screen.getByText(/123 Demo Street/)).toBeVisible(); expect(screen.queryByText('Processing your order…')).not.toBeInTheDocument();
    resolve({ data: { ...quote, cartRevision: 'b'.repeat(64) } }); await refresh;
    await screen.findByText(/Your cart needs review/); expect(button).toBeDisabled();
  });
  it('preserves draft during auth restoration and clears it on verified identity transition', () => {
    reviewedDraft(); const view = render(<CheckoutDraftSession />);
    vi.mocked(useAuth).mockReturnValue({ user: null, isSessionVerified: false } as ReturnType<typeof useAuth>);
    view.rerender(<CheckoutDraftSession />); expect(sessionStorage.getItem(draftKey(userId))).not.toBeNull();
    vi.mocked(useAuth).mockReturnValue({ user: null, isSessionVerified: true } as ReturnType<typeof useAuth>);
    view.rerender(<CheckoutDraftSession />); expect(sessionStorage.getItem(draftKey(userId))).toBeNull();
  });

});
