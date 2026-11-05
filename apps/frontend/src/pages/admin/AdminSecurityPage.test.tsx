import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminSecurityPage } from './AdminSecurityPage';
import { AdminToastProvider } from '@/features/admin/shared/AdminUi';
import {
  useAdminFactors, useStartTotp, useConfirmTotp, useRemoveTotp, useRegenerateRecoveryCodes, useAddPasskey, useRenamePasskey, useRemovePasskey,
} from '@/features/admin/security/api';
import { ApiError } from '@/lib/api';

vi.mock('@/features/admin/security/api', () => ({
  useAdminFactors: vi.fn(),
  useStartTotp: vi.fn(),
  useConfirmTotp: vi.fn(),
  useRemoveTotp: vi.fn(),
  useRegenerateRecoveryCodes: vi.fn(),
  useAddPasskey: vi.fn(),
  useRenamePasskey: vi.fn(),
  useRemovePasskey: vi.fn(),
}));

const factors = {
  totp: [{ id: 'totp-1', label: 'Work phone', createdAt: '2026-10-01T10:00:00Z', lastUsedAt: null }],
  passkeys: [],
  recoveryCodes: { remaining: 8, generatedAt: '2026-10-01T10:00:00Z' },
};

describe('AdminSecurityPage', () => {
  const removeTotp = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAdminFactors).mockReturnValue({ data: factors, isPending: false, isError: false, isFetching: false, refetch: vi.fn() } as unknown as ReturnType<typeof useAdminFactors>);
    const idle = { mutateAsync: vi.fn(), isPending: false };
    vi.mocked(useStartTotp).mockReturnValue(idle as unknown as ReturnType<typeof useStartTotp>);
    vi.mocked(useConfirmTotp).mockReturnValue(idle as unknown as ReturnType<typeof useConfirmTotp>);
    vi.mocked(useRegenerateRecoveryCodes).mockReturnValue(idle as unknown as ReturnType<typeof useRegenerateRecoveryCodes>);
    vi.mocked(useAddPasskey).mockReturnValue(idle as unknown as ReturnType<typeof useAddPasskey>);
    vi.mocked(useRenamePasskey).mockReturnValue(idle as unknown as ReturnType<typeof useRenamePasskey>);
    vi.mocked(useRemovePasskey).mockReturnValue(idle as unknown as ReturnType<typeof useRemovePasskey>);
    vi.mocked(useRemoveTotp).mockReturnValue({ mutateAsync: removeTotp } as unknown as ReturnType<typeof useRemoveTotp>);
  });

  const renderPage = () => render(<MemoryRouter><AdminToastProvider><AdminSecurityPage /></AdminToastProvider></MemoryRouter>);

  it('lists enrolled authenticator apps and the recovery code count', () => {
    renderPage();

    expect(screen.getByText('Work phone')).toBeInTheDocument();
    expect(screen.getByText(/8 unused codes remaining/i)).toBeInTheDocument();
  });

  it('explains when the last usable sign-in method would be removed', async () => {
    removeTotp.mockRejectedValueOnce(new ApiError(409, 'last factor', undefined, 'LAST_FACTOR'));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove app' }));

    expect(await within(dialog).findByText(/last usable sign-in method/i)).toBeInTheDocument();
    expect(removeTotp).toHaveBeenCalledWith('totp-1');
    await waitFor(() => expect(screen.getByText('Work phone')).toBeInTheDocument());
  });
});
