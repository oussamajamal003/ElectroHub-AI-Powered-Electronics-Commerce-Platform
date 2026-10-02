import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, LoginCredentials, RegisterData } from '../types';
import { authApi, VerificationResponse } from '../api/auth';
import { ApiError, setAccessToken } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitializing: boolean;
}

interface AuthContextValue extends AuthState {
  isSessionVerified: boolean;
  isLoggingOut: boolean;
  rememberedUser: Pick<User, 'firstName' | 'lastName'> | null;
  finishGoogle: () => Promise<void>;
  login: (credentials: LoginCredentials) => Promise<VerificationResponse>;
  register: (data: RegisterData) => Promise<VerificationResponse>;
  verifyEmail: (data: { email: string; code: string }) => Promise<VerificationResponse>;
  logout: () => Promise<void>;
  finishLogoutTransition: () => void;
  clearSession: () => void;
  updateProfile: (data: { firstName?: string; lastName?: string; email?: string }) => Promise<VerificationResponse>;
  verifyEmailChange: (code: string) => Promise<User>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
let restorePromise: Promise<User> | null = null;
const headerIdentityKey = 'electrohub:header-identity';
const userCacheKey = 'electrohub:cached-user';
type HeaderIdentity = Pick<User, 'firstName' | 'lastName'>;

function readCachedUser(): User | null {
  try {
    const stored = sessionStorage.getItem(userCacheKey);
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

function saveCachedUser(user: User): void {
  try { sessionStorage.setItem(userCacheKey, JSON.stringify(user)); } catch { /* Storage can be unavailable. */ }
}

function removeCachedUser(): void {
  try { sessionStorage.removeItem(userCacheKey); } catch { /* Storage can be unavailable. */ }
}

function readHeaderIdentity(): HeaderIdentity | null {
  try {
    const stored = sessionStorage.getItem(headerIdentityKey);
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

function saveHeaderIdentity(user: User): HeaderIdentity {
  const identity = { firstName: user.firstName, lastName: user.lastName };
  try { sessionStorage.setItem(headerIdentityKey, JSON.stringify(identity)); } catch { /* Storage can be unavailable. */ }
  return identity;
}

function removeHeaderIdentity() {
  try { sessionStorage.removeItem(headerIdentityKey); } catch { /* Storage can be unavailable. */ }
}

function restoreSession(): Promise<User> {
  if (!restorePromise) {
    restorePromise = (async () => {
      const { accessToken } = await authApi.refreshSession();
      setAccessToken(accessToken);
      const { user } = await authApi.getCurrentUser();
      return user;
    })().finally(() => { restorePromise = null; });
  }
  return restorePromise;
}

function getInitialAuthState(): AuthState {
  const cached = readCachedUser();
  if (cached) {
    return {
      user: cached,
      isAuthenticated: true,
      isLoading: false,
      isInitializing: false,
    };
  }
  return {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    isInitializing: true,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [isSessionVerified, setSessionVerified] = useState(false);
  const [isLoggingOut, setLoggingOut] = useState(false);
  const [rememberedUser, setRememberedUser] = useState<HeaderIdentity | null>(readHeaderIdentity);
  const remember = (user: User) => {
    saveCachedUser(user);
    setRememberedUser(saveHeaderIdentity(user));
  };
  const forget = () => {
    removeCachedUser();
    removeHeaderIdentity();
    setRememberedUser(null);
  };
  const [state, setState] = useState<AuthState>(getInitialAuthState);

  useEffect(() => {
    let mounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    async function initSession() {
      try {
        const user = await restoreSession();
        if (mounted) {
          remember(user);
          setState({ user, isAuthenticated: true, isLoading: false, isInitializing: false });
          setSessionVerified(true);
        }
      } catch (error) {
        if (!mounted) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          setAccessToken(null);
          forget();
          setState({ user: null, isAuthenticated: false, isLoading: false, isInitializing: false });
          setSessionVerified(true);
        } else {
          retryTimer = setTimeout(() => { void initSession(); }, 2000);
        }
      }
    }

    void initSession();

    return () => {
      mounted = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    const clearExpiredSession = () => {
      setAccessToken(null);
      forget();
      queryClient.clear();
      setState({ user: null, isAuthenticated: false, isLoading: false, isInitializing: false });
      setSessionVerified(true);
    };
    window.addEventListener('electrohub:session-expired', clearExpiredSession);
    return () => window.removeEventListener('electrohub:session-expired', clearExpiredSession);
  }, [queryClient]);

  const login = async (credentials: LoginCredentials): Promise<VerificationResponse> => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const response = await authApi.login(credentials);
      const authenticatedUser = response.user;
      if (authenticatedUser) {
        queryClient.clear();
        setSessionVerified(true);
        remember(authenticatedUser);
        setState((prev) => ({
          ...prev,
          user: authenticatedUser,
          isAuthenticated: true,
        }));
      }
      return response;
    } finally {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
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
      await authApi.logout();
    } finally {
      setAccessToken(null);
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
    setAccessToken(null);
    forget();
    queryClient.clear();
    setSessionVerified(true);
    setState({ user: null, isAuthenticated: false, isLoading: false, isInitializing: false });
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
    setState(previous => ({ ...previous, user, isAuthenticated: true }));
  };

  return (
    <AuthContext.Provider value={{ ...state, isSessionVerified, isLoggingOut, rememberedUser, login, register, verifyEmail, logout, finishLogoutTransition, clearSession, updateProfile, verifyEmailChange, finishGoogle }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
