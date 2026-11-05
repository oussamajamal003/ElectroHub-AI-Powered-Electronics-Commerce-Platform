export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  authMethods?: { password: boolean; google: boolean };
}

export interface LoginCredentials {
  email: string;
  password?: string;
}

export interface RegisterData {
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
}

export interface AuthResponse {
  accessToken?: string;
  user?: User;
}

/**
 * Administrator password proof accepted: no session exists yet. The caller completes the restricted MFA challenge (or enrollment) with
 * the short-lived `mfaToken`, which lives only in React state and is never persisted, logged or placed in a URL.
 */
export interface AdminMfaRequired {
  requiresMfa: true;
  mfaToken: string;
  expiresAt: string;
  enrollmentRequired: boolean;
  factors: { totp: boolean; passkey: boolean; recoveryCode: boolean };
}

export function isAdminMfaRequired(value: unknown): value is AdminMfaRequired {
  return typeof value === 'object' && value !== null && (value as { requiresMfa?: unknown }).requiresMfa === true;
}
