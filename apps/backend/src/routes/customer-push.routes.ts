import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { CustomerPushService } from '../services/customer-push.service.js';
import { pushConfig } from '../services/customer-push.config.js';

const router = Router(); const service = new CustomerPushService();
const prefix = '/auth/customer/push'; // Same path as the existing HttpOnly customer refresh cookie.
const ids = z.object({ bindingId: z.string().uuid(), eventId: z.string().uuid() }).strict();
router.use(prefix, rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }),
  (_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
// Explicit same-origin boundary for cookie-authenticated background receipts and writes.
router.use(prefix, (req, res, next) => {
  if (req.method !== 'GET' && req.headers.origin !== pushConfig().origin) { res.status(403).json({ error: 'Origin not allowed.' }); return; }
  next();
});
router.post(prefix + '/receipt', async (req, res, next) => {
  try { const input = ids.safeParse(req.body); if (!input.success) { res.status(400).json({ error: 'Invalid notification.' }); return; }
    res.json({ data: await service.receipt(req.cookies?.electrohub_customer_refresh, input.data.bindingId, input.data.eventId) });
  } catch (error) { next(error); }
});
router.use(prefix, requireAuth, requireRole('CUSTOMER'));
router.get(prefix, async (req, res, next) => {
  try { const id = z.string().uuid().optional().safeParse(req.query.id);
    if (!id.success) { res.status(400).json({ error: 'Invalid device.' }); return; }
    const config = pushConfig();
    res.json({ data: { available: config.enabled, publicKey: config.enabled ? config.publicKey : null,
      ...await service.current(req.user!.userId, req.cookies?.electrohub_customer_refresh, id.data) } });
  } catch (error) { next(error); }
});
router.post(prefix, async (req, res, next) => {
  try { res.status(201).json({ data: await service.register(req.user!.userId, req.cookies?.electrohub_customer_refresh, req.body) }); }
  catch (error) { next(error); }
});
router.delete(prefix + '/:id', async (req, res, next) => {
  try { const id = z.string().uuid().safeParse(req.params.id); if (!id.success) { res.status(400).json({ error: 'Invalid device.' }); return; }
    await service.revoke(req.user!.userId, req.cookies?.electrohub_customer_refresh, id.data); res.status(204).end();
  } catch (error) { next(error); }
});
export default router;
