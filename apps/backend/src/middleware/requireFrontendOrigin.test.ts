import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from './errorHandler.js';
import { requireFrontendOrigin } from './requireFrontendOrigin.js';

function invoke(origin: string | undefined, cookies?: Record<string, string>) {
  const req = { get: vi.fn().mockReturnValue(origin), cookies: cookies ?? {} } as unknown as Request;
  const next = vi.fn() as unknown as NextFunction;
  requireFrontendOrigin(req, {} as Response, next);
  return next as unknown as ReturnType<typeof vi.fn>;
}

describe('requireFrontendOrigin', () => {
  it('allows the configured frontend origin', () => {
    const next = invoke('http://localhost:3000');
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('allows requests with missing Origin when no refresh cookie is present', () => {
    const next = invoke(undefined, {});
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it.each(['https://attacker.invalid', 'http://localhost:3000/extra'])('rejects non-exact Origin %s', origin => {
    const next = invoke(origin);
    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 403, code: 'REQUEST_ORIGIN_INVALID' });
  });

  it('rejects missing Origin when refresh cookie is attached', () => {
    const next = invoke(undefined, { electrohub_customer_refresh: 'sample-cookie' });
    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 403, code: 'REQUEST_ORIGIN_INVALID' });
  });
});
