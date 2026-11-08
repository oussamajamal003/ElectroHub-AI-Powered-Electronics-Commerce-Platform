import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  verifyResetOtpSchema,
  resetPasswordSchema,
  updateProfileSchema,
  changePasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  changeVerificationEmailSchema,
} from '../validators/auth.validator.js';
import { otpService, OtpDeliveryError, OtpVerificationError, OTP_CONFIG } from '../services/otp.service.js';
import { OtpPurpose } from '@prisma/client';

const authService = new AuthService();

type Scope = 'admin' | 'customer';
const cookieName = (scope: Scope) => 'electrohub_' + scope + '_refresh';

function respondWithOtpError(error: unknown, res: Response): boolean {
  if (error instanceof OtpVerificationError) {
    res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
    return true;
  }
  if (error instanceof Error && (error.message === 'Invalid or expired verification code' || error.message === 'No active verification process found')) {
    res.status(400).json({
      error: { code: 'OTP_INVALID', message: 'The verification code is no longer valid. Request a new code.' },
    });
    return true;
  }
  return false;
}

function respondWithOtpDeliveryError(error: unknown, res: Response): boolean {
  if (!(error instanceof OtpDeliveryError)) return false;
  res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
  return true;
}

/**
 * Helper to set HttpOnly cookie securely.
 */
function cookieOptions(path: string) {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path };
}
function retireLegacyCookies(res: Response) {
  for (const path of ['/api/auth', '/api/auth/refresh']) res.clearCookie('electrohub_refresh', cookieOptions(path));
}
/** Retires the pre-isolation shared cookie: it is only ever expired, never read, so it can authenticate neither portal. */
export const retireLegacySession = (status: 200 | 401) => (_req: Request, res: Response) => {
  retireLegacyCookies(res);
  res.status(status).json(status === 200 ? { message: 'Logged out successfully' } : { error: 'Sign in again' });
};
export function setRefreshCookie(res: Response, token: string, scope: Scope = 'customer') {
  retireLegacyCookies(res);
  res.cookie(cookieName(scope), token, { ...cookieOptions('/api/auth/' + scope), maxAge: 7 * 24 * 60 * 60 * 1000 });
}
export function clearRefreshCookie(res: Response, scope: Scope = 'customer') {
  retireLegacyCookies(res);
  res.clearCookie(cookieName(scope), cookieOptions('/api/auth/' + scope));
}

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = registerSchema.parse(req.body);
    const result = await authService.registerCustomer(
      data.email,
      data.password,
      data.firstName,
      data.lastName
    );

    logger.info('AUTH_REGISTER_SUCCESS_REQUIRES_VERIFICATION', { email: result.email });
    res.status(201).json(result);
  } catch (error: unknown) {
    if (respondWithOtpDeliveryError(error, res)) return;
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    if (error instanceof Error && error.message === 'Email already registered') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = loginSchema.parse(req.body);
    const result = await authService.login(data.email, data.password);
    
    if ('requiresVerification' in result && result.requiresVerification) {
      logger.info('AUTH_LOGIN_REQUIRES_VERIFICATION', { email: result.email });
      return res.status(403).json(result);
    }

    // Task 05.2: an ADMIN password opens only a restricted MFA transaction — no cookie, no access token.
    if ('requiresMfa' in result) {
      logger.info('AUTH_LOGIN_MFA_REQUIRED', { enrollmentRequired: result.enrollmentRequired });
      res.set('Cache-Control', 'no-store');
      return res.status(200).json(result);
    }

    if (!('accessToken' in result) || !result.refreshToken || !result.user) {
      throw new Error('Invalid login result state');
    }

    setRefreshCookie(res, result.refreshToken);

    logger.info('AUTH_LOGIN_SUCCESS', { userId: result.user.id });

    res.status(200).json({
      accessToken: result.accessToken,
      user: result.user,
    });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    if (error instanceof Error && error.message === 'Invalid credentials') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    next(error);
  }
};

export const verifyEmail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = verifyEmailSchema.parse(req.body);
    const result = await authService.verifyRegistrationOtp(data.email, data.code);
    
    setRefreshCookie(res, result.refreshToken);

    logger.info('AUTH_VERIFY_EMAIL_SUCCESS', { userId: result.user.id });

    res.status(200).json({
      message: 'Email verified successfully',
      accessToken: result.accessToken,
      user: result.user,
    });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    if (respondWithOtpError(error, res)) return;
    next(error);
  }
};

