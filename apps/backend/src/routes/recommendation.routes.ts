import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  MAX_CART_ANCHORS, RECENTLY_VIEWED_CAP, RECOMMENDATION_DEFAULT_LIMIT, RECOMMENDATION_MAX_LIMIT, recommendationService,
} from '../services/recommendation.service.js';

/**
 * Task 04.4 recommendation API. Public reads return only catalog-public products and no customer data; personal reads and
 * activity writes require a live CUSTOMER session and derive the user from it (a client-sent userId is never accepted).
 */
const router = Router();

const limiter = (limit: number, message = 'Too many recommendation requests. Please try again shortly.') => rateLimit({
  windowMs: 60_000, limit, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message } },
});
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const limitQuery = (max = RECOMMENDATION_MAX_LIMIT, fallback = RECOMMENDATION_DEFAULT_LIMIT) => z.object({
  limit: z.coerce.number().int().min(1).max(max).default(fallback),
}).strict();
const slug = z.string().min(1).max(280).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const privateNoStore = (_req: Request, res: Response, next: NextFunction) => {
  res.set('Cache-Control', 'private, no-store');
  res.set('Vary', 'Authorization');
  next();
};
// Payloads contain a freshly issued attribution batch; sharing or reusing a response
// would collapse independent viewers' impressions into the same batch.
const noStore = (res: Response) => res.set('Cache-Control', 'private, no-store');

function failure(error: unknown, next: NextFunction) {
  next(error instanceof z.ZodError ? new AppError('Invalid recommendation request.', 400, 'VALIDATION_ERROR') : error);
}

router.get('/products/:slug/recommendations', limiter(120), async (req, res, next) => {
  try {
    const { limit } = limitQuery().parse(req.query);
    const result = await recommendationService.productSections(slug.parse(req.params.slug), limit, req.id);
    noStore(res);
    res.json({ data: result });
  } catch (error) { failure(error, next); }
});

router.get('/recommendations/popular', limiter(120), async (req, res, next) => {
  try {
    const { limit } = limitQuery().parse(req.query);
    noStore(res);
    res.json({ data: await recommendationService.popular(limit, 'home') });
  } catch (error) { failure(error, next); }
});

// POST only so the cart contents never appear in URLs, logs or shared caches.
router.post('/recommendations/cart', limiter(60), async (req, res, next) => {
  try {
    const input = z.object({
      productIds: z.array(uuid).min(1).max(MAX_CART_ANCHORS).transform(ids => [...new Set(ids)]),
      limit: z.number().int().min(1).max(RECOMMENDATION_MAX_LIMIT).default(RECOMMENDATION_DEFAULT_LIMIT),
    }).strict().parse(req.body);
    noStore(res);
    res.json({ data: await recommendationService.forCart(input.productIds, input.limit) });
  } catch (error) { failure(error, next); }
});

router.post('/recommendations/events', limiter(120, 'Too many recommendation events.'), async (req, res, next) => {
  try {
    const input = z.object({
      token: z.string().min(16).max(4096),
      events: z.array(z.object({ productId: uuid, type: z.enum(['IMPRESSION', 'CLICK']) }).strict()).min(1).max(24),
    }).strict().parse(req.body);
    res.status(202).json({ data: await recommendationService.recordEvents(input.token, input.events) });
  } catch (error) { failure(error, next); }
});

const customer = [privateNoStore, requireAuth, requireRole('CUSTOMER')];

router.get('/me/recommendations', limiter(60), ...customer, async (req, res, next) => {
  try {
    const { limit } = limitQuery().parse(req.query);
    res.json({ data: await recommendationService.forUser(req.user!.userId, limit, req.id) });
  } catch (error) { failure(error, next); }
});

router.get('/me/recommendation-preferences', ...customer, async (req, res, next) => {
  try {
    z.object({}).strict().parse(req.query);
    res.json({ data: await recommendationService.preferences(req.user!.userId) });
  } catch (error) { failure(error, next); }
});

router.patch('/me/recommendation-preferences', limiter(20, 'Too many preference changes. Please try again shortly.'), ...customer,
  async (req, res, next) => {
    try {
      const input = z.object({ personalizationEnabled: z.boolean() }).strict().parse(req.body);
      res.json({ data: await recommendationService.setPreferences(req.user!.userId, input.personalizationEnabled) });
    } catch (error) { failure(error, next); }
  });

router.get('/me/recently-viewed', ...customer, async (req, res, next) => {
  try {
    const { limit } = limitQuery(RECENTLY_VIEWED_CAP, 12).parse(req.query);
    res.json({ data: await recommendationService.recentlyViewed(req.user!.userId, limit) });
  } catch (error) { failure(error, next); }
});

router.delete('/me/recently-viewed/:productId', limiter(20), ...customer, async (req, res, next) => {
  try {
    await recommendationService.removeRecentlyViewed(req.user!.userId, uuid.parse(req.params.productId));
    res.status(204).end();
  } catch (error) { failure(error, next); }
});

router.delete('/me/recently-viewed', limiter(20), ...customer, async (req, res, next) => {
  try {
    await recommendationService.clearRecentlyViewed(req.user!.userId);
    res.status(204).end();
  } catch (error) { failure(error, next); }
});

router.post('/product-interactions', limiter(60, 'Too many activity events.'), ...customer, async (req, res, next) => {
  try {
    const input = z.object({
      productId: uuid,
      eventType: z.enum(['VIEW', 'RECOMMENDATION_CLICK']),
      surface: z.enum(['product_detail', 'home', 'cart', 'account']),
      idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{8,100}$/),
    }).strict().parse(req.body);
    const result = await recommendationService.recordInteraction(req.user!.userId, input);
    res.status(result.recorded ? 201 : 200).json({ data: result });
  } catch (error) { failure(error, next); }
});

export default router;
