import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/context/AuthContext';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/Breadcrumb';
import { Avatar } from '@/components/ui/Avatar';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput/PasswordInput';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Footer } from '@/components/layout/Footer';
import { ApiError } from '@/lib/api';
import { OtpVerification } from '@/components/ui/OtpVerification';
import { authApi } from '@/features/auth/api/auth';
import styles from './ProfilePage.module.scss';

export function ProfilePage() {
  const { user, updateProfile, verifyEmailChange } = useAuth();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || '',
  });
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [resendAvailableAt, setResendAvailableAt] = useState(0);

  useEffect(() => {
    setFormData({ firstName: user?.firstName || '', lastName: user?.lastName || '', email: user?.email || '' });
  }, [user?.firstName, user?.lastName, user?.email]);

  const initial = user?.firstName?.[0]?.toUpperCase() || 'U';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!formData.firstName.trim() || !formData.lastName.trim() || formData.firstName.trim().length > 100 || formData.lastName.trim().length > 100) {
      setError('Enter a valid first and last name (up to 100 characters each).');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (formData.firstName.trim() === user?.firstName && formData.lastName.trim() === user?.lastName && formData.email.trim().toLowerCase() === user?.email.toLowerCase()) {
      setSuccess('No changes to save.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await updateProfile({
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        email: formData.email.trim(),
      });
      if (response.user?.requiresEmailVerification && response.user.pendingEmail) {
        setPendingEmail(response.user.pendingEmail);
        setOtp('');
        setResendAvailableAt(Date.now() + 60_000);
        setSuccess(response.user.verificationDeliveryStatus === 'FAILED'
          ? 'The address is pending verification, but we could not send its code. Use Resend code when available.'
          : 'A verification code was requested for the new address. Your current verified email remains active until you enter the code.');
      } else {
        setSuccess('Profile updated successfully.');
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to update profile. Please try again later.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.breadcrumbWrapper}>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/">Home</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/account">Account</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>My Profile</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        <h1 className={styles.pageTitle}>My Profile</h1>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <Avatar initials={initial} className={styles.avatar} />
            <p className={styles.subtext}>Your profile information</p>
          </div>

          <form className={styles.form} onSubmit={handleSave}>
            {error && <Alert variant="error">{error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}

            <Input
              label="First Name"
              name="firstName"
              value={formData.firstName}
              onChange={handleChange}
              disabled={isLoading}
              fullWidth
            />
            <Input
              label="Last Name"
              name="lastName"
              value={formData.lastName}
              onChange={handleChange}
              disabled={isLoading}
              fullWidth
            />
            <Input
              label="Email Address"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              disabled={isLoading || Boolean(pendingEmail)}
              autoComplete="email"
              fullWidth
            />

            <div className={styles.formActions}>
              <Button
                type="button"
                variant="outline"
                className={styles.cancelBtn}
                onClick={() => navigate('/account')}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                className={styles.saveBtn}
                disabled={isLoading}
                isLoading={isLoading}
              >
                Save Profile
              </Button>
            </div>
          </form>

            {pendingEmail && <OtpVerification
              value={otp}
              onChange={setOtp}
              email={pendingEmail}
              subtitle={`Enter the 6-digit code sent to ${pendingEmail}`}
              loading={isLoading}
              onSubmit={async (code) => {
                setIsLoading(true);
                setError('');
                try {
                  await verifyEmailChange(code);
                  setPendingEmail('');
                  setFormData((current) => ({ ...current, email: pendingEmail }));
                  setSuccess('Email changed successfully.');
                } catch (verifyError) {
                  setError(verifyError instanceof ApiError ? verifyError.message : 'Unable to verify this email. Please try again.');
                } finally {
                  setIsLoading(false);
                }
              }}
              resendCountdownSeconds={Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000))}
              onResend={async () => {
                setIsLoading(true);
                try {
                  const result = await authApi.resendEmailChange();
                  setResendAvailableAt(new Date(result.resendAvailableAt).getTime());
                } catch (resendError) {
                  setError(resendError instanceof ApiError ? resendError.message : 'Unable to resend the code. Please try again.');
                } finally {
                  setIsLoading(false);
                }
              }}
              error={error}
              brandName=""
              title="Verify your new email"
            />}

        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.sectionTitle}>Change Password</h2>
            <p className={styles.subtext}>Ensure your account is using a strong password</p>
          </div>

          <PasswordChangeForm />
        </div>
      </div>
      <Footer />
    </div>
  );
}

function PasswordChangeForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!currentPassword) {
      setError('Current password is required.');
      return;
    }
    if (!newPassword) {
      setError('New password is required.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const { authApi } = await import('@/features/auth/api/auth');
      await authApi.changePassword({ currentPassword, newPassword });
      setSuccess('Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to change password. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <PasswordInput
        label="Current Password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        placeholder="Enter your current password"
        disabled={isLoading}
        fullWidth
      />

      <PasswordInput
        label="New Password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        placeholder="At least 8 characters"
        disabled={isLoading}
        fullWidth
      />

      <PasswordInput
        label="Confirm New Password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        placeholder="Repeat new password"
        disabled={isLoading}
        fullWidth
      />

      <div className={styles.formActions}>
        <Button
          type="submit"
          variant="primary"
          className={styles.saveBtn}
          disabled={isLoading}
          isLoading={isLoading}
        >
          Change Password
        </Button>
      </div>
    </form>
  );
}
