import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { User, LoginCredentials, RegisterData, isAdminMfaRequired } from '../types';
import { authApi, VerificationResponse, LoginResult } from '../api/auth';
import { ApiError, SESSION_EXPIRED_EVENT, setAccessToken, type AuthScope } from '@/lib/api';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { cachedUserKey, headerIdentityKey, readCachedUser, restoreSession, scopeRole } from '../sessionRestore';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitializing: boolean;
}

interface AuthContextValue extends AuthState {
  isSessionVerified: boolean;
  /** Session restore reached no verdict (server/network failure) after bounded automatic retries. */
  sessionUnavailable: boolean;
  retrySession: () => void;
  isLoggingOut: boolean;
  rememberedUser: Pick<User, 'firstName' | 'lastName'> | null;
  finishGoogle: () => Promise<void>;
  /** Customer sign-in establishes the session. An administrator's password proof returns `requiresMfa` and establishes nothing. */
  login: (credentials: LoginCredentials) => Promise<LoginResult>;
  /** Establishes an administrator session after the MFA challenge, enrollment or invitation acceptance succeeded. */
  completeAdminSession: (session: { accessToken: string; user: User }) => void;
  register: (data: RegisterData) => Promise<VerificationResponse>;
  verifyEmail: (data: { email: string; code: string }) => Promise<VerificationResponse>;
  logout: () => Promise<void>;
  finishLogoutTransition: () => void;
  clearSession: () => void;
  /** Updates the authenticated identity after a role-specific profile API succeeds. */
  updateUserNames: (expectedUserId: string, names: Pick<User, 'firstName' | 'lastName'>) => void;
  updateProfile: (data: { firstName?: string; lastName?: string; email?: string }) => Promise<VerificationResponse>;
  verifyEmailChange: (code: string) => Promise<User>;
}

/**
 * Task 05.2 session isolation: the storefront (CUSTOMER) and the Admin Console (ADMIN) are two independent instances of this provider.
 * Each owns its identity, hint storage keys, restore, expiry, cross-tab events and cache; neither reads, restores or clears the other.
 */
const contexts: Record<AuthScope, ReturnType<typeof createContext<AuthContextValue | undefined>>> = {
  customer: createContext<AuthContextValue | undefined>(undefined),
  admin: createContext<AuthContextValue | undefined>(undefined),
};
const SESSION_RESTORE_ATTEMPTS = 3;
const SESSION_RESTORE_RETRY_MS = 2000;
type HeaderIdentity = Pick<User, 'firstName' | 'lastName'>;

function saveCachedUser(scope: AuthScope, user: User): void {
  try {
    sessionStorage.setItem(cachedUserKey(scope), JSON.stringify(user));
    localStorage.setItem(cachedUserKey(scope), JSON.stringify(user));
  } catch { /* Storage can be unavailable. */ }
}

function removeCachedUser(scope: AuthScope): void {
  try {
    sessionStorage.removeItem(cachedUserKey(scope));
    localStorage.removeItem(cachedUserKey(scope));
  } catch { /* Storage can be unavailable. */ }
}

function readHeaderIdentity(scope: AuthScope): HeaderIdentity | null {
  const key = headerIdentityKey(scope);
  // Reading the cached hint first lets a role-mismatched one (written before the scopes were separated) purge this scope's header name too.
  readCachedUser(scope);
  try {
    const stored = sessionStorage.getItem(key) || localStorage.getItem(key);
    if (!stored) return null;
    const identity: unknown = JSON.parse(stored);
    if (!identity || typeof identity !== 'object') return null;
    const value = identity as Record<string, unknown>;
    if (typeof value.firstName !== 'string' || typeof value.lastName !== 'string') return null;
    return { firstName: value.firstName, lastName: value.lastName };
  } catch {
    return null;
  }
}

function saveHeaderIdentity(scope: AuthScope, user: User): HeaderIdentity {
  const identity = { firstName: user.firstName, lastName: user.lastName };
  try {
    sessionStorage.setItem(headerIdentityKey(scope), JSON.stringify(identity));
    localStorage.setItem(headerIdentityKey(scope), JSON.stringify(identity));
  } catch { /* Storage can be unavailable. */ }
  return identity;
}

function removeHeaderIdentity(scope: AuthScope) {
  try {
    sessionStorage.removeItem(headerIdentityKey(scope));
    localStorage.removeItem(headerIdentityKey(scope));
  } catch { /* Storage can be unavailable. */ }
}

function getInitialAuthState(scope: AuthScope, restore: boolean): AuthState {
  const cached = readCachedUser(scope);
  return {
    user: cached,
    isAuthenticated: Boolean(cached),
    isLoading: false,
    isInitializing: restore,
  };
}

