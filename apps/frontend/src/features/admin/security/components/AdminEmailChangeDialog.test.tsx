import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminEmailChangeDialog } from './AdminEmailChangeDialog';
import { adminSecurityApi } from '../api';
import { useAdminAuth } from '@/features/auth/context/AuthContext';

vi.mock('../api', () => ({
  adminSecurityApi: {
    emailChangeStatus: vi.fn(), requestEmailChange: vi.fn(), verifyEmailChange: vi.fn(), resendEmailChange: vi.fn(), cancelEmailChange: vi.fn(),
  },
}));
vi.mock('../useStepUp', () => ({
  useStepUp: () => ({ runWithStepUp: (action: () => Promise<unknown>) => action(), dialog: null, verifying: false }),
  isStepUpCancelled: () => false,
}));
vi.mock('@/features/auth/context/AuthContext', () => ({ useAdminAuth: vi.fn() }));

const pendingState = {
  pendingEmail: 'new@example.test', expiresAt: '2026-11-08T12:10:00.000Z', otpExpiresAt: '2026-11-08T12:01:00.000Z',
  resendAvailableAt: '2026-11-08T12:01:00.000Z', deliveryStatus: 'ACCEPTED_BY_PROVIDER' as const, attemptsRemaining: 5,
};

describe('AdminEmailChangeDialog', () => {
  const clearSession = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAdminAuth).mockReturnValue({ clearSession } as unknown as ReturnType<typeof useAdminAuth>);
    vi.mocked(adminSecurityApi.emailChangeStatus).mockResolvedValue({ active: false });
    vi.mocked(adminSecurityApi.requestEmailChange).mockResolvedValue(pendingState);
    vi.mocked(adminSecurityApi.verifyEmailChange).mockResolvedValue({ changed: true, email: pendingState.pendingEmail, signedOut: true });
    vi.mocked(adminSecurityApi.cancelEmailChange).mockResolvedValue({ cancelled: true });
  });

  it('submits each semantic form and cancels the pending proof before closing', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AdminEmailChangeDialog currentEmail="admin@example.test" /></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: 'Change Email' }));
    await screen.findByLabelText(/New email/);
    await user.type(screen.getByLabelText(/New email/), 'new@example.test');
    await user.type(screen.getByLabelText(/Current password/), 'Correct-Horse-9-Battery');
    const requestForm = screen.getByLabelText(/New email/).closest('form');
    expect(requestForm?.checkValidity()).toBe(true);
    fireEvent.submit(requestForm!);

    await waitFor(() => expect(adminSecurityApi.requestEmailChange).toHaveBeenCalledWith({ newEmail: 'new@example.test', currentPassword: 'Correct-Horse-9-Battery' }));
    await screen.findByText('Verify your new email');
    await user.type(screen.getByLabelText(/6-digit verification code/), '123456');
    fireEvent.submit(screen.getByLabelText(/6-digit verification code/).closest('form')!);

    await waitFor(() => expect(adminSecurityApi.verifyEmailChange).toHaveBeenCalledWith({ code: '123456' }));
    expect(await screen.findByText('Email changed successfully')).toBeInTheDocument();
    expect(clearSession).not.toHaveBeenCalled(); // Authentication state is cleared only at the sign-in redirect.
  });

  it('cancels a pending email proof before closing the dialog', async () => {
    const user = userEvent.setup();
    vi.mocked(adminSecurityApi.emailChangeStatus).mockResolvedValue({ active: true, ...pendingState });
    render(<MemoryRouter><AdminEmailChangeDialog currentEmail="admin@example.test" /></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: 'Change Email' }));
    await screen.findByText('Verify your new email');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(adminSecurityApi.cancelEmailChange).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
