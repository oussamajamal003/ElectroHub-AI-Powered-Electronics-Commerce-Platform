import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../app.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../utils/hash.js';
import { generateAccessToken } from '../utils/jwt.js';
import { base32Decode, hotp, totpStep } from './admin-crypto.js';
import { emailService } from './email.service.js';

const PASSWORD = 'Correct-Horse-9-Battery';
const createdUsers: string[] = [];
const capturedCodes: string[] = [];
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const api = () => {
  const forwarded = ip();
  return {
    get: (path: string, token?: string) => { const call = request(app).get(path).set('X-Forwarded-For', forwarded); return token ? call.set('Authorization', `Bearer ${token}`) : call; },
    post: (path: string, body?: object, token?: string) => { let call = request(app).post(path).set('X-Forwarded-For', forwarded); if (token) call = call.set('Authorization', `Bearer ${token}`); return body ? call.send(body) : call; },
    patch: (path: string, body: object, token: string) => request(app).patch(path).set('X-Forwarded-For', forwarded).set('Authorization', `Bearer ${token}`).send(body),
  };
};
const totp = (secret: string, offset = 0) => hotp(base32Decode(secret), totpStep(Date.now()) + BigInt(offset));
async function totpAfter(secret: string, usedStep: bigint) {
  const deadline = Date.now() + 65_000;
  while (totpStep(Date.now()) <= usedStep) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the next TOTP period in disposable QA.');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return totp(secret);
}

async function createUser(roleName: 'ADMIN' | 'CUSTOMER', owner = false) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const user = await prisma.user.create({ data: { email: `${roleName.toLowerCase()}-${randomUUID()}@qa.invalid`, passwordHash: await hashPassword(PASSWORD),
    firstName: 'QA', lastName: roleName, roleId: role.id, emailVerifiedAt: new Date() } });
  createdUsers.push(user.id);
  if (roleName === 'ADMIN') await prisma.adminAccountSecurity.create({ data: { userId: user.id, isOwner: owner, canManageAdmins: owner,
    enrollmentAllowedUntil: new Date(Date.now() + 60 * 60 * 1000) } });
  return user;
}

async function enrolledAdmin(owner = false) {
  const user = await createUser('ADMIN', owner);
  const client = api();
  const login = await client.post('/api/auth/login', { email: user.email, password: PASSWORD });
  expect(login.status).toBe(200);
  const start = await client.post('/api/auth/admin/mfa/enrollment/start', { mfaToken: login.body.mfaToken });
  expect(start.status).toBe(200);
  const confirm = await client.post('/api/auth/admin/mfa/enrollment/confirm', { mfaToken: login.body.mfaToken,
    factorId: start.body.factorId, code: totp(start.body.secret) });
  expect(confirm.status).toBe(200);
  return { user, secret: start.body.secret as string, accessToken: confirm.body.accessToken as string };
}

vi.mock('./admin-email-change-email.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./admin-email-change-email.js')>();
  return { ...actual,
    sendAdminEmailChangeOtp: vi.fn(async (_email: string, code: string) => { capturedCodes.push(code); return true; }),
    dispatchAdminEmailChangeNotices: vi.fn(async () => undefined),
  };
});

