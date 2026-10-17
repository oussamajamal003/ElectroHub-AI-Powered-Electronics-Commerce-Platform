import { CircleAlert, Package } from 'lucide-react';
import { useAuth } from '@/features/auth/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PaymentStatus, type PaymentStatusType } from '@/components/ui/PaymentStatus';
import { ProductImage } from '@/components/ui/ProductImage';
import { Skeleton } from '@/components/ui/Skeleton';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/Pagination';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import type { Confirmation } from '@/features/checkout/types';
import styles from './OrdersPage.module.scss';

export function OrdersPage() {
  const { isAuthenticated, isInitializing, sessionUnavailable, retrySession } = useAuth();

  if (isInitializing && sessionUnavailable) return <main className={styles.history}><h1>My Orders</h1>
    <ErrorState title="We could not verify your session." description="Your orders are safe. Please try again."
      action={<Button onClick={retrySession}>Retry</Button>} /></main>;
  if (isInitializing) return <main className={styles.history}><h1>My Orders</h1><OrdersLoadingSkeleton label="Checking sign-in status" /></main>;
  if (isAuthenticated) return <OwnedOrders />;

  return <main className={styles.page}><section className={styles.card} aria-labelledby="sign-in-required">
    <div className={styles.icon}><CircleAlert size={32} aria-hidden="true" /></div>
    <h1 id="sign-in-required">Sign In Required</h1>
    <p>Please sign in to access this page.</p>
    <Button type="button" onClick={() => window.dispatchEvent(new Event('electrohub:open-auth'))}>Sign In</Button>
  </section></main>;
}

const money = (value: string, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value));
const orderDate = (value: string) => new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
const paymentStatus = (state: Confirmation['paymentState']): PaymentStatusType =>
  state === 'PAID' ? 'paid' : state === 'FAILED' ? 'failed' : state === 'REFUNDED' ? 'refunded' : 'pending';
const headline = (order: Confirmation) => order.paymentState === 'PAID' ? 'Order confirmed' : order.paymentState === 'PENDING' ? 'Finalizing your order'
  : order.paymentState === 'REFUNDED' ? 'Payment refunded' : order.paymentState === 'FAILED' ? 'Payment failed' : 'Order received';

/** Mirrors the populated order card (header, item line, footer) so loading does not reflow into the list. */
function OrdersLoadingSkeleton({ label = 'Loading your orders' }: { label?: string }) {
  return <div className={styles.orderList} role="status" aria-label={label}>
    <span className={styles.visuallyHidden}>{label}…</span>
    {[0, 1].map(index => <div className={styles.skeletonCard} key={index} aria-hidden="true">
      <div className={styles.orderHeader}>
        <div className={styles.orderIdentity}><Skeleton width="4rem" height={12} /><Skeleton width="12rem" height={20} /><Skeleton width="10rem" height={14} /></div>
        <Skeleton width="6.5rem" height={24} />
      </div>
      <div className={styles.orderItems}>
        <div className={styles.orderLine}><Skeleton width={64} height={64} /><div><Skeleton width="60%" height={16} /><Skeleton width="5rem" height={14} /></div><Skeleton width="4.5rem" height={16} /></div>
      </div>
      <div className={styles.orderFooter}><Skeleton width="9rem" height={20} /><Skeleton width="8rem" height={44} /></div>
    </div>)}
  </div>;
}

const ORDERS_PAGE_SIZE = 10;

type OrdersPage = { data: Confirmation[]; meta: { page: number; pageSize: number; total: number; totalPages: number } };

function OwnedOrders() {
  const { user, isSessionVerified } = useAuth();
  const [page, setPage] = useState(1);
  // Enabled only after session verification, so a pending query always means a real in-flight fetch.
  const query = useQuery({ queryKey: ['orders', user?.id ?? '', 'list', page, ORDERS_PAGE_SIZE],
    queryFn: ({ signal }) => apiClient<OrdersPage>(`/api/orders?page=${page}&pageSize=${ORDERS_PAGE_SIZE}`, { signal }),
    enabled: Boolean(user && isSessionVerified), retry: false, staleTime: 10_000, placeholderData: keepPreviousData });
  // Fail closed: a response without pagination metadata still renders its orders (single page) instead of crashing.
  const totalPages = Math.min(query.data?.meta?.totalPages ?? 0, 1000);
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, index) =>
    Math.max(1, Math.min(page - 2, totalPages - 4)) + index);
  // Same behavior as the Products page: every page change lands at the top of the list.
  // Controls never turn disabled while a page loads; the previous page stays visible until the next one arrives.
  const goToPage = (value: number) => {
    if (value === page || value < 1 || value > totalPages) return;
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    setPage(value);
  };
  return <main className={styles.history}><h1>My Orders</h1>
    {query.isPending && <OrdersLoadingSkeleton />}
    {query.isError && <ErrorState title="Your orders could not be loaded." description="Your orders are safe. Please try again."
      action={<Button onClick={() => void query.refetch()} isLoading={query.isFetching} disabled={query.isFetching}>Retry</Button>} />}
    {query.data?.data.length === 0 && <EmptyState className={styles.empty} icon={<Package size={40} aria-hidden="true" />} title="You have no orders yet."
      description="Orders appear here as soon as a payment is confirmed." action={<Link className={styles.primaryLink} to="/products">Explore Products</Link>} />}
    {Boolean(query.data?.data.length) && <ul className={styles.orderList} aria-busy={query.isFetching || undefined}>{query.data!.data.map(order => <li key={order.orderReference}>
      <article className={styles.orderCard} aria-labelledby={`order-${order.orderReference}`}>
        <header className={styles.orderHeader}>
          <div className={styles.orderIdentity}>
            <span className={styles.eyebrow}>Order</span>
            <h2 id={`order-${order.orderReference}`}>{order.orderReference}</h2>
            <p><time dateTime={order.createdAt}>{orderDate(order.createdAt)}</time> · {headline(order)}</p>
          </div>
          <PaymentStatus status={paymentStatus(order.paymentState)} size="small" />
        </header>
        <ul className={styles.orderItems}>{order.items.map(item => <li className={styles.orderLine} key={item.productId}>
          <ProductImage src={item.imageUrl ?? undefined} alt="" containerClassName={styles.orderImage} />
          <div><strong>{item.productName}</strong><span>Qty: {item.quantity}</span></div>
          <span className={styles.lineTotal}>{money(item.lineTotal, order.currency)}</span>
        </li>)}</ul>
        <footer className={styles.orderFooter}>
          <p><span>{order.paymentState === 'PAID' ? 'Total paid' : 'Order total'}</span><strong>{money(order.total, order.currency)}</strong></p>
          <Link className={styles.secondaryLink} to={`/checkout/confirmation/${order.orderReference}`} aria-label={`View order ${order.orderReference}`}>View Order</Link>
        </footer>
      </article>
    </li>)}</ul>}
    {totalPages > 1 && <Pagination aria-label="Order history pages" className={styles.pagination}><PaginationContent>
      <PaginationItem><PaginationPrevious disabled={page <= 1} onClick={() => goToPage(page - 1)} /></PaginationItem>
      {pages.map(value => <PaginationItem key={value}><PaginationLink aria-label={`Go to page ${value}`} isActive={value === page} onClick={() => goToPage(value)}>{value}</PaginationLink></PaginationItem>)}
      <PaginationItem><PaginationNext disabled={page >= totalPages} onClick={() => goToPage(page + 1)} /></PaginationItem>
    </PaginationContent></Pagination>}
  </main>;
}
