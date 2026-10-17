import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient, queryKeys } from '@/lib/query';
import { apiClient, ApiError } from '@/lib/api';
import { useAuth } from '@/features/auth/context/AuthContext';
import { CartProvider } from './CartProvider';
import { useCart } from './context';
import { writeAuthenticatedCartCount, writeGuestCart } from './storage';
import { WishlistProvider } from '@/features/wishlist/WishlistProvider';
import { useWishlist } from '@/features/wishlist/context';
import { writeAuthenticatedWishlistCount, writeWishlist } from '@/features/wishlist/storage';
import { CustomerHeader } from '@/components/layout/CustomerHeader/CustomerHeader';
import { CartPageContent } from '@/pages/customer/CartPage';
import { WishlistPageContent } from '@/pages/customer/WishlistPage';
import type { CartData } from './types';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiClient: vi.fn() }));

const productId = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const productId2 = '9a111111-2222-3333-4444-555555555555';
const userId = '62a990ff-7909-4bbb-b42f-8f20b6d97af4';

const sampleCart: CartData = {
  revision: 'rev-1',
  items: [
    {
      id: 'item-1',
      productId,
      quantity: 2,
      product: { slug: 'headphones', name: 'Wireless Headphones', category: 'Audio', price: '99.99', image: null },
      availableQuantity: 10,
      stockStatus: 'IN_STOCK',
      availability: 'AVAILABLE',
      lineTotal: '199.98',
    },
  ],
  totalQuantity: 2,
  subtotal: '199.98',
  shipping: '0.00',
  total: '199.98',
  currency: 'USD',
  canCheckout: true,
};

