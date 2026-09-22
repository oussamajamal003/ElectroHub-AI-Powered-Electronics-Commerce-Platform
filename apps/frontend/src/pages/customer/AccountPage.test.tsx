/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { AccountPage } from './AccountPage';
import { useAuth } from '@/features/auth/context/AuthContext';

vi.mock('@/features/auth/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

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
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
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

