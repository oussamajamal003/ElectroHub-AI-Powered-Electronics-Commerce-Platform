import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminForgotPasswordPage } from './AdminForgotPasswordPage';
import { adminRecoveryApi } from '@/features/admin/security/api';
import { ApiError } from '@/lib/api';

vi.mock('@/features/admin/security/api', () => ({
  adminRecoveryApi: { request: vi.fn(), resend: vi.fn(), verifyEmail: vi.fn(), verifySeedProof: vi.fn(), verifyTotp: vi.fn(), verifyRecoveryCode: vi.fn(),
    passkeyOptions: vi.fn(), verifyPasskey: vi.fn(), complete: vi.fn() },
}));
const completeAdminSession = vi.fn();
vi.mock('@/features/auth/context/AuthContext', () => ({ useAdminAuth: () => ({ completeAdminSession }) }));
vi.mock('@simplewebauthn/browser', () => ({ browserSupportsWebAuthn: () => true, startAuthentication: vi.fn() }));

const STRONG = 'Recovered-Unique-7-Pass';
const future = () => new Date(Date.now() + 10 * 60_000).toISOString();
const transaction = (factors = { totp: true, passkey: false, recoveryCode: true }) => ({ recoveryToken: 'recovery-transaction-token-123', expiresAt: future(), factors });

const renderPage = () => render(
  <MemoryRouter initialEntries={['/admin/forgot-password']}>
    <Routes>
      <Route path="/admin/forgot-password" element={<AdminForgotPasswordPage />} />
      <Route path="/admin/login" element={<div>Admin sign in screen</div>} />
      <Route path="/admin" element={<div>Admin dashboard</div>} />
    </Routes>
  </MemoryRouter>,
);

