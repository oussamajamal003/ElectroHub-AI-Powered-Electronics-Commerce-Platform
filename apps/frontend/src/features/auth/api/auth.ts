import { apiClient, setAccessToken } from '@/lib/api';
import { User, LoginCredentials, RegisterData, AuthResponse } from '../types';

export interface VerifyEmailData {
  email: string;
  code: string;
}

export interface VerificationResponse extends AuthResponse {
  requiresVerification?: boolean;
  email?: string;
  message?: string;
}

export const authApi = {
  login: async (credentials: LoginCredentials): Promise<VerificationResponse> => {
    const response = await apiClient<VerificationResponse>('/api/auth/login', {
      method: 'POST',
      data: credentials,
    });
    if (response.accessToken) {
      setAccessToken(response.accessToken);
    }
    return response;
  },

  register: async (data: RegisterData): Promise<VerificationResponse> => {
    const response = await apiClient<VerificationResponse>('/api/auth/register', {
      method: 'POST',
      data,
    });
    return response;
  },

  verifyEmail: async (data: VerifyEmailData): Promise<VerificationResponse> => {
    const response = await apiClient<VerificationResponse>('/api/auth/verify-email', {
      method: 'POST',
      data,
    });
    if (response.accessToken) {
      setAccessToken(response.accessToken);
    }
    return response;
  },

  resendVerification: async (data: { email: string }): Promise<{ message: string }> => {
    return apiClient<{ message: string }>('/api/auth/resend-verification', {
      method: 'POST',
      data,
    });
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

  forgotPassword: async (data: { email: string }): Promise<{ message: string }> => {
    return apiClient('/api/auth/forgot-password', {
      method: 'POST',
      data,
    });
  },

  resetPassword: async (data: { email: string; code: string; newPassword: string }): Promise<{ message: string }> => {
    return apiClient('/api/auth/reset-password', {
      method: 'POST',
      data,
    });
  },
};
