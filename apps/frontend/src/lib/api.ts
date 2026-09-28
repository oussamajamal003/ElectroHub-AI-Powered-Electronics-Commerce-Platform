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

async function refreshSession(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        if (!response.ok) { setAccessToken(null); notifySessionExpired(); return null; }
        const body = await readResponse<{ accessToken: string }>(response);
        const token = typeof body?.accessToken === 'string' ? body.accessToken : null;
        setAccessToken(token);
        return token;
      } catch { setAccessToken(null); notifySessionExpired(); return null; }
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function apiClient<T = unknown>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const url = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const { data, ...requestOptions } = options;
  const headers = new Headers(options.headers);
  if (data !== undefined && !(data instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const config: RequestInit = { ...requestOptions, headers, credentials: 'include' };
  if (data !== undefined) config.body = data instanceof FormData ? data : JSON.stringify(data);
  let response: Response;
  try {
    response = await fetch(url, config);
    if (response.status === 401 && !/\/api\/auth\/(refresh|login|logout)(?:\?|$)/.test(url)) {
      const token = await refreshSession();
      if (!token || options.signal?.aborted) throw new ApiError(401, safeMessage(401));
      headers.set('Authorization', `Bearer ${token}`);
      response = await fetch(url, config);
    }
  } catch (error) {
    if (error instanceof ApiError || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    throw new ApiError(0, 'Unable to connect. Please try again.');
  }
  return readResponse<T>(response);
}
