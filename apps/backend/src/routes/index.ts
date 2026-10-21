import { Router } from 'express';
import healthRoutes from './health.routes.js';
import developmentRuntimeRoutes from './development-runtime.routes.js';
import authRoutes from './auth.routes.js';
import cartRoutes from './cart.routes.js';
import checkoutRoutes from './checkout.routes.js';
import orderDocumentRoutes from './order-document.routes.js';
import paymentRoutes from './payment.routes.js';
import wishlistRoutes from './wishlist.routes.js';
import accountRoutes from './account.routes.js';
import productRoutes from './product.routes.js';
import searchRoutes from './search.routes.js';
import e2eSupportRoutes from './e2e-support.routes.js';
import aiAdminRoutes from './ai-admin.routes.js';
import { env } from '../config/env.js';

/**
 * Route aggregator.
 * Mounts all API routes under /api prefix.
 */
const router = Router();

router.use(healthRoutes);
if (env.NODE_ENV !== 'production') router.use(developmentRuntimeRoutes);
router.use('/auth', authRoutes);
router.use(cartRoutes);
router.use(paymentRoutes);
// Task 03.9: before checkoutRoutes so its own private-header, method and auth chain owns /orders/:ref/documents[/:kind].
router.use(orderDocumentRoutes);
router.use(checkoutRoutes);
router.use(wishlistRoutes);
router.use('/account', accountRoutes);
router.use(productRoutes);
router.use('/search', searchRoutes);
router.use(aiAdminRoutes);
if (env.NODE_ENV === 'test') router.use('/__e2e', e2eSupportRoutes);

export default router;
