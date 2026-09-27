import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { googleProvider, GoogleIdentity } from '../providers/google.provider.js';
import { GoogleService } from '../services/google.service.js';
import { AppError } from '../middleware/errorHandler.js';
import { setRefreshCookie } from './auth.controller.js';
import { logger } from '../utils/logger.js';
import { createAccountDeletionProof } from '../services/account-deletion-proof.js';

const service = new GoogleService();
const cookieName = 'electrohub_google_transaction';
const clearOptions = { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/api/auth/google' };
const cookieOptions = { ...clearOptions, maxAge: 5 * 60 * 1000 };
const transactionSchema = z.object({
  state: z.string().min(32), verifier: z.string().min(32), nonce: z.string().min(32), expiresAt: z.number(),
  channel: z.string().uuid().optional(),
  intent: z.literal('ACCOUNT_DELETION').optional(),
  userId: z.string().uuid().optional(),
  identity: z.object({ sub: z.string().min(1), email: z.string().email(), firstName: z.string(), lastName: z.string() }).optional(),
}).superRefine((data, context) => {
  if ((data.intent === 'ACCOUNT_DELETION') !== Boolean(data.userId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid OAuth intent' });
  }
});

function configuration() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI || !env.FRONTEND_URL || !env.JWT_SECRET || env.JWT_SECRET.length < 16) {
    throw new AppError('Google sign-in is currently unavailable.', 503, 'GOOGLE_NOT_CONFIGURED');
  }
  const frontendOrigin = new URL(env.FRONTEND_URL).origin;
  const callback = new URL(env.GOOGLE_REDIRECT_URI);
  const localCallback = env.NODE_ENV === 'development' && callback.origin === `http://localhost:${env.PORT}` && frontendOrigin === 'http://localhost:3000';
  if ((!localCallback && callback.origin !== frontendOrigin) || callback.pathname !== '/api/auth/google/callback' || callback.search || callback.hash) {
    throw new AppError('Google sign-in is currently unavailable.', 503, 'GOOGLE_NOT_CONFIGURED');
  }
  return { frontendOrigin, secret: env.JWT_SECRET };
}

function seal(data: z.infer<typeof transactionSchema>) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', configuration().secret).update(payload).digest('base64url')}`;
}

export function readGoogleTransaction(value: unknown) {
  try {
    if (typeof value !== 'string' || value.length > 4096) throw new Error();
    const [payload, signature, extra] = value.split('.');
    const expected = crypto.createHmac('sha256', configuration().secret).update(payload).digest();
    const received = Buffer.from(signature, 'base64url');
    if (extra || expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) throw new Error();
    const data = transactionSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    if (data.expiresAt <= Date.now()) throw new Error();
    return data;
  } catch {
    throw new AppError('Google sign-in expired. Please try again.', 400, 'GOOGLE_STATE_INVALID');
  }
}

