import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/features/auth/context/AuthContext';
import { adminSecurityApi, type AdminProfile } from '../api';
import { StepUpCancelledError } from '../useStepUp';
import { ChangePasswordSection, DangerZoneSection } from './AdminAccountSections';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../api', () => ({ adminSecurityApi: { changePassword: vi.fn(), deleteAccount: vi.fn() } }));
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
    <Routes><Route path="/admin/profile" element={element} /><Route path="/admin/login" element={<SignInProbe />} /></Routes>
  </MemoryRouter>);
}
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  stepUp.cancel = false;
  vi.mocked(useAuth).mockReturnValue({ clearSession } as unknown as ReturnType<typeof useAuth>);
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

  it('explains and blocks deletion for the last active Owner', () => {
    renderAt(<DangerZoneSection profile={{ ...profile, capabilities: { isOwner: true, canManageAdmins: true }, deletion: { allowed: false, reason: 'LAST_OWNER' } }} />);
    expect(screen.getByText('You are the last active Owner. Assign another trusted administrator as Owner before deleting your account.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete My Administrator Account/ })).toBeDisabled();
  });
});

// Keep the cancellation type referenced so the mock factory above stays in sync with the real export.
void StepUpCancelledError;
