import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, PackageSearch } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Toast, ToastClose, ToastProvider, ToastTitle, ToastViewport } from '@/components/ui/Toast';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api';
import { OrderBadges } from '@/features/orders/OrderBadges';
import { OrdersAccessGate } from '@/features/orders/OrdersAccessGate';
import { OrdersBreadcrumb } from '@/features/orders/OrdersBreadcrumb';
import shared from '@/features/orders/Orders.module.scss';
import { DeliveryMapPanel } from './components/DeliveryMapPanel';
import { DeliveryOverviewCard } from './components/DeliveryOverviewCard';
import { DeliveryProgressStepper } from './components/DeliveryProgressStepper';
import { DeliveryStateNotice } from './components/DeliveryStateNotice';
import { DeliveryTimeline } from './components/DeliveryTimeline';
import { formatStampWithZone, formatTime, latestUpdate } from './presentation';
import { useDeliverySnapshot } from './queries';
import type { CustomerDeliverySnapshot } from './types';
import { ConnectionStatusBanner, ConnectionStatusPill } from './realtime/ConnectionStatusIndicator';
import { TOAST_MS } from './realtime/constants';
import { useDeliveryLiveUpdates } from './realtime/useDeliveryLiveUpdates';
import styles from './Delivery.module.scss';

export function DeliveryTrackingPage() {
  return <OrdersAccessGate title="Track order" loading={<TrackingSkeleton label="Checking sign-in status" />}><OwnedDeliveryTracking /></OrdersAccessGate>;
}

/** Same skeleton shape as the loaded page (overview first, then progress), so nothing jumps when data arrives. */
function TrackingSkeleton({ label = 'Loading delivery tracking' }: { label?: string }) {
  return <div className={styles.tracking} role="status" aria-label={label}>
    <span className={styles.visuallyHidden}>{label}…</span>
    <div className={styles.grid} aria-hidden="true">
      <div className={`${styles.areaOverview} ${styles.overview}`}><Skeleton width="100%" height={168} /><div className={styles.skeletonStack}>
        <Skeleton width="100%" height={132} /><Skeleton width="100%" height={110} /></div><Skeleton width="70%" height={18} /></div>
      <div className={`${styles.areaStep} ${styles.card}`}><Skeleton width="11rem" height={22} /><Skeleton width="100%" height={72} /></div>
      <div className={`${styles.areaMap} ${styles.card}`}><Skeleton width="10rem" height={22} /><Skeleton width="80%" height={16} /></div>
      <div className={`${styles.areaTimeline} ${styles.card}`}><Skeleton width="10rem" height={22} /><Skeleton width="100%" height={48} /><Skeleton width="100%" height={48} /></div>
    </div>
  </div>;
}

