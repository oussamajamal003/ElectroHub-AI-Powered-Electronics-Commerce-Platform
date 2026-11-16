import { describe, it, expect, vi } from 'vitest';
import { requestId } from '../src/middleware/requestId.js';
import type { Request, Response } from 'express';

describe('requestId middleware', () => {
  it('should use existing x-request-id header if provided and safe length', () => {
    const req = {
      headers: {
        'x-request-id': 'client-provided-id-123',
      },
    } as unknown as Request;

    const res = {
      setHeader: vi.fn(),
    } as unknown as Response;

    const next = vi.fn();

    requestId(req, res, next);

    expect(req.id).toBe('client-provided-id-123');
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'client-provided-id-123');
    expect(next).toHaveBeenCalledOnce();
  });

  it('should generate a new UUID if no header is provided', () => {
    const req = {
      headers: {},
    } as unknown as Request;

    const res = {
      setHeader: vi.fn(),
    } as unknown as Response;

    const next = vi.fn();

    requestId(req, res, next);

    expect(req.id).toBeDefined();
    expect(req.id.length).toBeGreaterThan(0);
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.id);
    expect(next).toHaveBeenCalledOnce();
  });

  it('should generate a new UUID if header is too long (injection protection)', () => {
    const longId = 'a'.repeat(101);
    const req = {
      headers: {
        'x-request-id': longId,
      },
    } as unknown as Request;

    const res = {
      setHeader: vi.fn(),
    } as unknown as Response;

    const next = vi.fn();

    requestId(req, res, next);

    expect(req.id).toBeDefined();
    expect(req.id).not.toBe(longId);
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.id);
    expect(next).toHaveBeenCalledOnce();
  });
});
