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
// Password proof on change-password and self-deletion: keep guessing slow even inside a valid step-up window.
const credentialWrites = limiter(5, 15 * 60 * 1000, req => req.user!.userId);

export const preAuthRouter = Router();
// Forgot password: unauthenticated by design, rate limited per IP; every proof is bound to a single-use recovery transaction.
const recoveryLimiter = limiter(10, 15 * 60 * 1000);
preAuthRouter.post('/admin/password-recovery/request', recoveryLimiter, c.recoveryRequest);
preAuthRouter.post('/admin/password-recovery/resend', recoveryLimiter, c.recoveryResend);
preAuthRouter.post('/admin/password-recovery/verify-email', mfaLimiter, c.recoveryVerifyEmail);
preAuthRouter.post('/admin/password-recovery/totp', mfaLimiter, c.recoveryTotp);
preAuthRouter.post('/admin/password-recovery/recovery-code', mfaLimiter, c.recoveryCode);
preAuthRouter.post('/admin/password-recovery/passkey/options', mfaLimiter, c.recoveryPasskeyOptions);
preAuthRouter.post('/admin/password-recovery/passkey/verify', mfaLimiter, c.recoveryPasskeyVerify);
preAuthRouter.post('/admin/password-recovery/complete', recoveryLimiter, c.recoveryComplete);
preAuthRouter.post('/admin/mfa/totp/verify', mfaLimiter, c.verifyTotp);
preAuthRouter.post('/admin/mfa/recovery/verify', mfaLimiter, c.verifyRecovery);
preAuthRouter.post('/admin/mfa/webauthn/options', mfaLimiter, c.webauthnOptions);
preAuthRouter.post('/admin/mfa/webauthn/verify', mfaLimiter, c.webauthnVerify);
preAuthRouter.post('/admin/mfa/enrollment/start', mfaLimiter, c.enrollmentStart);
preAuthRouter.post('/admin/mfa/enrollment/confirm', mfaLimiter, c.enrollmentConfirm);
preAuthRouter.post('/admin/invitations/preview', inviteLimiter, c.invitationPreview);
preAuthRouter.post('/admin/invitations/accept', inviteLimiter, c.invitationAccept);
preAuthRouter.post('/admin/activation/preview', inviteLimiter, c.activationPreview);
preAuthRouter.post('/admin/activation/redeem', inviteLimiter, c.activationRedeem);

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
adminSecurityRouter.post('/admin/me/password', credentialWrites, requireStepUp, c.changePassword);
adminSecurityRouter.post('/admin/me/delete', credentialWrites, requireStepUp, c.deleteAccount);

const owner = requireAdminCapability('OWNER');
// Owner succession: eligible successors (Owner only), and the atomic last-Owner exit (Owner + recent step-up + password + DELETE).
adminSecurityRouter.get('/admin/me/ownership-successors', owner, c.ownershipSuccessors);
adminSecurityRouter.post('/admin/me/ownership-transfer-and-delete', credentialWrites, owner, requireStepUp, c.transferOwnershipAndDelete);

const manageAdmins = requireAdminCapability('MANAGE_ADMINS');
adminSecurityRouter.get('/admin/administrators', manageAdmins, c.administrators);
// One-time Owner notice that administrators were deleted (acknowledged server-side, per Owner).
adminSecurityRouter.get('/admin/administrators/deletion-notice', owner, c.deletionNotice);
adminSecurityRouter.post('/admin/administrators/deletion-notice/acknowledge', writes, owner, c.acknowledgeDeletionNotice);
adminSecurityRouter.patch('/admin/administrators/:id/access', writes, requireAdminCapability('OWNER'), requireStepUp, c.setAccess);
adminSecurityRouter.get('/admin/administrators/:id/mfa-activation', owner, c.activationState);
adminSecurityRouter.post('/admin/administrators/:id/mfa-activation', writes, owner, requireStepUp, c.requestActivation);
adminSecurityRouter.post('/admin/administrators/:id/mfa-activation/resend', writes, owner, requireStepUp, c.resendActivation);
adminSecurityRouter.post('/admin/administrators/:id/mfa-activation/revoke', writes, owner, requireStepUp, c.revokeActivation);
// Explicit privilege elevation; the access PATCH never accepts isOwner.
adminSecurityRouter.post('/admin/administrators/:id/grant-owner', writes, owner, requireStepUp, c.grantOwner);
// Explicit Owner revocation of ANOTHER Owner (the account stays an active ADMIN); never through the access PATCH.
adminSecurityRouter.post('/admin/administrators/:id/revoke-owner', writes, owner, requireStepUp, c.revokeOwner);
adminSecurityRouter.get('/admin/invitations', manageAdmins, c.invitations);
adminSecurityRouter.post('/admin/invitations', writes, manageAdmins, requireStepUp, c.createInvitation);
adminSecurityRouter.post('/admin/invitations/:id/resend', writes, manageAdmins, requireStepUp, c.resendInvitation);
adminSecurityRouter.post('/admin/invitations/:id/revoke', writes, manageAdmins, requireStepUp, c.revokeInvitation);
