import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/context/AuthContext';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/Breadcrumb';
import { Avatar } from '@/components/ui/Avatar';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Footer } from '@/components/layout/Footer';
import { ApiError } from '@/lib/api';
import styles from './ProfilePage.module.scss';

export function ProfilePage() {
  const { user, updateProfile } = useAuth();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
  });
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const initial = user?.firstName?.[0]?.toUpperCase() || 'U';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');

    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      setError('First and last name are required.');
      return;
    }

    setIsLoading(true);
    try {
      await updateProfile({
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
      });
      setSuccess('Profile updated successfully.');
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

          <div className={styles.form}>
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
              value={user?.email || ''}
              disabled
              fullWidth
            />

            <div className={styles.formActions}>
              <Button
                variant="outline"
                className={styles.cancelBtn}
                onClick={() => navigate('/account')}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className={styles.saveBtn}
                disabled={isLoading}
                isLoading={isLoading}
                onClick={handleSave}
              >
                Save Profile
              </Button>
            </div>
          </div>
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

      <Input
        label="Current Password"
        type="password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        placeholder="Enter your current password"
        disabled={isLoading}
        fullWidth
      />

      <Input
        label="New Password"
        type="password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        placeholder="At least 8 characters"
        disabled={isLoading}
        fullWidth
      />

      <Input
        label="Confirm New Password"
        type="password"
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
