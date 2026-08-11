import { Router } from 'express';
import healthRoutes from './health.routes.js';

/**
 * Route aggregator.
 * Mounts all API routes under /api prefix.
 */
const router = Router();

router.use(healthRoutes);

export default router;
