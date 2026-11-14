import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { paymentService, PaymentSetupBlockedError } from '../services/payment.service.js';
import { performance } from 'node:perf_hooks';
import { logSafely } from '../utils/logger.js';
import { randomUUID } from 'node:crypto';
import { paymentIsolation } from '../payment-isolation.js';

const router = Router();
router.use('/checkout/payment-attempts', (req, res, next) => {
  if (req.method === 'POST' && req.path === '/') {
    const started = performance.now();
    const requestStart = new Date().toISOString();
    const correlationId = /^[a-z0-9_-]{1,100}$/i.test(req.id ?? '') ? req.id : randomUUID();
    res.locals.paymentSetupCorrelationId = correlationId;
    res.locals.paymentSetupStarted = started;
    res.set('x-request-id', correlationId);
    let completed = false;
    const complete = (aborted: boolean) => {
      if (completed) return;
      completed = true;
      logSafely('info', 'Payment setup HTTP performance.', {
      event: 'payment.setup.http_performance', correlationId, requestStart,
      authMiddlewareMs: res.locals.paymentSetupAuthMs ?? null,
      responseSerializationMs: null,
      responseSerializationAndDispatchMs: res.locals.paymentSetupSerializationMs ?? null,
      totalBackendMs: performance.now() - started, statusCode: aborted ? null : res.statusCode,
      aborted, stage: res.locals.paymentSetupStage ?? 'authentication',
      metricSemantics: 'payment router ingress through response finish; earlier middleware and pure serialization unavailable',
      });
    };
    res.once('finish', () => complete(false));
    res.once('close', () => complete(!res.writableFinished));
  }
  next();
}, (req, res, next) => {
  const started = performance.now();
  void requireAuth(req, res, error => {
    res.locals.paymentSetupAuthMs = performance.now() - started;
    next(error);
  });
}, requireRole('CUSTOMER'), (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false,
  // Verified customer identity is stable even if the requesting socket closes during a DB read.
  keyGenerator: req => req.user!.userId,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many payment requests. Please wait and try again.' } } });
const normalize = (error: unknown) => error instanceof z.ZodError
  ? new AppError('Check your checkout details.', 400, 'CHECKOUT_VALIDATION_ERROR') :
    error instanceof AppError ? error : new AppError('Payment is temporarily unavailable. Your existing attempt can be recovered safely.', 503, 'PAYMENT_UNAVAILABLE', true, error);
const empty = z.object({}).strict();

/**
 * @swagger
 * /checkout/payment-attempts:
 *   post:
 *     tags: [Payments]
 *     summary: Create or resume an owned manual-capture test payment attempt; does not purchase
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
 *               expectedRevision: { type: string }
 *     responses:
 *       201: { description: Owner-only setup with transient client secret; no-store }
 *       200: { description: Compatible setup replay }
 *       202: { description: Durable setup work is pending }
 *       409: { description: Checkout or idempotency conflict }
 * /checkout/payment-attempts/{attemptId}:
 *   get:
 *     tags: [Payments]
 *     summary: Read owned payment outcome, current Cart and persisted confirmation; no client secret
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: attemptId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: >-
 *           Safe owned status. Additive last-unit fields (PR #51): `outcomeReason` is `STOCK_UNAVAILABLE` when an order-less purchase was
 *           (or is being) cancelled because the item sold out or was withdrawn before its order committed (the card authorization is
 *           cancelled, never captured; `classification` keeps its existing value). `authorizationReleased` is true only after a fresh
 *           provider read verified the cancellation. `unavailableItems` (stock outcomes only, else null) lists each saved line with its
 *           requested and currently available quantity. Nothing is reserved by this read.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     classification: { type: string }
 *                     state: { type: string }
 *                     failureCode: { type: string, nullable: true }
 *                     outcomeReason: { type: string, enum: [STOCK_UNAVAILABLE], nullable: true }
 *                     authorizationReleased: { type: boolean }
 *                     unavailableItems:
 *                       type: array
 *                       nullable: true
 *                       items:
 *                         type: object
 *                         properties:
 *                           productId: { type: string, format: uuid }
 *                           name: { type: string }
 *                           slug: { type: string, nullable: true }
 *                           imageUrl: { type: string, nullable: true }
 *                           quantity: { type: integer, description: Quantity the customer tried to buy }
 *                           availableQuantity: { type: integer, description: Sellable stock now }
 *                           availability: { type: string, enum: [AVAILABLE, LOW_STOCK, OUT_OF_STOCK, UNAVAILABLE, NOT_FOUND] }
 *       404: { description: Not found for this customer }
 * /checkout/payment-attempts/{attemptId}/submit:
 *   post:
 *     tags: [Payments]
 *     summary: Place Order. Accept the purchase before card confirmation; moves Cart lines into the attempt. Reserves no stock.
 *     description: >-
 *       Runs before Stripe.js confirms the card, so a refusal means nothing was authorized or charged. Stock is re-read (never reserved);
 *       inventory is committed only after authorization, at order commit. A purchase whose item is no longer purchasable is refused with the
 *       standard stock conflict and its Cart lines are kept for the customer to correct. Buy Now applies the same gate.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: attemptId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, additionalProperties: false }
 *     responses:
 *       200: { description: Accepted purchase identity (idempotent replay returns the same identity) }
 *       404: { description: Not found for this customer }
 *       409:
 *         description: >-
 *           `{ error: { code, message } }` with code `CART_STOCK_CONFLICT` (sold out or short; message names the product and available
 *           quantity), `PRODUCT_UNAVAILABLE` (withdrawn), `CHECKOUT_CHANGED` (Cart or prices changed) or `PAYMENT_RECOVERY_PENDING`.
 * /checkout/payment-attempts/{attemptId}/confirmation-started:
 *   post:
 *     tags: [Payments]
 *     summary: Announce card confirmation for a submitted purchase. Last stock read before the card can be authorized (never a reservation).
 *     description: >-
 *       The client calls this immediately before Stripe.js confirms the card and confirms only after a 200. If an item sold out (or was
 *       withdrawn) after Place Order, the call is refused with the standard stock conflict, the purchase's unconfirmed payment is cancelled
 *       (verified by a fresh provider read) and its status reports `outcomeReason: STOCK_UNAVAILABLE`. Nothing was authorized or charged.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: attemptId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "`{ data: { attemptId, confirmationStartedAt } }` (idempotent; null when the signal is disabled)" }
 *       404: { description: Not found for this customer }
 *       409:
 *         description: >-
 *           `CART_STOCK_CONFLICT` / `PRODUCT_UNAVAILABLE` (sold out or withdrawn since Place Order; do not confirm the card) or
 *           `PAYMENT_CONFIRMATION_NOT_ALLOWED` (not a submitted purchase awaiting card input).
 * /checkout/payment-attempts/{attemptId}/restore:
 *   post:
 *     tags: [Payments]
 *     summary: Return a cancelled Cart purchase's items to the Cart (once; additive to newer Cart quantities)
 *     description: >-
 *       Allowed after the cancellation or refund is verified with the provider. A purchase that lost the last unit(s)
 *       (`outcomeReason: STOCK_UNAVAILABLE`) is returned even while stock is 0; the Cart shows the line as out of stock and blocks
 *       checkout until restocked. Nothing is reserved. Buy Now purchases are never added to the Cart.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: attemptId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: The purchase status after restoration }
 *       404: { description: Not found for this customer }
 *       409:
 *         description: >-
 *           `PURCHASE_NOT_RESTORABLE` (Buy Now), `PRODUCT_UNAVAILABLE` (withdrawn product), `CHECKOUT_CHANGED` (other outcomes whose items are
 *           no longer purchasable), `CART_FULL`, `INVALID_CART_QUANTITY` or `PAYMENT_RECOVERY_PENDING`.
 * /checkout/payment-attempts/{attemptId}/discard:
 *   post:
 *     tags: [Payments]
 *     summary: Remove a failed payment from the customer's purchases (cancelling a still-open declined intent first)
 *     description: >-
 *       The single trash action on a failed-payment card. Owner-scoped and idempotent. A terminal failure is hidden at once
 *       (`dismissedAt`); nothing is deleted and the audit history is kept. A declined purchase whose provider intent is still open is
 *       re-read from the provider and cancelled first; the card is hidden only after the cancellation is verified. Repeating the request
 *       re-drives the same recorded cancellation and never issues a second provider call for an operation already done.
 *       The purchases list exposes the server's decision as `removal`: `REMOVE`, `CANCEL_AND_REMOVE`, `PENDING` or `CONFIRMING`.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: attemptId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, additionalProperties: false }
 *     responses:
 *       200: { description: "`{ attemptId, status: REMOVED, dismissedAt }` — the payment is hidden from the customer's purchases" }
 *       202: { description: "`{ attemptId, status: CANCEL_PENDING, dismissedAt: null }` — cancellation recorded, provider verification pending" }
 *       404: { description: Not found for this customer }
 *       409:
 *         description: >-
 *           `PAYMENT_STATUS_UNCONFIRMED` (the outcome is not confirmed or the provider shows an authorization; nothing is cancelled or
 *           hidden) or `PAYMENT_NOT_DISMISSIBLE` (paid, compensation pending, or a recovery pass holds the payment).
 * /checkout/payment-attempts/{attemptId}/reconcile:
 *   post:
 *     tags: [Payments]
 *     summary: Retrieve provider truth and safely resume the existing purchase attempt
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: attemptId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, additionalProperties: false }
 *     responses:
 *       200: { description: Resolved owned outcome }
 *       202: { description: Durable payment recovery continues }
 * /checkout/payment-attempts/{attemptId}/cancel:
 *   post:
 *     tags: [Payments]
 *     summary: Cancel an uncommitted attempt; cannot cancel a committed purchase
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: attemptId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, additionalProperties: false }
 *     responses:
 *       200: { description: Cancellation verified }
 *       202: { description: Cancellation pending }
 *       409: { description: Purchase already resolving }
 */
router.post('/checkout/payment-attempts', limiter, async (req, res, next) => {
  res.locals.paymentSetupStage = 'setup';
  try { const data = await paymentService.setup(req.user!.userId, req.get('Idempotency-Key') ?? '', req.body, res.locals.paymentSetupCorrelationId);
    res.locals.paymentSetupStage = 'response';
    const started = performance.now();
    res.status(data.state === 'PREPARING' ? 202 : data.replayed ? 200 : 201).json({ data });
    res.locals.paymentSetupSerializationMs = performance.now() - started; }
  catch (error) {
    if (error instanceof PaymentSetupBlockedError) {
      res.status(error.statusCode).json({ error: { code: error.code, message: error.message, recovery: error.recovery } });
      return;
    }
    next(normalize(error));
  }
});
// Read-only: whether this backend may perform payment writes (payment isolation boundary). Lets the UI show a maintenance state instead of
// offering actions that would return 503 PAYMENT_MUTATIONS_DISABLED. Exposes no database or environment identity.
router.get('/checkout/payment-capability', requireAuth, (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ data: { paymentsEnabled: paymentIsolation().allowed } });
});
router.get('/checkout/payment-attempts', limiter, async (req, res, next) => {
  try { res.json({ data: await paymentService.purchases(req.user!.userId) }); } catch (error) { next(normalize(error)); }
});
// The list GET above is read-only; overdue recovery for the customer's own unresolved purchases is this explicit mutation (Task 03.8).
router.post('/checkout/payment-attempts/recover-overdue', limiter, async (req, res, next) => {
  try { empty.parse(req.body ?? {}); res.status(202).json({ data: await paymentService.recoverOverdue(req.user!.userId) }); }
  catch (error) { next(normalize(error)); }
});
router.post('/checkout/payment-attempts/:attemptId/submit', limiter, async (req, res, next) => {
  try { empty.parse(req.body ?? {}); res.json({ data: await paymentService.submit(req.user!.userId, String(req.params.attemptId)) }); }
  catch (error) { next(normalize(error)); }
});
router.post('/checkout/payment-attempts/:attemptId/confirmation-started', limiter, async (req, res, next) => {
  try { res.json({ data: await paymentService.confirmationStarted(req.user!.userId, String(req.params.attemptId)) }); }
  catch (error) { next(normalize(error)); }
});
router.post('/checkout/payment-attempts/:attemptId/dismiss', limiter, async (req, res, next) => {
  try { empty.parse(req.body ?? {}); res.json({ data: await paymentService.dismiss(req.user!.userId, String(req.params.attemptId)) }); }
  catch (error) { next(normalize(error)); }
});
// Remove failed payment (single trash action): the server decides between hiding a terminal failure and cancelling a declined purchase's
// still-open intent first. 202 = cancellation requested and not yet provider-verified; the card is hidden only once it is.
router.post('/checkout/payment-attempts/:attemptId/discard', limiter, async (req, res, next) => {
  try { empty.parse(req.body ?? {}); const data = await paymentService.discard(req.user!.userId, String(req.params.attemptId));
    res.status(data.status === 'REMOVED' ? 200 : 202).json({ data }); }
  catch (error) { next(normalize(error)); }
});
router.post('/checkout/payment-attempts/:attemptId/read', limiter, async (req, res, next) => {
  try {
    const { state } = z.object({ state: z.enum(['PAID', 'DECLINED', 'CANCELED', 'COMPENSATED', 'REFUNDED']) }).strict().parse(req.body);
    await paymentService.acknowledge(req.user!.userId, String(req.params.attemptId), state);
    res.status(204).end();
  } catch (error) { next(normalize(error)); }
});
router.get('/checkout/payment-attempts/:attemptId', limiter, async (req, res, next) => {
  try { res.json({ data: await paymentService.status(req.user!.userId, String(req.params.attemptId)) }); }
  catch (error) { next(normalize(error)); }
});
for (const operation of ['reconcile', 'cancel', 'resume', 'restore'] as const) {
  router.post(`/checkout/payment-attempts/:attemptId/${operation}`, limiter, async (req, res, next) => {
    try { empty.parse(req.body ?? {}); const data = await paymentService[operation](req.user!.userId, String(req.params.attemptId));
      res.status(['PAID', 'DECLINED', 'CANCELED', 'COMPENSATED', 'REFUNDED', 'INCIDENT'].includes(data.state) ? 200 : 202).json({ data }); }
    catch (error) { next(normalize(error)); }
  });
}
export default router;
