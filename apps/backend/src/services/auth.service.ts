import crypto from 'crypto';
import { AuthRepository } from '../repositories/auth.repository.js';
import { generateAccessToken, JwtPayload } from '../utils/jwt.js';
import { hashPassword, verifyPassword } from '../utils/hash.js';
import { otpService, OtpVerificationError, OTP_CONFIG } from './otp.service.js';
import { emailService } from './email.service.js';
import { OtpPurpose, SecurityEventType, User, Role } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';

const normalizeEmail = (email: string) => email.toLowerCase().trim();

export class AuthService {
  private repository: AuthRepository;

  constructor() {
    this.repository = new AuthRepository();
  }

  /**
   * Register a new customer.
   */
  async registerCustomer(email: string, passwordPlain: string, firstName: string, lastName: string) {
    const normalizedEmail = normalizeEmail(email);
    const existing = await this.repository.findUserByEmail(normalizedEmail);
    if (existing) {
      throw new Error('Email already registered');
    }

    const passwordHash = await hashPassword(passwordPlain);
    const user = await this.repository.createCustomerUser(normalizedEmail, passwordHash, firstName, lastName);
    
    const code = await otpService.createChallenge(user.id, user.email, OtpPurpose.EMAIL_VERIFICATION);
    let delivered = false;
    try {
      delivered = await emailService.sendAccountVerificationOtp(user.email, code, user.id);
    } catch {
      logger.error('Registration verification delivery exception', {
        userId: user.id,
        error: 'verification_delivery_failed',
      });
      delivered = false;
    }
    if (!delivered) logger.error('Registration verification delivery failed', { userId: user.id });

    return {
      message: delivered
        ? 'Registration successful. Please verify your email.'
        : 'Account created, but we could not send the verification code. Please request a new code shortly.',
      requiresVerification: true,
      deliveryFailed: !delivered,
      email: user.email,
    };
  }

  /**
   * Login an existing user and generate tokens.
   */
  async login(email: string, passwordPlain: string) {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.repository.findUserByEmail(normalizedEmail);
    
    if (!user || !user.isActive) {
      throw new Error('Invalid credentials');
    }

    const isMatch = await verifyPassword(passwordPlain, user.passwordHash);
    if (!isMatch) {
      throw new Error('Invalid credentials');
    }

    if (!user.emailVerifiedAt) {
      const verificationEmail = user.pendingEmail || user.email;
      const challengeId = await otpService.getChallengeIdByUserAndDestination(user.id, verificationEmail, OtpPurpose.EMAIL_VERIFICATION);
      let deliveryFailed = false;
      if (!challengeId) {
        const code = await otpService.createChallenge(user.id, verificationEmail, OtpPurpose.EMAIL_VERIFICATION);
        try {
          if (!await emailService.sendAccountVerificationOtp(verificationEmail, code, user.id)) {
            deliveryFailed = true;
            logger.error('Login verification delivery failed', { userId: user.id });
          }
        } catch {
          deliveryFailed = true;
          logger.error('Login verification delivery exception', {
            userId: user.id,
            error: 'verification_delivery_failed',
          });
        }
      }
      return {
        requiresVerification: true,
        email: verificationEmail,
        deliveryFailed,
        message: 'Please verify your email to continue.',
      };
    }

    return this.createSession(user);
  }

  /**
   * Verify registration OTP and establish session.
   */
  async verifyRegistrationOtp(email: string, code: string) {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.repository.findUserByEmail(normalizedEmail) ?? await this.repository.findUserByPendingEmail(normalizedEmail);
    if (!user || !user.isActive) {
      throw new OtpVerificationError('OTP_INVALID');
    }

    const challengeId = await otpService.getLatestChallengeIdByUserAndDestination(user.id, normalizedEmail, OtpPurpose.EMAIL_VERIFICATION);
    if (!challengeId) {
      throw new OtpVerificationError('OTP_INVALID');
    }

    const verification = await otpService.verifyEmailOtpWithOutcome(challengeId, code);
    if (verification !== 'VERIFIED') throw new OtpVerificationError(verification);

    const verifiedUser = await this.repository.findUserById(user.id);
    if (!verifiedUser || !verifiedUser.isActive || !verifiedUser.emailVerifiedAt) {
      throw new OtpVerificationError('OTP_INVALID');
    }

    return this.createSession(verifiedUser);
  }

