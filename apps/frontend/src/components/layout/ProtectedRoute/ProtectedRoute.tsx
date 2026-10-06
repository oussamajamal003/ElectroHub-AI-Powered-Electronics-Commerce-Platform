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
  const { isAuthenticated, user, isInitializing, isSessionVerified } = useAuth();
  const location = useLocation();

  if (isInitializing || (requireVerifiedSession && !isSessionVerified)) {
    return <ElectroHubLoader page />;
  }

  if (!isAuthenticated || !user) {
    return <Navigate to={redirectTo} replace state={preserveReturnPath ? { from: location.pathname } : undefined} />;
  }

  if (requiredRole && user.role !== requiredRole) {
    // Authenticated but unauthorized
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