/** The storefront session. Every existing storefront consumer keeps using `<AuthProvider>` and `useAuth()` unchanged. */
export function AuthProvider({ children }: { children: ReactNode }) {
  return <ScopedAuthProvider scope="customer">{children}</ScopedAuthProvider>;
}

/**
 * The Admin Console session. `queryClient` is the administrator's own cache (never the storefront's); `restore` says whether this
 * document should attempt an administrator restore at all (an identity hint exists or an /admin URL is open) so ordinary storefront
 * visits never call the administrator refresh endpoint.
 */
export function AdminAuthProvider({ children, queryClient, restore }: { children: ReactNode; queryClient?: QueryClient; restore?: boolean }) {
  const shouldRestore = restore ?? (Boolean(readCachedUser('admin')) || (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')));
  return <ScopedAuthProvider scope="admin" queryClient={queryClient} restore={shouldRestore}>{children}</ScopedAuthProvider>;
}

function ScopedAuthProvider({ children, scope, queryClient: ownQueryClient, restore = true }:
  { children: ReactNode; scope: AuthScope; queryClient?: QueryClient; restore?: boolean }) {
  const contextClient = useQueryClient();
  const queryClient = ownQueryClient ?? contextClient;
  const AuthContext = contexts[scope];
  const userCacheKey = cachedUserKey(scope);
  const [isSessionVerified, setSessionVerified] = useState(false);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const [restoreEpoch, setRestoreEpoch] = useState(0);
  const [isLoggingOut, setLoggingOut] = useState(false);
  const [rememberedUser, setRememberedUser] = useState<HeaderIdentity | null>(() => readHeaderIdentity(scope));
  const [state, setState] = useState<AuthState>(() => getInitialAuthState(scope, restore));
  const stateRef = useRef(state);
  stateRef.current = state;
  const remember = (user: User) => {
    saveCachedUser(scope, user);
    setRememberedUser(saveHeaderIdentity(scope, user));
  };
  const forget = () => {
    removeCachedUser(scope);
    removeHeaderIdentity(scope);
    setRememberedUser(null);
  };
  useEffect(() => {
    if (!restore) { setSessionVerified(true); return; }
    let mounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    async function initSession() {
      attempt++;
      try {
        const user = await restoreSession(scope);
        if (mounted) {
          setSessionUnavailable(false);
          remember(user);
          setState({ user, isAuthenticated: true, isLoading: false, isInitializing: false });
          setSessionVerified(true);
        }
      } catch (error) {
        if (!mounted) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          setAccessToken(null, scope);
          forget();
          setState({ user: null, isAuthenticated: false, isLoading: false, isInitializing: false });
          setSessionUnavailable(false);
          setSessionVerified(true);
        } else if (attempt < SESSION_RESTORE_ATTEMPTS) {
          retryTimer = setTimeout(() => { void initSession(); }, SESSION_RESTORE_RETRY_MS * attempt);
        } else {
          // No verdict: neither signed in nor signed out. Stop automatic retries so screens can show
          // an actionable state instead of an endless skeleton and an endless refresh loop.
          setSessionUnavailable(true);
        }
      }
    }

    void initSession();

    return () => {
      mounted = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the restore cycle is keyed by scope and the explicit retry epoch only
  }, [restoreEpoch, scope, restore]);
  // Customer-initiated: one new bounded restore cycle. A verified session is never restarted.
  const retrySession = () => {
    if (isSessionVerified) return;
    setSessionUnavailable(false);
    setRestoreEpoch(value => value + 1);
  };

  useEffect(() => {
    // Only this scope's expiry ends this scope's session. An event without a scope predates the separation and means the storefront.
    const clearExpiredSession = (event: Event) => {
      const expired = (event as CustomEvent<{ scope?: AuthScope }>).detail?.scope ?? 'customer';
      if (expired !== scope) return;
      setAccessToken(null, scope);
      forget();
      queryClient.clear();
      setState({ user: null, isAuthenticated: false, isLoading: false, isInitializing: false });
      setSessionVerified(true);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, clearExpiredSession);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, clearExpiredSession);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- forget only touches this scope's storage keys
  }, [queryClient, scope]);

  // Every tab of this origin shares each scope's identity hint. When another tab signs out or switches account in THIS scope, its
  // cached-identity key changes: this tab drops its in-memory token and private cache instead of showing a stale session, or reloads
  // to restore the new one. Only this scope's key is observed; no token or identity is exchanged between tabs.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== userCacheKey || event.storageArea !== localStorage) return;
      const current = stateRef.current.user;
      if (!event.newValue) {
        if (!current) return;
        setAccessToken(null, scope);
        queryClient.clear();
        setState({ user: null, isAuthenticated: false, isLoading: false, isInitializing: false });
        setSessionVerified(true);
        return;
      }
      const incoming = readCachedUser(scope);
      if (current && incoming && (incoming.id !== current.id || incoming.role !== current.role)) window.location.reload();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [queryClient, scope, userCacheKey]);

  const establishSession = (authenticatedUser: User) => {
    // Fail closed: a scope only ever holds its own role, whatever a caller hands it.
    if (authenticatedUser.role !== scopeRole[scope]) throw new ApiError(403, 'You do not have permission to do that.');
    queryClient.clear();
    setSessionVerified(true);
    remember(authenticatedUser);
    setState((prev) => ({
      ...prev,
      user: authenticatedUser,
      isAuthenticated: true,
      isInitializing: false,
    }));
  };

  const login = async (credentials: LoginCredentials): Promise<LoginResult> => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const response = await authApi.login(credentials);
      // Restricted administrator challenge: no session, no cache changes; the caller drives the second factor.
      if (isAdminMfaRequired(response)) return response;
      const authenticatedUser = response.user;
      // The administrator door never leaves a storefront session behind: customer credentials typed there are signed out again.
      if (scope === 'admin' && authenticatedUser && authenticatedUser.role !== scopeRole.admin) {
        await authApi.logout('customer').catch(() => undefined);
        return response;
      }
      if (authenticatedUser) {
        establishSession(authenticatedUser);
      }
      return response;
    } finally {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const completeAdminSession = (session: { accessToken: string; user: User }) => {
    // The administrator's token lives in the ADMIN scope only: it is never attached to a storefront request.
    setAccessToken(session.accessToken, 'admin');
    establishSession(session.user);
  };

  const register = async (data: RegisterData) => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const response = await authApi.register(data);
      return response;
    } finally {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const verifyEmail = async (data: { email: string; code: string }) => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const response = await authApi.verifyEmail(data);
      const verifiedUser = response.user;
      if (verifiedUser && response.accessToken) {
        queryClient.clear();
        setSessionVerified(true);
        remember(verifiedUser);
        setState((prev) => ({
          ...prev,
          user: verifiedUser,
          isAuthenticated: true,
          isInitializing: false,
        }));
      }
      return response;
    } finally {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const logout = async () => {
    setLoggingOut(true);
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      await authApi.logout(scope);
    } finally {
      setAccessToken(null, scope);
      forget();
      queryClient.clear();
      setSessionVerified(true);
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        isInitializing: false,
      });
      // In a real app we might redirect here, but we can let the components react to isAuthenticated = false
    }
  };

  const finishLogoutTransition = () => setLoggingOut(false);

  const clearSession = () => {
    setAccessToken(null, scope);
    forget();
    queryClient.clear();
    setSessionVerified(true);
    setState({ user: null, isAuthenticated: false, isLoading: false, isInitializing: false });
  };

  const updateUserNames = (expectedUserId: string, names: Pick<User, 'firstName' | 'lastName'>) => {
    const currentUser = stateRef.current.user;
    if (!currentUser || currentUser.id !== expectedUserId) return;
    const user = { ...currentUser, ...names };
    remember(user);
    setState(previous => previous.user?.id === expectedUserId
      ? { ...previous, user: { ...previous.user, ...names } }
      : previous);
  };

  const updateProfile = async (data: { firstName?: string; lastName?: string; email?: string }) => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const response = await authApi.updateProfile(data);
      remember(response.user);
      setState((prev) => ({
        ...prev,
        user: response.user,
      }));
      return response as VerificationResponse;
    } finally {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const verifyEmailChange = async (code: string): Promise<User> => {
    const response = await authApi.verifyEmailChange({ code });
    remember(response.user);
    setState((previous) => ({ ...previous, user: response.user }));
    return response.user;
  };

  const finishGoogle = async () => {
    const { user } = await authApi.finishGoogle();
    queryClient.clear();
    setSessionVerified(true);
    remember(user);
    setState(previous => ({ ...previous, user, isAuthenticated: true, isInitializing: false }));
  };

  return (
    <AuthContext.Provider value={{ ...state, isSessionVerified, sessionUnavailable, retrySession, isLoggingOut, rememberedUser, login, completeAdminSession, register, verifyEmail, logout, finishLogoutTransition, clearSession, updateUserNames, updateProfile, verifyEmailChange, finishGoogle }}>
      {children}
    </AuthContext.Provider>
  );
}

function useScopedAuth(scope: AuthScope, hook: string, provider: string) {
  const context = useContext(contexts[scope]);
  if (context === undefined) throw new Error(`${hook} must be used within ${provider}`);
  return context;
}

/** The storefront (CUSTOMER) session. It never exposes an administrator. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() { return useScopedAuth('customer', 'useAuth', 'an AuthProvider'); }

/** The Admin Console (ADMIN) session. It never exposes a customer. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAdminAuth() { return useScopedAuth('admin', 'useAdminAuth', 'an AdminAuthProvider'); }
