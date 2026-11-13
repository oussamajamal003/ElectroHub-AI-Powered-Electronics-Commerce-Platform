import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Package } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { useAuth } from '@/features/auth/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { OrderBadges } from '@/features/orders/OrderBadges';
import { formatDate, formatMoney } from '@/features/orders/presentation';
import { ORDERS_PAGE_SIZE, type OrdersPageResponse } from '@/features/orders/types';
import styles from './RecentOrders.module.scss';

function useRecentOrders() {
  const { user, isSessionVerified, isLoggingOut } = useAuth();
  return useQuery({ queryKey: queryKeys.orders.list(user?.id ?? '', 1, ORDERS_PAGE_SIZE),
    queryFn: ({ signal }) => apiClient<OrdersPageResponse>(`/api/orders?page=1&pageSize=${ORDERS_PAGE_SIZE}`, { signal }),
    enabled: Boolean(user && isSessionVerified && !isLoggingOut), retry: false, staleTime: 10_000 });
}

export function RecentOrders() {
  const query = useRecentOrders();
  return <>
    {query.isPending && <div className={styles.list} role="status" aria-label="Loading recent orders" aria-busy="true">
      {[0, 1].map(index => <div className={styles.card} aria-hidden="true" key={index}><Skeleton width="65%" height={22} /><Skeleton width="40%" height={18} /><Skeleton width="50%" height={32} /></div>)}
    </div>}
    {query.isError && <div role="alert"><p>{query.data ? 'We could not refresh your orders. Showing the last loaded list.' : 'Your recent orders could not be loaded.'}</p><Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></div>}
    {query.data?.data.length === 0 && !query.isError && <EmptyState icon={<Package size={48} />} title="No orders yet"
      description="Your order history will appear here after your first purchase." action={<Link to="/products">Start shopping</Link>} />}
    {!!query.data?.data.length && <div className={styles.list}>{query.data.data.slice(0, 3).map(order => <article className={styles.card} key={order.orderReference}>
      <Link to={`/orders/${encodeURIComponent(order.orderReference)}`}>{order.orderReference}</Link>
      <p>{formatDate(order.createdAt)} · {formatMoney(order.total, order.currency)}</p>
      <OrderBadges status={order.status} paymentState={order.paymentState} />
    </article>)}<Link to="/orders">View all orders</Link></div>}
  </>;
}
