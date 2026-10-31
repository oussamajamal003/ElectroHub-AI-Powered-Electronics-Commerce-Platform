import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Calendar, Check, CheckCircle2, Clock, Copy, Info, MapPin } from 'lucide-react';
import { deliveryLabel, formatEstimate } from '@/features/orders/presentation';
import { ageLabel, formatDay, formatStamp, formatTime, latestUpdate, locationFreshness, stageIndex, STAGES } from '../presentation';
import type { CustomerDeliverySnapshot } from '../types';
import styles from '../Delivery.module.scss';

const HERO = [styles.heroConfirmed, styles.heroPreparing, styles.heroOut, styles.heroDelivered];

/**
 * Status hero, ETA focal panel, location panel and tracking strip (handoff §9.2). Every value comes from the server snapshot: no
 * countdowns, no invented ranges, no coordinates on screen, and no courier, city or position when none was recorded.
 */
export function DeliveryOverviewCard({ snapshot, headingLevel = 2 }: { snapshot: CustomerDeliverySnapshot; headingLevel?: 2 | 3 }) {
  const headingId = useId();
  const index = stageIndex(snapshot.status);
  const stage = STAGES[index]!;
  const delivered = snapshot.status === 'DELIVERED';
  const outForDelivery = snapshot.status === 'OUT_FOR_DELIVERY';
  const Heading = `h${headingLevel}` as const;
  const Icon = stage.icon;
  const latest = latestUpdate(snapshot);

  let description = stage.description;
  if (delivered && snapshot.deliveredAt) description = `Delivered on ${formatDay(snapshot.deliveredAt)} at ${formatTime(snapshot.deliveredAt)}.`;
  if (outForDelivery && snapshot.isSimulated) description = 'Simulated demo journey. This is not a real courier.';

  return <div className={styles.overviewWrap}>
    <section className={styles.overview} aria-labelledby={headingId}>
      <Heading className={styles.visuallyHidden} id={headingId}>Delivery overview</Heading>
      <div className={`${styles.hero} ${HERO[index]}`}>
        <div className={styles.heroTop}>
          <span className={styles.tile}><Icon aria-hidden="true" /></span>
          <div className={styles.heroText}><span className={styles.eyebrow}>Delivery status</span><span className={styles.heroTitle}>{stage.title}</span></div>
        </div>
        <p className={styles.heroDescription}>{description}</p>
        <div className={styles.segments} aria-hidden="true">
          {STAGES.map((item, position) => <span key={item.key} className={`${styles.segment} ${position <= index ? styles.segmentOn : ''}`} />)}
        </div>
        <span className={styles.stepOf}>Step {index + 1} of 4 · {stage.label}</span>
      </div>
      <div className={styles.panels}>
        <EtaPanel snapshot={snapshot} />
        <LocationPanel snapshot={snapshot} />
      </div>
      <dl className={styles.meta}>
        <div><dt>Tracking reference</dt><dd>{snapshot.trackingReference
          ? <TrackingReference value={snapshot.trackingReference} />
          : <span className={styles.sub}>Assigned when tracking starts</span>}</dd></div>
        <div><dt>Delivery method</dt><dd>{deliveryLabel(snapshot.deliveryMethod)}</dd></div>
        <div><dt>Latest update</dt><dd>{latest ? <time dateTime={latest}>{formatStamp(latest)}</time> : 'None recorded yet'}</dd></div>
      </dl>
    </section>
  </div>;
}

function EtaPanel({ snapshot }: { snapshot: CustomerDeliverySnapshot }) {
  if (snapshot.status === 'DELIVERED') {
    return <div className={`${styles.panel} ${styles.panelDone}`}>
      <span className={`${styles.panelTile} ${styles.panelTileOk}`}><CheckCircle2 aria-hidden="true" /></span>
      <span className={styles.eyebrow}>Delivered</span>
      {snapshot.deliveredAt ? <><time className={styles.big} dateTime={snapshot.deliveredAt}>{formatDay(snapshot.deliveredAt)}</time>
        <span className={styles.mid}>{formatTime(snapshot.deliveredAt)}</span></>
        : <span className={`${styles.big} ${styles.bigSoft}`}>Delivered</span>}
    </div>;
  }
  const estimate = snapshot.eta.estimatedAt;
  if (estimate) {
    return <div className={styles.panel}>
      <span className={styles.panelTile}><Calendar aria-hidden="true" /></span>
      <span className={styles.eyebrow}>Estimated arrival</span>
      <time className={styles.big} dateTime={estimate}>{formatDay(estimate)}</time>
      <span className={styles.mid}><Clock aria-hidden="true" />Around {formatTime(estimate)}</span>
      <p className={styles.panelNote}><Info aria-hidden="true" />An estimate, not a guarantee.</p>
    </div>;
  }
  return <div className={`${styles.panel} ${styles.panelMuted}`}>
    <span className={`${styles.panelTile} ${styles.panelTileNeutral}`}><Calendar aria-hidden="true" /></span>
    <span className={styles.eyebrow}>Estimated arrival</span>
    <span className={`${styles.big} ${styles.bigSoft}`}>Not available yet</span>
    <span className={styles.mid}>Originally estimated {formatEstimate(snapshot.eta.promisedStart, snapshot.eta.promisedEnd)}</span>
    <p className={styles.panelNote}><Info aria-hidden="true" />This is the window shown at checkout.</p>
  </div>;
}

