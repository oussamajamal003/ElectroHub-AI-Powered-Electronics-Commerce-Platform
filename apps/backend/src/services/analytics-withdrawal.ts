import { ANALYTICS_TOKEN_TTL_MS } from './analytics-token.js';

/**
 * Task 06.2 — in-flight analytics withdrawal for image search.
 *
 * Consent is sent when a photo search starts, but the outcome is written only when inference finishes (up to the 25 s
 * admission budget later). A shopper who withdraws in that window sends the search's random reference here, so the
 * controller skips the write, or the write is undone if it already happened, and no selection token can be used for it.
 *
 * Deliberately in-process and memory-only, like the image-search admission budget it sits beside: the reference is a random
 * UUID chosen per search, never persisted, never linked to a user, IP or cookie, and forgotten after the selection-token TTL.
 * A horizontally scaled backend would need a shared store for this registry; see the Task 06.2 privacy evidence.
 */
export const WITHDRAWAL_TTL_MS = ANALYTICS_TOKEN_TTL_MS;
const MAX_ENTRIES = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** ref -> expiry for withdrawn references. */
const revokedRefs = new Map<string, number>();
/** correlation id -> expiry for searches whose analytics were withdrawn (blocks late selection tokens). */
const revokedCorrelations = new Map<string, number>();
/** ref -> correlation id, kept so a withdrawal that arrives after the write can still find and remove it. */
const bindings = new Map<string, { correlationId: string; expiresAt: number }>();

function prune(map: Map<string, unknown>, now: number) {
  for (const [key, value] of map) {
    const expiresAt = typeof value === 'number' ? value : (value as { expiresAt: number }).expiresAt;
    if (expiresAt > now && map.size <= MAX_ENTRIES) break; // insertion order ≈ expiry order; stop at the first live entry
    map.delete(key);
  }
}

export const normalizeAnalyticsRef = (value: unknown): string | null =>
  typeof value === 'string' && UUID.test(value.toLowerCase()) ? value.toLowerCase() : null;

/** Links a pending search's reference to its server-side correlation id. */
export function bindAnalyticsRef(ref: string, correlationId: string, now = Date.now()) {
  prune(bindings, now);
  bindings.set(ref, { correlationId, expiresAt: now + WITHDRAWAL_TTL_MS });
  if (revokedRefs.has(ref)) revokedCorrelations.set(correlationId, now + WITHDRAWAL_TTL_MS);
}

export function isAnalyticsRefRevoked(ref: string | null | undefined, now = Date.now()): boolean {
  if (!ref) return false;
  const expiresAt = revokedRefs.get(ref);
  return expiresAt !== undefined && expiresAt > now;
}

export function isCorrelationRevoked(correlationId: string, now = Date.now()): boolean {
  const expiresAt = revokedCorrelations.get(correlationId);
  return expiresAt !== undefined && expiresAt > now;
}

/**
 * Marks the references withdrawn (synchronously, before any await) and returns the correlation ids already bound to them, which
 * the caller erases. With the re-check after each write (analytics-events.service), a write and a withdrawal cannot interleave
 * to leave a row behind: either the write sees the mark and undoes itself, or the write committed first and the erase removes it.
 */
export function markAnalyticsRefsWithdrawn(refs: string[], now = Date.now()): string[] {
  prune(revokedRefs, now);
  prune(revokedCorrelations, now);
  const correlationIds: string[] = [];
  for (const ref of refs) {
    revokedRefs.set(ref, now + WITHDRAWAL_TTL_MS);
    const binding = bindings.get(ref);
    if (binding && binding.expiresAt > now) {
      revokedCorrelations.set(binding.correlationId, now + WITHDRAWAL_TTL_MS);
      correlationIds.push(binding.correlationId);
    }
  }
  return correlationIds;
}

/** Test-support only (NODE_ENV=test e2e routes): the correlation id a live reference is bound to. */
export function boundCorrelationForTests(ref: string): string | null {
  return bindings.get(ref)?.correlationId ?? null;
}

export function resetAnalyticsWithdrawalsForTests() {
  revokedRefs.clear();
  revokedCorrelations.clear();
  bindings.clear();
}
