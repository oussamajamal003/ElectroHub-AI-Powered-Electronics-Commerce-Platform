import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { generateAccessToken } from '../../utils/jwt.js';
import { AuthService } from '../../services/auth.service.js';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    oAuthAccount: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Auth Controller - /api/auth/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(
      validUser as unknown as NonNullable<Awaited<ReturnType<typeof prisma.user.findFirst>>>,
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      validUser as unknown as NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>,
    );
    vi.mocked(prisma.oAuthAccount.findFirst).mockResolvedValue(null);
  });

  const validUser = {
    id: 'user-123',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    passwordHash: 'hashedpassword',
    isActive: true,
    roleId: 'role-123',
    role: { id: 'role-123', name: 'CUSTOMER' },
  };

  it('1. Valid authenticated user -> 200', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.user.findUnique).mockResolvedValue(validUser as any);
    const token = generateAccessToken({ userId: 'user-123', role: 'CUSTOMER' });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.id).toBe('user-123');
  });

  it('2. Missing token -> 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('3. Invalid token -> 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer invalid-token`);
    expect(res.status).toBe(401);
  });

  it('4. Valid token for missing user -> 401', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    const token = generateAccessToken({ userId: 'missing-user', role: 'CUSTOMER' });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('5. Valid user returned with safe fields only', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.user.findUnique).mockResolvedValue(validUser as any);
    const token = generateAccessToken({ userId: 'user-123', role: 'CUSTOMER' });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const returnedUser = res.body.user;
    expect(returnedUser.passwordHash).toBeUndefined();
    expect(returnedUser.roleId).toBeUndefined();
    expect(returnedUser.isActive).toBeUndefined();
    expect(returnedUser.authMethods).toEqual({ password: true, google: false });
    expect(Object.keys(returnedUser)).toEqual(['id', 'email', 'firstName', 'lastName', 'role', 'authMethods']);
  });

  it('6. Unexpected Prisma failure -> controlled 500', async () => {
    vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('Prisma connection lost'));
    const token = generateAccessToken({ userId: 'user-123', role: 'CUSTOMER' });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
  });
});

describe('Auth refresh cookie preservation', () => {
  it('keeps the refresh cookie on a transient backend failure', async () => {
    const refresh = vi.spyOn(AuthService.prototype, 'refreshSession').mockRejectedValueOnce(new Error('Temporary database failure'));
    const response = await request(app).post('/api/auth/refresh').set('Cookie', 'electrohub_refresh=valid-token');
    expect(response.status).toBe(500);
    expect(response.headers['set-cookie']).toBeUndefined();
    refresh.mockRestore();
  });
  it('clears the cookie for a confirmed invalid refresh token', async () => {
    const refresh = vi.spyOn(AuthService.prototype, 'refreshSession').mockRejectedValueOnce(new Error('Invalid or expired refresh token'));
    const response = await request(app).post('/api/auth/refresh').set('Cookie', 'electrohub_refresh=invalid-token');
    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeDefined();
    refresh.mockRestore();
  });
});
