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

  it('syncs the authenticated identity with the server profile after a successful save', async () => {
    render(<MemoryRouter><AdminProfilePage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Grace' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Hopper' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ firstName: 'Grace', lastName: 'Hopper' }));
    await waitFor(() => expect(updateUserNames).toHaveBeenCalledWith('admin-1', { firstName: 'Grace', lastName: 'Hopper' }));
  });
});
