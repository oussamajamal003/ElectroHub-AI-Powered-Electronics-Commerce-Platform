import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { generateAccessToken } from '../../utils/jwt.js';
import { AuthService } from '../../services/auth.service.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';

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
  logSafely: vi.fn(),
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

it('records a swallowed logout failure while preserving its successful cookie response', async () => {
  const failure = new Error('Synthetic logout storage failure');
  const logout = vi.spyOn(AuthService.prototype, 'logout').mockRejectedValueOnce(failure);
  const response = await request(app).post('/api/auth/logout').set('Cookie', 'electrohub_refresh=fixture');
  expect(response.status).toBe(200);
  expect(logger.error).toHaveBeenCalledWith('AUTH_LOGOUT_FAILURE', expect.objectContaining({ error: failure }));
  logout.mockRestore();
});

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
    id: '11111111-1111-4111-8111-111111111111',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    passwordHash: 'hashedpassword',
    isActive: true,
    roleId: '22222222-2222-4222-8222-222222222222',
    role: { id: '22222222-2222-4222-8222-222222222222', name: 'CUSTOMER' },
  };

  it('1. Valid authenticated user -> 200', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.user.findUnique).mockResolvedValue(validUser as any);
    const token = generateAccessToken({ userId: validUser.id, role: 'CUSTOMER' });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.id).toBe(validUser.id);
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
    const token = generateAccessToken({ userId: '33333333-3333-4333-8333-333333333333', role: 'CUSTOMER' });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('5. Valid user returned with safe fields only', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.user.findUnique).mockResolvedValue(validUser as any);
    const token = generateAccessToken({ userId: validUser.id, role: 'CUSTOMER' });

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
    const token = generateAccessToken({ userId: validUser.id, role: 'CUSTOMER' });

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

  it('returns 401 when refresh token cookie is missing', async () => {
    const response = await request(app).post('/api/auth/refresh');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Refresh token missing' });
  });

  it('rejects whitespace-only or empty refresh token cookie with 401', async () => {
    const response = await request(app).post('/api/auth/refresh').set('Cookie', 'electrohub_refresh=   ');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Refresh token missing' });
  });

  it('sets cookie scoped to Path=/api/auth upon successful rotation', async () => {
    const refresh = vi.spyOn(AuthService.prototype, 'refreshSession').mockResolvedValueOnce({
      accessToken: 'new-access-token-123',
      refreshToken: 'new-raw-refresh-token-456',
      userId: 'usr-123',
      user: { id: 'usr-123', email: 'a@example.invalid', firstName: 'A', lastName: 'B', role: 'CUSTOMER', authMethods: { password: true, google: false } },
    });

    const response = await request(app).post('/api/auth/refresh').set('Cookie', 'electrohub_refresh=valid-old-token');
    expect(response.status).toBe(200);
    // The identity rides along (same shape as /me); the refresh token itself never appears in the body.
    expect(response.body).toEqual({ accessToken: 'new-access-token-123',
      user: { id: 'usr-123', email: 'a@example.invalid', firstName: 'A', lastName: 'B', role: 'CUSTOMER', authMethods: { password: true, google: false } } });
    expect(JSON.stringify(response.body)).not.toContain('new-raw-refresh-token-456');
    expect(response.headers['set-cookie']).toBeDefined();
    expect(response.headers['set-cookie'][0]).toContain('Path=/api/auth');
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    refresh.mockRestore();
  });

  it('clears both /api/auth and legacy /api/auth/refresh cookies on logout', async () => {
    const logoutSpy = vi.spyOn(AuthService.prototype, 'logout').mockResolvedValueOnce();

    const response = await request(app).post('/api/auth/logout').set('Cookie', 'electrohub_refresh=valid-cookie-to-logout');
    expect(response.status).toBe(200);
    expect(logoutSpy).toHaveBeenCalledWith('valid-cookie-to-logout');
    expect(response.headers['set-cookie']).toBeDefined();
    const rawSetCookies = response.headers['set-cookie'];
    const setCookies = Array.isArray(rawSetCookies) ? rawSetCookies : [String(rawSetCookies)];
    expect(setCookies.some((c: string) => c.includes('Path=/api/auth;') || c.includes('Path=/api/auth'))).toBe(true);
    expect(setCookies.some((c: string) => c.includes('Path=/api/auth/refresh'))).toBe(true);
    logoutSpy.mockRestore();
  });

  it('answers a concurrent rotation with 409 and a retry hint: no token, no cookie change, no sign-out', async () => {
    const refresh = vi.spyOn(AuthService.prototype, 'refreshSession').mockRejectedValueOnce(
      new AppError('Session refresh already in progress. Retry.', 409, 'REFRESH_ROTATION_IN_PROGRESS'));

    const response = await request(app).post('/api/auth/refresh').set('Cookie', 'electrohub_refresh=recently-rotated-token');
    expect(response.status).toBe(409);
    expect(response.headers['retry-after']).toBe('1');
    expect(response.body).toEqual({ error: { code: 'REFRESH_ROTATION_IN_PROGRESS', message: 'Session refresh already in progress. Retry.' } });
    expect(response.body.accessToken).toBeUndefined();
    // The cookie is neither overwritten nor cleared: the winning request owns the new one.
    expect(response.headers['set-cookie']).toBeUndefined();
    refresh.mockRestore();
  });

  it('clears cookie and returns 401 on AppError reuse detection', async () => {
    const refresh = vi.spyOn(AuthService.prototype, 'refreshSession').mockRejectedValueOnce(
      new AppError('Invalid or expired refresh token', 401, 'REFRESH_TOKEN_REUSED')
    );

    const response = await request(app).post('/api/auth/refresh').set('Cookie', 'electrohub_refresh=stolen-token');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid or expired refresh token' });
    expect(response.headers['set-cookie']).toBeDefined();
    expect(response.headers['set-cookie'][0]).toContain('electrohub_refresh=;');
    refresh.mockRestore();
  });

  it('clears cookie and returns 401 on AppError session revoked', async () => {
    const refresh = vi.spyOn(AuthService.prototype, 'refreshSession').mockRejectedValueOnce(
      new AppError('Invalid or expired refresh token', 401, 'SESSION_REVOKED')
    );

    const response = await request(app).post('/api/auth/refresh').set('Cookie', 'electrohub_refresh=logged-out-token');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid or expired refresh token' });
    expect(response.headers['set-cookie']).toBeDefined();
    refresh.mockRestore();
  });
});
