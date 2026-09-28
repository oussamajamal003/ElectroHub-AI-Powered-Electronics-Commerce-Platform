import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query';
import { AuthProvider, useAuth } from './AuthContext';
import { authApi } from '../api/auth';

vi.mock('../api/auth', () => ({ authApi: { getCurrentUser: vi.fn(), logout: vi.fn() } }));

function Controls() {
  const auth = useAuth();
  return <><button onClick={auth.clearSession}>Clear session</button>
    <button onClick={() => void auth.logout()}>Log out</button>
    <span>{auth.isInitializing ? 'Initializing' : auth.isAuthenticated ? 'Signed in' : 'Signed out'}</span></>;
}

describe('AuthContext query cache boundary', () => {
  beforeEach(() => {
    vi.mocked(authApi.getCurrentUser).mockRejectedValue(new Error('No session'));
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
    vi.mocked(authApi.getCurrentUser).mockResolvedValue({ user: { id: 'customer' } as never });
    const client = createQueryClient();
    client.setQueryData(['account', 'private'], { data: 'private' });
    render(<QueryClientProvider client={client}><AuthProvider><Controls /></AuthProvider></QueryClientProvider>);
    await screen.findByText('Signed in');
    window.dispatchEvent(new Event('electrohub:session-expired'));
    expect(await screen.findByText('Signed out')).toBeInTheDocument();
    expect(client.getQueryData(['account', 'private'])).toBeUndefined();
  });
});
