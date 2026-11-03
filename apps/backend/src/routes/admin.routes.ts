import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { adminController as c } from '../controllers/admin.controller.js';

/**
 * Task 05.1 admin operations API. ADMIN is enforced server-side before any parsing or database read; responses are private and
 * never cached. Paths are disjoint from the 04.3 media routes (/admin/products/...) and the 04.5 delivery routes
 * (/admin/deliveries, /admin/orders/:ref/delivery[...]), which keep their own chains.
 * Envelopes: list → { data, meta: { page, pageSize, total, totalPages, ... } }; item → { data }; error → { error: { code, message } }.
 */
const router = Router();
const guarded = ['/admin/catalog', '/admin/categories', '/admin/inventory', '/admin/customers', '/admin/dashboard'];
router.use(guarded, requireAuth, requireRole('ADMIN'), (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
// `/admin/orders` exactly and `/admin/orders/:ref` only; deeper delivery paths stay owned by the delivery router.
router.use(/^\/admin\/orders(?:\/[^/]+)?\/?$/, requireAuth, requireRole('ADMIN'), (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

const writes = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: req => req.user!.userId,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many changes in a short time. Wait a moment and try again.' } } });

router.get('/admin/dashboard/overview', c.overview);
router.get('/admin/dashboard/alerts', c.alerts);

router.get('/admin/catalog/options', c.productOptions);
router.get('/admin/catalog/products', c.listProducts);
router.post('/admin/catalog/products', writes, c.createProduct);
router.get('/admin/catalog/products/:id', c.getProduct);
router.patch('/admin/catalog/products/:id', writes, c.updateProduct);
router.patch('/admin/catalog/products/:id/status', writes, c.setProductStatus);
router.delete('/admin/catalog/products/:id', writes, c.deleteProduct);

router.get('/admin/categories', c.listCategories);
router.post('/admin/categories', writes, c.createCategory);
router.patch('/admin/categories/:id', writes, c.updateCategory);
router.patch('/admin/categories/:id/status', writes, c.setCategoryStatus);
router.delete('/admin/categories/:id', writes, c.deleteCategory);

router.get('/admin/inventory', c.listInventory);
router.post('/admin/inventory/:productId/adjustments', writes, c.adjustInventory);
router.patch('/admin/inventory/:productId/threshold', writes, c.setThreshold);

router.get('/admin/orders', c.listOrders);
router.get('/admin/orders/:orderReference', c.getOrder);

router.get('/admin/customers', c.listCustomers);
router.get('/admin/customers/:userId', c.getCustomer);
router.patch('/admin/customers/:userId/status', writes, c.setCustomerStatus);

export default router;
