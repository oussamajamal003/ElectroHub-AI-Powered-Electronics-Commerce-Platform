import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/context/AuthContext';
import { ApiError, apiClient } from '@/lib/api';
import { catalogSignal, queryKeys } from '@/lib/query';
import { Button } from '@/components/ui/Button';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import { ConfirmationContent } from './CheckoutComponents';
import type { Confirmation } from './types';
import styles from './Checkout.module.scss';

export function ConfirmationPage() {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);
  const { user, isSessionVerified, isLoggingOut } = useAuth(); const { orderReference = '' } = useParams();
  const query = useQuery({ queryKey: queryKeys.orders.confirmation(user?.id ?? '', orderReference),
    queryFn: context => apiClient<{ data: Confirmation }>(`/api/orders/${encodeURIComponent(orderReference)}/confirmation`, { signal: catalogSignal(context) }),
    enabled: isSessionVerified && Boolean(user) && !isLoggingOut, retry: false });
  useEffect(() => {
    if (query.data) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  }, [query.data]);
  if (query.data) return <><ConfirmationContent order={query.data.data} ownerId={user?.id} />{query.isError && <p role="alert">The saved order is visible, but could not be refreshed.</p>}</>;
  if (query.isPending) return <ElectroHubLoader page />;
  // 404/400 is the owner-scoped answer for a missing order or one owned by another account (no details are disclosed); anything else is temporary.
  const notFound = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400);
  return <div className={`${styles.page} ${styles.empty}`} role="alert"><h1>Confirmation unavailable</h1><p>{notFound
    ? 'We could not find this order for the signed-in account. If you placed it with another account, sign in with that account.'
    : 'We could not load this confirmation right now. Your order is not affected; please try again.'}</p><Button onClick={() => void query.refetch()}>Retry confirmation</Button><Link to="/products">Continue Shopping</Link></div>;
}
