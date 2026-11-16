import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';

const database = vi.hoisted(() => ({ user: { findFirst: vi.fn() } }));
vi.mock('../../lib/prisma.js', () => ({ prisma: database }));
vi.mock('../../utils/logger.js', () => ({ logger: { warn: vi.fn() } }));

const userId = '11111111-1111-4111-8111-111111111111';
import { JWT_SECRET, verifyAccessToken } from '../../utils/jwt.js';
import { requireAuth, requireRole } from '../auth.js';

beforeEach(() => {
  vi.clearAllMocks();
  database.user.findFirst.mockResolvedValue({ id: userId, role: { name: 'CUSTOMER' } });
});

function requestWith(token: string) {
  return { headers: { authorization: `Bearer ${token}` } } as Request;
}
function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
}

describe('authentication trust boundary', () => {
  it('rejects tokens signed with the former public development fallback', async () => {
    const forged = jwt.sign({ userId, role: 'CUSTOMER' }, 'dev_secret_key_change_me_in_prod', { expiresIn: '1m' });
    expect(() => verifyAccessToken(forged)).toThrow();
    const request = requestWith(forged);
    const result = response();
    const next = vi.fn();
    await requireAuth(request, result, next);
    expect(result.status).toHaveBeenCalledWith(401);
    expect(database.user.findFirst).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('uses the current database role rather than trusting a token ADMIN claim', async () => {
    database.user.findFirst.mockResolvedValue({ id: userId, role: { name: 'CUSTOMER' } });
    const request = requestWith(jwt.sign({ userId, role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1m' }));
    const result = response();
    const next = vi.fn();
    await requireAuth(request, result, next);
    expect(request.user?.role).toBe('CUSTOMER');
    next.mockClear();
    requireRole('ADMIN')(request, result, next);
    expect(result.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an inactive or missing account despite a valid signature', async () => {
    database.user.findFirst.mockResolvedValue(null);
    const result = response();
    const next = vi.fn();
    await requireAuth(requestWith(jwt.sign({ userId, role: 'CUSTOMER' }, JWT_SECRET, { expiresIn: '1m' })), result, next);
    expect(result.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
