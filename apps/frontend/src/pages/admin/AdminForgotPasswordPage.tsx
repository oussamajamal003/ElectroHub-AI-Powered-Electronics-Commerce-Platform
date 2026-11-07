import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Fingerprint, KeyRound, Smartphone } from 'lucide-react';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput/PasswordInput';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { ApiError } from '@/lib/api';
import { adminRecoveryApi, type AdminRecoveryTransaction, type AdminResetAuthorization } from '@/features/admin/security/api';
import { describeAdminAuthError } from '@/features/admin/security/errors';
import { OtpCodeInput } from '@/features/admin/security/components/OtpCodeInput';
import { PasskeySupportNotice } from '@/features/admin/security/components/PasskeySupportNotice';
import { STRONG_PASSWORD, passwordHint } from '@/features/admin/security/passwordPolicy';
import { fieldErrors as serverFieldErrors } from '@/features/admin/shared/api';
import styles from './AdminLoginPage.module.scss';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The email code lives one minute and a resend is allowed when it lapses; the server remains authoritative for both. */
const CODE_TTL_MS = 60 * 1000;

type Method = 'totp' | 'passkey' | 'recovery';
type Stage =
  | { name: 'email' }
  | { name: 'code'; email: string; sentAt: number }
  | { name: 'mfa'; recovery: AdminRecoveryTransaction }
  | { name: 'password'; authorization: AdminResetAuthorization }
  | { name: 'done' };

const formatRemaining = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * Administrator forgot-password. Email code → an already-registered second factor → new password. No step returns a session or tokens:
 * the recovery and reset authorizations live only in component state, and the journey ends back at the normal sign-in (password + MFA).
 */
