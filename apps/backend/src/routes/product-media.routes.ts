import { Router, type RequestHandler } from 'express';
import multer, { MulterError } from 'multer';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { listMediaProducts, getMediaProduct, listProductMedia, uploadProductMedia, patchProductMedia,
  retireProductMedia, retryProductMedia } from '../controllers/product-media.controller.js';

const router = Router();
const base = '/admin/products';
// Authorization precedes multipart buffering and rate limiting. No public bucket credentials or paths are accepted.
router.use(base, requireAuth, requireRole('ADMIN'), (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
const limit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: req => req.user!.userId, message: { error: { code: 'MEDIA_RATE_LIMIT', message: 'Too many media requests. Try again shortly.' } } });
const parser = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024,
  files: 1, fields: 1, parts: 2, fieldSize: 1024, fieldNameSize: 64, headerPairs: 32 } }).single('file');
const upload: RequestHandler = (req, res, next) => parser(req, res, error => {
  if (error) next(new AppError(error instanceof MulterError && error.code === 'LIMIT_FILE_SIZE' ?
    'Photos must be 6 MiB or smaller.' : 'Send one photo and optional alt text.',
  error instanceof MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'MEDIA_UPLOAD_INVALID'));
  else next();
});
// Bound buffered bytes and concurrent decoders independently of the per-admin rate limit.
let activeUploads = 0;
const admission: RequestHandler = (_req, res, next) => {
  if (activeUploads >= 2) return next(new AppError('Photo processing is busy. Please retry shortly.', 429, 'MEDIA_BUSY'));
  activeUploads++;
  let released = false;
  const release = () => { if (!released) { released = true; activeUploads--; } };
  res.locals.releaseMediaUpload = release;
  const releaseIfIdle = () => { if (!res.locals.mediaProcessing) release(); };
  res.once('finish', releaseIfIdle); res.once('close', releaseIfIdle);
  next();
};
router.get(base, listMediaProducts);
router.get(`${base}/:productId`, getMediaProduct);
router.get(`${base}/:productId/images`, listProductMedia);
router.get(`${base}/:productId/image-index-status`, listProductMedia);
router.post(`${base}/:productId/images`, limit, admission, upload, uploadProductMedia);
router.put(`${base}/:productId/images/:imageId/file`, limit, admission, upload, uploadProductMedia);
router.patch(`${base}/:productId/images/:imageId`, limit, patchProductMedia);
router.delete(`${base}/:productId/images/:imageId`, limit, retireProductMedia);
router.post(`${base}/:productId/images/:imageId/retry`, limit, retryProductMedia);
export default router;
