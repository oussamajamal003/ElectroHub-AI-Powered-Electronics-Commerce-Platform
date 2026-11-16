import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, ImageOff, Truck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAdminDeliveryMutations } from '@/features/delivery/queries';
import { useAdminOrder, type AdminOrderDetail } from '@/features/admin/orders/api';
import { ActivePill, ButtonLink, ConfirmDialog, PageHeader, QueryProblem, StatusPill, useAdminToast } from '@/features/admin/shared/AdminUi';
import { OrderStatusPill, PaymentPill } from '@/features/admin/shared/labels';
import { orderStatusLabel, paymentLabel } from '@/features/admin/shared/statusLabels';
import { adminKeys, errorMessage } from '@/features/admin/shared/api';
import { formatCount, formatDateTime, formatMoney } from '@/features/admin/shared/format';
import styles from '@/features/admin/shared/AdminPages.module.scss';

const FLOW = ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;

function FulfillmentTimeline({ status }: { status: string }) {
  const reached = FLOW.indexOf(status as typeof FLOW[number]);
  return <ol className={styles.timeline} aria-label="Fulfillment progress">
    {FLOW.map((step, index) => <li key={step} className={clsx(styles.step, index < reached && styles.stepDone, index === reached && (status === 'DELIVERED' ? styles.stepDone : styles.stepCurrent))}
      aria-current={index === reached ? 'step' : undefined}>
      <span className={styles.stepDot} aria-hidden="true">{index < reached || (index === reached && status === 'DELIVERED') ? <Check /> : index + 1}</span>
      <span>{orderStatusLabel[step]}</span>
    </li>)}
  </ol>;
}

/** Fulfillment actions go through the approved 04.5 delivery API (server-checked payment eligibility, transitions and revision). */
function FulfillmentPanel({ order, onChanged }: { order: AdminOrderDetail; onChanged: () => void }) {
  const { start, update } = useAdminDeliveryMutations(order.orderReference);
  const toast = useAdminToast();
  const [confirming, setConfirming] = useState<'start' | 'advance' | null>(null);
  const delivery = order.delivery;
  const next = delivery.allowedNextStatus as 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | null;
  const mutation = confirming === 'start' ? start : update;
  const run = () => {
    const done = (message: string) => { toast(message); setConfirming(null); onChanged(); };
    // Any 409 (stale revision, terminal or cancelled order) means the screen is behind the server: reload the order.
    const failed = (error: unknown) => { if ((error as { status?: number }).status === 409) onChanged(); };
    if (confirming === 'start') start.mutate(undefined, { onSuccess: () => done('Delivery tracking started.'), onError: failed });
    else if (next && delivery.revision) update.mutate({ expectedRevision: delivery.revision, status: next },
      { onSuccess: () => done(`Order moved to ${orderStatusLabel[next]}.`), onError: failed });
  };

  return <section className={styles.panel} aria-labelledby="fulfillment-title">
    <div className={styles.panelHeader}>
      <h2 id="fulfillment-title" className={styles.panelTitle}>Fulfillment</h2>
      {delivery.trackingReference && <Link className={styles.panelLink} to={`/admin/deliveries/${encodeURIComponent(order.orderReference)}`}>
        Delivery details <ArrowRight aria-hidden="true" /></Link>}
    </div>
    {order.status === 'CANCELLED' ? <p className={styles.notice}>This order was cancelled. No fulfillment actions are available.</p>
      : order.status === 'AWAITING_CAPTURE' ? <p className={`${styles.notice} ${styles.noticeWarning}`}>Payment has not succeeded yet. Fulfillment starts once Stripe confirms the payment.</p>
      : <FulfillmentTimeline status={order.status} />}
    <dl className={styles.details}>
      <dt>Tracking</dt><dd className={styles.mono}>{delivery.trackingReference ?? 'Not started'}</dd>
      <dt>Estimated arrival</dt><dd>{delivery.estimatedAt ? formatDateTime(delivery.estimatedAt)
        : `${formatDateTime(order.estimatedDeliveryStart)} – ${formatDateTime(order.estimatedDeliveryEnd)} (checkout estimate)`}</dd>
      {delivery.deliveredAt && <><dt>Delivered</dt><dd>{formatDateTime(delivery.deliveredAt)}</dd></>}
      {delivery.isSimulated && <><dt>Mode</dt><dd><StatusPill tone="info" icon={false}>Demo simulation</StatusPill></dd></>}
    </dl>
    <div className={styles.actionsStart}>
      {delivery.canStart && <Button type="button" onClick={() => { start.reset(); setConfirming('start'); }}><Truck aria-hidden="true" size={16} /> Start tracking</Button>}
      {!delivery.canStart && next && delivery.revision !== null && <Button type="button" onClick={() => { update.reset(); setConfirming('advance'); }}>
        Mark as {orderStatusLabel[next]}</Button>}
      {!delivery.canStart && !next && order.status !== 'DELIVERED' && order.status !== 'CANCELLED' && order.status !== 'AWAITING_CAPTURE' &&
        <p className={styles.panelHint}>{delivery.paymentEligible ? 'No fulfillment step is available right now.'
          : `Fulfillment needs a successful payment. This order's payment is ${(paymentLabel[order.payment.state] ?? order.payment.state).toLowerCase()}.`}</p>}
    </div>
    <ConfirmDialog open={Boolean(confirming)} onOpenChange={open => { if (!open) setConfirming(null); }} pending={mutation.isPending}
      title={confirming === 'start' ? 'Start delivery tracking?' : `Mark as ${next ? orderStatusLabel[next] : ''}?`}
      confirmLabel={confirming === 'start' ? 'Start tracking' : 'Confirm'} error={mutation.isError ? errorMessage(mutation.error) : null} onConfirm={run}
      description={confirming === 'start'
        ? <p>A tracking reference is created and the customer can follow the delivery from their order page.</p>
        : <p>The customer is notified of the new status. Fulfillment steps only move forward; this cannot be undone from the console.</p>} />
  </section>;
}

