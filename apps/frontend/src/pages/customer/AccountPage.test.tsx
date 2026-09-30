/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { AccountPage } from './AccountPage';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useMyReviews } from '@/features/products/queries';

vi.mock('@/features/auth/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('@/features/products/queries', () => ({ useMyReviews: vi.fn() }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('AccountPage', () => {
  const mockLogout = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useMyReviews).mockReturnValue({ data: { data: [] }, isPending: false, isError: false, refetch: vi.fn() } as unknown as ReturnType<typeof useMyReviews>);
    vi.mocked(useAuth).mockReturnValue({
      user: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', role: 'CUSTOMER' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: mockLogout,
    } as any);
  });

  const renderWithRouter = (ui: React.ReactElement) => {
    return render(<BrowserRouter>{ui}</BrowserRouter>);
  };

  it('renders breadcrumb', () => {
    renderWithRouter(<AccountPage />);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getAllByText('Account').length).toBeGreaterThan(0);
  });

  it('renders user details', () => {
    renderWithRouter(<AccountPage />);
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
    expect(screen.getByText('J')).toBeInTheDocument(); // Avatar initial
  });

  it('renders all four account rows', () => {
    renderWithRouter(<AccountPage />);
    expect(screen.getByText('My Orders')).toBeInTheDocument();
    expect(screen.getByText('Wishlist')).toBeInTheDocument();
    expect(screen.getByText('Delivery Tracking')).toBeInTheDocument();
    expect(screen.getByText('Account Settings')).toBeInTheDocument();
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Account Settings Manage your profile and preferences/i })).toHaveAttribute('href', '/account/profile');
  });

  it('shows the current customer review empty state', () => {
    renderWithRouter(<AccountPage />);
    expect(screen.getByText('Your Reviews')).toBeInTheDocument();
    expect(screen.getByText('No reviews yet')).toBeInTheDocument();
  });

  it('uses the review-card structure for loading placeholders', () => {
    vi.mocked(useMyReviews).mockReturnValue({ data: undefined, isPending: true, isError: false, refetch: vi.fn() } as unknown as ReturnType<typeof useMyReviews>);
    renderWithRouter(<AccountPage />);
    const loading = screen.getByRole('status', { name: 'Loading your reviews' });
    expect(loading.children).toHaveLength(3);
    for (const card of Array.from(loading.children)) {
      expect(card.className).toContain('reviewProduct');
      expect(card.children).toHaveLength(5);
    }
  });

  it('links reviewed products directly to their Reviews tab', () => {
    vi.mocked(useMyReviews).mockReturnValue({ data: { data: [{
      id: 'review-1', rating: 4, body: 'Excellent display', createdAt: '2026-09-01T00:00:00.000Z',
      author: { displayName: 'John Doe' }, product: { slug: 'tablet-air', name: 'Tablet Air', primaryImage: null },
    }] }, isPending: false, isError: false, refetch: vi.fn() } as unknown as ReturnType<typeof useMyReviews>);
    renderWithRouter(<AccountPage />);
    expect(screen.getByRole('link', { name: /Tablet Air.*4\/5/i })).toHaveAttribute('href', '/products/tablet-air#reviews');
  });

  it('renders Recent Orders empty state', () => {
    renderWithRouter(<AccountPage />);
    expect(screen.getByText('Recent Orders')).toBeInTheDocument();
    expect(screen.getByText('No orders yet')).toBeInTheDocument();
    expect(screen.getByText('Start shopping')).toBeInTheDocument();
  });

  it('opens SignOutModal and calls logout on confirmation', async () => {
    renderWithRouter(<AccountPage />);
    const signOutBtn = screen.getByText('Sign out');
    fireEvent.click(signOutBtn);
    
    // Modal opens, wait for it
    expect(await screen.findByText('Are you sure you want to sign out?')).toBeInTheDocument();
    
    // Click Sign Out inside the modal
    const confirmBtn = screen.getByRole('button', { name: 'Sign Out' });
    fireEvent.click(confirmBtn);
    
    expect(mockLogout).toHaveBeenCalled();
  });
});

