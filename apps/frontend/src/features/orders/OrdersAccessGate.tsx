import { useRef, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { CircleAlert } from 'lucide-react';
import { useAuth } from '@/features/auth/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import styles from './Orders.module.scss';

/**
 * Shared session boundary for /orders and /orders/:orderReference. No private request is made and no
 * empty/zero state is shown until the session is verified; guests get the existing sign-in experience.
 */
export function OrdersAccessGate({ title, loading, children }: { title: string; loading: ReactNode; children: ReactNode }) {
  const { isAuthenticated, isInitializing, isLoggingOut, sessionUnavailable, retrySession } = useAuth();
  // An explicit sign-out that began while this page was open: the session is cleared and the logout flag may drop before the router has
  // swapped the route, so remember it for this mount. Neither the customer's data nor the guest sign-in card may appear in between.
  const signedOutHere = useRef(false);
  if (isLoggingOut) signedOutHere.current = true;
  if (isLoggingOut || (signedOutHere.current && !isAuthenticated)) {
    return <main className={styles.page} aria-busy="true"><h1 className={styles.gateTitle}>{title}</h1>{loading}
      {signedOutHere.current && !isLoggingOut && !isInitializing && <Navigate to="/" replace />}</main>;
  }
  if (isInitializing && sessionUnavailable) return <main className={styles.page}><h1 className={styles.gateTitle}>{title}</h1>
    <ErrorState title="We could not verify your session." description="Your orders are safe. Please try again."
      action={<Button onClick={retrySession}>Retry</Button>} /></main>;
  if (isInitializing) return <main className={styles.page}><h1 className={styles.gateTitle}>{title}</h1>{loading}</main>;
  if (isAuthenticated) return <>{children}</>;
  return <main className={styles.signIn}><section className={styles.signInCard} aria-labelledby="sign-in-required">
    <div className={styles.signInIcon}><CircleAlert size={32} aria-hidden="true" /></div>
    <h1 id="sign-in-required">Sign In Required</h1>
    <p>Please sign in to access this page.</p>
    <Button type="button" onClick={() => window.dispatchEvent(new Event('electrohub:open-auth'))}>Sign In</Button>
  </section></main>;
}
