export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly data?: unknown,
    public readonly code?: string, public readonly requestId?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

interface FetchOptions extends RequestInit { data?: unknown }
let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) { accessToken = token; }

function notifySessionExpired() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('electrohub:session-expired'));
}

function safeMessage(status: number) {
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'The requested resource was not found.';
  if (status === 429) return 'Too many requests. Please try again later.';
  if (status >= 500) return 'Something went wrong. Please try again later.';
  return 'Request failed. Please try again.';
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 204 || response.status === 205) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const error = body.error;
    const structured = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const code = typeof structured.code === 'string' ? structured.code : undefined;
    const candidate = typeof structured.message === 'string' ? structured.message :
      typeof error === 'string' ? error : typeof body.message === 'string' ? body.message : undefined;
    const safe = response.status < 500 && candidate && !/(prisma|sql|stack|\\|\/users\/|database|certificate|secret)/i.test(candidate);
    throw new ApiError(response.status, safe ? candidate : safeMessage(response.status), response.status >= 500 ? undefined : payload, code,
      response.headers.get('x-request-id') ?? undefined);
  }
  if (payload === null) {
    if (response.headers.get('content-length') === '0') return undefined as T;
    throw new ApiError(response.status, 'The server returned an unexpected response. Please try again.');
  }
  return payload as T;
}

/**
 * A 409 from /api/auth/refresh means another request carrying the same cookie rotated the session a moment ago. The server deliberately issues no
 * token to the losing request (a superseded token never authenticates on its own), so the loser re-reads the cookie set by the winner and retries
 * a few times with a short backoff instead of treating the race as a sign-out.
 */
const ROTATION_RETRY_DELAYS_MS = [250, 600, 1200];
const ROTATION_RETRY_AFTER_CAP_MS = 5_000;
async function fetchRefresh(url: string, init: RequestInit): Promise<Response> {
  let response = await fetch(url, init);
  for (const delay of ROTATION_RETRY_DELAYS_MS) {
    if (response.status !== 409) break;
    // Honor the server's Retry-After (seconds) as a floor, capped, so the client never retries sooner than the contract says.
    const advised = Number(response.headers.get('Retry-After')) * 1000;
    const wait = Math.min(Math.max(delay, Number.isFinite(advised) ? advised : 0), ROTATION_RETRY_AFTER_CAP_MS);
    await new Promise(resolve => setTimeout(resolve, wait));
    response = await fetch(url, init);
  }
  return response;
}
const postRefresh = (init: RequestInit) => fetchRefresh('/api/auth/refresh', init);

async function refreshSession(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await postRefresh({ method: 'POST', credentials: 'include' });
        if (response.status === 401 || response.status === 403) {
          setAccessToken(null);
          notifySessionExpired();
          return null;
        }
        if (!response.ok) throw new ApiError(response.status, safeMessage(response.status));
        const body = await readResponse<{ accessToken: string }>(response);
        const token = typeof body?.accessToken === 'string' ? body.accessToken : null;
        setAccessToken(token);
        return token;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(0, 'Unable to connect. Please try again.');
      }
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object') {
    const err = error as { name?: string };
    if (err.name === 'AbortError') return true;
  }
  return typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError';
}

