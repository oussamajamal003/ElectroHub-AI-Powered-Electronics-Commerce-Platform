import React, { useEffect, useState } from 'react';
import { useNavigate, Navigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, Fingerprint, KeyRound, Smartphone } from 'lucide-react';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { useAuth } from '@/features/auth/context/AuthContext';
import { isAdminMfaRequired, type AdminMfaRequired } from '@/features/auth/types';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { ApiError } from '@/lib/api';
import { adminAuthApi, type AdminSessionResponse } from '@/features/admin/security/api';
import { describeAdminAuthError } from '@/features/admin/security/errors';
import { AdminEnrollmentFlow } from '@/features/admin/security/components/AdminEnrollmentFlow';
import { OtpCodeInput } from '@/features/admin/security/components/OtpCodeInput';
import { PasskeySupportNotice } from '@/features/admin/security/components/PasskeySupportNotice';
import { SIGN_IN_NOTICE_KEY } from '@/features/admin/security/components/AdminAccountSections';
import styles from './AdminLoginPage.module.scss';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Server pre-auth transactions live five minutes; the countdown mirrors it, the server remains authoritative. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const EXPIRED_MESSAGE = 'Your sign-in attempt expired. Start again.';

type Stage = 'credentials' | 'challenge' | 'enroll';
type Method = 'totp' | 'passkey' | 'recovery';

interface Challenge {
  mfaToken: string;
  expiresAt: number;
  factors: AdminMfaRequired['factors'];
}

