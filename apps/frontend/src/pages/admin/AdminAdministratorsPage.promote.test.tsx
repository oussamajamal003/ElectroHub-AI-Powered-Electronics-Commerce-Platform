import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api';
import type { AdministratorSummary } from '@/features/admin/security/api';
import { AdminAdministratorsPage } from './AdminAdministratorsPage';

vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiClient: vi.fn() }));
// Step-up has its own tests; here verification always passes.
vi.mock('@/features/admin/security/useStepUp', async importOriginal => ({
  ...await importOriginal<object>(),
  useStepUp: () => ({ runWithStepUp: <T,>(action: () => Promise<T>) => action(), dialog: null }),
}));

const row = (overrides: Partial<AdministratorSummary>): AdministratorSummary => ({
  id: 'id', email: 'x@example.test', firstName: 'X', lastName: 'Admin', isActive: true, isOwner: false, canManageAdmins: false, mfaEnrolled: true,
  isSelf: false, lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z', mfaActivation: null, enrollmentAuthorizedUntil: null, ...overrides,
} as AdministratorSummary);

const team = [
  row({ id: 'me', email: 'owner@example.test', isOwner: true, canManageAdmins: true, isSelf: true }),
  row({ id: 'eligible', email: 'grace@example.test', firstName: 'Grace' }),
  row({ id: 'factorless', email: 'nofactor@example.test', mfaEnrolled: false }),
  row({ id: 'inactive', email: 'inactive@example.test', isActive: false }),
  row({ id: 'co-owner', email: 'co@example.test', isOwner: true, canManageAdmins: true }),
];

function renderPage(isOwner: boolean, administrators = team) {
  let current = administrators;
  vi.mocked(apiClient).mockImplementation(async (endpoint: string, options?: { method?: string }) => {
    if (endpoint === '/api/admin/me/profile') return { data: { capabilities: { isOwner, canManageAdmins: true } } };
    if (endpoint.startsWith('/api/admin/administrators/eligible/grant-owner') && options?.method === 'POST') {
      current = current.map(item => item.id === 'eligible' ? { ...item, isOwner: true, canManageAdmins: true } : item);
      return { data: { id: 'eligible', isOwner: true, canManageAdmins: true, signInRequired: true } };
    }
    if (endpoint.startsWith('/api/admin/administrators')) return { data: current, meta: { page: 1, pageSize: 20, total: current.length, totalPages: 1 } };
    return { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><AdminAdministratorsPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => { vi.clearAllMocks(); });

describe('Administrators — Promote to Owner', () => {
  it('is offered only to an Owner, only for active, two-step-enrolled non-Owners other than yourself', async () => {
    renderPage(true);
    expect(await screen.findByRole('button', { name: 'Promote grace@example.test to Owner' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /to Owner$/ })).toHaveLength(1);
  });

  it('is not offered to an administrator who is not an Owner', async () => {
    renderPage(false);
    expect(await screen.findByText('grace@example.test')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /to Owner$/ })).toBeNull();
  });

  it('confirms, explains the elevated permissions, then shows the new Owner from fresh server data', async () => {
    renderPage(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Promote grace@example.test to Owner' }));
    const dialog = screen.getByRole('dialog', { name: 'Promote to Owner?' });
    expect(within(dialog).getByText(/becomes an Owner of ElectroHub/)).toBeInTheDocument();
    expect(within(dialog).getByText(/signed out everywhere and must sign in again with two-step verification/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Promote to Owner' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(apiClient).toHaveBeenCalledWith('/api/admin/administrators/eligible/grant-owner', { method: 'POST', data: {} });
    // The list is refetched (namespace invalidation) and the promoted row now carries the Owner pill and no promote action.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Promote grace@example.test to Owner' })).toBeNull());
    const graceRow = screen.getByText('grace@example.test').closest('tr')!;
    expect(within(graceRow).getByText('Owner')).toBeInTheDocument();
  });

  it('shows the server refusal honestly and changes nothing', async () => {
    renderPage(true);
    const button = await screen.findByRole('button', { name: 'Promote grace@example.test to Owner' });
    vi.mocked(apiClient).mockImplementationOnce(async () => { throw new ApiError(409, 'x', undefined, 'SUCCESSOR_MFA_REQUIRED'); });
    fireEvent.click(button);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Promote to Owner' }));
    expect(await screen.findByText(/no longer eligible to become Owner/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
