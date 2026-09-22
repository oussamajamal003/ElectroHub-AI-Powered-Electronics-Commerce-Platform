import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';

/**
 * Route aggregator.
 * Mounts all API routes under /api prefix.
 */
const router = Router();

router.use(healthRoutes);
router.use('/auth', authRoutes);

export default router;
