import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, apiClient, retryAfterMs } from './api';
import { createQueryClient, queryRetryDelay, shouldRetry } from './query';

afterEach(() => vi.unstubAllGlobals());
it('parses server wait floors without shortening them or accepting malformed/negative values', () => {
  expect(retryAfterMs('4')).toBe(4000);
  const now = Date.parse('2026-11-13T12:00:00Z');
  expect(retryAfterMs('Fri, 13 Nov 2026 12:00:03 GMT', now)).toBe(3000);
  for (const value of [null, '', '-1', '1.5', 'invalid']) expect(retryAfterMs(value)).toBeUndefined();
});
it('carries Retry-After on a real transport error and uses jitter above its wait floor', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'UNAVAILABLE' } }), {
    status: 503, headers: { 'content-type': 'application/json', 'Retry-After': '2' },
  })));
  let caught: unknown;
  try { await apiClient('/api/store/profile'); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(ApiError);
  expect(queryRetryDelay(0, caught, () => 0.5)).toBe(2000);
  expect(queryRetryDelay(0, new ApiError(0, 'Offline'), () => 0)).toBe(300);
  expect(queryRetryDelay(0, new ApiError(0, 'Offline'), () => 1)).toBe(375);
});
it('does not retry permanent errors, aborted reads, long server waits or any mutation by default', () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429]) expect(shouldRetry(0, new ApiError(status, 'Failed'))).toBe(false);
  expect(shouldRetry(0, new DOMException('Aborted', 'AbortError'))).toBe(false);
  expect(shouldRetry(0, new ApiError(503, 'Wait', undefined, undefined, undefined, 120000))).toBe(false);
  expect(shouldRetry(1, new ApiError(503, 'Unavailable'))).toBe(false);
  const client = createQueryClient(); expect(client.getDefaultOptions().mutations?.retry).toBe(false); client.clear();
});
