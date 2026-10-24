import { ApiError, apiClient, isAbortError } from '@/lib/api';
import type { ProductSummary } from '@/features/products/types';

// Client-side checks exist for fast, friendly feedback only; the Express gateway and the AI service stay the authority.
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const IMAGE_ACCEPT = IMAGE_TYPES.join(',');
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
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
export interface ImageSearchResponse { data: { items: ProductSummary[] } }

export type ImageSearchOutcome =
  | { status: 'success'; items: ProductSummary[] }
  | { status: 'unavailable' }
  | { status: 'invalid'; message: string }
  | { status: 'timeout' }
  | { status: 'network' }
  | { status: 'cancelled' }
  | { status: 'error' };

const isProductList = (value: unknown): value is ProductSummary[] => Array.isArray(value) &&
  value.every(item => item && typeof item === 'object' && typeof (item as ProductSummary).id === 'string' && typeof (item as ProductSummary).slug === 'string');

export async function searchByImage(file: File, signal: AbortSignal): Promise<ImageSearchOutcome> {
  if (!imageSearchEnabled()) return { status: 'unavailable' };
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), IMAGE_SEARCH_TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const body = new FormData();
    body.append('image', file, file.name || 'photo');
    const response = await apiClient<ImageSearchResponse>(IMAGE_SEARCH_ENDPOINT, { method: 'POST', data: body, signal: timeout.signal });
    const items = response?.data?.items;
    return isProductList(items) ? { status: 'success', items } : { status: 'error' };
  } catch (failure) {
    if (signal.aborted) return { status: 'cancelled' };
    if (timeout.signal.aborted || isAbortError(failure)) return { status: 'timeout' };
    if (failure instanceof ApiError) {
      if ([404, 501, 503].includes(failure.status)) return { status: 'unavailable' };
      if (failure.status === 413) return { status: 'invalid', message: 'This photo is too large. Choose one under 10 MB.' };
      if (failure.status === 400 || failure.status === 415 || failure.status === 422) return { status: 'invalid', message: 'This photo couldn’t be read. Try a different JPEG, PNG or WebP image.' };
      return { status: 'error' };
    }
    return typeof navigator !== 'undefined' && navigator.onLine === false ? { status: 'network' } : { status: 'error' };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
