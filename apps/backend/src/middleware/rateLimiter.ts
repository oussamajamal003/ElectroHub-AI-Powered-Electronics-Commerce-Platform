import rateLimit from 'express-rate-limit';
import { recordImageSearchLifecycle } from '../integrations/ai/image-search.telemetry.js';

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

/**
 * Task 04.2: public image search is guest-allowed and CPU-expensive, so it gets a tighter per-IP budget than text search.
 * Runs before the multipart body is read, so rejected requests never consume upload bandwidth.
 */
export const IMAGE_SEARCH_RATE_LIMIT = { windowMs: 5 * 60 * 1000, limit: 20 } as const;
export const imageSearchRateLimiter = rateLimit({
  windowMs: IMAGE_SEARCH_RATE_LIMIT.windowMs,
  limit: IMAGE_SEARCH_RATE_LIMIT.limit,
  handler: (req, res) => {
    recordImageSearchLifecycle({ outcome: 'rate_limited', requestId: req.id, durationMs: 0, statusCode: 429 });
    res.setHeader('Connection', 'close');
    res.once('finish', () => { if (!req.complete) req.destroy(); });
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many photo searches. Please try again shortly.' } });
  },
  message: { error: { code: 'RATE_LIMITED', message: 'Too many photo searches. Please try again shortly.' } },
  standardHeaders: true,
  legacyHeaders: false,
});

export const accountDeletionRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many account security attempts. Please try again later.' } },
  standardHeaders: true,
  legacyHeaders: false,
});
