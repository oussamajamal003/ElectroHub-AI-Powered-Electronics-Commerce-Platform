/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { useAuth } from '@/features/auth/context/AuthContext';

vi.mock('@/features/auth/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders admin content when authenticated as ADMIN', () => {
    (useAuth as any).mockReturnValue({
      isAuthenticated: true,
      user: { id: 'admin-1', email: 'admin@electrohub.com', role: 'ADMIN' },
      isInitializing: false,
    });

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route element={<ProtectedRoute requiredRole="ADMIN" redirectTo="/admin/login" />}>
            <Route path="/admin" element={<div>Admin Dashboard Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Admin Dashboard Content')).toBeInTheDocument();
  });

  it('denies access and redirects when authenticated as CUSTOMER attempting to access ADMIN route', () => {
    (useAuth as any).mockReturnValue({
      isAuthenticated: true,
      user: { id: 'cust-1', email: 'customer@electrohub.com', role: 'CUSTOMER' },
      isInitializing: false,
    });

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/" element={<div>Home Page Content</div>} />
          <Route element={<ProtectedRoute requiredRole="ADMIN" redirectTo="/admin/login" />}>
            <Route path="/admin" element={<div>Admin Dashboard Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByText('Admin Dashboard Content')).not.toBeInTheDocument();
    expect(screen.getByText('Home Page Content')).toBeInTheDocument();
  });

  it('redirects to login when unauthenticated', () => {
    (useAuth as any).mockReturnValue({
      isAuthenticated: false,
      user: null,
      isInitializing: false,
    });

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin/login" element={<div>Admin Login Page</div>} />
          <Route element={<ProtectedRoute requiredRole="ADMIN" redirectTo="/admin/login" />}>
            <Route path="/admin" element={<div>Admin Dashboard Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByText('Admin Dashboard Content')).not.toBeInTheDocument();
    expect(screen.getByText('Admin Login Page')).toBeInTheDocument();
  });

  it('holds a protected route while a cached identity is still being verified', () => {
    (useAuth as any).mockReturnValue({
      isAuthenticated: false,
      user: null,
      isInitializing: true,
      isSessionVerified: false,
    });
    render(
      <MemoryRouter initialEntries={['/account']}>
        <Routes>
          <Route path="/" element={<div>Home Page Content</div>} />
          <Route element={<ProtectedRoute requiredRole="CUSTOMER" redirectTo="/" />}>
            <Route path="/account" element={<div>Private Account Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Private Account Content')).not.toBeInTheDocument();
    expect(screen.queryByText('Home Page Content')).not.toBeInTheDocument();
  });

  describe('explicit sign-out (Task 03.8)', () => {
    const renderCheckout = () => render(
      <MemoryRouter initialEntries={['/checkout/confirmation/ORD-1']}>
        <Routes>
          <Route path="/" element={<div>Home Page</div>} />
          <Route path="/cart" element={<div>Cart Page</div>} />
          <Route element={<ProtectedRoute requiredRole="CUSTOMER" redirectTo="/cart" requireVerifiedSession preserveReturnPath />}>
            <Route path="/checkout/confirmation/:orderReference" element={<div>Confirmation Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    it('goes to Home, not the checkout fallback, while the customer is signing out', () => {
      (useAuth as any).mockReturnValue({ isAuthenticated: false, user: null, isInitializing: false, isSessionVerified: true, isLoggingOut: true });
      renderCheckout();
      expect(screen.getByText('Home Page')).toBeInTheDocument();
      expect(screen.queryByText('Cart Page')).not.toBeInTheDocument();
      expect(screen.queryByText('Confirmation Content')).not.toBeInTheDocument();
    });

    it('a guest opening the protected URL directly still follows the existing redirect', () => {
      (useAuth as any).mockReturnValue({ isAuthenticated: false, user: null, isInitializing: false, isSessionVerified: true, isLoggingOut: false });
      renderCheckout();
      expect(screen.getByText('Cart Page')).toBeInTheDocument();
    });
  });
});
