import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { CustomerNotificationService } from '../services/customer-notification.service.js';

const router = Router();
const service = new CustomerNotificationService();
const cursor = z.string().max(80).transform(value => value.split('|'))
  .pipe(z.tuple([z.string().datetime(), z.string().uuid()]))
  .transform(([at, id]) => ({ at: new Date(at), id }));
router.use('/notifications', (_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); }, requireAuth, requireRole('CUSTOMER'));
router.get('/notifications', async (req, res, next) => {
  try {
    const query = z.object({ before: cursor.optional() }).strict().safeParse(req.query);
    if (!query.success) { res.status(400).json({ error: 'Invalid notification query.' }); return; }
    res.json({ data: await service.list(req.user!.userId, query.data.before) });
  } catch (error) { next(error); }
});
router.patch('/notifications/:id/read', async (req, res, next) => {
  try {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) { res.status(400).json({ error: 'Invalid notification ID.' }); return; }
    await service.markRead(req.user!.userId, id.data);
    res.status(204).end();
  } catch (error) { next(error); }
});
export default router;
