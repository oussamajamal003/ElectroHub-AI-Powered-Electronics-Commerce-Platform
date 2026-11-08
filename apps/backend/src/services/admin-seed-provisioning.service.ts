import { AdminActivationPurpose, AdminActivationStatus, AdminInvitationDelivery, Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { prisma } from '../lib/prisma.js';
import { ADMIN_AUTH_TX } from '../lib/transaction-options.js';
import { lockUserTokenLifecycle } from '../repositories/auth.repository.js';
import { PROVISIONABLE_SEED_EMAILS } from '../utils/admin-seed.js';
import { recordAdminAudit } from './admin-audit.js';
import { randomToken, sha256Hex } from './admin-crypto.js';
import { adminMfaService } from './admin-mfa.service.js';

/**
 * Task 05.2 operator provisioning of SEEDED development administrators that have no deliverable mailbox (admin1–4@electrohub.com).
 *
 * Trust model (deliberately different from Owner activation): an operator explicitly approves one exact seed identity on one exact,
 * allowed database and hands a one-time proof to a named tester out of band. This proves operator authorization, NOT mailbox control:
 * emailVerifiedAt is never touched. Redeeming the proof (admin-activation.service, purpose SEED_PROVISIONING) rotates the password,
 * revokes every old session/refresh family/challenge and opens only the restricted first-factor enrollment; a full ADMIN session still
 * requires a verified authenticator. Owner and management capabilities are never changed. Operator CLI only, never HTTP.
 */
export const SHARED_DEV_REF = 'pzxekjybdiulzmssalfo';
export const PRODUCTION_REF = 'yepfgjehdstlxbpespun';
/** Databases this procedure may ever touch: a loopback (disposable) cluster and the shared DEV project. Everything else is refused. */
export const PROVISIONING_TARGETS = ['local', SHARED_DEV_REF] as const;
export const SEED_PROVISIONING_TTL_MINUTES = 30;
export const SEED_PROVISIONING_MAX_TTL_MINUTES = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DELETED_EMAIL = /^deleted-admin-.+@deleted\.invalid$/;

/** One-time setup link (token in the URL fragment, which browsers never send in requests or referrers). */
export function provisioningLink(token: string): string {
  return `${(env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')}/admin/provision#token=${encodeURIComponent(token)}`;
}

export class SeedProvisioningError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SeedProvisioningError';
  }
}
const refuse = (code: string, message: string) => new SeedProvisioningError(code, message);

/** Database identity derived from the connection URL itself (never from a separate, spoofable setting). */
export function databaseIdentity(url: string | undefined): string {
  if (!url) return 'unknown';
  let parsed: URL;
  try { parsed = new URL(url); } catch { return 'unknown'; }
  if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)) return 'local';
  const fromUser = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(parsed.username))?.[1];
  const fromHost = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname)?.[1];
  // A pooler URL whose user names one project and whose host names another is ambiguous: fail closed.
  if (fromUser && fromHost && fromUser !== fromHost) return 'unknown';
  return fromUser ?? fromHost ?? 'unknown';
}

/** Environment gate, checked before ANY database access (nothing is written, not even an audit row, on a refused target). */
export function assertProvisioningTarget(input: { resolved: string; confirmed: string | undefined; nodeEnv: string | undefined }) {
  if (input.nodeEnv === 'production') throw refuse('PRODUCTION_REFUSED', 'Seed provisioning never runs with NODE_ENV=production.');
  if (input.resolved === PRODUCTION_REF) throw refuse('PRODUCTION_REFUSED', 'This is the production database. Seed provisioning is refused.');
  if (!(PROVISIONING_TARGETS as readonly string[]).includes(input.resolved)) {
    throw refuse('TARGET_NOT_ALLOWED', `Database identity "${input.resolved}" is not an approved provisioning target.`);
  }
  if (input.confirmed !== input.resolved) {
    throw refuse('TARGET_CONFIRMATION_MISMATCH', `Pass --confirm-target=${input.resolved} to confirm the exact database.`);
  }
}

export interface OperatorApproval { operator: string; reason: string }
function assertApproval(approval: Partial<OperatorApproval> & { tester?: string }, needsTester: boolean) {
  const operator = approval.operator?.trim() ?? '';
  const reason = approval.reason?.trim() ?? '';
  if (operator.length < 2 || operator.length > 120) throw refuse('APPROVAL_REQUIRED', 'An operator name (--operator) is required.');
  if (reason.length < 10 || reason.length > 500) throw refuse('APPROVAL_REQUIRED', 'An authorization reason of at least 10 characters (--reason) is required.');
  if (needsTester) {
    const tester = approval.tester?.trim() ?? '';
    if (tester.length < 2 || tester.length > 120) throw refuse('APPROVAL_REQUIRED', 'The person who will control the account (--tester) is required.');
  }
}

