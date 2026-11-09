import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminSessionsPage } from './AdminSessionsPage';
import { AdminToastProvider } from '@/features/admin/shared/AdminUi';
import { useAdminAuth } from '@/features/auth/context/AuthContext';
import { useAdminSessions, useAdminLoginHistory, useRevokeSession, useRevokeOtherSessions } from '@/features/admin/security/api';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAdminAuth: vi.fn() }));
vi.mock('@/features/admin/security/api', () => ({
  useAdminSessions: vi.fn(),
  useAdminLoginHistory: vi.fn(),
  useRevokeSession: vi.fn(),
  useRevokeOtherSessions: vi.fn(),
}));

const sessions = {
  data: [
    { id: 's-current', current: true, device: 'Chrome on Windows', ipMasked: '203.0.***.***', createdAt: '2026-11-01T10:00:00Z', lastActiveAt: '2026-11-05T09:00:00Z', mfaMethod: 'TOTP' },
    { id: 's-other', current: false, device: 'Safari on iPhone', ipMasked: null, createdAt: '2026-10-20T10:00:00Z', lastActiveAt: '2026-11-04T09:00:00Z', mfaMethod: 'PASSKEY' },
  ],
  meta: { page: 1, pageSize: 10, total: 2, totalPages: 1 },
};

describe('AdminSessionsPage', () => {
  const revokeOthers = vi.fn();
  const revokeOne = vi.fn();
  const clearSession = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAdminAuth).mockReturnValue({ clearSession } as unknown as ReturnType<typeof useAdminAuth>);
    vi.mocked(useAdminSessions).mockReturnValue({ data: sessions, isPending: false, isError: false, isPlaceholderData: false, isFetching: false, refetch: vi.fn() } as unknown as ReturnType<typeof useAdminSessions>);
    vi.mocked(useAdminLoginHistory).mockReturnValue({ data: { data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } }, isPending: false, isError: false, isPlaceholderData: false, isFetching: false, refetch: vi.fn() } as unknown as ReturnType<typeof useAdminLoginHistory>);
    vi.mocked(useRevokeOtherSessions).mockReturnValue({ mutateAsync: revokeOthers } as unknown as ReturnType<typeof useRevokeOtherSessions>);
    vi.mocked(useRevokeSession).mockReturnValue({ mutateAsync: revokeOne } as unknown as ReturnType<typeof useRevokeSession>);
    revokeOthers.mockResolvedValue(undefined);
    revokeOne.mockResolvedValue(undefined);
  });

  const renderPage = () => render(<MemoryRouter><AdminToastProvider><AdminSessionsPage /></AdminToastProvider></MemoryRouter>);

  it('marks the current session and lists the others', () => {
    renderPage();

    expect(screen.getByText('This session')).toBeInTheDocument();
    expect(screen.getByText('Safari on iPhone')).toBeInTheDocument();
  });

  it('asks for confirmation before signing out other sessions, then revokes them', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out other sessions' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Sign out all other sessions?')).toBeInTheDocument();
    expect(revokeOthers).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign out others' }));

    await waitFor(() => expect(revokeOthers).toHaveBeenCalledTimes(1));
    expect(clearSession).not.toHaveBeenCalled();
  });
});
