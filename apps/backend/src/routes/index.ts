import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import e2eSupportRoutes from './e2e-support.routes.js';
import { env } from '../config/env.js';

/**
 * Route aggregator.
 * Mounts all API routes under /api prefix.
 */
const router = Router();

router.use(healthRoutes);
router.use('/auth', authRoutes);
if (env.NODE_ENV === 'test') router.use('/__e2e', e2eSupportRoutes);

export default router;
