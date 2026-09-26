import rateLimit from 'express-rate-limit';

/**
 * Standard rate limiter for login attempts (prevent brute force).
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 20 login requests per `window`
  message: { error: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for registration.
 */
export const registerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: process.env.NODE_ENV === 'production' ? 20 : 1000,
  skip: () => process.env.NODE_ENV !== 'production',
  message: { error: 'Too many accounts created. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for password reset requests.
 */
export const passwordResetRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Limit each IP to 3 password reset requests per `window`
  message: { error: { code: 'RATE_LIMITED', message: 'Too many password reset attempts. Please try again in an hour.' } },
  standardHeaders: true,
  legacyHeaders: false,
});

export const resendVerificationRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many verification requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
