import { prisma } from '../lib/prisma.js';
import crypto from 'crypto';
import { Prisma, User, Role, RefreshToken, SecurityEventType, OtpPurpose, AdminMfaMethod } from '@prisma/client';

/**
 * Serializes every operation that changes a user's refresh-token lifecycle (session issuance, rotation,
 * logout, password change/reset, global revocation). Fixed acquisition order for every such transaction:
 *   1. the per-user advisory lock, then
 *   2. a shared row lock on the user's row (FOR SHARE), then
 *   3. refresh_tokens rows.
 * The row lock makes issuance and rotation wait for a concurrent account deactivation/deletion, which holds
 * the same row FOR UPDATE and deletes tokens before committing, and it keeps rotation's token-to-user
 * foreign-key check from deadlocking against that deletion. Both locks are released at commit or rollback.
 */
export async function lockUserTokenLifecycle(transaction: Prisma.TransactionClient, userId: string): Promise<void> {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('user_token_lifecycle'), hashtext(${userId}))`;
  await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR SHARE`;
}

/**
 * The security-relevant account state an authentication proof was based on. A session may only be issued
 * while the committed account still matches it.
 */
export type SessionAuthorizationSnapshot = Pick<User, 'id' | 'passwordHash' | 'isActive' | 'roleId'>;

/** Task 05.2: the verified second factor an administrator session is being issued on (sanitized request metadata only). */
export interface AdminSessionAssurance {
  method: AdminMfaMethod;
  userAgent?: string | null;
  ipAddress?: string | null;
  /** Re-check, under the lifecycle lock, that the account still has a usable registered factor (password-recovery sessions). */
  requireRegisteredFactor?: boolean;
}

