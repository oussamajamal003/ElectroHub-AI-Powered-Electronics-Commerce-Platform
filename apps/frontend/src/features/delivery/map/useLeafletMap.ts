import { useCallback, useEffect, useRef, type RefObject } from 'react';
import L from 'leaflet';
import { markerIcon, type DeliveryLayers, type MapTileConfig } from './markers';

const FIT_PADDING: L.PointExpression = [32, 32];
const MAX_FIT_ZOOM = 15;

/**
 * Owns one Leaflet map for the life of the container: created once, layers updated in place when the snapshot changes (no remount), and
 * removed on unmount. Bounds are fitted on the first draw only, so a background refetch never yanks the viewport; Recenter fits again.
 * A first view in which no tile loads at all, or an init failure, is reported through `onError`.
 */
export function useLeafletMap(container: RefObject<HTMLDivElement | null>, options: {
  tiles: MapTileConfig; layers: DeliveryLayers; classes: Record<string, string>; label: string; describedBy: string; onError: () => void;
}) {
  const { tiles, layers, classes, label, describedBy, onError } = options;
  const mapRef = useRef<L.Map | null>(null);
  const groupRef = useRef<L.LayerGroup | null>(null);
  const boundsRef = useRef<L.LatLngBounds | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let map: L.Map;
    try {
      // Leaflet's own attribution control writes HTML; the component renders the attribution as text instead.
      map = L.map(element, { zoomControl: false, attributionControl: false, scrollWheelZoom: false, keyboard: true, zoomSnap: 0.5 });
      let loaded = false;
      L.tileLayer(tiles.url, { maxZoom: 19, crossOrigin: false })
        .on('tileload', () => { loaded = true; })
        // 'load' fires once every visible tile has settled (loaded or failed): fail only when none of them loaded.
        .on('load', () => { if (!loaded) errorRef.current(); })
        .addTo(map);
      groupRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      const keyboardTarget = map.getContainer();
      keyboardTarget.setAttribute('role', 'region');
      keyboardTarget.setAttribute('aria-roledescription', 'map');
      keyboardTarget.setAttribute('aria-label', label);
      keyboardTarget.setAttribute('aria-describedby', describedBy);
    } catch {
      errorRef.current();
      return;
    }
    return () => { map.remove(); mapRef.current = null; groupRef.current = null; boundsRef.current = null; };
    // The map lives as long as its container; label/description/tiles are fixed for a mount (Retry remounts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container]);

  useEffect(() => {
    const map = mapRef.current;
    const group = groupRef.current;
    if (!map || !group) return;
    group.clearLayers();
    const all: L.LatLngExpression[] = [];
    if (layers.line) {
      const simulated = layers.line.kind === 'simulated';
      L.polyline(layers.line.points, { className: simulated ? classes.routeSimulated : classes.routeRecorded, weight: simulated ? 3 : 4,
        dashArray: simulated ? '8 6' : undefined, interactive: false }).addTo(group);
      all.push(...layers.line.points);
    }
    for (const marker of layers.markers) {
      L.marker(marker.position, { icon: markerIcon(L, marker.kind, layers.stale, classes), keyboard: false, interactive: false }).addTo(group);
      all.push(marker.position);
    }
    const bounds = L.latLngBounds(all);
    const first = boundsRef.current === null;
    boundsRef.current = bounds;
    if (first && bounds.isValid()) map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM, animate: false });
  }, [layers, classes]);

  const zoomIn = useCallback(() => mapRef.current?.zoomIn(), []);
  const zoomOut = useCallback(() => mapRef.current?.zoomOut(), []);
  const recenter = useCallback(() => {
    const bounds = boundsRef.current;
    if (mapRef.current && bounds?.isValid()) mapRef.current.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM });
  }, []);
  /** Mobile "Explore map" gate: pan/zoom gestures and arrow keys stay off until the customer opts in, so page scroll is never trapped. */
  const setInteractive = useCallback((interactive: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    for (const handler of [map.dragging, map.touchZoom, map.doubleClickZoom, map.boxZoom, map.keyboard]) {
      if (interactive) handler.enable(); else handler.disable();
    }
    // Leaflet's keyboard handler owns the container's tab stop; a disabled map is not a focus target.
    map.getContainer().tabIndex = interactive ? 0 : -1;
  }, []);

  return { zoomIn, zoomOut, recenter, setInteractive };
}
