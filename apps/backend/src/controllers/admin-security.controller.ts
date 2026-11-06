import type { NextFunction, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { clearRefreshCookie, setRefreshCookie } from './auth.controller.js';
import { adminMfaService, maskIp, type RequestMeta } from '../services/admin-mfa.service.js';
import { adminTeamService } from '../services/admin-team.service.js';
import { adminActivationService } from '../services/admin-activation.service.js';
import { adminAccountService } from '../services/admin-account.service.js';
import { hasRecentStepUp } from '../services/admin-session.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Task 05.2 administrator security HTTP layer. Thin: validation (strict Zod), request metadata and response shaping only; every
 * policy lives in the services. Pre-auth handlers never require or read an access token.
 */
const meta = (req: Request): RequestMeta => ({ userAgent: req.get('user-agent')?.slice(0, 300) ?? null, ipAddress: maskIp(req.ip) });

const mfaToken = z.string().min(20).max(200);
const totpCode = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.');
const recoveryCode = z.string().trim().min(12).max(20);
const name = z.string().trim().min(1).max(100);
const label = z.string().trim().min(1).max(60);
const currentPassword = z.string().min(1, 'Enter your current password.').max(128);
const password = z.string().min(8, 'Use at least 8 characters.').max(128)
  .regex(/[a-z]/, 'Add a lowercase letter.').regex(/[A-Z]/, 'Add an uppercase letter.').regex(/\d/, 'Add a number.');
// WebAuthn JSON is verified cryptographically by @simplewebauthn/server; only its outer size/shape is bounded here.
const webauthnResponse = z.object({ id: z.string().min(1).max(1024), rawId: z.string().min(1).max(1024), type: z.literal('public-key'),
  response: z.record(z.string(), z.unknown()), clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.string().max(32).optional() }).passthrough();
const page = z.object({ page: z.coerce.number().int().min(1).max(1000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) });

type Handler = (req: Request, res: Response) => Promise<unknown>;
const handle = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Check the highlighted fields.',
        fields: error.issues.map(issue => ({ field: issue.path.join('.') || null, message: issue.message })) } });
      return;
    }
    if (error instanceof AppError && 'attemptsRemaining' in error) {
      res.status(error.statusCode).json({ error: { code: error.code, message: error.message, attemptsRemaining: (error as { attemptsRemaining: number }).attemptsRemaining } });
      return;
    }
    next(error);
  }
};

function sendSession(res: Response, result: { accessToken: string; refreshToken: string; user: unknown }, extra: Record<string, unknown> = {}) {
  setRefreshCookie(res, result.refreshToken);
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ accessToken: result.accessToken, user: result.user, ...extra });
}

const session = (req: Request) => req.adminSession!;
const userId = (req: Request) => req.user!.userId;

