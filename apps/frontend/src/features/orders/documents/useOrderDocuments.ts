import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/context/AuthContext';
import { ApiError, apiBinary, apiClient, isAbortError } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import type { DocumentKind, OrderDocumentEntry, OrderDocumentsDto } from './types';

const KINDS: DocumentKind[] = ['invoice', 'receipt', 'summary'];
const DOWNLOAD_URL_LIFETIME_MS = 30_000;
const RATE_LIMIT_COOLDOWN_MS = 10_000;

/** Accepts only the three known kinds in fixed order; anything unexpected is treated as an unreadable response. */
function parseDocuments(payload: { data?: OrderDocumentsDto } | undefined): OrderDocumentsDto {
  const data = payload?.data;
  if (!data || !Array.isArray(data.documents)) throw new ApiError(0, 'Documents could not be loaded. Please try again.');
  const byKind = new Map(data.documents.filter(entry => KINDS.includes(entry.kind)).map(entry => [entry.kind, entry]));
  return { orderReference: data.orderReference, documents: KINDS.flatMap(kind => byKind.get(kind) ?? []) };
}

/** Metadata only (no PDF bytes in the query cache). Owner-scoped key; never runs before the session is verified or while logging out. */
export function useOrderDocumentsQuery(orderReference: string, enabled = true) {
  const { user, isSessionVerified, isLoggingOut } = useAuth();
  return useQuery({
    queryKey: queryKeys.orders.documents(user?.id ?? '', orderReference),
    queryFn: ({ signal }) => apiClient<{ data: OrderDocumentsDto }>(`/api/orders/${encodeURIComponent(orderReference)}/documents`, { signal }).then(parseDocuments),
    enabled: Boolean(enabled && user && isSessionVerified && !isLoggingOut && orderReference),
    staleTime: 30_000, gcTime: 5 * 60_000,
  });
}

export function documentErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'The document could not be prepared. Please try again.';
  if (error.code === 'DOCUMENT_INVALID_RESPONSE') return 'The document could not be loaded. Please try again.';
  switch (error.status) {
    case 0: return 'Unable to connect. Check your connection and try again.';
    case 401: return 'Your session has expired. Please sign in again.';
    case 404: return 'This order could not be found for your account.';
    case 409: return 'This document is no longer available for this order. The list has been updated.';
    case 422: return 'This document can’t be generated from the recorded order details. Your order details on this page are unaffected.';
    case 429: return 'Too many document requests. Please wait a moment and try again.';
    case 503: return error.code === 'DOCUMENT_GENERATION_TIMEOUT' ? 'The document took too long to prepare. Please try again.'
      : 'Documents are temporarily unavailable. Please try again shortly.';
    default: return 'The document could not be prepared. Please try again.';
  }
}

export type DocumentAction = 'view' | 'download';
export interface PreviewState {
  entry: OrderDocumentEntry;
  status: 'loading' | 'ready' | 'unsupported' | 'error';
  url: string | null;
  blob: Blob | null;
  filename: string;
  message: string | null;
}

const fallbackName = (orderReference: string, kind: DocumentKind) => `ElectroHub-${orderReference}-${kind}.pdf`;
const nativePdfViewer = () => typeof navigator === 'undefined' || (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled !== false;

function triggerDownload(blob: Blob, filename: string, urls: Set<string>) {
  const url = URL.createObjectURL(blob);
  urls.add(url);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking in the same tick can cancel the download; a bounded delay lets the browser consume the URL first.
  window.setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, DOWNLOAD_URL_LIFETIME_MS);
}

/**
 * Per-panel preview/download lifecycle. One generation at a time; every request captures the owner and an epoch, and a late
 * response for a previous account, order or closed preview is discarded before any object URL or download is created.
 * Logout, account switch and order change abort in-flight work, close the preview and revoke private URLs.
 */
