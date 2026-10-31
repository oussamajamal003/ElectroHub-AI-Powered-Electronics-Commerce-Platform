import { Component, lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react';
import { Check, Clock, FlaskConical, RefreshCw } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { buildDeliveryLayers, hasDrawableMap, mapTileConfig } from '../map/markers';
import { ageLabel, formatStamp, locationFreshness } from '../presentation';
import type { CustomerDeliverySnapshot } from '../types';
import { DeliveryStateNotice } from './DeliveryStateNotice';
import styles from '../Delivery.module.scss';

const loadMap = () => import('../map/LeafletDeliveryMap');

/** Catches a failed lazy-chunk load so the panel can offer Retry instead of breaking the page. */
class MapBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/**
 * Location panel: the accessible text summary always comes first (Task 04.5). Task 04.6 adds the Leaflet map below it, lazy-loaded only
 * when tiles are configured and there is a courier position or a recorded path to draw (AC4). Tile, init or chunk failures fall back to
 * the summary plus a warning and Retry.
 */
export function DeliveryMapPanel({ snapshot }: { snapshot: CustomerDeliverySnapshot }) {
  const freshness = locationFreshness(snapshot);
  const location = snapshot.status === 'OUT_FOR_DELIVERY' ? snapshot.location : null;
  const simulated = snapshot.isSimulated || location?.source === 'SIMULATED';
  const tiles = useMemo(() => mapTileConfig(), []);
  const drawable = tiles !== null && hasDrawableMap(snapshot);
  return <section className={styles.card} aria-labelledby="delivery-location-heading">
    <div className={styles.cardHead}><h2 id="delivery-location-heading">Delivery location</h2>
      <span className={styles.noticeActions}>
        {location && freshness && (freshness.stale
          ? <span className={`${styles.pill} ${styles.pillWarn}`}><Clock aria-hidden="true" />Stale · {ageLabel(freshness.minutes)}</span>
          : <span className={`${styles.pill} ${styles.pillInfo}`}><Check aria-hidden="true" />Updated {ageLabel(freshness.minutes)}</span>)}
        {simulated && <span className={`${styles.pill} ${styles.pillInfo}`}><FlaskConical aria-hidden="true" />Simulated demo</span>}
      </span>
    </div>
    <p className={styles.summary} id="delivery-map-summary">{summary(snapshot, freshness?.stale ?? false, freshness?.minutes ?? 0)}</p>
    {location ? <dl className={styles.facts}>
      <div><dt>Last known location</dt><dd>{location.source === 'SIMULATED' ? 'Simulated position' : location.label ?? 'Position shared by the courier team'}</dd></div>
      <div><dt>Updated</dt><dd><time dateTime={location.updatedAt}>{formatStamp(location.updatedAt)}</time></dd></div>
      <div><dt>Source</dt><dd>{location.source === 'SIMULATED' ? 'Simulated demo data' : 'Recorded by our delivery team'}</dd></div>
    </dl> : snapshot.status !== 'DELIVERED' && <DeliveryStateNotice kind="noLocation" inline />}
    {/* Keyed by order: another order's tracking page never inherits this map's viewport, failure state or layers. */}
    {drawable && tiles && <DeliveryMap key={snapshot.orderReference} snapshot={snapshot} tiles={tiles} stale={freshness?.stale ?? false} />}
  </section>;
}

function DeliveryMap({ snapshot, tiles, stale }: { snapshot: CustomerDeliverySnapshot; tiles: NonNullable<ReturnType<typeof mapTileConfig>>; stale: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  // A new lazy() per attempt: React caches a rejected chunk import, so Retry must ask for the module again.
  const [LeafletDeliveryMap, setLeafletDeliveryMap] = useState(() => lazy(loadMap));
  const layers = useMemo(() => buildDeliveryLayers({ map: snapshot.map!, status: snapshot.status, location: snapshot.location, stale }),
    [snapshot.map, snapshot.status, snapshot.location, stale]);
  const fail = useCallback(() => setFailed(true), []);
  if (failed) return <Alert variant="warning" className={styles.mapAlert}>
    <p>The map couldn't load. The summary above has the latest delivery details.</p>
    <Button type="button" variant="outline" size="large" onClick={() => { setFailed(false); setAttempt(value => value + 1); setLeafletDeliveryMap(() => lazy(loadMap)); }}>
      <RefreshCw aria-hidden="true" />Retry map</Button>
  </Alert>;
  return <MapBoundary key={attempt} onError={fail}>
    <Suspense fallback={<div className={styles.mapLoading} aria-hidden="true"><Skeleton width="100%" height="100%" /></div>}>
      <LeafletDeliveryMap key={attempt} layers={layers} tiles={tiles} summaryId="delivery-map-summary" onError={fail} />
    </Suspense>
  </MapBoundary>;
}

function summary(snapshot: CustomerDeliverySnapshot, stale: boolean, minutes: number) {
  if (snapshot.status === 'DELIVERED') return 'Your order was delivered. Live location is switched off after delivery.';
  if (snapshot.status !== 'OUT_FOR_DELIVERY') return 'No location has been shared yet. It will appear once your order is out for delivery.';
  if (!snapshot.location) return 'Out for delivery, but no location has been shared yet.';
  const where = snapshot.location.source === 'SIMULATED' ? 'a simulated position' : snapshot.location.label ? snapshot.location.label : 'a position shared by our delivery team';
  return `Out for delivery. Last known location: ${where}, recorded ${ageLabel(minutes)}${stale ? ', which may be out of date' : ''}. This is not a guaranteed route.`;
}
