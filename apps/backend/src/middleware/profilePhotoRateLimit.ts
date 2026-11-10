import rateLimit from 'express-rate-limit';

/** Authenticated profile-photo writes are user-scoped and tightly rate-limited before multipart parsing. */
export const profilePhotoWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: req => req.user!.userId,
  message: { error: { code: 'PROFILE_PHOTO_RATE_LIMIT', message: 'Too many photo changes. Try again later.' } },
});
