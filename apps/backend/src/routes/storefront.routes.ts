import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { storefrontController } from '../controllers/storefront.controller.js';

const router = Router();
const contactLimiter = rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many messages. Please try again shortly.' } } });

router.get('/store/profile', storefrontController.getProfile);
router.post('/store/contact', contactLimiter, storefrontController.contact);

export default router;
