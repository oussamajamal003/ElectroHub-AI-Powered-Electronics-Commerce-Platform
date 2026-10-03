import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import cartRoutes from './cart.routes.js';
import wishlistRoutes from './wishlist.routes.js';
import accountRoutes from './account.routes.js';
import productRoutes from './product.routes.js';
import searchRoutes from './search.routes.js';
import e2eSupportRoutes from './e2e-support.routes.js';
import { env } from '../config/env.js';

/**
 * Route aggregator.
 * Mounts all API routes under /api prefix.
 */
const router = Router();

router.use(healthRoutes);
router.use('/auth', authRoutes);
router.use(cartRoutes);
router.use(wishlistRoutes);
router.use('/account', accountRoutes);
router.use(productRoutes);
router.use('/search', searchRoutes);
if (env.NODE_ENV === 'test') router.use('/__e2e', e2eSupportRoutes);

export default router;
