/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { CustomerHeader } from './CustomerHeader';
import { useAuth } from '@/features/auth/context/AuthContext';
import { WishlistContext } from '@/features/wishlist/context';
import { wishlistFixture, wishlistProduct } from '@/features/wishlist/fixtures';
import type { WishlistItem } from '@/features/wishlist/types';
import { useCart } from '@/features/cart/context';

vi.mock('@/features/auth/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('@/features/cart/context', () => ({ useCart: vi.fn() }));

describe('CustomerHeader', () => {
  const mockLogout = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCart).mockReturnValue({ data: { totalQuantity: 0 }, isLoading: false } as unknown as ReturnType<typeof useCart>);
  });

  const renderWithRouter = (ui: React.ReactElement) => {
    return render(<BrowserRouter>{ui}</BrowserRouter>);
  };
  it('does not announce false empty collections while startup is unresolved', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, isInitializing: true, isAuthenticated: false } as ReturnType<typeof useAuth>);
    vi.mocked(useCart).mockReturnValue({ data: undefined, isLoading: true } as unknown as ReturnType<typeof useCart>);
    renderWithRouter(<WishlistContext.Provider value={wishlistFixture({ isLoading: true, data: undefined, expectedCount: 0, totalItems: 0 })}><CustomerHeader /></WishlistContext.Provider>);
    // No skeleton or busy state while unresolved; the accessible name does not invent a count.
    expect(screen.getByRole('link', { name: 'Cart' })).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('link', { name: 'Wishlist' })).not.toHaveAttribute('aria-busy');
    expect(screen.queryByRole('link', { name: 'Cart, 0 items' })).not.toBeInTheDocument();
  });

  it('does not announce a false 0 when the Cart read failed (no authoritative Cart)', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, isInitializing: false, isAuthenticated: false } as ReturnType<typeof useAuth>);
    vi.mocked(useCart).mockReturnValue({ data: undefined, isLoading: false, isError: true } as unknown as ReturnType<typeof useCart>);
    renderWithRouter(<CustomerHeader />);
    expect(screen.getByRole('link', { name: 'Cart' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Cart, 0 items' })).not.toBeInTheDocument();
    expect(screen.queryByText('0', { exact: true })).not.toBeInTheDocument();
  });

  it('never carries one customer\'s Cart count into the next customer\'s unresolved state; background refetch keeps the verified count', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, isInitializing: false, isAuthenticated: false } as ReturnType<typeof useAuth>);
    vi.mocked(useCart).mockReturnValue({ data: { totalQuantity: 4 }, isLoading: false } as unknown as ReturnType<typeof useCart>);
    const { rerender } = renderWithRouter(<CustomerHeader />);
    expect(screen.getByRole('link', { name: 'Cart, 4 items' })).toBeInTheDocument();
    // Background refetch with data present: the verified count stays.
    vi.mocked(useCart).mockReturnValue({ data: { totalQuantity: 4 }, isLoading: true } as unknown as ReturnType<typeof useCart>);
    rerender(<BrowserRouter><CustomerHeader /></BrowserRouter>);
    expect(screen.getByRole('link', { name: 'Cart, 4 items' })).toBeInTheDocument();
    // Customer switch: the next customer's Cart is unresolved, so no number (neither 4 nor 0) is shown.
    vi.mocked(useCart).mockReturnValue({ data: undefined, isLoading: true } as unknown as ReturnType<typeof useCart>);
    rerender(<BrowserRouter><CustomerHeader /></BrowserRouter>);
    expect(screen.getByRole('link', { name: 'Cart' })).toBeInTheDocument();
    expect(screen.queryByText('4', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('0', { exact: true })).not.toBeInTheDocument();
    // Their authoritative empty Cart resolves to an explicit 0 label with no badge.
    vi.mocked(useCart).mockReturnValue({ data: { totalQuantity: 0 }, isLoading: false } as unknown as ReturnType<typeof useCart>);
    rerender(<BrowserRouter><CustomerHeader /></BrowserRouter>);
    expect(screen.getByRole('link', { name: 'Cart, 0 items' })).toBeInTheDocument();
    expect(screen.queryByText('0', { exact: true })).not.toBeInTheDocument();
  });

  // ── Unauthenticated state ──────────────────────────────────
  it('renders correctly in unauthenticated state', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader />);

    // Desktop nav present
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Products')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about');
    expect(screen.getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/contact');
    expect(screen.queryByText('Orders')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Account' })).not.toBeInTheDocument();

    // Search, Cart, Wishlist, Account icon buttons/links
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cart, 0 items' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wishlist' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
  });

  it('opens login popup when unauthenticated Account icon is clicked', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader />);
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Welcome Back')).toBeInTheDocument();
    expect(screen.getByText('Sign in to your account to continue')).toBeInTheDocument();
  });

  // ── Authenticated state ────────────────────────────────────
  it('renders correctly in authenticated state', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: '1',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        role: 'CUSTOMER',
      },
      isAuthenticated: true,
      isInitializing: false,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader />);
    expect(screen.getByText('JD')).toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Account' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Account menu for John Doe' })
    ).toBeInTheDocument();
  });

  // ── Mobile vertical menu ───────────────────────────────────
  it('opens mobile menu vertically — nav inside header, no aside', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader />);

    const toggleButton = screen.getByRole('button', { name: /Open navigation menu/i });
    expect(toggleButton).toBeInTheDocument();

    // Mobile menu not yet rendered
    expect(screen.queryByRole('navigation', { name: 'Mobile Navigation' })).not.toBeInTheDocument();

    // Open
    fireEvent.click(toggleButton);

    // Mobile navigation appears (in-flow nav inside header)
    const mobileNav = screen.getByRole('navigation', { name: 'Mobile Navigation' });
    expect(mobileNav).toBeInTheDocument();

    // Hamburger changed to close
    expect(screen.getByRole('button', { name: /Close navigation menu/i })).toBeInTheDocument();
  });

  it('closes mobile menu when close button clicked', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader />);

    // Open
    fireEvent.click(screen.getByRole('button', { name: /Open navigation menu/i }));
    expect(screen.getByRole('navigation', { name: 'Mobile Navigation' })).toBeInTheDocument();

    // Close via toggle (now shows X)
    fireEvent.click(screen.getByRole('button', { name: /Close navigation menu/i }));
    expect(screen.queryByRole('navigation', { name: 'Mobile Navigation' })).not.toBeInTheDocument();
  });

  it('closes mobile menu when nav item inside mobile menu clicked', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader />);

    // Open
    fireEvent.click(screen.getByRole('button', { name: /Open navigation menu/i }));
    const mobileNav = screen.getByRole('navigation', { name: 'Mobile Navigation' });
    expect(mobileNav).toBeInTheDocument();

    // Click the Products link *inside* the mobile nav specifically
    const mobileProductsLink = mobileNav.querySelector('a[href="/products"]') as HTMLElement;
    expect(mobileProductsLink).toBeTruthy();
    fireEvent.click(mobileProductsLink);

    // Menu collapses — closeMobileMenu was called
    expect(screen.queryByRole('navigation', { name: 'Mobile Navigation' })).not.toBeInTheDocument();
  });

  it('mobile guest menu contains public destinations without Orders', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader />);
    fireEvent.click(screen.getByRole('button', { name: /Open navigation menu/i }));

    const mobileNav = screen.getByRole('navigation', { name: 'Mobile Navigation' });

    // Primary items present
    expect(mobileNav.querySelector('a[href="/"]')).toBeTruthy();
    expect(mobileNav.querySelector('a[href="/products"]')).toBeTruthy();
    expect(mobileNav.querySelector('a[href="/about"]')).toBeTruthy();
    expect(mobileNav.querySelector('a[href="/contact"]')).toBeTruthy();
    expect(mobileNav.querySelector('a[href="/orders"]')).toBeNull();
    expect(mobileNav.querySelector('a[href="/account"]')).toBeNull();

    // Verify exactly 4 links in mobile navigation (Home, Products, About, Contact)
    const allLinks = mobileNav.querySelectorAll('a');
    expect(allLinks).toHaveLength(4);

    // Verify forbidden items are absent from mobile menu
    expect(mobileNav.querySelector('a[href="/account/profile"]')).toBeNull();
    expect(mobileNav.querySelector('a[href="/wishlist"]')).toBeNull();
    expect(mobileNav.querySelector('a[href="/cart"]')).toBeNull();
  });

  it('collapses the open mobile menu after successful login', async () => {
    const login = vi.fn().mockResolvedValue({ user: { id: '1', firstName: 'John', lastName: 'Doe' } });
    vi.mocked(useAuth).mockReturnValue({ user: null, isAuthenticated: false, isInitializing: false,
      login, logout: mockLogout } as any);
    renderWithRouter(<CustomerHeader />);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'john@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByLabelText(/^Password$/i).closest('form')!);
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Mobile Navigation' })).not.toBeInTheDocument());
  });

  it('does not contain a standalone Sign Out button in mobile navigation and collapses sidebar on signout', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useAuth).mockReturnValue({
      user: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', role: 'CUSTOMER' },
      isAuthenticated: true,
      isInitializing: false,
      login: vi.fn(),
      logout,
    } as any);
    const { unmount } = renderWithRouter(<CustomerHeader />);

    // Open mobile navigation
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const mobileNav = screen.getByRole('navigation', { name: 'Mobile Navigation' });

    // Standalone signout button is absent from mobile nav
    expect(mobileNav.querySelector('button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign Out' })).toBeNull();

    unmount();

    // When auth changes to unauthenticated on logout
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      login: vi.fn(),
      logout,
    } as any);
    renderWithRouter(<CustomerHeader />);

    // Mobile navigation must collapse immediately
    expect(screen.queryByRole('navigation', { name: 'Mobile Navigation' })).not.toBeInTheDocument();
  });

  it('renders desktop navigation in strict order: Home -> Products -> Orders -> About -> Contact', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', role: 'CUSTOMER' },
      isAuthenticated: true, isInitializing: false, logout: vi.fn(),
    } as any);

    renderWithRouter(<CustomerHeader />);
    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    const links = Array.from(primaryNav.querySelectorAll('a')).map(el => el.textContent?.trim());
    expect(links).toEqual(['Home', 'Products', 'Orders', 'About', 'Contact']);
  });

  it('does not flash Orders during auth initialization', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: true,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader />);
    expect(screen.queryByText('Orders')).not.toBeInTheDocument();
  });

  it('does not expose a guest Account control while the session is unresolved', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: true,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader />);
    expect(screen.queryByRole('button', { name: 'Account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Login' })).not.toBeInTheDocument();
  });

  it('keeps the stable header shell without guest controls during session restoration', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      rememberedUser: { firstName: 'John', lastName: 'Doe' },
      isAuthenticated: false,
      isInitializing: true,
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader />);
    expect(screen.queryByTestId('auth-hydration-header')).not.toBeInTheDocument();
    expect(screen.queryByText('Restoring your session…')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByText('JD')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Login' })).not.toBeInTheDocument();
  });

  // ── Search ─────────────────────────────────────────────────
  it('navigates to Search without replacing header controls', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(window.location.pathname).toBe('/search');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cart, 0 items' })).toBeInTheDocument();
  });

  it('keeps navigation intact after Search activation', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(window.location.pathname).toBe('/search');
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  });

  // ── Logo and nav links ─────────────────────────────────────
  it('renders logo and utility icon links', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader />);
    expect(screen.getByRole('link', { name: /ElectroHub — Home/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cart, 0 items' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wishlist' })).toBeInTheDocument();
  });

  // ── Top Delivery Strip Removed ───────────────────────────────
  it('does not render the top promotional delivery strip', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader />);
    expect(screen.queryByRole('region', { name: 'Announcement' })).not.toBeInTheDocument();
    expect(screen.queryByText('Free delivery on orders over $100')).not.toBeInTheDocument();
  });

  // ── Cart & Wishlist Badges ────────────────────────────────
  it('shows the Wishlist badge only once resolved items render, and keeps it through a background refetch', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, isAuthenticated: false, isInitializing: false, logout: mockLogout } as any);
    // Typed from the shared fixture product (not an index into fixture data, which may be undefined/null).
    const items: WishlistItem[] = [1, 2, 3].map(n => ({ productId: `wish-${n}`, product: { ...wishlistProduct, id: `wish-${n}` }, availability: 'AVAILABLE' }));
    const { rerender } = renderWithRouter(<WishlistContext.Provider value={wishlistFixture({ isLoading: true, data: undefined, expectedCount: 3, totalItems: 3 })}><CustomerHeader /></WishlistContext.Provider>);
    expect(screen.getByRole('link', { name: 'Wishlist' })).toBeInTheDocument();
    expect(screen.queryByText('3', { exact: true })).not.toBeInTheDocument();
    rerender(<BrowserRouter><WishlistContext.Provider value={wishlistFixture({ data: { items, totalItems: 3 }, productIds: items.map(item => item.productId), totalItems: 3 })}><CustomerHeader /></WishlistContext.Provider></BrowserRouter>);
    expect(screen.getByRole('link', { name: 'Wishlist (3)' })).toBeInTheDocument();
    rerender(<BrowserRouter><WishlistContext.Provider value={wishlistFixture({ isLoading: true, data: { items, totalItems: 3 }, productIds: items.map(item => item.productId), totalItems: 3 })}><CustomerHeader /></WishlistContext.Provider></BrowserRouter>);
    expect(screen.getByRole('link', { name: 'Wishlist (3)' })).toBeInTheDocument();
    rerender(<BrowserRouter><WishlistContext.Provider value={wishlistFixture({ data: { items: [], totalItems: 0 }, productIds: [], totalItems: 0 })}><CustomerHeader /></WishlistContext.Provider></BrowserRouter>);
    expect(screen.getByRole('link', { name: 'Wishlist' })).toBeInTheDocument();
    expect(screen.queryByText('0', { exact: true })).not.toBeInTheDocument();
  });
  it('renders cart and wishlist badges when counts are greater than 0', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader cartCount={3} wishlistCount={2} />);
    
    // Cart link has accessible label including count
    expect(screen.getByRole('link', { name: 'Cart, 3 items' })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    // Wishlist link has accessible label including count
    expect(screen.getByRole('link', { name: 'Wishlist (2)' })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('hides cart and wishlist badges when counts are 0', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader cartCount={0} wishlistCount={0} />);
    
    expect(screen.getByRole('link', { name: 'Cart, 0 items' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wishlist' })).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
