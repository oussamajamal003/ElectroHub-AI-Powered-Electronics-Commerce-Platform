import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/context/AuthContext';

interface ProtectedRouteProps {
  requiredRole?: string;
  redirectTo?: string;
}

export function ProtectedRoute({ requiredRole, redirectTo = '/' }: ProtectedRouteProps) {
  const { isAuthenticated, user, isInitializing } = useAuth();

  if (isInitializing) {
    return <div>Loading...</div>; // Or a proper full-page skeleton
  }

  if (!isAuthenticated || !user) {
    return <Navigate to={redirectTo} replace />;
  }

  if (requiredRole && user.role !== requiredRole) {
    // Authenticated but unauthorized
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
