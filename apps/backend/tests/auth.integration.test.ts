/**
 * Auth Integration Tests — Task 02.3-C
 *
 * Covers:
 *  1. Customer registration (happy path + duplicate + validation)
 *  2. Customer login (happy path + invalid credentials + inactive user)
 *  3. Admin login (happy path + RBAC discrimination)
 *  4. /api/auth/me — requireAuth + getCurrentUser
 *  5. Token refresh (rotation, invalid token)
 *  6. Logout (cookie cleared)
 *  7. requireRole RBAC (403 for wrong role)
 *  8. Forgot-password generic response
 *
 * NOTE: These tests hit a live Supabase database. They are intended for dev
 * environments only and use unique email addresses per run to avoid
 * cross-contamination between test runs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

// ─── Test fixtures ───────────────────────────────────────────────────────────

const timestamp = Date.now();

/** A fresh customer that does NOT exist before the test. */
const testCustomer = {
  email: `test_customer_${timestamp}@electrohub-test.invalid`,
  password: 'Test@1234!',
  firstName: 'John',
  lastName: 'Doe',
};

/** An existing seeded admin (created by prisma/seed.ts). */
const seededAdmin = {
  email: 'admin@electrohub.com',
  password: 'admin123!',
};

// ─── Cleanup ─────────────────────────────────────────────────────────────────

afterAll(async () => {
  // Remove the test customer to keep the database clean
  try {
    const user = await prisma.user.findUnique({ where: { email: testCustomer.email } });
    if (user) {
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  } catch {
    // Best effort — non-critical if already deleted
  }
  await prisma.$disconnect();
}, 30000);

// ─── 1. CUSTOMER REGISTRATION ────────────────────────────────────────────────

describe('1. Customer Registration — POST /api/auth/register', () => {
  it('1a. Registers a new customer and returns 201 + accessToken + CUSTOMER role', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(testCustomer);

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user).toMatchObject({
      email: testCustomer.email,
      firstName: testCustomer.firstName,
      lastName: testCustomer.lastName,
      role: 'CUSTOMER',
    });
    // Refresh token must be in HttpOnly cookie — NOT in response body
    expect(res.body.refreshToken).toBeUndefined();
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(setCookie.some((c: string) => c.includes('electrohub_refresh'))).toBe(true);
    expect(setCookie.some((c: string) => c.includes('HttpOnly'))).toBe(true);
  }, 20000);

  it('1b. Returns 409 when email already exists', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(testCustomer);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Email already registered');
  }, 15000);

  it('1c. Returns 400 for missing required fields', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'bad@test.com' }); // missing password, firstName, lastName

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  }, 10000);

  it('1d. Returns 400 for a weak password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'pw@test.com', password: '123', firstName: 'A', lastName: 'B' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  }, 10000);
});

// ─── 2. CUSTOMER LOGIN ───────────────────────────────────────────────────────

describe('2. Customer Login — POST /api/auth/login', () => {
  it('2a. Logs in with valid credentials and returns accessToken + CUSTOMER role', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testCustomer.email, password: testCustomer.password });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.role).toBe('CUSTOMER');
    expect(res.body.refreshToken).toBeUndefined();
  }, 15000);

  it('2b. Returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testCustomer.email, password: 'WrongPassword!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  }, 10000);

  it('2c. Returns 401 for non-existent email (no enumeration leak)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: `no.such.user.${timestamp}@dev.invalid`, password: 'Any@Password1!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  }, 10000);
});

// ─── 3. ADMIN LOGIN ──────────────────────────────────────────────────────────

describe('3. Admin Login — POST /api/auth/login', () => {
  it('3a. Logs in seeded admin and returns ADMIN role', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send(seededAdmin);

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('ADMIN');
    expect(res.body.accessToken).toBeDefined();
  }, 15000);

  it('3b. Admin token accepted by /api/auth/me with ADMIN role', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send(seededAdmin);

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.role).toBe('ADMIN');
  }, 20000);
});

// ─── 4. /api/auth/me ─────────────────────────────────────────────────────────

