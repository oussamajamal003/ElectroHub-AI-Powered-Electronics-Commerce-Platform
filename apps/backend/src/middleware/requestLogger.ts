import type { Request, Response, NextFunction } from 'express';
import { logSafely } from '../utils/logger.js';
import { logContext } from '../utils/logContext.js';
import { trackHttpRequest } from '../lib/db-request-metrics.js';

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
  const start = performance.now();
  const json = res.json;
  res.json = function (body: unknown): Response {
    // Record only the public error code, never the response payload.
    if (body && typeof body === 'object' && 'error' in body) {
      const error = body.error;
      if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(error.code)) {
        res.locals.errorCode = error.code;
      }
    }
    return json.call(this, body);
  };

  logSafely('info', 'HTTP request started', { operation: 'http.started', requestId: req.id, method: req.method });
  let completed = false;
  const untrack = trackHttpRequest();
  const complete = (aborted: boolean) => {
    if (completed) return;
    completed = true;
    untrack();
    const duration = Math.round((performance.now() - start) * 100) / 100;

    const failed = aborted || res.statusCode >= 400;
    const level = failed && !res.locals.errorLogged ? 'error' : 'info';
    logSafely(level, 'HTTP request', {
      operation: aborted ? 'http.aborted' : 'http.completed',
      requestId: req.id,
      method: req.method,
      route: req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched',
      statusCode: res.statusCode,
      durationMs: duration,
      code: failed ? res.locals.errorCode ?? `HTTP_${aborted ? 'ABORTED' : res.statusCode}` : undefined,
    });
  };
  res.once('finish', () => complete(false));
  res.once('close', () => complete(!res.writableFinished));

  logContext.run({ requestId: req.id }, next);
}