export const adminSecurityController = {
  // ── Pre-auth ───────────────────────────────────────────────────────────
  verifyTotp: handle(async (req, res) => {
    const body = z.object({ mfaToken, code: totpCode }).strict().parse(req.body);
    sendSession(res, await adminMfaService.verifyLoginTotp(body.mfaToken, body.code, meta(req)));
  }),
  verifyRecovery: handle(async (req, res) => {
    const body = z.object({ mfaToken, code: recoveryCode }).strict().parse(req.body);
    sendSession(res, await adminMfaService.verifyLoginRecoveryCode(body.mfaToken, body.code, meta(req)));
  }),
  webauthnOptions: handle(async (req, res) => {
    const body = z.object({ mfaToken }).strict().parse(req.body);
    res.set('Cache-Control', 'no-store').json(await adminMfaService.loginWebAuthnOptions(body.mfaToken));
  }),
  webauthnVerify: handle(async (req, res) => {
    const body = z.object({ mfaToken, response: webauthnResponse }).strict().parse(req.body);
    sendSession(res, await adminMfaService.verifyLoginWebAuthn(body.mfaToken, body.response as never, meta(req)));
  }),
  enrollmentStart: handle(async (req, res) => {
    const body = z.object({ mfaToken }).strict().parse(req.body);
    res.set('Cache-Control', 'no-store').json(await adminMfaService.startLoginEnrollment(body.mfaToken));
  }),
  enrollmentConfirm: handle(async (req, res) => {
    const body = z.object({ mfaToken, factorId: z.string().uuid(), code: totpCode }).strict().parse(req.body);
    const result = await adminMfaService.confirmLoginEnrollment(body.mfaToken, body.factorId, body.code, meta(req));
    sendSession(res, result, { recoveryCodes: result.recoveryCodes });
  }),
  invitationPreview: handle(async (req, res) => {
    const body = z.object({ token: z.string().min(20).max(200) }).strict().parse(req.body);
    res.set('Cache-Control', 'no-store').json(await adminTeamService.previewInvitation(body.token));
  }),
  invitationAccept: handle(async (req, res) => {
    const body = z.object({ token: z.string().min(20).max(200), firstName: name, lastName: name, password }).strict().parse(req.body);
    res.set('Cache-Control', 'no-store').status(201).json(await adminTeamService.acceptInvitation(body));
  }),

  activationPreview: handle(async (req, res) => {
    const body = z.object({ token: z.string().min(20).max(200) }).strict().parse(req.body);
    res.set('Cache-Control', 'no-store').json(await adminActivationService.preview(body.token));
  }),
  activationRedeem: handle(async (req, res) => {
    const body = z.object({ token: z.string().min(20).max(200), password }).strict().parse(req.body);
    res.set('Cache-Control', 'no-store').status(200).json(await adminActivationService.redeem(body));
  }),

  // ── Self-service (MFA-assured) ─────────────────────────────────────────
  profile: handle(async (req, res) => { res.json({ data: await adminAccountService.profile(userId(req), session(req)) }); }),
  updateProfile: handle(async (req, res) => {
    const body = z.object({ firstName: name, lastName: name }).strict().parse(req.body);
    await adminAccountService.updateProfile(userId(req), body);
    res.json({ data: await adminAccountService.profile(userId(req), session(req)) });
  }),
  stepUp: handle(async (req, res) => {
    const body = z.discriminatedUnion('method', [z.object({ method: z.literal('TOTP'), code: totpCode }).strict(),
      z.object({ method: z.literal('RECOVERY_CODE'), code: recoveryCode }).strict()]).parse(req.body);
    await adminMfaService.stepUpWithCode(userId(req), session(req).familyId, body.method, body.code, meta(req));
    res.json({ data: { verified: true } });
  }),
  stepUpWebauthnOptions: handle(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId(req) }, select: { id: true, passwordHash: true } });
    res.json({ data: await adminMfaService.stepUpWebAuthnOptions(user, session(req).familyId) });
  }),
  stepUpWebauthn: handle(async (req, res) => {
    const body = z.object({ response: webauthnResponse }).strict().parse(req.body);
    await adminMfaService.stepUpWithWebAuthn(userId(req), session(req).familyId, body.response as never, meta(req));
    res.json({ data: { verified: true } });
  }),
  factors: handle(async (req, res) => { res.json({ data: await adminMfaService.listFactors(userId(req)) }); }),
  totpStart: handle(async (req, res) => {
    const body = z.object({ label: label.default('Authenticator app') }).strict().parse(req.body ?? {});
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId(req) }, select: { email: true } });
    res.json({ data: await adminMfaService.startAdditionalTotp(userId(req), user.email, body.label) });
  }),
  totpConfirm: handle(async (req, res) => {
    const body = z.object({ code: totpCode }).strict().parse(req.body);
    res.json({ data: await adminMfaService.confirmAdditionalTotp(userId(req), z.string().uuid().parse(req.params.id), body.code, meta(req)) });
  }),
  totpDisable: handle(async (req, res) => {
    await adminMfaService.disableTotp(userId(req), z.string().uuid().parse(req.params.id), meta(req));
    res.status(204).end();
  }),
  recoveryRegenerate: handle(async (req, res) => { res.json({ data: await adminMfaService.regenerateRecoveryCodes(userId(req), meta(req)) }); }),
  passkeyOptions: handle(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId(req) }, select: { id: true, email: true, firstName: true, lastName: true, passwordHash: true } });
    res.json({ data: await adminMfaService.passkeyRegistrationOptions(user, session(req).familyId) });
  }),
  passkeyRegister: handle(async (req, res) => {
    const body = z.object({ response: webauthnResponse, label }).strict().parse(req.body);
    res.status(201).json({ data: await adminMfaService.registerPasskey(userId(req), session(req).familyId, body.response as never, body.label, meta(req)) });
  }),
  passkeyRename: handle(async (req, res) => {
    const body = z.object({ label }).strict().parse(req.body);
    await adminMfaService.renamePasskey(userId(req), z.string().uuid().parse(req.params.id), body.label);
    res.status(204).end();
  }),
  passkeyRevoke: handle(async (req, res) => {
    await adminMfaService.revokePasskey(userId(req), z.string().uuid().parse(req.params.id), meta(req));
    res.status(204).end();
  }),
  sessions: handle(async (req, res) => { res.json(await adminAccountService.sessions(userId(req), session(req).familyId)); }),
  revokeSession: handle(async (req, res) => {
    const familyId = z.string().uuid().parse(req.params.id);
    // Ending another device's session is sensitive; ending your own current session is a sign-out and needs no step-up.
    if (familyId !== session(req).familyId && !hasRecentStepUp(session(req))) {
      throw new AppError('Confirm it is you to continue.', 403, 'STEP_UP_REQUIRED');
    }
    await adminAccountService.revokeSession(userId(req), familyId, 'REVOKED_BY_USER', meta(req));
    res.json({ data: { revoked: true, current: familyId === session(req).familyId } });
  }),
  changePassword: handle(async (req, res) => {
    const body = z.object({ currentPassword, newPassword: password }).strict().parse(req.body);
    await adminAccountService.changePassword(userId(req), body, req.id);
    // Every session, this one included, is revoked: drop the refresh cookie so the browser cannot try to restore it.
    clearRefreshCookie(res);
    res.json({ data: { changed: true, signInRequired: true } });
  }),
  deleteAccount: handle(async (req, res) => {
    const body = z.object({ currentPassword, confirmation: z.literal('DELETE', { message: 'Type DELETE to confirm.' }) })
      .strict().parse(req.body);
    await adminAccountService.deleteSelf(userId(req), body.currentPassword, meta(req), req.id);
    clearRefreshCookie(res);
    res.json({ data: { deleted: true } });
  }),
  revokeOtherSessions: handle(async (req, res) => {
    res.json({ data: await adminAccountService.revokeOtherSessions(userId(req), session(req).familyId, meta(req)) });
  }),
  loginHistory: handle(async (req, res) => {
    const query = page.parse(req.query);
    res.json(await adminAccountService.loginHistory(userId(req), query.page, query.pageSize));
  }),

  // ── Team (MANAGE_ADMINS) ───────────────────────────────────────────────
  administrators: handle(async (req, res) => {
    const query = page.extend({ search: z.string().trim().max(100).optional() }).parse(req.query);
    res.json(await adminTeamService.listAdministrators({ ...query, actorId: userId(req) }));
  }),
  invitations: handle(async (req, res) => {
    const query = page.extend({ status: z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']).optional() }).parse(req.query);
    res.json(await adminTeamService.listInvitations(query));
  }),
  createInvitation: handle(async (req, res) => {
    const body = z.object({ email: z.string().trim().email().max(255), grantManageAdmins: z.boolean().default(false) }).strict().parse(req.body);
    res.status(201).json({ data: await adminTeamService.createInvitation({ userId: userId(req), requestId: req.id }, body) });
  }),
  resendInvitation: handle(async (req, res) => {
    res.json({ data: await adminTeamService.resendInvitation({ userId: userId(req), requestId: req.id }, z.string().uuid().parse(req.params.id)) });
  }),
  revokeInvitation: handle(async (req, res) => {
    res.json({ data: await adminTeamService.revokeInvitation({ userId: userId(req), requestId: req.id }, z.string().uuid().parse(req.params.id)) });
  }),
  requestActivation: handle(async (req, res) => {
    res.status(201).json({ data: await adminActivationService.request({ userId: userId(req), requestId: req.id }, z.string().uuid().parse(req.params.id)) });
  }),
  activationState: handle(async (req, res) => { res.json({ data: await adminActivationService.state(z.string().uuid().parse(req.params.id)) }); }),
  resendActivation: handle(async (req, res) => {
    res.json({ data: await adminActivationService.resend({ userId: userId(req), requestId: req.id }, z.string().uuid().parse(req.params.id)) });
  }),
  revokeActivation: handle(async (req, res) => {
    res.json({ data: await adminActivationService.revoke({ userId: userId(req), requestId: req.id }, z.string().uuid().parse(req.params.id)) });
  }),
  setAccess: handle(async (req, res) => {
    const body = z.object({ isActive: z.boolean().optional(), canManageAdmins: z.boolean().optional() }).strict()
      .refine(value => value.isActive !== undefined || value.canManageAdmins !== undefined, 'Nothing to change.').parse(req.body);
    res.json({ data: await adminTeamService.setAccess({ userId: userId(req), requestId: req.id }, z.string().uuid().parse(req.params.id), body) });
  }),
};
