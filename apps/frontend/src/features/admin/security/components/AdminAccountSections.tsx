import { useRef, useState, type ChangeEvent, type FormEvent, type RefObject } from 'react';
import { AlertTriangle, KeyRound, Trash2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput/PasswordInput';
import { ApiError } from '@/lib/api';
import { fieldErrors as serverFieldErrors } from '@/features/admin/shared/api';
import { adminSecurityApi, type AdminProfile } from '../api';
import { STRONG_PASSWORD, passwordHint } from '../passwordPolicy';
import { isStepUpCancelled, useStepUp } from '../useStepUp';
import { failureMessage, useEndAdminSession } from '../endAdminSession';
import { OwnershipTransferDialog } from './OwnershipTransferDialog';
import pageStyles from '@/features/admin/shared/AdminPages.module.scss';

export { SIGN_IN_NOTICE_KEY, type AdminSignInNotice } from '../endAdminSession';

type PasswordField = 'currentPassword' | 'newPassword' | 'confirmPassword';

export function ChangePasswordSection() {
  const endSession = useEndAdminSession();
  const { runWithStepUp, dialog: stepUpDialog } = useStepUp();
  const [values, setValues] = useState<Record<PasswordField, string>>({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [touched, setTouched] = useState<Partial<Record<PasswordField, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<Partial<Record<PasswordField, string>>>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);

  const hint = passwordHint(values.newPassword);
  const problems: Partial<Record<PasswordField, string>> = {};
  if (!values.currentPassword) problems.currentPassword = 'Enter your current password.';
  if (hint !== STRONG_PASSWORD) problems.newPassword = hint;
  else if (values.newPassword === values.currentPassword) problems.newPassword = 'Choose a new password that is different from your current one.';
  if (!values.confirmPassword) problems.confirmPassword = 'Confirm your new password.';
  else if (values.confirmPassword !== values.newPassword) problems.confirmPassword = 'The passwords do not match.';
  const errorFor = (field: PasswordField) => serverErrors[field] ?? (touched[field] ? problems[field] : undefined);

  const edit = (field: PasswordField) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setValues(current => ({ ...current, [field]: value }));
    setTouched(current => current[field] ? current : { ...current, [field]: true });
    setServerErrors(current => { const next = { ...current }; delete next[field]; return next; });
    setFormError('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setTouched({ currentPassword: true, newPassword: true, confirmPassword: true });
    if (Object.keys(problems).length) return;
    setPending(true);
    setFormError('');
    try {
      await runWithStepUp(() => adminSecurityApi.changePassword({ currentPassword: values.currentPassword, newPassword: values.newPassword }));
      // Every session, this one included, has ended on the server.
      endSession('PASSWORD_CHANGED');
      return;
    } catch (error) {
      if (isStepUpCancelled(error)) setFormError('Your password was not changed. Confirm it is you to continue.');
      else if (error instanceof ApiError && error.code === 'INVALID_CURRENT_PASSWORD') setServerErrors({ currentPassword: error.message });
      else if (error instanceof ApiError && error.code === 'PASSWORD_UNCHANGED') setServerErrors({ newPassword: error.message });
      else {
        const fields = serverFieldErrors(error) as Partial<Record<PasswordField, string>>;
        setServerErrors(fields);
        if (!Object.keys(fields).length) setFormError(failureMessage(error, 'Your password could not be changed. Try again.'));
      }
    }
    setPending(false);
  };

  return <section className={pageStyles.panel} aria-labelledby="profile-password-title">
    <div className={pageStyles.panelHeader}>
      <h2 id="profile-password-title" className={pageStyles.panelTitle}>Change password</h2>
    </div>
    <p className={pageStyles.panelHint}>You will confirm it is you, then every session ends, including this one. Sign in again with your new password and two-step verification.</p>
    {formError && <Alert variant="error">{formError}</Alert>}
    <form className={pageStyles.form} onSubmit={submit} noValidate aria-busy={pending || undefined}>
      <PasswordInput id="admin-current-password" name="currentPassword" label="Current password" autoComplete="current-password" value={values.currentPassword}
        onChange={edit('currentPassword')} error={errorFor('currentPassword')} fullWidth disabled={pending} />
      <PasswordInput id="admin-new-password" name="newPassword" label="New password" autoComplete="new-password" value={values.newPassword}
        onChange={edit('newPassword')} error={errorFor('newPassword')} helperText={hint} fullWidth disabled={pending} />
      <PasswordInput id="admin-confirm-password" name="confirmPassword" label="Confirm new password" autoComplete="new-password" value={values.confirmPassword}
        onChange={edit('confirmPassword')} error={errorFor('confirmPassword')} fullWidth disabled={pending} />
      <div className={`${pageStyles.formActions} ${pageStyles.formActionsStatic}`}>
        <Button type="submit" isLoading={pending}><KeyRound aria-hidden="true" /> Update password</Button>
      </div>
    </form>
    {stepUpDialog}
  </section>;
}

export function DangerZoneSection({ profile }: { profile: AdminProfile }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // Advisory only (the server re-checks under the owner lock): the last active Owner leaves through the succession wizard instead.
  const lastOwner = profile.deletion?.reason === 'LAST_OWNER';
  return <section className={`${pageStyles.panel} ${pageStyles.dangerPanel}`} aria-labelledby="profile-danger-title">
    <div className={pageStyles.panelHeader}>
      <h2 id="profile-danger-title" className={`${pageStyles.panelTitle} ${pageStyles.dangerTitle}`}>Danger Zone</h2>
    </div>
    <p className={pageStyles.panelHint}>Permanently remove access to your administrator account. This action requires additional verification and cannot be undone.</p>
    {lastOwner && <Alert variant="warning">
      <AlertTitle>You are the last active Owner</AlertTitle>
      <AlertDescription>Before deleting your administrator account, you must transfer ownership to another active administrator who has completed two-step verification.</AlertDescription>
    </Alert>}
    <div className={pageStyles.actionsStart}>
      <Button ref={trigger} type="button" variant="destructive" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden="true" /> {lastOwner ? 'Transfer Ownership & Delete Account' : 'Delete My Administrator Account'}</Button>
    </div>
    {lastOwner
      ? <OwnershipTransferDialog profile={profile} open={open} onOpenChange={setOpen} returnFocus={trigger} />
      : <DeleteAdminAccountDialog profile={profile} open={open} onOpenChange={setOpen} returnFocus={trigger} />}
  </section>;
}

function DeleteAdminAccountDialog({ profile, open, onOpenChange, returnFocus }: {
  profile: AdminProfile; open: boolean; onOpenChange: (open: boolean) => void; returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const endSession = useEndAdminSession();
  const { runWithStepUp, dialog: stepUpDialog } = useStepUp();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [pending, setPending] = useState(false);
  const ready = password.length > 0 && confirmation === 'DELETE' && !pending;
  const name = `${profile.firstName} ${profile.lastName}`.trim();

  const reset = () => { setPassword(''); setConfirmation(''); setError(''); setPasswordError(''); };
  const changeOpen = (next: boolean) => {
    if (pending) return; // the request decides; closing mid-flight would hide its outcome
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setPending(true);
    setError('');
    setPasswordError('');
    try {
      await runWithStepUp(() => adminSecurityApi.deleteAccount({ currentPassword: password, confirmation: 'DELETE' }));
      // Reached only after the server committed the deletion.
      endSession('ACCOUNT_DELETED');
      return;
    } catch (failure) {
      if (isStepUpCancelled(failure)) setError('Your account was not deleted. Confirm it is you to continue.');
      else if (failure instanceof ApiError && failure.code === 'INVALID_CURRENT_PASSWORD') setPasswordError(failure.message);
      else setError(failureMessage(failure, 'Your account could not be deleted. Nothing was changed. Try again.'));
    }
    setPending(false);
  };

  return <>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className={pageStyles.dangerDialog}
        // The dialog is opened by state, not a Radix Trigger: hand focus back to the button that opened it.
        onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}>
        <DialogTitle className={pageStyles.dangerDialogTitle}><AlertTriangle aria-hidden="true" /> Delete your administrator account?</DialogTitle>
        <DialogDescription>
          You are deleting <strong>{name || 'your account'}</strong> ({profile.email}).
        </DialogDescription>
        <ul className={pageStyles.dangerList}>
          <li>Every active session ends immediately, on all devices.</li>
          <li>Administrative access cannot be restored by signing in again. A new account would need a new invitation.</li>
          <li>Your name, email, password and sign-in methods are removed.</li>
          <li>Audit records and the orders, inventory and delivery history you worked on are kept, as required for accountability.</li>
        </ul>
        {error && <Alert variant="error">{error}</Alert>}
        <form className={pageStyles.form} onSubmit={submit} noValidate>
          <PasswordInput id="delete-admin-password" label="Current password" autoComplete="current-password" value={password}
            onChange={event => { setPassword(event.target.value); setPasswordError(''); }} error={passwordError || undefined} fullWidth disabled={pending} />
          <Input id="delete-admin-confirmation" label="Type DELETE to confirm" value={confirmation} autoComplete="off" spellCheck={false}
            onChange={event => setConfirmation(event.target.value)} fullWidth disabled={pending}
            helperText="You will also confirm it is you with two-step verification." />
          <div className={`${pageStyles.formActions} ${pageStyles.formActionsStatic}`}>
            <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={!ready} isLoading={pending}>Delete account</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    {stepUpDialog}
  </>;
}
