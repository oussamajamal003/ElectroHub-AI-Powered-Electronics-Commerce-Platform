import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput/PasswordInput';
import { useAdminAuth } from '@/features/auth/context/AuthContext';
import { adminAuthApi, type AdminSessionResponse } from '@/features/admin/security/api';
import { describeAdminAuthError } from '@/features/admin/security/errors';
import { AdminEnrollmentFlow } from '@/features/admin/security/components/AdminEnrollmentFlow';
import { ApiError } from '@/lib/api';
import { fieldErrors as serverFieldErrors } from '@/features/admin/shared/api';
import { STRONG_PASSWORD, passwordHint } from '@/features/admin/security/passwordPolicy';
import styles from './AdminLoginPage.module.scss';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

/**
 * Reads the invitation token from the URL fragment (`#token=…`). Fragments are never sent to a server or logged in referrers, and the
 * page removes the fragment as soon as it has been read (see the effect below).
 */
export function readInvitationToken(hash: string): string | null {
  if (!hash.startsWith('#')) return null;
  const token = new URLSearchParams(hash.slice(1)).get('token');
  return token && TOKEN_PATTERN.test(token) ? token : null;
}


type InviteField = 'firstName' | 'lastName' | 'password' | 'confirmPassword';
type FieldErrors = Partial<Record<InviteField, string>>;

/** Every client-side rule in one place, so the live messages and the submit check can never disagree. */
function inviteProblems(values: Record<InviteField, string>): FieldErrors {
  const problems: FieldErrors = {};
  if (!values.firstName.trim()) problems.firstName = 'Enter your first name.';
  if (!values.lastName.trim()) problems.lastName = 'Enter your last name.';
  const hint = passwordHint(values.password);
  if (hint !== STRONG_PASSWORD) problems.password = hint;
  if (!values.confirmPassword) problems.confirmPassword = 'Confirm your password.';
  else if (values.confirmPassword !== values.password) problems.confirmPassword = 'The passwords do not match.';
  return problems;
}

type Preview =
  | { status: 'loading' }
  | { status: 'ready'; email: string }
  | { status: 'invalid' }
  | { status: 'error' };

type Stage =
  | { name: 'form' }
  | { name: 'enroll'; mfaToken: string }
  | { name: 'ended'; message: string };

