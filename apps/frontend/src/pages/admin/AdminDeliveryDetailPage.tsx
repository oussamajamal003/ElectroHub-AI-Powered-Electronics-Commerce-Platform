import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import { ApiError } from '@/lib/api';
import { OrderBadges } from '@/features/orders/OrderBadges';
import { AdminDeliveryUpdatePanel } from '@/features/adminDelivery/AdminDeliveryUpdatePanel';
import { DeliveryOverviewCard } from '@/features/delivery/components/DeliveryOverviewCard';
import { formatStamp, stageOf } from '@/features/delivery/presentation';
import { useAdminDelivery } from '@/features/delivery/queries';
import type { AdminDeliveryEvent } from '@/features/delivery/types';
import styles from './AdminDeliveryDetailPage.module.scss';

const EVENT_LABEL: Record<AdminDeliveryEvent['type'], string> = {
  TRACKING_STARTED: 'Tracking started', STATUS_CHANGED: 'Status changed', LOCATION_UPDATED: 'Location updated', LOCATION_CLEARED: 'Location cleared',
  ETA_UPDATED: 'ETA updated', ETA_CLEARED: 'ETA cleared', SIMULATION_STARTED: 'Simulation started', SIMULATION_STOPPED: 'Simulation stopped',
};

/** Task 04.5 admin delivery details: eligibility, current state, full authorized history, the update panel and the customer's view. */
export function AdminDeliveryDetailPage() {
  const { orderReference = '' } = useParams();
  const query = useAdminDelivery(orderReference);
  const snapshot = query.data?.data;
  const back = <Link className={styles.back} to="/admin/deliveries"><ArrowLeft size={16} aria-hidden="true" />All deliveries</Link>;

  if (!snapshot) return <section className={styles.page}>{back}
    {query.isPending ? <div className={styles.loading}><ElectroHubLoader /></div>
      : <Alert variant="error"><span>{query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400)
        ? 'This order was not found.' : 'The delivery could not be loaded. Check your connection and try again.'}</span>{' '}
        <Button type="button" size="small" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>Retry</Button></Alert>}
  </section>;

  const current = snapshot.current;
  return <section className={styles.page}>
    {back}
    <header className={styles.header}>
      <div className={styles.title}><p className={styles.eyebrow}>DELIVERY</p><h1>{snapshot.orderReference}</h1>
        <p>{snapshot.customer.name ?? 'Customer'} · {snapshot.customer.email}</p></div>
      <OrderBadges status={snapshot.status} paymentState={snapshot.paymentState} />
    </header>
    {query.isError && <Alert variant="error"><span>The delivery could not be refreshed. Showing the last loaded state.</span></Alert>}
    <div className={styles.layout}>
      <div className={styles.main}>
        <section className={styles.card} aria-labelledby="admin-delivery-state">
          <h2 id="admin-delivery-state">Current tracking state</h2>
          <dl className={styles.facts}>
            <div><dt>Payment eligibility</dt><dd>{snapshot.paymentEligible ? 'Eligible (payment succeeded)' : 'Not eligible'}</dd></div>
            <div><dt>Tracking reference</dt><dd className={styles.mono}>{current?.trackingReference ?? 'Not started'}</dd></div>
            <div><dt>Delivery status</dt><dd>{current ? stageOf(current.status).label : '—'}</dd></div>
            <div><dt>Revision</dt><dd className={styles.mono}>{current?.revision ?? 0}</dd></div>
            <div><dt>Estimated arrival</dt><dd>{current?.estimatedAt ? formatStamp(current.estimatedAt) : 'Not set'}</dd></div>
            <div><dt>Current location</dt><dd>{current?.location ? <>{current.location.label ?? 'Unlabelled position'}
              <span className={styles.mono}> ({current.location.latitude}, {current.location.longitude})</span></> : 'Not shared'}</dd></div>
            <div><dt>Allowed next status</dt><dd>{snapshot.allowedNextStatus ? stageOf(snapshot.allowedNextStatus).label : 'None'}</dd></div>
            <div><dt>Delivered at</dt><dd>{current?.deliveredAt ? formatStamp(current.deliveredAt) : '—'}</dd></div>
          </dl>
        </section>
        <AdminDeliveryUpdatePanel snapshot={snapshot} onLoadLatest={() => query.refetch()} />
        <section className={styles.card} aria-labelledby="admin-delivery-history">
          <h2 id="admin-delivery-history">Event history</h2>
          {snapshot.history.length === 0 ? <p className={styles.muted}>No delivery events recorded.</p>
            : <div className={styles.tableWrap}><table className={styles.table}>
              <thead><tr><th scope="col">Rev</th><th scope="col">Event</th><th scope="col">Details</th><th scope="col">By</th><th scope="col">When</th></tr></thead>
              <tbody>{snapshot.history.map(event => <tr key={event.id}>
                <td className={styles.mono}>{event.revision}</td>
                <td>{EVENT_LABEL[event.type]}{event.changes.length > 1 && <span className={styles.muted}> ({event.changes.join(' + ').toLowerCase()})</span>}</td>
                <td>{[event.toStatus && `${event.fromStatus ? `${stageOf(event.fromStatus).label} → ` : ''}${stageOf(event.toStatus).label}`,
                  event.latitude !== null && `Location ${event.latitude}, ${event.longitude}`,
                  event.changes.includes('ETA') && (event.estimatedAt ? `ETA ${formatStamp(event.estimatedAt)}` : 'ETA cleared'),
                  event.note && `Note: ${event.note}`].filter(Boolean).join(' · ') || '—'}</td>
                <td>{event.actorEmail ?? event.source.toLowerCase()}</td>
                <td><time dateTime={event.occurredAt}>{formatStamp(event.occurredAt)}</time></td>
              </tr>)}</tbody>
            </table></div>}
        </section>
      </div>
      <aside className={styles.aside} aria-labelledby="admin-delivery-preview">
        <h2 id="admin-delivery-preview" className={styles.previewTitle}>Customer will see</h2>
        {snapshot.availability === 'AVAILABLE' || snapshot.availability === 'NOT_STARTED'
          ? <DeliveryOverviewCard snapshot={snapshot} headingLevel={3} />
          : <p className={styles.muted}>The customer sees a {snapshot.availability === 'CANCELLED' ? 'cancelled order' : 'payment pending'} notice instead of tracking.</p>}
      </aside>
    </div>
  </section>;
}