/** Shared transport: bearer attachment, one bounded refresh on 401 and abort/connection error mapping (JSON and binary callers). */
async function send(endpoint: string, options: FetchOptions, extra: RequestInit = {}): Promise<Response> {
  const url = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const { data, ...requestOptions } = options;
  const headers = new Headers(options.headers);
  if (data !== undefined && !(data instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const privateCollection = /^\/api\/(?:cart|wishlist|auth\/me)(?:\/|\?|$)/.test(url);
  const config: RequestInit = { ...requestOptions, headers, credentials: 'include',
    ...(privateCollection ? { cache: 'no-store' as const } : {}), ...extra };
  if (data !== undefined) config.body = data instanceof FormData ? data : JSON.stringify(data);
  let response: Response;
  try {
    response = url.split('?')[0] === '/api/auth/refresh' ? await fetchRefresh(url, config) : await fetch(url, config);
    if (response.status === 401 && !/\/api\/auth\/(me|refresh|login|logout)(?:\?|$)/.test(url)) {
      if (options.signal?.aborted) throw new DOMException('The user aborted a request.', 'AbortError');
      const token = await refreshSession();
      if (options.signal?.aborted) throw new DOMException('The user aborted a request.', 'AbortError');
      if (!token) throw new ApiError(401, safeMessage(401));
      headers.set('Authorization', `Bearer ${token}`);
      response = await fetch(url, config);
    }
  } catch (error) {
    if (error instanceof ApiError || isAbortError(error)) throw error;
    throw new ApiError(0, 'Unable to connect. Please try again.');
  }
  return response;
}

export async function apiClient<T = unknown>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  return readResponse<T>(await send(endpoint, options));
}

export interface BinaryDocument { blob: Blob; byteLength: number; filename: string; contentVersion: string | null }
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const invalidDocument = (status: number) =>
  new ApiError(status, 'The document could not be loaded. Please try again.', undefined, 'DOCUMENT_INVALID_RESPONSE');

/** Server-approved names only (brand + reference + kind); anything else falls back to the caller's canonical name. */
function documentFilename(header: string | null, fallback: string) {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header ?? '')?.[1];
  let candidate = /filename="([^"]+)"/i.exec(header ?? '')?.[1];
  if (encoded) { try { candidate = decodeURIComponent(encoded); } catch { /* keep the quoted fallback */ } }
  return candidate && /^[A-Za-z0-9._-]{1,120}\.pdf$/.test(candidate) ? candidate : fallback;
}

/**
 * Authenticated PDF read through the same bearer/refresh transport as JSON (no token in URLs, no second token store). JSON error
 * envelopes still become ApiError; a success must be application/pdf, non-empty, complete (Content-Length matches), start with
 * %PDF- and stay under the streamed byte cap. Never cached by the browser.
 */
export async function apiBinary(endpoint: string, options: FetchOptions & { fallbackFilename: string; maxBytes?: number }): Promise<BinaryDocument> {
  const { fallbackFilename, maxBytes = MAX_DOCUMENT_BYTES, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers);
  headers.set('Accept', 'application/pdf, application/json');
  const response = await send(endpoint, { ...requestOptions, headers }, { cache: 'no-store' });
  if (!response.ok) return readResponse<never>(response);
  if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/pdf')) throw invalidDocument(response.status);
  const declared = response.headers.get('content-length');
  const expected = declared === null ? null : Number(declared);
  if (expected !== null && (!Number.isSafeInteger(expected) || expected <= 0 || expected > maxBytes)) throw invalidDocument(response.status);
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) { await reader.cancel(); throw invalidDocument(response.status); }
        chunks.push(value);
      }
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer());
      received = bytes.byteLength;
      if (received > maxBytes) throw invalidDocument(response.status);
      chunks.push(bytes);
    }
  } catch (error) {
    if (error instanceof ApiError || isAbortError(error)) throw error;
    throw new ApiError(0, 'The download was interrupted. Please try again.');
  }
  if (received === 0 || (expected !== null && received !== expected)) throw invalidDocument(response.status);
  const head: number[] = [];
  for (const chunk of chunks) { for (const byte of chunk.subarray(0, 5 - head.length)) head.push(byte); if (head.length === 5) break; }
  if (String.fromCharCode(...head) !== '%PDF-') throw invalidDocument(response.status);
  return { blob: new Blob(chunks as BlobPart[], { type: 'application/pdf' }), byteLength: received,
    filename: documentFilename(response.headers.get('content-disposition'), fallbackFilename),
    contentVersion: response.headers.get('x-document-version') };
}