interface Target { databaseIdentity: string; email: string; userId: string }

/** The exact user must be an active, non-deleted, non-Owner ADMIN whose current email is one of the provisionable seed emails. */
async function eligibleSeedUser(tx: Prisma.TransactionClient, target: Target) {
  const email = target.email.trim().toLowerCase();
  if (email === 'admin@electrohub.com') throw refuse('PRIMARY_OWNER_REFUSED', 'The primary Owner seed account is never provisioned this way.');
  if (!PROVISIONABLE_SEED_EMAILS.includes(email)) throw refuse('NOT_SEED_EMAIL', 'Only the approved seed administrator emails can be provisioned.');
  if (!UUID.test(target.userId)) throw refuse('USER_ID_REQUIRED', 'Pass the exact administrator id (--user-id) from the status listing.');
  await lockUserTokenLifecycle(tx, target.userId);
  const user = await tx.user.findUnique({ where: { id: target.userId }, select: { id: true, email: true, isActive: true, role: { select: { name: true } },
    adminSecurity: { select: { isOwner: true, canManageAdmins: true } }, adminSeedIdentity: { select: { seedEmail: true } } } });
  if (!user) throw refuse('USER_NOT_FOUND', 'No user has that id.');
  if (DELETED_EMAIL.test(user.email)) throw refuse('ACCOUNT_DELETED', 'That account was deleted. Deleted identities are never restored.');
  if (user.role.name !== 'ADMIN') throw refuse('NOT_ADMIN', 'That account is not an administrator.');
  if (user.email !== email) throw refuse('IDENTITY_MISMATCH', 'The id and email do not belong to the same account.');
  if (!user.isActive) throw refuse('ACCOUNT_INACTIVE', 'That administrator is deactivated. Deactivation is never bypassed.');
  if (user.adminSecurity?.isOwner) throw refuse('OWNER_REFUSED', 'Owner accounts are never provisioned this way.');
  return user;
}

const denied = (action: string, target: Partial<Target>, approval: Partial<OperatorApproval>, error: unknown) =>
  recordAdminAudit({ actorId: null, action, resourceType: 'admin_user', resourceId: target.userId && UUID.test(target.userId) ? target.userId : null, outcome: 'DENIED',
    details: { code: error instanceof SeedProvisioningError ? error.code : 'FAILED', databaseIdentity: target.databaseIdentity ?? null,
      operator: approval.operator?.trim().slice(0, 120) ?? null } }).catch(() => undefined);

/**
 * Records an EXISTING account as an approved seed identity (accounts seeded before provenance existed, or one recreated after the
 * original was deleted). The operator names the exact id; a live holder of the same seed email is never displaced.
 */
export async function registerSeedIdentity(target: Target, approval: OperatorApproval & { supersedeDeleted?: boolean }) {
  try {
    assertApproval(approval, false);
    return await prisma.$transaction(async tx => {
      const user = await eligibleSeedUser(tx, target);
      if (user.adminSeedIdentity) {
        if (user.adminSeedIdentity.seedEmail === user.email) throw refuse('ALREADY_REGISTERED', 'That account is already an approved seed identity.');
        throw refuse('PROVENANCE_CONFLICT', 'That account is recorded for a different seed email.');
      }
      const holder = await tx.adminSeedIdentity.findUnique({ where: { seedEmail: user.email }, select: { userId: true, user: { select: { email: true } } } });
      if (holder) {
        const holderDeleted = DELETED_EMAIL.test(holder.user.email);
        if (!holderDeleted) throw refuse('PROVENANCE_CONFLICT', 'Another live account already holds this seed identity.');
        if (!approval.supersedeDeleted) throw refuse('SUPERSEDE_REQUIRED', 'The original seed account was deleted. Pass --supersede-deleted to approve this replacement explicitly.');
        await tx.adminSeedIdentity.delete({ where: { userId: holder.userId } });
      }
      await tx.adminSeedIdentity.create({ data: { userId: user.id, seedEmail: user.email, source: 'OPERATOR', approvedBy: approval.operator.trim(), reason: approval.reason.trim() } });
      await recordAdminAudit({ actorId: null, action: 'ADMIN_SEED_IDENTITY_REGISTERED', resourceType: 'admin_user', resourceId: user.id, outcome: 'SUCCESS',
        details: { databaseIdentity: target.databaseIdentity, operator: approval.operator.trim(), reason: approval.reason.trim(), supersededDeleted: Boolean(holder) } }, tx);
      return { userId: user.id, email: user.email };
    }, ADMIN_AUTH_TX);
  } catch (error) {
    await denied('ADMIN_SEED_IDENTITY_REGISTERED', target, approval, error);
    throw error;
  }
}

