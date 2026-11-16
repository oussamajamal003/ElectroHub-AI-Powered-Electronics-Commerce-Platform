import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useCart } from './context';
import { apiClient, ApiError } from '@/lib/api';
import { createQueryClient, queryKeys } from '@/lib/query';
import { CartProvider } from './CartProvider';
import { CartPage } from '@/pages/customer/CartPage';
import { CheckoutDraftSession } from '@/features/checkout/CheckoutDraftSession';
import type { CartData } from './types';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  apiClient: vi.fn(),
}));

const validCart: CartData = {
  revision: 'rev-valid',
  items: [{
    id: 'line-1',
    productId: 'prod-1',
    quantity: 1,
    availableQuantity: 10,
    stockStatus: 'IN_STOCK',
    availability: 'AVAILABLE',
    lineTotal: '719.00',
    product: {
      slug: 'ipad-air',
      name: 'Apple iPad Air 11 M2',
      category: 'Tablets',
      price: '719.00',
      image: { url: 'http://test.com/img.png', altText: 'iPad' },
    },
  }],
  totalQuantity: 1,
  subtotal: '719.00',
  shipping: '0.00',
  total: '719.00',
  currency: 'USD',
  canCheckout: true,
};

const outOfStockCart: CartData = {
  ...validCart,
  revision: 'rev-oos',
  items: [{
    ...validCart.items[0]!,
    availableQuantity: 0,
    stockStatus: 'OUT_OF_STOCK',
    availability: 'OUT_OF_STOCK',
  }],
  canCheckout: false,
};

function CheckoutPaymentMock() {
  const navigate = useNavigate();
  return (
    <div>
      <h1>Checkout Payment</h1>
      <button onClick={() => navigate('/cart')}>Back to Cart</button>
    </div>
  );
}

function AddAndOpenCart() {
  const navigate = useNavigate();
  const cart = useCart();
  return <button onClick={async () => { await cart.addItem('prod-1'); navigate('/cart'); }}>Add then open Cart</button>;
}

