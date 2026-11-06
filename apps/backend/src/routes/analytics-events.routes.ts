import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { analyticsEventsController } from '../controllers/analytics-events.controller.js';

/**
 * Task 05.2 public event ingestion (guest-allowed, like image search). Mounted at /api; accepted types are
 * `image_search.result_selected` (with a server-signed token) and `storefront.session` (anonymous visible time). Rate limited per IP.
 */
const router = Router();

const eventsLimiter = rateLimit({
  windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many analytics events. Please try again shortly.' } },
});

router.post('/analytics/events', eventsLimiter, analyticsEventsController.create);

export default router;