describe.skipIf(process.env.ADMIN_SECURITY_PG_RUN !== '1').sequential('administrator email change on disposable PostgreSQL', { timeout: 120000 }, () => {
  beforeAll(() => {
    const host = new URL(process.env.DATABASE_URL!).hostname;
    if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('Refusing to run against a non-loopback database.');
    vi.spyOn(emailService, 'sendAccountVerificationOtp').mockResolvedValue(false);
  });
  afterEach(() => { capturedCodes.length = 0; });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (createdUsers.length) await prisma.emailDelivery.deleteMany({ where: { userId: { in: createdUsers } } });
    for (const userId of createdUsers) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('blocks all legacy ADMIN email-change endpoints and preserves CUSTOMER pending-email behavior', async () => {
    const admin = await enrolledAdmin();
    const client = api();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id }, select: { email: true, pendingEmail: true } });
    const responses = await Promise.all([
      client.patch('/api/auth/me', { email: 'blocked-admin-change@qa.invalid' }, admin.accessToken),
      client.post('/api/auth/me/verify-email-change', { code: '123456' }, admin.accessToken),
      client.post('/api/auth/me/resend-email-change', undefined, admin.accessToken),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ADMIN_ENDPOINT_REQUIRED');
    }
    expect(await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id }, select: { email: true, pendingEmail: true } })).toEqual(before);

    const customer = await createUser('CUSTOMER');
    const customerToken = generateAccessToken({ userId: customer.id, role: 'CUSTOMER' });
    const changed = await client.patch('/api/auth/me', { email: 'customer-updated@qa.invalid' }, customerToken);
    expect(changed.status).toBe(200);
    const customerAfter = await prisma.user.findUniqueOrThrow({ where: { id: customer.id }, select: { email: true, pendingEmail: true } });
    expect(customerAfter).toEqual({ email: customer.email, pendingEmail: 'customer-updated@qa.invalid' });
  });

  it('requires explicit MFA step-up, current password and a new-address OTP; promotes atomically and ends every session', async () => {
    const admin = await enrolledAdmin(true);
    const client = api();
    const targetEmail = `owner-new-${randomUUID()}@qa.invalid`;

    for (const [path, body] of [
      ['/api/auth/me', { email: targetEmail }],
      ['/api/auth/me/verify-email-change', { code: '111111' }],
      ['/api/auth/me/resend-email-change', undefined],
    ] as const) {
      const response = path === '/api/auth/me' ? await client.patch(path, body!, admin.accessToken) : await client.post(path, body, admin.accessToken);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ADMIN_ENDPOINT_REQUIRED');
    }

    const noStepUp = await client.post('/api/admin/me/email-change/request', { newEmail: targetEmail, currentPassword: PASSWORD }, admin.accessToken);
    expect(noStepUp.status).toBe(403);
    expect(noStepUp.body.error.code).toBe('STEP_UP_REQUIRED');

    const stepUpCounter = totpStep(Date.now()) + 1n;
    const stepUpCode = hotp(base32Decode(admin.secret), stepUpCounter);
    const stepped = await client.post('/api/admin/me/security/step-up', { method: 'TOTP', code: stepUpCode }, admin.accessToken);
    expect(stepped.status).toBe(200);
    const wrongPassword = await client.post('/api/admin/me/email-change/request', { newEmail: targetEmail, currentPassword: 'incorrect-password' }, admin.accessToken);
    expect(wrongPassword.status).toBe(400);
    expect(wrongPassword.body.error.code).toBe('INVALID_CURRENT_PASSWORD');

    const initialUser = await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id }, select: { email: true, emailVerifiedAt: true } });
    const pending = await client.post('/api/admin/me/email-change/request', { newEmail: targetEmail, currentPassword: PASSWORD }, admin.accessToken);
    expect(pending.status).toBe(202);
    expect(pending.body.data.pendingEmail).toBe(targetEmail);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id }, select: { email: true, pendingEmail: true, emailVerifiedAt: true } }))
      .toEqual({ email: initialUser.email, pendingEmail: targetEmail, emailVerifiedAt: initialUser.emailVerifiedAt });
    expect(await prisma.adminSession.count({ where: { userId: admin.user.id, revokedAt: null } })).toBe(1);
    expect(capturedCodes).toHaveLength(1);

    const wrongCode = await client.post('/api/admin/me/email-change/verify', { code: '000000' }, admin.accessToken);
    expect(wrongCode.status).toBe(400);
    expect(wrongCode.body.error.code).toBe('OTP_INCORRECT');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id }, select: { email: true } })).email).toBe(initialUser.email);

    const changed = await client.post('/api/admin/me/email-change/verify', { code: capturedCodes[0] }, admin.accessToken);
    expect(changed.status).toBe(200);
    expect(changed.body.data).toEqual({ changed: true, email: targetEmail, signedOut: true });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id }, include: { role: true, adminSecurity: true } });
    expect(after.id).toBe(admin.user.id);
    expect(after.email).toBe(targetEmail);
    expect(after.pendingEmail).toBeNull();
    expect(after.emailVerifiedAt).not.toBeNull();
    expect(after.role.name).toBe('ADMIN');
    expect(after.adminSecurity).toMatchObject({ isOwner: true, canManageAdmins: true });
    expect(await prisma.adminMfaFactor.count({ where: { userId: admin.user.id, disabledAt: null } })).toBe(1);
    expect(await prisma.refreshToken.count({ where: { userId: admin.user.id, isRevoked: false } })).toBe(0);
    expect(await prisma.adminSession.count({ where: { userId: admin.user.id, revokedAt: null } })).toBe(0);
    expect(await prisma.securityEvent.count({ where: { userId: admin.user.id, type: 'EMAIL_CHANGED' } })).toBe(1);
    expect(await prisma.adminAuditLog.count({ where: { actorId: admin.user.id, action: 'ADMIN_EMAIL_CHANGED', outcome: 'SUCCESS' } })).toBe(1);
    expect(await prisma.emailDelivery.count({ where: { userId: admin.user.id, type: { in: ['ADMIN_EMAIL_CHANGE_OLD', 'ADMIN_EMAIL_CHANGE_NEW'] }, status: 'QUEUED' } })).toBe(2);

    const oldLogin = await client.post('/api/auth/login', { email: admin.user.email, password: PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await client.post('/api/auth/login', { email: targetEmail, password: PASSWORD });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.requiresMfa).toBe(true);
    const reauthenticated = await client.post('/api/auth/admin/mfa/totp/verify', { mfaToken: newLogin.body.mfaToken,
      code: await totpAfter(admin.secret, stepUpCounter) });
    expect(reauthenticated.status, JSON.stringify(reauthenticated.body)).toBe(200);
    const profile = await client.get('/api/admin/me/profile', reauthenticated.body.accessToken);
    expect(profile.status).toBe(200);
    expect(profile.body.data.email).toBe(targetEmail);
  });

  it('consumes the same OTP at most once under concurrent confirmation', async () => {
    const admin = await enrolledAdmin();
    const client = api();
    const targetEmail = `race-${randomUUID()}@qa.invalid`;
    await client.post('/api/admin/me/security/step-up', { method: 'TOTP', code: totp(admin.secret, 1) }, admin.accessToken);
    const started = await client.post('/api/admin/me/email-change/request', { newEmail: targetEmail, currentPassword: PASSWORD }, admin.accessToken);
    expect(started.status).toBe(202);
    const code = capturedCodes.at(-1)!;
    const results = await Promise.all([
      client.post('/api/admin/me/email-change/verify', { code }, admin.accessToken),
      client.post('/api/admin/me/email-change/verify', { code }, admin.accessToken),
    ]);
    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id }, select: { email: true, pendingEmail: true } }))
      .toEqual({ email: targetEmail, pendingEmail: null });
    expect(await prisma.securityEvent.count({ where: { userId: admin.user.id, type: 'EMAIL_CHANGED' } })).toBe(1);
  });

  it('rejects conflicting targets, cancels one pending proof, and expires its authorization without changing the active email', async () => {
    const admin = await enrolledAdmin();
    const client = api();
    const customer = await createUser('CUSTOMER');
    const customerToken = generateAccessToken({ userId: customer.id, role: 'CUSTOMER' });
    const forbidden = await client.post('/api/admin/me/email-change/request', { newEmail: 'forbidden@qa.invalid', currentPassword: PASSWORD }, customerToken);
    expect([401, 403]).toContain(forbidden.status);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: customer.id }, select: { pendingEmail: true } })).toEqual({ pendingEmail: null });

    await client.post('/api/admin/me/security/step-up', { method: 'TOTP', code: totp(admin.secret, 1) }, admin.accessToken);
    const collision = await client.post('/api/admin/me/email-change/request', { newEmail: customer.email, currentPassword: PASSWORD }, admin.accessToken);
    expect(collision.status).toBe(409);
    expect(collision.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');

    const firstTarget = `cancel-${randomUUID()}@qa.invalid`;
    const first = await client.post('/api/admin/me/email-change/request', { newEmail: firstTarget, currentPassword: PASSWORD }, admin.accessToken);
    expect(first.status).toBe(202);
    const firstAuthorization = await prisma.adminEmailChangeAuthorization.findUniqueOrThrow({ where: { userId: admin.user.id }, select: { challengeId: true } });
    expect((await client.post('/api/admin/me/email-change/cancel', undefined, admin.accessToken)).status).toBe(200);
    expect((await client.get('/api/admin/me/email-change/status', admin.accessToken)).body.data).toEqual({ active: false });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id }, select: { email: true, pendingEmail: true } }))
      .toEqual({ email: admin.user.email, pendingEmail: null });
    expect((await prisma.otpChallenge.findUniqueOrThrow({ where: { id: firstAuthorization.challengeId! }, select: { lockedAt: true } })).lockedAt).not.toBeNull();

    const secondTarget = `expired-${randomUUID()}@qa.invalid`;
    const second = await client.post('/api/admin/me/email-change/request', { newEmail: secondTarget, currentPassword: PASSWORD }, admin.accessToken);
    expect(second.status).toBe(202);
    await prisma.adminEmailChangeAuthorization.update({ where: { userId: admin.user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await client.get('/api/admin/me/email-change/status', admin.accessToken)).body.data).toEqual({ active: false });
    const expiredProof = await client.post('/api/admin/me/email-change/verify', { code: capturedCodes.at(-1) }, admin.accessToken);
    expect(expiredProof.status).toBe(410);
    expect(expiredProof.body.error.code).toBe('EMAIL_CHANGE_EXPIRED');
    expect(await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id }, select: { email: true, pendingEmail: true } }))
      .toEqual({ email: admin.user.email, pendingEmail: secondTarget });
  });

  it('expires an email OTP, resends a new bound challenge, and consumes only that challenge', async () => {
    const admin = await enrolledAdmin();
    const client = api();
    const targetEmail = `resend-${randomUUID()}@qa.invalid`;
    await client.post('/api/admin/me/security/step-up', { method: 'TOTP', code: totp(admin.secret, 1) }, admin.accessToken);
    const requested = await client.post('/api/admin/me/email-change/request', { newEmail: targetEmail, currentPassword: PASSWORD }, admin.accessToken);
    expect(requested.status).toBe(202);
    const firstCode = capturedCodes.at(-1)!;
    const authorization = await prisma.adminEmailChangeAuthorization.findUniqueOrThrow({ where: { userId: admin.user.id }, select: { challengeId: true } });
    await prisma.otpChallenge.update({ where: { id: authorization.challengeId! }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expiredOtp = await client.post('/api/admin/me/email-change/verify', { code: firstCode }, admin.accessToken);
    expect(expiredOtp.status).toBe(400);
    expect(expiredOtp.body.error.code).toBe('OTP_EXPIRED');

    await prisma.adminEmailChangeAuthorization.update({ where: { userId: admin.user.id }, data: { resendAvailableAt: new Date(0) } });
    const resent = await client.post('/api/admin/me/email-change/resend', undefined, admin.accessToken);
    expect(resent.status).toBe(200);
    const newCode = capturedCodes.at(-1)!;
    const renewedAuthorization = await prisma.adminEmailChangeAuthorization.findUniqueOrThrow({ where: { userId: admin.user.id }, select: { challengeId: true } });
    expect(renewedAuthorization.challengeId).not.toBe(authorization.challengeId);
    expect((await prisma.otpChallenge.findUniqueOrThrow({ where: { id: authorization.challengeId! }, select: { lockedAt: true } })).lockedAt).not.toBeNull();
    const completed = await client.post('/api/admin/me/email-change/verify', { code: newCode }, admin.accessToken);
    expect(completed.status).toBe(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id }, select: { email: true, pendingEmail: true } }))
      .toEqual({ email: targetEmail, pendingEmail: null });
  });
});
