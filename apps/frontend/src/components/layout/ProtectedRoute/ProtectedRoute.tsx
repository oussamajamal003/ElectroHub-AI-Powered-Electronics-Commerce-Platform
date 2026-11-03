import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/context/AuthContext';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';

interface ProtectedRouteProps {
  requiredRole?: string;
  redirectTo?: string;
  requireVerifiedSession?: boolean;
  preserveReturnPath?: boolean;
  /** Where an explicit sign-out lands (customer default: Home; the admin console returns to its own login). */
  logoutRedirectTo?: string;
}

export function ProtectedRoute({ requiredRole, redirectTo = '/', requireVerifiedSession = false, preserveReturnPath = false, logoutRedirectTo = '/' }: ProtectedRouteProps) {
  const { isAuthenticated, user, isInitializing, isSessionVerified, isLoggingOut } = useAuth();
  const location = useLocation();

  if (isInitializing || (requireVerifiedSession && !isSessionVerified)) {
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
