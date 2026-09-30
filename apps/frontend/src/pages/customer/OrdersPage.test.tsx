import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { OrdersPage } from './OrdersPage';
import { useAuth } from '@/features/auth/context/AuthContext';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));

describe('Orders guest boundary', () => {
  it('does not flash the guest card while authentication initializes', () => {
    vi.mocked(useAuth).mockReturnValue({ isInitializing: true, isAuthenticated: false } as ReturnType<typeof useAuth>);
    render(<MemoryRouter><OrdersPage /></MemoryRouter>);
    expect(screen.getByRole('status', { name: 'Checking sign-in status' })).toBeInTheDocument();
    expect(screen.queryByText('Sign In Required')).not.toBeInTheDocument();
  });

  it('shows the sign-in card and opens the existing auth experience', () => {
    vi.mocked(useAuth).mockReturnValue({ isInitializing: false, isAuthenticated: false } as ReturnType<typeof useAuth>);
    const onOpen = vi.fn();
    window.addEventListener('electrohub:open-auth', onOpen, { once: true });
    render(<MemoryRouter><OrdersPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Sign In Required' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('renders the empty orders state immediately when authenticated with zero orders', () => {
    vi.mocked(useAuth).mockReturnValue({ isInitializing: false, isAuthenticated: true } as ReturnType<typeof useAuth>);
    render(<MemoryRouter><OrdersPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'My Orders' })).toBeInTheDocument();
    expect(screen.getByText('Your order history will appear here.')).toBeInTheDocument();
  });
});
