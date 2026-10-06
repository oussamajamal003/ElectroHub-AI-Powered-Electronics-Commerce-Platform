import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/context/AuthContext';
import { apiClient } from '@/lib/api';
import { catalogSignal, queryKeys } from '@/lib/query';
import { Button } from '@/components/ui/Button';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import { ConfirmationContent } from './CheckoutComponents';
import type { Confirmation } from './types';
import styles from './Checkout.module.scss';

export function ConfirmationPage() {
  const { user, isSessionVerified } = useAuth(); const { orderReference = '' } = useParams();
  const query = useQuery({ queryKey: queryKeys.orders.confirmation(user?.id ?? '', orderReference),
    queryFn: context => apiClient<{ data: Confirmation }>(`/api/orders/${encodeURIComponent(orderReference)}/confirmation`, { signal: catalogSignal(context) }),
    enabled: isSessionVerified && Boolean(user), retry: false });
  if (query.data) return <><ConfirmationContent order={query.data.data} />{query.isError && <p role="alert">The saved order is visible, but could not be refreshed.</p>}</>;
  if (query.isPending) return <ElectroHubLoader page />;
  return <div className={`${styles.page} ${styles.empty}`} role="alert"><h1>Confirmation unavailable</h1><p>We could not find an order for this account or load its confirmation.</p><Button onClick={() => void query.refetch()}>Retry confirmation</Button><Link to="/products">Continue Shopping</Link></div>;
}
