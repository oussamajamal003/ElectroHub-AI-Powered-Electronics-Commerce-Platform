import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/context/AuthContext';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';

interface ProtectedRouteProps {
  requiredRole?: string;
  redirectTo?: string;
  requireVerifiedSession?: boolean;
  preserveReturnPath?: boolean;
}

export function ProtectedRoute({ requiredRole, redirectTo = '/', requireVerifiedSession = false, preserveReturnPath = false }: ProtectedRouteProps) {
  const { isAuthenticated, user, isInitializing, isSessionVerified, isLoggingOut } = useAuth();
  const location = useLocation();

  if (isInitializing || (requireVerifiedSession && !isSessionVerified)) {
    return <ElectroHubLoader page />;
  }

  if (!isAuthenticated || !user) {
    // Explicit sign-out always lands on the public Home route; only a guest arriving at a protected URL follows `redirectTo` and keeps a return path.
    if (isLoggingOut) return <Navigate to="/" replace />;
    return <Navigate to={redirectTo} replace state={preserveReturnPath ? { from: location.pathname } : undefined} />;
  }

  if (requiredRole && user.role !== requiredRole) {
    // Authenticated but unauthorized
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