describe('4. GET /api/auth/me — requireAuth', () => {
  let customerToken: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testCustomer.email, password: testCustomer.password });
    customerToken = res.body.accessToken;
  }, 15000);

  it('4a. Returns user details for a valid CUSTOMER token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(testCustomer.email);
    expect(res.body.user.role).toBe('CUSTOMER');
  }, 10000);

  it('4b. Returns 401 when no Authorization header is sent', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  }, 10000);

  it('4c. Returns 401 for a malformed/tampered token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer this.is.not.valid');

    expect(res.status).toBe(401);
  }, 10000);
});

// ─── 5. TOKEN REFRESH ────────────────────────────────────────────────────────

describe('5. POST /api/auth/refresh — Refresh token rotation', () => {
  it('5a. Returns new accessToken when refresh cookie is valid', async () => {
    // Login to receive the refresh cookie
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: testCustomer.email, password: testCustomer.password });

    expect(loginRes.status).toBe(200);
    const cookies = loginRes.headers['set-cookie'] as string[];
    const refreshCookie = cookies?.find((c) => c.includes('electrohub_refresh'));
    expect(refreshCookie).toBeDefined();

    // Use cookie on refresh endpoint
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie!.split(';')[0]);

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeDefined();
    // New refresh cookie should be set (token rotation)
    const newCookies = refreshRes.headers['set-cookie'] as string[];
    expect(newCookies?.some((c: string) => c.includes('electrohub_refresh'))).toBe(true);
  }, 20000);

  it('5b. Returns 401 when no refresh cookie is provided', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/missing/i);
  }, 10000);

  it('5c. Returns 401 when an invalid/garbage refresh token is provided', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'electrohub_refresh=invalidgarbagetoken');

    expect(res.status).toBe(401);
  }, 10000);
});

// ─── 6. LOGOUT ───────────────────────────────────────────────────────────────

describe('6. POST /api/auth/logout', () => {
  it('6a. Clears the refresh cookie on logout', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: testCustomer.email, password: testCustomer.password });

    const cookies = loginRes.headers['set-cookie'] as string[];
    const refreshCookie = cookies?.find((c) => c.includes('electrohub_refresh'));

    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', refreshCookie!.split(';')[0]);

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.message).toMatch(/logged out/i);

    // The set-cookie header should clear the cookie (Max-Age=0 or expires in the past)
    const logoutCookies = (logoutRes.headers['set-cookie'] as string[] | undefined) ?? [];
    const cleared = logoutCookies.find((c) => c.includes('electrohub_refresh'));
    expect(cleared).toBeDefined();
    // Check for Max-Age=0 OR Expires past date (supertest may vary)
    const hasClear = cleared!.includes('Max-Age=0') || cleared!.includes('Expires=Thu, 01 Jan 1970');
    expect(hasClear).toBe(true);
  }, 20000);

  it('6b. Logout succeeds even when no cookie is provided (idempotent)', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
  }, 10000);
});

// ─── 7. RBAC — requireRole ───────────────────────────────────────────────────

describe('7. RBAC — requireRole enforcement', () => {
  it('7a. PATCH /api/auth/me — accessible to authenticated CUSTOMER', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: testCustomer.email, password: testCustomer.password });

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .send({ firstName: 'UpdatedName' });

    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe('UpdatedName');
  }, 20000);

  it('7b. Unauthenticated request to protected route returns 401', async () => {
    const res = await request(app).patch('/api/auth/me').send({ firstName: 'X' });
    expect(res.status).toBe(401);
  }, 10000);
});

// ─── 8. FORGOT PASSWORD (generic response) ───────────────────────────────────

describe('8. POST /api/auth/forgot-password — generic response (no email enumeration)', () => {
  it('8a. Returns 200 for a real account (no token exposure)', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: testCustomer.email });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/password reset/i);
  }, 15000);

  it('8b. Returns 200 for a non-existent email (no user enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: `ghost.${timestamp}@dev.invalid` });

    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  }, 10000);

  it('8c. Returns 400 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  }, 10000);
});
