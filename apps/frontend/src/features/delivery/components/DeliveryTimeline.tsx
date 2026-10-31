import { Calendar, Clock, PackageCheck } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { eventCopy, formatStamp, stageOf } from '../presentation';
import type { DeliveryTimelineEntry } from '../types';
import styles from '../Delivery.module.scss';

/** Only events stored in DeliveryEvent appear, newest first. Earlier steps are never back-filled to make the list look fuller. */
export function DeliveryTimeline({ entries, trackingReference }: { entries: DeliveryTimelineEntry[]; trackingReference: string | null }) {
  return <section className={styles.card} aria-labelledby="delivery-history-heading">
    <div className={styles.cardHead}><h2 id="delivery-history-heading">Delivery history</h2>
      <span className={styles.sub}>{entries.length} {entries.length === 1 ? 'event' : 'events'} recorded</span></div>
    {entries.length === 0
      ? <div className={styles.empty}><Clock aria-hidden="true" /><p><strong>No tracking events recorded yet.</strong>
        Updates appear here as your order moves. Nothing is back-filled for earlier steps.</p></div>
      : <ol className={styles.timeline} reversed>
        {entries.map((entry, position) => {
          const copy = eventCopy(entry, trackingReference);
          const Icon = entry.type === 'TRACKING_STARTED' ? PackageCheck : entry.type === 'STATUS_CHANGED' ? stageOf(entry.status ?? '').icon : Calendar;
          return <li key={entry.id} className={`${styles.event} ${position === 0 ? styles.eventLatest : ''}`}>
            <span className={styles.eventNode}><Icon aria-hidden="true" /></span>
            <div className={styles.eventBody}>
              <div className={styles.eventTitle}><strong>{copy.title}</strong>{position === 0 && <Badge variant="info" size="sm">Latest</Badge>}</div>
              <p>{copy.description}</p>
            </div>
            <time dateTime={entry.occurredAt}>{formatStamp(entry.occurredAt)}</time>
          </li>;
        })}
      </ol>}
  </section>;
}
