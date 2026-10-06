import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { CheckoutService } from '../services/checkout.service.js';
import { OrderService } from '../services/order.service.js';

const router = Router(); const checkout = new CheckoutService(); const orders = new OrderService();
router.use(['/checkout', '/orders'], requireAuth, requireRole('CUSTOMER'));
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many checkout attempts. Please try again later.' } } });
const handle = (error: unknown) => error instanceof z.ZodError
  ? new AppError('Check your shipping details and checkout selections.', 400, 'CHECKOUT_VALIDATION_ERROR') : error;
/**
 * @swagger
 * /checkout:
 *   get:
 *     tags: [Checkout]
 *     summary: Read the customer's Cart eligibility and server-owned delivery totals
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Economic revision, blockers and all delivery totals in data }
 *       401: { description: Authentication required }
 *       403: { description: Customer role required }
 * /orders:
 *   post:
 *     tags: [Checkout]
 *     summary: Atomically create an unpaid Order from the authenticated Cart
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [shipping, deliveryMethod, paymentMethod, expectedRevision]
 *             properties:
 *               shipping:
 *                 type: object
 *                 additionalProperties: false
 *                 required: [recipient, line1, city, postalCode, country, phone]
 *                 properties:
 *                   recipient: { type: string, minLength: 2, maxLength: 200 }
 *                   line1: { type: string, minLength: 2, maxLength: 255 }
 *                   line2: { type: string, maxLength: 255 }
 *                   city: { type: string, minLength: 2, maxLength: 100 }
 *                   state: { type: string, maxLength: 100 }
 *                   postalCode: { type: string, minLength: 1, maxLength: 20 }
 *                   country: { type: string, minLength: 2, maxLength: 100 }
 *                   phone: { type: string, maxLength: 32, description: '7–15 digits with common international punctuation' }
 *               deliveryMethod: { type: string, enum: [STANDARD, EXPRESS, OVERNIGHT] }
 *               paymentMethod: { type: string, enum: [CARD] }
 *               expectedRevision: { type: string, pattern: '^[a-f0-9]{64}$' }
 *     responses:
 *       201: { description: Persisted unpaid Confirmation and committed empty Cart in data }
 *       200: { description: Compatible committed attempt replay with the current Cart }
 *       400: { description: Strict payload or attempt validation failure }
 *       409: { description: Cart, stock, price or idempotency conflict; no partial effects }
 * /orders/{orderReference}/confirmation:
 *   get:
 *     tags: [Checkout]
 *     summary: Read persisted Confirmation snapshots belonging to the customer
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: orderReference
 *         required: true
 *         schema: { type: string, description: ORD- followed by the Order UUID }
 *     responses:
 *       200: { description: Persisted unpaid Confirmation in data }
 *       404: { description: Order not found for this account }
 * /orders/attempts/{attemptId}/confirmation:
 *   get:
 *     tags: [Checkout]
 *     summary: Recover an unknown checkout outcome for the authenticated owner
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: attemptId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Previously committed Confirmation in data }
 *       404: { description: No committed attempt found for this account }
 */
router.get('/checkout', async (req, res, next) => {
  try { res.json({ data: await checkout.get(req.user!.userId) }); } catch (error) { next(handle(error)); }
});
router.post('/orders', limiter, async (req, res, next) => {
  try { const data = await orders.create(req.user!.userId, req.get('Idempotency-Key') ?? '', req.body); res.status(data.replayed ? 200 : 201).json({ data }); }
  catch (error) { next(handle(error)); }
});
router.get('/orders/attempts/:attemptId/confirmation', async (req, res, next) => {
  try { res.json({ data: await orders.getAttempt(req.user!.userId, String(req.params.attemptId)) }); } catch (error) { next(handle(error)); }
});
router.get('/orders/:orderReference/confirmation', async (req, res, next) => {
  try { res.json({ data: await orders.getConfirmation(req.user!.userId, String(req.params.orderReference)) }); } catch (error) { next(handle(error)); }
});
export default router;
