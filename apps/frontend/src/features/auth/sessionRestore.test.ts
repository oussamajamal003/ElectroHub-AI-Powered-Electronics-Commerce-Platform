import { beforeEach, expect, it, vi } from 'vitest';
import { authApi } from './api/auth';
import { ApiError } from '@/lib/api';
vi.mock('./api/auth', () => ({ authApi: { refreshSession: vi.fn(), getCurrentUser: vi.fn() } }));
const user = { id: 'owner', email: 'owner@example.invalid', firstName: 'Own', lastName: 'Er', role: 'CUSTOMER' as const };
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); sessionStorage.clear(); });
it('leaves guests on the existing provider bootstrap path', async () => {
  const session = await import('./sessionRestore');
  session.preloadSessionRestore();
  expect(authApi.refreshSession).not.toHaveBeenCalled();
});
it('starts refresh before React, verifies ownership, and shares the prepared read once', async () => {
  sessionStorage.setItem('electrohub:cached-user', JSON.stringify({ ...user, id: 'remembered-owner' }));
  vi.mocked(authApi.refreshSession).mockResolvedValue({ accessToken: 'test-token' });
  vi.mocked(authApi.getCurrentUser).mockResolvedValue({ user });
  const session = await import('./sessionRestore');
  session.preloadSessionRestore();
  session.preloadSessionRestore();
  await vi.waitFor(() => expect(authApi.getCurrentUser).toHaveBeenCalledTimes(1));
  expect(session.isRestoreTokenReady()).toBe(true);
  const first = session.restoreSession();
  expect(session.restoreSession()).toBe(first);
  expect(await first).toEqual(user);
  expect(authApi.refreshSession).toHaveBeenCalledTimes(1);
  expect(JSON.parse(sessionStorage.getItem('electrohub:cached-user')!).id).toBe('remembered-owner');
  expect(session.isRestoreTokenReady()).toBe(false);
  expect([...Object.values(sessionStorage)]).not.toContain('test-token');
});
it('retains an early invalid-session result for the provider without a second refresh', async () => {
  sessionStorage.setItem('electrohub:cached-user', JSON.stringify(user));
  vi.mocked(authApi.refreshSession).mockRejectedValue(new ApiError(401, 'Expired'));
  const session = await import('./sessionRestore');
  session.preloadSessionRestore();
  await vi.waitFor(() => expect(authApi.refreshSession).toHaveBeenCalledTimes(1));
  await expect(session.restoreSession()).rejects.toMatchObject({ status: 401 });
  expect(authApi.getCurrentUser).not.toHaveBeenCalled();
  expect(session.isRestoreTokenReady()).toBe(false);
  expect(authApi.refreshSession).toHaveBeenCalledTimes(1);
});
it('allows a genuine retry after a transient prepared-session failure', async () => {
  sessionStorage.setItem('electrohub:cached-user', JSON.stringify(user));
  vi.mocked(authApi.refreshSession).mockRejectedValueOnce(new ApiError(503, 'Unavailable')).mockResolvedValue({ accessToken: 'test-token' });
  vi.mocked(authApi.getCurrentUser).mockResolvedValue({ user });
  const session = await import('./sessionRestore');
  session.preloadSessionRestore();
  await expect(session.restoreSession()).rejects.toMatchObject({ status: 503 });
  expect(await session.restoreSession()).toEqual(user);
  expect(authApi.refreshSession).toHaveBeenCalledTimes(2);
});
