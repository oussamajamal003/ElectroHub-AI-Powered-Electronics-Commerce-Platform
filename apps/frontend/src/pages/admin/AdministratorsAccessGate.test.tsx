import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError, apiClient } from '@/lib/api';
import { AdministratorsAccessGate } from './AdministratorsAccessGate';
import { AdminAdministratorsPage } from './AdminAdministratorsPage';

vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiClient: vi.fn() }));

type Capabilities = { isOwner: boolean; canManageAdmins: boolean };
const PLAIN: Capabilities = { isOwner: false, canManageAdmins: false };
const MANAGER: Capabilities = { isOwner: false, canManageAdmins: true };
const OWNER: Capabilities = { isOwner: true, canManageAdmins: true };

const team = [
  { id: 'me', email: 'me@example.test', firstName: 'Me', lastName: 'Admin', isActive: true, isOwner: false, canManageAdmins: true, mfaEnrolled: true,
    isSelf: true, lastLoginAt: null, mfaActivation: null, enrollmentAuthorizedUntil: null },
  { id: 'other', email: 'other@example.test', firstName: 'Other', lastName: 'Admin', isActive: true, isOwner: false, canManageAdmins: false,
    mfaEnrolled: true, isSelf: false, lastLoginAt: null, mfaActivation: null, enrollmentAuthorizedUntil: null },
];
const page = <T,>(data: T[]) => ({ data, meta: { page: 1, pageSize: 20, total: data.length, totalPages: 1 } });
const denied = () => new ApiError(403, 'Administrator management access is required.', undefined, 'CAPABILITY_REQUIRED');
const teamRequests = () => vi.mocked(apiClient).mock.calls.map(([endpoint]) => endpoint)
  .filter(endpoint => endpoint.startsWith('/api/admin/administrators') || endpoint.startsWith('/api/admin/invitations'));

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/admin/settings/administrators']}>
      <Routes>
        <Route path="/admin" element={<h1>Dashboard home</h1>} />
        <Route path="/admin/settings/administrators" element={<AdministratorsAccessGate><AdminAdministratorsPage /></AdministratorsAccessGate>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>);
  return client;
}

const MISLEADING = /You can see the administrator team|Only owners can change access/;

beforeEach(() => { vi.clearAllMocks(); });

describe('Administrators page access', () => {
  it('a regular administrator gets the restricted screen and no administrator data is requested', async () => {
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint === '/api/admin/me/profile') return { data: { capabilities: PLAIN } };
      throw new Error(`unexpected request ${endpoint}`);
    });
    renderGate();
    const heading = await screen.findByRole('heading', { level: 1, name: 'Access Restricted' });
    expect(screen.getByText("You don't have permission to view or manage administrator accounts. Contact an Owner if you need access.")).toBeInTheDocument();
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(MISLEADING)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite administrator' })).not.toBeInTheDocument();
    expect(screen.queryByText('Invitations')).not.toBeInTheDocument();
    expect(teamRequests()).toEqual([]);

    const back = screen.getByRole('link', { name: 'Back to Dashboard' });
    expect(back).toHaveAttribute('href', '/admin');
    fireEvent.click(back);
    expect(await screen.findByRole('heading', { name: 'Dashboard home' })).toBeInTheDocument();
  });

  it('shows a neutral loading state, without team requests, until capabilities are known', async () => {
    let resolveProfile!: (value: unknown) => void;
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint === '/api/admin/me/profile') return new Promise(resolve => { resolveProfile = resolve; });
      return page(team);
    });
    renderGate();
    expect(screen.getByRole('status')).toHaveTextContent('Loading page');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Access Restricted' })).not.toBeInTheDocument();
    expect(teamRequests()).toEqual([]);
    await act(async () => { resolveProfile({ data: { capabilities: PLAIN } }); });
    expect(await screen.findByRole('heading', { name: 'Access Restricted' })).toBeInTheDocument();
    expect(teamRequests()).toEqual([]);
  });

  it('an administrator manager gets the normal Administrators page', async () => {
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint === '/api/admin/me/profile') return { data: { capabilities: MANAGER } };
      if (endpoint.startsWith('/api/admin/administrators')) return page(team);
      return page([]);
    });
    renderGate();
    expect(await screen.findByText('other@example.test')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Administrators' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite administrator' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Access Restricted' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /to Owner$/ })).not.toBeInTheDocument();
  });

  it('an Owner gets the full management page', async () => {
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint === '/api/admin/me/profile') return { data: { capabilities: OWNER } };
      if (endpoint.startsWith('/api/admin/administrators')) return page(team);
      return page([]);
    });
    renderGate();
    expect(await screen.findByText('other@example.test')).toBeInTheDocument();
    expect(screen.getByText(/As an owner you can turn access on or off/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Active access for other@example.test' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Promote other@example.test to Owner' })).toBeInTheDocument();
  });

  it('access removed during the session: the server 403 replaces the page with the restricted screen and refreshes capabilities', async () => {
    let capabilities = MANAGER;
    let teamAllowed = true;
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint === '/api/admin/me/profile') return { data: { capabilities } };
      if (!teamAllowed) throw denied();
      if (endpoint.startsWith('/api/admin/administrators')) return page(team);
      return page([]);
    });
    const client = renderGate();
    expect(await screen.findByText('other@example.test')).toBeInTheDocument();
    const profileCalls = () => vi.mocked(apiClient).mock.calls.filter(([endpoint]) => endpoint === '/api/admin/me/profile').length;
    const before = profileCalls();

    capabilities = PLAIN;
    teamAllowed = false;
    await act(async () => { await client.refetchQueries({ queryKey: ['admin', 'team'] }); });
    // The refused request swaps the page out at once, and the capabilities are re-read so the gate (and Settings) agree.
    await waitFor(() => expect(profileCalls()).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Access Restricted' })).toHaveFocus());
    expect(screen.queryByText('other@example.test')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(MISLEADING)).not.toBeInTheDocument();
  });

  it('a network or server failure loading capabilities is an error with retry, not Access Restricted', async () => {
    let fail = true;
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint === '/api/admin/me/profile') {
        if (fail) throw new ApiError(0, 'Unable to connect. Please try again.');
        return { data: { capabilities: MANAGER } };
      }
      if (endpoint.startsWith('/api/admin/administrators')) return page(team);
      return page([]);
    });
    renderGate();
    expect(await screen.findByText('Your administrator permissions could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('You appear to be offline');
    expect(screen.queryByRole('heading', { name: 'Access Restricted' })).not.toBeInTheDocument();
    expect(teamRequests()).toEqual([]);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('other@example.test')).toBeInTheDocument();
  });

  it('a server failure loading the team is an error state, not Access Restricted', async () => {
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint === '/api/admin/me/profile') return { data: { capabilities: MANAGER } };
      if (endpoint.startsWith('/api/admin/administrators')) throw new ApiError(500, 'Something went wrong on our side.');
      return page([]);
    });
    renderGate();
    expect(await screen.findByText('The administrator list could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Access Restricted' })).not.toBeInTheDocument();
  });
});
