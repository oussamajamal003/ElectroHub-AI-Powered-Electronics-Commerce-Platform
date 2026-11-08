import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query';
import { ApiError, getAccessToken, setAccessToken } from '@/lib/api';
import { AdminAuthProvider, AuthProvider, useAdminAuth, useAuth } from './AuthContext';
import { authApi } from '../api/auth';
import type { User } from '../types';

vi.mock('../api/auth', () => ({ authApi: { login: vi.fn(), refreshSession: vi.fn(), getCurrentUser: vi.fn(), logout: vi.fn() } }));

const admin = { id: 'admin-1', email: 'admin@example.invalid', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN' } as User;
const customer = { id: 'cust-1', email: 'cust@example.invalid', firstName: 'Cora', lastName: 'Customer', role: 'CUSTOMER' } as User;
const ADMIN_KEY = 'electrohub:admin:cached-user';
const CUSTOMER_KEY = 'electrohub:cached-user';

function Probe() {
  const storefront = useAuth();
  const console_ = useAdminAuth();
  return <>
    <output data-testid="storefront">{storefront.isInitializing ? 'INIT' : storefront.isAuthenticated ? storefront.user?.email : 'GUEST'}</output>
    <output data-testid="console">{console_.isInitializing ? 'INIT' : console_.isAuthenticated ? console_.user?.email : 'GUEST'}</output>
    <button onClick={() => void console_.logout()}>admin logout</button>
    <button onClick={() => void storefront.logout()}>customer logout</button>
  </>;
}

function mount(adminClient = createQueryClient(), customerClient = createQueryClient(), restoreAdmin = true) {
  render(<QueryClientProvider client={customerClient}><MemoryRouter>
    <AuthProvider><AdminAuthProvider queryClient={adminClient} restore={restoreAdmin}><Probe /></AdminAuthProvider></AuthProvider>
  </MemoryRouter></QueryClientProvider>);
  return { adminClient, customerClient };
}

/** Each scope's refresh answers independently, keyed by the scope the provider asked for. */
function sessions(answers: { admin?: User | null; customer?: User | null }) {
  vi.mocked(authApi.refreshSession).mockImplementation(async scope => {
    const user = answers[scope ?? 'customer'];
    if (!user) throw new ApiError(401, 'No session');
    return { accessToken: `${scope}-token`, user };
  });
}

beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); localStorage.clear(); setAccessToken(null, 'admin'); setAccessToken(null, 'customer');
  vi.mocked(authApi.logout).mockResolvedValue(undefined);
});