export const resendVerification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = resendVerificationSchema.parse(req.body);
    
    const challengeId = await otpService.getChallengeIdByEmail(data.email, OtpPurpose.EMAIL_VERIFICATION);
    if (!challengeId) {
      return res.status(200).json({
        message: 'If verification is pending, a code will be sent when available.',
        success: true,
        expiresAt: new Date(Date.now() + OTP_CONFIG.TTL_MS),
        resendAvailableAt: new Date(Date.now() + OTP_CONFIG.RESEND_COOLDOWN_MS),
      });
    }

    const metadata = await otpService.resendChallenge(challengeId);
    
    logger.info('AUTH_RESEND_VERIFICATION_SUCCESS');
    res.status(200).json({ message: 'If verification is pending, a code will be sent when available.', ...metadata });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    if (error instanceof Error && error.message.includes('Please wait')) {
      return res.status(200).json({
        message: 'If verification is pending, a code will be sent when available.',
        success: true,
        expiresAt: new Date(Date.now() + OTP_CONFIG.TTL_MS),
        resendAvailableAt: new Date(Date.now() + OTP_CONFIG.RESEND_COOLDOWN_MS),
      });
    }
    next(error);
  }
};

export const changeVerificationEmail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = changeVerificationEmailSchema.parse(req.body);
    const result = await authService.changeVerificationEmail(data.currentEmail, data.password, data.newEmail);
    logger.info('AUTH_CHANGE_VERIFICATION_EMAIL_REQUEST');
    res.status(200).json(result);
  } catch (error: unknown) {
    if (respondWithOtpDeliveryError(error, res)) return;
    if (respondWithOtpError(error, res)) return;
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    next(error);
  }
};

export const refreshFor = (scope: Scope) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawRefreshToken = req.cookies[cookieName(scope)];
    
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string' || !rawRefreshToken.trim()) {
      logger.warn('AUTH_REFRESH_FAILURE', { reason: 'Refresh token missing' });
      return res.status(401).json({ error: 'Refresh token missing' });
    }

    const result = await authService.refreshSession(rawRefreshToken, scope);
    
    if (result.refreshToken) {
      setRefreshCookie(res, result.refreshToken, scope);
    }

    logger.info('AUTH_REFRESH_SUCCESS', { userId: result.userId });

    // `user` is the same identity /api/auth/me returns, so a restoring client needs no second request.
    res.status(200).json({
      accessToken: result.accessToken,
      user: result.user,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === 'REFRESH_ROTATION_IN_PROGRESS') {
      // A concurrent request rotated this session a moment ago: no token is issued, the cookie is NOT cleared, and nothing is revoked.
      res.setHeader('Retry-After', '1');
      return res.status(409).json({ error: { code: error.code, message: 'Session refresh already in progress. Retry.' } });
    }
    if (
      (error instanceof AppError && error.statusCode === 401) ||
      (error instanceof Error &&
        (error.message === 'Invalid or expired refresh token' ||
          error.message === 'Invalid refresh token' ||
          error.message === 'User inactive or not found'))
    ) {
      clearRefreshCookie(res, scope);
      logger.warn('AUTH_REFRESH_FAILURE', { reason: error.message });
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
    next(error);
  }
};

export const logoutFor = (scope: Scope) => async (req: Request, res: Response) => {
  try {
    const rawRefreshToken = req.cookies[cookieName(scope)];
    if (rawRefreshToken) {
      await authService.logout(rawRefreshToken, scope);
    }
    logger.info('AUTH_LOGOUT_SUCCESS');
  } catch (error) {
    logger.error('AUTH_LOGOUT_FAILURE', { operation: 'auth.logout.failed', error });
    // If logout fails for some reason, ignore it since we're clearing the cookie anyway
  } finally {
    clearRefreshCookie(res, scope);
    res.status(200).json({ message: 'Logged out successfully' });
  }
};

export const getCurrentUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await authService.getCurrentUser(userId);
    res.status(200).json({ user });
  } catch (error) {
    if (error instanceof Error && error.message === 'User not found or inactive') {
      return res.status(401).json({ error: 'User not found or inactive' });
    }
    next(error);
  }
};