function OwnedDeliveryTracking() {
  const { orderReference = '' } = useParams();
  const heading = useRef<HTMLHeadingElement>(null);
  // Task 04.7: polling is the fallback only while the live subscription is not open.
  const [live, setLive] = useState(false);
  const query = useDeliverySnapshot(orderReference, live);
  const snapshot = query.data?.data;
  const connection = useDeliveryLiveUpdates(orderReference, snapshot);
  useEffect(() => setLive(connection.live), [connection.live]);
  const loaded = Boolean(snapshot);
  useEffect(() => {
    // Focus the title once per reference when it first renders (never on background refetches or polling).
    if (loaded) heading.current?.focus({ preventScroll: true });
  }, [loaded, orderReference]);

  const detailsPath = `/orders/${encodeURIComponent(orderReference)}`;
  const crumbs = [{ label: 'Home', to: '/' }, { label: 'Orders', to: '/orders' }, { label: snapshot?.orderReference ?? orderReference, to: detailsPath },
    { label: 'Tracking' }];
  const notFound = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400);

  if (!snapshot) return <div className={shared.page}>
    <OrdersBreadcrumb items={notFound ? [{ label: 'Home', to: '/' }, { label: 'Orders', to: '/orders' }, { label: 'Tracking' }] : crumbs} />
    {query.isPending ? <><h1 className={styles.visuallyHidden}>Track order</h1><TrackingSkeleton /></>
      : notFound ? <div className={styles.tracking}><EmptyState role="alert" icon={<PackageSearch size={40} aria-hidden="true" />} title="Order not found"
        description="We could not find this order for your account." action={<Link className={shared.primaryLink} to="/orders">Back to Orders</Link>} /></div>
      : <div className={styles.tracking}><h1 className={styles.visuallyHidden}>Track order</h1>
        <DeliveryStateNotice kind="failed" role="alert" actions={<>
          <Button onClick={() => void query.refetch()} isLoading={query.isFetching} disabled={query.isFetching}>Retry</Button>
          <Link className={shared.outlineLink} to={detailsPath}>Back to order</Link></>} /></div>}
  </div>;

  const latest = latestUpdate(snapshot);
  return <div className={shared.page}>
    <OrdersBreadcrumb items={crumbs} />
    <div className={styles.tracking}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <div className={styles.titleBlock}>
            <h1 ref={heading} tabIndex={-1}>Track order {snapshot.orderReference}</h1>
            <p>{latest ? <>Last updated <time dateTime={latest}>{formatStampWithZone(latest)}</time></> : 'No delivery updates recorded yet.'}</p>
            <div className={styles.liveRow}><ConnectionStatusPill state={connection.state} /></div>
          </div>
          <OrderBadges status={snapshot.status} paymentState={snapshot.paymentState} />
        </div>
      </header>
      {/* The single polite live region for this page: paused/restored and status/ETA changes, announced once. */}
      <div className={styles.visuallyHidden} aria-live="polite" aria-atomic="true" data-testid="delivery-live-region">{connection.announcement}</div>
      <ConnectionStatusBanner state={connection.state} lastSaved={latest ? formatTime(latest) : null} onRefresh={() => void connection.refreshNow()}
        refreshing={connection.refreshing} />
      {query.isError && <div className={`${shared.notice} ${styles.refreshNotice}`} role="alert"><p>We could not refresh tracking. Showing the last loaded status.</p>
        <Button size="small" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>Retry</Button></div>}
      <TrackingBody snapshot={snapshot} detailsPath={detailsPath} busy={query.isFetching} />
    </div>
    {/* Status/ETA toasts are visual only (announce-excluded): the live region above is what screen readers hear. */}
    <ToastProvider duration={TOAST_MS} label="Delivery updates">
      {connection.notices.map(notice => <Toast key={notice.id} open variant={notice.tone} onOpenChange={open => { if (!open) connection.dismissNotice(notice.id); }}>
        <div data-radix-toast-announce-exclude=""><ToastTitle>{notice.title}</ToastTitle></div>
        <ToastClose aria-label="Dismiss delivery update" />
      </Toast>)}
      <ToastViewport />
    </ToastProvider>
  </div>;
}

function TrackingBody({ snapshot, detailsPath, busy }: { snapshot: CustomerDeliverySnapshot; detailsPath: string; busy: boolean }) {
  const actions = <div className={styles.actions}>
    <Link className={shared.outlineLink} to={detailsPath}>View order details</Link>
    <Link className={styles.back} to="/orders"><ArrowLeft aria-hidden="true" />Back to Orders</Link>
  </div>;
  if (snapshot.availability === 'PAYMENT_PENDING') return <div className={styles.grid}>
    <DeliveryStateNotice kind="paymentPending" actions={<Link className={shared.outlineLink} to={detailsPath}>Back to order</Link>} />
  </div>;
  if (snapshot.availability === 'CANCELLED') return <div className={styles.grid}>
    <DeliveryStateNotice kind="cancelled" actions={<Link className={shared.outlineLink} to={detailsPath}>View order details</Link>} />
    {actions}
  </div>;
  return <div className={styles.grid} aria-busy={busy || undefined}>
    <div className={styles.areaOverview}><DeliveryOverviewCard snapshot={snapshot} /></div>
    <div className={styles.areaStep}><DeliveryProgressStepper status={snapshot.status} timeline={snapshot.timeline} /></div>
    <div className={styles.areaMap}><DeliveryMapPanel snapshot={snapshot} /></div>
    <div className={styles.areaTimeline}><DeliveryTimeline entries={snapshot.timeline} trackingReference={snapshot.trackingReference} /></div>
    <div className={styles.areaActions}>{actions}</div>
  </div>;
}
