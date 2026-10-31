import type { DeliveryOrigin } from '../config/delivery-map.config.js';

/**
 * Task 04.6 DeliveryMapProjection (architecture §7.3). Additive `map` field on the owner-scoped customer snapshot. The destination comes
 * only from the order's stored shipping coordinates (rounded to 3 dp, ~110 m); the path is the recorded LOCATION positions of this delivery,
 * oldest first, at most MAP_PATH_LIMIT points. Nothing is geocoded or routed, and no origin→destination segment is ever produced: the path
 * contains recorded points only.
 */
export const MAP_PATH_LIMIT = 200;
export type MapPathKind = 'RECORDED' | 'SIMULATED_FIXTURE' | 'NONE';
export type CustomerDeliveryMap = {
  origin: DeliveryOrigin;
  destination: { latitude: number; longitude: number } | null;
  path: [number, number][];
  pathKind: MapPathKind;
};

const inRange = (latitude: number, longitude: number) =>
  Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Re-validates every coordinate before it leaves the server; invalid points are dropped, never repaired. */
export function buildDeliveryMap(input: {
  origin: DeliveryOrigin;
  shipping: { latitude: number | null; longitude: number | null };
  points: { latitude: number | null; longitude: number | null }[];
  isSimulated: boolean;
}): CustomerDeliveryMap {
  const { latitude, longitude } = input.shipping;
  const destination = latitude !== null && longitude !== null && inRange(latitude, longitude)
    ? { latitude: round3(latitude), longitude: round3(longitude) } : null;
  const path: [number, number][] = [];
  for (const point of input.points) {
    if (point.latitude === null || point.longitude === null || !inRange(point.latitude, point.longitude)) continue;
    path.push([point.latitude, point.longitude]);
  }
  const bounded = path.slice(-MAP_PATH_LIMIT);
  return { origin: input.origin, destination, path: bounded,
    pathKind: bounded.length === 0 ? 'NONE' : input.isSimulated ? 'SIMULATED_FIXTURE' : 'RECORDED' };
}
