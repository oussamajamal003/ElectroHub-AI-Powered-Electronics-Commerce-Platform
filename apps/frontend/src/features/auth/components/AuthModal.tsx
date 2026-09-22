import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { useAuth } from '../context/AuthContext';
import styles from './AuthModals.module.scss';
import { ApiError } from '@/lib/api';
import { Eye, EyeOff, X } from 'lucide-react';

import { useNavigate, useLocation } from 'react-router-dom';

export type AuthModalMode = 'login' | 'register';

export interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: AuthModalMode;
  onSwitchToRegister?: () => void;
  onSwitchToLogin?: () => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeErrorMessage = (err: unknown): string => {
  if (err instanceof ApiError) {
    return typeof err.message === 'string' ? err.message : 'An unexpected error occurred.';
  }
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'object' && err !== null) {
    const obj = err as { message?: unknown; error?: unknown };
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;
    return JSON.stringify(err);
  }
  if (typeof err === 'string') return err;
  return 'An unexpected error occurred.';
};

export function AuthModal({
  open,
  onOpenChange,
  initialMode = 'login',
  onSwitchToRegister,
  onSwitchToLogin,
}: AuthModalProps) {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string })?.from || '/account';
  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [isLoading, setIsLoading] = useState(false);

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginTouched, setLoginTouched] = useState({ email: false, password: false });
  const [loginSubmitted, setLoginSubmitted] = useState(false);
  const [loginEmailError, setLoginEmailError] = useState('');
  const [loginPasswordError, setLoginPasswordError] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState('');

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
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] = useState(false);
  const [registerError, setRegisterError] = useState('');

  // Sync mode with initialMode when dialog opens or initialMode changes
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setLoginError('');
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
    }
  }, [open, initialMode]);

  const handleSwitchMode = (newMode: AuthModalMode) => {
    if (isLoading) return;
    setMode(newMode);
    setLoginError('');
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
      setLoginError(normalizeErrorMessage(err));
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
      await register({
        email: registerData.email.trim(),
        password: registerData.password,
        firstName,
        lastName,
      });

      // Successful register + auto-login immediately transitions to authenticated state
      setRegisterData({
        fullName: '',
        email: '',
        password: '',
        confirmPassword: '',
      });
      onOpenChange(false);
      navigate(from, { replace: true });
    } catch (err: unknown) {
      setRegisterError(normalizeErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const isLogin = mode === 'login';

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
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </DialogTitle>
          <DialogDescription className={styles.description}>
            {isLogin
              ? 'Sign in to your account to continue'
              : 'Join ElectroHub to start shopping'}
          </DialogDescription>
        </div>

        {isLogin ? (
          <>
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
                <Input
                  id="login-password"
                  name="password"
                  label="Password"
                  labelRight={
                    <button
                      type="button"
                      className={styles.forgotPassword}
                      onClick={() => {}}
                      disabled={isLoading}
                    >
                      Forgot Password?
                    </button>
                  }
                  type={showLoginPassword ? 'text' : 'password'}
                  value={loginPassword}
                  onChange={handleLoginPasswordChange}
                  onBlur={() => handleLoginBlur('password')}
                  error={loginPasswordError}
                  fullWidth
                  disabled={isLoading}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  endAdornment={
                    <button
                      type="button"
                      className={styles.eyeButton}
                      onClick={() => setShowLoginPassword(!showLoginPassword)}
                      aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                      disabled={isLoading}
                    >
                      {showLoginPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  }
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
        ) : (
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
                <Input
                  id="password"
                  name="password"
                  label="Password"
                  type={showRegisterPassword ? 'text' : 'password'}
                  value={registerData.password}
                  onChange={handleRegisterChange}
                  onBlur={() => handleRegisterBlur('password')}
                  error={registerErrors.password}
                  fullWidth
                  disabled={isLoading}
                  autoComplete="new-password"
                  placeholder="Min. 8 characters"
                  endAdornment={
                    <button
                      type="button"
                      className={styles.eyeButton}
                      onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                      aria-label={showRegisterPassword ? 'Hide password' : 'Show password'}
                      disabled={isLoading}
                    >
                      {showRegisterPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  }
                />
              </div>

              <div className={styles.formGroup}>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  label="Confirm Password"
                  type={showRegisterConfirmPassword ? 'text' : 'password'}
                  value={registerData.confirmPassword}
                  onChange={handleRegisterChange}
                  onBlur={() => handleRegisterBlur('confirmPassword')}
                  error={registerErrors.confirmPassword}
                  fullWidth
                  disabled={isLoading}
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                  endAdornment={
                    <button
                      type="button"
                      className={styles.eyeButton}
                      onClick={() => setShowRegisterConfirmPassword(!showRegisterConfirmPassword)}
                      aria-label={showRegisterConfirmPassword ? 'Hide password' : 'Show password'}
                      disabled={isLoading}
                    >
                      {showRegisterConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  }
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
