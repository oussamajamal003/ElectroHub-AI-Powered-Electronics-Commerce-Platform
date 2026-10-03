import { Router, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { MAX_WISHLIST_ITEMS, WishlistService } from '../services/wishlist.service.js';

const router = Router();
const service = new WishlistService();
const productId = z.string().uuid().transform(value => value.toLowerCase());
const collection = z.object({ productIds: z.array(productId).max(100).transform(ids => [...new Set(ids)]) }).strict();
function ids(body: unknown) {
  const parsed = collection.parse(body).productIds;
  if (parsed.length > MAX_WISHLIST_ITEMS) throw new AppError('You can save up to 50 products.', 409, 'WISHLIST_CAPACITY');
  return parsed;
}
function failure(error: unknown, next: NextFunction) {
  next(error instanceof z.ZodError ? new AppError('Invalid wishlist request.', 400, 'VALIDATION_ERROR') : error);
}
router.post('/wishlist/validate', rateLimit({ windowMs: 15 * 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } } }), async (req, res, next) => {
  try { res.json({ data: await service.validate(ids(req.body)) }); } catch (error) { failure(error, next); }
});
router.use('/wishlist', requireAuth, requireRole('CUSTOMER'));
router.get('/wishlist', async (req, res, next) => {
  try { z.object({}).strict().parse(req.query); res.json({ data: await service.get(req.user!.userId) }); } catch (error) { failure(error, next); }
});
router.post('/wishlist/items', async (req, res, next) => {
  try {
    const input = z.object({ productId }).strict().parse(req.body);
    const result = await service.add(req.user!.userId, input.productId);
    res.status(result.created ? 201 : 200).json({ data: result.data });
  } catch (error) { failure(error, next); }
});
router.delete('/wishlist/items/:productId', async (req, res, next) => {
  try { res.json({ data: await service.remove(req.user!.userId, productId.parse(req.params.productId)) }); } catch (error) { failure(error, next); }
});
router.post('/wishlist/reconcile', async (req, res, next) => {
  try { res.json({ data: await service.reconcile(req.user!.userId, ids(req.body)) }); } catch (error) { failure(error, next); }
});
export default router;
