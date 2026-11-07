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
import adminRoutes from './admin.routes.js';
import { adminSecurityRouter, preAuthRouter as adminPreAuthRoutes } from './admin-security.routes.js';
import adminAnalyticsRoutes from './admin-analytics.routes.js';
import analyticsEventsRoutes from './analytics-events.routes.js';
import adminRecommendationsRoutes from './admin-recommendations.routes.js';
import adminSettingsRoutes from './admin-settings.routes.js';
import { env } from '../config/env.js';

/**
 * Route aggregator.
 * Mounts all API routes under /api prefix.
 */
const router = Router();

router.use(healthRoutes);
if (env.NODE_ENV !== 'production') router.use(developmentRuntimeRoutes);
// Task 05.2: challenge-bound administrator MFA / invitation endpoints (no access token is ever their authority).
router.use('/auth', adminPreAuthRoutes);
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
// Task 05.1: admin catalog, categories, inventory, orders, customers and dashboard (own ADMIN + private no-store chain).
router.use(adminRoutes);
// Task 05.2: administrator self-service security and team management (adminGuard + capability/step-up per route).
router.use(adminSecurityRouter);
// Task 05.2: historical analytics (adminGuard) and the narrow, signed-token client event ingestion.
router.use(adminAnalyticsRoutes);
router.use(analyticsEventsRoutes);
// Task 05.2: recommendation strategy configuration, featured pins, preview and activity (adminGuard).
router.use(adminRecommendationsRoutes);
// Task 05.2: store, shipping (canonical checkout source) and per-administrator notification settings (adminGuard).
router.use(adminSettingsRoutes);
if (env.NODE_ENV === 'test') router.use('/__e2e', e2eSupportRoutes);

export default router;
