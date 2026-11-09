import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query';
import { AdminAuthProvider, useAdminAuth } from './AuthContext';
import { authApi } from '../api/auth';
import { ApiError } from '@/lib/api';
import type { User } from '../types';

vi.mock('../api/auth', () => ({
  authApi: { login: vi.fn(), refreshSession: vi.fn(), getCurrentUser: vi.fn(), logout: vi.fn() },
}));
vi.mock('@/features/cart/context', () => ({ useCart: () => ({ totalQuantity: 0, isLoggingOut: false }) }));

const admin = { id: 'admin-1', email: 'admin@electrohub.example', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN' } as unknown as User;

function Controls() {
  const auth = useAdminAuth();
  return <>
    <button onClick={() => void auth.login({ email: 'admin@electrohub.example', password: 'synthetic-password' }).then(result => {
      (window as unknown as { lastLoginResult?: unknown }).lastLoginResult = result;
    })}>Sign in</button>
    <button onClick={() => auth.completeAdminSession({ accessToken: 'synthetic-access-token', user: admin })}>Complete admin session</button>
    <span data-testid="auth-state">{auth.isAuthenticated ? 'AUTHENTICATED' : 'UNAUTHENTICATED'}</span>
    <span data-testid="auth-identity">{auth.user ? `${auth.user.firstName} ${auth.user.lastName}` : ''}</span>
    <span data-testid="auth-account">{auth.user ? `${auth.user.email} ${auth.user.role}` : ''}</span>
    <span data-testid="remembered-identity">{auth.rememberedUser ? `${auth.rememberedUser.firstName} ${auth.rememberedUser.lastName}` : ''}</span>
    <button onClick={() => auth.updateUserNames('admin-1', { firstName: 'Grace', lastName: 'Hopper' })}>Update profile names</button>
    <button onClick={() => auth.updateUserNames('different-admin', { firstName: 'Wrong', lastName: 'Account' })}>Apply stale profile names</button>
    <button onClick={auth.clearSession}>Clear session</button>
  </>;
}

describe('AuthContext administrator sign-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as { lastLoginResult?: unknown }).lastLoginResult;
    vi.mocked(authApi.refreshSession).mockRejectedValue(new ApiError(401, 'No session'));
    vi.mocked(authApi.logout).mockResolvedValue(undefined);
  });

  const renderProvider = () => render(<QueryClientProvider client={createQueryClient()}><AdminAuthProvider restore><Controls /></AdminAuthProvider></QueryClientProvider>);

  it('does not establish a session when the password step asks for a second factor', async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      requiresMfa: true,
      mfaToken: 'synthetic-mfa-token',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      enrollmentRequired: false,
      factors: { totp: true, passkey: false, recoveryCode: true },
    });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('UNAUTHENTICATED'));

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect((window as unknown as { lastLoginResult?: { requiresMfa?: boolean } }).lastLoginResult?.requiresMfa).toBe(true));
    expect(screen.getByTestId('auth-state')).toHaveTextContent('UNAUTHENTICATED');
  });

  it('establishes the session only through completeAdminSession', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('UNAUTHENTICATED'));

    fireEvent.click(screen.getByRole('button', { name: 'Complete admin session' }));

    expect(await screen.findByText('AUTHENTICATED')).toBeInTheDocument();
  });

  it('updates the authenticated and remembered names after an admin profile save', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('UNAUTHENTICATED'));
    fireEvent.click(screen.getByRole('button', { name: 'Complete admin session' }));
    expect(await screen.findByTestId('auth-identity')).toHaveTextContent('Ada Admin');

    fireEvent.click(screen.getByRole('button', { name: 'Update profile names' }));

    expect(screen.getByTestId('auth-identity')).toHaveTextContent('Grace Hopper');
    expect(screen.getByTestId('remembered-identity')).toHaveTextContent('Grace Hopper');
    expect(screen.getByTestId('auth-account')).toHaveTextContent('admin@electrohub.example ADMIN');
  });

  it('does not restore remembered identity when a profile save completes after logout', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('UNAUTHENTICATED'));
    fireEvent.click(screen.getByRole('button', { name: 'Complete admin session' }));
    expect(await screen.findByTestId('auth-identity')).toHaveTextContent('Ada Admin');

    fireEvent.click(screen.getByRole('button', { name: 'Clear session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update profile names' }));

    expect(screen.getByTestId('auth-state')).toHaveTextContent('UNAUTHENTICATED');
    expect(screen.getByTestId('auth-identity')).toBeEmptyDOMElement();
    expect(screen.getByTestId('remembered-identity')).toBeEmptyDOMElement();
  });

  it('does not apply a saved profile response to a different authenticated account', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('UNAUTHENTICATED'));
    fireEvent.click(screen.getByRole('button', { name: 'Complete admin session' }));
    expect(await screen.findByTestId('auth-identity')).toHaveTextContent('Ada Admin');

    fireEvent.click(screen.getByRole('button', { name: 'Apply stale profile names' }));

    expect(screen.getByTestId('auth-identity')).toHaveTextContent('Ada Admin');
    expect(screen.getByTestId('remembered-identity')).toHaveTextContent('Ada Admin');
  });
});
