import { act, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api';
import { AdminAdministratorsPage } from './AdminAdministratorsPage';

vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiClient: vi.fn() }));

describe('Administrators initial loading', () => {
  it('shows skeleton rows while the profile is pending, then replaces them with the loaded list', async () => {
    let resolveProfile!: (value: unknown) => void;
    const profile = new Promise(resolve => { resolveProfile = resolve; });
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint === '/api/admin/me/profile') return profile;
      return { data: [], meta: { page: 1, totalPages: 1, total: 0, limit: 20 } };
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><MemoryRouter><AdminAdministratorsPage /></MemoryRouter></QueryClientProvider>);
    const loading = screen.getByRole('status', { name: 'Loading administrators' });
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/admin/settings');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(within(loading).getByRole('table')).toBeInTheDocument();
    expect(loading.querySelectorAll('tbody tr')).toHaveLength(4);
    expect(screen.queryByText('No administrators to show')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite administrator' })).not.toBeInTheDocument();

    await act(async () => { resolveProfile({ data: { capabilities: { isOwner: false, canManageAdmins: false } } }); });
    expect(await screen.findByText('No administrators to show')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/admin/settings');
    expect(screen.queryByRole('status', { name: 'Loading administrators' })).not.toBeInTheDocument();
    view.unmount();
    client.clear();
  });
});
