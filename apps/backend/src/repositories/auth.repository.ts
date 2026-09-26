import { prisma } from '../lib/prisma.js';
import crypto from 'crypto';
import { User, Role, RefreshToken, SecurityEventType, OtpPurpose } from '@prisma/client';

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

  async updatePasswordAndRevokeSessions(userId: string, passwordHash: string, eventType: SecurityEventType): Promise<void> {
    await prisma.$transaction(async (transaction) => {
      await transaction.user.update({ where: { id: userId }, data: { passwordHash } });
      await transaction.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } });
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
      const consumed = await transaction.passwordResetToken.updateMany({
        where: { userId, tokenHash, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return false;
      await transaction.user.update({ where: { id: userId }, data: { passwordHash } });
      await transaction.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } });
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
   * Create a new refresh token.
   */
  async createRefreshToken(userId: string, tokenHash: string, expiresAt: Date): Promise<RefreshToken> {
    return prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
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
   * Revoke a specific refresh token.
   */
  async revokeRefreshToken(tokenHash: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { isRevoked: true },
    });
  }

  async rotateRefreshToken(userId: string, oldTokenHash: string, newTokenHash: string, expiresAt: Date): Promise<boolean> {
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const revoked = await transaction.refreshToken.updateMany({
        where: { userId, tokenHash: oldTokenHash, isRevoked: false, expiresAt: { gt: new Date() } },
        data: { isRevoked: true },
      });
      if (revoked.count !== 1) return false;
      await transaction.refreshToken.create({ data: { userId, tokenHash: newTokenHash, expiresAt } });
      return true;
    }, { timeout: 15000 });
  }

  /**
   * Revoke all refresh tokens for a user.
   */
  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { userId },
      data: { isRevoked: true },
    });
  }
}
