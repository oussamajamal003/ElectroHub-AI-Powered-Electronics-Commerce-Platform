import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput/PasswordInput';
import { useAuth } from '@/features/auth/context/AuthContext';
import { adminAuthApi, type AdminActivationPreview, type AdminSessionResponse } from '@/features/admin/security/api';
import { describeAdminAuthError } from '@/features/admin/security/errors';
import { AdminEnrollmentFlow } from '@/features/admin/security/components/AdminEnrollmentFlow';
import { ApiError } from '@/lib/api';
import { fieldErrors as serverFieldErrors } from '@/features/admin/shared/api';
import { STRONG_PASSWORD, passwordHint } from '@/features/admin/security/passwordPolicy';
import { readInvitationToken } from './AdminInvitePage';
import styles from './AdminLoginPage.module.scss';

type Field = 'password' | 'confirmPassword';
type FieldErrors = Partial<Record<Field, string>>;

function problemsFor(values: Record<Field, string>): FieldErrors {
  const problems: FieldErrors = {};
  const hint = passwordHint(values.password);
  if (hint !== STRONG_PASSWORD) problems.password = hint;
  if (!values.confirmPassword) problems.confirmPassword = 'Confirm your password.';
  else if (values.confirmPassword !== values.password) problems.confirmPassword = 'The passwords do not match.';
  return problems;
}

type Preview = { status: 'loading' } | { status: 'ready'; account: AdminActivationPreview } | { status: 'invalid' } | { status: 'error' };

/**
 * The two trust models share the password and enrollment steps but never their proof: an Owner activation link was emailed (mailbox
 * possession); a seed setup link was issued by an operator for a development seed account and handed over directly (no email proof).
 */
export type ActivationMode = 'activation' | 'provisioning';
const MODE = {
  activation: {
    title: 'Activate your administrator account',
    preview: (body: { token: string }) => adminAuthApi.previewActivation(body),
    redeem: (body: { token: string; password: string }) => adminAuthApi.redeemActivation(body),
    unavailableCode: 'ACTIVATION_UNAVAILABLE',
    checking: 'Checking your activation link…',
    invalid: 'This activation link is invalid, expired or already used. Ask an Owner to send you a new one.',
    lost: 'If setup is no longer available, ask an Owner to send a new activation link.',
    intro: 'Choose a new password. Your previous password stops working, and you will then set up an authenticator app.',
  },
  provisioning: {
    title: 'Set up your development administrator account',
    preview: (body: { token: string }) => adminAuthApi.previewProvisioning(body),
    redeem: (body: { token: string; password: string }) => adminAuthApi.redeemProvisioning(body),
    unavailableCode: 'PROVISIONING_UNAVAILABLE',
    checking: 'Checking your setup link…',
    invalid: 'This setup link is invalid, expired or already used. Ask the operator who issued it for a new one.',
    lost: 'If setup is no longer available, ask the operator for a new setup link.',
    intro: 'An operator authorized setup of this development account. Choose a new password; the seeded password stops working, and you will then set up an authenticator app.',
  },
} as const;
type Stage = { name: 'form' } | { name: 'enroll'; mfaToken: string } | { name: 'ended'; message: string };

/**
 * Existing-administrator activation. The single-use link (token in the URL fragment, removed on load) proves control of the delivery channel;
 * redeeming it rotates the legacy password and only then opens first-factor enrollment through the same restricted flow as an invitation.
 * No session exists until the authenticator code is verified.
 */
export function AdminActivatePage({ mode = 'activation' }: { mode?: ActivationMode }) {
  const copy = MODE[mode];
  const { completeAdminSession } = useAuth();
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(() => readInvitationToken(window.location.hash));
  const [preview, setPreview] = useState<Preview>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [stage, setStage] = useState<Stage>({ name: 'form' });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
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
    copy.preview({ token })
      .then(account => { if (active) setPreview({ status: 'ready', account }); })
      .catch((err: unknown) => {
        if (!active) return;
        const unavailable = err instanceof ApiError && (err.status === 410 || err.code === copy.unavailableCode);
        setPreview(unavailable ? { status: 'invalid' } : { status: 'error' });
      });
    return () => { active = false; };
  }, [token, attempt, copy]);

  const problems = problemsFor({ password, confirmPassword });
  const errorFor = (field: Field) => fieldErrors[field] ?? (touched[field] ? problems[field] : undefined);
  const edit = (field: Field, set: (value: string) => void) => (event: ChangeEvent<HTMLInputElement>) => {
    set(event.target.value);
    setTouched(current => current[field] ? current : { ...current, [field]: true });
    setFieldErrors(current => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const activate = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || pending) return;
    setFormError('');
    setTouched({ password: true, confirmPassword: true });
    if (Object.keys(problems).length > 0) return;
    setPending(true);
    try {
      const result = await copy.redeem({ token, password });
      // The link is consumed: drop the token and every password value before the next step.
      setToken(null);
      setPassword('');
      setConfirmPassword('');
      setStage({ name: 'enroll', mfaToken: result.mfaToken });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 410 || err.code === copy.unavailableCode)) {
        setToken(null);
        setPreview({ status: 'invalid' });
      } else {
        setFieldErrors(serverFieldErrors(err));
        setFormError(describeAdminAuthError(err, 'activation').message);
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
          <Alert variant="success">Your new password is set. Set up two-step verification to open the admin console.</Alert>
          <AdminEnrollmentFlow
            mfaToken={stage.mfaToken}
            onComplete={finishSetup}
            onChallengeLost={(message) => setStage({ name: 'ended', message: `${message} Sign in at the Admin Portal with your new password to continue setup. ${copy.lost}` })}
          />
        </div>
      );
    }
    if (preview.status === 'loading') return <p role="status" className={styles.description}>{copy.checking}</p>;
    if (preview.status === 'error') {
      return (
        <div className={styles.form}>
          <Alert variant="error">We could not check this link. Check your connection and try again.</Alert>
          <Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}>Try again</Button>
        </div>
      );
    }
    if (preview.status === 'invalid') {
      return (
        <div className={styles.form}>
          <Alert variant="error">{copy.invalid}</Alert>
          <Link className={styles.textLink} to="/admin/login">Go to Admin sign in</Link>
        </div>
      );
    }
    return (
      <form className={styles.form} onSubmit={activate} noValidate>
        {formError && <Alert variant="error">{formError}</Alert>}
        <Input id="activate-email" name="email" label="Administrator account" type="email" value={preview.account.email} readOnly fullWidth autoComplete="email"
          helperText={`${preview.account.firstName} ${preview.account.lastName}`.trim() || 'This link is for this account.'} />
        <p className={styles.description}>{copy.intro}</p>
        <PasswordInput id="activate-password" name="password" label="New password" value={password} onChange={edit('password', setPassword)}
          error={errorFor('password')} helperText={passwordHint(password)} autoComplete="new-password" fullWidth disabled={pending} />
        <PasswordInput id="activate-confirm-password" name="confirmPassword" label="Confirm password" value={confirmPassword}
          onChange={edit('confirmPassword', setConfirmPassword)} error={errorFor('confirmPassword')} autoComplete="new-password" fullWidth disabled={pending} />
        <Button type="submit" className={styles.submitButton} isLoading={pending}>Set password and continue</Button>
      </form>
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.loginCard}>
        <div className={styles.header}>
          <div className={styles.brand}><BrandLogo size="large" /><span className={styles.visuallyHidden}>ElectroHub</span></div>
          <h1 className={styles.title}>{copy.title}</h1>
          <p className={styles.description}>Admin Portal</p>
        </div>
        {renderBody()}
      </div>
    </div>
  );
}
