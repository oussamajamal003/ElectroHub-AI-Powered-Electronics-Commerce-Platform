import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/context/AuthContext';
import { ApiError } from '@/lib/api';

/** Why the administrator is on the sign-in page after ending every session from the profile. Read once by AdminLoginPage. */
export type AdminSignInNotice = 'PASSWORD_CHANGED' | 'ACCOUNT_DELETED' | 'OWNERSHIP_TRANSFERRED';
export const SIGN_IN_NOTICE_KEY = 'eh.admin-sign-in-notice';

export const failureMessage = (error: unknown, fallback: string) => {
  if (error instanceof ApiError && error.status === 0) return 'Unable to connect. Check your connection and try again.';
  if (error instanceof ApiError && error.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  return error instanceof ApiError && error.message ? error.message : fallback;
};

/** After a change that revoked every session server-side: drop local auth state and private caches, then sign in afresh. */
export function useEndAdminSession() {
  const { clearSession } = useAuth();
  const navigate = useNavigate();
  return (notice: AdminSignInNotice) => {
    // Clearing auth makes the admin route guard redirect to sign-in with its own state, which can replace ours: hand the notice over
    // through sessionStorage as well (a fixed value, read and removed by the sign-in page).
    try { window.sessionStorage.setItem(SIGN_IN_NOTICE_KEY, notice); } catch { /* the state below still carries it when storage is blocked */ }
    clearSession();
    navigate('/admin/login', { replace: true, state: { notice } });
  };
}
