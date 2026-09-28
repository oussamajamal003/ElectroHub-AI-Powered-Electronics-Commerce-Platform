import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient, ApiError, setAccessToken } from './api';
import { cachePolicy, createQueryClient, queryKeys, shouldRetry } from './query';
import { emptySearch } from '@/features/search/searchState';

afterEach(() => { vi.unstubAllGlobals(); setAccessToken(null); });

function json(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('central API client', () => {
  it('preserves structured 4xx errors and request ID', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(429,
      { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }, { 'x-request-id': 'req-1' })));
    await expect(apiClient('/api/auth/login')).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED',
      message: 'Too many requests.', requestId: 'req-1' });
  });
  it('sanitizes unexpected and non-JSON failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(500, { error: 'Prisma secret path' }))
      .mockResolvedValueOnce(new Response('<html>proxy error</html>', { status: 502, headers: { 'content-type': 'text/html' } })));
    await expect(apiClient('/api/auth/login')).rejects.toMatchObject({ message: 'Something went wrong. Please try again later.' });
    await expect(apiClient('/api/auth/login')).rejects.toMatchObject({ message: 'Something went wrong. Please try again later.' });
  });
  it('returns undefined for an empty success and forwards cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await expect(apiClient('/api/products', { signal: controller.signal })).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
  it('shares one silent refresh across concurrent 401 requests and retries once', async () => {
    let refreshCalls = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
      if (url === '/api/auth/refresh') { refreshCalls++; return json(200, { accessToken: 'replacement' }); }
      const headers = options.headers as Headers;
      return headers.get('Authorization') === 'Bearer replacement' ? json(200, { data: url }) : json(401, { error: 'Expired' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const responses = await Promise.all([apiClient('/api/products'), apiClient('/api/categories')]);
    expect(responses).toHaveLength(2);
    expect(refreshCalls).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
  it('shares a failed refresh, clears the token, and notifies AuthContext once', async () => {
    setAccessToken('old-sensitive-token');
    let releaseRefresh: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn().mockImplementation((url: string, options: RequestInit) => {
      if (url === '/api/auth/refresh') return new Promise<Response>(resolve => { releaseRefresh = resolve; });
      if (url === '/api/public') return Promise.resolve(json(200, { ok: true }));
      expect((options.headers as Headers).get('Authorization')).toBe('Bearer old-sensitive-token');
      return Promise.resolve(json(401, { error: 'Expired' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const onExpired = vi.fn();
    window.addEventListener('electrohub:session-expired', onExpired);
    const first = apiClient('/api/products');
    const second = apiClient('/api/categories');
    await vi.waitFor(() => expect(releaseRefresh).toBeDefined());
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/refresh')).toHaveLength(1);
    releaseRefresh?.(json(401, { error: 'No session' }));
    await expect(Promise.all([first, second])).rejects.toMatchObject({ status: 401 });
    expect(onExpired).toHaveBeenCalledTimes(1);
    await apiClient('/api/public');
    expect((fetchMock.mock.calls.at(-1)?.[1]?.headers as Headers).has('Authorization')).toBe(false);
    window.removeEventListener('electrohub:session-expired', onExpired);
  });
  it('does not retry refresh when the one replay also returns 401', async () => {
    setAccessToken('old-token');
    let protectedCalls = 0; let refreshCalls = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/auth/refresh') { refreshCalls++; return json(200, { accessToken: 'new-token' }); }
      protectedCalls++; return json(401, { error: 'Still unauthorized' });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiClient('/api/protected')).rejects.toMatchObject({ status: 401 });
    expect(protectedCalls).toBe(2);
    expect(refreshCalls).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});


describe('query foundation', () => {
  it('uses committed search state and feature-scoped keys', () => {
    expect(queryKeys.search.products({ ...emptySearch, q: 'macbook', page: 2 })).toEqual(['search', 'products', 'q=macbook&page=2']);
    expect(queryKeys.categories.all).not.toEqual(queryKeys.brands.all);
  });
  it('retries transient failures once, never 4xx or aborts', () => {
    expect(shouldRetry(0, new ApiError(503, 'Unavailable'))).toBe(true);
    expect(shouldRetry(1, new ApiError(503, 'Unavailable'))).toBe(false);
    expect(shouldRetry(0, new ApiError(429, 'Slow down'))).toBe(false);
    expect(shouldRetry(0, new DOMException('Aborted', 'AbortError'))).toBe(false);
  });
  it('reuses a fresh query and keeps public cache bounded', async () => {
    const client = createQueryClient();
    const queryFn = vi.fn().mockResolvedValue({ data: ['product'] });
    const queryKey = queryKeys.products.list('page=1');
    await client.fetchQuery({ queryKey, queryFn, ...cachePolicy.products });
    await client.fetchQuery({ queryKey, queryFn, ...cachePolicy.products });
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(cachePolicy.suggestions.gcTime).toBeLessThan(cachePolicy.products.gcTime);
    client.clear();
    expect(client.getQueryData(queryKey)).toBeUndefined();
  });
});
