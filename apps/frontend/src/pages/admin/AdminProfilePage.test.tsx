import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminProfilePage } from './AdminProfilePage';
import { useAdminAuth } from '@/features/auth/context/AuthContext';
import { useAdminProfile, useUpdateAdminProfile } from '@/features/admin/security/api';
import { useProfilePhoto, useProfilePhotoMutations } from '@/features/profilePhoto/queries';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAdminAuth: vi.fn() }));
vi.mock('@/features/admin/security/api', () => ({ useAdminProfile: vi.fn(), useUpdateAdminProfile: vi.fn() }));
vi.mock('@/features/profilePhoto/queries', () => ({ useProfilePhoto: vi.fn(), useProfilePhotoMutations: vi.fn() }));

const profile = {
  id: 'admin-1', email: 'admin@example.test', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN', emailVerified: true,
  capabilities: { isOwner: true, canManageAdmins: true },
};
const mutateAsync = vi.fn();
const updateUserNames = vi.fn();

describe('AdminProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAdminAuth).mockReturnValue({ updateUserNames } as unknown as ReturnType<typeof useAdminAuth>);
    vi.mocked(useAdminProfile).mockReturnValue({ data: profile, isPending: false, isError: false } as unknown as ReturnType<typeof useAdminProfile>);
    vi.mocked(useUpdateAdminProfile).mockReturnValue({ mutateAsync, isPending: false } as unknown as ReturnType<typeof useUpdateAdminProfile>);
    vi.mocked(useProfilePhoto).mockReturnValue({ data: { url: null, expiresAt: null }, isError: false } as never);
    vi.mocked(useProfilePhotoMutations).mockReturnValue({
      upload: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false },
    } as never);
    mutateAsync.mockResolvedValue({ ...profile, firstName: 'Grace', lastName: 'Hopper' });
  });

  it('uses profile placeholders for cold loads and preserves resolved data during refetch', () => {
    vi.mocked(useAdminProfile).mockReturnValue({ data: undefined, isPending: true, isError: false } as unknown as ReturnType<typeof useAdminProfile>);
    const view = render(<MemoryRouter><AdminProfilePage /></MemoryRouter>);
    expect(screen.getByRole('status', { name: 'Loading administrator profile' })).toBeVisible();
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
    vi.mocked(useAdminProfile).mockReturnValue({ data: profile, isPending: false, isFetching: true, isError: false } as unknown as ReturnType<typeof useAdminProfile>);
    view.rerender(<MemoryRouter><AdminProfilePage /></MemoryRouter>);
    expect(screen.queryByRole('status', { name: 'Loading administrator profile' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toHaveValue('Ada');
  });

  it('stops loading and offers retry on a profile fetch failure', () => {
    const refetch = vi.fn();
    vi.mocked(useAdminProfile).mockReturnValue({ data: undefined, isPending: false, isError: true, error: new Error('unavailable'), refetch } as unknown as ReturnType<typeof useAdminProfile>);
    render(<MemoryRouter><AdminProfilePage /></MemoryRouter>);
    expect(screen.queryByRole('status', { name: 'Loading administrator profile' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('syncs the authenticated identity with the server profile after a successful save', async () => {
    render(<MemoryRouter><AdminProfilePage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Grace' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Hopper' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ firstName: 'Grace', lastName: 'Hopper' }));
    await waitFor(() => expect(updateUserNames).toHaveBeenCalledWith('admin-1', { firstName: 'Grace', lastName: 'Hopper' }));
  });
});
