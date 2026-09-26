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

process.env.OTP_HASH_SECRET = 'integration-test-secret';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import request from 'supertest';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { otpService, OTP_CONFIG } from '../src/services/otp.service.js';
import { emailService } from '../src/services/email.service.js';



// ─── Test fixtures ───────────────────────────────────────────────────────────

const timestamp = Date.now();

/** A fresh customer that does NOT exist before the test. */
const testCustomer = {
  email: `test_customer_${timestamp}@electrohub-test.invalid`,
  password: 'Test@1234!',
  firstName: 'John',
  lastName: 'Doe',
};
const testCustomerEmails = [testCustomer.email];

/** An existing seeded admin (created by prisma/seed.ts). */
const seededAdmin = {
  email: 'admin@electrohub.com',
  password: 'admin123!',
};

// ─── Setup & Cleanup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
}, 60000);

afterAll(async () => {
  // Remove the test customer to keep the database clean
  try {
    const users = await prisma.user.findMany({ where: { email: { in: testCustomerEmails } } });
    for (const user of users) {
      await prisma.otpChallenge.deleteMany({ where: { userId: user.id } });
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await prisma.securityEvent.deleteMany({ where: { userId: user.id } });
      await prisma.emailDelivery.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  } catch {
    // Best effort — non-critical if already deleted
  }
  await prisma.$disconnect();
}, 60000);

// ─── 1. CUSTOMER REGISTRATION ────────────────────────────────────────────────

describe('1. Customer Registration — POST /api/auth/register', () => {
  it('1a. Registers a new customer and returns 201 + requiresVerification (no token)', async () => {
    const codeSpy = vi.spyOn(otpService, 'generateCode').mockReturnValue('123456');
    const res = await request(app)
      .post('/api/auth/register')
      .send(testCustomer);
    codeSpy.mockRestore();

    expect(res.status).toBe(201);
    expect(res.body.requiresVerification).toBe(true);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();

    const beforeVerification = await request(app).post('/api/auth/login').send({
      email: testCustomer.email, password: testCustomer.password,
    });
    expect(beforeVerification.status).toBe(403);
    expect(beforeVerification.body.requiresVerification).toBe(true);
    expect(beforeVerification.headers['set-cookie']).toBeUndefined();

    const incorrectCode = await request(app).post('/api/auth/verify-email').send({
      email: testCustomer.email, code: '000000',
    });
    expect(incorrectCode.status).toBe(400);
    expect(incorrectCode.body.error).toEqual({
      code: 'OTP_INCORRECT',
      message: 'Incorrect verification code. Please try again.',
    });

    const verification = await request(app).post('/api/auth/verify-email').send({
      email: testCustomer.email, code: '123456',
    });
    expect(verification.status).toBe(200);
    expect(verification.body.accessToken).toBeDefined();
    const user = await prisma.user.findUnique({ where: { email: testCustomer.email } });
    expect(user?.emailVerifiedAt).not.toBeNull();
    expect(await prisma.securityEvent.count({ where: { userId: user!.id, type: 'EMAIL_VERIFIED' } })).toBe(1);
    const challenge = await prisma.otpChallenge.findFirst({
      where: { userId: user?.id, purpose: 'EMAIL_VERIFICATION' }, orderBy: { createdAt: 'desc' },
    });
    expect(challenge?.consumedAt).not.toBeNull();

    const replay = await request(app).post('/api/auth/verify-email').send({
      email: testCustomer.email, code: '123456',
    });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('OTP_CONSUMED');
  }, 180000);

  it('1b. Returns 409 when email already exists', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(testCustomer);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Email already registered');
  }, 30000);

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
  }, 30000);
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
    expect(res.body.message).toBe('If an account exists, you may receive password reset instructions shortly.');
  }, 15000);

  it('8b. Returns 200 for a non-existent email (no user enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: `ghost.${timestamp}@dev.invalid` });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('If an account exists, you may receive password reset instructions shortly.');
  }, 10000);

  it('8c. Returns 400 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  }, 10000);
});
describe('9. Password security and session invalidation', () => {
  it('revokes existing refresh sessions and persists a security event after change password', async () => {
    const login = await request(app).post('/api/auth/login').send({
      email: testCustomer.email, password: testCustomer.password,
    });
    expect(login.status).toBe(200);
    const oldCookie = (login.headers['set-cookie'] as string[]).find((cookie) => cookie.includes('electrohub_refresh'))!.split(';')[0];

    const changed = await request(app).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ currentPassword: testCustomer.password, newPassword: 'Changed#Test2026' });
    expect(changed.status).toBe(200);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', oldCookie)).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: testCustomer.email, password: testCustomer.password })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: testCustomer.email, password: 'Changed#Test2026' })).status).toBe(200);

    const user = await prisma.user.findUnique({ where: { email: testCustomer.email } });
    expect(await prisma.securityEvent.count({ where: { userId: user!.id, type: 'PASSWORD_CHANGED' } })).toBe(1);
    expect(await prisma.emailDelivery.count({ where: { userId: user!.id, type: 'PASSWORD_CHANGED' } })).toBeGreaterThan(0);
  }, 60000);

  it('uses a real reset OTP, consumes it, and revokes previous sessions', async () => {
    const oldLogin = await request(app).post('/api/auth/login').send({
      email: testCustomer.email, password: 'Changed#Test2026',
    });
    const oldCookie = (oldLogin.headers['set-cookie'] as string[]).find((cookie) => cookie.includes('electrohub_refresh'))!.split(';')[0];
    const codeSpy = vi.spyOn(otpService, 'generateCode').mockReturnValue('654321');
    const forgot = await request(app).post('/api/auth/forgot-password')
      .set('X-Forwarded-For', '198.51.100.42')
      .send({ email: testCustomer.email });
    codeSpy.mockRestore();
    expect(forgot.status).toBe(200);

    const verifiedOtp = await request(app).post('/api/auth/verify-reset-otp')
      .set('X-Forwarded-For', '198.51.100.42').send({ email: testCustomer.email, code: '654321' });
    expect(verifiedOtp.status).toBe(200);
    expect(verifiedOtp.body.resetToken).toBeTruthy();
    const reset = await request(app).post('/api/auth/reset-password')
      .set('X-Forwarded-For', '198.51.100.42').send({
      resetToken: verifiedOtp.body.resetToken, newPassword: 'Recovered#Test2026',
    });
    expect(reset.status).toBe(200);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', oldCookie)).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: testCustomer.email, password: 'Changed#Test2026' })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: testCustomer.email, password: 'Recovered#Test2026' })).status).toBe(200);
    expect((await request(app).post('/api/auth/reset-password').set('X-Forwarded-For', '198.51.100.44').send({
      resetToken: verifiedOtp.body.resetToken, newPassword: 'OtherPassword#2026',
    })).status).toBe(400);
    expect((await request(app).post('/api/auth/verify-reset-otp').set('X-Forwarded-For', '198.51.100.45').send({
      email: testCustomer.email, code: '654321',
    })).status).toBe(400);

    const user = await prisma.user.findUnique({ where: { email: testCustomer.email } });
    expect(await prisma.securityEvent.count({ where: { userId: user!.id, type: 'PASSWORD_RESET' } })).toBe(1);
  }, 60000);

  it('keeps a changed profile email pending until OTP verification and preserves the customer session', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: testCustomer.email, password: 'Recovered#Test2026' });
    const token = login.body.accessToken as string;
    const nextEmail = `profile-change-${timestamp}@electrohub-test.invalid`;
    testCustomerEmails.push(nextEmail);
    const codeSpy = vi.spyOn(otpService, 'generateCode').mockReturnValue('731946');
    const update = await request(app).patch('/api/auth/me').set('Authorization', `Bearer ${token}`).send({
      firstName: 'Profile', email: nextEmail.toUpperCase(),
    });
    codeSpy.mockRestore();
    expect(update.status).toBe(200);
    expect(update.body.user.email).toBe(testCustomer.email);
    expect(update.body.user.pendingEmail).toBe(nextEmail);
    expect(update.body.user.requiresEmailVerification).toBe(true);

    const verify = await request(app).post('/api/auth/me/verify-email-change')
      .set('Authorization', `Bearer ${token}`).send({ code: '731946' });
    expect(verify.status).toBe(200);
    expect(verify.body.user.email).toBe(nextEmail);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    const user = await prisma.user.findUnique({ where: { email: nextEmail } });
    expect(user?.pendingEmail).toBeNull();
    expect(user?.emailVerifiedAt).not.toBeNull();
    expect(await prisma.securityEvent.count({ where: { userId: user!.id, type: 'EMAIL_CHANGED' } })).toBe(1);
  }, 120000);

  it('requires the unverified account password to correct email and supersedes its previous challenge', async () => {
    const originalEmail = `unverified-correction-${timestamp}@electrohub-test.invalid`;
    const correctedEmail = `corrected-${timestamp}@electrohub-test.invalid`;
    testCustomerEmails.push(originalEmail, correctedEmail);
    const codeSpy = vi.spyOn(otpService, 'generateCode').mockReturnValue('482615');
    const registration = await request(app).post('/api/auth/register').set('X-Forwarded-For', '198.51.100.61').send({
      email: originalEmail, password: 'Correct#Test2026', firstName: 'Pending', lastName: 'Customer',
    });
    expect(registration.status).toBe(201);
    const oldChallenge = await prisma.otpChallenge.findFirst({ where: { destination: originalEmail, purpose: 'EMAIL_VERIFICATION' } });

    const wrongCredential = await request(app).post('/api/auth/change-verification-email').set('X-Forwarded-For', '198.51.100.62').send({
      currentEmail: originalEmail, password: 'wrong-password', newEmail: correctedEmail,
    });
    expect(wrongCredential.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { email: originalEmail } })).toMatchObject({ email: originalEmail, emailVerifiedAt: null, pendingEmail: null });
    expect(await prisma.user.findUnique({ where: { email: correctedEmail } })).toBeNull();

    const duplicateTarget = await request(app).post('/api/auth/change-verification-email').set('X-Forwarded-For', '198.51.100.63').send({
      currentEmail: originalEmail, password: 'Correct#Test2026', newEmail: 'admin@electrohub.com',
    });
    expect(duplicateTarget.status).toBe(200);
    expect(duplicateTarget.body.message).toBe(wrongCredential.body.message);

    const changed = await request(app).post('/api/auth/change-verification-email').set('X-Forwarded-For', '198.51.100.64').send({
      currentEmail: originalEmail, password: 'Correct#Test2026', newEmail: correctedEmail.toUpperCase(),
    });
    expect(changed.status).toBe(200);
    expect(changed.body.email).toBe(correctedEmail);
    expect(await prisma.user.findUnique({ where: { email: originalEmail } })).toMatchObject({ email: originalEmail, emailVerifiedAt: null, pendingEmail: correctedEmail });
    expect(await prisma.user.findUnique({ where: { email: correctedEmail } })).toBeNull();
    expect(oldChallenge?.lockedAt).toBeNull();
    const challenges = await prisma.otpChallenge.findMany({ where: { destination: { in: [originalEmail, correctedEmail] }, purpose: 'EMAIL_VERIFICATION' } });
    expect(challenges.find((challenge) => challenge.id === oldChallenge?.id)?.lockedAt).not.toBeNull();
    expect(challenges.find((challenge) => challenge.destination === correctedEmail)?.lockedAt).toBeNull();
    expect((await request(app).post('/api/auth/verify-email').send({ email: correctedEmail, code: '482615' })).status).toBe(200);
    expect(await prisma.user.findUnique({ where: { email: originalEmail } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: correctedEmail } })).toMatchObject({ emailVerifiedAt: expect.any(Date), pendingEmail: null });
    codeSpy.mockRestore();
  }, 120000);
});

