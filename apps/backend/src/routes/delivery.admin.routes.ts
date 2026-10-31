import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getAdminDelivery, listAdminDeliveries, startAdminDelivery, updateAdminDelivery } from '../controllers/delivery.controller.js';

/**
 * Task 04.5 admin delivery operations. ADMIN is enforced server-side before any parsing; responses are private and never cached.
 * @swagger
 * /admin/deliveries:
 *   get:
 *     tags: [Delivery]
 *     summary: Paid, non-cancelled orders with their delivery state, newest first
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [CONFIRMED, PREPARING, OUT_FOR_DELIVERY, DELIVERED] } }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, maximum: 1000, default: 1 } }
 *       - { in: query, name: pageSize, schema: { type: integer, minimum: 1, maximum: 50, default: 20 } }
 *     responses:
 *       200: { description: 'data: AdminDeliveryRow[]; meta: page, pageSize, total, totalPages' }
 *       400: { description: VALIDATION_ERROR }
 *       401: { description: Authentication required }
 *       403: { description: Admin role required }
 * /admin/orders/{orderReference}/delivery:
 *   get:
 *     tags: [Delivery]
 *     summary: Admin delivery snapshot (customer fields, current state, full authorized history, allowed next status)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: orderReference, required: true, schema: { type: string, maxLength: 40 } }
 *     responses:
 *       200: { description: AdminDeliverySnapshot in data }
 *       400: { description: ORDER_REFERENCE_INVALID }
 *       404: { description: ORDER_NOT_FOUND }
 *   post:
 *     tags: [Delivery]
 *     summary: Start tracking (idempotent); mirrors the current Order status with one TRACKING_STARTED event
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: orderReference, required: true, schema: { type: string, maxLength: 40 } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, additionalProperties: false }
 *     responses:
 *       201: { description: Tracking started; snapshot in data }
 *       200: { description: Tracking already existed; unchanged snapshot }
 *       409: { description: DELIVERY_PAYMENT_INELIGIBLE | DELIVERY_ORDER_CANCELLED }
 *   patch:
 *     tags: [Delivery]
 *     summary: Apply one revisioned update (status, location, ETA) in one transaction; one accepted change writes exactly one event
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: orderReference, required: true, schema: { type: string, maxLength: 40 } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [expectedRevision]
 *             properties:
 *               expectedRevision: { type: integer, minimum: 1 }
 *               status: { type: string, enum: [PREPARING, OUT_FOR_DELIVERY, DELIVERED] }
 *               location:
 *                 nullable: true
 *                 type: object
 *                 additionalProperties: false
 *                 required: [latitude, longitude]
 *                 properties:
 *                   latitude: { type: number, minimum: -90, maximum: 90 }
 *                   longitude: { type: number, minimum: -180, maximum: 180 }
 *                   label: { type: string, maxLength: 80, nullable: true }
 *               estimatedAt: { type: string, format: date-time, nullable: true, description: 'now-5min to now+30d; null clears' }
 *               note: { type: string, maxLength: 280, description: Admin-only; never shown to customers }
 *     responses:
 *       200: { description: 'Snapshot in data; meta.changed is false for a no-op (no revision, no event)' }
 *       400: { description: VALIDATION_ERROR }
 *       404: { description: ORDER_NOT_FOUND | DELIVERY_NOT_STARTED }
 *       409: { description: 'DELIVERY_REVISION_CONFLICT (body includes the current snapshot) | DELIVERY_PAYMENT_INELIGIBLE | DELIVERY_ORDER_CANCELLED | DELIVERY_TERMINAL | ORDER_TRANSITION_INVALID | DELIVERY_LOCATION_NOT_ALLOWED' }
 */
const router = Router();
router.use(['/admin/deliveries', '/admin/orders/:orderReference/delivery'], requireAuth, requireRole('ADMIN'),
  (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
const writes = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: req => req.user!.userId,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many delivery updates. Try again shortly.' } } });
router.get('/admin/deliveries', listAdminDeliveries);
router.get('/admin/orders/:orderReference/delivery', getAdminDelivery);
router.post('/admin/orders/:orderReference/delivery', writes, startAdminDelivery);
router.patch('/admin/orders/:orderReference/delivery', writes, updateAdminDelivery);
export default router;
