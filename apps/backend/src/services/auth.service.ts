import crypto from 'crypto';
import { AuthRepository } from '../repositories/auth.repository.js';
import { hashPassword, verifyPassword } from '../utils/hash.js';
import { generateAccessToken, JwtPayload } from '../utils/jwt.js';
import { logger } from '../utils/logger.js';

export class AuthService {
  private repository: AuthRepository;

  constructor() {
    this.repository = new AuthRepository();
  }

  /**
   * Register a new customer.
   */
  async registerCustomer(email: string, passwordPlain: string, firstName: string, lastName: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const existing = await this.repository.findUserByEmail(normalizedEmail);
    if (existing) {
      throw new Error('Email already registered');
    }

    const passwordHash = await hashPassword(passwordPlain);
    const user = await this.repository.createCustomerUser(normalizedEmail, passwordHash, firstName, lastName);
    
    // Generate immediate session for seamless auto-login
    const payload: JwtPayload = {
      userId: user.id,
      role: 'CUSTOMER',
    };
    const accessToken = generateAccessToken(payload);

    const rawRefreshToken = crypto.randomBytes(64).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.repository.createRefreshToken(user.id, tokenHash, expiresAt);

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: 'CUSTOMER',
      },
    };
  }

  /**
   * Login an existing user and generate tokens.
   */
  async login(email: string, passwordPlain: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.repository.findUserByEmail(normalizedEmail);
    
    if (!user || !user.isActive) {
      throw new Error('Invalid credentials');
    }

    const isMatch = await verifyPassword(passwordPlain, user.passwordHash);
    if (!isMatch) {
      throw new Error('Invalid credentials');
    }

    const payload: JwtPayload = {
      userId: user.id,
      role: user.role.name,
    };

    const accessToken = generateAccessToken(payload);
    
    // Generate Refresh Token
    const rawRefreshToken = crypto.randomBytes(64).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.repository.createRefreshToken(user.id, tokenHash, expiresAt);

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role.name,
      }
    };
  }

  /**
   * Refresh the access token using a valid refresh token.
   * Employs rotation: revokes the old refresh token and creates a new one.
   */
  async refreshSession(rawRefreshToken: string) {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    
    const storedToken = await this.repository.findValidRefreshToken(tokenHash);
    if (!storedToken) {
      throw new Error('Invalid or expired refresh token');
    }

    const user = await this.repository.findUserById(storedToken.userId);
    if (!user || !user.isActive) {
      throw new Error('User inactive or not found');
    }

    // Revoke the old token (rotation)
    await this.repository.revokeRefreshToken(tokenHash);

    // Generate new tokens
    const payload: JwtPayload = {
      userId: user.id,
      role: user.role.name,
    };
    const newAccessToken = generateAccessToken(payload);

    const newRawRefreshToken = crypto.randomBytes(64).toString('hex');
    const newTokenHash = crypto.createHash('sha256').update(newRawRefreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.repository.createRefreshToken(user.id, newTokenHash, expiresAt);

    return {
      accessToken: newAccessToken,
      refreshToken: newRawRefreshToken,
      userId: user.id,
    };
  }

  /**
   * Logout user by revoking their specific refresh token.
   */
  async logout(rawRefreshToken: string) {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    await this.repository.revokeRefreshToken(tokenHash);
  }

  /**
   * Initialize a password recovery process.
   */
  async forgotPassword(email: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.repository.findUserByEmail(normalizedEmail);
    // Generic response behavior: Do not fail if user doesn't exist
    if (!user || !user.isActive) {
      return; 
    }

    const rawResetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawResetToken).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.repository.upsertPasswordResetToken(user.id, tokenHash, expiresAt);

    // In Task 02.4 this will actually send an email using Brevo.
    // For now, we simulate success securely without exposing the token in production logs.
    logger.debug(`[DEV ONLY] Password reset token generated for user id: ${user.id}`);
  }

  /**
   * Complete password recovery.
   */
  async resetPassword(rawResetToken: string, newPasswordPlain: string) {
    const tokenHash = crypto.createHash('sha256').update(rawResetToken).digest('hex');
    
    const storedToken = await this.repository.findValidPasswordResetToken(tokenHash);
    if (!storedToken) {
      throw new Error('Invalid or expired reset token');
    }

    const newPasswordHash = await hashPassword(newPasswordPlain);

    // Update password
    await this.repository.updateUserPassword(storedToken.userId, newPasswordHash);

    // Revoke the reset token so it's single-use
    await this.repository.deletePasswordResetToken(storedToken.userId);

    // Revoke all existing refresh sessions for security
    await this.repository.revokeAllUserRefreshTokens(storedToken.userId);
  }

  /**
   * Get current authenticated user details.
   */
  async getCurrentUser(userId: string) {
    const user = await this.repository.findUserById(userId);
    if (!user || !user.isActive) {
      throw new Error('User not found or inactive');
    }
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role.name,
    };
  }

  /**
   * Update current user profile.
   * Explicitly whitelists updatable fields.
   */
  async updateProfile(userId: string, data: { firstName?: string; lastName?: string }) {
    const user = await this.repository.findUserById(userId);
    if (!user || !user.isActive) {
      throw new Error('User not found or inactive');
    }

    const updatedUser = await this.repository.updateUser(userId, {
      firstName: data.firstName ?? user.firstName,
      lastName: data.lastName ?? user.lastName,
    });

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      role: updatedUser.role.name,
    };
  }

  /**
   * Change password for authenticated user.
   */
  async changePassword(userId: string, currentPasswordPlain: string, newPasswordPlain: string) {
    const user = await this.repository.findUserById(userId);
    if (!user || !user.isActive) {
      throw new Error('User not found or inactive');
    }

    const isValid = await verifyPassword(currentPasswordPlain, user.passwordHash);
    if (!isValid) {
      throw new Error('Incorrect current password');
    }

    const newPasswordHash = await hashPassword(newPasswordPlain);
    await this.repository.updateUserPassword(userId, newPasswordHash);
  }
}
