import { apiClient, setAccessToken } from '@/lib/api';
import { User, LoginCredentials, RegisterData, AuthResponse } from '../types';

export interface VerifyEmailData {
  email: string;
  code: string;
}

export interface VerificationResponse extends AuthResponse {
  user?: User & { pendingEmail?: string; requiresEmailVerification?: boolean; verificationDeliveryStatus?: 'ACCEPTED_BY_PROVIDER' | 'FAILED' | 'PENDING' };
  requiresVerification?: boolean;
  deliveryFailed?: boolean;
  email?: string;
  pendingEmail?: string;
  requiresEmailVerification?: boolean;
  verificationDeliveryStatus?: 'ACCEPTED_BY_PROVIDER' | 'FAILED' | 'PENDING';
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

  resendVerification: async (data: { email: string }): Promise<{ message: string; resendAvailableAt: string }> => {
    return apiClient<{ message: string; resendAvailableAt: string }>('/api/auth/resend-verification', {
      method: 'POST',
      data,
    });
  },

  changeVerificationEmail: async (data: { currentEmail: string; password: string; newEmail: string }): Promise<{ message: string; email: string; deliveryStatus: 'ACCEPTED_BY_PROVIDER' | 'FAILED' | 'PENDING' }> => {
    return apiClient('/api/auth/change-verification-email', {
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

  updateProfile: async (data: { firstName?: string; lastName?: string; email?: string }): Promise<{ message: string; user: User & { pendingEmail?: string; requiresEmailVerification?: boolean; verificationDeliveryStatus?: 'ACCEPTED_BY_PROVIDER' | 'FAILED' | 'PENDING' } }> => {
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

  resendPasswordReset: async (data: { email: string }): Promise<{ message: string; resendAvailableAt: string }> => {
    return apiClient('/api/auth/resend-password-reset', { method: 'POST', data });
  },

  verifyResetOtp: async (data: { email: string; code: string }): Promise<{ message: string; resetToken: string; expiresAt: string }> => {
    return apiClient('/api/auth/verify-reset-otp', {
      method: 'POST',
      data,
    });
  },

  resetPassword: async (data: { resetToken: string; newPassword: string }): Promise<{ message: string }> => {
    return apiClient('/api/auth/reset-password', {
      method: 'POST',
      data,
    });
  },

  verifyEmailChange: async (data: { code: string }): Promise<{ message: string; user: User }> => {
    return apiClient('/api/auth/me/verify-email-change', {
      method: 'POST',
      data,
    });
  },

  resendEmailChange: async (): Promise<{ message: string; expiresAt: string; resendAvailableAt: string }> => {
    return apiClient('/api/auth/me/resend-email-change', { method: 'POST' });
  },
};
