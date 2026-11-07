import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { startRegistration, type AuthenticationResponseJSON, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON, type RegistrationResponseJSON } from '@simplewebauthn/browser';
import { apiClient } from '@/lib/api';
import type { AdminMfaRequired, User } from '@/features/auth/types';
import { queryString, type ItemResponse, type ListResponse } from '@/features/admin/shared/api';

/*
 * Administrator authentication, self-service security and team APIs. Contract: docs/tasks/Phase-05/TASK_05.2_IMPLEMENTATION_PLAN.md
 * ("Authentication / administrator API contracts"). Pre-auth `/api/auth/admin/*` answers with plain bodies; `/api/admin/**` uses the
 * `{ data, meta? }` envelope. Secrets (passwords, codes, mfaToken, TOTP secret, recovery codes, invitation token) travel in request
 * bodies only: never in URLs, query keys or storage.
 */

// ─── Types ────────────────────────────────────────────────
export interface AdminSessionResponse { accessToken: string; user: User }
export interface AdminTotpEnrollment { factorId: string; otpauthUri: string; secret: string }
export interface AdminEnrollmentConfirmation extends AdminSessionResponse { recoveryCodes: string[] }
export interface AdminCapabilities { isOwner: boolean; canManageAdmins: boolean }
export interface AdminProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  emailVerified: boolean;
  capabilities: AdminCapabilities;
  /** Advisory: the server re-checks inside the deletion transaction. LAST_OWNER: ordinary deletion is refused; the Owner transfers ownership as part of deleting instead. */
  deletion?: { allowed: boolean; reason: 'LAST_OWNER' | null };
}
export interface TotpFactorSummary { id: string; label: string; createdAt: string; lastUsedAt: string | null }
export interface PasskeySummary { id: string; label: string; createdAt: string; lastUsedAt: string | null }
export interface AdminFactors {
  totp: TotpFactorSummary[];
  passkeys: PasskeySummary[];
  recoveryCodes: { remaining: number; generatedAt: string | null };
}
export interface AdminSessionSummary {
  id: string;
  current: boolean;
  device: string;
  ipMasked: string | null;
  createdAt: string;
  lastActiveAt: string;
  mfaMethod: string;
}
export interface LoginHistoryEvent {
  id: string;
  event: string;
  outcome: 'SUCCESS' | 'FAILURE' | string;
  device: string | null;
  ipMasked: string | null;
  occurredAt: string;
}
export interface OwnershipSuccessor {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  canManageAdmins: boolean;
  mfa: { totp: number; passkeys: number };
}

export interface AdministratorSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  isOwner: boolean;
  canManageAdmins: boolean;
  mfaEnrolled: boolean;
  /** The live activation for a factor-less administrator (PENDING, or EXPIRED once its link lapsed), else null. */
  mfaActivation: AdminActivation | null;
  /** End of the short first-factor window after a redeemed activation; null when no window is open. */
  enrollmentAuthorizedUntil: string | null;
  isSelf: boolean;
  lastLoginAt: string | null;
}
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
export type InvitationDelivery = 'PENDING' | 'SENT' | 'FAILED';
export interface AdminInvitation {
  id: string;
  email: string;
  status: InvitationStatus;
  deliveryStatus: InvitationDelivery;
  grantManageAdmins: boolean;
  expiresAt: string;
  createdAt: string;
}
export interface AdminActivation {
  id: string;
  status: 'PENDING' | 'EXPIRED' | 'REDEEMED' | 'REVOKED';
  deliveryStatus: InvitationDelivery;
  expiresAt: string;
  lastSentAt: string | null;
  sendCount: number;
}
export interface AdminActivationPreview { email: string; firstName: string; lastName: string; expiresAt: string }
export type StepUpMethod = 'TOTP' | 'RECOVERY_CODE';

// ─── Query keys ───────────────────────────────────────────
export const adminSecurityKeys = {
  all: ['admin', 'security'] as const,
  profile: ['admin', 'security', 'profile'] as const,
  factors: ['admin', 'security', 'factors'] as const,
  sessions: (page: number) => ['admin', 'security', 'sessions', page] as const,
  loginHistory: (page: number) => ['admin', 'security', 'login-history', page] as const,
};
export const adminTeamKeys = {
  all: ['admin', 'team'] as const,
  administrators: (page: number) => ['admin', 'team', 'administrators', page] as const,
  invitations: (status: string, page: number) => ['admin', 'team', 'invitations', status, page] as const,
};

