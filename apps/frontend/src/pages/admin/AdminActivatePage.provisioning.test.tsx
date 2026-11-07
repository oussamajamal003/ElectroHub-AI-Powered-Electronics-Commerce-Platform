import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminActivatePage } from './AdminActivatePage';
import { useAuth } from '@/features/auth/context/AuthContext';
import { adminAuthApi } from '@/features/admin/security/api';
import { ApiError } from '@/lib/api';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/features/admin/security/api', () => ({
  adminAuthApi: { previewActivation: vi.fn(), redeemActivation: vi.fn(), previewProvisioning: vi.fn(), redeemProvisioning: vi.fn() },
}));
vi.mock('@/features/admin/security/components/AdminEnrollmentFlow', () => ({
  AdminEnrollmentFlow: ({ mfaToken }: { mfaToken: string }) => <div data-testid="enrollment" data-token={mfaToken} />,
}));

const TOKEN = 'operator-issued-token-1234567890';
const account = { email: 'admin1@electrohub.com', firstName: 'Admin1', lastName: 'ElectroHub', expiresAt: '2030-01-01T00:00:00.000Z' };
const STRONG = 'Fresh-Unique-9-Secret';
const renderPage = () => render(<MemoryRouter><AdminActivatePage mode="provisioning" /></MemoryRouter>);
const submit = async () => {
  fireEvent.change(await screen.findByLabelText(/^New password/i), { target: { value: STRONG } });
  fireEvent.change(screen.getByLabelText(/Confirm password/i), { target: { value: STRONG } });
  fireEvent.click(screen.getByRole('button', { name: /Set password and continue/i }));
};

describe('AdminActivatePage — operator seed provisioning mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ completeAdminSession: vi.fn() } as unknown as ReturnType<typeof useAuth>);
    window.history.replaceState(null, '', `/admin/provision#token=${TOKEN}`);
  });

  it('uses only the provisioning endpoints, removes the token and does not claim an email proof', async () => {
    vi.mocked(adminAuthApi.previewProvisioning).mockResolvedValue(account);
    renderPage();
    expect(await screen.findByDisplayValue('admin1@electrohub.com')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Set up your development administrator account' })).toBeInTheDocument();
    expect(screen.getByText(/An operator authorized setup of this development account/)).toBeInTheDocument();
    expect(screen.queryByText(/email/i, { selector: 'p' })).not.toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(adminAuthApi.previewProvisioning).toHaveBeenCalledWith({ token: TOKEN });
    expect(adminAuthApi.previewActivation).not.toHaveBeenCalled();
  });

  it('continues only into the existing MFA enrollment: no session before the authenticator is verified', async () => {
    vi.mocked(adminAuthApi.previewProvisioning).mockResolvedValue(account);
    vi.mocked(adminAuthApi.redeemProvisioning).mockResolvedValue({ requiresMfa: true, mfaToken: 'restricted-challenge', enrollmentRequired: true } as never);
    renderPage();
    await submit();
    expect(await screen.findByTestId('enrollment')).toHaveAttribute('data-token', 'restricted-challenge');
    expect(adminAuthApi.redeemProvisioning).toHaveBeenCalledWith({ token: TOKEN, password: STRONG });
    expect(adminAuthApi.redeemActivation).not.toHaveBeenCalled();
    expect(useAuth().completeAdminSession).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/New password/i)).not.toBeInTheDocument();
  });

  it('an expired, revoked or replayed setup link shows the operator-specific error without a form', async () => {
    vi.mocked(adminAuthApi.previewProvisioning).mockRejectedValue(new ApiError(410, 'gone', undefined, 'PROVISIONING_UNAVAILABLE'));
    renderPage();
    expect(await screen.findByText('This setup link is invalid, expired or already used. Ask the operator who issued it for a new one.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/New password/i)).not.toBeInTheDocument();
  });

  it('a link consumed meanwhile (concurrent redemption) turns into the invalid state', async () => {
    vi.mocked(adminAuthApi.previewProvisioning).mockResolvedValue(account);
    vi.mocked(adminAuthApi.redeemProvisioning).mockRejectedValue(new ApiError(410, 'gone', undefined, 'PROVISIONING_UNAVAILABLE'));
    renderPage();
    await submit();
    expect(await screen.findByText(/setup link is invalid, expired or already used/)).toBeInTheDocument();
  });

  it('a network failure is a retryable error, not "invalid link"', async () => {
    vi.mocked(adminAuthApi.previewProvisioning).mockRejectedValueOnce(new ApiError(0, 'offline')).mockResolvedValueOnce(account);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByDisplayValue('admin1@electrohub.com')).toBeInTheDocument();
  });
});
