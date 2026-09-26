import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput/PasswordInput';
import { Alert } from '@/components/ui/Alert';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/auth';
import styles from './AuthModals.module.scss';
import { ApiError } from '@/lib/api';
import { OtpVerification } from '@/components/ui/OtpVerification';
import { X } from 'lucide-react';

import { useNavigate, useLocation } from 'react-router-dom';

export type AuthModalMode = 'login' | 'register' | 'verify' | 'changeVerificationEmail' | 'forgot' | 'resetVerify' | 'resetNew' | 'resetSuccess';

export interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: AuthModalMode;
  onSwitchToRegister?: () => void;
  onSwitchToLogin?: () => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const maskEmail = (email: string) => email.replace(/^(.)([^@]*)(@.*)$/, (_match, first: string, _middle: string, domain: string) => `${first}***${domain}`);

const normalizeErrorMessage = (err: unknown): string => {
  if (err instanceof ApiError) {
    const payload = err.data as { error?: { code?: string } | string } | undefined;
    const code = typeof payload?.error === 'object' ? payload.error.code : undefined;
    const otpMessages: Record<string, string> = {
      OTP_INCORRECT: 'Incorrect verification code. Please try again.',
      OTP_EXPIRED: 'This verification code has expired. Request a new code.',
      OTP_CONSUMED: 'This verification code is no longer valid. Request a new code.',
      OTP_ATTEMPTS_EXHAUSTED: 'Too many incorrect attempts. Request a new verification code.',
      OTP_INVALID: 'The verification code is no longer valid. Request a new code.',
    };
    if (code && otpMessages[code]) return otpMessages[code];
    if (err.status === 429) return 'Too many password reset attempts. Please try again in an hour.';
    if (err.status >= 500 || code === 'INTERNAL_SERVER_ERROR') return 'Something went wrong. Please try again later.';
    return err.message;
  }
  return 'Something went wrong. Please try again later.';
};