function LocationPanel({ snapshot }: { snapshot: CustomerDeliverySnapshot }) {
  if (snapshot.status === 'DELIVERED') {
    return <div className={`${styles.panel} ${styles.panelDone}`}>
      <span className={`${styles.panelTile} ${styles.panelTileOk}`}><MapPin aria-hidden="true" /></span>
      <span className={styles.eyebrow}>Delivery</span><span className={`${styles.mid} ${styles.midStrong}`}>Completed</span>
      <p className={styles.panelNote}>Live location is switched off after delivery.</p>
    </div>;
  }
  const freshness = locationFreshness(snapshot);
  if (snapshot.status !== 'OUT_FOR_DELIVERY' || !snapshot.location || !freshness) {
    return <div className={`${styles.panel} ${styles.panelMuted}`}>
      <span className={`${styles.panelTile} ${styles.panelTileNeutral}`}><MapPin aria-hidden="true" /></span>
      <span className={styles.eyebrow}>Last known location</span><span className={`${styles.mid} ${styles.midStrong}`}>Not shared yet</span>
      <p className={styles.panelNote}>{snapshot.status === 'OUT_FOR_DELIVERY' ? 'Your order is on its way. No location has been shared yet.'
        : 'Location appears here once your order is out for delivery.'}</p>
    </div>;
  }
  const simulated = snapshot.location.source === 'SIMULATED';
  const label = simulated ? 'Simulated position' : snapshot.location.label ?? 'Position shared by the courier team';
  const updated = snapshot.location.updatedAt;
  return <div className={`${styles.panel} ${freshness.stale ? styles.panelWarn : ''}`}>
    <span className={`${styles.panelTile} ${freshness.stale ? styles.panelTileWarn : ''}`}><MapPin aria-hidden="true" /></span>
    <span className={styles.eyebrow}>Last known location</span>
    <span className={`${styles.mid} ${styles.midStrong}`}>{label}</span>
    {freshness.stale
      ? <><span className={`${styles.pill} ${styles.pillWarn}`}><Clock aria-hidden="true" />Stale · updated {ageLabel(freshness.minutes)}</span>
        <p className={styles.panelNote}><AlertTriangle aria-hidden="true" />This may not be where your order is now.</p></>
      : <><span className={`${styles.pill} ${styles.pillOk}`}><Check aria-hidden="true" />Recent · updated {ageLabel(freshness.minutes)}</span>
        <p className={styles.panelNote}><time dateTime={updated}>{formatTime(updated)}</time>&nbsp;local time</p></>}
  </div>;
}

/** Copies the reference returned by the server. Success and failure are announced through a polite status region. */
function TrackingReference({ value }: { value: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const settle = (next: 'copied' | 'failed') => {
    setState(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2600);
  };
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      settle('copied');
    } catch { settle('failed'); }
  };
  return <span className={styles.reference}>
    <span className={styles.mono}>{value}</span>
    <button type="button" className={styles.copy} onClick={() => void copy()} aria-label={`Copy tracking reference ${value}`}>
      {state === 'copied' ? <><Check aria-hidden="true" />Copied</> : <><Copy aria-hidden="true" />Copy</>}
    </button>
    {state === 'failed' && <span className={styles.copyError} aria-hidden="true">Couldn&apos;t copy. Select the reference and copy it manually.</span>}
    <span className={styles.visuallyHidden} role="status">{state === 'copied' ? 'Tracking reference copied.'
      : state === 'failed' ? 'Couldn’t copy the tracking reference. Select it and copy it manually.' : ''}</span>
  </span>;
}