function popup(res: Response, status: string, returnToFrontend = true, channel?: string) {
  const origin = new URL(env.FRONTEND_URL || 'http://localhost:3000').origin;
  if (returnToFrontend && env.GOOGLE_REDIRECT_URI && new URL(env.GOOGLE_REDIRECT_URI).origin !== origin) {
    if (env.JWT_SECRET) {
      const payload = Buffer.from(JSON.stringify({ status, channel, expiresAt: Date.now() + 30000 })).toString('base64url');
      const signature = crypto.createHmac('sha256', env.JWT_SECRET).update(payload).digest('base64url');
      res.cookie(`${cookieName}_completion`, `${payload}.${signature}`, { ...clearOptions, maxAge: 30000 });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    return res.redirect(303, `${origin}/api/auth/google/complete`);
  }
  const nonce = crypto.randomBytes(24).toString('base64url');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`);
  const message = JSON.stringify({ type: 'electrohub-google', status }).replace(/</g, '\\u003c');
  res.type('html').send(`<!doctype html><html><head><title>Google sign-in</title></head><body><p id="status">Completing Google sign-in...</p><script nonce="${nonce}">if(window.opener){window.opener.postMessage(${message},${JSON.stringify(origin)});window.close();}else if(${JSON.stringify(channel || '')}&&typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel(${JSON.stringify(`electrohub-google-${channel || ''}`)});channel.postMessage(${message});setTimeout(()=>{channel.close();window.close();},100);}else{document.getElementById('status').textContent='You may close this window.';}</script></body></html>`);
}

export const completeGoogle = (req: Request, res: Response) => {
  res.clearCookie(`${cookieName}_completion`, clearOptions);
  try {
    const value: unknown = req.cookies?.[`${cookieName}_completion`];
    if (typeof value !== 'string' || value.length > 1024 || !env.JWT_SECRET) throw new Error();
    const [payload, signature, extra] = value.split('.');
    const expected = crypto.createHmac('sha256', env.JWT_SECRET).update(payload).digest();
    const received = Buffer.from(signature, 'base64url');
    if (extra || received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) throw new Error();
    const completion = z.object({ status: z.enum(['success', 'failure', 'cancelled', 'linking_required']), channel: z.string().uuid().optional(), expiresAt: z.number() }).parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    if (completion.expiresAt <= Date.now()) throw new Error();
    popup(res, completion.status, false, completion.channel);
  } catch { popup(res, 'failure', false); }
};

function createAuthorization(data: z.infer<typeof transactionSchema>) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: env.GOOGLE_REDIRECT_URI!, response_type: 'code', scope: 'openid email profile', state: data.state, nonce: data.nonce, code_challenge: crypto.createHash('sha256').update(data.verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'select_account' }).toString();
  return url.toString();
}

function createTransaction(channel?: string, userId?: string) {
  return {
    state: crypto.randomBytes(32).toString('base64url'),
    verifier: crypto.randomBytes(32).toString('base64url'),
    nonce: crypto.randomBytes(32).toString('base64url'),
    expiresAt: Date.now() + cookieOptions.maxAge,
    channel,
    ...(userId ? { intent: 'ACCOUNT_DELETION' as const, userId } : {}),
  };
}

export const startGoogle = (req: Request, res: Response) => {
  try {
    configuration();
    const channel = z.string().uuid().optional().parse(req.query.channel);
    const data = createTransaction(channel);
    res.cookie(cookieName, seal(data), cookieOptions);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    res.redirect(createAuthorization(data));
  } catch { popup(res, 'failure'); }
};

export const prepareGoogleDeletionReauth = (req: Request, res: Response, next: NextFunction) => {
  try {
    const { frontendOrigin } = configuration();
    if (req.get('origin') !== frontendOrigin) throw new AppError('Unable to verify this request. Please try again.', 403, 'ACCOUNT_DELETION_ORIGIN_INVALID');
    const { channel } = z.object({ channel: z.string().uuid() }).parse(req.body);
    const data = createTransaction(channel, req.user!.userId);
    res.cookie(cookieName, seal(data), cookieOptions);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ authorizationUrl: createAuthorization(data) });
  } catch (error) {
    if (error instanceof z.ZodError) return next(new AppError('Unable to start Google verification. Please try again.', 400, 'GOOGLE_STATE_INVALID'));
    next(error);
  }
};

export const callbackGoogle = async (req: Request, res: Response) => {
  let channel: string | undefined;
  try {
    const data = readGoogleTransaction(req.cookies?.[cookieName]);
    channel = data.channel;
    res.clearCookie(cookieName, clearOptions);
    if (typeof req.query.state !== 'string' || req.query.state !== data.state || data.identity) throw new Error('Invalid state');
    if (req.query.error === 'access_denied') return popup(res, 'cancelled', true, channel);
    if (typeof req.query.code !== 'string' || req.query.code.length > 4096) throw new Error('Invalid code');
    const identity: GoogleIdentity = await googleProvider.verifyCode(req.query.code, data.verifier, data.nonce);
    if (data.intent === 'ACCOUNT_DELETION' && data.userId) {
      await service.verifyDeletionIdentity(data.userId, identity.sub);
      res.cookie('electrohub_account_deletion_proof', createAccountDeletionProof(data.userId), {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/api/account',
        maxAge: 5 * 60 * 1000,
      });
      return popup(res, 'success', true, channel);
    }
    const result = await service.signIn(identity);
    if ('linkingRequired' in result) {
      res.cookie(cookieName, seal({ ...data, identity, expiresAt: Date.now() + cookieOptions.maxAge }), cookieOptions);
      return popup(res, 'linking_required', true, channel);
    }
    setRefreshCookie(res, result.refreshToken);
    popup(res, 'success', true, channel);
  } catch {
    res.clearCookie(cookieName, clearOptions);
    logger.warn('GOOGLE_AUTH_FAILED');
    popup(res, 'failure', true, channel);
  }
};

export const linkGoogle = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { frontendOrigin } = configuration();
    if (req.headers.origin !== frontendOrigin) throw new AppError('Unable to connect Google. Please try again.', 403, 'GOOGLE_ORIGIN_INVALID');
    const { password } = z.object({ password: z.string().min(1).max(128) }).parse(req.body);
    const data = readGoogleTransaction(req.cookies?.[cookieName]);
    if (!data.identity) throw new AppError('Please sign in with Google again.', 400, 'GOOGLE_STATE_INVALID');
    const result = await service.link(data.identity, password);
    res.clearCookie(cookieName, clearOptions);
    setRefreshCookie(res, result.refreshToken);
    res.json({ user: result.user, accessToken: result.accessToken });
  } catch (error) {
    if (error instanceof z.ZodError) return next(new AppError('Enter your account password.', 400, 'VALIDATION_ERROR'));
    next(error);
  }
};