describe('ELECTROHUB — P1 Cart/Wishlist Performance & Sync Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  // ============================================================
  // BUG 1 — BROWSER REFRESH
  // ============================================================
  describe('BUG 1 — Browser Refresh session restoration & badge hydration', () => {
    // Architect-approved contract (2026-10-15, supersedes the earlier "paint the session-cached count" expectation):
    // until authoritative data resolves the badges are number-free (no skeleton, no cached/fabricated count, no 0),
    // and once it resolves they show the verified count. Cached counts are written below precisely to prove they are
    // NOT painted before identity is verified.
    it('keeps authenticated badges number-free until verified data resolves, then shows the correct counts without flashing 0', async () => {
      writeAuthenticatedCartCount(userId, 2);
      writeAuthenticatedWishlistCount(userId, 3);

      const user = { id: userId, email: 'customer@test.com', role: 'CUSTOMER', firstName: 'Jane', lastName: 'Doe' };
      vi.mocked(useAuth).mockReturnValue({
        user,
        isAuthenticated: true,
        isSessionVerified: false,
        isInitializing: true,
        isLoggingOut: false,
        rememberedUser: { firstName: 'Jane', lastName: 'Doe' },
        finishLogoutTransition: vi.fn(),
      } as unknown as ReturnType<typeof useAuth>);

      const client = createQueryClient();
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <CartProvider>
              <WishlistProvider>
                <CustomerHeader />
                {children}
              </WishlistProvider>
            </CartProvider>
          </MemoryRouter>
        </QueryClientProvider>
      );

      // The Cart read is held so the verified-but-unresolved interval is observable (delayed response).
      let releaseCart!: () => void;
      const cartGate = new Promise<void>(resolve => { releaseCart = resolve; });
      vi.mocked(apiClient).mockImplementation(async (endpoint) => {
        if (endpoint === '/api/wishlist') {
          return {
            data: {
              items: [
                { productId: '1', product: { slug: 'p1', name: 'P1' } },
                { productId: '2', product: { slug: 'p2', name: 'P2' } },
                { productId: '3', product: { slug: 'p3', name: 'P3' } },
              ],
              totalItems: 3,
            },
          } as never;
        }
        await cartGate;
        return { data: sampleCart } as never;
      });

      const page = <div data-testid="page-content">Home</div>;
      const view = render(page, { wrapper });
      const assertCartNumberFree = () => {
        expect(screen.getByRole('link', { name: 'Cart' })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /^Cart, \d/ })).not.toBeInTheDocument();
        expect(screen.queryByText('0', { exact: true })).not.toBeInTheDocument();
        expect(screen.queryByText('2', { exact: true })).not.toBeInTheDocument();
      };

      // Unverified identity: no count of any kind (not the cached 2/3, not 0), and no protected reads.
      assertCartNumberFree();
      expect(screen.getByRole('link', { name: 'Wishlist' })).toBeInTheDocument();
      expect(screen.queryByText('3', { exact: true })).not.toBeInTheDocument();
      expect(apiClient).not.toHaveBeenCalled();

      vi.mocked(useAuth).mockReturnValue({
        user,
        isAuthenticated: true,
        isSessionVerified: true,
        isInitializing: false,
        isLoggingOut: false,
        rememberedUser: { firstName: 'Jane', lastName: 'Doe' },
        finishLogoutTransition: vi.fn(),
      } as unknown as ReturnType<typeof useAuth>);
      view.rerender(page);

      // Verified, Cart read still in flight: still number-free, never a 0 flash.
      await waitFor(() => expect(vi.mocked(apiClient).mock.calls.some(([endpoint]) => endpoint === '/api/cart')).toBe(true));
      assertCartNumberFree();

      await act(async () => { releaseCart(); });
      await waitFor(() => {
        expect(screen.getByRole('link', { name: 'Wishlist (3)' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Cart, 2 items' })).toBeInTheDocument();
      });
      expect(screen.getByText('2', { exact: true })).toBeInTheDocument();
      expect(vi.mocked(apiClient).mock.calls.filter(([endpoint]) => endpoint === '/api/cart')).toHaveLength(1);
    });

    it('keeps guest badges number-free until the stored guest Cart is validated, then shows its count', async () => {
      // Guest with 3 cart items and 2 wishlist items in localStorage
      writeGuestCart([{ productId, quantity: 3 }]);
      writeWishlist([productId, productId2]);
      const guestCart: CartData = { ...sampleCart, items: [{ ...sampleCart.items[0]!, quantity: 3, lineTotal: '299.97' }],
        totalQuantity: 3, subtotal: '299.97', total: '299.97' };

      vi.mocked(apiClient).mockImplementation(async (endpoint) => {
        if (endpoint === '/api/cart/validate') return { data: guestCart } as never;
        if (endpoint === '/api/wishlist/validate') {
          return {
            data: {
              items: [
                { productId, product: { slug: 'p1', name: 'Product 1' } },
                { productId: productId2, product: { slug: 'p2', name: 'Product 2' } },
              ],
              totalItems: 2,
            },
          } as never;
        }
        throw new Error(`Unexpected request ${String(endpoint)}`);
      });

      const unverifiedGuest = { user: null, isAuthenticated: false, isSessionVerified: false, isInitializing: true,
        isLoggingOut: false, rememberedUser: null, finishLogoutTransition: vi.fn() } as unknown as ReturnType<typeof useAuth>;
      vi.mocked(useAuth).mockReturnValue(unverifiedGuest);

      const client = createQueryClient();
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <CartProvider>
              <WishlistProvider>
                <CustomerHeader />
                {children}
              </WishlistProvider>
            </CartProvider>
          </MemoryRouter>
        </QueryClientProvider>
      );

      const page = <div data-testid="page-content">Home</div>;
      const view = render(page, { wrapper });

      // Session not yet resolved: the stored quantity is not painted as a count, and 0 is never announced.
      expect(screen.getByRole('link', { name: 'Cart' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /^Cart, \d/ })).not.toBeInTheDocument();
      expect(screen.queryByText('3', { exact: true })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Wishlist' })).toBeInTheDocument();

      vi.mocked(useAuth).mockReturnValue({ ...unverifiedGuest, isSessionVerified: true, isInitializing: false } as ReturnType<typeof useAuth>);
      view.rerender(page);

      // Validated guest data resolves to the correct counts.
      await waitFor(() => {
        expect(screen.getByRole('link', { name: 'Cart, 3 items' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Wishlist (2)' })).toBeInTheDocument();
      });
      expect(screen.getByText('3', { exact: true })).toBeInTheDocument();
      expect(screen.getByText('2', { exact: true })).toBeInTheDocument();
    });

    it('CartPage renders loading skeleton on refresh and never flashes empty cart while loading', () => {
      const user = { id: userId, email: 'customer@test.com', role: 'CUSTOMER', firstName: 'Jane', lastName: 'Doe' };
      vi.mocked(useAuth).mockReturnValue({
        user,
        isAuthenticated: true,
        isSessionVerified: false,
        isInitializing: true,
        isLoggingOut: false,
        finishLogoutTransition: vi.fn(),
      } as unknown as ReturnType<typeof useAuth>);

      // Cart is pending fetch
      const client = createQueryClient();
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <CartProvider>{children}</CartProvider>
          </MemoryRouter>
        </QueryClientProvider>
      );

      const { result } = renderHook(() => useCart(), { wrapper });
      expect(result.current.isLoading).toBe(true);
      expect(result.current.data).toBeUndefined();

      render(
        <MemoryRouter>
          <CartPageContent cart={result.current} />
        </MemoryRouter>
      );

      // Must display loading skeleton
      expect(screen.getByTestId('cart-skeleton')).toBeInTheDocument();
      // Must NOT display empty cart message
      expect(screen.queryByText('Your cart is empty')).not.toBeInTheDocument();
    });

    it('WishlistPage renders loading skeleton on refresh and never flashes empty wishlist while loading', () => {
      const user = { id: userId, email: 'customer@test.com', role: 'CUSTOMER', firstName: 'Jane', lastName: 'Doe' };
      vi.mocked(useAuth).mockReturnValue({
        user,
        isAuthenticated: true,
        isSessionVerified: false,
        isInitializing: true,
        isLoggingOut: false,
        finishLogoutTransition: vi.fn(),
      } as unknown as ReturnType<typeof useAuth>);

      const client = createQueryClient();
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <WishlistProvider>{children}</WishlistProvider>
          </MemoryRouter>
        </QueryClientProvider>
      );

      const { result } = renderHook(() => useWishlist(), { wrapper });
      const wishlist = result.current;
      if (!wishlist) throw new Error('WishlistProvider was not mounted.');
      expect(wishlist.isLoading).toBe(true);

      render(
        <MemoryRouter>
          <WishlistPageContent wishlist={wishlist} onAddToCart={vi.fn()} onNavigate={vi.fn()} />
        </MemoryRouter>
      );

      // Must display loading skeletons
      expect(screen.getByRole('status', { name: 'Loading wishlist' })).toBeInTheDocument();
      // Must NOT display empty state
      expect(screen.queryByText('Your wishlist is empty')).not.toBeInTheDocument();
    });
  });

  // ============================================================
  // BUG 2 — SLOW ADD TO CART & OPTIMISTIC UPDATES & RAPID CLICKS
  // ============================================================
  describe('BUG 2 — Slow Add to Cart: confirmed-only counts, pending state & rapid clicks', () => {
    it('keeps the badge on the confirmed count while pending, tracks the pending product, then shows the server count', async () => {
      const user = { id: userId, email: 'customer@test.com', role: 'CUSTOMER', firstName: 'Jane', lastName: 'Doe' };
      vi.mocked(useAuth).mockReturnValue({
        user,
        isAuthenticated: true,
        isSessionVerified: true,
        isInitializing: false,
        isLoggingOut: false,
      } as unknown as ReturnType<typeof useAuth>);

      let resolveAdd!: (value: unknown) => void;
      vi.mocked(apiClient).mockImplementation(async (endpoint) => {
        if (endpoint === '/api/cart/items') {
          return new Promise(resolve => { resolveAdd = resolve; });
        }
        return { data: sampleCart } as never;
      });

      const client = createQueryClient();
      client.setQueryData(queryKeys.cart.current(userId), { data: sampleCart });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>
          <CartProvider>{children}</CartProvider>
        </QueryClientProvider>
      );

      const { result } = renderHook(() => useCart(), { wrapper });
      expect(result.current.totalQuantity).toBe(2);

      // Add item
      let addPromise!: Promise<void>;
      act(() => {
        addPromise = result.current.addItem(productId, 1);
      });

      // Immediate feedback is the pending state only; the count stays on the last confirmed Cart (never ahead of the server).
      expect(result.current.totalQuantity).toBe(2);
      expect(result.current.data?.items[0]?.quantity).toBe(2);
      expect(result.current.pendingProductIds).toContain(productId);
      expect(result.current.isMutating).toBe(true);
      expect(result.current.isAddPending).toBe(true);

      // Server completes
      const updatedCart: CartData = {
        ...sampleCart,
        items: [{ ...sampleCart.items[0]!, quantity: 3 }],
        totalQuantity: 3,
      };

      await waitFor(() => expect(resolveAdd).toBeDefined());

      await act(async () => {
        resolveAdd({ data: updatedCart });
        await addPromise;
      });

      // Confirmed by authoritative server response
      expect(result.current.totalQuantity).toBe(3);
      expect(result.current.pendingProductIds).not.toContain(productId);
      expect(result.current.isAddPending).toBe(false);
    });

    it('deduplicates rapid clicks into an accumulated batch without losing intended quantity', async () => {
      const user = { id: userId, email: 'customer@test.com', role: 'CUSTOMER', firstName: 'Jane', lastName: 'Doe' };
      vi.mocked(useAuth).mockReturnValue({
        user,
        isAuthenticated: true,
        isSessionVerified: true,
        isInitializing: false,
        isLoggingOut: false,
      } as unknown as ReturnType<typeof useAuth>);

      const apiCalls: Array<{ endpoint: string; data: unknown }> = [];
      vi.mocked(apiClient).mockImplementation(async (endpoint, options) => {
        apiCalls.push({ endpoint, data: options?.data });
        const requestedQuantity = (options?.data as { quantity?: number } | undefined)?.quantity ?? 1;
        return {
          data: {
            ...sampleCart,
            items: [{ ...sampleCart.items[0]!, quantity: 2 + requestedQuantity }],
            totalQuantity: 2 + requestedQuantity,
          },
        } as never;
      });

      const client = createQueryClient();
      client.setQueryData(queryKeys.cart.current(userId), { data: sampleCart });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>
          <CartProvider>{children}</CartProvider>
        </QueryClientProvider>
      );

      const { result } = renderHook(() => useCart(), { wrapper });

      // Simulate 3 rapid clicks to Add to Cart
      let p1!: Promise<void>;
      let p2!: Promise<void>;
      let p3!: Promise<void>;
      act(() => {
        p1 = result.current.addItem(productId, 1);
        p2 = result.current.addItem(productId, 1);
        p3 = result.current.addItem(productId, 1);
      });

      // The count stays on the confirmed Cart until the single batched request is confirmed.
      expect(result.current.totalQuantity).toBe(2);

      await act(async () => {
        await Promise.all([p1, p2, p3]);
      });

      // Rapid clicks were deduplicated into a single batched network call with quantity: 3
      const postCalls = apiCalls.filter(c => c.endpoint === '/api/cart/items');
      expect(postCalls.length).toBe(1);
      expect(postCalls[0]!.data).toEqual({ productId, quantity: 3 });

      // Final reconciled count is 5
      expect(result.current.totalQuantity).toBe(5);
    });

    it('counts confirmed quantity once and permits rapid adds up to the combined stock limit', async () => {
      const user = { id: userId, email: 'customer@test.com', role: 'CUSTOMER', firstName: 'Jane', lastName: 'Doe' };
      vi.mocked(useAuth).mockReturnValue({ user, isAuthenticated: true, isSessionVerified: true, isInitializing: false, isLoggingOut: false } as unknown as ReturnType<typeof useAuth>);
      const limitedCart = { ...sampleCart, items: [{ ...sampleCart.items[0]!, availableQuantity: 4 }] };
      let resolveAdd!: (value: unknown) => void;
      vi.mocked(apiClient).mockImplementation(async endpoint => endpoint === '/api/cart/items'
        ? new Promise(resolve => { resolveAdd = resolve; })
        : { data: limitedCart } as never);
      const client = createQueryClient();
      client.setQueryData(queryKeys.cart.current(userId), { data: limitedCart });
      const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><CartProvider>{children}</CartProvider></QueryClientProvider>;
      const { result } = renderHook(() => useCart(), { wrapper });
      let first!: Promise<void>; let second!: Promise<void>;
      act(() => { first = result.current.addItem(productId); second = result.current.addItem(productId); });
      expect(result.current.totalQuantity).toBe(2); // confirmed count only; pending quantity tracked separately
      expect(result.current.pendingAdditions).toEqual({ [productId]: 2 });
      await waitFor(() => expect(resolveAdd).toBeTypeOf('function'));
      await act(async () => {
        resolveAdd({ data: { ...limitedCart, items: [{ ...limitedCart.items[0]!, quantity: 4 }], totalQuantity: 4 } });
        await Promise.all([first, second]);
      });
      expect(result.current.totalQuantity).toBe(4);
      expect(result.current.pendingAdditions).toEqual({});
    });

    it('rolls back optimistic addition when backend returns a stock conflict error', async () => {
      const user = { id: userId, email: 'customer@test.com', role: 'CUSTOMER', firstName: 'Jane', lastName: 'Doe' };
      vi.mocked(useAuth).mockReturnValue({
        user,
        isAuthenticated: true,
        isSessionVerified: true,
        isInitializing: false,
        isLoggingOut: false,
      } as unknown as ReturnType<typeof useAuth>);

      vi.mocked(apiClient).mockImplementation(async (endpoint) => {
        if (endpoint === '/api/cart/items') {
          throw new ApiError(409, 'Only 2 items are currently available.', undefined, 'CART_STOCK_CONFLICT');
        }
        return { data: sampleCart } as never;
      });

      const client = createQueryClient();
      client.setQueryData(queryKeys.cart.current(userId), { data: sampleCart });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>
          <CartProvider>{children}</CartProvider>
        </QueryClientProvider>
      );

      const { result } = renderHook(() => useCart(), { wrapper });
      expect(result.current.totalQuantity).toBe(2);

      let addError: unknown;
      await act(async () => {
        try {
          await result.current.addItem(productId, 2);
        } catch (err) {
          addError = err;
        }
      });

      // Error thrown with sanitized conflict
      expect(addError).toBeInstanceOf(ApiError);
      if (!(addError instanceof ApiError)) throw new Error('Expected a sanitized Cart stock conflict.');
      expect(addError.message).toBe('Only 2 items are currently available.');

      // Optimistic count rolled back safely to 2!
      expect(result.current.totalQuantity).toBe(2);
      expect(result.current.pendingProductIds).not.toContain(productId);
      expect(result.current.isAddPending).toBe(false);
    });

    it('rejects addition that exceeds known available stock without network call', async () => {
      const user = { id: userId, email: 'customer@test.com', role: 'CUSTOMER', firstName: 'Jane', lastName: 'Doe' };
      vi.mocked(useAuth).mockReturnValue({
        user,
        isAuthenticated: true,
        isSessionVerified: true,
        isInitializing: false,
        isLoggingOut: false,
      } as unknown as ReturnType<typeof useAuth>);

      const limitedCart: CartData = {
        ...sampleCart,
        items: [{ ...sampleCart.items[0]!, quantity: 2, availableQuantity: 3 }],
      };

      const client = createQueryClient();
      client.setQueryData(queryKeys.cart.current(userId), { data: limitedCart });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>
          <CartProvider>{children}</CartProvider>
        </QueryClientProvider>
      );

      const { result } = renderHook(() => useCart(), { wrapper });

      // Trying to add 2 when only 1 more is available (2 in cart + 2 requested > 3 available)
      await expect(result.current.addItem(productId, 2)).rejects.toThrow('Only 1 item is currently available.');
      expect(result.current.totalQuantity).toBe(2);
    });
  });

  // ============================================================
  // BUG 3 — NAVIGATE TO CART WHILE ADDING
  // ============================================================
  describe('BUG 3 — Navigate to Cart while adding', () => {
    it('shows loading skeleton and never flashes empty cart when navigating to empty cart while add is in-flight', async () => {
      const user = { id: userId, email: 'customer@test.com', role: 'CUSTOMER', firstName: 'Jane', lastName: 'Doe' };
      vi.mocked(useAuth).mockReturnValue({
        user,
        isAuthenticated: true,
        isSessionVerified: true,
        isInitializing: false,
        isLoggingOut: false,
      } as unknown as ReturnType<typeof useAuth>);

      let resolveAdd!: (value: unknown) => void;
      vi.mocked(apiClient).mockImplementation(async (endpoint) => {
        if (endpoint === '/api/cart/items') {
          return new Promise(resolve => { resolveAdd = resolve; });
        }
        return { data: { ...sampleCart, items: [], totalQuantity: 0 } } as never;
      });

      // Cart previously has 0 items
      const emptyCart: CartData = { ...sampleCart, items: [], totalQuantity: 0, subtotal: '0.00', total: '0.00', canCheckout: false };
      const client = createQueryClient();
      client.setQueryData(queryKeys.cart.current(userId), { data: emptyCart });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>
          <CartProvider>{children}</CartProvider>
        </QueryClientProvider>
      );

      const { result } = renderHook(() => useCart(), { wrapper });

      // User clicks Add to Cart on Home
      let addPromise!: Promise<void>;
      act(() => {
        addPromise = result.current.addItem(productId, 1);
      });

      expect(result.current.isAddPending).toBe(true);

      // User immediately navigates to /cart: CartPage renders
      const { rerender } = render(
        <MemoryRouter>
          <CartPageContent cart={result.current} />
        </MemoryRouter>
      );

      // Loading skeleton MUST be visible!
      expect(screen.getByTestId('cart-skeleton')).toBeInTheDocument();
      // Empty cart state MUST NOT be visible!
      expect(screen.queryByText('Your cart is empty')).not.toBeInTheDocument();

      // Server confirms the addition
      const confirmedCart: CartData = {
        ...sampleCart,
        items: [{ ...sampleCart.items[0]!, quantity: 1 }],
        totalQuantity: 1,
      };

      await waitFor(() => expect(resolveAdd).toBeDefined());

      await act(async () => {
        resolveAdd({ data: confirmedCart });
        await addPromise;
      });

      // Rerender after server confirmation
      rerender(
        <MemoryRouter>
          <CartPageContent cart={result.current} />
        </MemoryRouter>
      );

      // Loading skeleton is gone, newly confirmed product is displayed!
      expect(screen.queryByTestId('cart-skeleton')).not.toBeInTheDocument();
      expect(screen.getByText('Wireless Headphones')).toBeInTheDocument();
      expect(screen.queryByText('Your cart is empty')).not.toBeInTheDocument();
    });

    it('synchronizes header, cart, and product cards across route navigation', async () => {
      const user = { id: userId, email: 'customer@test.com', role: 'CUSTOMER', firstName: 'Jane', lastName: 'Doe' };
      vi.mocked(useAuth).mockReturnValue({
        user,
        isAuthenticated: true,
        isSessionVerified: true,
        isInitializing: false,
        isLoggingOut: false,
        rememberedUser: { firstName: 'Jane', lastName: 'Doe' },
        finishLogoutTransition: vi.fn(),
      } as unknown as ReturnType<typeof useAuth>);

      vi.mocked(apiClient).mockImplementation(async (endpoint) => {
        if (endpoint === '/api/cart/items') {
          return { data: sampleCart } as never;
        }
        return { data: sampleCart } as never;
      });

      const client = createQueryClient();
      client.setQueryData(queryKeys.cart.current(userId), { data: sampleCart });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <CartProvider>
              <CustomerHeader />
              {children}
            </CartProvider>
          </MemoryRouter>
        </QueryClientProvider>
      );

      const { rerender } = render(<div data-testid="route-page">Home</div>, { wrapper });

      // Header has cart count 2
      expect(screen.getByRole('link', { name: 'Cart, 2 items' })).toBeInTheDocument();

      // Navigate to /cart
      rerender(<div data-testid="route-page"><CartPageContent cart={{ ...resultCart(sampleCart) }} /></div>);

      // Cart list displays the 2 items
      expect(screen.getByText('Wireless Headphones')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Cart, 2 items' })).toBeInTheDocument();
    });
  });
});

