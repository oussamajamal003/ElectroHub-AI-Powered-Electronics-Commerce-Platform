import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useAdminProfile, useUpdateAdminProfile, type AdminProfile } from '@/features/admin/security/api';
import { AdminPageSkeleton, ButtonLink, PageHeader, QueryProblem, StatusPill, useAdminToast } from '@/features/admin/shared/AdminUi';
import { fieldErrors } from '@/features/admin/shared/api';
import styles from '@/features/admin/shared/AdminPages.module.scss';

export function AdminProfilePage() {
  const profile = useAdminProfile();
  const data = profile.data;
  return <div className={styles.page}>
    <PageHeader title="My Profile" crumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'My Profile' }]}
      description="Your administrator identity, access and personal security settings." />
    {profile.isPending && <AdminPageSkeleton />}
    {profile.isError && !data && <QueryProblem error={profile.error} hasData={false} onRetry={() => void profile.refetch()} retrying={profile.isFetching} what="Your profile" />}
    {data && <ProfileContent profile={data} />}
  </div>;
}

/** Mounted once the profile is loaded, so the form starts from the saved values; a successful save updates the baseline. */
function ProfileContent({ profile }: { profile: AdminProfile }) {
  const save = useUpdateAdminProfile();
  const { updateUserNames } = useAuth();
  const toast = useAdminToast();
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [formError, setFormError] = useState('');
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const dirty = firstName.trim() !== profile.firstName || lastName.trim() !== profile.lastName;
  const { capabilities } = profile;
  const access = [
    capabilities.isOwner && 'Owner',
    capabilities.canManageAdmins && 'Manage administrators',
  ].filter(Boolean) as string[];

  const discard = () => {
    setFirstName(profile.firstName);
    setLastName(profile.lastName);
    setFormError('');
    setFieldError({});
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || save.isPending) return;
    const nextFirst = firstName.trim();
    const nextLast = lastName.trim();
    const local: Record<string, string> = {};
    if (!nextFirst) local.firstName = 'Enter your first name.';
    if (!nextLast) local.lastName = 'Enter your last name.';
    setFieldError(local);
    setFormError('');
    if (Object.keys(local).length) return;
    try {
      const updated = await save.mutateAsync({ firstName: nextFirst, lastName: nextLast });
      updateUserNames(profile.id, { firstName: updated.firstName, lastName: updated.lastName });
      toast('Profile saved.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        setFormError('Your profile was changed somewhere else. Reload the page to see the latest details.');
      } else if (err instanceof ApiError && err.status === 0) {
        setFormError('Unable to connect. Check your connection and try again.');
      } else {
        const server = fieldErrors(err);
        setFieldError(server);
        if (Object.keys(server).length === 0) setFormError(err instanceof ApiError ? err.message : 'Your changes could not be saved. Try again.');
      }
    }
  };

  return <>
    <div className={styles.split}>
      <section className={styles.panel} aria-labelledby="profile-details-title">
        <div className={styles.panelHeader}>
          <h2 id="profile-details-title" className={styles.panelTitle}>Personal details</h2>
          {dirty && <span className={styles.panelHint}>Unsaved changes</span>}
        </div>
        {formError && <Alert variant="error">{formError}</Alert>}
        <form className={styles.form} onSubmit={submit} noValidate>
          <div className={styles.fieldGrid}>
            <Input id="profile-first-name" name="firstName" label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)}
              error={fieldError.firstName} autoComplete="given-name" maxLength={100} fullWidth disabled={save.isPending} />
            <Input id="profile-last-name" name="lastName" label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)}
              error={fieldError.lastName} autoComplete="family-name" maxLength={100} fullWidth disabled={save.isPending} />
          </div>
          <Input id="profile-email" name="email" label="Email address" value={profile.email} readOnly fullWidth autoComplete="email"
            helperText={profile.emailVerified ? 'Verified. Email changes are not available from this page.' : 'Not verified. Email changes are not available from this page.'} />
          <div className={styles.formActions}>
            <Button type="button" variant="outline" onClick={discard} disabled={!dirty || save.isPending}>Discard</Button>
            <Button type="submit" disabled={!dirty} isLoading={save.isPending}>Save changes</Button>
          </div>
        </form>
      </section>

      <div className={styles.stack}>
        <section className={styles.panel} aria-labelledby="profile-access-title">
          <div className={styles.panelHeader}>
            <h2 id="profile-access-title" className={styles.panelTitle}>Role and access</h2>
          </div>
          <dl className={styles.details}>
            <dt>Role</dt>
            <dd><StatusPill tone="primary" icon={false}>Administrator</StatusPill></dd>
            <dt>Capabilities</dt>
            <dd>
              {access.length
                ? <span className={styles.tags}>{access.map(label => <StatusPill key={label} tone="info" icon={false}>{label}</StatusPill>)}</span>
                : <span className={styles.muted}>Standard administrator</span>}
            </dd>
          </dl>
        </section>

        <section className={styles.panel} aria-labelledby="profile-links-title">
          <div className={styles.panelHeader}>
            <h2 id="profile-links-title" className={styles.panelTitle}>Security</h2>
          </div>
          <p className={styles.panelHint}>Manage how you sign in and where you are signed in.</p>
          <div className={styles.actionsStart}>
            <ButtonLink to="/admin/profile/security" variant="outline"><ShieldCheck aria-hidden="true" /> Security</ButtonLink>
            <ButtonLink to="/admin/profile/sessions" variant="outline"><KeyRound aria-hidden="true" /> Sessions and login history</ButtonLink>
          </div>
          <p className={styles.panelHint}>
            Changes to your sign-in methods ask you to confirm it is you. <Link className={styles.panelLink} to="/admin">Back to dashboard</Link>
          </p>
        </section>
      </div>
    </div>
  </>;
}
