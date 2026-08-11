import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

/**
 * HTTP request logging middleware.
 *
 * Logs:
 * - HTTP method
 * - Route
 * - Status code
 * - Response time (ms)
 *
 * Does not log sensitive request bodies by default.
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;

    logger.info('HTTP request', {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
    });
  });

  next();
}
