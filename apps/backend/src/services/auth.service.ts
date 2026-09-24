import crypto from 'crypto';
import { AuthRepository } from '../repositories/auth.repository.js';
import { generateAccessToken, JwtPayload } from '../utils/jwt.js';
import { hashPassword, verifyPassword } from '../utils/hash.js';
import { otpService } from './otp.service.js';
import { emailService } from './email.service.js';
import { OtpPurpose } from '@prisma/client';

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
    
    const code = await otpService.createChallenge(user.id, user.email, OtpPurpose.EMAIL_VERIFICATION);
    await emailService.sendAccountVerificationOtp(user.email, code, user.id);

    return {
      message: 'Registration successful. Please verify your email.',
      requiresVerification: true,
      email: user.email,
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

    if (!user.emailVerifiedAt) {
      const challengeId = await otpService.getChallengeIdByEmail(normalizedEmail, OtpPurpose.EMAIL_VERIFICATION);
      if (!challengeId) {
        const code = await otpService.createChallenge(user.id, user.email, OtpPurpose.EMAIL_VERIFICATION);
        await emailService.sendAccountVerificationOtp(user.email, code, user.id);
      }
      return {
        requiresVerification: true,
        email: user.email,
        message: 'Please verify your email to continue.',
      };
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
   * Verify registration OTP and establish session.
   */
  async verifyRegistrationOtp(email: string, code: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.repository.findUserByEmail(normalizedEmail);
    if (!user || !user.isActive) {
      throw new Error('User not found or inactive');
    }

    const challengeId = await otpService.getChallengeIdByEmail(normalizedEmail, OtpPurpose.EMAIL_VERIFICATION);
    if (!challengeId) {
      throw new Error('No active verification process found');
    }

    const success = await otpService.verifyEmailOtp(challengeId, code);
    if (!success) {
      throw new Error('Invalid or expired verification code');
    }

    // verification success, generate session
    const payload: JwtPayload = {
      userId: user.id,
      role: user.role.name,
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
        role: user.role.name,
      },
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

    const code = await otpService.createChallenge(user.id, user.email, OtpPurpose.PASSWORD_RESET, 15 * 60 * 1000);
    await emailService.sendPasswordResetOtp(user.email, code, user.id);
  }

  /**
   * Complete password recovery.
   */
  async resetPassword(email: string, code: string, newPasswordPlain: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.repository.findUserByEmail(normalizedEmail);
    if (!user || !user.isActive) {
      throw new Error('Invalid or expired reset token');
    }

    const challengeId = await otpService.getChallengeIdByEmail(normalizedEmail, OtpPurpose.PASSWORD_RESET);
    if (!challengeId) {
      throw new Error('Invalid or expired reset token');
    }

    const success = await otpService.verifyChallenge(challengeId, code);
    if (!success) {
      throw new Error('Invalid or expired reset token');
    }

    const newPasswordHash = await hashPassword(newPasswordPlain);

    // Update password
    await this.repository.updateUserPassword(user.id, newPasswordHash);

    // Notify user
    await emailService.sendPasswordChangedNotification(user.email, user.id);

    // Revoke all existing refresh sessions for security
    await this.repository.revokeAllUserRefreshTokens(user.id);
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
    
    // Notify user
    await emailService.sendPasswordChangedNotification(user.email, user.id);
  }
}