  async establishCustomerSession(userId: string) {
    const user = await this.repository.findUserById(userId);
    if (!user || !user.isActive || user.role.name !== 'CUSTOMER' || !user.emailVerifiedAt) {
      throw new Error('Invalid credentials');
    }
    return this.createSession(user);
  }

  private async createSession(user: User & { role: Role }) {
    const refreshToken = crypto.randomBytes(64).toString('hex');
    // Re-validates the account under the lifecycle lock: a password change, reset, deactivation or role change
    // that committed after this user was read (and its credentials verified) must not yield a surviving session.
    const issued = await this.repository.createSessionRefreshToken(user, crypto.createHash('sha256').update(refreshToken).digest('hex'), new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    if (!issued) {
      throw new Error('Invalid credentials');
    }
    return {
      accessToken: generateAccessToken({ userId: user.id, role: user.role.name }),
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role.name,
        authMethods: await this.repository.getAccountAuthMethods(user.id),
      },
    };
  }

  /**
   * Refresh the access token using a valid refresh token.
   * Employs rotation: revokes the old refresh token and creates a new one.
   * Includes reuse detection and a concurrent grace window for race-condition resilience.
   */
  async refreshSession(rawRefreshToken: string) {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    
    const storedToken = await this.repository.findRefreshTokenByHash(tokenHash);
    if (!storedToken) {
      throw new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    if (storedToken.expiresAt <= new Date()) {
      throw new AppError('Invalid or expired refresh token', 401, 'EXPIRED_REFRESH_TOKEN');
    }

    // Check if token was already revoked
    if (storedToken.isRevoked) {
      const msSinceRevocation = Date.now() - storedToken.updatedAt.getTime();
      const CONCURRENCY_GRACE_PERIOD_MS = 10_000; // 10s grace window for concurrent requests

      if (msSinceRevocation <= CONCURRENCY_GRACE_PERIOD_MS) {
        // Concurrency grace window: another request within the same client session just rotated this token.
        // Confirm that the EXACT successor issued to replace this token in this session lineage is still active.
        // This guarantees grace authorization is strictly tied to this session's rotation and prevents cross-device leakage.
        const successorToken = await this.repository.findRotationSuccessor(tokenHash);
        if (!successorToken) {
          throw new AppError('Invalid or expired refresh token', 401, 'SESSION_REVOKED');
        }

        const user = await this.repository.findUserById(storedToken.userId);
        if (!user || !user.isActive) {
          throw new AppError('User inactive or not found', 401, 'USER_INACTIVE');
        }

        const roleName = user.role?.name ?? 'CUSTOMER';
        const payload: JwtPayload = {
          userId: user.id,
          role: roleName,
        };
        const newAccessToken = generateAccessToken(payload);

        return {
          accessToken: newAccessToken,
          refreshToken: null, // Keep existing new refresh cookie untouched
          userId: user.id,
        };
      }

      // Reused outside grace window: Token Theft / Replay Attack detected!
      // Invalidate ALL refresh tokens for this user immediately under RFC 6819 reuse protection.
      await this.repository.revokeAllUserRefreshTokens(storedToken.userId);
      logger.warn('AUTH_REFRESH_TOKEN_REUSE_DETECTED', {
        userId: storedToken.userId,
        tokenId: storedToken.id,
        msSinceRevocation,
      });
      throw new AppError('Invalid or expired refresh token', 401, 'REFRESH_TOKEN_REUSED');
    }

    const user = await this.repository.findUserById(storedToken.userId);
    if (!user || !user.isActive) {
      throw new AppError('User inactive or not found', 401, 'USER_INACTIVE');
    }

    const roleName = user.role?.name ?? 'CUSTOMER';
    const payload: JwtPayload = {
      userId: user.id,
      role: roleName,
    };
    const newAccessToken = generateAccessToken(payload);

    const newRawRefreshToken = crypto.randomBytes(64).toString('hex');
    const newTokenHash = crypto.createHash('sha256').update(newRawRefreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const rotated = await this.repository.rotateRefreshToken(user.id, tokenHash, newTokenHash, expiresAt);
    if (!rotated) {
      // Rotation lost the atomic race to a concurrent request in this exact tick.
      // Confirm that the winning concurrent request issued an active replacement for this token.
      const successorToken = await this.repository.findRotationSuccessor(tokenHash);
      if (!successorToken) {
        throw new AppError('Invalid or expired refresh token', 401, 'SESSION_REVOKED');
      }

      return {
        accessToken: newAccessToken,
        refreshToken: null,
        userId: user.id,
      };
    }

    return {
      accessToken: newAccessToken,
      refreshToken: newRawRefreshToken,
      userId: user.id,
    };
  }

  /**
   * Logout: revoke the presented token's whole session family (all rotated generations), leaving other devices' sessions untouched.
   */
  async logout(rawRefreshToken: string) {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    await this.repository.revokeRefreshTokenFamily(tokenHash);
  }

  /**
   * Initialize a password recovery process.
   */
  async forgotPassword(email: string) {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.repository.findUserByEmail(normalizedEmail);
    // Generic response behavior: Do not fail if user doesn't exist
    if (!user || !user.isActive) {
      return; 
    }

    const code = await otpService.createChallenge(user.id, user.email, OtpPurpose.PASSWORD_RESET);
    try {
      if (!await emailService.sendPasswordResetOtp(user.email, code, user.id)) {
        logger.error('Password reset delivery failed', { userId: user.id });
      }
    } catch {
      logger.error('Password reset delivery exception', {
        userId: user.id,
        error: 'password_reset_delivery_failed',
      });
    }
  }

  async resendPasswordReset(email: string) {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.repository.findUserByEmail(normalizedEmail);
    if (user?.isActive) {
      const challengeId = await otpService.getChallengeIdByEmail(normalizedEmail, OtpPurpose.PASSWORD_RESET);
      if (challengeId) {
        try {
          await otpService.resendChallenge(challengeId);
    } catch {
      logger.error('Password reset resend was not completed', { userId: user.id, reason: 'resend_not_completed' });
        }
      }
    }
    return {
      message: 'If an account exists, you may receive password reset instructions shortly.',
      resendAvailableAt: new Date(Date.now() + OTP_CONFIG.RESEND_COOLDOWN_MS),
    };
  }

  /**
   * Verify a reset OTP and return a short-lived reset authorization.
   */
  async verifyPasswordResetOtp(email: string, code: string) {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.repository.findUserByEmail(normalizedEmail);
    if (!user || !user.isActive) {
      throw new OtpVerificationError('OTP_INVALID');
    }

    const challengeId = await otpService.getLatestChallengeIdByEmail(normalizedEmail, OtpPurpose.PASSWORD_RESET);
    if (!challengeId) {
      throw new OtpVerificationError('OTP_INVALID');
    }

    const verification = await otpService.checkChallengeForAtomicConsumption(challengeId, code);
    if (verification !== 'VERIFIED') throw new OtpVerificationError(verification);
    const challenge = await otpService.getActiveChallengeForUser(user.id, OtpPurpose.PASSWORD_RESET);
    if (!challenge || challenge.id !== challengeId) throw new OtpVerificationError('OTP_INVALID');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const resetToken = await this.repository.verifyOtpAndCreatePasswordResetAuthorization(
      challenge.id, user.id, challenge.codeHash, expiresAt, new Date()
    );
    if (!resetToken) throw new OtpVerificationError('OTP_INVALID');
    return { resetToken, expiresAt };
  }

  /**
   * Complete password recovery using server-issued reset authorization.
   */
  async resetPassword(resetToken: string, newPasswordPlain: string) {
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const authorization = await this.repository.findPasswordResetAuthorization(tokenHash);
    if (!authorization || !authorization.user.isActive) {
      throw new Error('Invalid or expired reset token');
    }
    const newPasswordHash = await hashPassword(newPasswordPlain);
    const completed = await this.repository.completePasswordReset(authorization.userId, tokenHash, newPasswordHash, new Date());
    if (!completed) throw new Error('Invalid or expired reset token');
    if (!await emailService.sendPasswordChangedNotification(authorization.user.email, authorization.userId)) {
      logger.error('Password reset notification delivery failed', { userId: authorization.userId });
    }
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
      authMethods: await this.repository.getAccountAuthMethods(userId),
    };
  }

  /**
   * Update current user profile.
   * Explicitly whitelists updatable fields.
   */
  async updateProfile(userId: string, data: { firstName?: string; lastName?: string; email?: string }) {
    const user = await this.repository.findUserById(userId);
    if (!user || !user.isActive) {
      throw new Error('User not found or inactive');
    }

    const normalizedEmail = data.email ? normalizeEmail(data.email) : user.email;
    const firstName = data.firstName?.trim() ?? user.firstName;
    const lastName = data.lastName?.trim() ?? user.lastName;

    if (normalizedEmail !== user.email) {
      const existingUser = await this.repository.findUserByEmail(normalizedEmail);
      const existingPending = await this.repository.findUserByPendingEmail(normalizedEmail);
      if ((existingUser && existingUser.id !== userId) || (existingPending && existingPending.id !== userId)) {
        throw new Error('Email already registered');
      }
    }

    const updatedUser = await this.repository.updateUser(userId, { firstName, lastName });

    if (normalizedEmail !== user.email) {

      if (normalizedEmail === user.pendingEmail) {
        const activeChallenge = await otpService.getChallengeIdByUserAndDestination(userId, normalizedEmail, OtpPurpose.EMAIL_CHANGE);
        if (activeChallenge) {
          return {
            id: updatedUser.id,
            email: updatedUser.email,
            pendingEmail: normalizedEmail,
            firstName: updatedUser.firstName,
            lastName: updatedUser.lastName,
            role: updatedUser.role.name,
            requiresEmailVerification: true,
            verificationDeliveryStatus: 'PENDING' as const,
          };
        }
      }

      await this.repository.setPendingEmail(userId, normalizedEmail);
      const code = await otpService.createChallenge(userId, normalizedEmail, OtpPurpose.EMAIL_CHANGE);
      let delivered = false;
      try {
        delivered = await emailService.sendAccountVerificationOtp(normalizedEmail, code, userId);
      } catch {
        logger.error('Profile email-change delivery exception', {
          userId,
          error: 'verification_delivery_failed',
        });
        delivered = false;
      }
      if (!delivered) logger.error('Profile email-change delivery failed', { userId });

      return {
        id: updatedUser.id,
        email: updatedUser.email,
        pendingEmail: normalizedEmail,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        role: updatedUser.role.name,
        requiresEmailVerification: true,
        verificationDeliveryStatus: delivered ? 'ACCEPTED_BY_PROVIDER' as const : 'FAILED' as const,
      };
    }

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      role: updatedUser.role.name,
      requiresEmailVerification: false,
    };
  }