/**
 * Issues a single-use, short-lived provisioning proof for one approved seed identity. Returns the raw token ONCE (the CLI writes it to
 * an access-controlled handoff file); only its SHA-256 digest is stored. Grants no session and changes no credential by itself.
 */
export async function authorizeSeedProvisioning(target: Target, approval: OperatorApproval & { tester: string; minutes?: number }) {
  try {
    assertApproval(approval, true);
    const minutes = Math.min(SEED_PROVISIONING_MAX_TTL_MINUTES, Math.max(5, Math.floor(approval.minutes ?? SEED_PROVISIONING_TTL_MINUTES)));
    const token = randomToken();
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    const created = await prisma.$transaction(async tx => {
      const user = await eligibleSeedUser(tx, target);
      if (!user.adminSeedIdentity || user.adminSeedIdentity.seedEmail !== user.email) {
        throw refuse('PROVENANCE_MISSING', 'That account is not a recorded seed identity. An operator must register it explicitly (register-seed-identity).');
      }
      const factors = await adminMfaService.factorSummary(user.id, tx);
      if (factors.totp + factors.passkeys > 0) throw refuse('ALREADY_ENROLLED', 'That administrator already has a factor. Provisioning is only for first-time setup.');
      const pending = await tx.adminMfaActivation.findFirst({ where: { userId: user.id, status: AdminActivationStatus.PENDING } });
      if (pending && pending.expiresAt > new Date()) throw refuse('PENDING_EXISTS', 'An activation or provisioning proof is already pending. Revoke it first.');
      if (pending) await tx.adminMfaActivation.update({ where: { id: pending.id }, data: { status: AdminActivationStatus.REVOKED, revokedAt: new Date() } });
      const row = await tx.adminMfaActivation.create({ data: { userId: user.id, authorizedById: null, email: user.email, tokenHash: sha256Hex(token), expiresAt,
        purpose: AdminActivationPurpose.SEED_PROVISIONING, operatorName: approval.operator.trim(), operatorReason: approval.reason.trim(),
        deliveryStatus: AdminInvitationDelivery.SENT, lastSentAt: new Date(), sendCount: 1 } });
      await recordAdminAudit({ actorId: null, action: 'ADMIN_SEED_PROVISIONING_AUTHORIZED', resourceType: 'admin_user', resourceId: user.id, outcome: 'SUCCESS',
        details: { databaseIdentity: target.databaseIdentity, operator: approval.operator.trim(), tester: approval.tester.trim(), reason: approval.reason.trim(),
          provisioningId: row.id, expiresAt: expiresAt.toISOString() } }, tx);
      return row;
    }, ADMIN_AUTH_TX).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw refuse('PENDING_EXISTS', 'An activation or provisioning proof is already pending.');
      throw error;
    });
    return { token, expiresAt, provisioningId: created.id };
  } catch (error) {
    await denied('ADMIN_SEED_PROVISIONING_AUTHORIZED', target, approval, error);
    throw error;
  }
}

/** One-time forgot-password link carrying the operator recovery proof (fragment only: never sent to servers or referrers). */
export function passwordRecoveryLink(token: string): string {
  return `${(env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')}/admin/forgot-password#seed-recovery=${encodeURIComponent(token)}`;
}

/**
 * Issues a single-use, short-lived proof that replaces ONLY the email-OTP step of admin forgot-password for an approved seed identity that
 * HAS an enrolled factor. Redeeming it opens the ordinary PASSWORD_RECOVERY transaction; the existing factor (TOTP / recovery code /
 * passkey) is still required before any reset authorization exists. Never resets factors, never sets emailVerifiedAt, grants no session.
 */
