import { AdminInvitationDelivery, AdminInvitationStatus, Prisma, type AdminInvitation } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { hashPassword } from '../utils/hash.js';
import { lockUserTokenLifecycle, revokeAdminSessions } from '../repositories/auth.repository.js';
import { recordAdminAudit } from './admin-audit.js';
import { randomToken, sha256Hex } from './admin-crypto.js';
import { sendAdminInvitationEmail } from './admin-invitation-email.js';
import { adminMfaService, INVITE_ENROLLMENT_WINDOW_MS } from './admin-mfa.service.js';
import { DeliveryPublisher } from '../sockets/delivery.publisher.js';
import { adminNotifications } from './admin-notification.service.js';

/**
 * Task 05.2 invitation-only administrator onboarding and team management. The ADMIN role is only ever assigned here, by the server,
 * to the exact email an invitation was issued for; the token is stored as a SHA-256 digest and consumed under a row lock.
 */
export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;
const unavailable = () => new AppError('This invitation is invalid, expired or has already been used. Ask an owner for a new one.', 410, 'INVITATION_UNAVAILABLE');

export const normalizeEmail = (email: string) => email.toLowerCase().trim();

type InvitationWithInviter = AdminInvitation & { invitedBy: { firstName: string; lastName: string } | null };

function invitationDto(row: InvitationWithInviter, now = new Date()) {
  const status = row.status === AdminInvitationStatus.PENDING && row.expiresAt <= now ? 'EXPIRED' : row.status;
  return {
    id: row.id, email: row.email, status, deliveryStatus: row.deliveryStatus, grantManageAdmins: row.grantManageAdmins,
    expiresAt: row.expiresAt, createdAt: row.createdAt, lastSentAt: row.lastSentAt, sendCount: row.sendCount,
    acceptedAt: row.acceptedAt, revokedAt: row.revokedAt,
    invitedBy: row.invitedBy ? { name: `${row.invitedBy.firstName} ${row.invitedBy.lastName}`.trim() } : null,
  };
}

interface Actor { userId: string; requestId?: string }

