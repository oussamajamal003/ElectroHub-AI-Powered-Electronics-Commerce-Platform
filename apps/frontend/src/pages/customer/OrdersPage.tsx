import { useEffect, useRef } from 'react';
import { ChevronRight, Package } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ProductImage } from '@/components/ui/ProductImage';
import { Skeleton } from '@/components/ui/Skeleton';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/Pagination';
import { apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { OrderBadges } from '@/features/orders/OrderBadges';
import { OrdersAccessGate } from '@/features/orders/OrdersAccessGate';
import { OrdersBreadcrumb } from '@/features/orders/OrdersBreadcrumb';
import { formatDate, formatMoney, pluralize, readPage, unitCount } from '@/features/orders/presentation';
import { MAX_ORDERS_PAGE, ORDERS_PAGE_SIZE, type OrderSummary, type OrdersPageResponse } from '@/features/orders/types';
import shared from '@/features/orders/Orders.module.scss';
import styles from './OrdersPage.module.scss';

const PREVIEW_LIMIT = 4;
const crumbs = [{ label: 'Home', to: '/' }, { label: 'Account', to: '/account' }, { label: 'My Orders' }];

export function OrdersPage() {
  return <OrdersAccessGate title="My Orders" loading={<OrdersLoadingSkeleton label="Checking sign-in status" />}><OwnedOrders /></OrdersAccessGate>;
}

/** Mirrors the populated card (identity, preview, metadata) so loading does not reflow into the list. */
function OrdersLoadingSkeleton({ label = 'Loading your orders' }: { label?: string }) {
  return <div className={styles.orderList} role="status" aria-label={label}>
    <span className={shared.visuallyHidden}>{label}…</span>
    {[0, 1].map(index => <div className={styles.skeletonCard} key={index} aria-hidden="true">
      <div className={styles.cardTop}><div className={styles.identity}><Skeleton width="3.5rem" height={12} /><Skeleton width="min(22rem, 70%)" height={22} /></div>
        <Skeleton width="13rem" height={32} /></div>
      <div className={styles.previews}><Skeleton width={58} height={58} /></div>
      <div className={styles.cardFooter}><Skeleton width="16rem" height={40} /></div>
    </div>)}
  </div>;
}

function OrderCard({ order, page }: { order: OrderSummary; page: number }) {
  const preview = order.items.slice(0, PREVIEW_LIMIT); const hidden = order.items.length - preview.length;
  const items = unitCount(order.items, order.itemCount);
  return <article className={styles.orderCard} aria-labelledby={`order-${order.orderReference}`}>
    <div className={styles.cardTop}>
      <div className={styles.identity}>
        <span className={styles.eyebrow}>Order</span>
        {/* One link per card; its ::after makes the whole card a single click/keyboard target (no nested controls).
            Named by the reference only, so the heading and article names stay the reference too (WCAG 2.4.4: purpose from card context). */}
        <h2 id={`order-${order.orderReference}`}><Link className={styles.cardLink} to={`/orders/${order.orderReference}`} state={{ fromPage: page }}>
          {order.orderReference}</Link></h2>
      </div>
      <OrderBadges status={order.status} paymentState={order.paymentState} />
    </div>
    {preview.length > 0 && <ul className={styles.previews} aria-label="Products in this order">
      {preview.map((item, index) => <li key={`${item.productId}-${index}`}>
        <ProductImage src={item.imageUrl ?? undefined} alt={item.productName} fallbackText="" containerClassName={styles.previewImage} />
      </li>)}
      {hidden > 0 && <li className={styles.more} aria-label={`and ${pluralize(hidden, 'more product')}`}>+{hidden}</li>}
    </ul>}
    <div className={styles.cardFooter}>
      <dl className={styles.meta}>
        <div><dt>Date</dt><dd><time dateTime={order.createdAt}>{formatDate(order.createdAt)}</time></dd></div>
        <div><dt>{order.paymentState === 'PAID' ? 'Total paid' : 'Total'}</dt><dd>{formatMoney(order.total, order.currency)}</dd></div>
        <div><dt>Items</dt><dd>{items}</dd></div>
      </dl>
      <ChevronRight className={styles.chevron} aria-hidden="true" />
    </div>
  </article>;
}

function OwnedOrders() {
  const { user, isSessionVerified, isLoggingOut } = useAuth();
  const userId = user?.id ?? '';
  const [searchParams, setSearchParams] = useSearchParams();
  const page = readPage(searchParams.get('page'));
  const heading = useRef<HTMLHeadingElement>(null);
  const previousPage = useRef(page);
  // Enabled only after session verification, so a pending query always means a real in-flight fetch.
  const query = useQuery({ queryKey: queryKeys.orders.list(userId, page, ORDERS_PAGE_SIZE),
    queryFn: ({ signal }) => apiClient<OrdersPageResponse>(`/api/orders?page=${page}&pageSize=${ORDERS_PAGE_SIZE}`, { signal }),
    enabled: Boolean(user && isSessionVerified && !isLoggingOut), retry: false, staleTime: 10_000,
    // Keep the previous page visible while the next loads, but never another account's data.
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === userId ? previous : undefined });
  const data = query.data;
  const total = data?.meta?.total ?? data?.data.length;
  // Fail closed: a response without pagination metadata still renders its orders (single page) instead of crashing.
  const totalPages = Math.min(data?.meta?.totalPages ?? 0, MAX_ORDERS_PAGE);
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, index) => Math.max(1, Math.min(page - 2, totalPages - 4)) + index);
  const changing = query.isPlaceholderData;

  useEffect(() => {
    // Page changes land at the top; focus moves to the heading so keyboard users keep their place. Background refetches never move focus.
    if (previousPage.current === page) return;
    previousPage.current = page;
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    heading.current?.focus({ preventScroll: true });
  }, [page]);

  const goToPage = (value: number) => {
    if (value === page || value < 1 || (totalPages && value > totalPages)) return;
    setSearchParams(value === 1 ? {} : { page: String(value) });
  };

  return <main className={shared.page}>
    <OrdersBreadcrumb items={crumbs} />
    <div className={styles.heading}>
      <h1 ref={heading} tabIndex={-1}>My Orders</h1>
      {total === undefined
        ? query.isError ? null : <span role="status" aria-label="Order count loading"><Skeleton width="4.5rem" height={18} /></span>
        : <span className={styles.count}>{pluralize(total, 'order')}</span>}
    </div>
    {query.isPending && <OrdersLoadingSkeleton />}
    {query.isError && !data && <ErrorState className={styles.state} title="Your orders could not be loaded." description="Your orders are safe. Please try again."
      action={<Button onClick={() => void query.refetch()} isLoading={query.isFetching} disabled={query.isFetching}>Retry</Button>} />}
    {query.isError && data && <div className={shared.notice} role="alert"><p>We could not refresh your orders. Showing the last loaded list.</p>
      <Button size="small" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>Retry</Button></div>}
    {data && total === 0 && <div className={styles.emptyArea}>
      <EmptyState className={styles.empty} icon={<Package size={40} aria-hidden="true" />} title="You have no orders yet."
        description="Orders appear here as soon as a payment is confirmed." action={<Link className={shared.primaryLink} to="/products">Explore Products</Link>} />
    </div>}
    {data && !changing && data.data.length === 0 && Boolean(total) && <div className={shared.notice} role="status">
      <p>There are no orders on page {page}.</p>
      <Link className={shared.outlineLink} to={totalPages > 1 ? `/orders?page=${totalPages}` : '/orders'}>Go to page {Math.max(totalPages, 1)}</Link>
    </div>}
    {data && data.data.length > 0 && <ul className={styles.orderList} aria-busy={changing || undefined} data-stale={changing || undefined}>
      {data.data.map(order => <li key={order.orderReference}><OrderCard order={order} page={changing ? data.meta?.page ?? page : page} /></li>)}
    </ul>}
    {totalPages > 1 && <Pagination aria-label="Order history pages" className={styles.pagination}><PaginationContent>
      <PaginationItem><PaginationPrevious disabled={page <= 1} onClick={() => goToPage(page - 1)} /></PaginationItem>
      {pages.map(value => <PaginationItem key={value}><PaginationLink aria-label={`Go to page ${value}`} isActive={value === page} onClick={() => goToPage(value)}>{value}</PaginationLink></PaginationItem>)}
      <PaginationItem><PaginationNext disabled={page >= totalPages} onClick={() => goToPage(page + 1)} /></PaginationItem>
    </PaginationContent></Pagination>}
    <div className={styles.footerActions}><Link className={shared.outlineLink} to="/account">Back to Account</Link></div>
  </main>;
}
