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
import recommendationRoutes from './recommendation.routes.js';
import searchRoutes from './search.routes.js';
import e2eSupportRoutes from './e2e-support.routes.js';
import aiAdminRoutes from './ai-admin.routes.js';
import productMediaRoutes from './product-media.routes.js';
import deliveryAdminRoutes from './delivery.admin.routes.js';
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
// Task 04.4: before productRoutes so /products/:slug/recommendations is owned by its own limiter and cache policy.
router.use(recommendationRoutes);
router.use(productRoutes);
router.use('/search', searchRoutes);
router.use(aiAdminRoutes);
router.use(productMediaRoutes);
// Task 04.5: admin delivery operations (its own ADMIN + private no-store chain).
router.use(deliveryAdminRoutes);
if (env.NODE_ENV === 'test') router.use('/__e2e', e2eSupportRoutes);

export default router;
