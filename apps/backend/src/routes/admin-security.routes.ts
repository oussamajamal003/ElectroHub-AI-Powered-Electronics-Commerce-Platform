import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { adminSecurityController as c } from '../controllers/admin-security.controller.js';
import { adminGuard, requireAdminCapability, requireStepUp } from '../middleware/adminGuard.js';

/**
 * Task 05.2 administrator security routes.
 *  - preAuthRouter (mounted under /api/auth): challenge-bound MFA, enrollment and invitation endpoints. They never accept an access
 *    token as authority and never return administrator data; the single-use mfaToken / invitation token is the only proof they honour.
 *  - adminSecurityRouter (mounted under /api): /admin/me/** self-service and /admin/{administrators,invitations} team management, all
 *    behind adminGuard (DB ADMIN role + live MFA-assured session + private no-store); sensitive writes also require a recent step-up.
 */
const limiter = (limit: number, windowMs: number, key?: (req: Request) => string) => rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false,
  ...(key ? { keyGenerator: key } : {}),
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a few minutes and try again.' } } });

const mfaLimiter = limiter(30, 15 * 60 * 1000);
const inviteLimiter = limiter(20, 15 * 60 * 1000);
const stepUpLimiter = limiter(10, 15 * 60 * 1000, req => req.user!.userId);
const writes = limiter(30, 60 * 1000, req => req.user!.userId);

export const preAuthRouter = Router();
preAuthRouter.post('/admin/mfa/totp/verify', mfaLimiter, c.verifyTotp);
preAuthRouter.post('/admin/mfa/recovery/verify', mfaLimiter, c.verifyRecovery);
preAuthRouter.post('/admin/mfa/webauthn/options', mfaLimiter, c.webauthnOptions);
preAuthRouter.post('/admin/mfa/webauthn/verify', mfaLimiter, c.webauthnVerify);
preAuthRouter.post('/admin/mfa/enrollment/start', mfaLimiter, c.enrollmentStart);
preAuthRouter.post('/admin/mfa/enrollment/confirm', mfaLimiter, c.enrollmentConfirm);
preAuthRouter.post('/admin/invitations/preview', inviteLimiter, c.invitationPreview);
preAuthRouter.post('/admin/invitations/accept', inviteLimiter, c.invitationAccept);

export const adminSecurityRouter = Router();
adminSecurityRouter.use(['/admin/me', '/admin/administrators', '/admin/invitations'], ...adminGuard);

adminSecurityRouter.get('/admin/me/profile', c.profile);
adminSecurityRouter.patch('/admin/me/profile', writes, c.updateProfile);
adminSecurityRouter.post('/admin/me/security/step-up', stepUpLimiter, c.stepUp);
adminSecurityRouter.post('/admin/me/security/step-up/webauthn/options', stepUpLimiter, c.stepUpWebauthnOptions);
adminSecurityRouter.post('/admin/me/security/step-up/webauthn', stepUpLimiter, c.stepUpWebauthn);
adminSecurityRouter.get('/admin/me/security/factors', c.factors);
adminSecurityRouter.post('/admin/me/security/totp', writes, requireStepUp, c.totpStart);
adminSecurityRouter.post('/admin/me/security/totp/:id/confirm', writes, requireStepUp, c.totpConfirm);
adminSecurityRouter.delete('/admin/me/security/totp/:id', writes, requireStepUp, c.totpDisable);
adminSecurityRouter.post('/admin/me/security/recovery-codes', writes, requireStepUp, c.recoveryRegenerate);
adminSecurityRouter.post('/admin/me/security/passkeys/options', writes, requireStepUp, c.passkeyOptions);
adminSecurityRouter.post('/admin/me/security/passkeys', writes, requireStepUp, c.passkeyRegister);
adminSecurityRouter.patch('/admin/me/security/passkeys/:id', writes, c.passkeyRename);
adminSecurityRouter.delete('/admin/me/security/passkeys/:id', writes, requireStepUp, c.passkeyRevoke);
adminSecurityRouter.get('/admin/me/sessions', c.sessions);
adminSecurityRouter.delete('/admin/me/sessions/:id', writes, c.revokeSession);
adminSecurityRouter.post('/admin/me/sessions/revoke-others', writes, requireStepUp, c.revokeOtherSessions);
adminSecurityRouter.get('/admin/me/login-history', c.loginHistory);

const manageAdmins = requireAdminCapability('MANAGE_ADMINS');
adminSecurityRouter.get('/admin/administrators', manageAdmins, c.administrators);
adminSecurityRouter.patch('/admin/administrators/:id/access', writes, requireAdminCapability('OWNER'), requireStepUp, c.setAccess);
adminSecurityRouter.get('/admin/invitations', manageAdmins, c.invitations);
adminSecurityRouter.post('/admin/invitations', writes, manageAdmins, requireStepUp, c.createInvitation);
adminSecurityRouter.post('/admin/invitations/:id/resend', writes, manageAdmins, requireStepUp, c.resendInvitation);
adminSecurityRouter.post('/admin/invitations/:id/revoke', writes, manageAdmins, requireStepUp, c.revokeInvitation);
