import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportImageResultSelected } from './imageSearch';

describe('Task 05.2 image-search result selection analytics', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts only the signed token and product id, with keepalive and no credentials', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    reportImageResultSelected('signed.token', '7d6f1b52-0c1e-4f7f-9d63-2f1d8c0b9a11');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/analytics/events');
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit' });
    expect(JSON.parse(String(init.body))).toEqual({ type: 'image_search.result_selected', token: 'signed.token', productId: '7d6f1b52-0c1e-4f7f-9d63-2f1d8c0b9a11' });
  });

  it('sends nothing without a server-issued token and never throws when the request fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);
    reportImageResultSelected(undefined, 'product');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(() => reportImageResultSelected('signed.token', 'product')).not.toThrow();
    await Promise.resolve();
  });
});