export async function authorizeSeedPasswordRecovery(target: Target, approval: OperatorApproval & { tester: string; minutes?: number }) {
  try {
    assertApproval(approval, true);
    const minutes = Math.min(SEED_PROVISIONING_MAX_TTL_MINUTES, Math.max(5, Math.floor(approval.minutes ?? SEED_PROVISIONING_TTL_MINUTES)));
    const token = randomToken();
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    const created = await prisma.$transaction(async tx => {
      const user = await eligibleSeedUser(tx, target);
      if (!user.adminSeedIdentity || user.adminSeedIdentity.seedEmail !== user.email) {
        throw refuse('PROVENANCE_MISSING', 'That account is not a recorded seed identity. An operator must register it explicitly (register-seed-identity).');
      }
      const factors = await adminMfaService.factorSummary(user.id, tx);
      if (factors.totp + factors.passkeys + factors.recoveryCodes === 0) {
        throw refuse('NOT_ENROLLED', 'That administrator has no enrolled factor. Use provision-seeded-admin for first-time setup.');
      }
      const pending = await tx.adminMfaActivation.findFirst({ where: { userId: user.id, status: AdminActivationStatus.PENDING } });
      if (pending && pending.expiresAt > new Date()) throw refuse('PENDING_EXISTS', 'An activation or operator proof is already pending. Revoke it first.');
      if (pending) await tx.adminMfaActivation.update({ where: { id: pending.id }, data: { status: AdminActivationStatus.REVOKED, revokedAt: new Date() } });
      const row = await tx.adminMfaActivation.create({ data: { userId: user.id, authorizedById: null, email: user.email, tokenHash: sha256Hex(token), expiresAt,
        purpose: AdminActivationPurpose.SEED_PASSWORD_RECOVERY, operatorName: approval.operator.trim(), operatorReason: approval.reason.trim(),
        deliveryStatus: AdminInvitationDelivery.SENT, lastSentAt: new Date(), sendCount: 1 } });
      await recordAdminAudit({ actorId: null, action: 'ADMIN_SEED_PASSWORD_RECOVERY_AUTHORIZED', resourceType: 'admin_user', resourceId: user.id, outcome: 'SUCCESS',
        details: { databaseIdentity: target.databaseIdentity, operator: approval.operator.trim(), tester: approval.tester.trim(), reason: approval.reason.trim(),
          recoveryProofId: row.id, expiresAt: expiresAt.toISOString() } }, tx);
      return row;
    }, ADMIN_AUTH_TX).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw refuse('PENDING_EXISTS', 'An activation or operator proof is already pending.');
      throw error;
    });
    return { token, expiresAt, recoveryProofId: created.id };
  } catch (error) {
    await denied('ADMIN_SEED_PASSWORD_RECOVERY_AUTHORIZED', target, approval, error);
    throw error;
  }
}

