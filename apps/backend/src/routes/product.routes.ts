import { Router } from 'express';
import { productController, dealsController, categoryController, brandController } from '../controllers/product.controller.js';
import { reviewController } from '../controllers/review.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';

const router = Router();
router.get('/reviews/me', requireAuth, requireRole('CUSTOMER'), reviewController.listMine);
router.get('/products', productController.list);
router.get('/products/deals', dealsController);
router.get('/products/:slug/reviews', reviewController.list);
router.get('/products/:slug/reviews/me', requireAuth, requireRole('CUSTOMER'), reviewController.mine);
const reviewWriteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20,
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many review requests. Please try again later.' } } });
router.post('/products/:slug/reviews', requireAuth, requireRole('CUSTOMER'), reviewWriteLimiter, reviewController.create);
router.patch('/products/:slug/reviews/me', requireAuth, requireRole('CUSTOMER'), reviewWriteLimiter, reviewController.update);
router.delete('/products/:slug/reviews/me', requireAuth, requireRole('CUSTOMER'), reviewWriteLimiter, reviewController.remove);
router.get('/products/:slug', productController.detail);
router.get('/categories', categoryController.list);
router.get('/categories/:slug', categoryController.detail);
router.get('/brands', brandController.list);
router.get('/brands/:slug', brandController.detail);

export default router;
