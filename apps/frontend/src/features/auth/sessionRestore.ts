import { authApi } from './api/auth';
import { ApiError, setAccessToken, type AuthScope } from '@/lib/api';
import type { User } from './types';

/** Task 05.2: each scope keeps its own non-authoritative identity hint, so one portal can never show or restore the other's identity. */
export const scopeRole: Record<AuthScope, User['role']> = { admin: 'ADMIN', customer: 'CUSTOMER' };
export const cachedUserKey = (scope: AuthScope) => scope === 'admin' ? 'electrohub:admin:cached-user' : 'electrohub:cached-user';
export const headerIdentityKey = (scope: AuthScope) => scope === 'admin' ? 'electrohub:admin:header-identity' : 'electrohub:header-identity';

const prepared: Partial<Record<AuthScope, Promise<User>>> = {};
const restores: Partial<Record<AuthScope, Promise<User>>> = {};

export function readCachedUser(scope: AuthScope = 'customer'): User | null {
  const key = cachedUserKey(scope);
  try {
    const stored = sessionStorage.getItem(key) || localStorage.getItem(key);
    if (!stored) return null;
    const user: unknown = JSON.parse(stored);
    if (!user || typeof user !== 'object') return null;
    const value = user as Record<string, unknown>;
    if (typeof value.id !== 'string' || typeof value.email !== 'string') return null;
    // A hint of the other portal's role (for example an administrator cached before the scopes were separated) is never this scope's identity.
    if (value.role !== scopeRole[scope]) {
      for (const stale of [key, headerIdentityKey(scope)]) {
        sessionStorage.removeItem(stale);
        localStorage.removeItem(stale);
      }
      return null;
    }
    return user as User;
  } catch {
    return null;
  }
}

function startRestore(scope: AuthScope): Promise<User> {
  return (async () => {
    const { accessToken, user: refreshed } = await authApi.refreshSession(scope);
    setAccessToken(accessToken, scope);
    // The rotation response carries the same identity /me returns; older servers omit it, so /me stays the fallback.
    const user = refreshed && typeof refreshed.id === 'string' && typeof refreshed.email === 'string'
      ? refreshed : (await authApi.getCurrentUser(scope)).user;
    // Fail closed: a scope only ever restores its own role.
    if (user.role !== scopeRole[scope]) {
      setAccessToken(null, scope);
      throw new ApiError(401, 'Your session has expired. Please sign in again.');
    }
    return user;
  })();
}

// Start only for an existing identity hint. It authorizes nothing: refresh and
// /me still verify the session, and the provider consumes their result normally.
export function preloadSessionRestore(scope: AuthScope = 'customer'): void {
  if (!readCachedUser(scope) || prepared[scope] || restores[scope]) return;
  const request = startRestore(scope);
  prepared[scope] = request;
  void request.catch(() => undefined);
}

export function restoreSession(scope: AuthScope = 'customer'): Promise<User> {
  if (!restores[scope]) {
    const request = prepared[scope] ?? startRestore(scope);
    delete prepared[scope];
    restores[scope] = request.finally(() => { delete restores[scope]; });
  }
  return restores[scope]!;
}
