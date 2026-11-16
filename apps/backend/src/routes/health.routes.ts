import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { loggingHealth } from '../utils/logger.js';
import { inProcessRecoveryEnabled } from '../payment-inprocess-recovery.js';
import { inProcessRecoveryRuntime } from '../payment-recovery-runtime.js';

const router = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check (Liveness probe)
 *     description: Returns the current liveness status of the ElectroHub backend API.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is healthy and process is running
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
      observability: loggingHealth(),
    },
  });
});

/**
 * @openapi
 * /health/ready:
 *   get:
 *     summary: Readiness check
 *     description: Verifies backend database reachability and operational readiness.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is fully ready and PostgreSQL connection is active
 *       503:
 *         description: Service is not ready; PostgreSQL is unavailable
 */
router.get(['/health/ready', '/ready'], async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      data: {
        status: 'ready',
        service: 'electrohub-backend',
        database: 'connected',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        version: '0.1.0',
      },
    });
  } catch {
    res.status(503).json({
      error: {
        status: 'not_ready',
        service: 'electrohub-backend',
        database: 'disconnected',
        message: 'Database unavailable',
        timestamp: new Date().toISOString(),
      },
    });
  }
});

/**
 * Payment recovery health: local runner progress plus aggregate durable-work checks.
 * A separate worker's liveness is unverified here; overdue work still detects abandonment.
 * Aggregate counts only (no ids or customer data). 503 means "needs attention", not "take the API out of rotation".
 */
const RECOVERY_GRACE_MS = 2 * 60_000;
router.get('/health/payments', async (_req: Request, res: Response) => {
  try {
    const now = new Date(); const grace = new Date(now.getTime() - RECOVERY_GRACE_MS);
    const overdue = { OR: [{ state: 'READY' as const, nextRunAt: { lt: grace } }, { state: 'LEASED' as const, leaseUntil: { lt: now } },
      { state: 'DONE' as const, nextRunAt: { lt: grace }, attempt: { state: 'DECLINED' as const, submittedAt: { not: null } } }] };
    const [overdueCount, oldest, incidents] = await Promise.all([
      prisma.paymentWork.count({ where: overdue }),
      prisma.paymentWork.findFirst({ where: overdue, orderBy: { nextRunAt: 'asc' }, select: { nextRunAt: true } }),
      prisma.paymentWork.count({ where: { state: 'INCIDENT' } }),
    ]);
    const oldestOverdueSeconds = oldest ? Math.max(0, Math.round((now.getTime() - oldest.nextRunAt.getTime()) / 1000)) : 0;
    const localRunner = inProcessRecoveryEnabled() ? inProcessRecoveryRuntime.snapshot() : null;
    const healthy = overdueCount === 0 && incidents === 0 && (!localRunner || localRunner.healthy);
    res.status(healthy ? 200 : 503).json({ data: { status: healthy ? 'ok' : 'degraded', overdueWork: overdueCount, oldestOverdueSeconds,
      incidentWork: incidents, recoveryRunner: localRunner ?? { phase: 'external_unverified' },
      hint: overdueCount || localRunner && !localRunner.healthy ? 'Check payment recovery runner and database connectivity.' : undefined,
      timestamp: now.toISOString() } });
  } catch {
    res.status(503).json({ error: { status: 'unknown', message: 'Payment recovery health unavailable', timestamp: new Date().toISOString() } });
  }
});

export default router;