export function AdminInvitePage() {
  const { completeAdminSession } = useAdminAuth();
  const navigate = useNavigate();
  // The token is read once and kept in state. The fragment is then removed from the address bar and history.
  const [token, setToken] = useState<string | null>(() => readInvitationToken(window.location.hash));
  const [preview, setPreview] = useState<Preview>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [stage, setStage] = useState<Stage>({ name: 'form' });
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');
  // Server (or submit-time) errors, shown until that field is edited again.
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // Fields the administrator has typed in: their rule problems show live, as an error, on every keystroke.
  const [touched, setTouched] = useState<Partial<Record<InviteField, boolean>>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setPreview({ status: 'invalid' });
      return undefined;
    }
    let active = true;
    setPreview({ status: 'loading' });
    adminAuthApi.previewInvitation({ token })
      .then((result) => { if (active) setPreview({ status: 'ready', email: result.email }); })
      .catch((err: unknown) => {
        if (!active) return;
        const unavailable = err instanceof ApiError && (err.status === 410 || err.code === 'INVITATION_UNAVAILABLE');
        setPreview(unavailable ? { status: 'invalid' } : { status: 'error' });
      });
    return () => { active = false; };
  }, [token, attempt]);

  const problems = inviteProblems({ firstName, lastName, password, confirmPassword });
  const errorFor = (field: InviteField) => fieldErrors[field] ?? (touched[field] ? problems[field] : undefined);

  // Editing a field drops its stale server error and starts live validation for it.
  const edit = (field: InviteField, set: (value: string) => void) => (event: ChangeEvent<HTMLInputElement>) => {
    set(event.target.value);
    setTouched(current => current[field] ? current : { ...current, [field]: true });
    setFieldErrors(current => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const validate = () => {
    setTouched({ firstName: true, lastName: true, password: true, confirmPassword: true });
    return Object.keys(problems).length === 0;
  };

  const accept = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || pending) return;
    setFormError('');
    if (!validate()) return;
    setPending(true);
    try {
      const result = await adminAuthApi.acceptInvitation({ token, firstName: firstName.trim(), lastName: lastName.trim(), password });
      // The invitation is consumed: drop the token and every password value before the next step.
      setToken(null);
      setPassword('');
      setConfirmPassword('');
      setStage({ name: 'enroll', mfaToken: result.mfaToken });
    } catch (err) {
      const failure = describeAdminAuthError(err, 'invitation');
      if (err instanceof ApiError && (err.status === 410 || err.status === 409 || err.code === 'INVITATION_UNAVAILABLE' || err.code === 'ACCOUNT_EXISTS')) {
        setToken(null);
        setPreview({ status: 'invalid' });
      } else {
        setFieldErrors(serverFieldErrors(err));
        setFormError(failure.message);
      }
    } finally {
      setPending(false);
    }
  };

  const finishSetup = (session: AdminSessionResponse) => {
    completeAdminSession(session);
    navigate('/admin', { replace: true });
  };

  const renderBody = () => {
    if (stage.name === 'ended') {
      return (
        <div className={styles.form}>
          <Alert variant="error">{stage.message}</Alert>
          <Link className={styles.textLink} to="/admin/login">Go to Admin sign in</Link>
        </div>
      );
    }
    if (stage.name === 'enroll') {
      return (
        <div className={styles.form}>
          <Alert variant="success">Your account is created. Two-step verification is required before you can open the admin console.</Alert>
          <AdminEnrollmentFlow
            mfaToken={stage.mfaToken}
            onComplete={finishSetup}
            onChallengeLost={(message) => setStage({ name: 'ended', message: `${message} Sign in at the Admin Portal to continue setup.` })}
          />
        </div>
      );
    }
    if (preview.status === 'loading') {
      return <p role="status" className={styles.description}>Checking your invitation…</p>;
    }
    if (preview.status === 'error') {
      return (
        <div className={styles.form}>
          <Alert variant="error">We could not check this invitation. Check your connection and try again.</Alert>
          <Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}>Try again</Button>
        </div>
      );
    }
    if (preview.status === 'invalid') {
      return (
        <div className={styles.form}>
          <Alert variant="error">This invitation link is invalid or has expired. Ask an administrator to send you a new invitation.</Alert>
          <Link className={styles.textLink} to="/admin/login">Go to Admin sign in</Link>
        </div>
      );
    }
    return (
      <form className={styles.form} onSubmit={accept} noValidate>
        {formError && <Alert variant="error">{formError}</Alert>}
        <Input id="invite-email" name="email" label="Email address" type="email" value={preview.email} readOnly fullWidth autoComplete="email"
          helperText="This invitation is for this address." />
        <div className={styles.nameRow}>
          <Input id="invite-first-name" name="firstName" label="First name" value={firstName} onChange={edit('firstName', setFirstName)}
            error={errorFor('firstName')} autoComplete="given-name" maxLength={100} fullWidth disabled={pending} />
          <Input id="invite-last-name" name="lastName" label="Last name" value={lastName} onChange={edit('lastName', setLastName)}
            error={errorFor('lastName')} autoComplete="family-name" maxLength={100} fullWidth disabled={pending} />
        </div>
        <PasswordInput id="invite-password" name="password" label="Create a password" value={password} onChange={edit('password', setPassword)}
          error={errorFor('password')} helperText={passwordHint(password)} autoComplete="new-password" fullWidth disabled={pending} />
        <PasswordInput id="invite-confirm-password" name="confirmPassword" label="Confirm password" value={confirmPassword}
          onChange={edit('confirmPassword', setConfirmPassword)} error={errorFor('confirmPassword')} autoComplete="new-password" fullWidth disabled={pending} />
        <Button type="submit" className={styles.submitButton} isLoading={pending}>Create my account</Button>
      </form>
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.loginCard}>
        <div className={styles.header}>
          <div className={styles.brand}><BrandLogo size="large" /><span className={styles.visuallyHidden}>ElectroHub</span></div>
          <h1 className={styles.title}>Join the Admin Team</h1>
          <p className={styles.description}>Admin Portal</p>
        </div>
        {renderBody()}
      </div>
    </div>
  );
}
