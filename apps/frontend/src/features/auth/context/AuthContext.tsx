import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, LoginCredentials, RegisterData } from '../types';
import { authApi } from '../api/auth';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitializing: boolean;
}

interface AuthContextValue extends AuthState {
  login: (credentials: LoginCredentials) => Promise<User>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data: { firstName?: string; lastName?: string }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    isInitializing: true,
  });

  useEffect(() => {
    let mounted = true;

    async function initSession() {
      try {
        const { user } = await authApi.getCurrentUser();
        if (mounted) {
          setState((prev) => ({
            ...prev,
            user,
            isAuthenticated: true,
            isInitializing: false,
          }));
        }
      } catch {
        if (mounted) {
          setState((prev) => ({
            ...prev,
            user: null,
            isAuthenticated: false,
            isInitializing: false,
          }));
        }
      }
    }

    initSession();

    return () => {
      mounted = false;
    };
  }, []);

  const login = async (credentials: LoginCredentials): Promise<User> => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const response = await authApi.login(credentials);
      setState((prev) => ({
        ...prev,
        user: response.user,
        isAuthenticated: true,
      }));
      return response.user;
    } finally {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const register = async (data: RegisterData) => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const response = await authApi.register(data);
      if (response.user && response.accessToken) {
        setState((prev) => ({
          ...prev,
          user: response.user,
          isAuthenticated: true,
        }));
      }
    } finally {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const logout = async () => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      await authApi.logout();
    } finally {
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        isInitializing: false,
      });
      // In a real app we might redirect here, but we can let the components react to isAuthenticated = false
    }
  };

  const updateProfile = async (data: { firstName?: string; lastName?: string }) => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const response = await authApi.updateProfile(data);
      setState((prev) => ({
        ...prev,
        user: response.user,
      }));
    } finally {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, updateProfile }}>
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
