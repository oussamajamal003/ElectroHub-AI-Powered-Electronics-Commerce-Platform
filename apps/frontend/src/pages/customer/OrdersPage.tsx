import { CircleAlert } from 'lucide-react';
import { useAuth } from '@/features/auth/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { PlaceholderPage } from '@/pages/PlaceholderPage';
import styles from './OrdersPage.module.scss';

export function OrdersPage() {
  const { isAuthenticated, isInitializing } = useAuth();

  if (isInitializing) return <main className={styles.page}><div className={styles.loading} role="status" aria-label="Checking sign-in status" /></main>;
  if (isAuthenticated) return <PlaceholderPage title="My Orders" type="orders" description="Your order history will appear here." />;

  return <main className={styles.page}><section className={styles.card} aria-labelledby="sign-in-required">
    <div className={styles.icon}><CircleAlert size={32} aria-hidden="true" /></div>
    <h1 id="sign-in-required">Sign In Required</h1>
    <p>Please sign in to access this page.</p>
    <Button type="button" onClick={() => window.dispatchEvent(new Event('electrohub:open-auth'))}>Sign In</Button>
  </section></main>;
}
