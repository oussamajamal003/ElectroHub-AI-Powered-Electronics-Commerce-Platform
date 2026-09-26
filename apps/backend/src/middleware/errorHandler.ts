import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/**
 * Application error with structured code and status.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    isOperational = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * Global error handler middleware.
 *
 * Returns consistent error response structure:
 * { error: { code, message } }
 *
 * Never exposes stack traces or internal details to clients.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    logger.warn('Application error', {
      requestId: _req.id,
      code: err.code,
      statusCode: err.statusCode,
      message: err.message,
    });

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  // Unexpected errors
  logger.error('Unexpected error', {
    requestId: _req.id,
    message: err.message,
    stack: env.NODE_ENV !== 'production' ? err.stack : undefined,
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong. Please try again later.',
    },
  });
}
