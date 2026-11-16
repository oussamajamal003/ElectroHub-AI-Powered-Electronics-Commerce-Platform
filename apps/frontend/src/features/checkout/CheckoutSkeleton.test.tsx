import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/context/AuthContext';
import { CartContext, type CartContextValue } from '@/features/cart/context';
import { apiClient } from '@/lib/api';
import { createQueryClient } from '@/lib/query';
import { CheckoutSkeleton } from './CheckoutComponents';
import { CheckoutPage } from './CheckoutPage';
import { PaymentLockProvider } from './PaymentLockContext';
import { quote } from './fixtures';
import type { CheckoutStep } from './types';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), apiClient: vi.fn() }));
vi.mock('./stripeClient', () => ({ prefetchStripe: vi.fn() }));

/** Task 06.2 WP D: per-step Checkout skeletons appear only while Checkout is genuinely loading and never hide an error. */
describe('CheckoutSkeleton', () => {
  const shape = (step: CheckoutStep) => {
    const { container, unmount } = render(<CheckoutSkeleton step={step} />);
    const visual = container.querySelector('[aria-hidden="true"]')!;
    const result = {
      fields: visual.querySelectorAll('[class*="skeletonInput"]').length,
      deliveryRows: visual.querySelectorAll('[class*="deliveryOptionSkeleton"]').length,
      reviewCards: visual.querySelectorAll('[class*="reviewCardSkeleton"]').length,
      summaryItems: visual.querySelectorAll('[class*="summaryItemSkeleton"]').length,
      totals: visual.querySelectorAll('[class*="totalRowSkeleton"]').length,
      stepper: visual.querySelectorAll('[class*="skeletonStepper"] > span').length,
      activeStep: [...visual.querySelectorAll('[class*="skeletonStepper"] > span')].findIndex(span => span.className.includes('skeletonStepActive')),
    };
    unmount();
    return result;
  };

  it('mirrors the layout of each step next to the Order Summary', () => {
    expect(shape('shipping')).toMatchObject({ fields: 8, deliveryRows: 0, reviewCards: 0, activeStep: 0 });
    expect(shape('delivery')).toMatchObject({ fields: 0, deliveryRows: 3, reviewCards: 0, activeStep: 1 });
    expect(shape('payment')).toMatchObject({ fields: 4, deliveryRows: 0, reviewCards: 0, activeStep: 2 });
    expect(shape('review')).toMatchObject({ fields: 0, deliveryRows: 0, reviewCards: 3, activeStep: 3 });
    for (const step of ['shipping', 'delivery', 'payment', 'review'] as const) expect(shape(step)).toMatchObject({ stepper: 4, summaryItems: 2, totals: 3 });
  });

  it('announces one loading status and exposes no fake controls or data to assistive technology', () => {
    render(<CheckoutSkeleton step="payment" />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Loading checkout…');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('CheckoutPage loading states', () => {
  beforeEach(() => {
    vi.clearAllMocks(); sessionStorage.clear(); window.scrollTo = vi.fn();
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'customer', role: 'CUSTOMER' }, isAuthenticated: true, isSessionVerified: true, isInitializing: false } as ReturnType<typeof useAuth>);
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint === '/api/checkout') return { data: quote } as never;
      throw new Error(`Unexpected test request ${endpoint}`);
    });
  });
  function show(cart: Partial<CartContextValue>, path = '/checkout?step=shipping') {
    const value = { data: undefined, totalQuantity: 0, isGuest: false, isLoggingOut: false, isLoading: false, isError: false, isMutating: false,
      pendingProductIds: [], pendingRemoveProductIds: [], mergeError: null, pendingGuestItems: [], addItem: vi.fn(), setQuantity: vi.fn(), removeItem: vi.fn(),
      retry: vi.fn(), validateRoute: vi.fn(), retryMerge: vi.fn(), removePendingGuestItem: vi.fn(), submitCheckout: vi.fn(), ...cart } as CartContextValue;
    render(<QueryClientProvider client={createQueryClient()}><CartContext.Provider value={value}><MemoryRouter initialEntries={[path]}><PaymentLockProvider><Routes>
      <Route path="/checkout" element={<CheckoutPage />} />
    </Routes></PaymentLockProvider></MemoryRouter></CartContext.Provider></QueryClientProvider>);
  }

  it('shows the Shipping skeleton while the Cart is loading', () => {
    show({ isLoading: true });
    const skeleton = screen.getByTestId('checkout-skeleton');
    expect(skeleton).toHaveAttribute('data-step', 'shipping');
    expect(within(skeleton).getByRole('status')).toHaveTextContent('Loading checkout…');
    expect(screen.queryByText('Checkout could not load.')).toBeNull();
  });

  it('shows the error and Retry instead of a skeleton when the Cart fails to load', () => {
    show({ isLoading: false, isError: true });
    expect(screen.getByRole('alert')).toHaveTextContent('Checkout could not load.');
    expect(screen.getByRole('button', { name: 'Retry Cart' })).toBeVisible();
    expect(screen.queryByTestId('checkout-skeleton')).toBeNull();
  });

  it('shows the skeleton, not Checkout, while the session is still being verified, and requests nothing', () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'customer', role: 'CUSTOMER' }, isAuthenticated: true, isSessionVerified: false, isInitializing: false } as ReturnType<typeof useAuth>);
    show({ isLoading: true });
    expect(screen.getByTestId('checkout-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(apiClient).not.toHaveBeenCalled();
  });
});