  async changeVerificationEmail(currentEmail: string, passwordPlain: string, newEmail: string) {
    const normalizedCurrentEmail = normalizeEmail(currentEmail);
    const normalizedNewEmail = normalizeEmail(newEmail);
    const user = await this.repository.findUserByEmail(normalizedCurrentEmail);

    if (!user || !user.isActive || user.emailVerifiedAt || !(await verifyPassword(passwordPlain, user.passwordHash))) {
      return {
        message: 'If verification is pending, a code will be sent when available.',
        email: normalizedNewEmail,
      };
    }

    const existingUser = await this.repository.findUserByEmail(normalizedNewEmail);
    const existingPending = await this.repository.findUserByPendingEmail(normalizedNewEmail);
    if ((existingUser && existingUser.id !== user.id) || (existingPending && existingPending.id !== user.id)) {
      return {
        message: 'If verification is pending, a code will be sent when available.',
        email: normalizedNewEmail,
      };
    }

    if (normalizedNewEmail === user.pendingEmail) {
      return {
        message: 'If verification is pending, a code will be sent when available.',
        email: normalizedNewEmail,
        deliveryStatus: 'PENDING',
      };
    }

    const updatedUser = await this.repository.changeUnverifiedEmail(user.id, normalizedNewEmail);
    const code = await otpService.createChallenge(updatedUser.id, normalizedNewEmail, OtpPurpose.EMAIL_VERIFICATION);
    let delivered = false;
    try {
      delivered = await emailService.sendAccountVerificationOtp(normalizedNewEmail, code, updatedUser.id);
    } catch {
      logger.error('Verification email-change delivery exception', {
        userId: updatedUser.id,
        error: 'verification_delivery_failed',
      });
      delivered = false;
    }
    if (!delivered) {
      logger.error('Verification email-change delivery failed', { userId: updatedUser.id });
    }

    return {
      message: 'If verification is pending, a code will be sent when available.',
      email: normalizedNewEmail,
      deliveryStatus: delivered ? 'ACCEPTED_BY_PROVIDER' : 'FAILED',
    };
  }

