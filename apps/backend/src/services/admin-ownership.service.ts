import { dispatchDeletionNotice } from './admin-deletion-email.js';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ADMIN_AUTH_TX } from '../lib/transaction-options.js';
import { AppError } from '../middleware/errorHandler.js';
import { lockUserTokenLifecycle, revokeAdminSessions } from '../repositories/auth.repository.js';
import { DeliveryPublisher } from '../sockets/delivery.publisher.js';
import { verifyPassword } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { anonymizeAdministrator, assertPasswordUnchanged, inactiveAdministrator, invalidCurrentPassword, lockOwnerLifecycle } from './admin-account.service.js';
import { recordAdminAudit } from './admin-audit.js';
import { sendOwnerGrantedEmail, sendOwnerRevokedEmail } from './admin-invitation-email.js';
import type { RequestMeta } from './admin-mfa.service.js';

/**
 * Task 05.2 Owner succession. Owner capability (AdminAccountSecurity.isOwner) is only ever granted here, by an existing active Owner
 * holding a recent MFA step-up (enforced by the routes), to an administrator who is eligible at commit time:
 *  - an existing, active ADMIN other than the actor, with a verified email;
 *  - MFA enrolled AND at least one usable factor right now (a verified, enabled TOTP or an unrevoked passkey);
 *  - no pending MFA activation (a security lifecycle change in progress);
 *  - not already an Owner.
 * Every grant revokes the new Owner's refresh families and admin sessions, so the elevated capability is only exercised from a fresh
 * password + MFA sign-in. Transfer-and-delete promotes the successor and anonymizes the departing Owner in ONE transaction, so a failure
 * at any step leaves both accounts exactly as they were. Locks: owner lifecycle first, then user locks in ascending id order.
 */

export type SuccessorProblem = 'SUCCESSOR_NOT_FOUND' | 'SUCCESSOR_NOT_ELIGIBLE' | 'SUCCESSOR_INACTIVE' | 'SUCCESSOR_MFA_REQUIRED' | 'ALREADY_OWNER';

const NOT_ELIGIBLE_MESSAGE = 'This administrator is no longer eligible to become Owner. Choose another active administrator with two-step verification enabled.';
export const OWNER_STATE_CHANGED_MESSAGE = 'Administrator access changed while you were confirming. Review the current information and try again.';

const candidateSelect = (now: Date) => ({
  id: true, email: true, firstName: true, lastName: true, isActive: true, emailVerifiedAt: true,
  role: { select: { name: true } },
  adminSecurity: { select: { isOwner: true, canManageAdmins: true, mfaEnrolledAt: true } },
  _count: { select: {
    adminMfaFactors: { where: { verifiedAt: { not: null }, disabledAt: null } },
    adminWebAuthnCredentials: { where: { revokedAt: null } },
    adminMfaActivations: { where: { status: 'PENDING' as const, expiresAt: { gt: now } } },
  } },
}) satisfies Prisma.UserSelect;

type Candidate = Prisma.UserGetPayload<{ select: ReturnType<typeof candidateSelect> }>;

/** The single eligibility rule, used by the successor list and re-applied under the locks immediately before every grant. */
export function successorProblem(row: Candidate | null, actorId: string): SuccessorProblem | null {
  if (!row || row.role.name !== 'ADMIN') return 'SUCCESSOR_NOT_FOUND';
  if (row.id === actorId) return 'SUCCESSOR_NOT_ELIGIBLE';
  if (!row.isActive) return 'SUCCESSOR_INACTIVE';
  if (row.adminSecurity?.isOwner) return 'ALREADY_OWNER';
  if (!row.emailVerifiedAt) return 'SUCCESSOR_NOT_ELIGIBLE';
  if (!row.adminSecurity?.mfaEnrolledAt || row._count.adminMfaFactors + row._count.adminWebAuthnCredentials === 0) return 'SUCCESSOR_MFA_REQUIRED';
  if (row._count.adminMfaActivations > 0) return 'SUCCESSOR_NOT_ELIGIBLE';
  return null;
}

