import { useEffect, useRef, useState } from 'react';
import { Crosshair, Map as MapIcon, Minus, Plus } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { Button } from '@/components/ui/Button';
import type { DeliveryLayers, MapTileConfig } from './markers';
import { useLeafletMap } from './useLeafletMap';
import styles from './LeafletDeliveryMap.module.scss';

const NARROW = '(max-width: 47.99rem)';
const narrowNow = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches;

export interface LeafletDeliveryMapProps {
  layers: DeliveryLayers;
  tiles: MapTileConfig;
  summaryId: string;
  onError: () => void;
}

/**
 * Task 04.6 Leaflet map (lazy chunk; Leaflet and its CSS load only here). Handoff §9.3: 44px zoom and Recenter controls, always-visible
 * attribution, legend + caption, and below 48rem a map that stays inert until "Explore map" so page scroll is never captured.
 */
export default function LeafletDeliveryMap({ layers, tiles, summaryId, onError }: LeafletDeliveryMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(narrowNow);
  const [exploring, setExploring] = useState(false);
  const map = useLeafletMap(container, { tiles, layers, classes: styles, label: 'Delivery map', describedBy: summaryId, onError });
  const interactive = !narrow || exploring;
  const { setInteractive } = map;
  useEffect(() => { setInteractive(interactive); }, [interactive, setInteractive]);
  // Rotation or resizing across 48rem re-applies the gate, so touch scrolling is never captured by a newly narrow map.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(NARROW);
    const change = () => { setNarrow(query.matches); setExploring(false); };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);

  const simulated = layers.line?.kind === 'simulated';
  const hasDestination = layers.markers.some(marker => marker.kind === 'destination');
  const hasCourier = layers.markers.some(marker => marker.kind === 'courier');
  return <div className={styles.wrap}>
    <div className={styles.frame} data-interactive={interactive}>
      <div ref={container} className={styles.map} data-testid="delivery-leaflet-map" />
      <div className={styles.controls}>
        <button type="button" className={styles.control} onClick={map.zoomIn} aria-label="Zoom in" disabled={!interactive}><Plus aria-hidden="true" /></button>
        <button type="button" className={styles.control} onClick={map.zoomOut} aria-label="Zoom out" disabled={!interactive}><Minus aria-hidden="true" /></button>
        <button type="button" className={styles.control} onClick={map.recenter} aria-label="Recenter map"><Crosshair aria-hidden="true" /></button>
      </div>
      {narrow && !exploring && <div className={styles.gate}>
        <Button type="button" variant="primary" size="large" onClick={() => setExploring(true)}><MapIcon aria-hidden="true" />Explore map</Button>
      </div>}
      {narrow && exploring && <button type="button" className={`${styles.control} ${styles.done}`} onClick={() => setExploring(false)}>Done</button>}
      <p className={styles.attribution}>
        <a href={tiles.attributionUrl} target="_blank" rel="noopener noreferrer">{tiles.attribution}</a>
      </p>
    </div>
    <ul className={styles.legend} aria-label="Map legend">
      <li><span className={`${styles.swatch} ${styles.swatchOrigin}`} aria-hidden="true" />Dispatch hub</li>
      {hasCourier && <li><span className={`${styles.swatch} ${styles.swatchCourier} ${layers.stale ? styles.swatchStale : ''}`} aria-hidden="true" />
        {layers.stale ? 'Last known position (stale)' : simulated ? 'Simulated position' : 'Latest position'}</li>}
      {layers.line && <li><span className={`${styles.swatch} ${simulated ? styles.swatchSimulated : styles.swatchRecorded}`} aria-hidden="true" />
        {simulated ? 'Simulated route' : 'Recorded positions'}</li>}
      {hasDestination && <li><span className={`${styles.swatch} ${styles.swatchDestination}`} aria-hidden="true" />Delivery area</li>}
    </ul>
    <p className={styles.caption}>{caption(layers, simulated)}</p>
  </div>;
}

function caption(layers: DeliveryLayers, simulated: boolean) {
  if (simulated) return 'Simulated demo route. It is not real delivery data.';
  if (layers.routeUnavailable) return 'Route not available. Only the latest recorded position is shown.';
  return 'The line joins positions recorded by our delivery team. It is not a planned road route.';
}