describe('ADMIN and CUSTOMER sessions coexist in one browser', () => {
  it('an administrator-only browser leaves the storefront in guest mode', async () => {
    sessions({ admin, customer: null });
    localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
    mount();
    await waitFor(() => expect(screen.getByTestId('console')).toHaveTextContent('admin@example.invalid'));
    await waitFor(() => expect(screen.getByTestId('storefront')).toHaveTextContent('GUEST'));
  });

  it('a pre-isolation administrator hint stored under the shared key is never shown as the customer, and is discarded', async () => {
    sessions({ admin: null, customer: null });
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(admin));
    mount();
    expect(screen.getByTestId('storefront')).not.toHaveTextContent('admin@example.invalid');
    await waitFor(() => expect(screen.getByTestId('storefront')).toHaveTextContent('GUEST'));
    expect(localStorage.getItem(CUSTOMER_KEY)).toBeNull();
  });

  it('a pre-isolation administrator name in the shared header-identity key never greets the storefront', async () => {
    sessions({ admin: null, customer: null });
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(admin));
    localStorage.setItem('electrohub:header-identity', JSON.stringify({ firstName: 'Ada', lastName: 'Admin' }));
    function Greeting() { const { rememberedUser } = useAuth(); return <output data-testid="greeting">{rememberedUser ? rememberedUser.firstName : 'nobody'}</output>; }
    render(<QueryClientProvider client={createQueryClient()}><MemoryRouter><AuthProvider><Greeting /></AuthProvider></MemoryRouter></QueryClientProvider>);
    expect(screen.getByTestId('greeting')).toHaveTextContent('nobody');
    expect(localStorage.getItem('electrohub:header-identity')).toBeNull();
  });

  it('restores both sessions independently, each through its own scope', async () => {
    sessions({ admin, customer });
    localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
    mount();
    await waitFor(() => expect(screen.getByTestId('console')).toHaveTextContent('admin@example.invalid'));
    await waitFor(() => expect(screen.getByTestId('storefront')).toHaveTextContent('cust@example.invalid'));
    expect(vi.mocked(authApi.refreshSession).mock.calls.map(call => call[0]).sort()).toEqual(['admin', 'customer']);
  });

  it('one scope failing to restore does not sign the other out', async () => {
    sessions({ admin: null, customer });
    localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
    mount();
    await waitFor(() => expect(screen.getByTestId('console')).toHaveTextContent('GUEST'));
    expect(screen.getByTestId('storefront')).toHaveTextContent('cust@example.invalid');
  });

  it('a scope refuses an identity of the other role even if the server returned one', async () => {
    sessions({ admin: customer, customer: admin });
    localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
    mount();
    await waitFor(() => expect(screen.getByTestId('console')).toHaveTextContent('GUEST'));
    await waitFor(() => expect(screen.getByTestId('storefront')).toHaveTextContent('GUEST'));
    expect(getAccessToken('admin')).toBeNull();
    expect(getAccessToken('customer')).toBeNull();
  });

  it('does not call the administrator refresh at all for an ordinary storefront visit', async () => {
    sessions({ admin, customer });
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
    mount(createQueryClient(), createQueryClient(), false);
    await waitFor(() => expect(screen.getByTestId('storefront')).toHaveTextContent('cust@example.invalid'));
    expect(vi.mocked(authApi.refreshSession).mock.calls.map(call => call[0])).toEqual(['customer']);
    expect(screen.getByTestId('console')).toHaveTextContent('GUEST');
  });

  it('administrator sign-out revokes only the administrator scope, clears only its cache, and keeps the customer signed in', async () => {
    sessions({ admin, customer });
    localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
    const { adminClient, customerClient } = mount();
    adminClient.setQueryData(['admin', 'dashboard'], { secret: 1 });
    customerClient.setQueryData(['orders'], { mine: 1 });
    await waitFor(() => expect(screen.getByTestId('storefront')).toHaveTextContent('cust@example.invalid'));
    await waitFor(() => expect(screen.getByTestId('console')).toHaveTextContent('admin@example.invalid'));
    setAccessToken('customer-token', 'customer');

    fireEvent.click(screen.getByRole('button', { name: 'admin logout' }));

    await waitFor(() => expect(screen.getByTestId('console')).toHaveTextContent('GUEST'));
    expect(authApi.logout).toHaveBeenCalledWith('admin');
    expect(authApi.logout).not.toHaveBeenCalledWith('customer');
    expect(screen.getByTestId('storefront')).toHaveTextContent('cust@example.invalid');
    expect(adminClient.getQueryData(['admin', 'dashboard'])).toBeUndefined();
    expect(customerClient.getQueryData(['orders'])).toEqual({ mine: 1 });
    expect(localStorage.getItem(ADMIN_KEY)).toBeNull();
    expect(localStorage.getItem(CUSTOMER_KEY)).not.toBeNull();
    expect(getAccessToken('customer')).toBe('customer-token');
  });

  it('customer sign-out revokes only the customer scope and keeps the administrator signed in', async () => {
    sessions({ admin, customer });
    localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
    const { adminClient, customerClient } = mount();
    adminClient.setQueryData(['admin', 'dashboard'], { secret: 1 });
    customerClient.setQueryData(['orders'], { mine: 1 });
    await waitFor(() => expect(screen.getByTestId('storefront')).toHaveTextContent('cust@example.invalid'));
    await waitFor(() => expect(screen.getByTestId('console')).toHaveTextContent('admin@example.invalid'));
    setAccessToken('admin-token', 'admin');

    fireEvent.click(screen.getByRole('button', { name: 'customer logout' }));

    await waitFor(() => expect(screen.getByTestId('storefront')).toHaveTextContent('GUEST'));
    expect(authApi.logout).toHaveBeenCalledWith('customer');
    expect(authApi.logout).not.toHaveBeenCalledWith('admin');
    expect(screen.getByTestId('console')).toHaveTextContent('admin@example.invalid');
    expect(customerClient.getQueryData(['orders'])).toBeUndefined();
    expect(adminClient.getQueryData(['admin', 'dashboard'])).toEqual({ secret: 1 });
    expect(getAccessToken('admin')).toBe('admin-token');
  });

  it('an administrator session expiry ends only the administrator session', async () => {
    sessions({ admin, customer });
    localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
    mount();
    await waitFor(() => expect(screen.getByTestId('console')).toHaveTextContent('admin@example.invalid'));
    await waitFor(() => expect(screen.getByTestId('storefront')).toHaveTextContent('cust@example.invalid'));

    act(() => { window.dispatchEvent(new CustomEvent('electrohub:session-expired', { detail: { scope: 'admin' } })); });

    expect(screen.getByTestId('console')).toHaveTextContent('GUEST');
    expect(screen.getByTestId('storefront')).toHaveTextContent('cust@example.invalid');
  });

  it('a customer session expiry ends only the customer session', async () => {
    sessions({ admin, customer });
    localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
    mount();
    await waitFor(() => expect(screen.getByTestId('console')).toHaveTextContent('admin@example.invalid'));
    await waitFor(() => expect(screen.getByTestId('storefront')).toHaveTextContent('cust@example.invalid'));

    act(() => { window.dispatchEvent(new CustomEvent('electrohub:session-expired', { detail: { scope: 'customer' } })); });

    expect(screen.getByTestId('storefront')).toHaveTextContent('GUEST');
    expect(screen.getByTestId('console')).toHaveTextContent('admin@example.invalid');
  });

  it('cross-tab sign-out of one scope is observed only by that scope', async () => {
    sessions({ admin, customer });
    localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
    mount();
    await waitFor(() => expect(screen.getByTestId('console')).toHaveTextContent('admin@example.invalid'));
    await waitFor(() => expect(screen.getByTestId('storefront')).toHaveTextContent('cust@example.invalid'));

    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: ADMIN_KEY, newValue: null, storageArea: localStorage })); });

    expect(screen.getByTestId('console')).toHaveTextContent('GUEST');
    expect(screen.getByTestId('storefront')).toHaveTextContent('cust@example.invalid');

    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: CUSTOMER_KEY, newValue: null, storageArea: localStorage })); });
    expect(screen.getByTestId('storefront')).toHaveTextContent('GUEST');
  });

  it('customer credentials typed into the administrator sign-in establish nothing and leave no storefront session behind', async () => {
    sessions({ admin: null, customer: null });
    vi.mocked(authApi.login).mockResolvedValue({ accessToken: 'customer-token', user: customer } as never);
    function AdminDoor() { const door = useAdminAuth(); return <button onClick={() => void door.login({ email: 'c@example.invalid', password: 'x' })}>try</button>; }
    render(<QueryClientProvider client={createQueryClient()}><MemoryRouter><AuthProvider>
      <AdminAuthProvider restore={false}><AdminDoor /><Probe /></AdminAuthProvider></AuthProvider></MemoryRouter></QueryClientProvider>);
    fireEvent.click(screen.getByText('try'));
    await waitFor(() => expect(authApi.logout).toHaveBeenCalledWith('customer'));
    expect(screen.getAllByTestId('console')[0]).toHaveTextContent('GUEST');
    expect(screen.getAllByTestId('storefront')[0]).toHaveTextContent('GUEST');
  });
});
