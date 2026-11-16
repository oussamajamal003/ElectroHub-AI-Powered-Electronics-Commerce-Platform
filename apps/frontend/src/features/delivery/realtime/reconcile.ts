import { MAP_PATH_LIMIT_CLIENT } from './constants';
import type { CustomerDeliverySnapshot, DeliveryUpdatedEvent } from '../types';

/**
 * Task 04.7 revision reconciliation (architecture §8.3). Pure, so the ordering rules are unit-tested without a socket:
 * - no cached snapshot, or a gap (revision > cached + 1): refetch REST;
 * - revision ≤ cached: ignore (duplicate or out of order);
 * - revision = cached + 1: merge the safe projection, prepend the timeline entries, append a new location to the recorded path.
 */
export type Reconciliation = { kind: 'ignore' } | { kind: 'refetch' } | { kind: 'merge'; next: CustomerDeliverySnapshot };
const TIMELINE_LIMIT = 50;

export function reconcileDeliveryEvent(cached: CustomerDeliverySnapshot | undefined, event: DeliveryUpdatedEvent): Reconciliation {
  if (!cached || event.v !== 1 || event.orderReference !== cached.orderReference) return { kind: 'refetch' };
  if (event.revision <= cached.revision) return { kind: 'ignore' };
  if (event.revision !== cached.revision + 1) return { kind: 'refetch' };
  const { map: liveMap, ...fields } = event.snapshot;
  const entries = event.timelineEntries ?? (event.timelineEntry ? [event.timelineEntry] : []);
  const known = new Set(cached.timeline.map(entry => entry.id));
  const timeline = [...entries.filter(entry => !known.has(entry.id)), ...cached.timeline].slice(0, TIMELINE_LIMIT);
  let map = cached.map;
  if (liveMap === null) map = null;
  else if (liveMap) {
    // A changed path kind cannot safely inherit the old kind's points. If the new kind already has history,
    // the event carries no path, so retrieve the authoritative projection instead of guessing.
    if (cached.map && cached.map.pathKind !== liveMap.pathKind && cached.map.path.length && liveMap.pathKind !== 'NONE') return { kind: 'refetch' };
    const path = cached.map?.pathKind === liveMap.pathKind ? [...cached.map.path] : [];
    const location = fields.location;
    const sameSource = location && (liveMap.pathKind === 'SIMULATED_FIXTURE' ? location.source === 'SIMULATED'
      : liveMap.pathKind === 'RECORDED' && location.source === 'MANUAL');
    if (event.changed.includes('location') && location && sameSource) {
      const last = path.at(-1);
      if (!last || last[0] !== location.latitude || last[1] !== location.longitude) path.push([location.latitude, location.longitude]);
    }
    map = { ...liveMap, path: fields.location ? path.slice(-MAP_PATH_LIMIT_CLIENT) : [] };
  }
  return { kind: 'merge', next: { ...cached, ...fields, timeline, map } };
}