export function useDocumentActions(orderReference: string) {
  const { user, isLoggingOut } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? '';
  const [busy, setBusy] = useState<{ kind: DocumentKind; action: DocumentAction } | null>(null);
  const [errors, setErrors] = useState<Partial<Record<DocumentKind, string>>>({});
  const [announcement, setAnnouncement] = useState('');
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [coolingDown, setCoolingDown] = useState(false);
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const previewUrl = useRef<string | null>(null);
  const downloadUrls = useRef(new Set<string>());
  const owner = useRef(userId);
  owner.current = userId;
  // Synchronous guard: two clicks in the same frame see the same `busy` state, so the ref is the real duplicate-request lock.
  const inFlight = useRef(false);
  const cooldownTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(cooldownTimer.current), []);

  const revokePreview = useCallback(() => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
  }, []);

  const reset = useCallback(() => {
    epoch.current++;
    inFlight.current = false;
    controller.current?.abort();
    controller.current = null;
    revokePreview();
    setPreview(null);
    setBusy(null);
  }, [revokePreview]);

  // Owner/order change and unmount: abort and drop the preview. Download URLs keep their short bounded lifetime so a download
  // the browser already started is not cut off by navigation; logout revokes them immediately (below).
  useEffect(() => reset, [userId, orderReference, reset]);
  useEffect(() => {
    if (!isLoggingOut) return;
    reset();
    for (const url of downloadUrls.current) URL.revokeObjectURL(url);
    downloadUrls.current.clear();
  }, [isLoggingOut, reset]);

  const fail = useCallback((kind: DocumentKind, error: unknown, inPreview: boolean) => {
    const message = documentErrorMessage(error);
    if (error instanceof ApiError && error.status === 409) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders.documents(owner.current, orderReference) });
    }
    if (error instanceof ApiError && error.status === 429) {
      setCoolingDown(true);
      window.clearTimeout(cooldownTimer.current);
      cooldownTimer.current = window.setTimeout(() => setCoolingDown(false), RATE_LIMIT_COOLDOWN_MS);
    }
    if (inPreview) setPreview(current => current && current.entry.kind === kind ? { ...current, status: 'error', message } : current);
    else setErrors(current => ({ ...current, [kind]: message }));
  }, [orderReference, queryClient]);

  const run = useCallback(async (entry: OrderDocumentEntry, action: DocumentAction) => {
    const path = action === 'view' ? entry.previewPath : entry.downloadPath;
    if (!path || inFlight.current || coolingDown || !owner.current) return;
    inFlight.current = true;
    controller.current?.abort();
    const ticket = ++epoch.current;
    const startedFor = owner.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy({ kind: entry.kind, action });
    setErrors(current => ({ ...current, [entry.kind]: undefined }));
    setAnnouncement('');
    const filename = entry.filename ?? fallbackName(orderReference, entry.kind);
    if (action === 'view') {
      revokePreview();
      setPreview({ entry, status: 'loading', url: null, blob: null, filename, message: null });
    }
    try {
      const document = await apiBinary(path, { signal: abort.signal, fallbackFilename: filename });
      // Re-checked after the await: stale owner/order/closed preview responses are dropped without creating a URL.
      if (ticket !== epoch.current || abort.signal.aborted || owner.current !== startedFor) return;
      if (action === 'download') {
        triggerDownload(document.blob, document.filename, downloadUrls.current);
        setAnnouncement(`${entry.label} PDF download started.`);
      } else if (!nativePdfViewer()) {
        setPreview({ entry, status: 'unsupported', url: null, blob: document.blob, filename: document.filename, message: null });
      } else {
        const url = URL.createObjectURL(document.blob);
        previewUrl.current = url;
        setPreview({ entry, status: 'ready', url, blob: document.blob, filename: document.filename, message: null });
      }
    } catch (error) {
      if (isAbortError(error) || ticket !== epoch.current || owner.current !== startedFor) return;
      fail(entry.kind, error, action === 'view');
    } finally {
      if (ticket === epoch.current) { setBusy(null); controller.current = null; inFlight.current = false; }
    }
  }, [coolingDown, fail, orderReference, revokePreview]);

  const closePreview = useCallback(() => {
    if (busy?.action === 'view') { epoch.current++; controller.current?.abort(); controller.current = null; setBusy(null); inFlight.current = false; }
    revokePreview();
    setPreview(null);
  }, [busy, revokePreview]);

  /** Download from the preview reuses the already fetched bytes (identical to the attachment response) — no second render. */
  const downloadPreviewed = useCallback(() => {
    if (!preview?.blob) { if (preview) void run(preview.entry, 'download'); return; }
    triggerDownload(preview.blob, preview.filename, downloadUrls.current);
    setAnnouncement(`${preview.entry.label} PDF download started.`);
  }, [preview, run]);

  return { busy, errors, announcement, preview, coolingDown, view: (entry: OrderDocumentEntry) => run(entry, 'view'),
    download: (entry: OrderDocumentEntry) => run(entry, 'download'), closePreview, downloadPreviewed,
    retryPreview: () => { if (preview) void run(preview.entry, 'view'); } };
}