export function AuthModal({
  open,
  onOpenChange,
  initialMode = 'login',
  onSwitchToRegister,
  onSwitchToLogin,
}: AuthModalProps) {
  const { login, register, verifyEmail } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string })?.from || '/account';
  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [isLoading, setIsLoading] = useState(false);

  // Target email for OTP flows
  const [targetEmail, setTargetEmail] = useState('');

  // Verify form state
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyCodeError, setVerifyCodeError] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [resendVersion, setResendVersion] = useState(0);
  
  // Forgot form state
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotEmailError, setForgotEmailError] = useState('');
  const [forgotError, setForgotError] = useState('');

  // Reset form state
  const [resetCode, setResetCode] = useState('');
  const [resetCodeError, setResetCodeError] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [confirmResetPassword, setConfirmResetPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetPasswordError, setResetPasswordError] = useState('');
  const [resetError, setResetError] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [changeEmailError, setChangeEmailError] = useState('');

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginTouched, setLoginTouched] = useState({ email: false, password: false });
  const [loginSubmitted, setLoginSubmitted] = useState(false);
  const [loginEmailError, setLoginEmailError] = useState('');
  const [loginPasswordError, setLoginPasswordError] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginSuccess, setLoginSuccess] = useState('');

  // Register form state
  const [registerData, setRegisterData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [registerTouched, setRegisterTouched] = useState({
    fullName: false,
    email: false,
    password: false,
    confirmPassword: false,
  });
  const [registerSubmitted, setRegisterSubmitted] = useState(false);
  const [registerErrors, setRegisterErrors] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [registerError, setRegisterError] = useState('');

  // Sync mode with initialMode when dialog opens or initialMode changes
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setLoginError('');
      setLoginSuccess('');
      setRegisterError('');
      setLoginEmailError('');
      setLoginPasswordError('');
      setLoginSubmitted(false);
      setRegisterSubmitted(false);
      setLoginTouched({ email: false, password: false });
      setRegisterTouched({
        fullName: false,
        email: false,
        password: false,
        confirmPassword: false,
      });
      setRegisterErrors({
        fullName: '',
        email: '',
        password: '',
        confirmPassword: '',
      });
      setVerifyCode('');
      setVerifyCodeError('');
      setVerifyError('');
      setResendAvailableAt(0);
      setResendVersion(0);
      setForgotEmail('');
      setForgotEmailError('');
      setForgotError('');
      setResetCode('');
      setResetCodeError('');
      setResetPassword('');
      setConfirmResetPassword('');
      setResetToken('');
      setResetPasswordError('');
      setResetError('');
      setVerificationEmail('');
      setChangeEmailError('');
      setTargetEmail('');
    }
  }, [open, initialMode]);

  const handleSwitchMode = (newMode: AuthModalMode) => {
    if (isLoading) return;
    setMode(newMode);
    setLoginError('');
    setLoginSuccess('');
    setRegisterError('');
    setLoginEmailError('');
    setLoginPasswordError('');
    setLoginSubmitted(false);
    setRegisterSubmitted(false);
    setLoginTouched({ email: false, password: false });
    setRegisterTouched({
      fullName: false,
      email: false,
      password: false,
      confirmPassword: false,
    });
    setRegisterErrors({
      fullName: '',
      email: '',
      password: '',
      confirmPassword: '',
    });
    setVerifyCode('');
    setVerifyCodeError('');
    setVerifyError('');
    setForgotEmail('');
    setForgotEmailError('');
    setForgotError('');
    setResetCode('');
    setResetCodeError('');
    setResetPassword('');
    setConfirmResetPassword('');
    setResetToken('');
    setResetPasswordError('');
    setResetError('');
    setChangeEmailError('');
    if (newMode === 'register' && onSwitchToRegister) {
      onSwitchToRegister();
    } else if (newMode === 'login' && onSwitchToLogin) {
      onSwitchToLogin();
    }
  };

  // Login validation
  const validateLoginEmail = (value: string) => {
    if (!value.trim()) {
      return 'Email address is required.';
    }
    if (!EMAIL_REGEX.test(value.trim())) {
      return 'Please enter a valid email address.';
    }
    return '';
  };

  const validateLoginPassword = (value: string) => {
    if (!value) {
      return 'Password is required.';
    }
    return '';
  };

  const handleLoginBlur = (field: 'email' | 'password') => {
    setLoginTouched((prev) => ({ ...prev, [field]: true }));
    if (field === 'email') {
      if (loginEmail.trim().length > 0) {
        setLoginEmailError(validateLoginEmail(loginEmail));
      } else if (!loginSubmitted) {
        setLoginEmailError('');
      }
    } else if (field === 'password') {
      if (loginPassword.length > 0) {
        setLoginPasswordError(validateLoginPassword(loginPassword));
      } else if (!loginSubmitted) {
        setLoginPasswordError('');
      }
    }
  };

  const handleLoginEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLoginEmail(val);
    if (loginTouched.email || loginSubmitted || loginEmailError) {
      setLoginEmailError(validateLoginEmail(val));
    }
  };

  const handleLoginPasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLoginPassword(val);
    if (loginTouched.password || loginSubmitted || loginPasswordError) {
      setLoginPasswordError(validateLoginPassword(val));
    }
  };

  const hasLoginErrors = Boolean(loginEmailError || loginPasswordError);

  // Login Submit Handler
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setLoginSubmitted(true);
    setLoginError('');
    setLoginTouched({ email: true, password: true });
    const emailErr = validateLoginEmail(loginEmail);
    const passErr = validateLoginPassword(loginPassword);

    setLoginEmailError(emailErr);
    setLoginPasswordError(passErr);

    if (emailErr || passErr) return;

    setIsLoading(true);

    try {
      await login({ email: loginEmail.trim(), password: loginPassword });
      onOpenChange(false);
      setLoginEmail('');
      setLoginPassword('');
      navigate(from, { replace: true });
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 403 && (err.data as Record<string, unknown>)?.requiresVerification) {
        setTargetEmail((err.data as Record<string, unknown>).email as string || loginEmail.trim());
        if ((err.data as Record<string, unknown>).deliveryFailed) {
          setVerifyError('We could not send a verification code. Please try resending shortly.');
        }
        setResendAvailableAt(Date.now() + 60_000);
        setMode('verify');
      } else {
        setLoginError(normalizeErrorMessage(err));
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Register validation
  const validateRegisterField = (field: keyof typeof registerData, value: string): string => {
    switch (field) {
      case 'fullName':
        if (!value.trim()) return 'Full name is required.';
        return '';
      case 'email':
        if (!value.trim()) return 'Email address is required.';
        if (!EMAIL_REGEX.test(value.trim())) return 'Please enter a valid email address.';
        return '';
      case 'password':
        if (!value) return 'Password is required.';
        if (value.length < 8) return 'Password must be at least 8 characters.';
        return '';
      case 'confirmPassword':
        if (!value) return 'Please confirm your password.';
        if (value !== registerData.password) return 'Passwords do not match.';
        return '';
      default:
        return '';
    }
  };

  const handleRegisterBlur = (field: keyof typeof registerData) => {
    setRegisterTouched((prev) => ({ ...prev, [field]: true }));
    const val = registerData[field];
    if (val.trim().length > 0) {
      const err = field === 'confirmPassword'
        ? (val !== registerData.password ? 'Passwords do not match.' : validateRegisterField(field, val))
        : validateRegisterField(field, val);
      setRegisterErrors(prev => ({ ...prev, [field]: err }));
    } else if (!registerSubmitted) {
      setRegisterErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleRegisterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const fieldName = name as keyof typeof registerData;
    const updatedData = { ...registerData, [fieldName]: value };
    setRegisterData(updatedData);

    if (registerTouched[fieldName] || registerSubmitted || registerErrors[fieldName]) {
      const err = fieldName === 'confirmPassword'
        ? (value !== updatedData.password ? 'Passwords do not match.' : '')
        : validateRegisterField(fieldName, value);
      setRegisterErrors(prev => ({ ...prev, [fieldName]: err }));
    }

    if (fieldName === 'password' && (registerTouched.confirmPassword || registerSubmitted || registerErrors.confirmPassword)) {
      if (updatedData.confirmPassword) {
        const confirmErr = updatedData.confirmPassword !== value ? 'Passwords do not match.' : '';
        setRegisterErrors(prev => ({ ...prev, confirmPassword: confirmErr }));
      }
    }
  };

  const hasRegisterErrors = Boolean(
    registerErrors.fullName ||
    registerErrors.email ||
    registerErrors.password ||
    registerErrors.confirmPassword
  );

  // Register Submit Handler
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setRegisterSubmitted(true);
    setRegisterError('');
    setRegisterTouched({
      fullName: true,
      email: true,
      password: true,
      confirmPassword: true,
    });

    const newErrors = {
      fullName: validateRegisterField('fullName', registerData.fullName),
      email: validateRegisterField('email', registerData.email),
      password: validateRegisterField('password', registerData.password),
      confirmPassword: !registerData.confirmPassword
        ? 'Please confirm your password.'
        : (registerData.confirmPassword !== registerData.password ? 'Passwords do not match.' : ''),
    };

    setRegisterErrors(newErrors);
    if (newErrors.fullName || newErrors.email || newErrors.password || newErrors.confirmPassword) {
      return;
    }

    const nameParts = registerData.fullName.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ').trim() || nameParts[0] || '';

    setIsLoading(true);

    try {
      const res = await register({
        email: registerData.email.trim(),
        password: registerData.password,
        firstName,
        lastName,
      });

      if (res?.requiresVerification) {
        setTargetEmail(res.email || registerData.email.trim());
        if (res.deliveryFailed) setVerifyError(res.message || 'Unable to send the verification code. Please try again shortly.');
        setResendAvailableAt(Date.now() + 60_000);
        setMode('verify');
      } else {
        setRegisterData({
          fullName: '',
          email: '',
          password: '',
          confirmPassword: '',
        });
        onOpenChange(false);
        navigate(from, { replace: true });
      }
    } catch (err: unknown) {
      setRegisterError(normalizeErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifySubmit = async (code: string) => {
    if (isLoading) return;
    setVerifyCodeError('');
    setVerifyError('');
    if (!/^\d{6}$/.test(code)) {
      setVerifyCodeError('Please enter a valid 6-digit code.');
      return;
    }
    setIsLoading(true);
    try {
      await verifyEmail({ email: targetEmail, code });
      onOpenChange(false);
      navigate(from, { replace: true });
    } catch (err) {
      setVerifyError(normalizeErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendVerify = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setVerifyError('');
    try {
      const result = await authApi.resendVerification({ email: targetEmail });
      setVerifyCode('');
      setResendAvailableAt(new Date(result.resendAvailableAt).getTime());
      setResendVersion((version) => version + 1);
    } catch (err) {
      setVerifyError(normalizeErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setForgotEmailError('');
    setForgotError('');
    const err = validateLoginEmail(forgotEmail);
    if (err) {
      setForgotEmailError(err);
      return;
    }
    setIsLoading(true);
    try {
      await authApi.forgotPassword({ email: forgotEmail.trim() });
      setTargetEmail(forgotEmail.trim());
      setResetCode('');
      setResetToken('');
      setResendAvailableAt(Date.now() + 60_000);
      setMode('resetVerify');
    } catch (err) {
      setForgotError(normalizeErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetOtpSubmit = async (code: string) => {
    if (isLoading) return;
    setResetCodeError('');
    setResetError('');
    if (!/^\d{6}$/.test(code)) {
      setResetCodeError('Please enter a valid 6-digit code.');
      return;
    }
    setIsLoading(true);
    try {
      const authorization = await authApi.verifyResetOtp({ email: targetEmail, code });
      setResetToken(authorization.resetToken);
      setResetCode(code);
      setMode('resetNew');
    } catch (err) {
      setResetError(normalizeErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setResetCodeError('');
    setResetPasswordError('');
    setResetError('');
    let hasErr = false;
    if (!resetPassword || resetPassword.length < 8) {
      setResetPasswordError('Password must be at least 8 characters.');
      hasErr = true;
    }
    if (resetPassword !== confirmResetPassword) {
      setResetPasswordError('Passwords do not match.');
      hasErr = true;
    }
    if (!resetToken) {
      setResetError('Please verify the reset code again.');
      return;
    }
    if (hasErr) return;

    setIsLoading(true);
    try {
      await authApi.resetPassword({ resetToken, newPassword: resetPassword });
      setResetToken('');
      setMode('resetSuccess');
    } catch (err) {
      setResetError(normalizeErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinueToLogin = () => {
    setLoginEmail(targetEmail);
    setLoginPassword('');
    handleSwitchMode('login');
  };

  const handleChangeVerificationEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    const newEmail = verificationEmail.trim().toLowerCase();
    if (!EMAIL_REGEX.test(newEmail)) {
      setChangeEmailError('Please enter a valid email address.');
      return;
    }
    setChangeEmailError('');
    setVerifyError('');
    setIsLoading(true);
    try {
      const result = await authApi.changeVerificationEmail({ currentEmail: targetEmail, password: loginPassword || registerData.password, newEmail });
      setTargetEmail(result.email);
      setVerifyCode('');
      setResendAvailableAt(Date.now() + 60_000);
      setResendVersion((version) => version + 1);
      setMode('verify');
      if (result.deliveryStatus === 'FAILED') {
        setVerifyError('We could not send a verification code to that address. Please try resending shortly.');
      } else {
        setVerifyError('A verification code was requested for the new address. It becomes active only after you verify the code.');
      }
    } catch (err) {
      setChangeEmailError(normalizeErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendReset = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setResetError('');
    try {
      const result = await authApi.resendPasswordReset({ email: targetEmail });
      setResendAvailableAt(new Date(result.resendAvailableAt).getTime());
      setResendVersion((version) => version + 1);
    } catch (err) {
      setResetError(normalizeErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!isLoading) onOpenChange(val);
      }}
    >
      <DialogContent
        className={styles.modalContent}
        overlayClassName={styles.overlay}
        hideCloseButton
        onInteractOutside={(e) => {
          if (isLoading) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isLoading) e.preventDefault();
        }}
      >
        <button
          type="button"
          className={styles.closeButton}
          onClick={() => {
            if (!isLoading) onOpenChange(false);
          }}
          aria-label="Close"
          disabled={isLoading}
        >
          <X size={20} />
        </button>

        <div className={styles.header}>
          <div className={styles.brand}>ElectroHub</div>
          <DialogTitle className={styles.title}>
            {mode === 'login' && 'Welcome Back'}
            {mode === 'register' && 'Create Account'}
            {(mode === 'verify' || mode === 'resetVerify') && 'Verify your email'}
            {mode === 'changeVerificationEmail' && 'Change email'}
            {mode === 'forgot' && 'Reset Password'}
            {mode === 'resetNew' && 'Create new password'}
            {mode === 'resetSuccess' && 'Password changed successfully'}
          </DialogTitle>
          <DialogDescription className={styles.description}>
            {mode === 'login' && 'Sign in to your account to continue'}
            {mode === 'register' && 'Join ElectroHub to start shopping'}
            {mode === 'verify' && `Enter the 6-digit code sent to ${maskEmail(targetEmail)}`}
            {mode === 'changeVerificationEmail' && 'Enter the corrected email address for your pending account.'}
            {mode === 'forgot' && 'Enter your email to receive a reset code'}
            {mode === 'resetVerify' && `Enter the 6-digit code sent to ${maskEmail(targetEmail)}`}
            {mode === 'resetNew' && 'Choose a new password for your account.'}
            {mode === 'resetSuccess' && 'Your password has been changed.'}
          </DialogDescription>
        </div>

        {mode === 'verify' && (
          <OtpVerification
            key={resendVersion}
            value={verifyCode}
            onChange={setVerifyCode}
            onSubmit={handleVerifySubmit}
            onResend={handleResendVerify}
            onBackToLogin={() => handleSwitchMode('login')}
            onChangeEmail={() => { setVerificationEmail(''); setChangeEmailError(''); setMode('changeVerificationEmail'); }}
            loading={isLoading}
            resendLoading={isLoading}
            resendCountdownSeconds={Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000))}
            error={verifyCodeError || verifyError}
            brandName=""
            title=""
          />
        )}

        {mode === 'forgot' && (
          <>
            {forgotError && (
              <Alert variant="error" className={styles.alert}>
                {forgotError}
              </Alert>
            )}
            <form onSubmit={handleForgotSubmit} className={styles.form} noValidate>
              <div className={styles.formGroup}>
                <Input
                  id="forgotEmail"
                  name="forgotEmail"
                  label="Email Address"
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  error={forgotEmailError}
                  fullWidth
                  disabled={isLoading}
                  placeholder="you@example.com"
                />
              </div>
              <Button type="submit" className={styles.submitButton} disabled={isLoading} isLoading={isLoading}>
                Send Reset Code
              </Button>
            </form>
            <div className={styles.footer}>
              <p><button type="button" onClick={() => handleSwitchMode('login')} className={styles.switchButton} disabled={isLoading}>Back to Login</button></p>
            </div>
          </>
        )}

        {mode === 'resetVerify' && (
          <>
            <OtpVerification
              key={`reset-${resendVersion}`}
              value={resetCode}
              onChange={setResetCode}
              onSubmit={handleResetOtpSubmit}
              onResend={handleResendReset}
              onBackToLogin={() => handleSwitchMode('login')}
              loading={isLoading}
              resendLoading={isLoading}
              resendCountdownSeconds={Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000))}
              error={resetCodeError || resetError}
              brandName=""
              title=""
            />
          </>
        )}

        {mode === 'changeVerificationEmail' && (
          <>
            {changeEmailError && <Alert variant="error" className={styles.alert}>{changeEmailError}</Alert>}
            <form onSubmit={handleChangeVerificationEmail} className={styles.form} noValidate>
              <Input label="New Email Address" type="email" value={verificationEmail} onChange={(event) => setVerificationEmail(event.target.value)} disabled={isLoading} fullWidth autoComplete="email" />
              <Button type="submit" className={styles.submitButton} disabled={isLoading} isLoading={isLoading}>Send Verification Code</Button>
            </form>
            <div className={styles.footer}><button type="button" onClick={() => setMode('verify')} className={styles.switchButton} disabled={isLoading}>Back to verification</button></div>
          </>
        )}

        {mode === 'resetNew' && (
          <>
            {resetError && (
              <Alert variant="error" className={styles.alert}>
                {resetError}
              </Alert>
            )}
            <form onSubmit={handleResetSubmit} className={styles.form} noValidate>
              <div className={styles.formGroup}>
                <PasswordInput
                  id="resetPassword"
                  name="resetPassword"
                  label="New Password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  error={resetPasswordError}
                  fullWidth
                  disabled={isLoading}
                  placeholder="Min. 8 characters"
                />
              </div>
              <div className={styles.formGroup}>
                <PasswordInput id="confirmResetPassword" label="Confirm Password" value={confirmResetPassword} onChange={(event) => setConfirmResetPassword(event.target.value)} disabled={isLoading} fullWidth autoComplete="new-password" />
              </div>
              <Button type="submit" className={styles.submitButton} disabled={isLoading} isLoading={isLoading}>
                Reset Password
              </Button>
            </form>
            <div className={styles.footer}>
              <p><button type="button" onClick={() => handleSwitchMode('login')} className={styles.switchButton} disabled={isLoading}>Back to Login</button></p>
            </div>
          </>
        )}

        {mode === 'resetSuccess' && <div className={styles.form}><Alert variant="success">Password changed successfully. Your password has been updated. You can now sign in with your new password.</Alert><Button type="button" className={styles.submitButton} onClick={handleContinueToLogin}>Continue to Login</Button></div>}

        {mode === 'login' && (
          <>
            {loginSuccess && <Alert variant="success" className={styles.alert}>{loginSuccess}</Alert>}
            {loginError && (
              <Alert variant="error" className={styles.alert}>
                {loginError}
              </Alert>
            )}

            <form onSubmit={handleLoginSubmit} className={styles.form} noValidate>
              <div className={styles.formGroup}>
                <Input
                  id="login-email"
                  name="email"
                  label="Email Address"
                  type="email"
                  value={loginEmail}
                  onChange={handleLoginEmailChange}
                  onBlur={() => handleLoginBlur('email')}
                  error={loginEmailError}
                  fullWidth
                  disabled={isLoading}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>

              <div className={styles.formGroup}>
                <PasswordInput
                  id="login-password"
                  name="password"
                  label="Password"
                  labelRight={
                    <button
                      type="button"
                      className={styles.forgotPassword}
                      onClick={() => {
                        handleSwitchMode('forgot');
                        setForgotEmail(loginEmail.trim());
                      }}
                      disabled={isLoading}
                    >
                      Forgot Password?
                    </button>
                  }
                  value={loginPassword}
                  onChange={handleLoginPasswordChange}
                  onBlur={() => handleLoginBlur('password')}
                  error={loginPasswordError}
                  fullWidth
                  disabled={isLoading}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
              </div>

              <Button
                type="submit"
                className={styles.submitButton}
                disabled={isLoading || hasLoginErrors}
                isLoading={isLoading}
              >
                {isLoading ? 'Logging in...' : 'Login'}
              </Button>
            </form>

            <div className={styles.footer}>
              <p>
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => handleSwitchMode('register')}
                  className={styles.switchButton}
                  disabled={isLoading}
                >
                  Register
                </button>
              </p>
            </div>
          </>
        )}
        
        {mode === 'register' && (
          <>
            {registerError && (
              <Alert variant="error" className={styles.alert}>
                {registerError}
              </Alert>
            )}

            <form onSubmit={handleRegisterSubmit} className={styles.form} noValidate>
              <div className={styles.formGroup}>
                <Input
                  id="fullName"
                  name="fullName"
                  label="Full Name"
                  value={registerData.fullName}
                  onChange={handleRegisterChange}
                  onBlur={() => handleRegisterBlur('fullName')}
                  error={registerErrors.fullName}
                  fullWidth
                  disabled={isLoading}
                  placeholder="Jane Smith"
                />
              </div>

              <div className={styles.formGroup}>
                <Input
                  id="email"
                  name="email"
                  label="Email Address"
                  type="email"
                  value={registerData.email}
                  onChange={handleRegisterChange}
                  onBlur={() => handleRegisterBlur('email')}
                  error={registerErrors.email}
                  fullWidth
                  disabled={isLoading}
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </div>

              <div className={styles.formGroup}>
                <PasswordInput
                  id="password"
                  name="password"
                  label="Password"
                  value={registerData.password}
                  onChange={handleRegisterChange}
                  onBlur={() => handleRegisterBlur('password')}
                  error={registerErrors.password}
                  fullWidth
                  disabled={isLoading}
                  autoComplete="new-password"
                  placeholder="Min. 8 characters"
                />
              </div>

              <div className={styles.formGroup}>
                <PasswordInput
                  id="confirmPassword"
                  name="confirmPassword"
                  label="Confirm Password"
                  value={registerData.confirmPassword}
                  onChange={handleRegisterChange}
                  onBlur={() => handleRegisterBlur('confirmPassword')}
                  error={registerErrors.confirmPassword}
                  fullWidth
                  disabled={isLoading}
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                />
              </div>

              <Button
                type="submit"
                className={styles.submitButton}
                disabled={isLoading || hasRegisterErrors}
                isLoading={isLoading}
              >
                {isLoading ? 'Creating account...' : 'Create Account'}
              </Button>
            </form>

            <div className={styles.footer}>
              <p>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => handleSwitchMode('login')}
                  className={styles.switchButton}
                  disabled={isLoading}
                >
                  Login
                </button>
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
