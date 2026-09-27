import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { AccountDeletionService } from '../services/account-deletion.service.js';
import { verifyAccountDeletionProof } from '../services/account-deletion-proof.js';
import { clearRefreshCookie } from './auth.controller.js';

const service = new AccountDeletionService();
const proofCookie = 'electrohub_account_deletion_proof';
const proofCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/account',
};

function requireFrontendOrigin(req: Request) {
  let expected: string;
  try { expected = new URL(env.FRONTEND_URL ?? 'http://localhost:3000').origin; }
  catch { throw new AppError('Account deletion is currently unavailable.', 503, 'ACCOUNT_DELETION_UNAVAILABLE'); }
  if (req.get('origin') !== expected) throw new AppError('Unable to verify this request. Please try again.', 403, 'ACCOUNT_DELETION_ORIGIN_INVALID');
}

export const reauthenticateDeletionWithPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireFrontendOrigin(req);
    const { password } = z.object({ password: z.string().min(1).max(128) }).parse(req.body);
    const proof = await service.verifyPassword(req.user!.userId, password);
    res.cookie(proofCookie, proof, { ...proofCookieOptions, maxAge: 5 * 60 * 1000 });
    res.status(200).json({ message: 'Identity verified. Confirm account deletion to continue.' });
  } catch (error) {
    if (error instanceof z.ZodError) return next(new AppError('Enter your current password.', 400, 'VALIDATION_ERROR'));
    next(error);
  }
};

export const deleteCurrentAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireFrontendOrigin(req);
    const { confirmation } = z.object({ confirmation: z.literal('DELETE') }).parse(req.body);
    if (confirmation !== 'DELETE') throw new AppError('Type DELETE to confirm account deletion.', 400, 'ACCOUNT_DELETION_CONFIRMATION_INVALID');
    verifyAccountDeletionProof(req.cookies?.[proofCookie], req.user!.userId);
    await service.deleteAccount(req.user!.userId);
    res.clearCookie(proofCookie, proofCookieOptions);
    clearRefreshCookie(res);
    res.status(200).json({ message: 'Your account has been deleted.' });
  } catch (error) {
    if (error instanceof z.ZodError) return next(new AppError('Type DELETE to confirm account deletion.', 400, 'ACCOUNT_DELETION_CONFIRMATION_INVALID'));
    next(error);
  }
};
