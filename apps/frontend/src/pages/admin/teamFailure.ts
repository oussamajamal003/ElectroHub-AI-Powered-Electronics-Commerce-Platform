import { ApiError } from '@/lib/api';
import { describeAdminAuthError } from '@/features/admin/security/errors';
import { isStepUpCancelled } from '@/features/admin/security/useStepUp';

/** Team-specific copy for the failures an administrator can act on. Anything else falls back to the shared mapper. */
export function teamFailure(error: unknown): string | null {
  if (isStepUpCancelled(error)) return null;
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'SELF_CHANGE': return 'You cannot change your own access from this list.';
      case 'ADMIN_ALREADY_EXISTS': return 'This administrator already exists. An administrator account already uses this email address. Use Manage Administrators to review their access or reactivate them.';
      case 'INVITATION_EXISTS': return 'An invitation is already pending for this address. Use Resend in the Invitations section instead.';
      case 'ACCOUNT_EXISTS': return 'This email address is already associated with an ElectroHub account and cannot be used for a new administrator invitation.';
      case 'ACTIVATION_PENDING': return 'An activation link is already pending for this administrator. Use Resend or Revoke instead.';
      case 'ALREADY_ENROLLED': return 'This administrator already has two-step verification. Lost factors follow the separate recovery procedure.';
      case 'ACCOUNT_INACTIVE': return 'This administrator account is deactivated. Reactivate it before sending an activation link.';
      case 'RESEND_COOLDOWN': return 'The link was sent moments ago. Wait a minute before resending.';
      case 'ALREADY_OWNER': return 'This administrator is already an Owner.';
      case 'TARGET_NOT_OWNER': return 'This administrator is no longer an Owner. The list has been refreshed.';
      case 'TARGET_INACTIVE': return 'This administrator is deactivated. Reactivate them before changing Owner access.';
      case 'TARGET_NOT_FOUND': return 'This administrator no longer exists. The list has been refreshed.';
      case 'SELF_OWNER_REVOCATION_FORBIDDEN': return 'You cannot revoke your own Owner privileges here. To leave, transfer ownership when deleting your account.';
      case 'LAST_OWNER': return error.message || 'At least one active owner must remain.';
      case 'SUCCESSOR_NOT_FOUND': case 'SUCCESSOR_INACTIVE': case 'SUCCESSOR_MFA_REQUIRED': case 'SUCCESSOR_NOT_ELIGIBLE':
        return 'This administrator is no longer eligible to become Owner. Only active administrators with two-step verification enabled can be promoted.';
      case 'CAPABILITY_REQUIRED': return 'Managing administrators requires additional access. Ask an owner.';
      default: break;
    }
  }
  return describeAdminAuthError(error, 'team').message;
}