/** Revokes a pending provisioning proof and closes any enrollment window a half-finished redemption opened. */
export async function revokeSeedProvisioning(target: Target, approval: OperatorApproval, kind: 'PROVISIONING' | 'PASSWORD_RECOVERY' = 'PROVISIONING') {
  const purpose = kind === 'PROVISIONING' ? 'SEED_PROVISIONING' : 'SEED_PASSWORD_RECOVERY';
  const action = kind === 'PROVISIONING' ? 'ADMIN_SEED_PROVISIONING_REVOKED' : 'ADMIN_SEED_PASSWORD_RECOVERY_REVOKED';
  try {
    assertApproval(approval, false);
    return await prisma.$transaction(async tx => {
      if (!UUID.test(target.userId)) throw refuse('USER_ID_REQUIRED', 'Pass the exact administrator id (--user-id).');
      await lockUserTokenLifecycle(tx, target.userId);
      const user = await tx.user.findUnique({ where: { id: target.userId }, select: { email: true } });
      if (!user || user.email !== target.email.trim().toLowerCase()) throw refuse('IDENTITY_MISMATCH', 'The id and email do not belong to the same account.');
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "admin_mfa_activations" WHERE "userId" = ${target.userId}::uuid
        AND "status" = 'PENDING' AND "purpose" = ${purpose}::"AdminActivationPurpose" FOR UPDATE`;
      if (!rows[0]) throw refuse('NOT_PENDING', 'No such operator proof is pending for that administrator.');
      await tx.adminMfaActivation.update({ where: { id: rows[0].id }, data: { status: AdminActivationStatus.REVOKED, revokedAt: new Date() } });
      if (kind === 'PROVISIONING') await tx.adminAccountSecurity.updateMany({ where: { userId: target.userId, mfaEnrolledAt: null }, data: { enrollmentAllowedUntil: null } });
      await recordAdminAudit({ actorId: null, action, resourceType: 'admin_user', resourceId: target.userId, outcome: 'SUCCESS',
        details: { databaseIdentity: target.databaseIdentity, operator: approval.operator.trim(), reason: approval.reason.trim(), provisioningId: rows[0].id } }, tx);
      return { provisioningId: rows[0].id };
    }, ADMIN_AUTH_TX);
  } catch (error) {
    await denied(action, target, approval, error);
    throw error;
  }
}

/** Read-only overview for the operator: the seed accounts, their ids and states. Never returns hashes, tokens or secrets. */
export async function seedIdentityStatus() {
  const users = await prisma.user.findMany({ where: { email: { in: ['admin@electrohub.com', ...PROVISIONABLE_SEED_EMAILS] } }, orderBy: { email: 'asc' },
    select: { id: true, email: true, isActive: true, role: { select: { name: true } }, adminSecurity: { select: { isOwner: true, canManageAdmins: true, mfaEnrolledAt: true } },
      adminSeedIdentity: { select: { source: true } } } });
  return Promise.all(users.map(async user => {
    const factors = await adminMfaService.factorSummary(user.id);
    return { email: user.email, userId: user.id, role: user.role.name, active: user.isActive, owner: user.adminSecurity?.isOwner ?? false,
      managesAdmins: user.adminSecurity?.canManageAdmins ?? false, factors: factors.totp + factors.passkeys, provenance: user.adminSeedIdentity?.source ?? 'NONE' };
  }));
}

/**
 * Redeems an operator recovery proof in place of the emailed OTP: in one transaction the proof is locked, re-checked against the live
 * account (still the approved seed identity, active, non-Owner ADMIN, same email, still has a factor), marked REDEEMED and converted into
 * the ordinary PASSWORD_RECOVERY transaction. The caller must still prove an existing factor before a reset authorization exists.
 * Refusals are uniform to the client and audited (code only, never the token or its hash).
 */
export async function redeemSeedPasswordRecoveryProof(token: string) {
  const unavailable = () => new AppError('This recovery link is invalid, expired or has already been used. Ask the operator who issued it for a new one.', 410,
    'SEED_RECOVERY_UNAVAILABLE');
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw unavailable();
  const tokenHash = sha256Hex(token);
  let refusal: { code: string; userId: string; proofId: string } | null = null;
  try {
    return await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: string; userId: string; email: string; status: AdminActivationStatus; expiresAt: Date; purpose: AdminActivationPurpose }[]>`
        SELECT "id", "userId", "email", "status", "expiresAt", "purpose" FROM "admin_mfa_activations" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
      const row = rows[0];
      if (!row || row.purpose !== AdminActivationPurpose.SEED_PASSWORD_RECOVERY) throw unavailable();
      const fail = (code: string) => { refusal = { code, userId: row.userId, proofId: row.id }; return unavailable(); };
      if (row.status !== AdminActivationStatus.PENDING) throw fail(row.status === AdminActivationStatus.REDEEMED ? 'ALREADY_USED' : 'REVOKED');
      if (row.expiresAt <= new Date()) throw fail('EXPIRED');
      await lockUserTokenLifecycle(tx, row.userId);
      const user = await tx.user.findUnique({ where: { id: row.userId }, include: { role: true,
        adminSecurity: { select: { isOwner: true } }, adminSeedIdentity: { select: { seedEmail: true } } } });
      if (!user || !user.isActive || user.role.name !== 'ADMIN' || user.email !== row.email || DELETED_EMAIL.test(user.email)) throw fail('ACCOUNT_INELIGIBLE');
      if (user.adminSecurity?.isOwner || user.adminSeedIdentity?.seedEmail !== user.email) throw fail('NOT_SEED_IDENTITY');
      const factors = await adminMfaService.factorSummary(user.id, tx);
      if (factors.totp + factors.passkeys + factors.recoveryCodes === 0) throw fail('NOT_ENROLLED');
      await tx.adminMfaActivation.update({ where: { id: row.id }, data: { status: AdminActivationStatus.REDEEMED, redeemedAt: new Date() } });
      await recordAdminAudit({ actorId: null, action: 'ADMIN_SEED_PASSWORD_RECOVERY_REDEEMED', resourceType: 'admin_user', resourceId: user.id, outcome: 'SUCCESS',
        details: { recoveryProofId: row.id } }, tx);
      // Same transaction the emailed OTP would open: factor proof still mandatory; email is never marked verified.
      return adminMfaService.openPasswordRecovery(tx, user);
    }, ADMIN_AUTH_TX);
  } catch (error) {
    const r = refusal as { code: string; userId: string; proofId: string } | null;
    if (r) {
      await recordAdminAudit({ actorId: null, action: 'ADMIN_SEED_PASSWORD_RECOVERY_REDEEMED', resourceType: 'admin_user', resourceId: r.userId, outcome: 'DENIED',
        details: { code: r.code, recoveryProofId: r.proofId } }).catch(() => undefined);
    }
    throw error;
  }
}
