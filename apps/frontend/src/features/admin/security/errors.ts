import { ApiError } from '@/lib/api';

export interface AdminAuthFailure {
  message: string;
  /** The pre-auth transaction is gone (expired, consumed or locked): the user must start the sign-in again. */
  restart: boolean;
}

export type AdminAuthContext = 'totp' | 'recovery' | 'passkey' | 'enrollment' | 'invitation' | 'session' | 'team';

/**
 * Maps administrator authentication failures to truthful, non-enumerating copy. Messages never reveal whether an account or invitation
 * exists, never echo server internals and never include the submitted secret.
 */
export function describeAdminAuthError(error: unknown, context: AdminAuthContext): AdminAuthFailure {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return { message: 'The passkey prompt was cancelled or timed out. Try again, or use another method.', restart: false };
  }
  if (!(error instanceof ApiError)) return { message: 'Something went wrong. Please try again.', restart: false };
  if (error.status === 0) return { message: 'Unable to connect. Check your connection and try again.', restart: false };
  if (error.status === 429 || error.code === 'MFA_ATTEMPTS_EXCEEDED') {
    return { message: 'Too many incorrect attempts. Your sign-in is locked for now. Start again later.', restart: true };
  }
  switch (error.code) {
    case 'MFA_CHALLENGE_INVALID':
      return { message: 'Your sign-in attempt expired. Start again.', restart: true };
    case 'MFA_CODE_INVALID':
      return {
        message: context === 'recovery'
          ? 'That recovery code is not valid or has already been used.'
          : "That code isn't right. Check your authenticator app and try again.",
        restart: false,
      };
    case 'ENROLLMENT_NOT_AUTHORIZED':
      return { message: 'Two-step verification must be authorised by an owner before you can sign in.', restart: true };
    case 'ALREADY_ENROLLED':
      return { message: 'This account already has two-step verification. Start again to sign in.', restart: true };
    case 'NO_PASSKEY':
      return { message: 'No passkey is registered for this account. Use an authenticator app or a recovery code.', restart: false };
    case 'INVITATION_UNAVAILABLE':
    case 'ACCOUNT_EXISTS':
      return { message: 'This invitation can no longer be used. Ask an administrator for a new invitation.', restart: false };
    default:
      break;
  }
  if (error.status >= 500) return { message: 'Something went wrong. Please try again later.', restart: false };
  if (context === 'invitation' && error.status === 400) return { message: 'Check the highlighted details and try again.', restart: false };
  return { message: error.message || 'Something went wrong. Please try again.', restart: false };
}