describe('Cart Availability Regression Suite', () => {
  const user = { id: 'user-regression', role: 'CUSTOMER' };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    vi.mocked(useAuth).mockReturnValue({
      isSessionVerified: true,
      isAuthenticated: true,
      user,
    } as ReturnType<typeof useAuth>);
  });

  it('Payment -> Cart: loads normally with products, totals, availability and enabled checkout', async () => {
    vi.mocked(apiClient).mockImplementation(async (url: string) => {
      if (url === '/api/cart') return { data: validCart };
      throw new Error(`Unexpected request: ${url}`);
    });

    const client = createQueryClient();
    client.setQueryData(queryKeys.cart.current(user.id), { data: validCart });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/checkout?step=payment']}>
          <CartProvider>
            <CheckoutDraftSession />
            <Routes>
              <Route path="/cart" element={<CartPage />} />
              <Route path="/checkout" element={<CheckoutPaymentMock />} />
            </Routes>
          </CartProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Click back to Cart from checkout
    fireEvent.click(screen.getByRole('button', { name: 'Back to Cart' }));

    // Expect Shopping Cart page loaded
    expect(await screen.findByRole('heading', { name: 'Shopping Cart' })).toBeInTheDocument();
    expect(screen.getByText('Apple iPad Air 11 M2')).toBeInTheDocument();
    expect(screen.getAllByText('$719.00').length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url === '/api/cart')).toHaveLength(1));

    // No error notice
    expect(screen.queryByText(/Current availability could not be confirmed/i)).not.toBeInTheDocument();

    // Proceed to Checkout is enabled
    const checkoutBtn = screen.getByRole('button', { name: /Proceed to Checkout/i });
    expect(checkoutBtn).toBeEnabled();
  });

  it('Repeated Payment <-> Cart navigation maintains normal availability without error', async () => {
    vi.mocked(apiClient).mockImplementation(async (_url: string, options) => {
      if (options?.signal?.aborted) {
        throw new DOMException('The user aborted a request.', 'AbortError');
      }
      return { data: validCart };
    });

    const client = createQueryClient();
    client.setQueryData(queryKeys.cart.current(user.id), { data: validCart });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/checkout?step=payment']}>
          <CartProvider>
            <CheckoutDraftSession />
            <Routes>
              <Route path="/cart" element={<CartPage />} />
              <Route path="/checkout" element={<CheckoutPaymentMock />} />
            </Routes>
          </CartProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    // 1st back to Cart
    fireEvent.click(screen.getByRole('button', { name: 'Back to Cart' }));
    expect(await screen.findByRole('heading', { name: 'Shopping Cart' })).toBeInTheDocument();
    expect(screen.queryByText(/Current availability could not be confirmed/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Proceed to Checkout/i })).toBeEnabled();

    // Proceed to checkout again
    fireEvent.click(screen.getByRole('button', { name: /Proceed to Checkout/i }));
    expect(await screen.findByText('Checkout Payment')).toBeInTheDocument();

    // 2nd back to Cart
    fireEvent.click(screen.getByRole('button', { name: 'Back to Cart' }));
    expect(await screen.findByRole('heading', { name: 'Shopping Cart' })).toBeInTheDocument();
    expect(screen.queryByText(/Current availability could not be confirmed/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Proceed to Checkout/i })).toBeEnabled();

    // 3rd time
    fireEvent.click(screen.getByRole('button', { name: /Proceed to Checkout/i }));
    expect(await screen.findByText('Checkout Payment')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Cart' }));
    expect(await screen.findByRole('heading', { name: 'Shopping Cart' })).toBeInTheDocument();
    expect(screen.queryByText(/Current availability could not be confirmed/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Proceed to Checkout/i })).toBeEnabled();
  });

  it('Valid inventory: checkout enabled', async () => {
    vi.mocked(apiClient).mockResolvedValue({ data: validCart });
    const client = createQueryClient();
    client.setQueryData(queryKeys.cart.current(user.id), { data: validCart });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/cart']}>
          <CartProvider>
            <CartPage />
          </CartProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const checkoutBtn = await screen.findByRole('button', { name: /Proceed to Checkout/i });
    expect(checkoutBtn).toBeEnabled();
    expect(screen.queryByText(/Current availability could not be confirmed/i)).not.toBeInTheDocument();
  });

  it('waits for auth initialization before loading the authenticated Cart', async () => {
    vi.mocked(useAuth).mockReturnValue({ isSessionVerified: false, isAuthenticated: false, user: null } as ReturnType<typeof useAuth>);
    vi.mocked(apiClient).mockResolvedValue({ data: validCart });
    const client = createQueryClient();
    const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/cart']}>
      <CartProvider><CartPage /></CartProvider>
    </MemoryRouter></QueryClientProvider>);

    expect(screen.getByTestId('cart-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(/Current availability could not be confirmed/i)).not.toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
    vi.mocked(useAuth).mockReturnValue({ isSessionVerified: true, isAuthenticated: true, user } as ReturnType<typeof useAuth>);
    view.rerender(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/cart']}>
      <CartProvider><CartPage /></CartProvider>
    </MemoryRouter></QueryClientProvider>);

    expect(await screen.findByText('Apple iPad Air 11 M2')).toBeInTheDocument();
    expect(screen.queryByText(/Current availability could not be confirmed/i)).not.toBeInTheDocument();
    expect(vi.mocked(apiClient).mock.calls.filter(([url]) => url === '/api/cart')).toHaveLength(1);
  });

  it('opens Cart immediately after a successful Product add', async () => {
    vi.mocked(apiClient).mockImplementation(async (url: string) => {
      if (url === '/api/cart' || url === '/api/cart/items') return { data: validCart };
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<QueryClientProvider client={createQueryClient()}><MemoryRouter initialEntries={['/products']}>
    <CartProvider><Routes><Route path="/products" element={<AddAndOpenCart />} /><Route path="/cart" element={<CartPage />} /></Routes></CartProvider>
    </MemoryRouter></QueryClientProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Add then open Cart' }));
    expect(await screen.findByText('Apple iPad Air 11 M2')).toBeInTheDocument();
    expect(screen.queryByText(/Current availability could not be confirmed/i)).not.toBeInTheDocument();
  });

  it('Stale/canceled availability request: safe recovery without false error', async () => {
    let callCount = 0;
    vi.mocked(apiClient).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new DOMException('The user aborted a request.', 'AbortError');
      }
      return { data: validCart };
    });

    const client = createQueryClient();

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/cart']}>
          <CartProvider>
            <CartPage />
          </CartProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Initial render should NOT display the error notice even if the initial request aborted
    expect(screen.queryByText(/Current availability could not be confirmed/i)).not.toBeInTheDocument();

    // Wait for auto-revalidation to complete
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Proceed to Checkout/i })).toBeEnabled();
    });
    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Current availability could not be confirmed/i)).not.toBeInTheDocument();
  });

  it('recovers once from a transient availability API failure', async () => {
    let attempts = 0;
    vi.mocked(apiClient).mockImplementation(async (url: string) => {
      // Optional Task 04.4 suggestions are a separate request; only cart availability attempts are counted.
      if (url.startsWith('/api/recommendations')) throw new ApiError(503, 'Unavailable');
      attempts++;
      if (attempts === 1) throw new ApiError(503, 'Unavailable');
      return { data: validCart };
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={['/cart']}>
          <CartProvider><CartPage /></CartProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByRole('button', { name: /Proceed to Checkout/i })).toBeEnabled();
    expect(attempts).toBe(2);
    expect(screen.queryByText(/Current availability could not be confirmed/i)).not.toBeInTheDocument();
  });

  it('Genuine unavailable inventory: checkout blocked safely', async () => {
    vi.mocked(apiClient).mockResolvedValue({ data: outOfStockCart });
    const client = createQueryClient();

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/cart']}>
          <CartProvider>
            <CartPage />
          </CartProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText(/Out of stock\. Reduce quantity or remove this item to continue\./i)).toBeInTheDocument();
    expect(screen.getByText(/Remove unavailable items or reduce quantities to continue./i)).toBeInTheDocument();
    const checkoutBtn = screen.getByRole('button', { name: /Proceed to Checkout/i });
    expect(checkoutBtn).toBeDisabled();
  });

  it('Genuine API failure: appropriate fallback and error notice displayed', async () => {
    vi.mocked(apiClient).mockRejectedValue(new ApiError(500, 'Internal Server Error'));
    const client = createQueryClient();
    client.setQueryData(queryKeys.cart.current(user.id), { data: validCart }, { updatedAt: Date.now() - 31_000 });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/cart']}>
          <CartProvider>
            <CartPage />
          </CartProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Since it had cached data and API failed genuinely with 500, error notice appears
    expect(await screen.findByText(/Current availability could not be confirmed. Your cart is still visible./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry availability/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Proceed to Checkout/i })).toBeDisabled();
  });
});
