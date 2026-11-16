import { Router } from 'express';
import { adminAnalyticsController as c } from '../controllers/admin-analytics.controller.js';
import { adminGuard } from '../middleware/adminGuard.js';

/**
 * Task 05.2 administrator analytics API. Every route runs the shared admin chain (valid token, DB-backed ADMIN role,
 * live MFA-assured session, private no-store response) before any query is parsed or executed.
 * Envelope: { data, meta: { period, window, previousWindow, generatedAt, timezone, definitions } }.
 */
const router = Router();

router.use('/admin/analytics', ...adminGuard);

router.get('/admin/analytics/overview', c.overview);
router.get('/admin/analytics/products', c.products);
router.get('/admin/analytics/categories', c.categories);
router.get('/admin/analytics/inventory', c.inventory);
router.get('/admin/analytics/recommendations', c.recommendations);
router.get('/admin/analytics/image-search', c.imageSearch);
router.get('/admin/analytics/deliveries', c.deliveries);
router.get('/admin/analytics/customers', c.customers);

export default router;
