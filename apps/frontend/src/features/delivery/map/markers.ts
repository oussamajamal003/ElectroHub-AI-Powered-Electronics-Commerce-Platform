import type * as Leaflet from 'leaflet';
import type { CustomerDeliveryMap, CustomerDeliverySnapshot } from '../types';

/**
 * Task 04.6 map layers (architecture §7, handoff §9.3). Pure and Leaflet-free at runtime (type imports only), so the main bundle can decide
 * whether the lazy map chunk is needed at all. The only line ever produced is the polyline through `map.path`; origin, destination and the
 * courier are markers. No origin→destination segment can be built (AC3).
 */
export type LatLng = [number, number];
export type MarkerKind = 'origin' | 'destination' | 'courier';
export interface DeliveryLayers {
  markers: { kind: MarkerKind; position: LatLng }[];
  line: { kind: 'recorded' | 'simulated'; points: LatLng[] } | null;
  stale: boolean;
  routeUnavailable: boolean;
}

const valid = (latitude: unknown, longitude: unknown): boolean =>
  typeof latitude === 'number' && typeof longitude === 'number' && Number.isFinite(latitude) && Number.isFinite(longitude)
  && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;

/** Client re-validation: non-finite or out-of-range points are discarded, never repaired. */
export function sanitizePath(path: unknown): LatLng[] {
  if (!Array.isArray(path)) return [];
  return path.filter((point): point is LatLng => Array.isArray(point) && point.length === 2 && valid(point[0], point[1]));
}

type Input = Pick<CustomerDeliverySnapshot, 'status' | 'location'> & { map: CustomerDeliveryMap; stale: boolean };

export function buildDeliveryLayers({ map, status, location, stale }: Input): DeliveryLayers {
  const markers: DeliveryLayers['markers'] = [];
  if (valid(map.origin?.latitude, map.origin?.longitude)) markers.push({ kind: 'origin', position: [map.origin.latitude, map.origin.longitude] });
  if (map.destination && valid(map.destination.latitude, map.destination.longitude)) {
    markers.push({ kind: 'destination', position: [map.destination.latitude, map.destination.longitude] });
  }
  const courier = status === 'OUT_FOR_DELIVERY' && location && valid(location.latitude, location.longitude) ? location : null;
  if (courier) markers.push({ kind: 'courier', position: [courier.latitude, courier.longitude] });
  const points = map.pathKind === 'NONE' ? [] : sanitizePath(map.path);
  // A single point is not a line; it is still represented by the courier marker.
  const line = points.length >= 2 ? { kind: map.pathKind === 'SIMULATED_FIXTURE' ? 'simulated' as const : 'recorded' as const, points } : null;
  return { markers, line, stale: Boolean(courier) && stale, routeUnavailable: line === null };
}

/** AC4: the Leaflet chunk is wanted only when there is a courier position or a drawable path. */
export function hasDrawableMap(snapshot: Pick<CustomerDeliverySnapshot, 'status' | 'location' | 'map'>): boolean {
  const map = snapshot.map;
  if (!map || !valid(map.origin?.latitude, map.origin?.longitude)) return false;
  const courier = snapshot.status === 'OUT_FOR_DELIVERY' && snapshot.location !== null && valid(snapshot.location.latitude, snapshot.location.longitude);
  return courier || (map.pathKind !== 'NONE' && sanitizePath(map.path).length >= 2);
}

/** `divIcon` markers styled by token classes (LeafletDeliveryMap.module.scss). Decorative: the summary and legend carry the facts. */
export function markerIcon(L: typeof Leaflet, kind: MarkerKind, stale: boolean, classes: Record<string, string>) {
  const size: Record<MarkerKind, [number, number]> = { origin: [24, 24], destination: [24, 32], courier: [22, 22] };
  const [width, height] = size[kind];
  const className = [classes.marker, classes[kind], kind === 'courier' && stale ? classes.stale : ''].filter(Boolean).join(' ');
  return L.divIcon({ className, html: '<span aria-hidden="true"></span>', iconSize: [width, height],
    iconAnchor: kind === 'destination' ? [width / 2, height] : [width / 2, height / 2] });
}

export interface MapTileConfig { url: string; attribution: string; attributionUrl: string }
const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright';

/**
 * VITE_MAP_TILE_URL / VITE_MAP_ATTRIBUTION (+ optional VITE_MAP_ATTRIBUTION_URL). Missing or malformed → null and the panel stays text-only. Only an XYZ template over https
 * (or plain http on a loopback host for local QA) is accepted; the attribution is rendered as text, never as HTML.
 */
export function mapTileConfig(env: { VITE_MAP_TILE_URL?: string; VITE_MAP_ATTRIBUTION?: string; VITE_MAP_ATTRIBUTION_URL?: string } = import.meta.env): MapTileConfig | null {
  const url = env.VITE_MAP_TILE_URL?.trim();
  const attribution = env.VITE_MAP_ATTRIBUTION?.trim();
  if (!url || !attribution || !['{z}', '{x}', '{y}'].every(part => url.includes(part))) return null;
  try {
    const parsed = new URL(url.replace(/\{[a-z]+\}/g, '0'));
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) return null;
  } catch { return null; }
  // The provider's own terms link (D1); OSM's copyright page when unset. Only an https link is accepted.
  const link = env.VITE_MAP_ATTRIBUTION_URL?.trim();
  let attributionUrl = OSM_COPYRIGHT;
  if (link) {
    try { if (new URL(link).protocol !== 'https:') return null; attributionUrl = link; } catch { return null; }
  }
  return { url, attribution, attributionUrl };
}
