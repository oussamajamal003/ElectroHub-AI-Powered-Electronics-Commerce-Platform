import { act, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query';
import { AuthProvider, useAuth } from './AuthContext';
import { authApi } from '../api/auth';

vi.mock('../api/auth', () => ({ authApi: { refreshSession: vi.fn(), getCurrentUser: vi.fn(), logout: vi.fn() } }));

const KEY = 'electrohub:cached-user';
const customer = { id: '22222222-2222-4222-8222-222222222222', email: 'a@example.invalid', firstName: 'A', lastName: 'D', role: 'CUSTOMER' };
function Who() { const { user, isAuthenticated } = useAuth(); return <output data-testid="who">{isAuthenticated ? user?.role : 'GUEST'}</output>; }
const storageEvent = (newValue: string | null) => act(() => { window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue, storageArea: localStorage })); });

beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); localStorage.clear();
  vi.mocked(authApi.refreshSession).mockResolvedValue({ accessToken: 'test-token' });
  vi.mocked(authApi.getCurrentUser).mockResolvedValue({ user: customer } as never);
});

describe('single browser identity across tabs', () => {
  it('drops the signed-in state and private cache when another tab signs out', async () => {
    const queryClient = createQueryClient();
    const clear = vi.spyOn(queryClient, 'clear');
    render(<QueryClientProvider client={queryClient}><MemoryRouter><AuthProvider><Who /></AuthProvider></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('CUSTOMER')).toBeInTheDocument();
    storageEvent(null);
    expect(screen.getByTestId('who').textContent).toBe('GUEST');
    expect(clear).toHaveBeenCalled();
  });

  it('ignores unrelated storage keys', async () => {
    render(<QueryClientProvider client={createQueryClient()}><MemoryRouter><AuthProvider><Who /></AuthProvider></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('CUSTOMER')).toBeInTheDocument();
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: null, storageArea: localStorage })); });
    expect(screen.getByTestId('who').textContent).toBe('CUSTOMER');
  });
});
