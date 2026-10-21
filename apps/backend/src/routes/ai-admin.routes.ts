import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AiServiceError, getAiServiceRuntime } from '../integrations/ai/ai.client.js';

const router = Router();

/**
 * @openapi
 * /admin/ai/status:
 *   get:
 *     tags: [Admin AI]
 *     summary: AI service connectivity status (administrators only)
 *     description: >
 *       Probes the internal FastAPI readiness endpoint with the server-held service credential. Always answers 200 for an
 *       administrator; `reachable` reports whether the AI service accepted the call. Never exposes the AI service URL,
 *       host, port, credential or configuration values. Commerce features do not depend on this status.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: AI service status snapshot
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   required: [configured, reachable, checkedAt]
 *                   properties:
 *                     configured: { type: boolean }
 *                     reason: { type: string, enum: [NOT_CONFIGURED, MISCONFIGURED] }
 *                     reachable: { type: boolean }
 *                     environment: { type: string, enum: [development, qa, production, test] }
 *                     status: { type: string, enum: [ready] }
 *                     modelReady: { type: boolean }
 *                     features: { type: object }
 *                     error:
 *                       type: object
 *                       properties:
 *                         category: { type: string }
 *                         code: { type: string }
 *                     checkedAt: { type: string, format: date-time }
 *       401: { description: Authentication required }
 *       403: { description: Administrator role required }
 */
router.get('/admin/ai/status', requireAuth, requireRole('ADMIN'), async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const { config, client } = getAiServiceRuntime();

  if (config.status === 'disabled' || !client) {
    res.json({
      data: {
        configured: false,
        reason: config.status === 'disabled' ? config.reason : 'MISCONFIGURED',
        reachable: false,
        checkedAt: new Date().toISOString(),
      },
    });
    return;
  }

  // Stop probing once the administrator's connection is gone.
  const controller = new AbortController();
  const onClose = () => { if (!res.writableFinished) controller.abort(); };
  res.on('close', onClose);

  try {
    const readiness = await client.getReadiness({ requestId: req.id, signal: controller.signal });
    res.json({
      data: {
        configured: true,
        reachable: true,
        environment: readiness.environment,
        status: readiness.status,
        modelReady: readiness.modelReady,
        features: readiness.features,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    const category = error instanceof AiServiceError ? error.category : 'network';
    const code = error instanceof AiServiceError ? error.code : undefined;
    res.json({
      data: {
        configured: true,
        reachable: false,
        environment: client.environment,
        error: code ? { category, code } : { category },
        checkedAt: new Date().toISOString(),
      },
    });
  } finally {
    res.off('close', onClose);
  }
});

export default router;