const formatRemaining = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export function AdminLoginPage() {
  const { login, logout, completeAdminSession, isAuthenticated, user, isInitializing } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // A deep link that required sign-in returns to that admin page; anything else (or a crafted value) goes to the dashboard.
  const { from, search, notice: stateNotice } = (location.state as { from?: unknown; search?: unknown; notice?: unknown } | null) ?? {};
  // Set by the profile just before it ends every session; read once so a later visit does not repeat it.
  const [storedNotice] = useState<string | null>(() => {
    try {
      const value = window.sessionStorage.getItem(SIGN_IN_NOTICE_KEY);
      window.sessionStorage.removeItem(SIGN_IN_NOTICE_KEY);
      return value;
    } catch { return null; }
  });
  const notice = stateNotice ?? storedNotice;
  // Fixed copy keyed by a known value: navigation state never supplies text that is rendered.
  const signInNotice = notice === 'PASSWORD_CHANGED'
    ? 'Your password was changed and every session was signed out. Sign in with your new password and two-step verification.'
    : notice === 'ACCOUNT_DELETED' ? 'Your administrator account was deleted and every session was signed out.'
    : notice === 'OWNERSHIP_TRANSFERRED' ? 'Your administrator account has been deleted, and ownership has been transferred successfully.' : null;
  const returnPath = typeof from === 'string' && /^\/admin(\/[A-Za-z0-9._~%-]+)*\/?$/.test(from) && !from.startsWith('/admin/login') ? from : null;
  // List filters live in the query string; it is only ever applied as the search part of an already-validated /admin path.
  const destination = returnPath
    ? { pathname: returnPath, search: typeof search === 'string' && search.startsWith('?') && search.length <= 500 ? search : '' }
    : '/admin';
  const [stage, setStage] = useState<Stage>('credentials');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [method, setMethod] = useState<Method>('totp');
  const [now, setNow] = useState(() => Date.now());
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [challengeError, setChallengeError] = useState('');
  const [challengePending, setChallengePending] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [touched, setTouched] = useState({ email: false, password: false });
  const [submitted, setSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const passkeysSupported = browserSupportsWebAuthn();

  // Tick once a second while a challenge is open so the countdown and expiry stay accurate.
  useEffect(() => {
    if (!challenge) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [challenge]);

  const remainingMs = challenge ? challenge.expiresAt - now : 0;
  const expired = Boolean(challenge) && remainingMs <= 0;

  // An open attempt that outlives its five minutes restarts with the explanation, on whichever step it was.
  useEffect(() => {
    if (expired) restart(EXPIRED_MESSAGE);
    // restart only sets state; it is re-created each render with the same meaning.
  }, [expired]);

  // If already authenticated as admin, redirect to dashboard
  if (!isInitializing && isAuthenticated && user?.role === 'ADMIN') {
    return <Navigate to={destination} replace />;
  }

  /** Returns to step 1 with a truthful explanation. The pre-auth transaction is discarded: nothing stays in memory but the email field. */
  const restart = (message: string) => {
    setChallenge(null);
    setStage('credentials');
    setCode('');
    setRecoveryCode('');
    setChallengeError('');
    setPassword('');
    setError(message);
  };

  const validateEmailField = (val: string) => {
    if (!val.trim()) return 'Email address is required.';
    if (!EMAIL_REGEX.test(val.trim())) return 'Please enter a valid email address.';
    return '';
  };

  const validatePasswordField = (val: string) => {
    if (!val) return 'Password is required.';
    return '';
  };

  const handleEmailBlur = () => {
    setTouched((prev) => ({ ...prev, email: true }));
    if (email.trim().length > 0) {
      setEmailError(validateEmailField(email));
    } else if (!submitted) {
      setEmailError('');
    }
  };

  const handlePasswordBlur = () => {
    setTouched((prev) => ({ ...prev, password: true }));
    if (password.length > 0) {
      setPasswordError(validatePasswordField(password));
    } else if (!submitted) {
      setPasswordError('');
    }
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEmail(val);
    if (touched.email || submitted || emailError) {
      setEmailError(validateEmailField(val));
    }
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setPassword(val);
    if (touched.password || submitted || passwordError) {
      setPasswordError(validatePasswordField(val));
    }
  };

  const hasErrors = Boolean(emailError || passwordError);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setSubmitted(true);
    setTouched({ email: true, password: true });
    setError('');
    const emErr = validateEmailField(email);
    const pwErr = validatePasswordField(password);
    setEmailError(emErr);
    setPasswordError(pwErr);

    if (emErr || pwErr) {
      return;
    }

    setIsLoading(true);

    try {
      const loggedInUser = await login({ email: email.trim(), password });
      // Administrator password proof: no session yet. Open the restricted second-factor step (or enrollment) with the challenge.
      if (isAdminMfaRequired(loggedInUser)) {
        setPassword('');
        setChallenge({
          mfaToken: loggedInUser.mfaToken,
          expiresAt: Date.parse(loggedInUser.expiresAt) || Date.now() + CHALLENGE_TTL_MS,
          factors: loggedInUser.factors,
        });
        setMethod(loggedInUser.factors.totp ? 'totp' : loggedInUser.factors.passkey ? 'passkey' : 'recovery');
        setStage(loggedInUser.enrollmentRequired ? 'enroll' : 'challenge');
        return;
      }
      if ('requiresVerification' in loggedInUser) {
        setError('Admin accounts must be pre-verified.');
        return;
      }
      if (loggedInUser.user?.role !== 'ADMIN') {
        await logout();
        setError('Access denied. Administrator privileges required.');
        return;
      }
      navigate(destination, { replace: true });
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many sign-in attempts. Wait a few minutes and try again.');
      } else if (err instanceof ApiError && err.code === 'ENROLLMENT_NOT_AUTHORIZED') {
        setError(describeAdminAuthError(err, 'enrollment').message);
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  /** Finishes a second-factor proof: the session is established exactly like a password login, then the deep link is restored. */
  const finishChallenge = (session: AdminSessionResponse) => {
    completeAdminSession(session);
    navigate(destination, { replace: true });
  };

  const verifyCode = async () => {
    if (!challenge || challengePending || expired) return;
    const isRecovery = method === 'recovery';
    const value = isRecovery ? recoveryCode.trim() : code;
    if (!isRecovery && value.length !== 6) { setChallengeError('Enter the 6-digit code from your authenticator app.'); return; }
    if (isRecovery && !value) { setChallengeError('Enter one of your recovery codes.'); return; }
    setChallengePending(true);
    setChallengeError('');
    try {
      const session = isRecovery
        ? await adminAuthApi.verifyRecovery({ mfaToken: challenge.mfaToken, code: value })
        : await adminAuthApi.verifyTotp({ mfaToken: challenge.mfaToken, code: value });
      finishChallenge(session);
    } catch (err) {
      const failure = describeAdminAuthError(err, isRecovery ? 'recovery' : 'totp');
      if (failure.restart) restart(failure.message);
      else {
        setChallengeError(failure.message);
        setCode('');
        setRecoveryCode('');
      }
    } finally {
      setChallengePending(false);
    }
  };

  const verifyPasskey = async () => {
    if (!challenge || challengePending || expired) return;
    setChallengePending(true);
    setChallengeError('');
    try {
      const options = await adminAuthApi.passkeyOptions({ mfaToken: challenge.mfaToken });
      const response = await startAuthentication({ optionsJSON: options });
      const session = await adminAuthApi.verifyPasskey({ mfaToken: challenge.mfaToken, response });
      finishChallenge(session);
    } catch (err) {
      const failure = describeAdminAuthError(err, 'passkey');
      if (failure.restart) restart(failure.message);
      else setChallengeError(failure.message);
    } finally {
      setChallengePending(false);
    }
  };

  const availableMethods = challenge
    ? ([
      challenge.factors.totp && 'totp',
      challenge.factors.passkey && 'passkey',
      challenge.factors.recoveryCode && 'recovery',
    ].filter(Boolean) as Method[])
    : [];

  return (
    <div className={styles.container}>
      <div className={styles.loginCard}>
        <div className={styles.header}>
          <div className={styles.brand}><BrandLogo size="large" /><span className={styles.visuallyHidden}>ElectroHub</span></div>
          <h1 className={styles.title}>Sign In to Admin</h1>
          <p className={styles.description}>Admin Portal</p>
        </div>

        {error && (
          <Alert variant="error" className={styles.alert}>
            {error}
          </Alert>
        )}
        {!error && stage === 'credentials' && signInNotice && (
          <Alert variant={notice === 'PASSWORD_CHANGED' ? 'success' : 'info'} className={styles.alert} role="status">
            {signInNotice}
          </Alert>
        )}

        {stage === 'credentials' && (
          <form onSubmit={handleSubmit} className={styles.form} noValidate>
            <div className={styles.formGroup}>
              <Input
                id="admin-email"
                name="email"
                label="Email Address"
                type="email"
                value={email}
                onChange={handleEmailChange}
                onBlur={handleEmailBlur}
                error={emailError}
                fullWidth
                disabled={isLoading}
                placeholder="admin@electrohub.com"
                autoComplete="email"
              />
            </div>

            <div className={styles.formGroup}>
              <Input
                id="admin-password"
                name="password"
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={handlePasswordChange}
                onBlur={handlePasswordBlur}
                error={passwordError}
                fullWidth
                disabled={isLoading}
                placeholder="••••••••"
                autoComplete="current-password"
                endAdornment={
                  <button
                    type="button"
                    className={styles.eyeButton}
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    disabled={isLoading}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                }
              />
            </div>

            <Button
              type="submit"
              className={styles.submitButton}
              disabled={isLoading || hasErrors}
              isLoading={isLoading}
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
        )}

        {stage === 'challenge' && challenge && (
          <section className={styles.form} aria-labelledby="admin-mfa-title">
            <div className={styles.stepHeader}>
              <h2 id="admin-mfa-title" className={styles.stepTitle}>Verify it's you</h2>
              <p className={styles.stepText}>
                {`Confirm with a second factor to finish signing in. This attempt expires in ${formatRemaining(remainingMs)}.`}
              </p>
            </div>
            <Tabs value={method} onValueChange={(next) => { setMethod(next as Method); setChallengeError(''); }}>
                <TabsList aria-label="Second factor" className={styles.methodSelector}>
                  {availableMethods.includes('totp') && <TabsTrigger value="totp" className={styles.methodOption}><Smartphone aria-hidden="true" /><span>Authenticator app</span></TabsTrigger>}
                  {availableMethods.includes('passkey') && <TabsTrigger value="passkey" className={styles.methodOption}><Fingerprint aria-hidden="true" /><span>Passkey</span></TabsTrigger>}
                  {availableMethods.includes('recovery') && <TabsTrigger value="recovery" className={styles.methodOption}><KeyRound aria-hidden="true" /><span>Recovery code</span></TabsTrigger>}
                </TabsList>
                {availableMethods.includes('totp') && (
                  <TabsContent value="totp" className={styles.form}>
                    <OtpCodeInput id="admin-totp-code" label="6-digit code" value={code} onChange={setCode} error={challengeError || undefined}
                      disabled={challengePending} autoFocus />
                    <Button type="button" onClick={verifyCode} isLoading={challengePending}>Verify and sign in</Button>
                  </TabsContent>
                )}
                {availableMethods.includes('passkey') && (
                  <TabsContent value="passkey" className={styles.form}>
                    <PasskeySupportNotice supported={passkeysSupported} />
                    {challengeError && <Alert variant="error">{challengeError}</Alert>}
                    <Button type="button" onClick={verifyPasskey} isLoading={challengePending} disabled={!passkeysSupported}>Use passkey</Button>
                  </TabsContent>
                )}
                {availableMethods.includes('recovery') && (
                  <TabsContent value="recovery" className={styles.form}>
                    <Input id="admin-recovery-code" name="recoveryCode" label="Recovery code" autoComplete="off" spellCheck={false}
                      value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} error={challengeError || undefined}
                      disabled={challengePending} fullWidth />
                    <Button type="button" onClick={verifyCode} isLoading={challengePending}>Verify and sign in</Button>
                  </TabsContent>
                )}
            </Tabs>
            <button type="button" className={styles.textButton} onClick={() => restart('')} disabled={challengePending}>
              Start again
            </button>
          </section>
        )}

        {stage === 'enroll' && challenge && (
          <div className={styles.form}>
            <AdminEnrollmentFlow
              mfaToken={challenge.mfaToken}
              onComplete={finishChallenge}
              onChallengeLost={(message) => restart(message)}
            />
            <button type="button" className={styles.textButton} onClick={() => restart('')}>Start again</button>
          </div>
        )}
      </div>
    </div>
  );
}
