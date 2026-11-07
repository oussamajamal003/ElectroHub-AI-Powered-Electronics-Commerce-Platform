import crypto from 'crypto';
import { AuthRepository, StalePasswordHashError } from '../repositories/auth.repository.js';
import { generateAccessToken, JwtPayload } from '../utils/jwt.js';
import { hashPassword, verifyPassword } from '../utils/hash.js';
import { otpService, OtpVerificationError, OTP_CONFIG } from './otp.service.js';
import { emailService } from './email.service.js';
import { OtpPurpose, SecurityEventType, User, Role } from '@prisma/client';
import type { AdminSessionAssurance } from '../repositories/auth.repository.js';
import { adminMfaService } from './admin-mfa.service.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import { DeliveryPublisher } from '../sockets/delivery.publisher.js';

const normalizeEmail = (email: string) => email.toLowerCase().trim();

/** How long after a rotation a presented superseded token is treated as a concurrent request (409, no token, no revocation) rather than reuse. */
export const CONCURRENT_ROTATION_WINDOW_MS = 10_000;

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

    // Task 05.2: a correct ADMIN password only opens a restricted, single-use MFA transaction; never a session or a token.
    if (user.role.name === 'ADMIN') return adminMfaService.startLogin(user);

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

  /**
   * Task 05.2: the only way to mint an administrator session — called by AdminMfaService after a verified second factor.
   */
  async createAssuredAdminSession(user: User & { role: Role }, assurance: AdminSessionAssurance) {
    if (user.role.name !== 'ADMIN') throw new Error('Invalid credentials');
    return this.createSession(user, assurance);
  }

  private async createSession(user: User & { role: Role }, adminAssurance?: AdminSessionAssurance) {
    // Fail closed: no code path may issue an ADMIN session without a verified second factor (and none a CUSTOMER one with it).
    if ((user.role.name === 'ADMIN') !== Boolean(adminAssurance)) throw new Error('Invalid credentials');
    const refreshToken = crypto.randomBytes(64).toString('hex');
    // Re-validates the account under the lifecycle lock: a password change, reset, deactivation or role change
    // that committed after this user was read (and its credentials verified) must not yield a surviving session.
    const issued = await this.repository.createSessionRefreshToken(user, crypto.createHash('sha256').update(refreshToken).digest('hex'), new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), adminAssurance);
    if (!issued) {
      throw new Error('Invalid credentials');
    }
    return {
      accessToken: generateAccessToken(adminAssurance
        ? { userId: user.id, role: user.role.name, sessionId: issued.familyId }
        : { userId: user.id, role: user.role.name }),
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

    // A superseded (already rotated or revoked) refresh token NEVER authenticates on its own. Two situations differ only in what happens next:
    //  - concurrent: it was rotated moments ago and its session family is still alive. This is indistinguishable from a harmless browser race
    //    (two requests carrying the same cookie), and timing alone cannot separate it from theft, so the request gets NO token of any kind and
    //    nothing is revoked: the caller is told to retry and re-read the cookie the winning request set (HTTP 409).
    //  - replay: anything else (outside the window, or the family is already dead) is reuse. The presented token's whole session family is
    //    revoked, never every session of the user, and the request is rejected.
    if (storedToken.isRevoked) {
      const msSinceRevocation = Date.now() - storedToken.updatedAt.getTime();
      if (msSinceRevocation <= CONCURRENT_ROTATION_WINDOW_MS && storedToken.replacedByTokenHash &&
        await this.repository.hasActiveFamilyToken(tokenHash)) {
        throw new AppError('Session refresh already in progress. Retry.', 409, 'REFRESH_ROTATION_IN_PROGRESS');
      }

      await this.repository.revokeRefreshTokenFamily(tokenHash);
      logger.warn('AUTH_REFRESH_TOKEN_REUSE_DETECTED', {
        userId: storedToken.userId,
        tokenId: storedToken.id,
        msSinceRevocation,
        scope: 'family',
      });
      throw new AppError('Invalid or expired refresh token', 401, 'REFRESH_TOKEN_REUSED');
    }

    const user = await this.repository.findUserById(storedToken.userId);
    if (!user || !user.isActive) {
      throw new AppError('User inactive or not found', 401, 'USER_INACTIVE');
    }

    const roleName = user.role?.name ?? 'CUSTOMER';
    const isAdmin = roleName === 'ADMIN';
    // Task 05.2: an ADMIN family refreshes only while its MFA-assured AdminSession lives. A legacy (pre-MFA) admin family has none:
    // it is revoked here, which is the enforced cutover — there is no grandfathered password-only administrator session.
    if (isAdmin && !await this.repository.hasAdminSession(storedToken.familyId, user.id)) {
      await this.repository.revokeRefreshTokenFamily(tokenHash);
      throw new AppError('Your administrator session has ended. Sign in again.', 401, 'ADMIN_SESSION_INVALID');
    }
    const payload: JwtPayload = isAdmin
      ? { userId: user.id, role: roleName, sessionId: storedToken.familyId }
      : { userId: user.id, role: roleName };
    const newAccessToken = generateAccessToken(payload);

    const newRawRefreshToken = crypto.randomBytes(64).toString('hex');
    const newTokenHash = crypto.createHash('sha256').update(newRawRefreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const rotated = await this.repository.rotateRefreshToken(user.id, tokenHash, newTokenHash, expiresAt, isAdmin);
    if (!rotated) {
      // Rotation lost the atomic race. The loser gets no token (see above): 409 while the session family is alive, 401 once it is not.
      if (await this.repository.hasActiveFamilyToken(tokenHash)) {
        throw new AppError('Session refresh already in progress. Retry.', 409, 'REFRESH_ROTATION_IN_PROGRESS');
      }
      throw new AppError('Invalid or expired refresh token', 401, 'SESSION_REVOKED');
    }

    // Identity for the restoring client (the /api/auth/me shape), read AFTER the rotation commits and strictly best-effort. Running it sequentially
    // keeps the rotation's connection use unchanged (the pool is small), and a failure must never fail the refresh: the successor cookie is already
    // committed, so a 500 here would lose it. On any error the identity is omitted and the client falls back to /api/auth/me.
    const authMethods = await this.repository.getAccountAuthMethods(user.id).catch(() => null);

    return {
      accessToken: newAccessToken,
      refreshToken: newRawRefreshToken,
      userId: user.id,
      user: authMethods && { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: roleName, authMethods },
    };
  }

  /**
   * Logout: revoke the presented token's whole session family (all rotated generations), leaving other devices' sessions untouched.
   */
  async logout(rawRefreshToken: string) {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const userId = await this.repository.revokeRefreshTokenFamily(tokenHash);
    // Task 04.7: live delivery sockets carry no session family, so every socket of the account is dropped. Other devices keep valid
    // sessions: their clients refresh through the REST path and reconnect, so the session-family semantics are unchanged.
    if (userId) DeliveryPublisher.disconnectUser(userId, 'LOGOUT');
  }

  /**
   * Initialize a password recovery process.
   */
  async forgotPassword(email: string) {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.repository.findUserByEmail(normalizedEmail);
    // Generic response behavior: Do not fail if user doesn't exist.
    // Administrators never recover through this customer path: it would accept an email code as the only proof.
    if (!user || !user.isActive || user.role.name === 'ADMIN') {
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
   * Administrator forgot-password, step 1. Enumeration-safe: unknown, inactive and CUSTOMER addresses behave exactly like an
   * administrator whose mail could not be delivered. Role comes from the database only.
   */
  async requestAdminPasswordRecovery(email: string) {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.repository.findUserByEmail(normalizedEmail);
    if (!user || !user.isActive || user.role.name !== 'ADMIN') return;
    try {
      const code = await otpService.createChallenge(user.id, user.email, OtpPurpose.PASSWORD_RESET);
      if (!await emailService.sendPasswordResetOtp(user.email, code, user.id)) logger.error('Admin recovery delivery failed', { userId: user.id });
    } catch {
      logger.error('Admin recovery delivery exception', { userId: user.id, error: 'admin_recovery_delivery_failed' });
    }
  }

  /**
   * Administrator forgot-password, step 2: the email code proves mailbox control only. It opens a restricted PASSWORD_RECOVERY
   * transaction (no reset authorization, no session) that an already-registered MFA factor must still convert.
   */
  async verifyAdminRecoveryEmail(email: string, code: string) {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.repository.findUserByEmail(normalizedEmail);
    if (!user || !user.isActive || user.role.name !== 'ADMIN') throw new OtpVerificationError('OTP_INVALID');
    const challengeId = await otpService.getLatestChallengeIdByEmail(normalizedEmail, OtpPurpose.PASSWORD_RESET);
    if (!challengeId) throw new OtpVerificationError('OTP_INVALID');
    const verification = await otpService.checkChallengeForAtomicConsumption(challengeId, code);
    if (verification !== 'VERIFIED') throw new OtpVerificationError(verification);
    const challenge = await otpService.getActiveChallengeForUser(user.id, OtpPurpose.PASSWORD_RESET);
    if (!challenge || challenge.id !== challengeId) throw new OtpVerificationError('OTP_INVALID');
    const opened = await this.repository.consumeResetOtpThen(challenge.id, user.id, challenge.codeHash, new Date(), tx => adminMfaService.openPasswordRecovery(tx, user));
    if (!opened) throw new OtpVerificationError('OTP_INVALID');
    return opened;
  }

  /**
   * Verify a reset OTP and return a short-lived reset authorization.
   */
  async verifyPasswordResetOtp(email: string, code: string) {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.repository.findUserByEmail(normalizedEmail);
    if (!user || !user.isActive || user.role.name === 'ADMIN') {
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
    let completed = false;
    for (let attempt = 0; ; attempt += 1) {
      // Compare against the latest stored hash; a rejection happens before the authorization is consumed.
      const current = await this.repository.findUserById(authorization.userId);
      if (!current || !current.isActive) throw new Error('Invalid or expired reset token');
      // Read after the hash: a reset that already spent this authorization reports an invalid token, not "reused".
      if (!await this.repository.findPasswordResetAuthorization(tokenHash)) throw new Error('Invalid or expired reset token');
      await this.assertNotCurrentPassword(newPasswordPlain, current.passwordHash);
      try {
        completed = await this.repository.completePasswordReset(authorization.userId, tokenHash, newPasswordHash, new Date(), current.passwordHash);
        break;
      } catch (error) {
        if (!(error instanceof StalePasswordHashError) || attempt >= 2) throw error;
      }
    }
    if (!completed) throw new Error('Invalid or expired reset token');
    // After commit: live administrator sockets held by the old credential end now (access tokens are already DB-revoked).
    if (authorization.user.role.name === 'ADMIN') DeliveryPublisher.disconnectUser(authorization.userId, 'LOGOUT');
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

  private async assertNotCurrentPassword(newPasswordPlain: string, currentHash: string | null): Promise<void> {
    if (currentHash && await verifyPassword(newPasswordPlain, currentHash)) {
      throw new AppError('Your new password must be different from your current password.', 422, 'PASSWORD_REUSED');
    }
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
    let observedHash = user.passwordHash;
    for (let attempt = 0; ; attempt += 1) {
      await this.assertNotCurrentPassword(newPasswordPlain, observedHash);
      try {
        await this.repository.updatePasswordAndRevokeSessions(userId, newPasswordHash, SecurityEventType.PASSWORD_CHANGED, observedHash);
        break;
      } catch (error) {
        if (!(error instanceof StalePasswordHashError) || attempt >= 2) throw error;
        const latest = await this.repository.findUserById(userId);
        if (!latest || !latest.isActive) throw new Error('User not found or inactive');
        if (!await verifyPassword(currentPasswordPlain, latest.passwordHash)) throw new Error('Incorrect current password');
        observedHash = latest.passwordHash;
      }
    }
    if (!await emailService.sendPasswordChangedNotification(user.email, user.id)) {
      logger.error('Password change notification delivery failed', { userId: user.id });
    }
  }
}
