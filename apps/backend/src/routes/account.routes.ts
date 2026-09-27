import { Router } from 'express';
import { reauthenticateDeletionWithPassword, deleteCurrentAccount } from '../controllers/account-deletion.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { accountDeletionRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

/**
 * @swagger
 * /account/deletion/reauth/password:
 *   post:
 *     tags: [Account]
 *     summary: Verify the customer's password for account deletion
 *     description: Issues a five-minute HttpOnly, purpose-bound deletion proof cookie. The account is not modified.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password: { type: string, minLength: 1, maxLength: 128 }
 *     responses:
 *       200: { description: Identity verified; deletion still requires explicit confirmation }
 *       400: { description: Invalid password or request }
 *       401: { description: Authentication required }
 *       403: { description: Request origin or customer authorization invalid }
 *       429: { description: Re-authentication rate limit reached }
 */
router.post('/deletion/reauth/password', requireAuth, requireRole('CUSTOMER'), accountDeletionRateLimiter, reauthenticateDeletionWithPassword);

/**
 * @swagger
 * /account:
 *   delete:
 *     tags: [Account]
 *     summary: Delete the authenticated customer's account
 *     description: Requires a recent password or exact linked-Google-subject verification and the literal confirmation DELETE. Transaction history is retained according to the documented lifecycle.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [confirmation]
 *             properties:
 *               confirmation: { type: string, enum: [DELETE] }
 *     responses:
 *       200: { description: Account access removed and session cookies cleared }
 *       400: { description: Confirmation is invalid }
 *       401: { description: Authentication required or account unavailable }
 *       403: { description: Recent deletion re-authentication required }
 *       429: { description: Deletion rate limit reached }
 */
router.delete('/', requireAuth, requireRole('CUSTOMER'), accountDeletionRateLimiter, deleteCurrentAccount);

export default router;
