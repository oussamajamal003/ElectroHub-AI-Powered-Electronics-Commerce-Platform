/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { CustomerHeader } from './CustomerHeader';
import { useAuth } from '@/features/auth/context/AuthContext';

vi.mock('@/features/auth/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

describe('CustomerHeader', () => {
  const mockLogout = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderWithRouter = (ui: React.ReactElement) => {
    return render(<BrowserRouter>{ui}</BrowserRouter>);
  };

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
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();

    // Search, Cart, Wishlist, Account icon buttons/links
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cart' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wishlist' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
  });

  it('opens login popup when unauthenticated Account nav link is clicked', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader />);
    // Click the desktop "Account" nav link specifically
    const accountNavLink = screen.getByRole('link', { name: 'Account' });
    accountNavLink.click();

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

  it('mobile menu contains only Home, Products, Orders, Account', () => {
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
    expect(mobileNav.querySelector('a[href="/orders"]')).toBeTruthy();
    expect(mobileNav.querySelector('a[href="/account"]')).toBeTruthy();

    // Verify exactly 4 links in mobile navigation
    const allLinks = mobileNav.querySelectorAll('a');
    expect(allLinks).toHaveLength(4);

    // Verify forbidden items are absent from mobile menu
    expect(mobileNav.querySelector('a[href="/account/profile"]')).toBeNull();
    expect(mobileNav.querySelector('a[href="/wishlist"]')).toBeNull();
    expect(mobileNav.querySelector('a[href="/cart"]')).toBeNull();
  });

  // ── Search ─────────────────────────────────────────────────
  it('expands search input when Search button is clicked', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    const searchInput = await screen.findByRole('searchbox', { name: 'Search products' });
    expect(searchInput).toBeInTheDocument();
  });

  it('closes search input when back button clicked', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('searchbox', { name: 'Search products' });

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
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
    expect(screen.getByRole('link', { name: 'Cart' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wishlist' })).toBeInTheDocument();
  });

  // ── Promotional Utility Row ───────────────────────────────
  it('renders the promotional utility row above the header', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: false,
      login: vi.fn(),
      logout: mockLogout,
    } as any);

    renderWithRouter(<CustomerHeader />);
    expect(screen.getByRole('region', { name: 'Announcement' })).toBeInTheDocument();
    expect(screen.getByText('Free delivery on orders over $100')).toBeInTheDocument();
  });

  // ── Cart & Wishlist Badges ────────────────────────────────
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
    expect(screen.getByRole('link', { name: 'Cart (3)' })).toBeInTheDocument();
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
    
    expect(screen.getByRole('link', { name: 'Cart' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wishlist' })).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
