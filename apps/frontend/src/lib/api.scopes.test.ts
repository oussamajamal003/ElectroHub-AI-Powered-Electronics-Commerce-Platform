import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, getAccessToken, refreshAccessToken, scopeForEndpoint, setAccessToken } from './api';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const authorization = (call: unknown[]) => (call[1] as RequestInit).headers instanceof Headers ? ((call[1] as RequestInit).headers as Headers).get('Authorization') : null;

describe('Task 05.2 credential scopes: ADMIN and CUSTOMER never share a bearer token, refresh or expiry', () => {
  beforeEach(() => { setAccessToken(null, 'admin'); setAccessToken(null, 'customer'); vi.stubGlobal('navigator', {}); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('derives the scope from the endpoint, never from who signed in last', () => {
    for (const admin of ['/api/admin/me/profile', '/api/admin/customers?x=1', '/api/auth/admin/mfa/totp/verify', 'api/admin/dashboard/overview']) expect(scopeForEndpoint(admin)).toBe('admin');
    for (const customer of ['/api/cart', '/api/orders', '/api/auth/me', '/api/auth/login', '/api/checkout/sessions', '/api/products', '/api/administrators-fake', '/api/auth/administrator']) expect(scopeForEndpoint(customer)).toBe('customer');
  });

  it('keeps one in-memory token per scope', () => {
    setAccessToken('admin-token', 'admin');
    setAccessToken('customer-token');
    expect(getAccessToken('admin')).toBe('admin-token');
    expect(getAccessToken()).toBe('customer-token');
    setAccessToken(null, 'admin');
    expect(getAccessToken('admin')).toBeNull();
    expect(getAccessToken('customer')).toBe('customer-token');
  });

  it('attaches the administrator token only to administrator APIs and the customer token only to storefront APIs', async () => {
    setAccessToken('admin-token', 'admin');
    setAccessToken('customer-token', 'customer');
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json(200, { ok: true })));
    vi.stubGlobal('fetch', fetchMock);
    await apiClient('/api/admin/dashboard/overview');
    await apiClient('/api/cart');
    await apiClient('/api/orders');
    await apiClient('/api/admin/orders');
    expect(fetchMock.mock.calls.map(call => [call[0], authorization(call)])).toEqual([
      ['/api/admin/dashboard/overview', 'Bearer admin-token'], ['/api/cart', 'Bearer customer-token'],
      ['/api/orders', 'Bearer customer-token'], ['/api/admin/orders', 'Bearer admin-token'],
    ]);
  });

  it('never falls back to the other scope: an administrator alone sends no credentials to the storefront, and vice versa', async () => {
    setAccessToken('admin-token', 'admin');
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json(200, {})));
    vi.stubGlobal('fetch', fetchMock);
    await apiClient('/api/cart');
    await apiClient('/api/products');
    expect(fetchMock.mock.calls.map(authorization)).toEqual([null, null]);
    setAccessToken(null, 'admin');
    setAccessToken('customer-token', 'customer');
    await apiClient('/api/admin/me/profile');
    expect(authorization(fetchMock.mock.calls[2]!)).toBeNull();
  });

  it('an administrator 401 refreshes only through the administrator endpoint and retries with the administrator token', async () => {
    setAccessToken('stale-admin', 'admin');
    setAccessToken('customer-token', 'customer');
    const calls: Array<[string, string | null]> = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init: RequestInit) => {
      calls.push([url, init.headers instanceof Headers ? init.headers.get('Authorization') : null]);
      if (url === '/api/auth/admin/refresh') return Promise.resolve(json(200, { accessToken: 'fresh-admin' }));
      return Promise.resolve((init.headers as Headers).get('Authorization') === 'Bearer fresh-admin' ? json(200, { ok: true }) : json(401, {}));
    }));
    await expect(apiClient('/api/admin/me/profile')).resolves.toEqual({ ok: true });
    expect(calls.map(call => call[0])).toEqual(['/api/admin/me/profile', '/api/auth/admin/refresh', '/api/admin/me/profile']);
    expect(getAccessToken('admin')).toBe('fresh-admin');
    expect(getAccessToken('customer')).toBe('customer-token');
  });

  it('a customer 401 refreshes only through the customer endpoint', async () => {
    setAccessToken('stale-customer', 'customer');
    setAccessToken('admin-token', 'admin');
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init: RequestInit) => {
      urls.push(url);
      if (url === '/api/auth/customer/refresh') return Promise.resolve(json(200, { accessToken: 'fresh-customer' }));
      return Promise.resolve((init.headers as Headers).get('Authorization') === 'Bearer fresh-customer' ? json(200, { ok: true }) : json(401, {}));
    }));
    await expect(apiClient('/api/orders')).resolves.toEqual({ ok: true });
    expect(urls).toEqual(['/api/orders', '/api/auth/customer/refresh', '/api/orders']);
    expect(getAccessToken('admin')).toBe('admin-token');
  });

  it('runs one single-flight refresh per scope, so two scopes refresh independently and each shares its own', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      urls.push(url);
      return Promise.resolve(json(200, { accessToken: url.includes('/admin/') ? 'admin-new' : 'customer-new' }));
    }));
    const results = await Promise.all([refreshAccessToken('admin'), refreshAccessToken('admin'), refreshAccessToken('customer'), refreshAccessToken('customer')]);
    expect(results).toEqual(['admin-new', 'admin-new', 'customer-new', 'customer-new']);
    expect(urls.sort()).toEqual(['/api/auth/admin/refresh', '/api/auth/customer/refresh']);
  });

  it('takes an independent origin-wide lock per scope, so one scope never waits on the other', async () => {
    const held: string[] = [];
    vi.stubGlobal('navigator', { locks: { request: async (name: string, _options: unknown, callback: () => Promise<unknown>) => { held.push(name); return callback(); } } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { accessToken: 't' })));
    await refreshAccessToken('admin');
    await refreshAccessToken('customer');
    expect(held).toEqual(['electrohub:auth-refresh:admin', 'electrohub:auth-refresh:customer']);
  });

  it('announces expiry for the failing scope only, and leaves the other scope signed in', async () => {
    setAccessToken('admin-token', 'admin');
    setAccessToken('customer-token', 'customer');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { error: 'expired' })));
    const seen: string[] = [];
    const listener = (event: Event) => seen.push((event as CustomEvent<{ scope: string }>).detail.scope);
    window.addEventListener('electrohub:session-expired', listener);
    try {
      expect(await refreshAccessToken('admin')).toBeNull();
      expect(seen).toEqual(['admin']);
      expect(getAccessToken('admin')).toBeNull();
      expect(getAccessToken('customer')).toBe('customer-token');
    } finally { window.removeEventListener('electrohub:session-expired', listener); }
  });

  it('an explicit scope overrides the endpoint-derived scope', async () => {
    setAccessToken('admin-token', 'admin');
    setAccessToken('customer-token', 'customer');
    const fetchMock = vi.fn().mockResolvedValue(json(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    await apiClient('/api/auth/me', { scope: 'admin' });
    await apiClient('/api/auth/me');
    expect(fetchMock.mock.calls.map(authorization)).toEqual(['Bearer admin-token', 'Bearer customer-token']);
  });
});
