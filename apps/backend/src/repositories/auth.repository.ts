import { prisma } from '../lib/prisma.js';
import { User, Role, RefreshToken, PasswordResetToken } from '@prisma/client';

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
    });
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

  /**
   * Revoke all refresh tokens for a user.
   */
  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { userId },
      data: { isRevoked: true },
    });
  }

  /**
   * Create or update a password reset token for a user.
   */
  async upsertPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<PasswordResetToken> {
    return prisma.passwordResetToken.upsert({
      where: { userId },
      update: { tokenHash, expiresAt },
      create: { userId, tokenHash, expiresAt },
    });
  }

  /**
   * Find a valid password reset token by hash.
   */
  async findValidPasswordResetToken(tokenHash: string): Promise<PasswordResetToken | null> {
    return prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
        expiresAt: {
          gt: new Date(),
        },
      },
    });
  }

  /**
   * Delete a password reset token.
   */
  async deletePasswordResetToken(userId: string): Promise<void> {
    await prisma.passwordResetToken.deleteMany({
      where: { userId },
    });
  }
}