export const updateProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const data = req.body;
    const parsedData = updateProfileSchema.parse(data);

    // Role is freshly resolved from the database by requireAuth. ADMIN email changes belong to the
    // MFA-assured /api/admin/me/email-change workflow, never the shared customer profile endpoint.
    if (req.user?.role === 'ADMIN' && Object.prototype.hasOwnProperty.call(parsedData, 'email')) {
      return res.status(403).json({ error: { code: 'ADMIN_ENDPOINT_REQUIRED', message: 'Administrators change email from the admin profile security flow.' } });
    }

    const user = await authService.updateProfile(userId, parsedData);
    logger.info('AUTH_UPDATE_PROFILE_SUCCESS', { userId });
    res.status(200).json({ user, message: 'Profile updated successfully' });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    if (error instanceof Error && error.message === 'User not found or inactive') {
      return res.status(401).json({ error: 'User not found or inactive' });
    }
    if (error instanceof Error && error.message === 'Email already registered') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    next(error);
  }
};

export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = forgotPasswordSchema.parse(req.body);
    await authService.forgotPassword(data.email);
    
    logger.info('AUTH_PASSWORD_RESET_REQUEST');
    res.status(200).json({ message: 'If an account exists, you may receive password reset instructions shortly.' });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    next(error);
  }
};

export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = resetPasswordSchema.parse(req.body);
    await authService.resetPassword(data.resetToken, data.newPassword);
    
    logger.info('AUTH_PASSWORD_RESET_SUCCESS');
    res.status(200).json({ message: 'Password has been reset successfully.' });
  } catch (error: unknown) {
    if (respondWithOtpError(error, res)) return;
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    if (error instanceof Error && error.message === 'Invalid or expired reset token') {
      return res.status(400).json({ error: { code: 'RESET_AUTHORIZATION_INVALID', message: 'The password reset authorization is no longer valid. Request a new code.' } });
    }
    next(error);
  }
};

export const resendPasswordReset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = forgotPasswordSchema.parse(req.body);
    const result = await authService.resendPasswordReset(data.email);
    res.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) return res.status(400).json({ error: 'Validation failed', details: error.issues });
    next(error);
  }
};

export const verifyResetOtp = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = verifyResetOtpSchema.parse(req.body);
    const result = await authService.verifyPasswordResetOtp(data.email, data.code);

    logger.info('AUTH_PASSWORD_RESET_OTP_VERIFIED');
    res.status(200).json({
      message: 'Reset code verified successfully.',
      resetToken: result.resetToken,
      expiresAt: result.expiresAt,
    });
  } catch (error: unknown) {
    if (respondWithOtpError(error, res)) return;
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    next(error);
  }
};

export const verifyPendingEmailChange = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.user?.role === 'ADMIN') {
      return res.status(403).json({ error: { code: 'ADMIN_ENDPOINT_REQUIRED', message: 'Administrators verify email changes through the admin security flow.' } });
    }
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const data = verifyEmailSchema.pick({ code: true }).parse(req.body);
    const user = await authService.verifyPendingEmailChange(userId, data.code);
    logger.info('AUTH_VERIFY_EMAIL_CHANGE_SUCCESS', { userId });
    res.status(200).json({ message: 'Email changed successfully', user });
  } catch (error: unknown) {
    if (respondWithOtpError(error, res)) return;
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    next(error);
  }
};

export const resendPendingEmailChange = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.user?.role === 'ADMIN') {
      return res.status(403).json({ error: { code: 'ADMIN_ENDPOINT_REQUIRED', message: 'Administrators resend email verification through the admin security flow.' } });
    }
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    const result = await authService.resendPendingEmailChange(userId);
    res.status(200).json({ message: 'Verification code sent.', ...result });
  } catch (error) {
    if (respondWithOtpDeliveryError(error, res)) return;
    if (error instanceof Error && error.message.includes('Please wait')) return res.status(429).json({ error: error.message });
    if (error instanceof Error && error.message === 'No active verification process found') return res.status(400).json({ error: error.message });
    next(error);
  }
};

export const changePassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Task 05.2: administrators change their password at /api/admin/me/password, which requires a recent MFA step-up. This shared
    // route must not become a way around it.
    if (req.user?.role === 'ADMIN') {
      return res.status(403).json({ error: 'Administrators change their password from the admin console.', code: 'ADMIN_ENDPOINT_REQUIRED' });
    }
    const data = changePasswordSchema.parse(req.body);
    await authService.changePassword(userId, data.currentPassword, data.newPassword);

    logger.info('AUTH_PASSWORD_CHANGE_SUCCESS', { userId });
    res.status(200).json({ message: 'Password changed successfully' });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    if (error instanceof Error && error.message === 'Incorrect current password') {
      return res.status(400).json({ error: 'Incorrect current password' });
    }
    if (error instanceof Error && error.message === 'User not found or inactive') {
      return res.status(401).json({ error: 'User not found or inactive' });
    }
    next(error);
  }
};
