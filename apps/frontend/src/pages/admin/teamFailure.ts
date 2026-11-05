import { ApiError } from '@/lib/api';
import { describeAdminAuthError } from '@/features/admin/security/errors';
import { isStepUpCancelled } from '@/features/admin/security/useStepUp';

/** Team-specific copy for the failures an administrator can act on. Anything else falls back to the shared mapper. */
export function teamFailure(error: unknown): string | null {
  if (isStepUpCancelled(error)) return null;
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'LAST_OWNER': return 'At least one active owner must remain.';
      case 'SELF_CHANGE': return 'You cannot change your own access from this list.';
      case 'INVITATION_EXISTS': return 'A pending invitation for this address already exists. Use Resend in the invitations list instead of inviting again.';
      case 'ACCOUNT_EXISTS': return 'An ElectroHub account already uses this email address. To invite this person as an administrator, use a different email address. Existing customer accounts cannot be converted through an invitation.';
      case 'CAPABILITY_REQUIRED': return 'Managing administrators requires additional access. Ask an owner.';
      default: break;
    }
  }
  return describeAdminAuthError(error, 'team').message;
}
