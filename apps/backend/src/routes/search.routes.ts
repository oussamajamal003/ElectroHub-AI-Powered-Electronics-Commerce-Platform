import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { searchController } from '../controllers/search.controller.js';
import { imageSearchController } from '../controllers/image-search.controller.js';
import { imageSearchRateLimiter } from '../middleware/rateLimiter.js';
import { imageSearchUpload } from '../middleware/imageSearchUpload.js';
import { imageSearchAdmission } from '../middleware/imageSearchAdmission.js';

const router = Router();
const limiter = (limit: number) => rateLimit({
  windowMs: 60000, limit, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many search requests. Please try again shortly.' } },
});
router.get('/products', limiter(120), searchController.products);
router.get('/suggestions', limiter(240), searchController.suggestions);
// Task 04.2: guest-allowed visual search. Limiter and query checks run before the multipart body is consumed.
router.post('/image', imageSearchRateLimiter, imageSearchController.validateQuery, imageSearchAdmission, imageSearchUpload, imageSearchController.search);
export default router;