export class AdminTeamService {
  async listAdministrators(input: { page: number; pageSize: number; search?: string; actorId?: string }) {
    const where: Prisma.UserWhereInput = { role: { name: 'ADMIN' }, ...(input.search ? { OR: [
      { email: { contains: input.search, mode: 'insensitive' } }, { firstName: { contains: input.search, mode: 'insensitive' } },
      { lastName: { contains: input.search, mode: 'insensitive' } }] } : {}) };
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: (input.page - 1) * input.pageSize, take: input.pageSize,
        select: { id: true, email: true, firstName: true, lastName: true, isActive: true, createdAt: true,
          adminSecurity: { select: { isOwner: true, canManageAdmins: true, mfaEnrolledAt: true } } } }),
    ]);
    const ids = users.map(user => user.id);
    const [totp, passkeys, logins] = ids.length === 0 ? [[], [], []] : await Promise.all([
      prisma.adminMfaFactor.groupBy({ by: ['userId'], where: { userId: { in: ids }, verifiedAt: { not: null }, disabledAt: null }, _count: { _all: true } }),
      prisma.adminWebAuthnCredential.groupBy({ by: ['userId'], where: { userId: { in: ids }, revokedAt: null }, _count: { _all: true } }),
      prisma.securityEvent.groupBy({ by: ['userId'], where: { userId: { in: ids }, type: 'LOGIN_SUCCESS' }, _max: { createdAt: true } }),
    ]);
    const count = (rows: { userId: string | null; _count: { _all: number } }[], id: string) => rows.find(row => row.userId === id)?._count._all ?? 0;
    return {
      data: users.map(user => ({
        id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, isActive: user.isActive, createdAt: user.createdAt,
        isSelf: user.id === input.actorId,
        isOwner: user.adminSecurity?.isOwner ?? false, canManageAdmins: user.adminSecurity?.canManageAdmins ?? false,
        mfaEnrolled: count(totp, user.id) + count(passkeys, user.id) > 0,
        lastLoginAt: logins.find(row => row.userId === user.id)?._max.createdAt ?? null,
      })),
      meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) },
    };
  }

  async listInvitations(input: { page: number; pageSize: number; status?: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED' }) {
    const now = new Date();
    const where: Prisma.AdminInvitationWhereInput = input.status === 'EXPIRED' ? { status: 'PENDING', expiresAt: { lte: now } }
      : input.status === 'PENDING' ? { status: 'PENDING', expiresAt: { gt: now } } : input.status ? { status: input.status } : {};
    const [total, rows] = await Promise.all([
      prisma.adminInvitation.count({ where }),
      prisma.adminInvitation.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (input.page - 1) * input.pageSize, take: input.pageSize,
        include: { invitedBy: { select: { firstName: true, lastName: true } } } }),
    ]);
    return { data: rows.map(row => invitationDto(row, now)), meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) } };
  }

  private async deliver(invitationId: string, to: string, token: string, inviterId: string, expiresAt: Date) {
    const inviter = await prisma.user.findUnique({ where: { id: inviterId }, select: { firstName: true, lastName: true } });
    const sent = await sendAdminInvitationEmail({ to, token, expiresAt, inviterName: inviter ? `${inviter.firstName} ${inviter.lastName}`.trim() : null });
    const updated = await prisma.adminInvitation.update({ where: { id: invitationId },
      data: { deliveryStatus: sent ? AdminInvitationDelivery.SENT : AdminInvitationDelivery.FAILED, lastSentAt: new Date(), sendCount: { increment: 1 } },
      include: { invitedBy: { select: { firstName: true, lastName: true } } } });
    return invitationDto(updated);
  }

  async createInvitation(actor: Actor, input: { email: string; grantManageAdmins: boolean }) {
    const email = normalizeEmail(input.email);
    const token = randomToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const invitation = await prisma.$transaction(async tx => {
      const actorSecurity = await tx.adminAccountSecurity.findUnique({ where: { userId: actor.userId }, select: { isOwner: true } });
      if (input.grantManageAdmins && !actorSecurity?.isOwner) {
        throw new AppError('Only an owner can grant administrator-management access.', 403, 'CAPABILITY_REQUIRED');
      }
      if (await tx.user.findFirst({ where: { OR: [{ email }, { pendingEmail: email }] }, select: { id: true } })) {
        throw new AppError('An account already exists for this email address.', 409, 'ACCOUNT_EXISTS');
      }
      const pending = await tx.adminInvitation.findFirst({ where: { email, status: AdminInvitationStatus.PENDING } });
      if (pending && pending.expiresAt > new Date()) {
        throw new AppError('An invitation is already pending for this email. Resend it instead.', 409, 'INVITATION_EXISTS');
      }
      // An expired pending invitation is closed (kept as history) so the one-pending-per-email index admits the new one.
      if (pending) await tx.adminInvitation.update({ where: { id: pending.id }, data: { status: AdminInvitationStatus.REVOKED, revokedAt: new Date() } });
      const created = await tx.adminInvitation.create({ data: { email, tokenHash: sha256Hex(token), invitedById: actor.userId, expiresAt,
        grantManageAdmins: input.grantManageAdmins } });
      await recordAdminAudit({ actorId: actor.userId, action: 'ADMIN_INVITATION_CREATED', resourceType: 'admin_invitation', resourceId: created.id,
        outcome: 'SUCCESS', details: { grantManageAdmins: input.grantManageAdmins }, requestId: actor.requestId }, tx);
      return created;
    }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError('An invitation is already pending for this email. Resend it instead.', 409, 'INVITATION_EXISTS');
      }
      throw error;
    });
    // Provider call outside the transaction; a failed send is recorded as FAILED and can be resent — no privilege is created by it.
    return this.deliver(invitation.id, email, token, actor.userId, expiresAt);
  }

  async resendInvitation(actor: Actor, id: string) {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const invitation = await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: string; status: AdminInvitationStatus; lastSentAt: Date | null; email: string }[]>`
        SELECT "id", "status", "lastSentAt", "email" FROM "admin_invitations" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new AppError('Invitation not found.', 404, 'NOT_FOUND');
      if (row.status !== AdminInvitationStatus.PENDING) throw new AppError('Only a pending invitation can be resent.', 409, 'INVITATION_NOT_PENDING');
      if (row.lastSentAt && Date.now() - row.lastSentAt.getTime() < RESEND_COOLDOWN_MS) {
        throw new AppError('This invitation was sent moments ago. Wait a minute before resending.', 429, 'RESEND_COOLDOWN');
      }
      // The replacement token invalidates the previous link atomically.
      await tx.adminInvitation.update({ where: { id }, data: { tokenHash: sha256Hex(token), expiresAt, deliveryStatus: AdminInvitationDelivery.PENDING } });
      await recordAdminAudit({ actorId: actor.userId, action: 'ADMIN_INVITATION_RESENT', resourceType: 'admin_invitation', resourceId: id, outcome: 'SUCCESS',
        requestId: actor.requestId }, tx);
      return row;
    });
    return this.deliver(invitation.id, invitation.email, token, actor.userId, expiresAt);
  }

  async revokeInvitation(actor: Actor, id: string) {
    return prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ status: AdminInvitationStatus }[]>`SELECT "status" FROM "admin_invitations" WHERE "id" = ${id}::uuid FOR UPDATE`;
      if (!rows[0]) throw new AppError('Invitation not found.', 404, 'NOT_FOUND');
      if (rows[0].status === AdminInvitationStatus.ACCEPTED) throw new AppError('An accepted invitation cannot be revoked.', 409, 'INVITATION_ACCEPTED');
      if (rows[0].status === AdminInvitationStatus.PENDING) {
        await tx.adminInvitation.update({ where: { id }, data: { status: AdminInvitationStatus.REVOKED, revokedAt: new Date() } });
        await recordAdminAudit({ actorId: actor.userId, action: 'ADMIN_INVITATION_REVOKED', resourceType: 'admin_invitation', resourceId: id,
          outcome: 'SUCCESS', requestId: actor.requestId }, tx);
      }
      const row = await tx.adminInvitation.findUniqueOrThrow({ where: { id }, include: { invitedBy: { select: { firstName: true, lastName: true } } } });
      return invitationDto(row);
    });
  }

  // ── Public, token-bound ──────────────────────────────────────────────────
  async previewInvitation(token: string) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw unavailable();
    const invitation = await prisma.adminInvitation.findUnique({ where: { tokenHash: sha256Hex(token) }, select: { email: true, status: true, expiresAt: true } });
    if (!invitation || invitation.status !== AdminInvitationStatus.PENDING || invitation.expiresAt <= new Date()) throw unavailable();
    return { email: invitation.email, expiresAt: invitation.expiresAt };
  }

  async acceptInvitation(input: { token: string; firstName: string; lastName: string; password: string }) {
    if (typeof input.token !== 'string' || input.token.length < 20 || input.token.length > 200) throw unavailable();
    const passwordHash = await hashPassword(input.password); // bcrypt outside the transaction
    const tokenHash = sha256Hex(input.token);
    const { created: user, invitedById } = await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: string; email: string; status: AdminInvitationStatus; expiresAt: Date; grantManageAdmins: boolean; invitedById: string | null }[]>`
        SELECT "id", "email", "status", "expiresAt", "grantManageAdmins", "invitedById" FROM "admin_invitations" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
      const invitation = rows[0];
      if (!invitation || invitation.status !== AdminInvitationStatus.PENDING || invitation.expiresAt <= new Date()) throw unavailable();
      if (await tx.user.findFirst({ where: { OR: [{ email: invitation.email }, { pendingEmail: invitation.email }] }, select: { id: true } })) {
        throw new AppError('An account already exists for this email address. Ask an owner for help.', 409, 'ACCOUNT_EXISTS');
      }
      const role = await tx.role.findUnique({ where: { name: 'ADMIN' }, select: { id: true } });
      if (!role) throw new AppError('Administrator onboarding is unavailable.', 503, 'ONBOARDING_UNAVAILABLE');
      const now = new Date();
      // Possession of the emailed single-use token proves ownership of the invitation address (plan decision 9).
      const created = await tx.user.create({ data: { email: invitation.email, passwordHash, firstName: input.firstName.trim(), lastName: input.lastName.trim(),
        roleId: role.id, emailVerifiedAt: now }, include: { role: true } });
      await tx.adminAccountSecurity.create({ data: { userId: created.id, canManageAdmins: invitation.grantManageAdmins,
        enrollmentAllowedUntil: new Date(now.getTime() + INVITE_ENROLLMENT_WINDOW_MS) } });
      await tx.adminInvitation.update({ where: { id: invitation.id }, data: { status: AdminInvitationStatus.ACCEPTED, acceptedAt: now, acceptedUserId: created.id } });
      await recordAdminAudit({ actorId: created.id, action: 'ADMIN_INVITATION_ACCEPTED', resourceType: 'admin_invitation', resourceId: invitation.id,
        outcome: 'SUCCESS', details: { invitedById: invitation.invitedById } }, tx);
      return { created, invitedById: invitation.invitedById };
    });
    // After commit, fire-and-forget; governed by the inviter's "invitation accepted" preference.
    adminNotifications.notifyInvitationAccepted(invitedById);
    // No session yet: the new administrator continues straight into mandatory first-factor enrollment.
    return adminMfaService.startLogin(user);
  }

  async setAccess(actor: Actor, targetId: string, input: { isActive?: boolean; canManageAdmins?: boolean }) {
    if (targetId === actor.userId) throw new AppError('You cannot change your own access.', 409, 'SELF_CHANGE');
    const result = await prisma.$transaction(async tx => {
      await lockUserTokenLifecycle(tx, targetId);
      const target = await tx.user.findFirst({ where: { id: targetId, role: { name: 'ADMIN' } },
        select: { id: true, isActive: true, adminSecurity: { select: { isOwner: true, canManageAdmins: true } } } });
      if (!target) throw new AppError('Administrator not found.', 404, 'NOT_FOUND');
      if (input.isActive === false && target.adminSecurity?.isOwner) {
        const activeOwners = await tx.adminAccountSecurity.count({ where: { isOwner: true, user: { isActive: true } } });
        if (activeOwners <= 1) throw new AppError('The last active owner cannot be deactivated.', 409, 'LAST_OWNER');
      }
      if (input.canManageAdmins !== undefined) {
        await tx.adminAccountSecurity.upsert({ where: { userId: targetId }, create: { userId: targetId, canManageAdmins: input.canManageAdmins },
          update: { canManageAdmins: input.canManageAdmins } });
      }
      if (input.isActive !== undefined && input.isActive !== target.isActive) {
        await tx.user.update({ where: { id: targetId }, data: { isActive: input.isActive } });
        if (!input.isActive) {
          await tx.refreshToken.updateMany({ where: { userId: targetId }, data: { isRevoked: true, expiresAt: new Date(0) } });
          await revokeAdminSessions(tx, { userId: targetId }, 'DEACTIVATED');
        }
      }
      await recordAdminAudit({ actorId: actor.userId, action: 'ADMIN_ACCESS_CHANGED', resourceType: 'admin_user', resourceId: targetId, outcome: 'SUCCESS',
        details: { isActive: input.isActive ?? null, canManageAdmins: input.canManageAdmins ?? null }, requestId: actor.requestId }, tx);
      return tx.user.findUniqueOrThrow({ where: { id: targetId }, select: { id: true, isActive: true, adminSecurity: { select: { isOwner: true, canManageAdmins: true } } } });
    });
    if (input.isActive === false) DeliveryPublisher.disconnectUser(targetId, 'LOGOUT');
    return { id: result.id, isActive: result.isActive, isOwner: result.adminSecurity?.isOwner ?? false, canManageAdmins: result.adminSecurity?.canManageAdmins ?? false };
  }
}

export const adminTeamService = new AdminTeamService();
