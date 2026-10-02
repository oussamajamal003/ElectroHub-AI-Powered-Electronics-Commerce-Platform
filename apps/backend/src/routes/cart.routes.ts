import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { CartService, MAX_CART_LINES, MAX_CART_QUANTITY } from '../services/cart.service.js';

const router = Router();
const service = new CartService();
const productId = z.string().uuid();
const item = z.object({ productId, quantity: z.number().int().min(1).max(MAX_CART_QUANTITY) }).strict();
const items = z.array(item).max(MAX_CART_LINES).refine(value => new Set(value.map(entry => entry.productId)).size === value.length);
const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many cart requests. Please try again later.' } } });

function handle(error: unknown, next: NextFunction) {
  next(error instanceof z.ZodError ? new AppError('Invalid cart request.', 400, 'VALIDATION_ERROR') : error);
}

router.post('/cart/validate', publicLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try { res.json({ data: await service.validateGuest(items.parse(req.body?.items)) }); }
  catch (error) { handle(error, next); }
});

router.use('/cart', requireAuth, requireRole('CUSTOMER'));
router.get('/cart', async (req, res, next) => {
  try { res.json({ data: await service.get(req.user!.userId) }); } catch (error) { handle(error, next); }
});
router.post('/cart/items', async (req, res, next) => {
  try { res.status(201).json({ data: await service.add(req.user!.userId, item.parse(req.body)) }); }
  catch (error) { handle(error, next); }
});
router.patch('/cart/items/:productId', async (req, res, next) => {
  try { res.json({ data: await service.setQuantity(req.user!.userId, productId.parse(req.params.productId), item.omit({ productId: true }).parse(req.body).quantity) }); }
  catch (error) { handle(error, next); }
});
router.delete('/cart/items/:productId', async (req, res, next) => {
  try { res.json({ data: await service.remove(req.user!.userId, productId.parse(req.params.productId)) }); }
  catch (error) { handle(error, next); }
});
router.post('/cart/reconcile', async (req, res, next) => {
  try { res.json({ data: await service.reconcile(req.user!.userId, items.parse(req.body?.items)) }); }
  catch (error) { handle(error, next); }
});

export default router;
