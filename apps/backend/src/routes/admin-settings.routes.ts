import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { adminSettingsController as c } from '../controllers/admin-settings.controller.js';
import { adminGuard, requireAdminCapability, requireStepUp } from '../middleware/adminGuard.js';

/**
 * Task 05.2 settings API. Every route runs the shared admin guard chain (valid access token, DB-backed ADMIN role, live MFA-assured
 * session, private no-store). Preferences are self-only: the handler only ever reads or writes the authenticated user's row.
 * Mount this router from routes/index.ts (not done here).
 */
const router = Router();
router.use(['/admin/settings', '/admin/me/notification-preferences'], ...adminGuard);

const writes = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: req => req.user!.userId,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many changes in a short time. Wait a moment and try again.' } } });

router.get('/admin/settings/store', c.getStore);
router.patch('/admin/settings/store', requireAdminCapability('OWNER'), requireStepUp, writes, c.updateStore);
router.get('/admin/settings/shipping', c.getShipping);
router.get('/admin/settings/shipping/preview', c.previewShipping);
router.patch('/admin/settings/shipping', writes, c.updateShipping);
router.get('/admin/me/notification-preferences', c.getPreferences);
router.patch('/admin/me/notification-preferences', writes, c.updatePreferences);

export default router;
