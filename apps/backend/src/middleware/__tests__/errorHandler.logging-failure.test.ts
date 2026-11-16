import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { AppError, errorHandler } from '../errorHandler.js';
import { logger } from '../../utils/logger.js';

// A logging fault while an error response is being produced must not replace that response,
// must keep the sanitized Prisma classification, and must not leak the raw engine message.
const engineMessage = 'Transaction already closed: SELECT "cardLast4" FROM payments WHERE "clientSecret" = \'pi_123_secret_abc\' token=eyJhbGciOiJIUzI1NiJ9.e30.sig';
function app(error: () => Error) {
  const server = express();
  server.use((req, _res, next) => { (req as express.Request & { id: string }).id = 'req-logging-failure'; next(); });
  server.get('/fail', (_req, _res, next) => next(error()));
  server.use(errorHandler);
  return server;
}
afterEach(() => { vi.restoreAllMocks(); });

describe('error responses survive a failing logger', () => {
  it.each(['P2024', 'P2028', 'P2034'])('handled 503 keeps its status, body and sanitized %s classification', async code => {
    vi.spyOn(logger, 'error').mockImplementation(() => { throw new Error('logging transport unavailable'); });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const cause = new Prisma.PrismaClientKnownRequestError(engineMessage, { code, clientVersion: 'test' });
    const response = await request(app(() => new AppError('Payment is temporarily unavailable. Your existing attempt can be recovered safely.', 503, 'PAYMENT_UNAVAILABLE', true, cause))).get('/fail');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: { code: 'PAYMENT_UNAVAILABLE', message: 'Payment is temporarily unavailable. Your existing attempt can be recovered safely.' } });
    const fallback = stderr.mock.calls.map(([line]) => String(line)).join('');
    expect(fallback).toContain('logging.synchronous_failure');
    expect(fallback).toContain(`"code":"${code}"`);
    expect(fallback).toContain('req-logging-failure');
    expect(fallback).not.toMatch(/cardLast4|clientSecret|pi_123_secret_abc|eyJhbGci|logging transport unavailable/);
  });
  it('an error without a Prisma code is not given one', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => { throw new Error('logging transport unavailable'); });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const response = await request(app(() => new AppError('Payment is temporarily unavailable.', 503, 'PAYMENT_UNAVAILABLE', true, new Error('socket hang up')))).get('/fail');
    expect(response.status).toBe(503);
    expect(stderr.mock.calls.map(([line]) => String(line)).join('')).not.toMatch(/"code":"P\d{4}"/);
  });
  it('an unexpected error still returns the generic 500 when logging and its fallback both fail', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => { throw new Error('logging transport unavailable'); });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => { throw new Error('stderr closed'); });
    const response = await request(app(() => new Error(engineMessage))).get('/fail');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong. Please try again later.' } });
    expect(JSON.stringify(response.body)).not.toMatch(/SELECT|secret|eyJ/);
  });
});
