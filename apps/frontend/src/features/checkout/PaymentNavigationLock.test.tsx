import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  PaymentLockProvider,
  usePaymentLock,
} from './PaymentLockContext';
vi.mock('./PaymentPurchases', () => ({ PaymentNotifications: () => null, PaymentPendingIndicator: () => null }));
import { CustomerLayout } from '@/layouts/CustomerLayout';

vi.mock('@/features/auth/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'test-user', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
    isAuthenticated: true,
    isSessionVerified: true,
    isInitializing: false,
    rememberedUser: null,
  })),
}));

vi.mock('@/features/cart/context', () => ({
  useCart: vi.fn(() => ({
    totalQuantity: 2,
    items: [],
  })),
}));

vi.mock('@/features/wishlist/context', () => ({
  useWishlist: vi.fn(() => ({
    totalItems: 1,
    isLoading: false,
  })),
}));

beforeEach(() => {
  window.scrollTo = vi.fn();
});

function CurrentPath() {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname}</div>;
}

function RouterControls() {
  const navigate = useNavigate();
  return <div>
    <button type="button" onClick={() => navigate('/products')}>Navigate to Products</button>
    <button type="button" onClick={() => navigate(-1)}>Browser Back</button>
    <button type="button" onClick={() => navigate(1)}>Browser Forward</button>
  </div>;
}

