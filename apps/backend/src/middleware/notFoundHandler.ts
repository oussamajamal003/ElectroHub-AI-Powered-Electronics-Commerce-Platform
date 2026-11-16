import type { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';

/**
 * 404 Not Found Middleware.
 * Catches requests that didn't match any route and forwards an AppError
 * to the global error handler.
 */
export function notFoundHandler(req: Request, res: Response, next: NextFunction): void {
  const err = new AppError(`Route ${req.method} ${req.originalUrl} not found`, 404, 'NOT_FOUND');
  next(err);
}
