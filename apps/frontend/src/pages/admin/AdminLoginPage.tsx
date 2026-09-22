import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/features/auth/context/AuthContext';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { ApiError } from '@/lib/api';
import styles from './AdminLoginPage.module.scss';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AdminLoginPage() {
  const { login, logout, isAuthenticated, user, isInitializing } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [touched, setTouched] = useState({ email: false, password: false });
  const [submitted, setSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // If already authenticated as admin, redirect to dashboard
  if (!isInitializing && isAuthenticated && user?.role === 'ADMIN') {
    return <Navigate to="/admin" replace />;
  }

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
      if (loggedInUser?.role !== 'ADMIN') {
        await logout();
        setError('Access denied. Administrator privileges required.');
        return;
      }
      navigate('/admin', { replace: true });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.loginCard}>
        <div className={styles.header}>
          <div className={styles.brand}>ElectroHub</div>
          <h1 className={styles.title}>Sign In to Admin</h1>
          <p className={styles.description}>Admin Portal</p>
        </div>

        {error && (
          <Alert variant="error" className={styles.alert}>
            {error}
          </Alert>
        )}

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
      </div>
    </div>
  );
}
