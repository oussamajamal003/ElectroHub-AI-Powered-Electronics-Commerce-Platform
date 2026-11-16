import { analyticsAllowed, consentGeneration, onAnalyticsWithdrawn } from '@/features/privacy/consent';
import { ApiError, apiClient, isAbortError } from '@/lib/api';
import type { ProductSummary } from '@/features/products/types';

// Client-side checks exist for fast, friendly feedback only; the Express gateway and the AI service stay the authority.
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const IMAGE_ACCEPT = IMAGE_TYPES.join(',');
// One effective upload budget end to end: browser, Express (IMAGE_SEARCH_MAX_BYTES) and FastAPI (AI_MAX_IMAGE_BYTES).
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_LABEL = '8 MB';
export const IMAGE_SEARCH_TIMEOUT_MS = 30_000;

export type ImageFileProblem = 'type' | 'size' | 'empty';
export function validateImageFile(file: File): ImageFileProblem | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return 'type';
  if (file.size === 0) return 'empty';
  if (file.size > MAX_IMAGE_BYTES) return 'size';
  return null;
}

export const formatBytes = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Image search is reached only through the Express gateway (never the private FastAPI service). Task 04.2 owns the
 * public endpoint; until a deployment opts in with VITE_IMAGE_SEARCH_ENABLED=true the client reports "unavailable"
 * without sending the photo anywhere.
 */
export const IMAGE_SEARCH_ENDPOINT = '/api/search/image';
export const imageSearchEnabled = () => import.meta.env.VITE_IMAGE_SEARCH_ENABLED === 'true';

/** Products in relevance order (index 0 is the best match). No similarity score is exposed to the UI. */
export interface ImageSearchResponse { data: { items: ProductSummary[] }; analyticsToken?: string }

export type ImageSearchOutcome =
  | { status: 'success'; items: ProductSummary[]; analyticsToken?: string; consentGeneration?: number }
  | { status: 'unavailable' }
  | { status: 'invalid'; message: string }
  | { status: 'timeout' }
  | { status: 'network' }
  | { status: 'cancelled' }
  | { status: 'error' };

const isProductList = (value: unknown): value is ProductSummary[] => Array.isArray(value) &&
  value.every(item => item && typeof item === 'object' && typeof (item as ProductSummary).id === 'string' && typeof (item as ProductSummary).slug === 'string');

/** References of consented searches whose response has not arrived yet. */
const pendingRefs = new Set<string>();
/** Withdrawals that could not be delivered (offline); retried once when the browser reports it is online again. */
const undelivered = new Set<string>();
export const ANALYTICS_WITHDRAWAL_ENDPOINT = '/api/analytics/withdrawals';
const MAX_REFS_PER_WITHDRAWAL = 16;

function newRef(): string | null {
  try { return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : null; } catch { return null; }
}

function deliverWithdrawal(refs: string[], retry: boolean) {
  if (refs.length === 0 || typeof fetch !== 'function') return;
  const failed = () => {
    if (!retry) return;
    refs.forEach(ref => undelivered.add(ref));
    if (typeof window !== 'undefined') window.addEventListener('online', flushUndelivered, { once: true });
  };
  try {
    void fetch(ANALYTICS_WITHDRAWAL_ENDPOINT, { method: 'POST', keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refs: refs.slice(0, MAX_REFS_PER_WITHDRAWAL) }) }).then(response => { if (!response.ok && response.status >= 500) failed(); }, failed);
  } catch { failed(); }
}
function flushUndelivered() {
  const refs = [...undelivered];
  undelivered.clear();
  deliverWithdrawal(refs, false);
}

/**
 * Consent is decided when a search starts, but the server records its outcome only when inference finishes. Withdrawing while a
 * consented search is pending sends that search's reference to the server, which then skips (or, if already written, deletes) its
 * analytics. The search itself continues: shoppers still get their results, just without measurement.
 */
onAnalyticsWithdrawn(() => {
  const refs = [...pendingRefs];
  pendingRefs.clear();
  deliverWithdrawal(refs, true);
});

/** Test seam: references currently awaiting a response. */
export const pendingAnalyticsRefsForTests = () => [...pendingRefs];

export async function searchByImage(file: File, signal: AbortSignal): Promise<ImageSearchOutcome> {
  if (!imageSearchEnabled()) return { status: 'unavailable' };
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), IMAGE_SEARCH_TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const generation = consentGeneration();
  // Random per-search reference (never stored, never linked to a person) that lets a withdrawal reach this search on the server.
  const ref = analyticsAllowed() ? newRef() : null;
  if (ref) pendingRefs.add(ref);
  try {
    const body = new FormData();
    body.append('image', file, file.name || 'photo');
    const response = await apiClient<ImageSearchResponse>(IMAGE_SEARCH_ENDPOINT, { method: 'POST', data: body, signal: timeout.signal,
      headers: ref ? { 'X-ElectroHub-Analytics': 'consented', 'X-ElectroHub-Analytics-Ref': ref } : {} });
    const items = response?.data?.items;
    // A withdrawal while this search was pending voids its token: no selection can be reported for it, even after re-consent.
    const stillAllowed = ref !== null && pendingRefs.has(ref) && generation === consentGeneration() && analyticsAllowed();
    const analyticsToken = stillAllowed && typeof response?.analyticsToken === 'string' && response.analyticsToken.length <= 4096
      ? response.analyticsToken : undefined;
    return isProductList(items) ? { status: 'success', items, ...(analyticsToken ? { analyticsToken, consentGeneration: generation } : {}) } : { status: 'error' };
  } catch (failure) {
    if (signal.aborted) return { status: 'cancelled' };
    if (timeout.signal.aborted || isAbortError(failure)) return { status: 'timeout' };
    if (failure instanceof ApiError) {
      if ([404, 501, 503].includes(failure.status)) return { status: 'unavailable' };
      if (failure.status === 408 || failure.status === 504) return { status: 'timeout' };
      if (failure.status === 413) return { status: 'invalid', message: `This photo is too large. Choose one under ${MAX_IMAGE_LABEL}.` };
      if (failure.status === 400 || failure.status === 415 || failure.status === 422) return { status: 'invalid', message: 'This photo couldn’t be read. Try a different JPEG, PNG or WebP image.' };
      return { status: 'error' };
    }
    return typeof navigator !== 'undefined' && navigator.onLine === false ? { status: 'network' } : { status: 'error' };
  } finally {
    if (ref) pendingRefs.delete(ref);
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Task 05.2: report that a shopper opened one of the visual results. The server only accepts it with the signed token it issued for
 * this exact result list, deduplicates it, and stores no image or identity. Fire-and-forget: `keepalive` lets it outlive the navigation
 * it accompanies, and any failure is ignored so analytics can never block or break the click.
 */
export function reportImageResultSelected(analyticsToken: string | undefined, productId: string, generation?: number): void {
  if (!analyticsAllowed() || !analyticsToken || typeof fetch !== 'function') return;
  if (generation !== undefined && generation !== consentGeneration()) return;
  try {
    void fetch('/api/analytics/events', { method: 'POST', keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'image_search.result_selected', token: analyticsToken, productId }) }).catch(() => undefined);
  } catch { /* analytics must never affect navigation */ }
}
