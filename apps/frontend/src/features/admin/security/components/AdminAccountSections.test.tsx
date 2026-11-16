import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { useAdminAuth } from '@/features/auth/context/AuthContext';
import { adminSecurityApi, useOwnershipSuccessors, type AdminProfile, type OwnershipSuccessor } from '../api';
import { StepUpCancelledError } from '../useStepUp';
import { ChangePasswordSection, DangerZoneSection } from './AdminAccountSections';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAdminAuth: vi.fn() }));
vi.mock('../api', () => ({ adminSecurityApi: { changePassword: vi.fn(), deleteAccount: vi.fn(), transferOwnershipAndDelete: vi.fn() },
  useOwnershipSuccessors: vi.fn() }));
// The real step-up flow (dialog + retry) has its own tests; here each case decides whether verification passes or is cancelled.
const stepUp = vi.hoisted(() => ({ cancel: false }));
vi.mock('../useStepUp', async importOriginal => ({
  ...await importOriginal<object>(),
  useStepUp: () => ({
    runWithStepUp: async <T,>(action: () => Promise<T>) => {
      const { StepUpCancelledError: Cancelled } = await import('../useStepUp');
      if (stepUp.cancel) throw new Cancelled();
      return action();
    },
    dialog: null,
  }),
}));

const clearSession = vi.fn();
const profile: AdminProfile = { id: 'admin-1', email: 'ada@example.test', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN', emailVerified: true,
  capabilities: { isOwner: false, canManageAdmins: true }, deletion: { allowed: true, reason: null } };

function SignInProbe() {
  const location = useLocation();
  return <p data-testid="sign-in">{String((location.state as { notice?: string } | null)?.notice)}</p>;
}
function renderAt(element: React.ReactNode) {
  return render(<MemoryRouter initialEntries={['/admin/profile']}>
    <Routes><Route path="/admin/profile" element={element} /><Route path="/admin/login" element={<SignInProbe />} />
      <Route path="/admin/settings/administrators" element={<p data-testid="administrators">Administrators page</p>} /></Routes>
  </MemoryRouter>);
}
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  stepUp.cancel = false;
  vi.mocked(useAdminAuth).mockReturnValue({ clearSession } as unknown as ReturnType<typeof useAdminAuth>);
});

