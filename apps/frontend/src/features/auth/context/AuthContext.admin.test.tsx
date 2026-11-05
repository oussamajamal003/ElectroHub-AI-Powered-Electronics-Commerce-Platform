import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query';
import { AuthProvider, useAuth } from './AuthContext';
import { authApi } from '../api/auth';
import { ApiError } from '@/lib/api';
import type { User } from '../types';

vi.mock('../api/auth', () => ({
  authApi: { login: vi.fn(), refreshSession: vi.fn(), getCurrentUser: vi.fn(), logout: vi.fn() },
}));
vi.mock('@/features/cart/context', () => ({ useCart: () => ({ totalQuantity: 0, isLoggingOut: false }) }));

const admin = { id: 'admin-1', email: 'admin@electrohub.example', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN' } as unknown as User;

function Controls() {
  const auth = useAuth();
  return <>
    <button onClick={() => void auth.login({ email: 'admin@electrohub.example', password: 'synthetic-password' }).then(result => {
      (window as unknown as { lastLoginResult?: unknown }).lastLoginResult = result;
    })}>Sign in</button>
    <button onClick={() => auth.completeAdminSession({ accessToken: 'synthetic-access-token', user: admin })}>Complete admin session</button>
    <span data-testid="auth-state">{auth.isAuthenticated ? 'AUTHENTICATED' : 'UNAUTHENTICATED'}</span>
  </>;
}

describe('AuthContext administrator sign-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as { lastLoginResult?: unknown }).lastLoginResult;
    vi.mocked(authApi.refreshSession).mockRejectedValue(new ApiError(401, 'No session'));
    vi.mocked(authApi.logout).mockResolvedValue(undefined);
  });

  const renderProvider = () => render(<QueryClientProvider client={createQueryClient()}><AuthProvider><Controls /></AuthProvider></QueryClientProvider>);

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
});
