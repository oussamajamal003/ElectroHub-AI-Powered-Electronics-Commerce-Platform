import { useEffect, useRef } from 'react';
import { MapPin, PackageSearch, Truck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ProductImage } from '@/components/ui/ProductImage';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiError, apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { TransientEmailNotice } from './TransientEmailNotice';
import { emailConfirmationRefetchInterval } from './emailConfirmationRefresh';
import { OrderBadges } from './OrderBadges';
import { OrderDocumentsPanel } from './documents/OrderDocumentsPanel';
import { OrdersAccessGate } from './OrdersAccessGate';
import { OrdersBreadcrumb } from './OrdersBreadcrumb';
import { cardBrand, deliveryLabel, formatDate, formatEstimate, formatMoney, statusNote } from './presentation';
import { MAX_ORDERS_PAGE, type OrderDetails } from './types';
import shared from './Orders.module.scss';
import styles from './OrderDetailsPage.module.scss';

export function OrderDetailsPage() {
  return <OrdersAccessGate title="Order details" loading={<DetailsSkeleton label="Checking sign-in status" />}><OwnedOrderDetails /></OrdersAccessGate>;
}

/** Return to the list page the customer came from; direct entry falls back to /orders. */
function useBackToOrders() {
  const state: unknown = useLocation().state;
  const fromPage = state && typeof state === 'object' && 'fromPage' in state ? Number((state as { fromPage: unknown }).fromPage) : NaN;
  return Number.isInteger(fromPage) && fromPage > 1 && fromPage <= MAX_ORDERS_PAGE ? `/orders?page=${fromPage}` : '/orders';
}

function DetailsSkeleton({ label = 'Loading order details' }: { label?: string }) {
  return <div className={styles.layout} role="status" aria-label={label}>
    <span className={shared.visuallyHidden}>{label}…</span>
    <div className={styles.main} aria-hidden="true">
      <div className={styles.card}><Skeleton width="7rem" height={22} /><div className={styles.item}><Skeleton width={80} height={80} /><div><Skeleton width="60%" height={18} /><Skeleton width="4rem" height={14} /></div><Skeleton width="5rem" height={18} /></div></div>
      <div className={styles.card}><Skeleton width="11rem" height={22} /><Skeleton width="50%" height={16} /><Skeleton width="40%" height={16} /></div>
    </div>
    <div className={styles.aside} aria-hidden="true"><div className={styles.card}><Skeleton width="9rem" height={22} /><Skeleton width="100%" height={16} /><Skeleton width="100%" height={16} /><Skeleton width="100%" height={22} /></div></div>
  </div>;
}