/** Task 05.2: mark matching administrator sessions revoked (the access check also requires a live refresh family). */
export async function revokeAdminSessions(transaction: Prisma.TransactionClient, where: { userId: string; familyId?: string }, reason: string) {
  await transaction.adminSession.updateMany({ where: { ...where, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
}

export class StalePasswordHashError extends Error {
  constructor() { super('Stored password changed during the update'); }
}

async function assertPasswordHashUnchanged(transaction: Prisma.TransactionClient, userId: string, observedHash?: string | null): Promise<void> {
  if (observedHash === undefined) return;
  const current = await transaction.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!current || current.passwordHash !== observedHash) throw new StalePasswordHashError();
}

export class AuthRepository {
  /**
   * Find a user by their email address.
   */
  async findUserByEmail(email: string): Promise<(User & { role: Role }) | null> {
    return prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });
  }

  async findUserByPendingEmail(email: string): Promise<(User & { role: Role }) | null> {
    return prisma.user.findUnique({
      where: { pendingEmail: email },
      include: { role: true },
    });
  }

  /**
   * Find a user by ID.
   */
  async findUserById(id: string): Promise<(User & { role: Role }) | null> {
    return prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
  }

  /**
   * Create a new customer user.
   */
  async createCustomerUser(
    email: string,
    passwordHash: string,
    firstName: string,
    lastName: string
  ): Promise<User> {
    return prisma.$transaction(async (tx) => {
      let customerRole = await tx.role.findUnique({
        where: { name: 'CUSTOMER' },
      });

      if (!customerRole) {
        customerRole = await tx.role.create({
          data: { name: 'CUSTOMER', description: 'Standard customer role' },
        });
      }

      return tx.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          roleId: customerRole.id,
        },
      });
    }, { timeout: 15000 });
  }

  /**
   * Update a user's password.
   */
  async updateUserPassword(userId: string, passwordHash: string): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async getAccountAuthMethods(userId: string) {
    const [user, linkedGoogle] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } }),
      prisma.oAuthAccount.findFirst({ where: { userId, provider: 'GOOGLE' }, select: { id: true } }),
    ]);
    return { password: Boolean(user?.passwordHash), google: Boolean(linkedGoogle) };
  }

  /**
   * `observedHash` is the stored hash the caller verified the new password against (bcrypt runs outside the
   * transaction). Under the lifecycle lock the latest hash is re-read; if it moved, nothing is written and
   * StalePasswordHashError tells the caller to re-verify against the new value.
   */
  async updatePasswordAndRevokeSessions(userId: string, passwordHash: string, eventType: SecurityEventType, observedHash?: string | null): Promise<void> {
    await prisma.$transaction(async (transaction) => {
      await lockUserTokenLifecycle(transaction, userId);
      await assertPasswordHashUnchanged(transaction, userId, observedHash);
      await transaction.user.update({ where: { id: userId }, data: { passwordHash } });
      await transaction.refreshToken.updateMany({
        where: { userId },
        data: { isRevoked: true, expiresAt: new Date(0) },
      });
      await revokeAdminSessions(transaction, { userId }, 'PASSWORD_CHANGED');
      await transaction.securityEvent.create({ data: { userId, type: eventType } });
    }, { timeout: 15000 });
  }

  /**
   * Update a user's profile details.
   */
  async updateUser(userId: string, data: { firstName: string; lastName: string }): Promise<User & { role: Role }> {
    return prisma.user.update({
      where: { id: userId },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
      },
      include: { role: true },
    });
  }

  async setPendingEmail(userId: string, pendingEmail: string): Promise<User & { role: Role }> {
    return prisma.user.update({
      where: { id: userId },
      data: { pendingEmail },
      include: { role: true },
    });
  }

  async changeUnverifiedEmail(userId: string, pendingEmail: string): Promise<User & { role: Role }> {
    return prisma.$transaction(async (transaction) => {
      await transaction.otpChallenge.updateMany({
        where: {
          userId,
          purpose: OtpPurpose.EMAIL_VERIFICATION,
          consumedAt: null,
          lockedAt: null,
        },
        data: { lockedAt: new Date() },
      });
      return transaction.user.update({
        where: { id: userId },
        data: { pendingEmail },
        include: { role: true },
      });
    }, { maxWait: 10000, timeout: 30000 });
  }

  async verifyOtpAndCompleteEmailChange(userId: string, challengeId: string, codeHash: string, verifiedEmail: string, now: Date): Promise<User & { role: Role }> {
    return prisma.$transaction(async (transaction) => {
      const consumed = await transaction.otpChallenge.updateMany({
        where: { id: challengeId, userId, purpose: OtpPurpose.EMAIL_CHANGE, codeHash, consumedAt: null, lockedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw new Error('Invalid or expired verification code');
      const user = await transaction.user.update({
        where: { id: userId, pendingEmail: verifiedEmail },
        data: { email: verifiedEmail, pendingEmail: null, emailVerifiedAt: now },
        include: { role: true },
      });
      await transaction.securityEvent.create({ data: { userId, type: SecurityEventType.EMAIL_CHANGED } });
      return user;
    }, { timeout: 15000 });
  }

  async findPasswordResetAuthorization(tokenHash: string) {
    return prisma.passwordResetToken.findFirst({
      where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { include: { role: true } } },
    });
  }

  async completePasswordReset(userId: string, tokenHash: string, passwordHash: string, now: Date, observedHash?: string | null): Promise<boolean> {
    return prisma.$transaction(async (transaction) => {
      await lockUserTokenLifecycle(transaction, userId);
      // Checked before the reset authorization is consumed, so a stale check never burns a valid token.
      await assertPasswordHashUnchanged(transaction, userId, observedHash);
      const consumed = await transaction.passwordResetToken.updateMany({
        where: { userId, tokenHash, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return false;
      await transaction.user.update({ where: { id: userId }, data: { passwordHash } });
      await transaction.refreshToken.updateMany({
        where: { userId },
        data: { isRevoked: true, expiresAt: new Date(0) },
      });
      await revokeAdminSessions(transaction, { userId }, 'PASSWORD_RESET');
      // Unfinished sign-in / recovery transactions and reset codes are void once the credential changes (MFA factors are untouched).
      await transaction.adminAuthChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
      await transaction.otpChallenge.updateMany({ where: { userId, purpose: OtpPurpose.PASSWORD_RESET, consumedAt: null }, data: { consumedAt: now } });
      await transaction.securityEvent.create({ data: { userId, type: SecurityEventType.PASSWORD_RESET } });
      return true;
    }, { timeout: 15000 });
  }

  /** Consume a reset OTP and run `onConsumed` in the same transaction; null when the code was already used, locked or expired. */
  async consumeResetOtpThen<T>(challengeId: string, userId: string, codeHash: string, now: Date, onConsumed: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T | null> {
    return prisma.$transaction(async (transaction) => {
      await lockUserTokenLifecycle(transaction, userId);
      const consumed = await transaction.otpChallenge.updateMany({
        where: { id: challengeId, userId, purpose: OtpPurpose.PASSWORD_RESET, codeHash, consumedAt: null, lockedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return null;
      return onConsumed(transaction);
    }, { timeout: 15000 });
  }

  async verifyOtpAndCreatePasswordResetAuthorization(challengeId: string, userId: string, codeHash: string, expiresAt: Date, now: Date): Promise<string | null> {
    const rawToken = crypto.randomBytes(48).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    return prisma.$transaction(async (transaction) => {
      const consumed = await transaction.otpChallenge.updateMany({
        where: { id: challengeId, userId, purpose: OtpPurpose.PASSWORD_RESET, codeHash, consumedAt: null, lockedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return null;
      await transaction.passwordResetToken.upsert({
        where: { userId },
        create: { userId, tokenHash, expiresAt },
        update: { tokenHash, expiresAt, consumedAt: null },
      });
      return rawToken;
    }, { timeout: 15000 });
  }

  /**
   * Issue the first token of a new independent session family (password login, registration verification,
   * Google sign-in). Credential verification (bcrypt, OTP, OAuth) happens before this call and outside any
   * transaction; this method then serializes with every revocation and re-reads the account under the
   * lifecycle lock. It returns null, having written nothing, when the account no longer matches the state the
   * proof was based on (password changed or reset, deactivated or deleted, role changed, email unverified).
   * A session inserted here before a revocation takes the lock is revoked by it; one that would be inserted
   * after is refused. Rotated successors inherit their predecessor's family in rotateRefreshToken.
   */
  async createSessionRefreshToken(
    authorized: SessionAuthorizationSnapshot,
    tokenHash: string,
    expiresAt: Date,
    adminAssurance?: AdminSessionAssurance
  ): Promise<RefreshToken | null> {
    return prisma.$transaction(async (transaction) => {
      await lockUserTokenLifecycle(transaction, authorized.id);

      const current = await transaction.user.findUnique({
        where: { id: authorized.id },
        select: { passwordHash: true, isActive: true, roleId: true, emailVerifiedAt: true },
      });
      if (
        !current ||
        !current.isActive ||
        !current.emailVerifiedAt ||
        current.passwordHash !== authorized.passwordHash ||
        current.roleId !== authorized.roleId
      ) {
        return null;
      }

      if (adminAssurance?.requireRegisteredFactor) {
        const [totp, passkeys, codes] = await Promise.all([
          transaction.adminMfaFactor.count({ where: { userId: authorized.id, verifiedAt: { not: null }, disabledAt: null } }),
          transaction.adminWebAuthnCredential.count({ where: { userId: authorized.id, revokedAt: null } }),
          transaction.adminRecoveryCode.count({ where: { userId: authorized.id, consumedAt: null, revokedAt: null } }),
        ]);
        if (totp + passkeys + codes === 0) return null;
      }

      const token = await transaction.refreshToken.create({
        data: { userId: authorized.id, tokenHash, expiresAt, familyId: crypto.randomUUID() },
      });
      // Task 05.2: an ADMIN family is only ever created together with its MFA-assured AdminSession, in this transaction (the
      // unchanged roleId above guarantees the role AuthService.createSession matched against the assurance is still current).
      if (adminAssurance) {
        const now = new Date();
        await transaction.adminSession.create({
          data: {
            familyId: token.familyId, userId: authorized.id, mfaMethod: adminAssurance.method, mfaVerifiedAt: now, lastSeenAt: now,
            userAgent: adminAssurance.userAgent?.slice(0, 300) ?? null, ipAddress: adminAssurance.ipAddress ?? null,
          },
        });
        await transaction.securityEvent.create({
          data: { userId: authorized.id, type: SecurityEventType.LOGIN_SUCCESS, ipAddress: adminAssurance.ipAddress ?? null,
            userAgent: adminAssurance.userAgent?.slice(0, 1000) ?? null },
        });
      }
      return token;
    }, { timeout: 10000 });
  }

  /** Task 05.2: an unrevoked AdminSession exists for this refresh family. */
  async hasAdminSession(familyId: string, userId: string): Promise<boolean> {
    return Boolean(await prisma.adminSession.findFirst({ where: { familyId, userId, revokedAt: null }, select: { familyId: true } }));
  }

  /**
   * Find a refresh token by its hash regardless of revocation status.
   */
  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
  }

  /**
   * Find a valid refresh token.
   */
  async findValidRefreshToken(tokenHash: string): Promise<RefreshToken | null> {
    return prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        isRevoked: false,
        expiresAt: {
          gt: new Date(),
        },
      },
    });
  }

  /**
   * Find the active token that durably replaced oldTokenHash.
   * Authority is committed PostgreSQL state only: the old row's replacedByTokenHash pointer, written in
   * the same transaction that revoked it. The successor must still be unrevoked, unexpired, and belong
   * to the same user and family, so it cannot borrow an active token from an unrelated device.
   */
  async findRotationSuccessor(oldTokenHash: string): Promise<RefreshToken | null> {
    const old = await prisma.refreshToken.findUnique({
      where: { tokenHash: oldTokenHash },
      select: { userId: true, familyId: true, replacedByTokenHash: true },
    });
    if (!old?.replacedByTokenHash) return null;

    return prisma.refreshToken.findFirst({
      where: {
        tokenHash: old.replacedByTokenHash,
        userId: old.userId,
        familyId: old.familyId,
        isRevoked: false,
        expiresAt: { gt: new Date() },
      },
    });
  }

  /**
   * True when the session family of the presented token still has an unrevoked, unexpired member. Read from committed PostgreSQL state only.
   * Used to separate a concurrent rotation (family alive) from reuse of a token whose session is already over.
   */
  async hasActiveFamilyToken(tokenHash: string): Promise<boolean> {
    const token = await prisma.refreshToken.findUnique({ where: { tokenHash }, select: { userId: true, familyId: true } });
    if (!token) return false;
    const active = await prisma.refreshToken.findFirst({
      where: { userId: token.userId, familyId: token.familyId, isRevoked: false, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    return Boolean(active);
  }

  /**
   * Find the latest active (non-revoked, non-expired) refresh token for a user.
   */
  async findLatestActiveRefreshToken(userId: string): Promise<RefreshToken | null> {
    return prisma.refreshToken.findFirst({
      where: {
        userId,
        isRevoked: false,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Revoke a specific refresh token (e.g. on logout).
   * Also sets expiresAt to the past so racing refresh requests fail immediately.
   */
  async revokeRefreshToken(tokenHash: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { isRevoked: true, expiresAt: new Date(0) },
    });
  }

  /**
   * Logout: revoke the presented token and every other generation of its session family, so a racing
   * rotation cannot leave a live successor behind. Other sessions (other families) are untouched.
   * Serialized with rotation through the shared user lifecycle lock; the family is resolved from
   * committed rows after the lock is held, so it includes any rotation that committed first and
   * never includes one that rolled back. Works without any process-local state.
   */
  async revokeRefreshTokenFamily(tokenHash: string): Promise<string | undefined> {
    // userId is immutable for a token row, so it may be read before taking the lock.
    const token = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    if (!token) return undefined;

    await prisma.$transaction(async (transaction) => {
      await lockUserTokenLifecycle(transaction, token.userId);

      const current = await transaction.refreshToken.findUnique({
        where: { tokenHash },
        select: { familyId: true },
      });
      if (!current) return;

      await transaction.refreshToken.updateMany({
        where: { userId: token.userId, familyId: current.familyId },
        data: { isRevoked: true, expiresAt: new Date(0) },
      });
      await revokeAdminSessions(transaction, { userId: token.userId, familyId: current.familyId }, 'LOGOUT');
    }, { timeout: 10000 });
    // Task 04.7: the owner lets logout drop that account's live delivery sockets.
    return token.userId;
  }

  /**
   * Atomically rotate a token: under the user lifecycle lock, conditionally revoke the old token,
   * link it to its successor, and insert the successor into the old token's family. All three writes
   * commit or roll back together; errors propagate unchanged and nothing outside PostgreSQL is mutated.
   * Returns false (having written nothing) when the old token is no longer eligible.
   */
  async rotateRefreshToken(userId: string, oldTokenHash: string, newTokenHash: string, expiresAt: Date, requireAdminSession = false): Promise<boolean> {
    return prisma.$transaction(async (transaction) => {
      await lockUserTokenLifecycle(transaction, userId);

      const now = new Date();
      const current = await transaction.refreshToken.findFirst({
        where: { userId, tokenHash: oldTokenHash, isRevoked: false, expiresAt: { gt: now } },
        select: { id: true, familyId: true },
      });
      if (!current) return false;
      // Task 05.2: an administrator family rotates only while its MFA-assured AdminSession is unrevoked (checked under the lock
      // every revocation takes, so a concurrent revoke cannot be outrun).
      if (requireAdminSession && !await transaction.adminSession.findFirst({
        where: { familyId: current.familyId, userId, revokedAt: null }, select: { familyId: true },
      })) return false;

      const revoked = await transaction.refreshToken.updateMany({
        where: { id: current.id, isRevoked: false, expiresAt: { gt: now } },
        data: { isRevoked: true, replacedByTokenHash: newTokenHash },
      });
      if (revoked.count !== 1) return false;

      await transaction.refreshToken.create({
        data: { userId, tokenHash: newTokenHash, expiresAt, familyId: current.familyId },
      });
      return true;
    }, { timeout: 10000 });
  }

  /**
   * Revoke all refresh tokens for a user (e.g. on token reuse detection or password change).
   * Also sets expiresAt to the past to invalidate all concurrent in-flight sessions.
   */
  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    await prisma.$transaction(async (transaction) => {
      await lockUserTokenLifecycle(transaction, userId);

      await transaction.refreshToken.updateMany({
        where: { userId },
        data: { isRevoked: true, expiresAt: new Date(0) },
      });
      await revokeAdminSessions(transaction, { userId }, 'ALL_SESSIONS_REVOKED');
    }, { timeout: 10000 });
  }
}