async function toCodeStep() {
  vi.mocked(adminRecoveryApi.request).mockResolvedValue({ message: 'ok' });
  renderPage();
  fireEvent.change(screen.getByLabelText(/Email address/i), { target: { value: 'admin@example.invalid' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send verification code' }));
  await screen.findByRole('heading', { name: 'Verify your email' });
}
async function toMfaStep(factors?: { totp: boolean; passkey: boolean; recoveryCode: boolean }) {
  await toCodeStep();
  vi.mocked(adminRecoveryApi.verifyEmail).mockResolvedValue(transaction(factors));
  fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { name: 'Confirm your identity' });
}

describe('AdminForgotPasswordPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('validates the email and gives the same acknowledgement whatever the address is', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Send verification code' }));
    expect(await screen.findByText('Email address is required.')).toBeInTheDocument();
    expect(adminRecoveryApi.request).not.toHaveBeenCalled();
    vi.mocked(adminRecoveryApi.request).mockResolvedValue({ message: 'ok' });
    fireEvent.change(screen.getByLabelText(/Email address/i), { target: { value: 'nobody@example.invalid' } });
    fireEvent.submit(screen.getByLabelText(/Email address/i).closest('form')!); // Enter submits
    expect(await screen.findByText('If an eligible account exists, verification instructions will be sent shortly.')).toBeInTheDocument();
    expect(adminRecoveryApi.request).toHaveBeenCalledWith({ email: 'nobody@example.invalid' });
  });

  it('accepts a pasted code, rejects a wrong one with the server message, and keeps the user on the step', async () => {
    await toCodeStep();
    const input = screen.getByLabelText('Verification code');
    fireEvent.paste(input, { clipboardData: { getData: () => '12 34 56' } });
    expect(input).toHaveValue('123456');
    vi.mocked(adminRecoveryApi.verifyEmail).mockRejectedValue(new ApiError(400, 'That code is not valid or has expired.', undefined, 'OTP_INVALID'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('That code is not valid or has expired.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Verify your email' })).toBeInTheDocument();
  });

  it('requires an existing factor after the email code and offers only the registered methods', async () => {
    await toMfaStep({ totp: true, passkey: true, recoveryCode: true });
    expect(screen.getByRole('tab', { name: /Authenticator app/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Passkey/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Recovery code/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(/New password/i)).not.toBeInTheDocument();
    expect(screen.getByText("Can't access your verification methods?")).toBeInTheDocument();
  });

  it('shows safe guidance, and no way to continue, when the account has no registered factor', async () => {
    await toMfaStep({ totp: false, passkey: false, recoveryCode: false });
    expect(screen.getByText(/cannot be recovered by email alone/i)).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('completes TOTP → new password → success without ever receiving a session, then returns to sign in', async () => {
    await toMfaStep();
    vi.mocked(adminRecoveryApi.verifyTotp).mockResolvedValue({ resetToken: 'reset-authorization-token-abcdefghijklmnopqrstuv', expiresAt: future() });
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await screen.findByRole('heading', { name: 'Create a new password' });
    expect(adminRecoveryApi.verifyTotp).toHaveBeenCalledWith({ recoveryToken: 'recovery-transaction-token-123', code: '654321' });

    fireEvent.change(screen.getByLabelText(/^New password/i), { target: { value: 'weak' } });
    fireEvent.change(screen.getByLabelText(/Confirm password/i), { target: { value: 'different' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument();
    expect(adminRecoveryApi.complete).not.toHaveBeenCalled();

    vi.mocked(adminRecoveryApi.complete).mockResolvedValue({ message: 'ok', signInRequired: true });
    fireEvent.change(screen.getByLabelText(/^New password/i), { target: { value: STRONG } });
    fireEvent.change(screen.getByLabelText(/Confirm password/i), { target: { value: STRONG } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    await screen.findByRole('heading', { name: 'Password reset successful' });
    expect(adminRecoveryApi.complete).toHaveBeenCalledWith({ resetToken: 'reset-authorization-token-abcdefghijklmnopqrstuv', newPassword: STRONG });
    expect(screen.queryByDisplayValue(STRONG)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Admin Sign In' }));
    expect(await screen.findByText('Admin sign in screen')).toBeInTheDocument();
  });

  it('shows the reuse message and stays on the password step so the same authorization can be retried', async () => {
    await toMfaStep();
    vi.mocked(adminRecoveryApi.verifyTotp).mockResolvedValue({ resetToken: 'reset-authorization-token-abcdefghijklmnopqrstuv', expiresAt: future() });
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await screen.findByRole('heading', { name: 'Create a new password' });
    vi.mocked(adminRecoveryApi.complete).mockRejectedValueOnce(new ApiError(422, 'Your new password must be different from your current password.', undefined, 'PASSWORD_REUSED'));
    fireEvent.change(screen.getByLabelText(/^New password/i), { target: { value: STRONG } });
    fireEvent.change(screen.getByLabelText(/Confirm password/i), { target: { value: STRONG } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByText('Your new password must be different from your current password.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create a new password' })).toBeInTheDocument();
    vi.mocked(adminRecoveryApi.complete).mockResolvedValueOnce({ message: 'ok', signInRequired: true });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    await screen.findByRole('heading', { name: 'Password reset successful' });
  });

  it('goes straight to the dashboard with the backend-issued session, without a second MFA prompt', async () => {
    await toMfaStep();
    vi.mocked(adminRecoveryApi.verifyTotp).mockResolvedValue({ resetToken: 'reset-authorization-token-abcdefghijklmnopqrstuv.TOTP', expiresAt: future() });
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await screen.findByRole('heading', { name: 'Create a new password' });
    const user = { id: 'u1', email: 'admin@example.invalid', role: 'ADMIN' };
    vi.mocked(adminRecoveryApi.complete).mockResolvedValue({ message: 'ok', signInRequired: false, accessToken: 'access-token', user } as never);
    fireEvent.change(screen.getByLabelText(/^New password/i), { target: { value: STRONG } });
    fireEvent.change(screen.getByLabelText(/Confirm password/i), { target: { value: STRONG } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByText('Admin dashboard')).toBeInTheDocument();
    expect(completeAdminSession).toHaveBeenCalledWith({ accessToken: 'access-token', user });
  });

  it('falls back to the sign-in screen path when the backend issues no session', async () => {
    await toMfaStep();
    vi.mocked(adminRecoveryApi.verifyTotp).mockResolvedValue({ resetToken: 'reset-authorization-token-abcdefghijklmnopqrstuv.TOTP', expiresAt: future() });
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await screen.findByRole('heading', { name: 'Create a new password' });
    vi.mocked(adminRecoveryApi.complete).mockResolvedValue({ message: 'ok', signInRequired: true });
    fireEvent.change(screen.getByLabelText(/^New password/i), { target: { value: STRONG } });
    fireEvent.change(screen.getByLabelText(/Confirm password/i), { target: { value: STRONG } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    await screen.findByRole('heading', { name: 'Password reset successful' });
    expect(completeAdminSession).not.toHaveBeenCalled();
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
  });

  it('uses a recovery code for the second proof', async () => {
    await toMfaStep();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Recovery code/ }), { button: 0 }); // Radix tabs activate on mouse down
    vi.mocked(adminRecoveryApi.verifyRecoveryCode).mockResolvedValue({ resetToken: 'reset-authorization-token-abcdefghijklmnopqrstuv', expiresAt: future() });
    fireEvent.change(screen.getByRole('textbox', { name: 'Recovery code' }), { target: { value: 'ABCD-EFGH-IJKL' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await screen.findByRole('heading', { name: 'Create a new password' });
    expect(adminRecoveryApi.verifyRecoveryCode).toHaveBeenCalledWith({ recoveryToken: 'recovery-transaction-token-123', code: 'ABCD-EFGH-IJKL' });
  });

  it('starts a real passkey ceremony from an explicit click and moves on only with its server-verified result', async () => {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    await toMfaStep({ totp: false, passkey: true, recoveryCode: false });
    vi.mocked(adminRecoveryApi.passkeyOptions).mockResolvedValue({ challenge: 'c' } as never);
    vi.mocked(startAuthentication).mockResolvedValue({ id: 'cred' } as never);
    vi.mocked(adminRecoveryApi.verifyPasskey).mockResolvedValue({ resetToken: 'reset-authorization-token-abcdefghijklmnopqrstuv', expiresAt: future() });
    expect(adminRecoveryApi.passkeyOptions).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use passkey' }));
    await screen.findByRole('heading', { name: 'Create a new password' });
    expect(adminRecoveryApi.verifyPasskey).toHaveBeenCalledWith({ recoveryToken: 'recovery-transaction-token-123', response: { id: 'cred' } });
  });

  it('reports a cancelled passkey prompt without advancing', async () => {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    await toMfaStep({ totp: false, passkey: true, recoveryCode: false });
    vi.mocked(adminRecoveryApi.passkeyOptions).mockResolvedValue({ challenge: 'c' } as never);
    vi.mocked(startAuthentication).mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use passkey' }));
    expect(await screen.findByText(/passkey prompt was cancelled/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Confirm your identity' })).toBeInTheDocument();
  });

  it('returns to the start with an explanation when the recovery transaction is gone', async () => {
    await toMfaStep();
    vi.mocked(adminRecoveryApi.verifyTotp).mockRejectedValue(new ApiError(401, 'gone', undefined, 'RECOVERY_CHALLENGE_INVALID'));
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
    expect(await screen.findByText('Your password recovery attempt expired. Start again.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Reset your administrator password' })).toBeInTheDocument());
  });

  it('an operator seed recovery link replaces only the email code: fragment cleared, factor step still required', async () => {
    window.history.replaceState(null, '', '/admin/forgot-password#seed-recovery=operator-proof-token-abcdefghij');
    vi.mocked(adminRecoveryApi.verifySeedProof).mockResolvedValue(transaction());
    renderPage();
    await screen.findByRole('heading', { name: 'Confirm your identity' });
    expect(adminRecoveryApi.verifySeedProof).toHaveBeenCalledTimes(1);
    expect(adminRecoveryApi.verifySeedProof).toHaveBeenCalledWith({ token: 'operator-proof-token-abcdefghij' });
    expect(window.location.hash).toBe('');
    expect(adminRecoveryApi.verifyEmail).not.toHaveBeenCalled();
    expect(adminRecoveryApi.complete).not.toHaveBeenCalled();
  });

  it('an invalid or used seed recovery link shows the server message and stays on the email step', async () => {
    window.history.replaceState(null, '', '/admin/forgot-password#seed-recovery=used-proof-token-abcdefghijk');
    vi.mocked(adminRecoveryApi.verifySeedProof).mockRejectedValue(new ApiError(410, 'This recovery link is invalid, expired or has already been used.'));
    renderPage();
    expect(await screen.findByText('This recovery link is invalid, expired or has already been used.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send verification code' })).toBeInTheDocument();
  });
});
