import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { AppError } from './errorHandler.js';

/** Require cookie-authenticated browser mutations to originate at the configured frontend. */
export function requireFrontendOrigin(req: Request, _res: Response, next: NextFunction): void {
  // If no Origin header is present and no refresh cookie is attached, allow the request
  // through to the controller (which will reject with 401 Unauthenticated / Refresh token missing).
  const origin = req.get('origin');
  const hasRefreshCookie = Boolean(
    req.cookies?.['electrohub_customer_refresh'] || req.cookies?.['electrohub_admin_refresh']
  );
  if (!origin && !hasRefreshCookie) {
    next();
    return;
  }

  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(env.FRONTEND_URL ?? 'http://localhost:3000').origin;
  } catch {
    next(new AppError('This request cannot be verified.', 503, 'FRONTEND_ORIGIN_UNAVAILABLE'));
    return;
  }

  if (origin !== expectedOrigin) {
    next(new AppError('Unable to verify this request. Please try again.', 403, 'REQUEST_ORIGIN_INVALID'));
    return;
  }

  next();
}
