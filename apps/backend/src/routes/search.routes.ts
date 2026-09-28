import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { searchController } from '../controllers/search.controller.js';

const router = Router();
const limiter = (limit: number) => rateLimit({
  windowMs: 60000, limit, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many search requests. Please try again shortly.' } },
});
router.get('/products', limiter(120), searchController.products);
router.get('/suggestions', limiter(240), searchController.suggestions);
export default router;
