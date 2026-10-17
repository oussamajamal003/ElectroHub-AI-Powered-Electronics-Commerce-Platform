import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { OrdersPage } from './OrdersPage';
import { useAuth } from '@/features/auth/context/AuthContext';

vi.mock('@/lib/api', () => ({ apiClient: vi.fn() }));
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

  it('waits for authenticated hydration before showing the authoritative empty orders state', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'customer' }, isSessionVerified: true, isInitializing: false, isAuthenticated: true } as ReturnType<typeof useAuth>);
    vi.mocked(apiClient).mockResolvedValue({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><OrdersPage /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole('heading', { level: 1, name: 'My Orders' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading your orders');
    expect(await screen.findByText('You have no orders yet.')).toBeVisible();
    expect(apiClient).toHaveBeenCalledWith('/api/orders?page=1&pageSize=10', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('fails closed when a response has no pagination metadata: orders render, no crash, no pager', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'customer' }, isSessionVerified: true, isInitializing: false, isAuthenticated: true } as ReturnType<typeof useAuth>);
    vi.mocked(apiClient).mockResolvedValue({ data: [{ orderReference: 'ORD-A', createdAt: '2026-10-01T00:00:00.000Z', paymentState: 'PAID', currency: 'USD', total: '58.99', items: [] }] });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><OrdersPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole('heading', { level: 2, name: 'ORD-A' })).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Order history pages' })).not.toBeInTheDocument();
  });

  it('pages through order history ten orders at a time', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'customer' }, isSessionVerified: true, isInitializing: false, isAuthenticated: true } as ReturnType<typeof useAuth>);
    const order = (n: number) => ({ orderReference: `ORD-${n}`, createdAt: '2026-10-01T00:00:00.000Z', paymentState: 'PAID', currency: 'USD', total: '1.00', items: [] });
    vi.mocked(apiClient).mockImplementation(async (url: string) => {
      const page = Number(new URL(url, 'http://local').searchParams.get('page'));
      return { data: [order(page)], meta: { page, pageSize: 10, total: 25, totalPages: 3 } };
    });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><OrdersPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole('heading', { level: 2, name: 'ORD-1' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Order history pages' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to previous page' })).toBeDisabled();
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    expect(screen.getByRole('button', { name: 'Go to page 2' })).toBeEnabled();
    expect(await screen.findByRole('heading', { level: 2, name: 'ORD-2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to page 2' })).toBeEnabled();
    scrollTo.mockRestore();
    expect(apiClient).toHaveBeenLastCalledWith('/api/orders?page=2&pageSize=10', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Go to previous page' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'ORD-1' })).toBeInTheDocument();
  });
});