// ─── Pre-auth (challenge-bound) ───────────────────────────
const PRE_AUTH = '/api/auth/admin';
export const adminAuthApi = {
  verifyTotp: (body: { mfaToken: string; code: string }) =>
    apiClient<AdminSessionResponse>(`${PRE_AUTH}/mfa/totp/verify`, { method: 'POST', data: body }),
  verifyRecovery: (body: { mfaToken: string; code: string }) =>
    apiClient<AdminSessionResponse>(`${PRE_AUTH}/mfa/recovery/verify`, { method: 'POST', data: body }),
  passkeyOptions: async (body: { mfaToken: string }) =>
    (await apiClient<{ options: PublicKeyCredentialRequestOptionsJSON }>(`${PRE_AUTH}/mfa/webauthn/options`, { method: 'POST', data: body })).options,
  verifyPasskey: (body: { mfaToken: string; response: AuthenticationResponseJSON }) =>
    apiClient<AdminSessionResponse>(`${PRE_AUTH}/mfa/webauthn/verify`, { method: 'POST', data: body }),
  startEnrollment: (body: { mfaToken: string }) =>
    apiClient<AdminTotpEnrollment>(`${PRE_AUTH}/mfa/enrollment/start`, { method: 'POST', data: body }),
  confirmEnrollment: (body: { mfaToken: string; factorId: string; code: string }) =>
    apiClient<AdminEnrollmentConfirmation>(`${PRE_AUTH}/mfa/enrollment/confirm`, { method: 'POST', data: body }),
  previewInvitation: (body: { token: string }) =>
    apiClient<{ email: string; expiresAt: string }>(`${PRE_AUTH}/invitations/preview`, { method: 'POST', data: body }),
  acceptInvitation: (body: { token: string; firstName: string; lastName: string; password: string }) =>
    apiClient<AdminMfaRequired>(`${PRE_AUTH}/invitations/accept`, { method: 'POST', data: body }),
  previewActivation: (body: { token: string }) =>
    apiClient<AdminActivationPreview>(`${PRE_AUTH}/activation/preview`, { method: 'POST', data: body }),
  redeemActivation: (body: { token: string; password: string }) =>
    apiClient<AdminMfaRequired>(`${PRE_AUTH}/activation/redeem`, { method: 'POST', data: body }),
};

// ─── Self-service (MFA-assured session) ───────────────────
const ME = '/api/admin/me';
const enveloped = async <T>(endpoint: string, options?: { method?: string; data?: unknown; signal?: AbortSignal }): Promise<T> =>
  (await apiClient<ItemResponse<T>>(endpoint, options)).data;

