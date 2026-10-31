import { Check, Clock, FlaskConical } from 'lucide-react';
import { ageLabel, formatStamp, locationFreshness } from '../presentation';
import type { CustomerDeliverySnapshot } from '../types';
import { DeliveryStateNotice } from './DeliveryStateNotice';
import styles from '../Delivery.module.scss';

/**
 * Task 04.5 location shell: the accessible text summary the map panel always starts with. Task 04.6 adds the Leaflet map below it;
 * until then nothing pictorial is drawn, so no artwork can be mistaken for real tracking data.
 */
export function DeliveryMapPanel({ snapshot }: { snapshot: CustomerDeliverySnapshot }) {
  const freshness = locationFreshness(snapshot);
  const location = snapshot.status === 'OUT_FOR_DELIVERY' ? snapshot.location : null;
  const simulated = snapshot.isSimulated || location?.source === 'SIMULATED';
  return <section className={styles.card} aria-labelledby="delivery-location-heading">
    <div className={styles.cardHead}><h2 id="delivery-location-heading">Delivery location</h2>
      <span className={styles.noticeActions}>
        {location && freshness && (freshness.stale
          ? <span className={`${styles.pill} ${styles.pillWarn}`}><Clock aria-hidden="true" />Stale · {ageLabel(freshness.minutes)}</span>
          : <span className={`${styles.pill} ${styles.pillInfo}`}><Check aria-hidden="true" />Updated {ageLabel(freshness.minutes)}</span>)}
        {simulated && <span className={`${styles.pill} ${styles.pillInfo}`}><FlaskConical aria-hidden="true" />Simulated demo</span>}
      </span>
    </div>
    <p className={styles.summary}>{summary(snapshot, freshness?.stale ?? false, freshness?.minutes ?? 0)}</p>
    {location ? <dl className={styles.facts}>
      <div><dt>Last known location</dt><dd>{location.source === 'SIMULATED' ? 'Simulated position' : location.label ?? 'Position shared by the courier team'}</dd></div>
      <div><dt>Updated</dt><dd><time dateTime={location.updatedAt}>{formatStamp(location.updatedAt)}</time></dd></div>
      <div><dt>Source</dt><dd>{location.source === 'SIMULATED' ? 'Simulated demo data' : 'Recorded by our delivery team'}</dd></div>
    </dl> : snapshot.status !== 'DELIVERED' && <DeliveryStateNotice kind="noLocation" inline />}
  </section>;
}

function summary(snapshot: CustomerDeliverySnapshot, stale: boolean, minutes: number) {
  if (snapshot.status === 'DELIVERED') return 'Your order was delivered. Live location is switched off after delivery.';
  if (snapshot.status !== 'OUT_FOR_DELIVERY') return 'No location has been shared yet. It will appear once your order is out for delivery.';
  if (!snapshot.location) return 'Out for delivery, but no location has been shared yet.';
  const where = snapshot.location.source === 'SIMULATED' ? 'a simulated position' : snapshot.location.label ? snapshot.location.label : 'a position shared by our delivery team';
  return `Out for delivery. Last known location: ${where}, recorded ${ageLabel(minutes)}${stale ? ', which may be out of date' : ''}. This is not a guaranteed route.`;
}