function problemError(problem: SuccessorProblem, context: 'GRANT' | 'TRANSFER') {
  if (problem === 'SUCCESSOR_NOT_FOUND') return new AppError('Administrator not found.', 404, problem);
  if (problem === 'ALREADY_OWNER') {
    // In the transfer flow the list only ever offered non-Owners: a target that became Owner meanwhile is a concurrent change.
    return context === 'GRANT' ? new AppError('This administrator is already an Owner.', 409, problem)
      : new AppError(OWNER_STATE_CHANGED_MESSAGE, 409, 'OWNER_STATE_CHANGED');
  }
  return new AppError(NOT_ELIGIBLE_MESSAGE, 409, problem);
}

const ownerRequired = () => new AppError('Your administrator account cannot perform this action.', 403, 'CAPABILITY_REQUIRED');

/** Test-only seams (never reachable over HTTP): let the disposable-PostgreSQL suite fail a transaction after its first mutation. */
export const ownershipTestHooks: {
  afterSuccessorPromoted?: (tx: Prisma.TransactionClient) => Promise<void>;
  afterOwnerRevoked?: (tx: Prisma.TransactionClient) => Promise<void>;
} = {};

async function readCandidate(tx: Prisma.TransactionClient, id: string) {
  return tx.user.findUnique({ where: { id }, select: candidateSelect(new Date()) });
}

/** Grants Owner (and the administrator-management capability it implies) and ends every existing session of the new Owner. */
async function promote(tx: Prisma.TransactionClient, targetId: string, reason: 'OWNER_GRANTED' | 'OWNER_TRANSFERRED') {
  await tx.adminAccountSecurity.update({ where: { userId: targetId }, data: { isOwner: true, canManageAdmins: true } });
  await tx.refreshToken.updateMany({ where: { userId: targetId }, data: { isRevoked: true, expiresAt: new Date(0) } });
  await revokeAdminSessions(tx, { userId: targetId }, reason);
}

/** Active Owners that can still complete an MFA sign-in. The invariant every Owner-affecting transaction must leave above zero. */
export function countEligibleOwners(tx: Prisma.TransactionClient) {
  return tx.adminAccountSecurity.count({ where: { isOwner: true, user: { isActive: true, OR: [
    { adminMfaFactors: { some: { verifiedAt: { not: null }, disabledAt: null } } },
    { adminWebAuthnCredentials: { some: { revokedAt: null } } },
  ] } } });
}

async function auditDenied(actorId: string, action: string, targetId: string, error: unknown, requestId?: string) {
  if (!(error instanceof AppError) || !error.code) return;
  // Best effort and outside the rolled-back transaction: only the stable code is kept, never a request body.
  await recordAdminAudit({ actorId, action, resourceType: 'admin_user', resourceId: targetId, outcome: 'DENIED', details: { code: error.code }, requestId })
    .catch(() => logger.warn('ADMIN_AUDIT_WRITE_FAILED', { action, outcome: 'DENIED' }));
}

function notifyNewOwner(email: string) {
  // After commit and never awaited by the response: a delivery failure is ledgered and logged, it cannot undo or misreport the grant.
  void sendOwnerGrantedEmail({ to: email }).catch(() => undefined);
}

