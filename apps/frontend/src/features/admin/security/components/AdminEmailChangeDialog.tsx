import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Mail, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput/PasswordInput';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/features/auth/context/AuthContext';
import { adminSecurityApi, type AdminEmailChangeState } from '../api';
import { isStepUpCancelled, useStepUp } from '../useStepUp';
import styles from './AdminEmailChangeDialog.module.scss';

type Step = 'details' | 'verify' | 'success';
const safeError = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback;
const remainingAttempts = (error: unknown): number | null => {
  if (!(error instanceof ApiError) || !error.data || typeof error.data !== 'object') return null;
  const details = (error.data as { error?: { attemptsRemaining?: unknown } }).error;
  return typeof details?.attemptsRemaining === 'number' ? details.attemptsRemaining : null;
};

export function AdminEmailChangeDialog({ currentEmail }: { currentEmail: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('details');
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<AdminEmailChangeState | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState(5);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const newEmailRef = useRef<HTMLInputElement>(null);
  const { clearSession } = useAuth();
  const navigate = useNavigate();
  const stepUp = useStepUp();

  useEffect(() => {
    if (!open) return;
    let active = true;
    setCheckingStatus(true);
    void adminSecurityApi.emailChangeStatus().then(status => {
      if (!active || !status.active) return;
      setNewEmail(status.pendingEmail);
      setChallenge({ ...status, deliveryStatus: 'ACCEPTED_BY_PROVIDER' });
      setAttemptsRemaining(status.attemptsRemaining ?? 5);
      setStep('verify');
    }).catch(() => {
      // The flow can still be started; the submission path will show an actionable authentication/network error.
    }).finally(() => { if (active) setCheckingStatus(false); });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open || step !== 'verify') return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open, step]);

  useEffect(() => {
    if (!open || step !== 'success') return;
    const timer = window.setTimeout(() => {
      clearSession();
      navigate('/admin/login', { replace: true });
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [clearSession, navigate, open, step]);

  const reset = () => {
    setStep('details'); setNewEmail(''); setCurrentPassword(''); setCode(''); setChallenge(null);
    setAttemptsRemaining(5); setError(''); setBusy(false); setCheckingStatus(false);
  };

  const closeSafely = async () => {
    if (busy || step === 'success') return;
    setError('');
    if (step === 'verify') {
      setBusy(true);
      try { await adminSecurityApi.cancelEmailChange(); }
      catch (failure) {
        setError(safeError(failure, 'The request could not be cancelled. Try again.'));
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    setOpen(false);
    reset();
  };

  const onOpenChange = (next: boolean) => {
    if (next) { reset(); setOpen(true); }
    else void closeSafely();
  };

  const requestChange = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || checkingStatus) return;
    const normalized = newEmail.trim().toLowerCase();
    if (normalized === currentEmail.trim().toLowerCase()) { setError('Enter an email address different from your current one.'); return; }
    setBusy(true); setError('');
    try {
      const result = await stepUp.runWithStepUp(() => adminSecurityApi.requestEmailChange({ newEmail: normalized, currentPassword }));
      setChallenge(result);
      setAttemptsRemaining(result.attemptsRemaining ?? 5);
      setNewEmail(result.pendingEmail);
      setCurrentPassword('');
      setCode('');
      setStep('verify');
    } catch (failure) {
      if (!isStepUpCancelled(failure)) setError(safeError(failure, 'We could not start the email change. Try again.'));
    } finally { setBusy(false); }
  };

  const verifyChange = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || code.length !== 6) return;
    setBusy(true); setError('');
    try {
      await adminSecurityApi.verifyEmailChange({ code });
      setCode('');
      setStep('success');
    } catch (failure) {
      const remaining = remainingAttempts(failure);
      if (remaining !== null) setAttemptsRemaining(remaining);
      else if (failure instanceof ApiError && failure.code === 'OTP_INCORRECT') setAttemptsRemaining(value => Math.max(0, value - 1));
      setError(safeError(failure, 'We could not verify that code. Request a new one and try again.'));
      setCode('');
    } finally { setBusy(false); }
  };

  const resend = async () => {
    if (busy || !challenge || clock < new Date(challenge.resendAvailableAt).getTime()) return;
    setBusy(true); setError('');
    try {
      const result = await stepUp.runWithStepUp(() => adminSecurityApi.resendEmailChange());
      setChallenge(result); setAttemptsRemaining(result.attemptsRemaining ?? 5); setCode('');
      if (result.deliveryStatus === 'FAILED') setError('We could not deliver the new code. You can try again after the cooldown.');
    } catch (failure) {
      if (!isStepUpCancelled(failure)) setError(safeError(failure, 'A new verification code could not be sent.'));
    } finally { setBusy(false); }
  };

  const cooldown = challenge ? Math.max(0, Math.ceil((new Date(challenge.resendAvailableAt).getTime() - clock) / 1000)) : 0;
  const expiry = challenge ? Math.max(0, Math.ceil((new Date(challenge.otpExpiresAt).getTime() - clock) / 1000)) : 0;

  return <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline"><Mail aria-hidden="true" /> Change Email</Button>
      </DialogTrigger>
      <DialogContent className={styles.dialog} hideCloseButton={step === 'success'} onOpenAutoFocus={event => {
        event.preventDefault();
        newEmailRef.current?.focus();
      }}>
        {step === 'details' && <>
          <DialogTitle>Change your email address</DialogTitle>
          <DialogDescription>Your new email will become the address used to sign in and receive security notifications after verification.</DialogDescription>
          {error && <Alert variant="error" role="alert">{error}</Alert>}
          {checkingStatus && <p className={styles.status} role="status">Checking for an unfinished email change…</p>}
          <form className={styles.form} onSubmit={requestChange}>
            <Input id="admin-email-current" name="currentEmail" label="Current email" value={currentEmail} readOnly fullWidth autoComplete="email" />
            <Input ref={newEmailRef} id="admin-email-new" name="newEmail" label="New email" type="email" value={newEmail} onChange={event => setNewEmail(event.target.value)}
              autoComplete="email" maxLength={255} required fullWidth autoFocus disabled={busy} />
            <PasswordInput id="admin-email-current-password" name="currentPassword" label="Current password" value={currentPassword}
              onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" maxLength={128} required fullWidth disabled={busy} />
            <div className={styles.actions}>
              <Button type="button" variant="outline" onClick={() => void closeSafely()} disabled={busy}>Cancel</Button>
              <Button type="submit" isLoading={busy} disabled={busy || checkingStatus || !newEmail.trim() || !currentPassword}>Continue</Button>
            </div>
          </form>
        </>}

        {step === 'verify' && <>
          <DialogTitle>Verify your new email</DialogTitle>
          <DialogDescription>Enter the six-digit code sent to <strong>{newEmail}</strong>. Your current sign-in email stays active until verification succeeds.</DialogDescription>
          {error && <Alert variant="error" role="alert">{error}</Alert>}
          {challenge?.deliveryStatus === 'FAILED' && <Alert variant="warning" role="status">The code could not be delivered. Use resend when the cooldown ends.</Alert>}
          <form className={styles.form} onSubmit={verifyChange}>
            <Input id="admin-email-change-code" name="code" label="6-digit verification code" value={code}
              onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code"
              maxLength={6} pattern="[0-9]{6}" placeholder="••••••" required fullWidth autoFocus disabled={busy} />
            <div className={styles.feedback} aria-live="polite">
              <span>{expiry > 0 ? `Code expires in ${expiry}s` : 'Code expired. Request a new one.'}</span>
              <span>{attemptsRemaining} attempt{attemptsRemaining === 1 ? '' : 's'} remaining</span>
            </div>
            <div className={styles.actions}>
              <Button type="button" variant="outline" onClick={() => void closeSafely()} disabled={busy}>Cancel</Button>
              <Button type="submit" isLoading={busy} disabled={busy || code.length !== 6 || attemptsRemaining === 0}>Verify email</Button>
            </div>
          </form>
          <Button type="button" variant="ghost" className={styles.resend} onClick={() => void resend()} disabled={busy || cooldown > 0}>
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </Button>
        </>}

        {step === 'success' && <div className={styles.success} role="status">
          <span className={styles.successIcon}><ShieldCheck aria-hidden="true" /></span>
          <DialogTitle>Email changed successfully</DialogTitle>
          <DialogDescription>Your administrator email has been updated. For your security, all existing sessions have ended. Sign in again with your new email address and two-step verification.</DialogDescription>
          <p className={styles.status}>Taking you to administrator sign-in…</p>
        </div>}
      </DialogContent>
    </Dialog>
    {stepUp.dialog}
  </>;
}
