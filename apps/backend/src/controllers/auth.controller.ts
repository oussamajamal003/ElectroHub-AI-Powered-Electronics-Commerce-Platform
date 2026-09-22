import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  changePasswordSchema,
} from '../validators/auth.validator.js';

const authService = new AuthService();

const COOKIE_NAME = 'electrohub_refresh';

/**
 * Helper to set HttpOnly cookie securely.
 */
function setRefreshCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // Use 'none' if backend and frontend are on different domains in production
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/api/auth/refresh', // Restrict path to only the refresh endpoint for extra security
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth/refresh',
  });
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

    setRefreshCookie(res, result.refreshToken);

    logger.info('AUTH_REGISTER_SUCCESS', { userId: result.user.id });
    res.status(201).json({
      message: 'Registration successful',
      accessToken: result.accessToken,
      user: result.user,
    });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
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
    
    setRefreshCookie(res, result.refreshToken);

    logger.info('AUTH_LOGIN_SUCCESS', { userId: result.user.id });

    res.status(200).json({
      accessToken: result.accessToken,
      user: result.user,
    });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    if (error instanceof Error && error.message === 'Invalid credentials') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    next(error);
  }
};

export const refresh = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawRefreshToken = req.cookies[COOKIE_NAME];
    
    if (!rawRefreshToken) {
      logger.warn('AUTH_REFRESH_FAILURE', { reason: 'Refresh token missing' });
      return res.status(401).json({ error: 'Refresh token missing' });
    }

    const result = await authService.refreshSession(rawRefreshToken);
    
    setRefreshCookie(res, result.refreshToken);

    logger.info('AUTH_REFRESH_SUCCESS', { userId: result.userId });

    res.status(200).json({
      accessToken: result.accessToken,
    });
  } catch (error) {
    clearRefreshCookie(res);
    if (
      error instanceof Error &&
      (error.message === 'Invalid or expired refresh token' ||
        error.message === 'Invalid refresh token' ||
        error.message === 'User inactive or not found')
    ) {
      logger.warn('AUTH_REFRESH_FAILURE', { reason: error.message });
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
    next(error);
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const rawRefreshToken = req.cookies[COOKIE_NAME];
    if (rawRefreshToken) {
      await authService.logout(rawRefreshToken);
    }
    logger.info('AUTH_LOGOUT_SUCCESS');
  } catch {
    // If logout fails for some reason, ignore it since we're clearing the cookie anyway
  } finally {
    clearRefreshCookie(res);
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

    const user = await authService.updateProfile(userId, parsedData);
    logger.info('AUTH_UPDATE_PROFILE_SUCCESS', { userId });
    res.status(200).json({ user, message: 'Profile updated successfully' });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    if (error instanceof Error && error.message === 'User not found or inactive') {
      return res.status(401).json({ error: 'User not found or inactive' });
    }
    next(error);
  }
};

export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = forgotPasswordSchema.parse(req.body);
    await authService.forgotPassword(data.email);
    
    logger.info('AUTH_PASSWORD_RESET_REQUEST');
    res.status(200).json({ message: 'If the account exists, a password reset message has been sent.' });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    next(error);
  }
};

export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = resetPasswordSchema.parse(req.body);
    await authService.resetPassword(data.token, data.newPassword);
    
    logger.info('AUTH_PASSWORD_RESET_SUCCESS');
    res.status(200).json({ message: 'Password has been reset successfully.' });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    if (error instanceof Error && error.message === 'Invalid or expired reset token') {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }
    next(error);
  }
};

export const changePassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const data = changePasswordSchema.parse(req.body);
    await authService.changePassword(userId, data.currentPassword, data.newPassword);

    logger.info('AUTH_PASSWORD_CHANGE_SUCCESS', { userId });
    res.status(200).json({ message: 'Password changed successfully' });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
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

