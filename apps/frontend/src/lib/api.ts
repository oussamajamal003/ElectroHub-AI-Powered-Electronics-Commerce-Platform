export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly data?: unknown,
    public readonly code?: string, public readonly requestId?: string, public readonly retryAfterMs?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Retry-After is a minimum wait, never shortened to fit a client's backoff cap. */
export function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  const delay = /^\d+$/.test(trimmed) ? Number(trimmed) * 1000 :
    /^[A-Za-z]{3}, /.test(trimmed) ? Date.parse(trimmed) - now : NaN;
  return Number.isFinite(delay) && delay >= 0 ? delay : undefined;
}

/**
 * Task 05.2 session isolation: the Admin Console and the storefront are two independent credential scopes in one browser. Each owns its
 * own in-memory access token, single-flight refresh, cross-document refresh lock and expiry event, and refreshes only through its own
 * role-specific endpoint and HttpOnly cookie. Nothing here guesses a scope from "whoever signed in last".
 */
export type AuthScope = 'admin' | 'customer';
interface FetchOptions extends RequestInit { data?: unknown; /** Overrides the scope derived from the endpoint (rarely needed). */ scope?: AuthScope }
const sessions: Record<AuthScope, { token: string | null; refresh: Promise<string | null> | null }> = {
  admin: { token: null, refresh: null }, customer: { token: null, refresh: null } };

/** Administrator APIs (and the pre-auth administrator MFA endpoints) are ADMIN scope; every other endpoint is CUSTOMER scope. */
export function scopeForEndpoint(endpoint: string): AuthScope {
  return /^\/?api\/(?:admin|auth\/admin)(?:\/|\?|$)/.test(endpoint) ? 'admin' : 'customer';
}

export function setAccessToken(token: string | null, scope: AuthScope = 'customer') { sessions[scope].token = token; }
/** Task 04.7: the live delivery socket authenticates with the same in-memory token (never stored, never in a URL). */
export function getAccessToken(scope: AuthScope = 'customer') { return sessions[scope].token; }

export const SESSION_EXPIRED_EVENT = 'electrohub:session-expired';
function notifySessionExpired(scope: AuthScope) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { scope } }));
}

function safeMessage(status: number) {
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'The requested resource was not found.';
  if (status === 429) return 'Too many requests. Please try again later.';
  if (status >= 500) return 'Something went wrong. Please try again later.';
  return 'Request failed. Please try again.';
}

/** Task 05.2: an administrator session that was revoked, expired or lost its MFA assurance ends the session like any other 401. */
const ADMIN_SESSION_INVALID = 'ADMIN_SESSION_INVALID';
function errorCodeOf(payload: unknown): string | undefined {
  const error = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).error : undefined;
  const structured = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return typeof structured.code === 'string' ? structured.code : undefined;
}