function OwnedOrderDetails() {
  const { user, isSessionVerified, isLoggingOut } = useAuth();
  const { orderReference = '' } = useParams();
  const backTo = useBackToOrders();
  const heading = useRef<HTMLHeadingElement>(null);
  const query = useQuery({ queryKey: queryKeys.orders.detail(user?.id ?? '', orderReference),
    queryFn: ({ signal }) => apiClient<{ data: OrderDetails }>(`/api/orders/${encodeURIComponent(orderReference)}`, { signal }),
    enabled: Boolean(user && isSessionVerified && !isLoggingOut && orderReference), retry: false, staleTime: 10_000,
    refetchInterval: emailConfirmationRefetchInterval(user?.id ?? '', orderReference) });
  const order = query.data?.data;
  const loaded = Boolean(order);
  useEffect(() => {
    // Move focus to the page title once the order first renders for this reference (not on background refetch).
    if (loaded) heading.current?.focus({ preventScroll: true });
  }, [loaded, orderReference]);

  const notFound = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400);
  const crumbs = [{ label: 'Home', to: '/' }, { label: 'Orders', to: backTo }, { label: order?.orderReference ?? 'Order details' }];

  if (!order) return <main className={shared.page}>
    <OrdersBreadcrumb items={crumbs} />
    {query.isPending ? <><h1 className={shared.visuallyHidden}>Order details</h1><DetailsSkeleton /></>
      : notFound ? <div className={styles.stateArea}><EmptyState className={styles.unavailable} role="alert" icon={<PackageSearch size={40} aria-hidden="true" />}
        title="Order not found" description="We could not find this order for your account."
        action={<Link className={shared.primaryLink} to={backTo}>Back to Orders</Link>} /></div>
      : <div className={styles.stateArea}><ErrorState className={styles.unavailable} title="This order could not be loaded." description="Your order is safe. Please try again."
        action={<div className={styles.stateActions}><Button onClick={() => void query.refetch()} isLoading={query.isFetching} disabled={query.isFetching}>Retry</Button>
          <Link className={shared.outlineLink} to={backTo}>Back to Orders</Link></div>} /></div>}
  </main>;

  const paid = order.paymentState === 'PAID';
  const note = statusNote(order.status, order.paymentState);
  const address = order.shipping;
  const locality = [address.city, address.state, address.postalCode].filter(Boolean).join(', ');
  return <main className={shared.page}>
    <OrdersBreadcrumb items={crumbs} />
    <header className={styles.header}>
      <div className={styles.titleBlock}>
        <h1 ref={heading} tabIndex={-1}>Order {order.orderReference}</h1>
        <p>Placed on <time dateTime={order.createdAt}>{formatDate(order.createdAt)}</time></p>
      </div>
      <OrderBadges status={order.status} paymentState={order.paymentState} />
    </header>
    {note && <p className={styles.note}>{note}</p>}
    {query.isError && <div className={`${shared.notice} ${styles.refreshNotice}`} role="alert"><p>We could not refresh this order. Showing the last loaded details.</p>
      <Button size="small" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>Retry</Button></div>}
    <TransientEmailNotice ownerId={user?.id ?? ''} order={order} />
    <div className={styles.layout} aria-busy={query.isFetching || undefined}>
      <div className={styles.main}>
        <section className={styles.card} aria-labelledby="order-items-heading">
          <h2 id="order-items-heading">Items ({order.itemCount})</h2>
          <ul className={styles.items}>{order.items.map(item => <li className={styles.item} key={item.id}>
            <ProductImage src={item.imageUrl ?? undefined} alt="" fallbackText="" containerClassName={styles.itemImage} />
            <div className={styles.itemText}><strong>{item.productName}</strong><span>Qty: {item.quantity}</span></div>
            <div className={styles.itemAmounts}><strong>{formatMoney(item.lineTotal, order.currency)}</strong><span>{formatMoney(item.unitPrice, order.currency)} each</span></div>
          </li>)}</ul>
        </section>
        <section className={styles.card} aria-labelledby="order-address-heading">
          <h2 id="order-address-heading" className={styles.iconHeading}><MapPin aria-hidden="true" />Delivery Address</h2>
          <address className={styles.address}>
            <span>{address.recipient}</span><span>{address.line1}</span>{address.line2 && <span>{address.line2}</span>}
            {locality && <span>{locality}</span>}<span>{address.country}</span>{address.phone && <span>{address.phone}</span>}
          </address>
          <div className={styles.delivery}>
            <p><Truck aria-hidden="true" /><span>{deliveryLabel(order.deliveryMethod)} · Estimated {formatEstimate(order.estimatedDeliveryStart, order.estimatedDeliveryEnd)}</span></p>
            <p className={styles.subtle}>Business-day estimate; holidays and delivery cutoffs may affect arrival.</p>
          </div>
        </section>
      </div>
      <div className={styles.aside}>
        <section className={styles.card} aria-labelledby="order-summary-heading">
          <h2 id="order-summary-heading">Order Summary</h2>
          <dl className={styles.totals}>
            <div><dt>Subtotal</dt><dd>{formatMoney(order.subtotal, order.currency)}</dd></div>
            <div><dt>Shipping</dt><dd className={order.shippingCost === '0.00' ? styles.free : undefined}>{order.shippingCost === '0.00' ? 'Free' : formatMoney(order.shippingCost, order.currency)}</dd></div>
            <div className={styles.grandTotal}><dt>{paid ? 'Total paid' : 'Order total'}</dt><dd>{formatMoney(order.total, order.currency)}</dd></div>
          </dl>
          {(order.card || order.payment?.paidAt || order.payment?.refundedAt) && <div className={styles.paymentFacts}>
            {order.card && <p>{paid ? 'Paid with' : 'Card:'} {cardBrand(order.card.brand)} ending {order.card.last4}</p>}
            {paid && order.payment?.paidAt && <p>Paid on <time dateTime={order.payment.paidAt}>{formatDate(order.payment.paidAt)}</time></p>}
            {order.payment?.refundedAt && <p>Refunded on <time dateTime={order.payment.refundedAt}>{formatDate(order.payment.refundedAt)}</time></p>}
          </div>}
        </section>
        <OrderDocumentsPanel orderReference={order.orderReference} variant="details" />
        <Link className={styles.backLink} to={backTo}>Back to Orders</Link>
      </div>
    </div>
  </main>;
}