describe('ChangePasswordSection', () => {
  it('validates live, hides and shows the password, and signs out everywhere after a confirmed change', async () => {
    vi.mocked(adminSecurityApi.changePassword).mockResolvedValue({ changed: true, signInRequired: true });
    renderAt(<ChangePasswordSection />);
    const next = screen.getByLabelText('New password');
    expect(next).toHaveAttribute('type', 'password');
    fireEvent.click(within(next.closest('div')!.parentElement!).getByRole('button', { name: 'Show password' }));
    expect(next).toHaveAttribute('type', 'text');

    fill('New password', 'lowercase1');
    expect(screen.getByText('Add an uppercase letter.')).toBeInTheDocument();
    expect(next).toHaveAttribute('aria-invalid', 'true');
    fill('Current password', 'Old-Pass-1');
    fill('New password', 'New-Pass-2');
    fill('Confirm new password', 'New-Pass-3');
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Update password/ }));
    expect(adminSecurityApi.changePassword).not.toHaveBeenCalled();

    fill('Confirm new password', 'New-Pass-2');
    fireEvent.click(screen.getByRole('button', { name: /Update password/ }));
    await waitFor(() => expect(screen.getByTestId('sign-in')).toHaveTextContent('PASSWORD_CHANGED'));
    expect(adminSecurityApi.changePassword).toHaveBeenCalledTimes(1);
    expect(adminSecurityApi.changePassword).toHaveBeenCalledWith({ currentPassword: 'Old-Pass-1', newPassword: 'New-Pass-2' });
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it('shows the server PASSWORD_REUSED message on the new-password field and keeps the session', async () => {
    vi.mocked(adminSecurityApi.changePassword).mockRejectedValue(new ApiError(422, 'Your new password must be different from your current password.', undefined, 'PASSWORD_REUSED'));
    renderAt(<ChangePasswordSection />);
    fill('Current password', 'Old-Pass-1');
    fill('New password', 'New-Pass-2');
    fill('Confirm new password', 'New-Pass-2');
    fireEvent.click(screen.getByRole('button', { name: /Update password/ }));
    expect(await screen.findByText('Your new password must be different from your current password.')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAttribute('aria-invalid', 'true');
    expect(clearSession).not.toHaveBeenCalled();
  });

  it('keeps the session and shows the server reason when the current password is wrong or verification is cancelled', async () => {
    vi.mocked(adminSecurityApi.changePassword).mockRejectedValue(new ApiError(400, 'Your current password is incorrect.', undefined, 'INVALID_CURRENT_PASSWORD'));
    renderAt(<ChangePasswordSection />);
    fill('Current password', 'Wrong-Pass-1');
    fill('New password', 'New-Pass-2');
    fill('Confirm new password', 'New-Pass-2');
    fireEvent.click(screen.getByRole('button', { name: /Update password/ }));
    expect(await screen.findByText('Your current password is incorrect.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
    expect(clearSession).not.toHaveBeenCalled();

    stepUp.cancel = true;
    fill('Current password', 'Old-Pass-1');
    fireEvent.click(screen.getByRole('button', { name: /Update password/ }));
    expect(await screen.findByText('Your password was not changed. Confirm it is you to continue.')).toBeInTheDocument();
    expect(clearSession).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sign-in')).toBeNull();
  });

  it('cannot be submitted twice while the change is in flight', async () => {
    let finish!: () => void;
    vi.mocked(adminSecurityApi.changePassword).mockReturnValue(new Promise(resolve => { finish = () => resolve({ changed: true, signInRequired: true }); }));
    renderAt(<ChangePasswordSection />);
    fill('Current password', 'Old-Pass-1');
    fill('New password', 'New-Pass-2');
    fill('Confirm new password', 'New-Pass-2');
    const submit = screen.getByRole('button', { name: /Update password/ });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(adminSecurityApi.changePassword).toHaveBeenCalledTimes(1));
    finish();
    await waitFor(() => expect(clearSession).toHaveBeenCalledTimes(1));
  });
});

describe('DangerZoneSection', () => {
  it('needs the password and an exact DELETE, then signs out with a deletion notice only after the server confirms', async () => {
    const user = userEvent.setup();
    vi.mocked(adminSecurityApi.deleteAccount).mockResolvedValue({ deleted: true });
    renderAt(<DangerZoneSection profile={profile} />);
    await user.click(screen.getByRole('button', { name: /Delete My Administrator Account/ }));
    const dialog = screen.getByRole('dialog', { name: /Delete your administrator account/ });
    expect(within(dialog).getByText(/ada@example.test/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Every active session ends immediately/)).toBeInTheDocument();
    const remove = within(dialog).getByRole('button', { name: 'Delete account' });
    expect(remove).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Current password'), 'Old-Pass-1');
    await user.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'delete');
    expect(remove).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('Type DELETE to confirm'));
    await user.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE');
    expect(remove).toBeEnabled();
    fireEvent.click(remove);
    await waitFor(() => expect(screen.getByTestId('sign-in')).toHaveTextContent('ACCOUNT_DELETED'));
    expect(adminSecurityApi.deleteAccount).toHaveBeenCalledWith({ currentPassword: 'Old-Pass-1', confirmation: 'DELETE' });
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it('reports a failed deletion truthfully and keeps the administrator signed in', async () => {
    const user = userEvent.setup();
    vi.mocked(adminSecurityApi.deleteAccount).mockRejectedValue(new ApiError(503, 'Service unavailable', undefined, 'SERVICE_UNAVAILABLE'));
    renderAt(<DangerZoneSection profile={profile} />);
    await user.click(screen.getByRole('button', { name: /Delete My Administrator Account/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Current password'), 'Old-Pass-1');
    await user.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE');
    // Submit with a direct click: user-event's synthesized click does not reach a form's submit inside the Radix dialog in jsdom
    // (the same pattern the other admin dialog tests use); the real browser path is covered by Playwright.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete account' }));
    expect(await within(dialog).findByText('Service unavailable')).toBeInTheDocument();
    expect(clearSession).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sign-in')).toBeNull();
  });

  it('closes on Escape and returns focus to the button that opened it', async () => {
    const user = userEvent.setup();
    renderAt(<DangerZoneSection profile={profile} />);
    const trigger = screen.getByRole('button', { name: /Delete My Administrator Account/ });
    await user.click(trigger);
    await user.type(within(screen.getByRole('dialog')).getByLabelText('Type DELETE to confirm'), 'DEL');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    // Reopening starts clean.
    await user.click(trigger);
    expect(within(screen.getByRole('dialog')).getByLabelText('Type DELETE to confirm')).toHaveValue('');
  });

});

describe('DangerZoneSection — last Owner succession', () => {
  const lastOwner: AdminProfile = { ...profile, capabilities: { isOwner: true, canManageAdmins: true }, deletion: { allowed: false, reason: 'LAST_OWNER' } };
  const grace: OwnershipSuccessor = { id: 'succ-1', firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.test', canManageAdmins: true, mfa: { totp: 1, passkeys: 1 } };
  const linus: OwnershipSuccessor = { id: 'succ-2', firstName: 'Linus', lastName: 'Lee', email: 'linus@example.test', canManageAdmins: false, mfa: { totp: 1, passkeys: 0 } };
  const refetch = vi.fn();
  const successors = (data: OwnershipSuccessor[] | undefined, state: 'success' | 'pending' | 'error' = 'success') =>
    vi.mocked(useOwnershipSuccessors).mockReturnValue({ data, isPending: state === 'pending', isError: state === 'error', isSuccess: state === 'success',
      error: state === 'error' ? new ApiError(500, 'Server error') : null, refetch } as unknown as ReturnType<typeof useOwnershipSuccessors>);

  async function toConfirmStep(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /Transfer Ownership & Delete Account/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /Choose the next Owner/ })).toBeInTheDocument();
    const next = within(dialog).getByRole('button', { name: /Review transfer/ });
    expect(next).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Grace Hopper/ }));
    expect(next).toBeEnabled();
    await user.click(next);
    expect(within(dialog).getByRole('heading', { name: /Review Ownership Transfer/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Continue/ }));
    return dialog;
  }
  const completeForm = (dialog: HTMLElement) => {
    fireEvent.change(within(dialog).getByLabelText('Current password'), { target: { value: 'Owner-Pass-1' } });
    fireEvent.change(within(dialog).getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Grace Hopper becomes the Owner/ }));
  };

  it('replaces the disabled dead end with the transfer action; other Owners keep ordinary deletion', () => {
    successors([grace]);
    const { unmount } = renderAt(<DangerZoneSection profile={lastOwner} />);
    expect(screen.getByText('You are the last active Owner')).toBeInTheDocument();
    expect(screen.getByText(/you must transfer ownership to another active administrator who has completed two-step verification/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Transfer Ownership & Delete Account/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Delete My Administrator Account/ })).toBeNull();
    // Successors are only requested while the wizard is open.
    expect(useOwnershipSuccessors).toHaveBeenLastCalledWith(false);
    unmount();
    renderAt(<DangerZoneSection profile={{ ...lastOwner, deletion: { allowed: true, reason: null } }} />);
    expect(screen.getByRole('button', { name: /Delete My Administrator Account/ })).toBeEnabled();
    expect(screen.queryByText('You are the last active Owner')).toBeNull();
  });

  it('chooses, reviews and confirms; one request transfers and deletes, then the session ends with a truthful notice', async () => {
    successors([grace, linus]);
    vi.mocked(adminSecurityApi.transferOwnershipAndDelete).mockResolvedValue({ deleted: true, ownershipTransferred: true });
    const user = userEvent.setup();
    renderAt(<DangerZoneSection profile={lastOwner} />);
    await user.click(screen.getByRole('button', { name: /Transfer Ownership & Delete Account/ }));
    const card = screen.getByRole('radio', { name: /Grace Hopper/ }).closest('label')!;
    for (const text of ['grace@example.test', 'Active', 'Two-step verification on', 'Can manage administrators', 'Authenticator app · Passkey']) {
      expect(within(card).getByText(text)).toBeInTheDocument();
    }
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const dialog = await toConfirmStep(user);
    expect(within(dialog).getByText(/ada@example\.test/)).toBeInTheDocument();
    const submit = within(dialog).getByRole('button', { name: /Transfer Ownership & Delete My Account/ });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Current password'), { target: { value: 'Owner-Pass-1' } });
    fireEvent.change(within(dialog).getByLabelText('Type DELETE to confirm'), { target: { value: 'delete' } });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } });
    expect(submit).toBeDisabled(); // the successor is not confirmed yet
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Grace Hopper becomes the Owner/ }));
    expect(submit).toBeEnabled();
    fireEvent.submit(submit.closest('form')!);
    await waitFor(() => expect(screen.getByTestId('sign-in')).toHaveTextContent('OWNERSHIP_TRANSFERRED'));
    expect(adminSecurityApi.transferOwnershipAndDelete).toHaveBeenCalledTimes(1);
    expect(adminSecurityApi.transferOwnershipAndDelete).toHaveBeenCalledWith({ successorId: 'succ-1', currentPassword: 'Owner-Pass-1', confirmation: 'DELETE' });
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it('offers useful next steps when no administrator is eligible, without deleting anything', async () => {
    successors([]);
    const user = userEvent.setup();
    renderAt(<DangerZoneSection profile={lastOwner} />);
    await user.click(screen.getByRole('button', { name: /Transfer Ownership & Delete Account/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('No eligible administrator is available')).toBeInTheDocument();
    expect(within(dialog).queryByRole('radio')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Manage Administrators' }));
    await waitFor(() => expect(screen.getByTestId('administrators')).toBeInTheDocument());
    expect(adminSecurityApi.transferOwnershipAndDelete).not.toHaveBeenCalled();
    expect(clearSession).not.toHaveBeenCalled();
  });

  it('searches the eligible list when it is long', async () => {
    const many = Array.from({ length: 5 }, (_, index) => ({ ...linus, id: `id-${index}`, firstName: `Person${index}`, email: `p${index}@example.test` }));
    successors([grace, ...many]);
    const user = userEvent.setup();
    renderAt(<DangerZoneSection profile={lastOwner} />);
    await user.click(screen.getByRole('button', { name: /Transfer Ownership & Delete Account/ }));
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    fireEvent.change(screen.getByLabelText('Search administrators'), { target: { value: 'grace@' } });
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Search administrators'), { target: { value: 'nobody' } });
    expect(screen.getByText(/No administrator matches/)).toBeInTheDocument();
  });

  it('keeps the account and explains honestly when the server refuses or verification is cancelled', async () => {
    successors([grace]);
    const user = userEvent.setup();
    renderAt(<DangerZoneSection profile={lastOwner} />);
    const dialog = await toConfirmStep(user);
    completeForm(dialog);
    const form = within(dialog).getByRole('button', { name: /Transfer Ownership & Delete My Account/ }).closest('form')!;

    vi.mocked(adminSecurityApi.transferOwnershipAndDelete).mockRejectedValueOnce(new ApiError(400, 'Your current password is incorrect.', undefined, 'INVALID_CURRENT_PASSWORD'));
    fireEvent.submit(form);
    expect(await within(dialog).findByText('Your current password is incorrect.')).toBeInTheDocument();

    stepUp.cancel = true;
    fireEvent.submit(form);
    expect(await within(dialog).findByText('Nothing was changed. Confirm it is you to continue.')).toBeInTheDocument();
    stepUp.cancel = false;

    vi.mocked(adminSecurityApi.transferOwnershipAndDelete).mockRejectedValueOnce(new ApiError(409, 'x', undefined, 'OWNER_STATE_CHANGED'));
    fireEvent.submit(form);
    expect(await within(dialog).findByText('Administrator access changed while you were confirming. Review the current information and try again.')).toBeInTheDocument();

    vi.mocked(adminSecurityApi.transferOwnershipAndDelete).mockRejectedValueOnce(new ApiError(409, 'x', undefined, 'SUCCESSOR_MFA_REQUIRED'));
    fireEvent.submit(form);
    expect(await within(dialog).findByText('This administrator is no longer eligible to become Owner. Choose another active administrator with two-step verification enabled.')).toBeInTheDocument();
    expect(clearSession).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sign-in')).toBeNull();
    // Re-selection reloads the current list and starts again from step 1.
    await user.click(within(dialog).getByRole('button', { name: 'Choose another administrator' }));
    expect(refetch).toHaveBeenCalled();
    expect(within(dialog).getByRole('heading', { name: /Choose the next Owner/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Grace Hopper/ })).not.toBeChecked();
  });

  it('offers a retry when the eligible list cannot be loaded', async () => {
    successors(undefined, 'error');
    const user = userEvent.setup();
    renderAt(<DangerZoneSection profile={lastOwner} />);
    await user.click(screen.getByRole('button', { name: /Transfer Ownership & Delete Account/ }));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
  });
});

// Keep the cancellation type referenced so the mock factory above stays in sync with the real export.
void StepUpCancelledError;
