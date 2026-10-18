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
 *       200: { description: Safe owned status }
 *       404: { description: Not found for this customer }
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
