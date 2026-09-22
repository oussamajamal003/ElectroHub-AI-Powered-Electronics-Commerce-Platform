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
});
