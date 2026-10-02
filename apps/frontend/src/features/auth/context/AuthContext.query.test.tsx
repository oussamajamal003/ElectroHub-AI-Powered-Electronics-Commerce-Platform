import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query';
import { AuthProvider, useAuth } from './AuthContext';
import { authApi } from '../api/auth';
import { ApiError } from '@/lib/api';
import { CustomerHeader } from '@/components/layout/CustomerHeader/CustomerHeader';

vi.mock('../api/auth', () => ({ authApi: { refreshSession: vi.fn(), getCurrentUser: vi.fn(), logout: vi.fn() } }));
vi.mock('@/features/cart/context', () => ({ useCart: () => ({ totalQuantity: 0, isLoggingOut: false }) }));

function Controls() {
  const auth = useAuth();
  return <><button onClick={auth.clearSession}>Clear session</button>
    <button onClick={() => void auth.logout()}>Log out</button>
    <span>{auth.isInitializing ? 'Initializing' : auth.isAuthenticated ? 'Signed in' : 'Signed out'}</span>
    <span>{auth.rememberedUser ? `Remembered ${auth.rememberedUser.firstName}` : 'No remembered user'}</span></>;
}

describe('AuthContext query cache boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(authApi.refreshSession).mockRejectedValue(new ApiError(401, 'No session'));
    vi.mocked(authApi.logout).mockResolvedValue(undefined);
  });

  it.each(['Clear session', 'Log out'])('clears cached user data on %s', async action => {
    const client = createQueryClient();
    client.setQueryData(['account', 'private'], { email: 'private@example.com' });
    render(<QueryClientProvider client={client}><AuthProvider><Controls /></AuthProvider></QueryClientProvider>);
    await screen.findByText('Signed out');
    fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(client.getQueryData(['account', 'private'])).toBeUndefined());
  });
  it('clears authenticated state and private cache after refresh expiration', async () => {
    vi.mocked(authApi.refreshSession).mockResolvedValue({ accessToken: 'valid' });
    vi.mocked(authApi.getCurrentUser).mockResolvedValue({ user: { id: 'customer' } as never });
    const client = createQueryClient();
    client.setQueryData(['account', 'private'], { data: 'private' });
    render(<QueryClientProvider client={client}><AuthProvider><Controls /></AuthProvider></QueryClientProvider>);
    await screen.findByText('Signed in');
    window.dispatchEvent(new Event('electrohub:session-expired'));
    expect(await screen.findByText('Signed out')).toBeInTheDocument();
    expect(client.getQueryData(['account', 'private'])).toBeUndefined();
  });
  it('shares rotating refresh across StrictMode remounts and restores the valid user', async () => {
    vi.mocked(authApi.refreshSession).mockResolvedValue({ accessToken: 'valid' });
    vi.mocked(authApi.getCurrentUser).mockResolvedValue({ user: { id: 'customer' } as never });
    render(<StrictMode><QueryClientProvider client={createQueryClient()}><AuthProvider><Controls /></AuthProvider></QueryClientProvider></StrictMode>);
    expect(await screen.findByText('Signed in')).toBeInTheDocument();
    expect(authApi.refreshSession).toHaveBeenCalledTimes(1);
  });
  it('keeps auth unknown after a transient refresh failure', async () => {
    vi.mocked(authApi.refreshSession).mockRejectedValue(new ApiError(503, 'Unavailable'));
    render(<QueryClientProvider client={createQueryClient()}><AuthProvider><Controls /></AuthProvider></QueryClientProvider>);
    await waitFor(() => expect(authApi.refreshSession).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Initializing')).toBeInTheDocument();
    expect(screen.queryByText('Signed out')).not.toBeInTheDocument();
  });

  it('retains the remembered header identity while a valid session restores', async () => {
    sessionStorage.setItem('electrohub:header-identity', JSON.stringify({ firstName: 'John', lastName: 'Doe' }));
    let resolveRefresh!: (value: { accessToken: string }) => void;
    vi.mocked(authApi.refreshSession).mockReturnValue(new Promise(resolve => { resolveRefresh = resolve; }));
    vi.mocked(authApi.getCurrentUser).mockResolvedValue({ user: { id: 'customer', firstName: 'John', lastName: 'Doe', email: 'john@example.com', role: 'CUSTOMER' } });
    render(<QueryClientProvider client={createQueryClient()}><AuthProvider><Controls /></AuthProvider></QueryClientProvider>);
    expect(screen.getByText('Initializing')).toBeInTheDocument();
    expect(screen.getByText('Remembered John')).toBeInTheDocument();
    resolveRefresh({ accessToken: 'valid' });
    expect(await screen.findByText('Signed in')).toBeInTheDocument();
    expect(screen.getByText('Remembered John')).toBeInTheDocument();
  });

  it('keeps Orders and the profile avatar mounted through a successful refresh', async () => {
    sessionStorage.setItem('electrohub:header-identity', JSON.stringify({ firstName: 'John', lastName: 'Doe' }));
    let resolveRefresh!: (value: { accessToken: string }) => void;
    vi.mocked(authApi.refreshSession).mockReturnValue(new Promise(resolve => { resolveRefresh = resolve; }));
    vi.mocked(authApi.getCurrentUser).mockResolvedValue({ user: { id: 'customer', firstName: 'John', lastName: 'Doe', email: 'john@example.com', role: 'CUSTOMER' } });
    render(<QueryClientProvider client={createQueryClient()}><AuthProvider><MemoryRouter><CustomerHeader /></MemoryRouter></AuthProvider></QueryClientProvider>);
    const orders = screen.getByRole('link', { name: 'Orders' });
    const profile = screen.getByRole('button', { name: 'Account menu for John Doe' });
    expect(profile).toBeDisabled();
    resolveRefresh({ accessToken: 'valid' });
    await waitFor(() => expect(profile).not.toBeDisabled());
    expect(screen.getByRole('link', { name: 'Orders' })).toBe(orders);
    expect(screen.getByRole('button', { name: 'Account menu for John Doe' })).toBe(profile);
    expect(screen.queryByRole('button', { name: 'Account' })).not.toBeInTheDocument();
  });

  it('clears the header identity only when the restored session is confirmed invalid', async () => {
    sessionStorage.setItem('electrohub:header-identity', JSON.stringify({ firstName: 'John', lastName: 'Doe' }));
    render(<QueryClientProvider client={createQueryClient()}><AuthProvider><Controls /></AuthProvider></QueryClientProvider>);
    expect(screen.getByText('Remembered John')).toBeInTheDocument();
    expect(await screen.findByText('Signed out')).toBeInTheDocument();
    expect(screen.getByText('No remembered user')).toBeInTheDocument();
    expect(sessionStorage.getItem('electrohub:header-identity')).toBeNull();
  });
});