export class AdminOwnershipService {
  async listSuccessors(actorId: string) {
    const rows = await prisma.user.findMany({
      where: { role: { name: 'ADMIN' }, isActive: true, id: { not: actorId }, adminSecurity: { isOwner: false } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }], take: 200, select: candidateSelect(new Date()),
    });
    return rows.filter(row => successorProblem(row, actorId) === null).map(row => ({
      id: row.id, firstName: row.firstName, lastName: row.lastName, email: row.email,
      canManageAdmins: Boolean(row.adminSecurity?.canManageAdmins),
      mfa: { totp: row._count.adminMfaFactors, passkeys: row._count.adminWebAuthnCredentials },
    }));
  }

  /**
   * Revokes another Owner's Owner capability while keeping the account: still an active ADMIN with the same password, MFA factors,
   * recovery codes, passkeys and history. Least privilege: `canManageAdmins` (implied by Owner) is cleared too and must be granted again
   * explicitly if wanted. Self-revocation is refused (an Owner leaves through transfer-and-delete). Under the owner-lifecycle lock and
   * the target's token lock the actor's and target's state are re-read, every target session and refresh family is revoked, the audit
   * row is written in the same transaction, and the eligible-Owner invariant is re-checked before commit.
   */
  async revokeOwner(actor: { userId: string; requestId?: string }, targetId: string) {
    try {
      if (targetId === actor.userId) {
        throw new AppError('You cannot revoke your own Owner privileges. To leave, transfer ownership when deleting your account.', 409, 'SELF_OWNER_REVOCATION_FORBIDDEN');
      }
      const revoked = await prisma.$transaction(async tx => {
        await lockOwnerLifecycle(tx);
        await lockUserTokenLifecycle(tx, targetId);
        const self = await tx.adminAccountSecurity.findFirst({ where: { userId: actor.userId, isOwner: true, user: { isActive: true } }, select: { userId: true } });
        if (!self) throw ownerRequired();
        const target = await tx.user.findUnique({ where: { id: targetId }, select: { email: true, isActive: true, role: { select: { name: true } },
          adminSecurity: { select: { isOwner: true, canManageAdmins: true } } } });
        if (!target || target.role.name !== 'ADMIN') throw new AppError('Administrator not found.', 404, 'TARGET_NOT_FOUND');
        if (!target.isActive) throw new AppError('This administrator is deactivated.', 409, 'TARGET_INACTIVE');
        if (!target.adminSecurity?.isOwner) throw new AppError('This administrator is not an Owner.', 409, 'TARGET_NOT_OWNER');
        await tx.adminAccountSecurity.update({ where: { userId: targetId }, data: { isOwner: false, canManageAdmins: false } });
        await tx.refreshToken.updateMany({ where: { userId: targetId }, data: { isRevoked: true, expiresAt: new Date(0) } });
        await revokeAdminSessions(tx, { userId: targetId }, 'OWNER_REVOKED');
        await recordAdminAudit({ actorId: actor.userId, action: 'ADMIN_OWNER_REVOKED', resourceType: 'admin_user', resourceId: targetId, outcome: 'SUCCESS',
          details: { previous: { isOwner: true, canManageAdmins: target.adminSecurity.canManageAdmins }, resulting: { isOwner: false, canManageAdmins: false } },
          requestId: actor.requestId }, tx);
        await ownershipTestHooks.afterOwnerRevoked?.(tx);
        if (await countEligibleOwners(tx) === 0) {
          throw new AppError('This is the last eligible Owner. Assign another active, MFA-enrolled administrator as Owner before revoking these privileges.', 409, 'LAST_OWNER');
        }
        return target.email;
      }, ADMIN_AUTH_TX);
      DeliveryPublisher.disconnectUser(targetId, 'LOGOUT');
      // After commit, never awaited: a delivery failure is ledgered and logged and cannot undo or misreport the revocation.
      void sendOwnerRevokedEmail({ to: revoked }).catch(() => undefined);
      return { id: targetId, isOwner: false, canManageAdmins: false, isActive: true, signInRequired: true };
    } catch (error) {
      await auditDenied(actor.userId, 'ADMIN_OWNER_REVOKED', targetId, error, actor.requestId);
      throw error;
    }
  }

  async grantOwner(actor: { userId: string; requestId?: string }, targetId: string) {
    try {
      if (targetId === actor.userId) throw problemError('ALREADY_OWNER', 'GRANT');
      const email = await prisma.$transaction(async tx => {
        await lockOwnerLifecycle(tx);
        await lockUserTokenLifecycle(tx, targetId);
        // The actor's own Owner state can only change under the owner lock just taken, so this read is authoritative.
        const self = await tx.adminAccountSecurity.findFirst({ where: { userId: actor.userId, isOwner: true, user: { isActive: true } }, select: { userId: true } });
        if (!self) throw ownerRequired();
        const row = await readCandidate(tx, targetId);
        const problem = successorProblem(row, actor.userId);
        if (problem) throw problemError(problem, 'GRANT');
        await promote(tx, targetId, 'OWNER_GRANTED');
        await recordAdminAudit({ actorId: actor.userId, action: 'ADMIN_OWNER_GRANTED', resourceType: 'admin_user', resourceId: targetId, outcome: 'SUCCESS',
          details: { via: 'PROMOTION' }, requestId: actor.requestId }, tx);
        return row!.email;
      }, ADMIN_AUTH_TX);
      DeliveryPublisher.disconnectUser(targetId, 'LOGOUT');
      notifyNewOwner(email);
      return { id: targetId, isOwner: true, canManageAdmins: true, signInRequired: true };
    } catch (error) {
      await auditDenied(actor.userId, 'ADMIN_OWNER_GRANTED', targetId, error, actor.requestId);
      throw error;
    }
  }

  /**
   * The last-Owner exit: promote the chosen successor and delete (anonymize) the calling Owner atomically. The password is verified with
   * bcrypt before the transaction and re-bound to the stored hash inside it; the successor is re-validated under its lock; the Owner
   * invariant is re-checked before commit.
   */
  async transferOwnershipAndDeleteSelf(userId: string, input: { successorId: string; currentPassword: string }, meta?: RequestMeta, requestId?: string) {
    try {
      if (input.successorId === userId) throw problemError('SUCCESSOR_NOT_ELIGIBLE', 'TRANSFER');
      const account = await prisma.user.findFirst({ where: { id: userId, isActive: true, role: { name: 'ADMIN' } }, select: { passwordHash: true } });
      if (!account) throw inactiveAdministrator();
      if (!await verifyPassword(input.currentPassword, account.passwordHash)) throw invalidCurrentPassword();
      const committed = await prisma.$transaction(async tx => {
        await lockOwnerLifecycle(tx);
        for (const id of [userId, input.successorId].sort()) await lockUserTokenLifecycle(tx, id);
        const current = await assertPasswordUnchanged(tx, userId, account.passwordHash);
        if (!current.isOwner) throw ownerRequired();
        const row = await readCandidate(tx, input.successorId);
        const problem = successorProblem(row, userId);
        if (problem) throw problemError(problem, 'TRANSFER');
        await promote(tx, input.successorId, 'OWNER_TRANSFERRED');
        await recordAdminAudit({ actorId: userId, action: 'ADMIN_OWNERSHIP_TRANSFERRED', resourceType: 'admin_user', resourceId: input.successorId,
          outcome: 'SUCCESS', details: { via: 'TRANSFER_ON_DELETE', previousOwnerId: userId }, requestId }, tx);
        await ownershipTestHooks.afterSuccessorPromoted?.(tx);
        const deletionNoticeId = await anonymizeAdministrator(tx, userId, { wasOwner: true, meta, requestId, successorId: input.successorId });
        if (await countEligibleOwners(tx) === 0) {
          throw new AppError('Ownership could not be transferred safely. Nothing was changed; try again.', 409, 'OWNERSHIP_TRANSFER_CONFLICT');
        }
        return { successorEmail: row!.email, deletionNoticeId };
      }, ADMIN_AUTH_TX);
      DeliveryPublisher.disconnectUser(userId, 'ACCOUNT_DELETED');
      DeliveryPublisher.disconnectUser(input.successorId, 'LOGOUT');
      notifyNewOwner(committed.successorEmail);
      void dispatchDeletionNotice(committed.deletionNoticeId); // the deleted Owner's original address, never the successor's
    } catch (error) {
      await auditDenied(userId, 'ADMIN_OWNERSHIP_TRANSFERRED', input.successorId, error, requestId);
      throw error;
    }
  }
}

export const adminOwnershipService = new AdminOwnershipService();