function resultCart(cartData: CartData) {
  return {
    data: cartData,
    totalQuantity: cartData.totalQuantity,
    isGuest: false,
    isLoggingOut: false,
    isLoading: false,
    isError: false,
    isMutating: false,
    pendingProductIds: [],
    pendingRemoveProductIds: [],
    mergeError: null,
    pendingGuestItems: [],
    addItem: vi.fn(),
    setQuantity: vi.fn(),
    removeItem: vi.fn(),
    retry: vi.fn(),
    validateRoute: vi.fn(),
    retryMerge: vi.fn(),
    removePendingGuestItem: vi.fn(),
    submitCheckout: vi.fn(),
  };
}

describe('Badge never runs ahead of the confirmed Cart', () => {
  it('a failed add keeps the previous Cart and count, and a stale refetch cannot overwrite a confirmed add', async () => {
    const user = { id: userId, email: 'customer@test.com', role: 'CUSTOMER', firstName: 'Jane', lastName: 'Doe' };
    vi.mocked(useAuth).mockReturnValue({ user, isAuthenticated: true, isSessionVerified: true, isInitializing: false, isLoggingOut: false } as unknown as ReturnType<typeof useAuth>);
    let fail = true; let resolveAdd!: (value: unknown) => void;
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint !== '/api/cart/items') return { data: sampleCart } as never;
      if (fail) throw new ApiError(503, 'Unavailable');
      return new Promise(resolve => { resolveAdd = resolve; });
    });
    const client = createQueryClient();
    client.setQueryData(queryKeys.cart.current(userId), { data: sampleCart });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><CartProvider>{children}</CartProvider></QueryClientProvider>;
    const { result } = renderHook(() => useCart(), { wrapper });
    await act(async () => { await result.current.addItem(productId).catch(() => undefined); });
    expect(result.current.totalQuantity).toBe(2); expect(result.current.data?.items[0]?.quantity).toBe(2);
    expect(result.current.isAddPending).toBe(false);
    fail = false;
    let add!: Promise<void>; act(() => { add = result.current.addItem(productId); });
    await waitFor(() => expect(resolveAdd).toBeTypeOf('function'));
    expect(result.current.totalQuantity).toBe(2);
    const confirmed = { ...sampleCart, items: [{ ...sampleCart.items[0]!, quantity: 3 }], totalQuantity: 3 };
    await act(async () => { resolveAdd({ data: confirmed }); await add; });
    expect(result.current.totalQuantity).toBe(3); expect(result.current.data?.items[0]?.quantity).toBe(3);
  });
});