export function AdminOrderDetailPage() {
  const { orderReference = '' } = useParams();
  const query = useAdminOrder(orderReference);
  const client = useQueryClient();
  const order = query.data?.data;
  const crumbs = [{ label: 'Dashboard', to: '/admin' }, { label: 'Orders', to: '/admin/orders' }, { label: order?.orderReference ?? 'Order' }];

  if (!order) {
    // Same shape as the loaded page (fulfillment and items left; payment, customer and address right) so nothing jumps when data arrives.
    if (query.isPending) return <div className={styles.page} aria-busy="true">
      <span role="status" className={styles.visuallyHidden}>Loading order…</span>
      <div className={styles.pageHeaderSkeleton}><Skeleton width="12rem" height="0.875rem" /><Skeleton width="22rem" height="2.5rem" /><Skeleton width="18rem" height="1rem" /></div>
      <div className={styles.split}>
        <div className={styles.stack}>
          <div className={styles.panel}><Skeleton width="8rem" height="1.25rem" /><Skeleton height="3rem" /><Skeleton width="60%" height="0.875rem" /><Skeleton width="40%" height="2.5rem" /></div>
          <div className={styles.panel}><Skeleton width="5rem" height="1.25rem" />{[0, 1, 2].map(index => <Skeleton key={index} height="3.5rem" />)}<Skeleton width="50%" height="1rem" /></div>
        </div>
        <div className={styles.stack}>
          {[0, 1, 2].map(index => <div key={index} className={styles.panel}><Skeleton width="7rem" height="1.25rem" /><Skeleton width="80%" height="0.875rem" /><Skeleton width="65%" height="0.875rem" /></div>)}
        </div>
      </div>
    </div>;
    const status = (query.error as { status?: number } | null)?.status;
    return <div className={styles.page}>
      <PageHeader title={status === 404 || status === 400 ? 'Order not found' : 'Order unavailable'} crumbs={crumbs} />
      {status === 404 || status === 400 ? <div className={styles.notFound}><p>No order matches this reference.</p><ButtonLink to="/admin/orders" variant="outline">Back to orders</ButtonLink></div>
        : <QueryProblem error={query.error} hasData={false} onRetry={() => void query.refetch()} retrying={query.isFetching} what="The order" />}
    </div>;
  }

  const refresh = () => {
    void client.invalidateQueries({ queryKey: adminKeys.order(orderReference) });
    for (const key of [adminKeys.orders, adminKeys.alerts, ['admin', 'dashboard']]) void client.invalidateQueries({ queryKey: key });
  };
  const shipping = order.shipping;

  return <div className={styles.page}>
    <PageHeader title={<span className={styles.titleMono}>{order.orderReference}</span>} crumbs={crumbs}
      description={<>Placed {formatDateTime(order.createdAt)} · {formatCount(order.itemCount)} items · <OrderStatusPill status={order.status} /> <PaymentPill state={order.payment.state} /></>} />
    {query.isError && <QueryProblem error={query.error} hasData onRetry={() => void query.refetch()} retrying={query.isFetching} what="The order" />}
    <div className={styles.split}>
      <div className={styles.stack}>
        <FulfillmentPanel order={order} onChanged={refresh} />
        <section className={styles.panel} aria-labelledby="items-title">
          <h2 id="items-title" className={styles.panelTitle}>Items</h2>
          <ul className={styles.lineItems}>
            {order.items.map(item => <li key={item.id} className={styles.lineItem}>
              {item.imageUrl ? <img className={styles.thumb} src={item.imageUrl} alt="" loading="lazy" />
                : <span className={`${styles.thumb} ${styles.thumbEmpty}`} aria-hidden="true"><ImageOff /></span>}
              <span className={styles.cellText}><strong>{item.productName}</strong>
                <span className={styles.mono}>{item.sku} · {formatCount(item.quantity)} × {formatMoney(item.unitPrice, order.currency)}</span></span>
              <span className={styles.money}>{formatMoney(item.lineTotal, order.currency)}</span>
            </li>)}
          </ul>
          <dl className={styles.totals}>
            <div><dt>Subtotal</dt><dd>{formatMoney(order.subtotal, order.currency)}</dd></div>
            <div><dt>Shipping ({order.deliveryMethod.toLowerCase()})</dt><dd>{formatMoney(order.shippingCost, order.currency)}</dd></div>
            <div className={styles.grand}><dt>Total</dt><dd>{formatMoney(order.total, order.currency)}</dd></div>
          </dl>
        </section>
      </div>
      <div className={styles.stack}>
        <section className={styles.panel} aria-labelledby="payment-title">
          <h2 id="payment-title" className={styles.panelTitle}>Payment</h2>
          <dl className={styles.details}>
            <dt>Status</dt><dd><PaymentPill state={order.payment.state} /></dd>
            <dt>Amount</dt><dd className={styles.money}>{order.payment.amount ? formatMoney(order.payment.amount, order.payment.currency) : '—'}</dd>
            <dt>Method</dt><dd>{order.payment.card ? `${order.payment.card.brand} •••• ${order.payment.card.last4}` : order.paymentMethod.toLowerCase()}</dd>
            {order.payment.paidAt && <><dt>Paid</dt><dd>{formatDateTime(order.payment.paidAt)}</dd></>}
            {order.payment.refundedAt && <><dt>Refunded</dt><dd>{formatDateTime(order.payment.refundedAt)}</dd></>}
          </dl>
          <p className={styles.fieldHelp}>Payment state is set only by verified Stripe events. It cannot be changed from the console.</p>
        </section>
        <section className={styles.panel} aria-labelledby="customer-title">
          <div className={styles.panelHeader}>
            <h2 id="customer-title" className={styles.panelTitle}>Customer</h2>
            <Link className={styles.panelLink} to={`/admin/customers/${order.customer.id}`}>Profile <ArrowRight aria-hidden="true" /></Link>
          </div>
          <dl className={styles.details}>
            <dt>Name</dt><dd>{order.customer.name ?? '—'}</dd>
            <dt>Email</dt><dd>{order.customer.email}</dd>
            <dt>Account</dt><dd><ActivePill active={order.customer.isActive} /></dd>
          </dl>
        </section>
        <section className={styles.panel} aria-labelledby="shipping-title">
          <h2 id="shipping-title" className={styles.panelTitle}>Shipping address</h2>
          <address className={styles.address}>
            <strong>{shipping.recipient}</strong><br />{shipping.line1}{shipping.line2 && <><br />{shipping.line2}</>}<br />
            {[shipping.city, shipping.state, shipping.postalCode].filter(Boolean).join(', ')}<br />{shipping.country}<br />{shipping.phone}
          </address>
        </section>
      </div>
    </div>
  </div>;
}