function TestCheckoutPage() {
  const { paymentState, isLocked, setPaymentState } = usePaymentLock();
  return (
    <div data-testid="checkout-page">
      <nav
        data-testid="checkout-breadcrumb"
        aria-label="Breadcrumb"
        inert={isLocked ? true : undefined}
        style={isLocked ? { pointerEvents: 'none' } : undefined}
        onClickCapture={isLocked ? e => { e.preventDefault(); e.stopPropagation(); } : undefined}
      >
        <Link to="/">Home</Link>
        <Link to="/cart">Cart</Link>
        <span>Checkout</span>
      </nav>

      <span data-testid="lock-state">{isLocked ? 'LOCKED' : 'UNLOCKED'}</span>
      <span data-testid="payment-state">{paymentState}</span>

      {/* Controller buttons for testing transitions */}
      <button type="button" onClick={() => setPaymentState('CONFIRMING_PAYMENT')}>
        Set Confirming
      </button>
      <button type="button" onClick={() => setPaymentState('AUTHORIZED')}>
        Set Authorized
      </button>
      <button type="button" onClick={() => setPaymentState('COMMITTING_ORDER')}>
        Set Committing
      </button>
      <button type="button" onClick={() => setPaymentState('CAPTURE_PENDING')}>
        Set Capture Pending
      </button>
      <button type="button" onClick={() => setPaymentState('IDLE')}>
        Set Idle
      </button>

      {/* Simulated Stripe 3DS interaction area */}
      <div className="StripeElement">
        <button type="button" data-testid="stripe-3ds-action" onClick={() => {}}>
          Stripe 3DS Authorize
        </button>
      </div>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

function renderShell(initialEntries = ['/checkout'], initialIndex = 0) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
        <PaymentLockProvider>
          <CurrentPath />
          <RouterControls />
          <Routes>
            <Route element={<CustomerLayout />}>
              <Route path="/checkout" element={<TestCheckoutPage />} />
              <Route path="/" element={<div data-testid="home-page">Home Page</div>} />
              <Route path="/products" element={<div data-testid="products-page">Products Page</div>} />
              <Route path="/cart" element={<div data-testid="cart-page">Cart Page</div>} />
              <Route path="/wishlist" element={<div data-testid="wishlist-page">Wishlist Page</div>} />
              <Route path="/orders" element={<div data-testid="orders-page">Orders Page</div>} />
              <Route path="/contact" element={<div data-testid="contact-page">Contact Page</div>} />
            </Route>
          </Routes>
        </PaymentLockProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Durable payment navigation', () => {
  it('allows full normal navigation when paymentState is IDLE', () => {
    renderShell();
    expect(screen.getByTestId('lock-state')).toHaveTextContent('UNLOCKED');
    expect(screen.getByTestId('current-path')).toHaveTextContent('/checkout');

    // Click Header link (e.g. Products)
    const productsLink = screen.getByRole('link', { name: /^Products$/i });
    fireEvent.click(productsLink);
    expect(screen.getByTestId('current-path')).toHaveTextContent('/products');
  });

  const criticalStates = [
    'CONFIRMING_PAYMENT',
    'AUTHORIZED',
    'COMMITTING_ORDER',
    'CAPTURE_PENDING',
  ] as const;

  criticalStates.forEach(state => {
    it(`allows header, footer, breadcrumb and router navigation during ${state}`, () => {
      renderShell();
      const setButtonName = { CONFIRMING_PAYMENT: 'Set Confirming', AUTHORIZED: 'Set Authorized', COMMITTING_ORDER: 'Set Committing', CAPTURE_PENDING: 'Set Capture Pending' }[state];
      fireEvent.click(screen.getByRole('button', { name: setButtonName }));
      expect(screen.getByTestId('payment-state')).toHaveTextContent(state);
      expect(screen.getByTestId('lock-state')).toHaveTextContent('UNLOCKED');
      expect(screen.getByTestId('header-lock-wrapper')).not.toHaveAttribute('inert');
      expect(screen.getByTestId('footer-lock-wrapper')).not.toHaveAttribute('inert');
      fireEvent.click(screen.getByLabelText(/ElectroHub.*Home/i));
      expect(screen.getByTestId('current-path').textContent).toBe('/');
      fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }));
      const breadcrumb = screen.getByTestId('checkout-breadcrumb');
      fireEvent.click(breadcrumb.querySelector('a[href="/cart"]')!);
      expect(screen.getByTestId('current-path').textContent).toBe('/cart');
      fireEvent.click(screen.getAllByRole('link', { name: /Help Center/i })[0]!);
      expect(screen.getByTestId('current-path').textContent).toBe('/contact');
      fireEvent.click(screen.getByRole('button', { name: 'Navigate to Products' }));
      expect(screen.getByTestId('current-path').textContent).toBe('/products');
    });
  });
  it('allows Back and Forward while payment remains durable', () => {
    renderShell(['/products', '/checkout', '/wishlist'], 1);
    fireEvent.click(screen.getByRole('button', { name: 'Set Committing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }));
    expect(screen.getByTestId('current-path')).toHaveTextContent('/products');
    fireEvent.click(screen.getByRole('button', { name: 'Browser Forward' }));
    expect(screen.getByTestId('current-path')).toHaveTextContent('/checkout');
  });

  it('restores navigation immediately when returning to IDLE (terminal resolution)', () => {
    renderShell();
    // Engage lock
    fireEvent.click(screen.getByRole('button', { name: 'Set Confirming' }));
    expect(screen.getByTestId('lock-state')).toHaveTextContent('UNLOCKED');

    // Return to IDLE (e.g. card declined or success)
    fireEvent.click(screen.getByRole('button', { name: 'Set Idle' }));
    expect(screen.getByTestId('lock-state')).toHaveTextContent('UNLOCKED');

    const headerWrapper = screen.getByTestId('header-lock-wrapper');
    expect(headerWrapper).not.toHaveAttribute('inert');
    expect(headerWrapper).not.toHaveAttribute('aria-disabled');

    // Click Products now works
    const productsLink = screen.getByRole('link', { name: /^Products$/i });
    fireEvent.click(productsLink);
    expect(screen.getByTestId('current-path')).toHaveTextContent('/products');
  });

  it('preserves interactivity inside Stripe 3DS / payment elements while payment is active', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Set Confirming' }));
    expect(screen.getByTestId('lock-state')).toHaveTextContent('UNLOCKED');

    const stripeAction = screen.getByTestId('stripe-3ds-action');
    const clickSpy = vi.fn();
    stripeAction.addEventListener('click', clickSpy);

    fireEvent.click(stripeAction);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
