import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAdminAuth, useAuth } from '@/features/auth/context/AuthContext';
import { CustomerAccountSkeleton, AdminAccountSkeleton } from '@/features/account/AccountSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import skeletonStyles from '@/features/account/AccountSkeleton.module.scss';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import { AdminSessionRestoreShell } from '@/layouts/AdminShellFrame';

interface ProtectedRouteProps {
  requiredRole?: string;
  redirectTo?: string;
  requireVerifiedSession?: boolean;
  preserveReturnPath?: boolean;
  /** Where an explicit sign-out lands (customer default: Home; the admin console returns to its own login). */
  logoutRedirectTo?: string;
}

type Session = ReturnType<typeof useAuth>;

/** Task 05.2: each portal checks only its own session. An ADMIN route consults the administrator session and every other route the
 * storefront session, so a signed-in administrator is never "the customer" and a customer is never "the administrator". */
export function ProtectedRoute(props: ProtectedRouteProps) {
  return props.requiredRole === 'ADMIN' ? <AdminRouteGate {...props} /> : <CustomerRouteGate {...props} />;
}
function AdminRouteGate(props: ProtectedRouteProps) { return <RouteGate session={useAdminAuth()} {...props} />; }
function CustomerRouteGate(props: ProtectedRouteProps) { return <RouteGate session={useAuth()} {...props} />; }

function RouteGate({ session, requiredRole, redirectTo = '/', requireVerifiedSession = false, preserveReturnPath = false, logoutRedirectTo = '/' }:
  ProtectedRouteProps & { session: Session }) {
  const { isAuthenticated, user, isInitializing, isSessionVerified, isLoggingOut, sessionUnavailable, retrySession } = session;
  const location = useLocation();

  if (isInitializing || (requireVerifiedSession && !isSessionVerified)) {
    if (sessionUnavailable) return <div className={skeletonStyles.gate}><ErrorState title="We could not verify your session."
      description="Please try again to securely load your account." action={<Button onClick={retrySession}>Retry</Button>} /></div>;
    if (location.pathname === '/account' || location.pathname === '/account/profile') {
      return <CustomerAccountSkeleton variant={location.pathname.endsWith('/profile') ? 'profile' : 'account'} />;
    }
    if (location.pathname.startsWith('/admin/profile')) {
      const variant = location.pathname.endsWith('/security') ? 'security' : location.pathname.endsWith('/sessions') ? 'sessions' : 'profile';
      // The real console frame (header, sidebar, drawer) with the page skeleton where the page will render; no administrator data yet.
      return <AdminSessionRestoreShell><AdminAccountSkeleton variant={variant} /></AdminSessionRestoreShell>;
    }
    return <ElectroHubLoader page />;
  }

  if (!isAuthenticated || !user) {
    // Explicit sign-out lands on `logoutRedirectTo` (public Home by default); only a guest arriving at a protected URL follows `redirectTo` and keeps a return path.
    if (isLoggingOut) return <Navigate to={logoutRedirectTo} replace />;
    // `search` travels separately so path-only consumers (customer return paths) are unaffected; the admin login restores filters from it.
    return <Navigate to={redirectTo} replace state={preserveReturnPath ? { from: location.pathname, search: location.search } : undefined} />;
  }

  if (requiredRole && user.role !== requiredRole) {
    // Authenticated but unauthorized
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
