import { useEffect, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { adminSecurityKeys, useAdminProfile } from '@/features/admin/security/api';
import { canAccessAdministrators, isCapabilityDenied } from '@/features/admin/security/administratorsAccess';
import { AdminPageSkeleton, ButtonLink, PageHeader, QueryProblem } from '@/features/admin/shared/AdminUi';
import styles from '@/features/admin/shared/AdminPages.module.scss';

/** Shown instead of the team page to an administrator without Owner or administrator-management access. */
export function AccessRestricted() {
  const heading = useRef<HTMLHeadingElement>(null);
  // Moves focus here when the page is swapped out mid-session, so keyboard and screen-reader users are not left on a removed control.
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <div className={styles.page}>
    <section className={styles.restricted} aria-labelledby="access-restricted-title">
      <span className={styles.restrictedIcon} aria-hidden="true"><ShieldAlert size={24} /></span>
      <h1 id="access-restricted-title" ref={heading} tabIndex={-1} className={styles.restrictedTitle}>Access Restricted</h1>
      <p className={styles.restrictedText}>
        You don&apos;t have permission to view or manage administrator accounts. Contact an Owner if you need access.
      </p>
      <ButtonLink to="/admin">Back to Dashboard</ButtonLink>
    </section>
  </div>;
}

/**
 * Renders the Administrators page only for an administrator whose (server-reported) capabilities allow it. The page, and with it
 * every team/invitation request, is not mounted while capabilities load or when they deny access. A CAPABILITY_REQUIRED answer to
 * any request made meanwhile (access removed during the session) refreshes the capabilities, which then swaps the page out.
 */
export function AdministratorsAccessGate({ children }: { children: ReactNode }) {
  const profile = useAdminProfile();
  const client = useQueryClient();

  useEffect(() => {
    const refresh = (error: unknown) => {
      if (isCapabilityDenied(error)) void client.invalidateQueries({ queryKey: adminSecurityKeys.profile, exact: true });
    };
    const stopQueries = client.getQueryCache().subscribe(event => {
      if (event.type === 'updated' && event.action.type === 'error') refresh(event.action.error);
    });
    const stopMutations = client.getMutationCache().subscribe(event => {
      if (event.type === 'updated' && event.action.type === 'error') refresh(event.action.error);
    });
    return () => { stopQueries(); stopMutations(); };
  }, [client]);

  if (profile.isPending) return <AdminPageSkeleton />;
  if (!profile.data) {
    // A genuine failure to learn the capabilities (network/server): an error with retry, never "Access Restricted".
    return <div className={styles.page}>
      <PageHeader title="Administrators" crumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Settings', to: '/admin/settings' }, { label: 'Administrators' }]} />
      <QueryProblem error={profile.error} hasData={false} onRetry={() => void profile.refetch()} retrying={profile.isFetching}
        what="Your administrator permissions" />
    </div>;
  }
  if (!canAccessAdministrators(profile.data.capabilities)) return <AccessRestricted />;
  return <>{children}</>;
}