export function AdminForgotPasswordPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>({ name: 'email' });
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState('');
  const [method, setMethod] = useState<Method>('totp');
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [touched, setTouched] = useState<{ password?: boolean; confirmPassword?: boolean }>({});
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const passkeysSupported = browserSupportsWebAuthn();

  const expiry = stage.name === 'mfa' ? Date.parse(stage.recovery.expiresAt)
    : stage.name === 'password' ? Date.parse(stage.authorization.expiresAt) : null;
  const waiting = stage.name === 'code' || expiry !== null;

  useEffect(() => {
    if (!waiting) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waiting, stage.name]);

  // Each step moves focus to its heading so keyboard and screen-reader users land on the new content.
  useEffect(() => { headingRef.current?.focus(); }, [stage.name]);

  const expired = expiry !== null && expiry - now <= 0;
  useEffect(() => {
    if (expired) restart('Your password recovery attempt expired. Start again.');
    // restart only clears state.
  }, [expired]);

  /** Discards every transient proof and returns to step 1. */
  const restart = (message = '') => {
    setStage({ name: 'email' });
    setCode('');
    setTotpCode('');
    setRecoveryCode('');
    setPassword('');
    setConfirmPassword('');
    setTouched({});
    setServerFields({});
    setNotice('');
    setError(message);
  };

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setError('');
    const value = email.trim();
    if (!value) { setEmailError('Email address is required.'); return; }
    if (!EMAIL_REGEX.test(value)) { setEmailError('Please enter a valid email address.'); return; }
    setEmailError('');
    setPending(true);
    try {
      await adminRecoveryApi.request({ email: value });
      // The same acknowledgement for every address: nothing here reveals whether an account exists.
      setNotice('If an eligible account exists, verification instructions will be sent shortly.');
      setStage({ name: 'code', email: value, sentAt: Date.now() });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? 'Too many requests. Wait a few minutes and try again.' : describeAdminAuthError(err, 'team').message);
    } finally {
      setPending(false);
    }
  };

  const resend = async () => {
    if (stage.name !== 'code' || pending) return;
    setPending(true);
    setError('');
    try {
      await adminRecoveryApi.resend({ email: stage.email });
      setNotice('If an eligible account exists, a new code is on its way.');
      setStage({ name: 'code', email: stage.email, sentAt: Date.now() });
      setCode('');
    } catch (err) {
      setError(describeAdminAuthError(err, 'team').message);
    } finally {
      setPending(false);
    }
  };

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    if (stage.name !== 'code' || pending) return;
    if (code.length !== 6) { setError('Enter the 6-digit code from your email.'); return; }
    setPending(true);
    setError('');
    try {
      const recovery = await adminRecoveryApi.verifyEmail({ email: stage.email, code });
      setCode('');
      setNotice('');
      setMethod(recovery.factors.totp ? 'totp' : recovery.factors.passkey ? 'passkey' : 'recovery');
      setStage({ name: 'mfa', recovery });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 400 && err.message ? err.message : describeAdminAuthError(err, 'team').message);
      setCode('');
    } finally {
      setPending(false);
    }
  };

  const proven = (authorization: AdminResetAuthorization) => {
    setTotpCode('');
    setRecoveryCode('');
    setError('');
    setStage({ name: 'password', authorization });
  };

  const failProof = (err: unknown, context: 'totp' | 'recovery' | 'passkey') => {
    const failure = describeAdminAuthError(err, context);
    if (failure.restart) restart(failure.message);
    else { setError(failure.message); setTotpCode(''); setRecoveryCode(''); }
  };

  const submitProof = async (event: FormEvent) => {
    event.preventDefault();
    if (stage.name !== 'mfa' || pending) return;
    const isRecovery = method === 'recovery';
    const value = isRecovery ? recoveryCode.trim() : totpCode;
    if (!isRecovery && value.length !== 6) { setError('Enter the 6-digit code from your authenticator app.'); return; }
    if (isRecovery && !value) { setError('Enter one of your recovery codes.'); return; }
    setPending(true);
    setError('');
    try {
      const body = { recoveryToken: stage.recovery.recoveryToken, code: value };
      proven(isRecovery ? await adminRecoveryApi.verifyRecoveryCode(body) : await adminRecoveryApi.verifyTotp(body));
    } catch (err) {
      failProof(err, isRecovery ? 'recovery' : 'totp');
    } finally {
      setPending(false);
    }
  };

  const usePasskey = async () => {
    if (stage.name !== 'mfa' || pending) return;
    setPending(true);
    setError('');
    try {
      const recoveryToken = stage.recovery.recoveryToken;
      const options = await adminRecoveryApi.passkeyOptions({ recoveryToken });
      const response = await startAuthentication({ optionsJSON: options });
      proven(await adminRecoveryApi.verifyPasskey({ recoveryToken, response }));
    } catch (err) {
      failProof(err, 'passkey');
    } finally {
      setPending(false);
    }
  };

  const problems = {
    password: passwordHint(password) === STRONG_PASSWORD ? undefined : passwordHint(password),
    confirmPassword: !confirmPassword ? 'Confirm your password.' : confirmPassword !== password ? 'The passwords do not match.' : undefined,
  };
  const fieldError = (field: 'password' | 'confirmPassword') => serverFields[field] ?? (touched[field] ? problems[field] : undefined);
  const edit = (field: 'password' | 'confirmPassword', set: (value: string) => void) => (event: ChangeEvent<HTMLInputElement>) => {
    set(event.target.value);
    setTouched(current => ({ ...current, [field]: true }));
    setServerFields(current => { const next = { ...current }; delete next[field]; return next; });
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (stage.name !== 'password' || pending) return;
    setTouched({ password: true, confirmPassword: true });
    if (problems.password || problems.confirmPassword) return;
    setPending(true);
    setError('');
    try {
      await adminRecoveryApi.complete({ resetToken: stage.authorization.resetToken, newPassword: password });
      // The authorization is spent and the password is never kept: nothing sensitive survives this step.
      setPassword('');
      setConfirmPassword('');
      setStage({ name: 'done' });
    } catch (err) {
      const failure = describeAdminAuthError(err, 'team');
      if (err instanceof ApiError && err.code === 'RESET_AUTHORIZATION_INVALID') restart(describeAdminAuthError(err, 'team').message);
      else {
        setServerFields(serverFieldErrors(err));
        setError(failure.message);
      }
    } finally {
      setPending(false);
    }
  };

  const heading = stage.name === 'email' ? 'Reset your administrator password'
    : stage.name === 'code' ? 'Verify your email'
    : stage.name === 'mfa' ? 'Confirm your identity'
    : stage.name === 'password' ? 'Create a new password' : 'Password reset successful';
  const lead = stage.name === 'email' ? "Enter your administrator email address. If the account is eligible, we'll send a verification code."
    : stage.name === 'code' ? `Enter the 6-digit code we sent to ${stage.email}.`
    : stage.name === 'mfa' ? 'Choose a previously registered verification method to continue resetting your password.'
    : stage.name === 'password' ? 'Choose a new password. Every existing session will be signed out.'
    : 'Your password has been updated, and existing sessions have been signed out. Sign in again using your new password and two-step verification.';

  const codeRemaining = stage.name === 'code' ? stage.sentAt + CODE_TTL_MS - now : 0;
  const methods = stage.name === 'mfa'
    ? ([stage.recovery.factors.totp && 'totp', stage.recovery.factors.passkey && 'passkey', stage.recovery.factors.recoveryCode && 'recovery'].filter(Boolean) as Method[])
    : [];

  return (
    <div className={styles.container}>
      <div className={styles.loginCard}>
        <div className={styles.header}>
          <div className={styles.brand}><BrandLogo size="large" /><span className={styles.visuallyHidden}>ElectroHub</span></div>
          <h1 className={styles.title} ref={headingRef} tabIndex={-1}>{heading}</h1>
          <p className={styles.description}>{lead}</p>
        </div>

        {error && <Alert variant="error" className={styles.alert}>{error}</Alert>}
        {!error && notice && <Alert variant="info" className={styles.alert} role="status">{notice}</Alert>}

        {stage.name === 'email' && (
          <form className={styles.form} onSubmit={submitEmail} noValidate>
            <Input id="recovery-email" name="email" label="Email address" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
              error={emailError} fullWidth disabled={pending} placeholder="admin@electrohub.com" autoComplete="email" autoFocus />
            <Button type="submit" className={styles.submitButton} isLoading={pending}>Send verification code</Button>
            <Link className={styles.textLink} to="/admin/login">Back to sign in</Link>
          </form>
        )}

        {stage.name === 'code' && (
          <form className={styles.form} onSubmit={submitCode} noValidate>
            <OtpCodeInput id="recovery-email-code" label="Verification code" value={code} onChange={setCode} disabled={pending} autoFocus
              helperText={codeRemaining > 0 ? `This code expires in ${formatRemaining(codeRemaining)}.` : 'This code has expired. Request a new one.'} />
            <Button type="submit" className={styles.submitButton} isLoading={pending}>Continue</Button>
            <Button type="button" variant="outline" onClick={resend} disabled={pending || codeRemaining > 0}>
              {codeRemaining > 0 ? `Resend code in ${formatRemaining(codeRemaining)}` : 'Resend code'}
            </Button>
            <button type="button" className={styles.textButton} onClick={() => restart('')} disabled={pending}>Use a different email</button>
          </form>
        )}

        {stage.name === 'mfa' && (
          <section className={styles.form} aria-label="Verification method">
            {methods.length > 0 ? (
              <Tabs value={method} onValueChange={(next) => { setMethod(next as Method); setError(''); }}>
                <TabsList aria-label="Verification method" className={styles.methodSelector}>
                  {methods.includes('totp') && <TabsTrigger value="totp" className={styles.methodOption}><Smartphone aria-hidden="true" /><span>Authenticator app</span></TabsTrigger>}
                  {methods.includes('passkey') && <TabsTrigger value="passkey" className={styles.methodOption}><Fingerprint aria-hidden="true" /><span>Passkey</span></TabsTrigger>}
                  {methods.includes('recovery') && <TabsTrigger value="recovery" className={styles.methodOption}><KeyRound aria-hidden="true" /><span>Recovery code</span></TabsTrigger>}
                </TabsList>
                {methods.includes('totp') && (
                  <TabsContent value="totp" asChild>
                    <form className={styles.form} noValidate onSubmit={submitProof}>
                      <OtpCodeInput id="recovery-totp-code" label="6-digit code" value={totpCode} onChange={setTotpCode} disabled={pending} />
                      <Button type="submit" isLoading={pending}>Verify and continue</Button>
                    </form>
                  </TabsContent>
                )}
                {methods.includes('passkey') && (
                  <TabsContent value="passkey" className={styles.form}>
                    <PasskeySupportNotice supported={passkeysSupported} />
                    <Button type="button" onClick={usePasskey} isLoading={pending} disabled={!passkeysSupported}>Use passkey</Button>
                  </TabsContent>
                )}
                {methods.includes('recovery') && (
                  <TabsContent value="recovery" asChild>
                    <form className={styles.form} noValidate onSubmit={submitProof}>
                      <Input id="recovery-recovery-code" name="recoveryCode" label="Recovery code" autoComplete="off" spellCheck={false} value={recoveryCode}
                        onChange={(e) => setRecoveryCode(e.target.value)} disabled={pending} fullWidth />
                      <Button type="submit" isLoading={pending}>Verify and continue</Button>
                    </form>
                  </TabsContent>
                )}
              </Tabs>
            ) : (
              <Alert variant="warning">This account has no registered verification method, so it cannot be recovered by email alone.</Alert>
            )}
            <details>
              <summary>Can't access your verification methods?</summary>
              <p className={styles.description}>
                Resetting a password always needs a second, independent proof. If you no longer have your authenticator app, passkey or recovery codes,
                an Owner must confirm your identity first and restore your access through the administrator recovery procedure. Contact an ElectroHub Owner
                directly: a new email address or a request on its own is not enough.
              </p>
            </details>
            <button type="button" className={styles.textButton} onClick={() => restart('')} disabled={pending}>Start again</button>
          </section>
        )}

        {stage.name === 'password' && (
          <form className={styles.form} onSubmit={submitPassword} noValidate>
            <PasswordInput id="recovery-password" name="password" label="New password" value={password} onChange={edit('password', setPassword)}
              error={fieldError('password')} helperText={passwordHint(password)} autoComplete="new-password" fullWidth disabled={pending} autoFocus />
            <PasswordInput id="recovery-confirm-password" name="confirmPassword" label="Confirm password" value={confirmPassword}
              onChange={edit('confirmPassword', setConfirmPassword)} error={fieldError('confirmPassword')} autoComplete="new-password" fullWidth disabled={pending} />
            <Button type="submit" className={styles.submitButton} isLoading={pending}>Reset password</Button>
          </form>
        )}

        {stage.name === 'done' && (
          <div className={styles.form}>
            <Alert variant="success" role="status">You can now sign in with your new password.</Alert>
            <Button type="button" className={styles.submitButton} onClick={() => navigate('/admin/login', { replace: true, state: { notice: 'PASSWORD_CHANGED' } })}>Back to Admin Sign In</Button>
          </div>
        )}
      </div>
    </div>
  );
}