  async verifyPendingEmailChange(userId: string, code: string) {
    const user = await this.repository.findUserById(userId);
    if (!user || !user.isActive || !user.pendingEmail) {
      throw new Error('No active verification process found');
    }

    const challengeId = await otpService.getLatestChallengeIdByUserAndDestination(
      userId,
      user.pendingEmail,
      OtpPurpose.EMAIL_CHANGE
    );
    if (!challengeId) {
      throw new OtpVerificationError('OTP_INVALID');
    }

    const verification = await otpService.checkChallengeForAtomicConsumption(challengeId, code);
    if (verification !== 'VERIFIED') throw new OtpVerificationError(verification);
    const challenge = await otpService.getActiveChallengeForUser(userId, OtpPurpose.EMAIL_CHANGE);
    if (!challenge || challenge.id !== challengeId || challenge.destination !== user.pendingEmail) {
      throw new OtpVerificationError('OTP_INVALID');
    }

    const updatedUser = await this.repository.verifyOtpAndCompleteEmailChange(userId, challenge.id, challenge.codeHash, user.pendingEmail, new Date());
    return {
      id: updatedUser.id,
      email: updatedUser.email,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      role: updatedUser.role.name,
    };
  }

  async resendPendingEmailChange(userId: string) {
    const user = await this.repository.findUserById(userId);
    if (!user?.pendingEmail) throw new Error('No active verification process found');
    const challengeId = await otpService.getChallengeIdByUserAndDestination(userId, user.pendingEmail, OtpPurpose.EMAIL_CHANGE);
    if (!challengeId) throw new Error('No active verification process found');
    return otpService.resendChallenge(challengeId);
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
    await this.repository.updatePasswordAndRevokeSessions(userId, newPasswordHash, SecurityEventType.PASSWORD_CHANGED);
    if (!await emailService.sendPasswordChangedNotification(user.email, user.id)) {
      logger.error('Password change notification delivery failed', { userId: user.id });
    }
  }
}
