import { authApi } from './api/auth';
import { setAccessToken } from '@/lib/api';
import type { User } from './types';

const userCacheKey = 'electrohub:cached-user';
let prepared: Promise<User> | null = null;
let restorePromise: Promise<User> | null = null;

export function readCachedUser(): User | null {
  try {
    const stored = sessionStorage.getItem(userCacheKey) || localStorage.getItem(userCacheKey);
    if (!stored) return null;
    const user: unknown = JSON.parse(stored);
    if (!user || typeof user !== 'object') return null;
    const value = user as Record<string, unknown>;
    if (typeof value.id !== 'string' || typeof value.email !== 'string') return null;
    return user as User;
  } catch {
    return null;
  }
}

function startRestore(): Promise<User> {
  return (async () => {
    const { accessToken, user: refreshed } = await authApi.refreshSession();
    setAccessToken(accessToken);
    // The rotation response carries the same identity /me returns; older servers omit it, so /me stays the fallback.
    if (refreshed && typeof refreshed.id === 'string' && typeof refreshed.email === 'string') return refreshed;
    const { user } = await authApi.getCurrentUser();
    return user;
  })();
}

// Start only for an existing identity hint. It authorizes nothing: refresh and
// /me still verify the session, and the provider consumes their result normally.
export function preloadSessionRestore(): void {
  if (!readCachedUser() || prepared || restorePromise) return;
  prepared = startRestore();
  void prepared.catch(() => undefined);
}

export function restoreSession(): Promise<User> {
  if (!restorePromise) {
    const request = prepared ?? startRestore();
    prepared = null;
    restorePromise = request.finally(() => { restorePromise = null; });
  }
  return restorePromise;
}
