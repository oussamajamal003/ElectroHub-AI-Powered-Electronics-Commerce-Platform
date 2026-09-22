import { apiClient, setAccessToken } from '@/lib/api';
import { User, LoginCredentials, RegisterData, AuthResponse } from '../types';

export const authApi = {
  login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
    const response = await apiClient<AuthResponse>('/api/auth/login', {
      method: 'POST',
      data: credentials,
    });
    setAccessToken(response.accessToken);
    return response;
  },

  register: async (data: RegisterData): Promise<AuthResponse> => {
    const response = await apiClient<AuthResponse>('/api/auth/register', {
      method: 'POST',
      data,
    });
    if (response.accessToken) {
      setAccessToken(response.accessToken);
    }
    return response;
  },

  logout: async (): Promise<void> => {
    await apiClient('/api/auth/logout', { method: 'POST' });
    setAccessToken(null);
  },

  getCurrentUser: async (): Promise<{ user: User }> => {
    return apiClient('/api/auth/me', { method: 'GET' });
  },

  updateProfile: async (data: { firstName?: string; lastName?: string }): Promise<{ message: string; user: User }> => {
    return apiClient('/api/auth/me', {
      method: 'PATCH',
      data,
    });
  },

  changePassword: async (data: { currentPassword: string; newPassword: string }): Promise<{ message: string }> => {
    return apiClient('/api/auth/change-password', {
      method: 'POST',
      data,
    });
  },
};