// Inspect a 401 without teeing its stream. The final error reader reuses the same parsed body.
const jsonPayloads = new WeakMap<Response, Promise<unknown>>();
function jsonPayload(response: Response): Promise<unknown> {
  let payload = jsonPayloads.get(response);
  if (!payload) {
    payload = (response.headers.get('content-type') ?? '').includes('application/json')
      ? response.json().catch(() => null) : Promise.resolve(null);
    jsonPayloads.set(response, payload);
  }
  return payload;
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 204 || response.status === 205) return undefined as T;
  const payload = await jsonPayload(response);
  if (!response.ok) {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const error = body.error;
    const structured = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const code = typeof structured.code === 'string' ? structured.code : undefined;
    if (response.status === 401 && code === ADMIN_SESSION_INVALID) {
      setAccessToken(null, 'admin');
      notifySessionExpired('admin');
    }
    const candidate = typeof structured.message === 'string' ? structured.message :
      typeof error === 'string' ? error : typeof body.message === 'string' ? body.message : undefined;
    const safe = response.status < 500 && candidate && !/(prisma|sql|stack|\\|\/users\/|database|certificate|secret)/i.test(candidate);
    throw new ApiError(response.status, safe ? candidate : safeMessage(response.status), response.status >= 500 ? undefined : payload, code,
      response.headers.get('x-request-id') ?? undefined, retryAfterMs(response.headers.get('Retry-After')));
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
async function fetchRefreshUnlocked(url: string, baseInit: RequestInit): Promise<Response> {
  // keepalive: a navigation must not cancel an in-flight refresh. The server rotates the token whether or not this document survives, and a
  // cancelled request loses the Set-Cookie carrying the successor, stranding the next document on a superseded cookie (409s, then a reuse 401).
  const init: RequestInit = { ...baseInit, keepalive: true };
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

/**
 * The in-memory single-flight above cannot span documents: a full reload or a second tab starts its own refresh with the cookie it can see, and
 * two documents presenting one cookie is exactly what the server answers with 409 (or, past its window, treats as replay). The Web Locks API is
 * origin-wide, so refreshes from every document of this origin run one at a time and each reads the cookie its predecessor committed. A document
 * that is unloading releases its lock automatically. The wait is bounded so a wedged holder can never block sign-in; without the API (or on
 * timeout) behavior is unchanged. This does not recover a rotated cookie whose response was lost: that stays a clean re-authentication.
 */
const refreshLockName = (scope: AuthScope) => `electrohub:auth-refresh:${scope}`;
const REFRESH_LOCK_WAIT_MS = 8_000;
async function fetchRefresh(scope: AuthScope, url: string, init: RequestInit): Promise<Response> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== 'function') return fetchRefreshUnlocked(url, init);
  const waitAbort = new AbortController();
  const timer = setTimeout(() => waitAbort.abort(), REFRESH_LOCK_WAIT_MS);
  try {
    return await locks.request(refreshLockName(scope), { signal: waitAbort.signal }, async () => {
      clearTimeout(timer);
      return fetchRefreshUnlocked(url, init);
    });
  } catch (error) {
    if (isAbortError(error) && waitAbort.signal.aborted) return fetchRefreshUnlocked(url, init);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
export const refreshPath = (scope: AuthScope) => `/api/auth/${scope}/refresh`;

async function refreshSession(scope: AuthScope): Promise<string | null> {
  const session = sessions[scope];
  if (!session.refresh) {
    session.refresh = (async () => {
      try {
        const response = await fetchRefresh(scope, refreshPath(scope), { method: 'POST', credentials: 'include' });
        if (response.status === 401 || response.status === 403) {
          setAccessToken(null, scope);
          notifySessionExpired(scope);
          return null;
        }
        if (!response.ok) throw new ApiError(response.status, safeMessage(response.status));
        const body = await readResponse<{ accessToken: string }>(response);
        const token = typeof body?.accessToken === 'string' ? body.accessToken : null;
        setAccessToken(token, scope);
        return token;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(0, 'Unable to connect. Please try again.');
      }
    })().finally(() => { session.refresh = null; });
  }
  return session.refresh;
}

/** Task 04.7: the socket's session:expired / UNAUTHENTICATED path reuses the single-flight refresh (null when the session is over). */
export function refreshAccessToken(scope: AuthScope = 'customer'): Promise<string | null> { return refreshSession(scope); }

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
  const { data, scope: explicitScope, ...requestOptions } = options;
  const scope = explicitScope ?? scopeForEndpoint(url);
  const headers = new Headers(options.headers);
  if (data !== undefined && !(data instanceof FormData)) headers.set('Content-Type', 'application/json');
  const requestToken = sessions[scope].token;
  if (requestToken) headers.set('Authorization', `Bearer ${requestToken}`);
  const privateCollection = /^\/api\/(?:cart|wishlist|auth\/me)(?:\/|\?|$)/.test(url);
  const config: RequestInit = { ...requestOptions, headers, credentials: 'include',
    ...(privateCollection ? { cache: 'no-store' as const } : {}), ...extra };
  if (data !== undefined) config.body = data instanceof FormData ? data : JSON.stringify(data);
  let response: Response;
  try {
    const path = url.split('?')[0];
    response = path === refreshPath('admin') || path === refreshPath('customer')
      ? await fetchRefresh(path === refreshPath('admin') ? 'admin' : 'customer', url, config) : await fetch(url, config);
    // Pre-auth administrator endpoints answer 401 for wrong or expired challenges: those are never a reason to refresh the session.
    if (response.status === 401 && !/\/api\/auth\/(me|login|logout)(?:\?|$)|\/api\/auth\/(admin|customer)\/(refresh|logout)|\/api\/auth\/admin\//.test(url)
      && errorCodeOf(await jsonPayload(response)) !== ADMIN_SESSION_INVALID) {
      if (options.signal?.aborted) throw new DOMException('The user aborted a request.', 'AbortError');
      // A slow 401 may arrive after another request has already completed the shared rotation.
      const current = sessions[scope].token;
      const token = current && current !== requestToken ? current : await refreshSession(scope);
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