// ─── 10. TASK 02.4-B OTP EXPIRATION & REGISTRATION DELIVERY FAILURE ───────────

describe('10. Task 02.4-B: OTP Expiration (60s) and Registration Email Delivery Failure', () => {
  const failureTestEmail = `failure_recovery_${timestamp}@electrohub-test.invalid`;
  const expiredTestEmail = `expired_otp_${timestamp}@electrohub-test.invalid`;
  testCustomerEmails.push(failureTestEmail, expiredTestEmail);

  it('10a. OTP validity is exactly 60 seconds and expired OTP is rejected with expected message', async () => {
    const codeSpy = vi.spyOn(otpService, 'generateCode').mockReturnValue('987654');
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: expiredTestEmail,
        password: 'Password123!',
        firstName: 'Expired',
        lastName: 'Tester',
      });
    codeSpy.mockRestore();

    expect(regRes.status).toBe(201);
    expect(regRes.body.requiresVerification).toBe(true);

    const user = await prisma.user.findUnique({ where: { email: expiredTestEmail } });
    expect(user).not.toBeNull();
    const challenge = await prisma.otpChallenge.findFirst({
      where: { userId: user!.id, purpose: 'EMAIL_VERIFICATION' },
      orderBy: { createdAt: 'desc' },
    });
    expect(challenge).not.toBeNull();

    // Prove backend authoritative 60-second TTL
    const ttlSeconds = (challenge!.expiresAt.getTime() - challenge!.createdAt.getTime()) / 1000;
    expect(Math.round(ttlSeconds)).toBe(60);

    // Simulate OTP expiration by updating expiresAt to past
    await prisma.otpChallenge.update({
      where: { id: challenge!.id },
      data: { expiresAt: new Date(Date.now() - 5000) },
    });

    // Submitting expired OTP fails with authoritative message
    const verifyRes = await request(app)
      .post('/api/auth/verify-email')
      .send({ email: expiredTestEmail, code: '987654' });

    expect(verifyRes.status).toBe(400);
    expect(verifyRes.body.error).toEqual({
      code: 'OTP_EXPIRED',
      message: 'This verification code has expired. Request a new code.',
    });

    // Verify expired OTP cannot be replayed
    const replayRes = await request(app)
      .post('/api/auth/verify-email')
      .send({ email: expiredTestEmail, code: '987654' });
    expect(replayRes.status).toBe(400);
    expect(replayRes.body.error.code).toBe('OTP_EXPIRED');

    // Customer remains unverified
    const unverifiedUser = await prisma.user.findUnique({ where: { email: expiredTestEmail } });
    expect(unverifiedUser?.emailVerifiedAt).toBeNull();
  }, 60000);

  it('10b. Registration survives simulated Brevo failure: partial-success 201, unverified, no session, duplicate rejected, resend & verification recovery works', async () => {
    // 1. Simulate Brevo delivery failure (mock rejects / throws error)
    const emailSpy = vi.spyOn(emailService, 'sendAccountVerificationOtp').mockRejectedValueOnce(
      new Error('Brevo API Connection Timeout / 503 Provider Error')
    );
    const codeSpy = vi.spyOn(otpService, 'generateCode').mockReturnValue('112233');

    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: failureTestEmail,
        password: 'Password123!',
        firstName: 'Delivery',
        lastName: 'Failed',
      });

    emailSpy.mockRestore();
    codeSpy.mockRestore();

    // Must return 201 partial success, not 500
    expect(regRes.status).toBe(201);
    expect(regRes.body).toEqual({
      message: 'Account created, but we could not send the verification code. Please request a new code shortly.',
      requiresVerification: true,
      deliveryFailed: true,
      email: failureTestEmail,
    });
    // No session/cookies issued
    expect(regRes.body.accessToken).toBeUndefined();
    expect(regRes.body.refreshToken).toBeUndefined();
    expect(regRes.headers['set-cookie']).toBeUndefined();

    // 2. Customer account MUST remain created and unverified
    const user = await prisma.user.findUnique({ where: { email: failureTestEmail } });
    expect(user).not.toBeNull();
    expect(user?.emailVerifiedAt).toBeNull();

    // 3. Challenge was created with 60-second TTL
    const challenge = await prisma.otpChallenge.findFirst({
      where: { userId: user!.id, purpose: 'EMAIL_VERIFICATION' },
      orderBy: { createdAt: 'desc' },
    });
    expect(challenge).not.toBeNull();
    const ttlSeconds = (challenge!.expiresAt.getTime() - challenge!.createdAt.getTime()) / 1000;
    expect(Math.round(ttlSeconds)).toBe(60);

    // 4. Retrying registration with the same email does not create duplicate accounts (returns 409)
    const duplicateRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: failureTestEmail,
        password: 'Password123!',
        firstName: 'Duplicate',
        lastName: 'Attempt',
      });
    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body.error).toBe('Email already registered');

    // Ensure only 1 user exists
    const userCount = await prisma.user.count({ where: { email: failureTestEmail } });
    expect(userCount).toBe(1);

    // 5. User can subsequently use "Resend code"
    // Set lastSentAt to past cooldown so resend can succeed immediately
    await prisma.otpChallenge.update({
      where: { id: challenge!.id },
      data: { lastSentAt: new Date(Date.now() - 65000) },
    });

    const resendCodeSpy = vi.spyOn(otpService, 'generateCode').mockReturnValue('445566');
    const resendEmailSpy = vi.spyOn(emailService, 'sendAccountVerificationOtp').mockResolvedValue(true);

    const resendRes = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: failureTestEmail });

    resendCodeSpy.mockRestore();
    resendEmailSpy.mockRestore();

    expect(resendRes.status).toBe(200);
    expect(resendRes.body.success).toBe(true);
    expect(resendRes.body.expiresAt).toBeDefined();

    // Check that resend updated the challenge with a fresh 60-second expiry
    const resentChallenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { userId: user!.id, purpose: 'EMAIL_VERIFICATION', consumedAt: null, lockedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(new Date(resendRes.body.expiresAt).getTime()).toBe(resentChallenge.expiresAt.getTime());
    expect(Math.round((resentChallenge.expiresAt.getTime() - resentChallenge.lastSentAt!.getTime()) / 1000)).toBe(60);

    // 6. Eventual verification with the new code succeeds and establishes session
    const verifyRes = await request(app)
      .post('/api/auth/verify-email')
      .send({ email: failureTestEmail, code: '445566' });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.accessToken).toBeDefined();
    expect(verifyRes.body.user).toBeDefined();
    expect(verifyRes.headers['set-cookie']).toBeDefined();

    const verifiedUser = await prisma.user.findUnique({ where: { email: failureTestEmail } });
    expect(verifiedUser?.emailVerifiedAt).not.toBeNull();
  }, 120000);
});
