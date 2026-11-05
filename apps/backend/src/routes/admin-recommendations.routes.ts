import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { adminRecommendationsController as c } from '../controllers/admin-recommendations.controller.js';
import { adminGuard } from '../middleware/adminGuard.js';

/**
 * Task 05.2 administrator recommendation management. Every route is ADMIN-only and private (adminGuard runs before any parsing
 * or database read). Writes are rate limited per administrator; each write is versioned and audited in the service.
 */
const router = Router();

router.use('/admin/recommendations', ...adminGuard);

const writes = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: req => req.user!.userId,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many changes in a short time. Wait a moment and try again.' } } });

router.get('/admin/recommendations/overview', c.overview);
router.get('/admin/recommendations/configurations', c.configurations);
router.patch('/admin/recommendations/configurations/:surface/:mode', writes, c.updateConfiguration);
router.get('/admin/recommendations/preview', c.preview);
router.get('/admin/recommendations/featured', c.listFeatured);
router.post('/admin/recommendations/featured', writes, c.createFeatured);
router.patch('/admin/recommendations/featured/:id', writes, c.updateFeatured);
router.delete('/admin/recommendations/featured/:id', writes, c.deleteFeatured);

export default router;
