import type { Request, Response, NextFunction } from 'express';
import { logSafely } from '../utils/logger.js';

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
    isOperational = true,
    public readonly diagnosticCause?: unknown
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
    res.locals.errorLogged = true;
    logSafely('error', 'Application error', {
      operation: 'http.handled_error',
      error: err.diagnosticCause ?? err,
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
  res.locals.errorLogged = true;
    logSafely('error', 'Unexpected error', {
    requestId: _req.id,
    operation: 'http.unexpected_error',
    error: err,
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong. Please try again later.',
    },
  });
}