export const adminSecurityApi = {
  getProfile: (signal?: AbortSignal) => enveloped<AdminProfile>(`${ME}/profile`, { signal }),
  updateProfile: (body: { firstName: string; lastName: string }) =>
    enveloped<AdminProfile>(`${ME}/profile`, { method: 'PATCH', data: body }),

  stepUp: (body: { method: StepUpMethod; code: string }) =>
    apiClient<void>(`${ME}/security/step-up`, { method: 'POST', data: body }),
  stepUpPasskeyOptions: async () =>
    (await enveloped<{ options: PublicKeyCredentialRequestOptionsJSON }>(`${ME}/security/step-up/webauthn/options`, { method: 'POST' })).options,
  stepUpPasskey: (body: { response: AuthenticationResponseJSON }) =>
    apiClient<void>(`${ME}/security/step-up/webauthn`, { method: 'POST', data: body }),

  getFactors: () => enveloped<AdminFactors>(`${ME}/security/factors`),
  startTotp: (body: { label: string }) => enveloped<AdminTotpEnrollment>(`${ME}/security/totp`, { method: 'POST', data: body }),
  confirmTotp: (factorId: string, body: { code: string }) =>
    apiClient<void>(`${ME}/security/totp/${encodeURIComponent(factorId)}/confirm`, { method: 'POST', data: body }),
  removeTotp: (factorId: string) => apiClient<void>(`${ME}/security/totp/${encodeURIComponent(factorId)}`, { method: 'DELETE' }),
  regenerateRecoveryCodes: () => enveloped<{ codes: string[] }>(`${ME}/security/recovery-codes`, { method: 'POST' }),

  passkeyRegistrationOptions: async () =>
    (await enveloped<{ options: PublicKeyCredentialCreationOptionsJSON }>(`${ME}/security/passkeys/options`, { method: 'POST' })).options,
  addPasskey: (body: { response: RegistrationResponseJSON; label: string }) =>
    enveloped<PasskeySummary>(`${ME}/security/passkeys`, { method: 'POST', data: body }),
  renamePasskey: (credentialId: string, body: { label: string }) =>
    enveloped<PasskeySummary>(`${ME}/security/passkeys/${encodeURIComponent(credentialId)}`, { method: 'PATCH', data: body }),
  removePasskey: (credentialId: string) => apiClient<void>(`${ME}/security/passkeys/${encodeURIComponent(credentialId)}`, { method: 'DELETE' }),

  listSessions: (page: number) => apiClient<ListResponse<AdminSessionSummary>>(`${ME}/sessions${queryString({ page })}`),
  revokeSession: (id: string) => apiClient<void>(`${ME}/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  revokeOtherSessions: () => apiClient<void>(`${ME}/sessions/revoke-others`, { method: 'POST' }),
  loginHistory: (page: number) => apiClient<ListResponse<LoginHistoryEvent>>(`${ME}/login-history${queryString({ page })}`),

  /** Both end every session, this one included: the caller must clear local auth state and send the administrator to sign in. */
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    enveloped<{ changed: true; signInRequired: true }>(`${ME}/password`, { method: 'POST', data: body }),
  deleteAccount: (body: { currentPassword: string; confirmation: 'DELETE' }) =>
    enveloped<{ deleted: true }>(`${ME}/delete`, { method: 'POST', data: body }),
  /** Owner only: administrators the server currently considers eligible to become Owner (re-checked again at commit). */
  ownershipSuccessors: (signal?: AbortSignal) => enveloped<OwnershipSuccessor[]>(`${ME}/ownership-successors`, { signal }),
  /** The last-Owner exit: promotes the successor and deletes this account in one server transaction. Ends this session. */
  transferOwnershipAndDelete: (body: { successorId: string; currentPassword: string; confirmation: 'DELETE' }) =>
    enveloped<{ deleted: true; ownershipTransferred: true }>(`${ME}/ownership-transfer-and-delete`, { method: 'POST', data: body }),
};

// ─── Team ─────────────────────────────────────────────────
const TEAM = '/api/admin';
export const adminTeamApi = {
  listAdministrators: (page: number) => apiClient<ListResponse<AdministratorSummary>>(`${TEAM}/administrators${queryString({ page })}`),
  updateAccess: (id: string, body: { isActive?: boolean; canManageAdmins?: boolean }) =>
    enveloped<AdministratorSummary>(`${TEAM}/administrators/${encodeURIComponent(id)}/access`, { method: 'PATCH', data: body }),
  listInvitations: (status: string, page: number) =>
    apiClient<ListResponse<AdminInvitation>>(`${TEAM}/invitations${queryString({ status, page })}`),
  createInvitation: (body: { email: string; grantManageAdmins: boolean }) =>
    enveloped<AdminInvitation>(`${TEAM}/invitations`, { method: 'POST', data: body }),
  resendInvitation: (id: string) => enveloped<AdminInvitation>(`${TEAM}/invitations/${encodeURIComponent(id)}/resend`, { method: 'POST' }),
  revokeInvitation: (id: string) => enveloped<AdminInvitation>(`${TEAM}/invitations/${encodeURIComponent(id)}/revoke`, { method: 'POST' }),
  requestActivation: (id: string) => enveloped<AdminActivation>(`${TEAM}/administrators/${encodeURIComponent(id)}/mfa-activation`, { method: 'POST' }),
  resendActivation: (id: string) => enveloped<AdminActivation>(`${TEAM}/administrators/${encodeURIComponent(id)}/mfa-activation/resend`, { method: 'POST' }),
  revokeActivation: (id: string) => enveloped<AdminActivation>(`${TEAM}/administrators/${encodeURIComponent(id)}/mfa-activation/revoke`, { method: 'POST' }),
  grantOwner: (id: string) => enveloped<{ id: string; isOwner: true; canManageAdmins: true; signInRequired: true }>(
    `${TEAM}/administrators/${encodeURIComponent(id)}/grant-owner`, { method: 'POST', data: {} }),
};

/** Creates a passkey: server options, the browser ceremony, then the server verifies and stores the credential. */
export async function registerPasskey(label: string): Promise<PasskeySummary> {
  const options = await adminSecurityApi.passkeyRegistrationOptions();
  const response = await startRegistration({ optionsJSON: options });
  return adminSecurityApi.addPasskey({ response, label });
}

// ─── Hooks ────────────────────────────────────────────────
export function useAdminProfile() {
  return useQuery({ queryKey: adminSecurityKeys.profile, queryFn: ({ signal }) => adminSecurityApi.getProfile(signal) });
}

export function useAdminFactors() {
  return useQuery({ queryKey: adminSecurityKeys.factors, queryFn: () => adminSecurityApi.getFactors() });
}

export function useAdminSessions(page: number) {
  return useQuery({ queryKey: adminSecurityKeys.sessions(page), queryFn: () => adminSecurityApi.listSessions(page), placeholderData: keepPreviousData });
}

export function useAdminLoginHistory(page: number) {
  return useQuery({ queryKey: adminSecurityKeys.loginHistory(page), queryFn: () => adminSecurityApi.loginHistory(page), placeholderData: keepPreviousData });
}

/** Fetched only while the succession wizard is open; never cached across visits (eligibility can change at any time). */
export function useOwnershipSuccessors(enabled: boolean) {
  return useQuery({ queryKey: [...adminSecurityKeys.all, 'ownership-successors'], queryFn: ({ signal }) => adminSecurityApi.ownershipSuccessors(signal),
    enabled, staleTime: 0, gcTime: 0 });
}

export function useAdministrators(page: number) {
  return useQuery({ queryKey: adminTeamKeys.administrators(page), queryFn: () => adminTeamApi.listAdministrators(page), placeholderData: keepPreviousData });
}

export function useInvitations(status: string, page: number) {
  return useQuery({ queryKey: adminTeamKeys.invitations(status, page), queryFn: () => adminTeamApi.listInvitations(status, page), placeholderData: keepPreviousData });
}

/**
 * Mutations invalidate their whole namespace once they settle, so every list, the factor summary, the profile and the session list
 * stay consistent after a write. Step-up is applied by the caller (see useStepUp): the mutation simply rejects with STEP_UP_REQUIRED.
 */
function useNamespaceMutation<TVariables, TResult>(namespace: readonly string[], fn: (variables: TVariables) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => client.invalidateQueries({ queryKey: namespace }) });
}

export function useUpdateAdminProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { firstName: string; lastName: string }) => adminSecurityApi.updateProfile(body),
    onSuccess: (profile) => client.setQueryData(adminSecurityKeys.profile, profile),
  });
}
export const useStartTotp = () => useNamespaceMutation(adminSecurityKeys.all, (body: { label: string }) => adminSecurityApi.startTotp(body));
export const useConfirmTotp = () => useNamespaceMutation(adminSecurityKeys.all, (vars: { factorId: string; code: string }) => adminSecurityApi.confirmTotp(vars.factorId, { code: vars.code }));
export const useRemoveTotp = () => useNamespaceMutation(adminSecurityKeys.all, (factorId: string) => adminSecurityApi.removeTotp(factorId));
export const useRegenerateRecoveryCodes = () => useNamespaceMutation(adminSecurityKeys.all, () => adminSecurityApi.regenerateRecoveryCodes());
export const useAddPasskey = () => useNamespaceMutation(adminSecurityKeys.all, (label: string) => registerPasskey(label));
export const useRenamePasskey = () => useNamespaceMutation(adminSecurityKeys.all, (vars: { id: string; label: string }) => adminSecurityApi.renamePasskey(vars.id, { label: vars.label }));
export const useRemovePasskey = () => useNamespaceMutation(adminSecurityKeys.all, (id: string) => adminSecurityApi.removePasskey(id));
export const useRevokeSession = () => useNamespaceMutation(adminSecurityKeys.all, (id: string) => adminSecurityApi.revokeSession(id));
export const useRevokeOtherSessions = () => useNamespaceMutation(adminSecurityKeys.all, () => adminSecurityApi.revokeOtherSessions());

export const useUpdateAdministratorAccess = () => useNamespaceMutation(adminTeamKeys.all, (vars: { id: string; body: { isActive?: boolean; canManageAdmins?: boolean } }) => adminTeamApi.updateAccess(vars.id, vars.body));
export const useCreateInvitation = () => useNamespaceMutation(adminTeamKeys.all, (body: { email: string; grantManageAdmins: boolean }) => adminTeamApi.createInvitation(body));
export const useResendInvitation = () => useNamespaceMutation(adminTeamKeys.all, (id: string) => adminTeamApi.resendInvitation(id));
export const useRevokeInvitation = () => useNamespaceMutation(adminTeamKeys.all, (id: string) => adminTeamApi.revokeInvitation(id));
export const useRequestActivation = () => useNamespaceMutation(adminTeamKeys.all, (id: string) => adminTeamApi.requestActivation(id));
export const useResendActivation = () => useNamespaceMutation(adminTeamKeys.all, (id: string) => adminTeamApi.resendActivation(id));
export const useGrantOwner = () => useNamespaceMutation(adminTeamKeys.all, (id: string) => adminTeamApi.grantOwner(id));
export const useRevokeActivation = () => useNamespaceMutation(adminTeamKeys.all, (id: string) => adminTeamApi.revokeActivation(id));
