import { prisma } from '../lib/prisma.js';
import crypto from 'crypto';
import { Prisma, User, Role, RefreshToken, SecurityEventType, OtpPurpose } from '@prisma/client';

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

  async updatePasswordAndRevokeSessions(userId: string, passwordHash: string, eventType: SecurityEventType): Promise<void> {
    await prisma.$transaction(async (transaction) => {
      await lockUserTokenLifecycle(transaction, userId);
      await transaction.user.update({ where: { id: userId }, data: { passwordHash } });
      await transaction.refreshToken.updateMany({
        where: { userId },
        data: { isRevoked: true, expiresAt: new Date(0) },
      });
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

  async completePasswordReset(userId: string, tokenHash: string, passwordHash: string, now: Date): Promise<boolean> {
    return prisma.$transaction(async (transaction) => {
      await lockUserTokenLifecycle(transaction, userId);
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
      await transaction.securityEvent.create({ data: { userId, type: SecurityEventType.PASSWORD_RESET } });
      return true;
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
    expiresAt: Date
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

      return transaction.refreshToken.create({
        data: { userId: authorized.id, tokenHash, expiresAt, familyId: crypto.randomUUID() },
      });
    }, { timeout: 10000 });
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
  async revokeRefreshTokenFamily(tokenHash: string): Promise<void> {
    // userId is immutable for a token row, so it may be read before taking the lock.
    const token = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    if (!token) return;

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
    }, { timeout: 10000 });
  }

  /**
   * Atomically rotate a token: under the user lifecycle lock, conditionally revoke the old token,
   * link it to its successor, and insert the successor into the old token's family. All three writes
   * commit or roll back together; errors propagate unchanged and nothing outside PostgreSQL is mutated.
   * Returns false (having written nothing) when the old token is no longer eligible.
   */
  async rotateRefreshToken(userId: string, oldTokenHash: string, newTokenHash: string, expiresAt: Date): Promise<boolean> {
    return prisma.$transaction(async (transaction) => {
      await lockUserTokenLifecycle(transaction, userId);

      const now = new Date();
      const current = await transaction.refreshToken.findFirst({
        where: { userId, tokenHash: oldTokenHash, isRevoked: false, expiresAt: { gt: now } },
        select: { id: true, familyId: true },
      });
      if (!current) return false;

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
    }, { timeout: 10000 });
  }
}
