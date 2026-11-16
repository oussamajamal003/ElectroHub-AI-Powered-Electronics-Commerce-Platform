import { useSyncExternalStore } from 'react';

// Observation intent only: no card data, client secret, shipping or claimed financial status.
type Snapshot = { attemptId: string; state: string; updatedAt?: string | null; classification?: string };
type Observation = { attemptId: string; beforeState: string; beforeUpdatedAt: string | null };
const memory = new Map<string, Observation[]>();
const listeners = new Set<() => void>(); let version = 0;
const key = (owner: string) => `electrohub:payment-observation:v1:${owner}`;
const read = (owner: string): Observation[] => {
  if (memory.has(owner)) return memory.get(owner)!;
  let rows: Observation[] = [];
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(key(owner)) ?? '[]');
    if (Array.isArray(saved)) rows = saved.filter((item): item is Observation => Boolean(item && typeof item === 'object' &&
      typeof item.attemptId === 'string' && typeof item.beforeState === 'string' &&
      (item.beforeUpdatedAt === null || typeof item.beforeUpdatedAt === 'string')));
  } catch { /* Memory still supports this tab when storage is unavailable. */ }
  memory.set(owner, rows); return rows;
};
const save = (owner: string, rows: Observation[]) => {
  memory.set(owner, rows);
  try { if (rows.length) sessionStorage.setItem(key(owner), JSON.stringify(rows)); else sessionStorage.removeItem(key(owner)); } catch { /* Memory fallback. */ }
  version++; listeners.forEach(listener => listener());
};
export function beginPaymentObservation(owner: string, snapshot: Snapshot) {
  save(owner, [...read(owner).filter(item => item.attemptId !== snapshot.attemptId),
    { attemptId: snapshot.attemptId, beforeState: snapshot.state, beforeUpdatedAt: snapshot.updatedAt ?? null }]);
}
export function endPaymentObservation(owner: string, attemptId: string) {
  const rows = read(owner); if (rows.some(item => item.attemptId === attemptId)) save(owner, rows.filter(item => item.attemptId !== attemptId));
}
export function observedPaymentIds(owner: string) { return new Set(read(owner).map(item => item.attemptId)); }
/** An old decline is not evidence of the outcome of a new confirmation of the SAME Intent. */
export function isPreviousPaymentResult(owner: string, snapshot: Snapshot) {
  const observation = read(owner).find(item => item.attemptId === snapshot.attemptId);
  const before = Date.parse(observation?.beforeUpdatedAt ?? ''); const current = Date.parse(snapshot.updatedAt ?? '');
  return Boolean(observation && ['DECLINED', 'AWAITING_INPUT', 'ACTION_REQUIRED'].includes(snapshot.state) &&
    snapshot.state === observation.beforeState && (!Number.isFinite(before) || !Number.isFinite(current) || current <= before));
}
/** A server list/status read can finish observation only when it establishes a NEW terminal result. */
export function observePaymentSnapshot(owner: string, snapshot: Snapshot) {
  if (snapshot.classification === 'UNKNOWN' || snapshot.classification === 'PROCESSING' || snapshot.classification === 'ORDER_PROCESSING') return;
  if (snapshot.state === 'PAID' || ['DECLINED', 'CANCELED', 'COMPENSATED', 'REFUNDED'].includes(snapshot.state) && !isPreviousPaymentResult(owner, snapshot)) {
    endPaymentObservation(owner, snapshot.attemptId);
  }
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function usePaymentObservations() { return useSyncExternalStore(subscribe, () => version); }
