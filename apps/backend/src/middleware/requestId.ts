import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
  }
}

/**
 * Request ID middleware.
 * Generates a unique UUID for each incoming request if not provided by the client,
 * or sanitizes the provided one.
 * Attaches it to `req.id` and sets the `x-request-id` response header.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const headerId = req.headers['x-request-id'];
  
  // Use client ID if provided and safe length, otherwise generate new UUID
  const id = (typeof headerId === 'string' && headerId.length > 0 && headerId.length <= 100) 
    ? headerId 
    : randomUUID();

  req.id = id;
  res.setHeader('x-request-id', id);

  next();
}
