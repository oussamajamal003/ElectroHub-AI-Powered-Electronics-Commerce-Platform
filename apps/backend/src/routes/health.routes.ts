import { Router } from 'express';
import type { Request, Response } from 'express';

const router = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
 *     description: Returns the current health status of the ElectroHub backend API.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: healthy
 *                     service:
 *                       type: string
 *                       example: electrohub-backend
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                     environment:
 *                       type: string
 *                       example: development
 *                     version:
 *                       type: string
 *                       example: 0.1.0
 */
router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    data: {
      status: 'healthy',
      service: 'electrohub-backend',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: '0.1.0',
    },
  });
});

export default router;
