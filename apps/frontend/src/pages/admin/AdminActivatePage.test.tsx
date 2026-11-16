import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminActivatePage } from './AdminActivatePage';
import { useAdminAuth } from '@/features/auth/context/AuthContext';
import { adminAuthApi } from '@/features/admin/security/api';
import { ApiError } from '@/lib/api';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAdminAuth: vi.fn() }));
vi.mock('@/features/admin/security/api', () => ({
  adminAuthApi: { previewActivation: vi.fn(), redeemActivation: vi.fn() },
}));
// The enrollment step is the existing component, covered by its own tests: here only that it is reached with the restricted challenge.
vi.mock('@/features/admin/security/components/AdminEnrollmentFlow', () => ({
  AdminEnrollmentFlow: ({ mfaToken }: { mfaToken: string }) => <div data-testid="enrollment" data-token={mfaToken} />,
}));

const TOKEN = 'abcdefghijklmnop1234';
const account = { email: 'admin1@example.invalid', firstName: 'Ada', lastName: 'Min', expiresAt: '2030-01-01T00:00:00.000Z' };
const STRONG = 'Fresh-Unique-9-Secret';

const renderPage = () => render(<MemoryRouter><AdminActivatePage /></MemoryRouter>);

describe('AdminActivatePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAdminAuth).mockReturnValue({ completeAdminSession: vi.fn() } as unknown as ReturnType<typeof useAdminAuth>);
    window.history.replaceState(null, '', `/admin/activate#token=${TOKEN}`);
  });

  it('removes the token from the address bar and shows the account the link is for', async () => {
    vi.mocked(adminAuthApi.previewActivation).mockResolvedValue(account);
    renderPage();
    expect(await screen.findByDisplayValue('admin1@example.invalid')).toBeInTheDocument();
    expect(screen.getByText('Ada Min')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(adminAuthApi.previewActivation).toHaveBeenCalledWith({ token: TOKEN });
  });

  it('explains an invalid, expired or used link without offering a form', async () => {
    vi.mocked(adminAuthApi.previewActivation).mockRejectedValue(new ApiError(410, 'gone', undefined, 'ACTIVATION_UNAVAILABLE'));
    renderPage();
    expect(await screen.findByText(/invalid, expired or already used/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/New password/i)).not.toBeInTheDocument();
  });

  it('tells the visitor the link is invalid when no token is present', async () => {
    window.history.replaceState(null, '', '/admin/activate');
    renderPage();
    expect(await screen.findByText(/invalid, expired or already used/i)).toBeInTheDocument();
    expect(adminAuthApi.previewActivation).not.toHaveBeenCalled();
  });

  it('does not submit a weak or mismatched password', async () => {
    vi.mocked(adminAuthApi.previewActivation).mockResolvedValue(account);
    renderPage();
    fireEvent.change(await screen.findByLabelText(/^New password/i), { target: { value: 'weak' } });
    fireEvent.change(screen.getByLabelText(/Confirm password/i), { target: { value: 'different' } });
    fireEvent.click(screen.getByRole('button', { name: /Set password and continue/i }));
    expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument();
    expect(adminAuthApi.redeemActivation).not.toHaveBeenCalled();
  });

  it('redeems with the new password, drops the secrets and continues into the existing MFA enrollment with the restricted challenge', async () => {
    vi.mocked(adminAuthApi.previewActivation).mockResolvedValue(account);
    vi.mocked(adminAuthApi.redeemActivation).mockResolvedValue({ requiresMfa: true, mfaToken: 'restricted-challenge-token-xyz', enrollmentRequired: true } as never);
    renderPage();
    fireEvent.change(await screen.findByLabelText(/^New password/i), { target: { value: STRONG } });
    fireEvent.change(screen.getByLabelText(/Confirm password/i), { target: { value: STRONG } });
    fireEvent.click(screen.getByRole('button', { name: /Set password and continue/i }));
    const enrollment = await screen.findByTestId('enrollment');
    expect(enrollment).toHaveAttribute('data-token', 'restricted-challenge-token-xyz');
    expect(adminAuthApi.redeemActivation).toHaveBeenCalledWith({ token: TOKEN, password: STRONG });
    expect(screen.queryByLabelText(/New password/i)).not.toBeInTheDocument();
    expect(useAdminAuth().completeAdminSession).not.toHaveBeenCalled(); // no session until the authenticator code is verified
  });

  it('shows a reused password as a form error and keeps the link usable', async () => {
    vi.mocked(adminAuthApi.previewActivation).mockResolvedValue(account);
    vi.mocked(adminAuthApi.redeemActivation).mockRejectedValue(new ApiError(422, 'reused', undefined, 'PASSWORD_REUSED'));
    renderPage();
    fireEvent.change(await screen.findByLabelText(/^New password/i), { target: { value: STRONG } });
    fireEvent.change(screen.getByLabelText(/Confirm password/i), { target: { value: STRONG } });
    fireEvent.click(screen.getByRole('button', { name: /Set password and continue/i }));
    await waitFor(() => expect(screen.getByText('Choose a password you have not used before.')).toBeInTheDocument());
    expect(screen.getByLabelText(/^New password/i)).toBeInTheDocument();
  });

  it('turns a consumed link into the invalid state', async () => {
    vi.mocked(adminAuthApi.previewActivation).mockResolvedValue(account);
    vi.mocked(adminAuthApi.redeemActivation).mockRejectedValue(new ApiError(410, 'gone', undefined, 'ACTIVATION_UNAVAILABLE'));
    renderPage();
    fireEvent.change(await screen.findByLabelText(/^New password/i), { target: { value: STRONG } });
    fireEvent.change(screen.getByLabelText(/Confirm password/i), { target: { value: STRONG } });
    fireEvent.click(screen.getByRole('button', { name: /Set password and continue/i }));
    expect(await screen.findByText(/invalid, expired or already used/i)).toBeInTheDocument();
  });
});
