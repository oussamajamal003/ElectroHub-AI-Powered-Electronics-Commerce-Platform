import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../app.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../utils/hash.js';
import { AuthRepository, StalePasswordHashError } from '../repositories/auth.repository.js';
import { SecurityEventType } from '@prisma/client';
import { generateAccessToken } from '../utils/jwt.js';
import { base32Decode, hotp, totpStep } from './admin-crypto.js';
import { AuthService } from './auth.service.js';
import { env } from '../config/env.js';
import { DeliveryPublisher } from '../sockets/delivery.publisher.js';
import { adminMfaService } from './admin-mfa.service.js';
import { emailService } from './email.service.js';
import { brevoProvider } from '../integrations/brevo/brevo.provider.js';
import { retryDeletionNotices } from './admin-deletion-email.js';
import { seedAdministrators } from '../utils/admin-seed.js';
import { countEligibleOwners, ownershipTestHooks } from './admin-ownership.service.js';

/**
 * Task 05.2 administrator security against a real, freshly migrated, disposable PostgreSQL through the real Express stack (run only by
 * scripts/admin-security-pg.cjs). Synthetic *.invalid identities; the invitation email provider is replaced by a capture.
 */
const { sentInvitations, sentActivations, sentOwnerGrants, sentOwnerRevocations } = vi.hoisted(() => ({ sentInvitations: [] as { to: string; token: string }[],
  sentActivations: [] as { to: string; token: string }[], sentOwnerGrants: [] as string[], sentOwnerRevocations: [] as string[] }));
vi.mock('./admin-invitation-email.js', () => ({
  sendAdminInvitationEmail: vi.fn(async (input: { to: string; token: string }) => { sentInvitations.push({ to: input.to, token: input.token }); return true; }),
  invitationLink: (token: string) => `http://localhost:3000/admin/invite#token=${token}`,
  sendAdminActivationEmail: vi.fn(async (input: { to: string; token: string }) => { sentActivations.push({ to: input.to, token: input.token }); return true; }),
  activationLink: (token: string) => `http://localhost:3000/admin/activate#token=${token}`,
  sendOwnerGrantedEmail: vi.fn(async (input: { to: string }) => { sentOwnerGrants.push(input.to); return true; }),
  sendOwnerRevokedEmail: vi.fn(async (input: { to: string }) => { sentOwnerRevocations.push(input.to); return true; }),
}));


const PASSWORD = 'Correct-Horse-9-Battery';
const LEGACY_ADMIN = '11111111-1111-4111-8111-111111111111';
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const api = () => { const forwarded = ip(); return {
  post: (url: string, body?: object, token?: string, cookie?: string) => {
    let call = request(app).post(url).set('X-Forwarded-For', forwarded);
    if (token) call = call.set('Authorization', `Bearer ${token}`);
    if (cookie) call = call.set('Cookie', cookie);
    return body ? call.send(body) : call;
  },
  get: (url: string, token?: string) => { const call = request(app).get(url).set('X-Forwarded-For', forwarded); return token ? call.set('Authorization', `Bearer ${token}`) : call; },
  patch: (url: string, body: object, token: string) => request(app).patch(url).set('X-Forwarded-For', forwarded).set('Authorization', `Bearer ${token}`).send(body),
  delete: (url: string, token: string) => request(app).delete(url).set('X-Forwarded-For', forwarded).set('Authorization', `Bearer ${token}`),
}; };
const refreshCookie = (response: request.Response) => ((response.headers['set-cookie'] as unknown as string[] | undefined) ?? [])
  .find(value => value.startsWith('electrohub_admin_refresh='))?.split(';')[0];
const code = (secret: string, offset = 0) => hotp(base32Decode(secret), totpStep(Date.now()) + BigInt(offset));

async function roleId(name: 'ADMIN' | 'CUSTOMER') {
  return (await prisma.role.findUniqueOrThrow({ where: { name } })).id;
}
async function createUser(role: 'ADMIN' | 'CUSTOMER', options: { owner?: boolean; manage?: boolean; enrollWindow?: boolean } = {}) {
  const user = await prisma.user.create({ data: { email: `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@qa.invalid`, passwordHash: await hashPassword(PASSWORD),
    firstName: 'QA', lastName: role, roleId: await roleId(role), emailVerifiedAt: new Date() } });
  if (role === 'ADMIN') {
    await prisma.adminAccountSecurity.create({ data: { userId: user.id, isOwner: options.owner ?? false, canManageAdmins: options.manage ?? options.owner ?? false,
      enrollmentAllowedUntil: options.enrollWindow === false ? null : new Date(Date.now() + 3600_000) } });
  }
  return user;
}

/** Password → enrollment → confirmed TOTP: returns a fully MFA-assured session plus the factor secret. */
async function enrolledAdmin(options: { owner?: boolean; manage?: boolean } = {}) {
  const user = await createUser('ADMIN', options);
  const client = api();
  const login = await client.post('/api/auth/login', { email: user.email, password: PASSWORD });
  const start = await client.post('/api/auth/admin/mfa/enrollment/start', { mfaToken: login.body.mfaToken });
  const confirm = await client.post('/api/auth/admin/mfa/enrollment/confirm', { mfaToken: login.body.mfaToken, factorId: start.body.factorId, code: code(start.body.secret) });
  expect(confirm.status).toBe(200);
  return { user, secret: start.body.secret as string, accessToken: confirm.body.accessToken as string, cookie: refreshCookie(confirm)!,
    recoveryCodes: confirm.body.recoveryCodes as string[] };
}
async function signIn(email: string, secret: string, offset = 1) {
  const client = api();
  const login = await client.post('/api/auth/login', { email, password: PASSWORD });
  const verified = await client.post('/api/auth/admin/mfa/totp/verify', { mfaToken: login.body.mfaToken, code: code(secret, offset) });
  return { status: verified.status, accessToken: verified.body.accessToken as string, cookie: refreshCookie(verified) };
}

describe.skipIf(process.env.ADMIN_SECURITY_PG_RUN !== '1').sequential('Task 05.2 administrator security on real PostgreSQL', { timeout: 60_000 }, () => {
  beforeAll(() => {
    const host = new URL(process.env.DATABASE_URL!).hostname;
    if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('Refusing to run against a non-loopback database.');
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('B03 upgrade: the migration kept pre-existing rows and seeded checkout terms equal to the 03.5 constants', async () => {
    expect(await prisma.user.findUnique({ where: { id: LEGACY_ADMIN }, select: { email: true } })).toEqual({ email: 'legacy-admin@qa.invalid' });
    expect(await prisma.refreshToken.count({ where: { userId: LEGACY_ADMIN, isRevoked: false } })).toBe(1);
    const methods = await prisma.shippingMethodSetting.findMany({ orderBy: { method: 'asc' } });
    expect(methods.map(row => [row.method, row.enabled, row.price.toFixed(2)])).toEqual([
      ['STANDARD', true, '0.00'], ['EXPRESS', true, '9.99'], ['OVERNIGHT', true, '19.99']]);
    expect((await prisma.shippingSettings.findUniqueOrThrow({ where: { id: 'default' } })).freeShippingThreshold).toBeNull();
    expect((await prisma.storeSettings.findUniqueOrThrow({ where: { id: 'default' } })).currency).toBe('USD');
  });

  it('SEC-01/D02 cutover: a legacy pre-MFA admin refresh token (unscoped format) is refused before any lookup and can never refresh; a session-less ADMIN access token is refused', async () => {
    const refreshed = await api().post('/api/auth/admin/refresh', undefined, undefined, 'electrohub_admin_refresh=legacy-admin-refresh-token');
    expect(refreshed.status).toBe(401);
    expect(refreshed.body).toEqual({ error: 'Invalid or expired refresh token' }); // existing generic refresh contract
    // Task 05.2 isolation: a token without the portal prefix is rejected before the database is read, so it neither refreshes nor is its family revoked by a stale cookie.
    expect(await prisma.refreshToken.count({ where: { userId: LEGACY_ADMIN, isRevoked: false } })).toBe(1);
    const legacyAccess = generateAccessToken({ userId: LEGACY_ADMIN, role: 'ADMIN' });
    for (const path of ['/api/admin/dashboard/overview', '/api/admin/catalog/products', '/api/admin/me/profile', '/api/admin/invitations']) {
      const response = await api().get(path, legacyAccess);
      expect(response.status, path).toBe(401);
    }
    // A forged sessionId that is not a live session family is refused the same way.
    expect((await api().get('/api/admin/me/profile', generateAccessToken({ userId: LEGACY_ADMIN, role: 'ADMIN', sessionId: randomUUID() }))).status).toBe(401);
  });

  it('D01: a correct ADMIN password yields only a restricted MFA transaction (no tokens, no cookie)', async () => {
    const admin = await enrolledAdmin();
    const login = await api().post('/api/auth/login', { email: admin.user.email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ requiresMfa: true, enrollmentRequired: false, factors: { totp: true, passkey: false, recoveryCode: true } });
    expect(login.body.accessToken).toBeUndefined();
    expect(refreshCookie(login)).toBeUndefined();
    // The restricted transaction token is not an access token.
    expect((await api().get('/api/admin/me/profile', login.body.mfaToken)).status).toBe(401);
    expect((await api().post('/api/auth/login', { email: admin.user.email, password: 'wrong-password' })).status).toBe(401);
  });

  it('C06/D03: a factor-less admin cannot enroll without an operator/invitation window; with one, enrollment is encrypted and confirmed', async () => {
    const blocked = await createUser('ADMIN', { enrollWindow: false });
    const denied = await api().post('/api/auth/login', { email: blocked.email, password: PASSWORD });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('ENROLLMENT_NOT_AUTHORIZED');

    const user = await createUser('ADMIN');
    const client = api();
    const login = await client.post('/api/auth/login', { email: user.email, password: PASSWORD });
    expect(login.body.enrollmentRequired).toBe(true);
    const start = await client.post('/api/auth/admin/mfa/enrollment/start', { mfaToken: login.body.mfaToken });
    expect(start.status).toBe(200);
    expect(start.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const stored = await prisma.adminMfaFactor.findUniqueOrThrow({ where: { id: start.body.factorId } });
    expect(stored.verifiedAt).toBeNull();
    expect(stored.secretCiphertext).not.toContain(start.body.secret);
    // Generating a secret is not enrollment: no session is available before confirmation.
    const wrong = await client.post('/api/auth/admin/mfa/enrollment/confirm', { mfaToken: login.body.mfaToken, factorId: start.body.factorId, code: '000000' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toMatchObject({ code: 'MFA_CODE_INVALID', attemptsRemaining: 4 });
    const confirm = await client.post('/api/auth/admin/mfa/enrollment/confirm', { mfaToken: login.body.mfaToken, factorId: start.body.factorId, code: code(start.body.secret) });
    expect(confirm.status).toBe(200);
    expect(confirm.body.recoveryCodes).toHaveLength(10);
    expect(refreshCookie(confirm)).toBeDefined();
    const security = await prisma.adminAccountSecurity.findUniqueOrThrow({ where: { userId: user.id } });
    expect(security.enrollmentAllowedUntil).toBeNull();
    expect(security.mfaEnrolledAt).not.toBeNull();
    const profile = await api().get('/api/admin/me/profile', confirm.body.accessToken);
    expect(profile.status).toBe(200);
    expect(profile.body.data).toMatchObject({ email: user.email, mfa: { totp: 1, recoveryCodesRemaining: 10 } });
    expect(profile.headers['cache-control']).toBe('private, no-store');
    // Recovery codes are stored as keyed digests only.
    const digests = await prisma.adminRecoveryCode.findMany({ where: { userId: user.id }, select: { codeHash: true } });
    for (const recovery of confirm.body.recoveryCodes as string[]) expect(digests.some(row => row.codeHash.includes(recovery.replace(/-/g, '')))).toBe(false);
  });

  it('D08: a password change after challenge lookup prevents stale proof from committing enrollment', async () => {
    const user = await createUser('ADMIN');
    const login = await api().post('/api/auth/login', { email: user.email, password: PASSWORD });
    const start = await api().post('/api/auth/admin/mfa/enrollment/start', { mfaToken: login.body.mfaToken });
    const staleChallenge = await prisma.adminAuthChallenge.findFirstOrThrow({ where: { userId: user.id, purpose: 'LOGIN', consumedAt: null },
      include: { user: { include: { role: true } } } });
    await new AuthService().changePassword(user.id, PASSWORD, `${PASSWORD}!`);
    const lookup = vi.spyOn(prisma.adminAuthChallenge, 'findUnique').mockResolvedValueOnce(staleChallenge);
    try {
      await expect(adminMfaService.confirmLoginEnrollment(login.body.mfaToken, start.body.factorId, code(start.body.secret)))
        .rejects.toMatchObject({ code: 'MFA_CHALLENGE_INVALID' });
    } finally { lookup.mockRestore(); }
    expect(await prisma.adminMfaFactor.count({ where: { userId: user.id, verifiedAt: { not: null }, disabledAt: null } })).toBe(0);
    expect(await prisma.adminRecoveryCode.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(await prisma.adminAuthChallenge.count({ where: { userId: user.id, consumedAt: null } })).toBe(1);
  });

  it('D04/SEC-06: a TOTP code is single-use per time step, concurrent use succeeds once, and refresh keeps MFA assurance', async () => {
    const admin = await enrolledAdmin();
    // The enrollment consumed the current step: replaying it is refused.
    const client = api();
    const replay = await client.post('/api/auth/login', { email: admin.user.email, password: PASSWORD });
    expect((await client.post('/api/auth/admin/mfa/totp/verify', { mfaToken: replay.body.mfaToken, code: code(admin.secret, 0) })).status).toBe(401);
    // The next step is accepted exactly once even when submitted concurrently.
    const fresh = await client.post('/api/auth/login', { email: admin.user.email, password: PASSWORD });
    const results = await Promise.all([1, 2].map(() => api().post('/api/auth/admin/mfa/totp/verify', { mfaToken: fresh.body.mfaToken, code: code(admin.secret, 1) })));
    expect(results.map(result => result.status).sort()).toEqual([200, 401]);
    const session = results.find(result => result.status === 200)!;
    const rotated = await api().post('/api/auth/admin/refresh', undefined, undefined, refreshCookie(session));
    expect(rotated.status).toBe(200);
    expect((await api().get('/api/admin/catalog/products', rotated.body.accessToken)).status).toBe(200);
  });

  it('D09: concurrent password sign-ins leave only the newest MFA challenge usable', async () => {
    const admin = await enrolledAdmin();
    const logins = await Promise.all([1, 2].map(() => api().post('/api/auth/login', { email: admin.user.email, password: PASSWORD })));
    expect(logins.map(result => result.status)).toEqual([200, 200]);
    expect(await prisma.adminAuthChallenge.count({ where: { userId: admin.user.id, purpose: 'LOGIN', consumedAt: null } })).toBe(1);

    const verifications = await Promise.all(logins.map(result => api().post('/api/auth/admin/mfa/totp/verify', {
      mfaToken: result.body.mfaToken, code: code(admin.secret, 1),
    })));
    expect(verifications.map(result => result.status).sort()).toEqual([200, 401]);
  });

  it('D07/SEC-05: wrong codes are bounded per transaction and an exhausted transaction cannot be revived by a correct code', async () => {
    const admin = await enrolledAdmin();
    const client = api();
    const login = await client.post('/api/auth/login', { email: admin.user.email, password: PASSWORD });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) statuses.push((await client.post('/api/auth/admin/mfa/totp/verify', { mfaToken: login.body.mfaToken, code: '123456' })).status);
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    const late = await client.post('/api/auth/admin/mfa/totp/verify', { mfaToken: login.body.mfaToken, code: code(admin.secret, 1) });
    expect(late.status).toBe(401);
    expect(late.body.error.code).toBe('MFA_CHALLENGE_INVALID');
    expect(await prisma.securityEvent.count({ where: { userId: admin.user.id, type: 'ADMIN_MFA_CHALLENGE_FAILED' } })).toBe(5);
  });

  it('D05/SEC-07: a recovery code signs in once; regeneration revokes the previous batch', async () => {
    const admin = await enrolledAdmin();
    const [first, second] = admin.recoveryCodes;
    const client = api();
    const login = await client.post('/api/auth/login', { email: admin.user.email, password: PASSWORD });
    expect((await client.post('/api/auth/admin/mfa/recovery/verify', { mfaToken: login.body.mfaToken, code: first.toLowerCase() })).status).toBe(200);
    const again = await client.post('/api/auth/login', { email: admin.user.email, password: PASSWORD });
    expect((await client.post('/api/auth/admin/mfa/recovery/verify', { mfaToken: again.body.mfaToken, code: first })).status).toBe(401);
    const regenerated = await api().post('/api/admin/me/security/recovery-codes', {}, admin.accessToken);
    expect(regenerated.status).toBe(200);
    expect(regenerated.body.data.codes).toHaveLength(10);
    const third = await client.post('/api/auth/login', { email: admin.user.email, password: PASSWORD });
    expect((await client.post('/api/auth/admin/mfa/recovery/verify', { mfaToken: third.body.mfaToken, code: second })).status).toBe(401);
  });

  it('recovery codes issued before key rotation remain single-use after rotation', async () => {
    const admin = await enrolledAdmin();
    const originalKeys = env.ADMIN_MFA_ENCRYPTION_KEYS;
    const originalActive = env.ADMIN_MFA_ACTIVE_KEY_VERSION;
    try {
      env.ADMIN_MFA_ENCRYPTION_KEYS = `${originalKeys},2:${randomBytes(32).toString('base64')}`;
      env.ADMIN_MFA_ACTIVE_KEY_VERSION = 2;
      const client = api();
      const login = await client.post('/api/auth/login', { email: admin.user.email, password: PASSWORD });
      const used = await Promise.all([1, 2].map(() => api().post('/api/auth/admin/mfa/recovery/verify', {
        mfaToken: login.body.mfaToken, code: admin.recoveryCodes[0],
      })));
      expect(used.map(result => result.status).sort()).toEqual([200, 401]);
      expect(await prisma.adminRecoveryCode.count({ where: { userId: admin.user.id, consumedAt: { not: null } } })).toBe(1);
    } finally {
      env.ADMIN_MFA_ENCRYPTION_KEYS = originalKeys;
      env.ADMIN_MFA_ACTIVE_KEY_VERSION = originalActive;
    }
  });

  it('E03/SEC-09: revoking another session ends its access AND refresh immediately; the current session keeps working', async () => {
    const admin = await enrolledAdmin();
    const other = await signIn(admin.user.email, admin.secret, 1);
    expect(other.status).toBe(200);
    const sessions = await api().get('/api/admin/me/sessions', admin.accessToken);
    expect(sessions.body.data).toHaveLength(2);
    expect(sessions.body.data.filter((row: { current: boolean }) => row.current)).toHaveLength(1);
    const otherId = sessions.body.data.find((row: { current: boolean }) => !row.current).id;
    expect((await api().get('/api/admin/me/profile', other.accessToken)).status).toBe(200);
    const disconnect = vi.spyOn(DeliveryPublisher, 'disconnectUser');
    try {
      expect((await api().delete(`/api/admin/me/sessions/${otherId}`, admin.accessToken)).status).toBe(200);
      expect(disconnect).toHaveBeenCalledWith(admin.user.id, 'LOGOUT');
    } finally { disconnect.mockRestore(); }
    expect((await api().get('/api/admin/me/profile', other.accessToken)).status).toBe(401);
    expect((await api().post('/api/auth/admin/refresh', undefined, undefined, other.cookie)).status).toBe(401);
    expect((await api().get('/api/admin/me/profile', admin.accessToken)).status).toBe(200);
    // Logout of the current session ends its access token too (not only the refresh cookie).
    expect((await api().post('/api/auth/admin/logout', undefined, undefined, admin.cookie)).status).toBeLessThan(300);
    expect((await api().get('/api/admin/me/profile', admin.accessToken)).status).toBe(401);
  });

  it('E04: a password change revokes every administrator session family', async () => {
    const admin = await enrolledAdmin();
    await new AuthService().changePassword(admin.user.id, PASSWORD, `${PASSWORD}!`);
    expect((await api().get('/api/admin/me/profile', admin.accessToken)).status).toBe(401);
    expect(await prisma.adminSession.count({ where: { userId: admin.user.id, revokedAt: null } })).toBe(0);
  });

  it('SEC-11/E05: sensitive writes need a recent step-up; the last factor cannot be removed', async () => {
    const admin = await enrolledAdmin({ owner: true });
    await prisma.adminSession.updateMany({ where: { userId: admin.user.id }, data: { mfaVerifiedAt: new Date(Date.now() - 20 * 60_000), stepUpAt: null } });
    const blocked = await api().post('/api/admin/invitations', { email: `stepup-${randomUUID().slice(0, 6)}@qa.invalid` }, admin.accessToken);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('STEP_UP_REQUIRED');
    expect((await api().post('/api/admin/me/security/step-up', { method: 'TOTP', code: '000000' }, admin.accessToken)).status).toBe(401);
    expect((await api().post('/api/admin/me/security/step-up', { method: 'TOTP', code: code(admin.secret, 1) }, admin.accessToken)).status).toBe(200);
    const factors = await api().get('/api/admin/me/security/factors', admin.accessToken);
    const removeLast = await api().delete(`/api/admin/me/security/totp/${factors.body.data.totp[0].id}`, admin.accessToken);
    expect(removeLast.status).toBe(409);
    expect(removeLast.body.error.code).toBe('LAST_FACTOR');
  });

  it('C01–C05/SEC-02/SEC-03: invitation lifecycle is permissioned, single-use, email-bound and race-safe', async () => {
    const owner = await enrolledAdmin({ owner: true });
    const plain = await enrolledAdmin();
    const customer = await createUser('CUSTOMER');
    const customerLogin = await api().post('/api/auth/login', { email: customer.email, password: PASSWORD });
    expect(customerLogin.body.accessToken).toBeDefined(); // SEC-12: customer login unchanged
    const email = `invitee-${randomUUID().slice(0, 8)}@qa.invalid`;

    expect((await api().post('/api/admin/invitations', { email })).status).toBe(401);
    expect((await api().post('/api/admin/invitations', { email }, customerLogin.body.accessToken)).status).toBe(403);
    const unprivileged = await api().post('/api/admin/invitations', { email }, plain.accessToken);
    expect(unprivileged.status).toBe(403);
    expect(unprivileged.body.error.code).toBe('CAPABILITY_REQUIRED');

    const created = await api().post('/api/admin/invitations', { email: email.toUpperCase() }, owner.accessToken);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ email, status: 'PENDING', deliveryStatus: 'SENT' });
    expect(JSON.stringify(created.body)).not.toMatch(/token/i);
    expect((await api().post('/api/admin/invitations', { email }, owner.accessToken)).body.error.code).toBe('INVITATION_EXISTS');
    const firstToken = sentInvitations.at(-1)!.token;
    const stored = await prisma.adminInvitation.findFirstOrThrow({ where: { email } });
    expect(stored.tokenHash).not.toBe(firstToken);

    // Resend invalidates the previous link.
    await prisma.adminInvitation.update({ where: { id: stored.id }, data: { lastSentAt: new Date(Date.now() - 120_000) } });
    expect((await api().post(`/api/admin/invitations/${stored.id}/resend`, {}, owner.accessToken)).status).toBe(200);
    const token = sentInvitations.at(-1)!.token;
    expect((await api().post('/api/auth/admin/invitations/preview', { token: firstToken })).status).toBe(410);
    expect((await api().post('/api/auth/admin/invitations/preview', { token })).body).toMatchObject({ email });

    // The server alone chooses the role: unknown body fields are rejected outright.
    expect((await api().post('/api/auth/admin/invitations/accept', { token, firstName: 'New', lastName: 'Admin', password: PASSWORD, role: 'ADMIN' })).status).toBe(400);
    const accepted = await Promise.all([1, 2].map(() =>
      api().post('/api/auth/admin/invitations/accept', { token, firstName: 'New', lastName: 'Admin', password: PASSWORD })));
    expect(accepted.map(result => result.status).sort()).toEqual([201, 410]);
    const winner = accepted.find(result => result.status === 201)!;
    expect(winner.body).toMatchObject({ requiresMfa: true, enrollmentRequired: true });
    expect(winner.body.accessToken).toBeUndefined();
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    expect((await api().post('/api/auth/admin/invitations/accept', { token, firstName: 'Again', lastName: 'Admin', password: PASSWORD })).status).toBe(410);

    // The invitee becomes a full administrator only after enrolling a factor, and gets no team capability by default.
    const client = api();
    const start = await client.post('/api/auth/admin/mfa/enrollment/start', { mfaToken: winner.body.mfaToken });
    const confirm = await client.post('/api/auth/admin/mfa/enrollment/confirm', { mfaToken: winner.body.mfaToken, factorId: start.body.factorId, code: code(start.body.secret) });
    expect(confirm.status).toBe(200);
    expect(confirm.body.user.role).toBe('ADMIN');
    expect((await api().get('/api/admin/catalog/products', confirm.body.accessToken)).status).toBe(200);
    expect((await api().get('/api/admin/invitations', confirm.body.accessToken)).status).toBe(403);

    // Revoked and expired invitations are unusable; history is kept.
    const other = `revoked-${randomUUID().slice(0, 8)}@qa.invalid`;
    const second = await api().post('/api/admin/invitations', { email: other }, owner.accessToken);
    const secondToken = sentInvitations.at(-1)!.token;
    expect((await api().post(`/api/admin/invitations/${second.body.data.id}/revoke`, {}, owner.accessToken)).body.data.status).toBe('REVOKED');
    expect((await api().post('/api/auth/admin/invitations/preview', { token: secondToken })).status).toBe(410);
    const third = await api().post('/api/admin/invitations', { email: `expired-${randomUUID().slice(0, 8)}@qa.invalid` }, owner.accessToken);
    const thirdToken = sentInvitations.at(-1)!.token;
    await prisma.adminInvitation.update({ where: { id: third.body.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await api().post('/api/auth/admin/invitations/accept', { token: thirdToken, firstName: 'Late', lastName: 'Admin', password: PASSWORD })).status).toBe(410);
    expect(await prisma.adminAuditLog.count({ where: { action: { startsWith: 'ADMIN_INVITATION_' } } })).toBeGreaterThanOrEqual(5);
  });

  it('SEC-10: only owners change access, never their own; deactivating an administrator ends their sessions at once', async () => {
    const owner = await enrolledAdmin({ owner: true });
    const manager = await enrolledAdmin({ manage: true });
    const target = await enrolledAdmin();
    expect((await api().patch(`/api/admin/administrators/${owner.user.id}/access`, { isActive: false }, owner.accessToken)).body.error.code).toBe('SELF_CHANGE');
    expect((await api().patch(`/api/admin/administrators/${target.user.id}/access`, { isActive: false }, manager.accessToken)).status).toBe(403);
    expect((await api().patch(`/api/admin/administrators/${target.user.id}/access`, { isActive: false }, owner.accessToken)).status).toBe(200);
    expect((await api().get('/api/admin/me/profile', target.accessToken)).status).toBe(401);
    expect((await api().post('/api/auth/admin/refresh', undefined, undefined, target.cookie)).status).toBe(401);
  });

  it('SEC-10: concurrent deactivation of the last two owners leaves one active owner', async () => {
    // Earlier integration cases intentionally leave synthetic owners behind; isolate this invariant to two owners.
    await prisma.adminAccountSecurity.updateMany({ where: { isOwner: true }, data: { isOwner: false } });
    const first = await enrolledAdmin({ owner: true });
    const second = await enrolledAdmin({ owner: true });
    const responses = await Promise.all([
      api().patch(`/api/admin/administrators/${second.user.id}/access`, { isActive: false }, first.accessToken),
      api().patch(`/api/admin/administrators/${first.user.id}/access`, { isActive: false }, second.accessToken),
    ]);
    expect(responses.filter(response => response.status === 200)).toHaveLength(1);
    expect(await prisma.adminAccountSecurity.count({ where: { isOwner: true, user: { isActive: true } } })).toBe(1);
  });

  it('PW-01: admin password change needs step-up and the current password, enforces policy, and ends every session', async () => {
    const admin = await enrolledAdmin();
    const second = await signIn(admin.user.email, admin.secret, 1);
    const NEW = 'Brand-New-7-Passphrase';
    // The shared customer route cannot be used to skip the administrator step-up.
    const shared = await api().post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: NEW }, admin.accessToken);
    expect(shared.status).toBe(403);
    expect(shared.body.code).toBe('ADMIN_ENDPOINT_REQUIRED');

    await prisma.adminSession.updateMany({ where: { userId: admin.user.id }, data: { mfaVerifiedAt: new Date(Date.now() - 20 * 60_000), stepUpAt: null } });
    const stale = await api().post('/api/admin/me/password', { currentPassword: PASSWORD, newPassword: NEW }, admin.accessToken);
    expect(stale.status).toBe(403);
    expect(stale.body.error.code).toBe('STEP_UP_REQUIRED');
    // A recovery code, not a TOTP: this account's current time steps were already used by enrollment and the second sign-in.
    expect((await api().post('/api/admin/me/security/step-up', { method: 'RECOVERY_CODE', code: admin.recoveryCodes[0] }, admin.accessToken)).status).toBe(200);

    const wrong = await api().post('/api/admin/me/password', { currentPassword: 'Not-The-Password-1', newPassword: NEW }, admin.accessToken);
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
    const weak = await api().post('/api/admin/me/password', { currentPassword: PASSWORD, newPassword: 'alllowercase' }, admin.accessToken);
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('VALIDATION_FAILED');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })).passwordHash).toBe(admin.user.passwordHash);

    const changed = await api().post('/api/admin/me/password', { currentPassword: PASSWORD, newPassword: NEW }, admin.accessToken);
    expect(changed.status).toBe(200);
    expect(changed.body.data).toEqual({ changed: true, signInRequired: true });
    expect(((changed.headers['set-cookie'] as unknown as string[]) ?? []).some(value => value.startsWith('electrohub_admin_refresh=;'))).toBe(true);
    for (const token of [admin.accessToken, second.accessToken]) expect((await api().get('/api/admin/me/profile', token)).status).toBe(401);
    for (const cookie of [admin.cookie, second.cookie]) expect((await api().post('/api/auth/admin/refresh', undefined, undefined, cookie)).status).toBe(401);
    expect(await prisma.adminSession.count({ where: { userId: admin.user.id, revokedAt: null } })).toBe(0);
    expect(await prisma.securityEvent.count({ where: { userId: admin.user.id, type: 'PASSWORD_CHANGED' } })).toBe(1);
    expect(await prisma.adminAuditLog.count({ where: { actorId: admin.user.id, action: 'ADMIN_PASSWORD_CHANGED' } })).toBe(1);
    expect((await api().post('/api/auth/login', { email: admin.user.email, password: PASSWORD })).status).toBe(401);
    expect((await api().post('/api/auth/login', { email: admin.user.email, password: NEW })).body.requiresMfa).toBe(true);
  });

  it('DEL-01: an eligible administrator deletes only their own account; access ends and history is kept', async () => {
    const manager = await enrolledAdmin({ manage: true });
    const other = await enrolledAdmin();
    const invitee = `pending-${randomUUID().slice(0, 8)}@qa.invalid`;
    expect((await api().post('/api/admin/invitations', { email: invitee }, manager.accessToken)).status).toBe(201);
    const auditBefore = await prisma.adminAuditLog.count({ where: { actorId: manager.user.id } });

    // No target id is accepted, and every confirmation is required.
    expect((await api().post('/api/admin/me/delete', { currentPassword: PASSWORD, confirmation: 'DELETE', userId: other.user.id }, manager.accessToken)).status).toBe(400);
    expect((await api().post('/api/admin/me/delete', { currentPassword: PASSWORD, confirmation: 'delete' }, manager.accessToken)).status).toBe(400);
    const wrong = await api().post('/api/admin/me/delete', { currentPassword: 'Not-The-Password-1', confirmation: 'DELETE' }, manager.accessToken);
    expect(wrong.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: manager.user.id } })).isActive).toBe(true);

    const disconnect = vi.spyOn(DeliveryPublisher, 'disconnectUser');
    try {
      const deleted = await api().post('/api/admin/me/delete', { currentPassword: PASSWORD, confirmation: 'DELETE' }, manager.accessToken);
      expect(deleted.status).toBe(200);
      expect(deleted.body.data).toEqual({ deleted: true });
      expect(disconnect).toHaveBeenCalledWith(manager.user.id, 'ACCOUNT_DELETED');
    } finally { disconnect.mockRestore(); }

    const row = await prisma.user.findUniqueOrThrow({ where: { id: manager.user.id }, include: { adminSecurity: true } });
    expect(row).toMatchObject({ isActive: false, passwordHash: null, firstName: 'Deleted', lastName: 'Administrator', email: `deleted-admin-${manager.user.id}@deleted.invalid` });
    expect(row.adminSecurity).toMatchObject({ isOwner: false, canManageAdmins: false, enrollmentAllowedUntil: null });
    expect(await prisma.adminMfaFactor.count({ where: { userId: manager.user.id } })).toBe(0);
    expect(await prisma.adminRecoveryCode.count({ where: { userId: manager.user.id } })).toBe(0);
    expect(await prisma.adminSession.count({ where: { userId: manager.user.id, revokedAt: null } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId: manager.user.id, isRevoked: false } })).toBe(0);
    expect((await prisma.adminInvitation.findFirstOrThrow({ where: { email: invitee } })).status).toBe('REVOKED');
    // Accountability survives: earlier audit rows keep their actor, and the deletion itself is audited.
    expect(await prisma.adminAuditLog.count({ where: { actorId: manager.user.id } })).toBe(auditBefore + 1);
    expect(await prisma.adminAuditLog.count({ where: { actorId: manager.user.id, action: 'ADMIN_ACCOUNT_DELETED' } })).toBe(1);
    expect(await prisma.securityEvent.count({ where: { userId: manager.user.id, type: 'ACCOUNT_DELETED' } })).toBe(1);

    // A deleted administrator cannot use old access or refresh tokens, sign in, or reach any admin API.
    expect((await api().get('/api/admin/me/profile', manager.accessToken)).status).toBe(401);
    expect((await api().get('/api/admin/catalog/products', manager.accessToken)).status).toBe(401);
    expect((await api().post('/api/auth/admin/refresh', undefined, undefined, manager.cookie)).status).toBe(401);
    expect((await api().post('/api/auth/login', { email: manager.user.email, password: PASSWORD })).status).toBe(401);
    // The other administrator is untouched.
    expect((await api().get('/api/admin/me/profile', other.accessToken)).status).toBe(200);
  });

  it('DEL-02: the last active Owner cannot delete their account; with another Owner they can, and step-up is required', async () => {
    await prisma.adminAccountSecurity.updateMany({ where: { isOwner: true }, data: { isOwner: false } });
    const owner = await enrolledAdmin({ owner: true });
    expect((await api().get('/api/admin/me/profile', owner.accessToken)).body.data.deletion).toEqual({ allowed: false, reason: 'LAST_OWNER' });
    const blocked = await api().post('/api/admin/me/delete', { currentPassword: PASSWORD, confirmation: 'DELETE' }, owner.accessToken);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({ code: 'LAST_OWNER',
      message: 'You are the last active Owner. Transfer ownership to another administrator before deleting your account.' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.user.id } })).isActive).toBe(true);

    const coOwner = await enrolledAdmin({ owner: true });
    expect((await api().get('/api/admin/me/profile', owner.accessToken)).body.data.deletion).toEqual({ allowed: true, reason: null });
    await prisma.adminSession.updateMany({ where: { userId: owner.user.id }, data: { mfaVerifiedAt: new Date(Date.now() - 20 * 60_000), stepUpAt: null } });
    expect((await api().post('/api/admin/me/delete', { currentPassword: PASSWORD, confirmation: 'DELETE' }, owner.accessToken)).body.error.code).toBe('STEP_UP_REQUIRED');
    expect((await api().post('/api/admin/me/security/step-up', { method: 'RECOVERY_CODE', code: owner.recoveryCodes[0] }, owner.accessToken)).status).toBe(200);
    expect((await api().post('/api/admin/me/delete', { currentPassword: PASSWORD, confirmation: 'DELETE' }, owner.accessToken)).status).toBe(200);
    // Ownership was not handed to anyone: the remaining owner is the one that already existed, and is now the last.
    expect(await prisma.adminAccountSecurity.findMany({ where: { isOwner: true, user: { isActive: true } }, select: { userId: true } })).toEqual([{ userId: coOwner.user.id }]);
    expect((await api().post('/api/admin/me/delete', { currentPassword: PASSWORD, confirmation: 'DELETE' }, coOwner.accessToken)).body.error.code).toBe('LAST_OWNER');
  });

  it('DEL-03: two Owners deleting themselves at once cannot leave the store without an active Owner', async () => {
    await prisma.adminAccountSecurity.updateMany({ where: { isOwner: true }, data: { isOwner: false } });
    const first = await enrolledAdmin({ owner: true });
    const second = await enrolledAdmin({ owner: true });
    const responses = await Promise.all([first, second].map(owner =>
      api().post('/api/admin/me/delete', { currentPassword: PASSWORD, confirmation: 'DELETE' }, owner.accessToken)));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(responses.find(response => response.status === 409)!.body.error.code).toBe('LAST_OWNER');
    expect(await prisma.adminAccountSecurity.count({ where: { isOwner: true, user: { isActive: true } } })).toBe(1);
  });

  it('DEL-04: customer password change is unchanged and the administrator endpoints refuse customers', async () => {
    const customer = await createUser('CUSTOMER');
    const login = await api().post('/api/auth/login', { email: customer.email, password: PASSWORD });
    expect((await api().post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: `${PASSWORD}!` }, login.body.accessToken)).status).toBe(200);
    const again = await api().post('/api/auth/login', { email: customer.email, password: `${PASSWORD}!` });
    expect(again.body.accessToken).toBeDefined();
    expect((await api().post('/api/admin/me/password', { currentPassword: `${PASSWORD}!`, newPassword: 'Another-Pass-9-Word' }, again.body.accessToken)).status).toBe(403);
    expect((await api().post('/api/admin/me/delete', { currentPassword: `${PASSWORD}!`, confirmation: 'DELETE' }, again.body.accessToken)).status).toBe(403);
  });

  it('ACT-01..ACT-14: Owner-authorized activation of an existing factor-less administrator (hashed, single-use, password rotated before enrollment)', async () => {
    const owner = await enrolledAdmin({ owner: true });
    const manager = await enrolledAdmin({ manage: true });
    const customer = await createUser('CUSTOMER');
    const customerLogin = await api().post('/api/auth/login', { email: customer.email, password: PASSWORD });
    const legacy = await createUser('ADMIN', { enrollWindow: false });
    const url = `/api/admin/administrators/${legacy.id}/mfa-activation`;

    // The shared/legacy password alone can never open enrollment.
    const refused = await api().post('/api/auth/login', { email: legacy.email, password: PASSWORD });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('ENROLLMENT_NOT_AUTHORIZED');

    // Authorization: unauthenticated, customer, administrator-management without Owner, and Owner without a fresh step-up.
    expect((await api().post(url, undefined)).status).toBe(401);
    expect((await api().post(url, undefined, customerLogin.body.accessToken)).status).toBe(403);
    const asManager = await api().post(url, undefined, manager.accessToken);
    expect(asManager.status).toBe(403);
    expect(asManager.body.error.code).toBe('CAPABILITY_REQUIRED');
    expect((await api().get(url, manager.accessToken)).status).toBe(403);
    await prisma.adminSession.updateMany({ where: { userId: owner.user.id }, data: { mfaVerifiedAt: new Date(Date.now() - 20 * 60_000), stepUpAt: null } });
    const noStepUp = await api().post(url, undefined, owner.accessToken);
    expect(noStepUp.status).toBe(403);
    expect(noStepUp.body.error.code).toBe('STEP_UP_REQUIRED');
    expect((await api().post('/api/admin/me/security/step-up', { method: 'TOTP', code: code(owner.secret, 1) }, owner.accessToken)).status).toBe(200);

    // Ineligible targets: an enrolled administrator, an unknown id, a customer, a deactivated administrator.
    const enrolledTarget = await api().post(`/api/admin/administrators/${manager.user.id}/mfa-activation`, undefined, owner.accessToken);
    expect(enrolledTarget.status).toBe(409);
    expect(enrolledTarget.body.error.code).toBe('ALREADY_ENROLLED');
    expect((await api().post(`/api/admin/administrators/${randomUUID()}/mfa-activation`, undefined, owner.accessToken)).status).toBe(404);
    expect((await api().post(`/api/admin/administrators/${customer.id}/mfa-activation`, undefined, owner.accessToken)).status).toBe(404);
    const inactive = await createUser('ADMIN', { enrollWindow: false });
    await prisma.user.update({ where: { id: inactive.id }, data: { isActive: false } });
    expect((await api().post(`/api/admin/administrators/${inactive.id}/mfa-activation`, undefined, owner.accessToken)).body.error.code).toBe('ACCOUNT_INACTIVE');

    // Request: concurrent Owners and repeated clicks produce exactly one activation; the token is emailed, hashed, never returned.
    const second = await enrolledAdmin({ owner: true });
    const requests = await Promise.all([owner, second, owner].map(actor => api().post(url, undefined, actor.accessToken)));
    expect(requests.map(response => response.status).sort()).toEqual([201, 409, 409]);
    const created = requests.find(response => response.status === 201)!;
    expect(created.body.data).toMatchObject({ status: 'PENDING', deliveryStatus: 'SENT' });
    expect(JSON.stringify(created.body)).not.toMatch(/token/i);
    const first = sentActivations.filter(item => item.to === legacy.email).at(-1)!;
    expect(sentActivations.filter(item => item.to === legacy.email)).toHaveLength(1);
    const stored = await prisma.adminMfaActivation.findFirstOrThrow({ where: { userId: legacy.id } });
    expect(stored.tokenHash).not.toBe(first.token);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await api().get(url, owner.accessToken)).body.data).toMatchObject({ status: 'PENDING' });
    // Requesting the link does not open enrollment: the old password is still refused.
    expect((await api().post('/api/auth/login', { email: legacy.email, password: PASSWORD })).body.error.code).toBe('ENROLLMENT_NOT_AUTHORIZED');

    // Resend replaces the digest (old link dead) after the cooldown; revoke kills the link; a new request is then allowed.
    expect((await api().post(`${url}/resend`, undefined, owner.accessToken)).body.error.code).toBe('RESEND_COOLDOWN');
    await prisma.adminMfaActivation.update({ where: { id: stored.id }, data: { lastSentAt: new Date(Date.now() - 120_000) } });
    expect((await api().post(`${url}/resend`, undefined, owner.accessToken)).status).toBe(200);
    const resent = sentActivations.filter(item => item.to === legacy.email).at(-1)!;
    expect(resent.token).not.toBe(first.token);
    expect((await api().post('/api/auth/admin/activation/preview', { token: first.token })).status).toBe(410);
    expect((await api().post('/api/auth/admin/activation/preview', { token: resent.token })).body).toMatchObject({ email: legacy.email });
    expect((await api().post(`${url}/revoke`, undefined, owner.accessToken)).body.data.status).toBe('REVOKED');
    expect((await api().post('/api/auth/admin/activation/redeem', { token: resent.token, password: 'Fresh-Unique-9-Secret' })).status).toBe(410);
    expect((await api().post(url, undefined, owner.accessToken)).status).toBe(201);
    const live = sentActivations.filter(item => item.to === legacy.email).at(-1)!;

    // Expiry is enforced, and an expired activation is closed and replaced by a new request.
    await prisma.adminMfaActivation.updateMany({ where: { userId: legacy.id, status: 'PENDING' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await api().post('/api/auth/admin/activation/redeem', { token: live.token, password: 'Fresh-Unique-9-Secret' })).status).toBe(410);
    expect((await api().get(url, owner.accessToken)).body.data.status).toBe('EXPIRED');
    expect((await api().post(url, undefined, owner.accessToken)).status).toBe(201);
    const token = sentActivations.filter(item => item.to === legacy.email).at(-1)!.token;

    // Redemption: strict validation; a reused password is refused without consuming the token.
    expect((await api().post('/api/auth/admin/activation/redeem', { token, password: 'weak' })).status).toBe(400);
    expect((await api().post('/api/auth/admin/activation/redeem', { token, password: PASSWORD, role: 'ADMIN' })).status).toBe(400);
    const reused = await api().post('/api/auth/admin/activation/redeem', { token, password: PASSWORD });
    expect(reused.status).toBe(422);
    expect(reused.body.error.code).toBe('PASSWORD_REUSED');

    // Concurrent redemption has exactly one winner; no session or cookie is issued.
    const NEW_PASSWORD = 'Fresh-Unique-9-Secret';
    const redemptions = await Promise.all([1, 2].map(() => api().post('/api/auth/admin/activation/redeem', { token, password: NEW_PASSWORD })));
    expect(redemptions.map(response => response.status).sort()).toEqual([200, 410]);
    const winner = redemptions.find(response => response.status === 200)!;
    expect(winner.body).toMatchObject({ requiresMfa: true, enrollmentRequired: true });
    expect(winner.body.accessToken).toBeUndefined();
    expect(refreshCookie(winner)).toBeUndefined();
    expect(await prisma.refreshToken.count({ where: { userId: legacy.id, isRevoked: false } })).toBe(0);
    expect(await prisma.adminMfaActivation.count({ where: { userId: legacy.id, status: 'REDEEMED' } })).toBe(1);

    // The previous password is dead; the new one only opens a restricted enrollment challenge; TOTP proof is still mandatory.
    expect((await api().post('/api/auth/login', { email: legacy.email, password: PASSWORD })).status).toBe(401);
    const login = await api().post('/api/auth/login', { email: legacy.email, password: NEW_PASSWORD });
    expect(login.body).toMatchObject({ requiresMfa: true, enrollmentRequired: true });
    expect(login.body.accessToken).toBeUndefined();
    const start = await api().post('/api/auth/admin/mfa/enrollment/start', { mfaToken: login.body.mfaToken });
    expect(start.status).toBe(200);
    expect((await api().post('/api/auth/admin/mfa/enrollment/confirm', { mfaToken: login.body.mfaToken, factorId: start.body.factorId, code: '000000' })).status).toBe(401);
    const confirmed = await api().post('/api/auth/admin/mfa/enrollment/confirm', { mfaToken: login.body.mfaToken, factorId: start.body.factorId, code: code(start.body.secret) });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.recoveryCodes).toHaveLength(10);
    const security = await prisma.adminAccountSecurity.findUniqueOrThrow({ where: { userId: legacy.id } });
    expect(security).toMatchObject({ isOwner: false, canManageAdmins: false, enrollmentAllowedUntil: null });
    expect(security.mfaEnrolledAt).not.toBeNull();

    // Replay, repeat requests and the Owner list after completion.
    expect((await api().post('/api/auth/admin/activation/redeem', { token, password: 'Another-Unique-9-Pass' })).status).toBe(410);
    expect((await api().post(url, undefined, owner.accessToken)).body.error.code).toBe('ALREADY_ENROLLED');
    const list = await api().get('/api/admin/administrators?pageSize=50', owner.accessToken);
    expect(list.body.data.find((row: { id: string }) => row.id === legacy.id)).toMatchObject({ mfaEnrolled: true, mfaActivation: null, isOwner: false, canManageAdmins: false });
    expect(await prisma.user.count({ where: { email: legacy.email } })).toBe(1);
    const signInAgain = await api().post('/api/auth/login', { email: legacy.email, password: NEW_PASSWORD });
    expect((await api().post('/api/auth/admin/mfa/totp/verify', { mfaToken: signInAgain.body.mfaToken, code: code(start.body.secret, 1) })).status).toBe(200);
  });

  it('SEED-01: re-running the administrator seed never resets a password, reactivates, or alters role/owner/MFA state', async () => {
    const adminRoleId = await roleId('ADMIN');
    const email = 'admin1@electrohub.com';
    await prisma.user.deleteMany({ where: { email } });
    const first = await seedAdministrators(prisma, { adminRoleId, passwordFor: () => 'Seed-Fallback-9-Password' });
    expect(first).toContain(email);
    const seeded = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(await prisma.adminAccountSecurity.count({ where: { userId: seeded.id } })).toBe(0); // no enrollment window, no owner
    // The account is later activated by an Owner (rotated password), deactivated, and given owner-adjacent state.
    const rotated = await hashPassword('Rotated-Unique-9-Secret');
    await prisma.user.update({ where: { id: seeded.id }, data: { passwordHash: rotated, isActive: false } });
    await prisma.adminAccountSecurity.create({ data: { userId: seeded.id, canManageAdmins: false, mfaEnrolledAt: new Date() } });
    const second = await seedAdministrators(prisma, { adminRoleId, passwordFor: () => 'Seed-Fallback-9-Password' });
    expect(second).not.toContain(email);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(after.passwordHash).toBe(rotated);
    expect(after.isActive).toBe(false);
    expect(after.roleId).toBe(adminRoleId);
    expect(await prisma.adminAccountSecurity.findUniqueOrThrow({ where: { userId: seeded.id } })).toMatchObject({ isOwner: false, canManageAdmins: false, enrollmentAllowedUntil: null });
  });
  // ── Owner succession ─────────────────────────────────────────────────────
  const onlyOwner = async () => {
    await prisma.adminAccountSecurity.updateMany({ where: { isOwner: true }, data: { isOwner: false } });
    return enrolledAdmin({ owner: true });
  };
  const ownerState = async (id: string) => {
    const row = await prisma.user.findUniqueOrThrow({ where: { id }, select: { isActive: true, adminSecurity: { select: { isOwner: true } } } });
    return { isActive: row.isActive, isOwner: row.adminSecurity?.isOwner ?? false };
  };
  const transfer = (token: string, successorId: string, extra: object = {}) =>
    api().post('/api/admin/me/ownership-transfer-and-delete', { successorId, currentPassword: PASSWORD, confirmation: 'DELETE', ...extra }, token);

  it('OWN-01: only an Owner with a recent step-up promotes an eligible administrator; sessions end and Owner works after a fresh MFA sign-in', async () => {
    const owner = await onlyOwner();
    const target = await enrolledAdmin();
    const manager = await enrolledAdmin({ manage: true });
    const plain = await enrolledAdmin();
    const customer = await createUser('CUSTOMER');
    const customerToken = (await api().post('/api/auth/login', { email: customer.email, password: PASSWORD })).body.accessToken as string;
    const grant = (token: string, id: string) => api().post(`/api/admin/administrators/${id}/grant-owner`, {}, token);

    // canManageAdmins alone, a plain ADMIN and a CUSTOMER cannot grant Owner.
    for (const token of [manager.accessToken, plain.accessToken, customerToken]) expect((await grant(token, target.user.id)).status).toBe(403);
    // The access PATCH never accepts isOwner.
    expect((await api().patch(`/api/admin/administrators/${target.user.id}/access`, { isOwner: true }, owner.accessToken)).status).toBe(400);
    expect(await ownerState(target.user.id)).toEqual({ isActive: true, isOwner: false });

    // Ineligible targets: unknown, a customer, inactive, factor-less (even with an expired activation), a pending security lifecycle change.
    expect((await grant(owner.accessToken, randomUUID())).body.error.code).toBe('SUCCESSOR_NOT_FOUND');
    expect((await grant(owner.accessToken, customer.id)).body.error.code).toBe('SUCCESSOR_NOT_FOUND');
    const inactive = await enrolledAdmin();
    await prisma.user.update({ where: { id: inactive.user.id }, data: { isActive: false } });
    expect((await grant(owner.accessToken, inactive.user.id)).body.error.code).toBe('SUCCESSOR_INACTIVE');
    const factorless = await createUser('ADMIN');
    await prisma.adminMfaActivation.create({ data: { userId: factorless.id, email: factorless.email, tokenHash: randomBytes(32).toString('hex'),
      status: 'PENDING', expiresAt: new Date(Date.now() - 60_000) } });
    expect((await grant(owner.accessToken, factorless.id)).body.error.code).toBe('SUCCESSOR_MFA_REQUIRED');
    const pendingReset = await enrolledAdmin();
    await prisma.adminMfaActivation.create({ data: { userId: pendingReset.user.id, email: pendingReset.user.email, tokenHash: randomBytes(32).toString('hex'),
      status: 'PENDING', expiresAt: new Date(Date.now() + 3600_000) } });
    expect((await grant(owner.accessToken, pendingReset.user.id)).body.error.code).toBe('SUCCESSOR_NOT_ELIGIBLE');
    expect(await prisma.adminAuditLog.count({ where: { actorId: owner.user.id, action: 'ADMIN_OWNER_GRANTED', outcome: 'DENIED' } })).toBeGreaterThanOrEqual(4);

    // An expired step-up is refused without changing anything.
    await prisma.adminSession.updateMany({ where: { userId: owner.user.id }, data: { mfaVerifiedAt: new Date(Date.now() - 20 * 60_000), stepUpAt: null } });
    expect((await grant(owner.accessToken, target.user.id)).body.error.code).toBe('STEP_UP_REQUIRED');
    expect(await ownerState(target.user.id)).toEqual({ isActive: true, isOwner: false });
    expect((await api().post('/api/admin/me/security/step-up', { method: 'RECOVERY_CODE', code: owner.recoveryCodes[0] }, owner.accessToken)).status).toBe(200);

    const disconnect = vi.spyOn(DeliveryPublisher, 'disconnectUser');
    try {
      const granted = await grant(owner.accessToken, target.user.id);
      expect(granted.status).toBe(200);
      expect(granted.body.data).toEqual({ id: target.user.id, isOwner: true, canManageAdmins: true, signInRequired: true });
      expect(disconnect).toHaveBeenCalledWith(target.user.id, 'LOGOUT');
    } finally { disconnect.mockRestore(); }
    expect(await prisma.adminAccountSecurity.findUniqueOrThrow({ where: { userId: target.user.id } })).toMatchObject({ isOwner: true, canManageAdmins: true });
    expect(await prisma.adminAuditLog.count({ where: { actorId: owner.user.id, action: 'ADMIN_OWNER_GRANTED', outcome: 'SUCCESS', resourceId: target.user.id } })).toBe(1);
    expect(sentOwnerGrants).toContain(target.user.email);
    // The promoted administrator's existing access and refresh tokens are dead; a fresh password + MFA sign-in carries Owner.
    expect((await api().get('/api/admin/me/profile', target.accessToken)).status).toBe(401);
    expect((await api().post('/api/auth/admin/refresh', undefined, undefined, target.cookie)).status).toBe(401);
    const fresh = await signIn(target.user.email, target.secret);
    expect(fresh.status).toBe(200);
    expect((await api().get('/api/admin/me/profile', fresh.accessToken)).body.data.isOwner).toBe(true);
    expect((await api().get(`/api/admin/administrators/${plain.user.id}/mfa-activation`, fresh.accessToken)).status).toBe(200); // Owner-only
    // Already-Owner targets (including yourself) are reported, not re-granted.
    expect((await grant(owner.accessToken, target.user.id)).body.error.code).toBe('ALREADY_OWNER');
    expect((await grant(owner.accessToken, owner.user.id)).body.error.code).toBe('ALREADY_OWNER');
  });

  it('OWN-02: the last Owner transfers ownership and is deleted atomically; only eligible successors are offered or accepted', async () => {
    const owner = await onlyOwner();
    const successor = await enrolledAdmin();
    const factorless = await createUser('ADMIN');
    const inactive = await enrolledAdmin();
    await prisma.user.update({ where: { id: inactive.user.id }, data: { isActive: false } });
    const bystander = await enrolledAdmin();
    expect((await api().get('/api/admin/me/profile', owner.accessToken)).body.data.deletion).toEqual({ allowed: false, reason: 'LAST_OWNER' });

    // Successor list: Owner only, eligible administrators only.
    expect((await api().get('/api/admin/me/ownership-successors', bystander.accessToken)).status).toBe(403);
    const list = await api().get('/api/admin/me/ownership-successors', owner.accessToken);
    expect(list.status).toBe(200);
    const ids = list.body.data.map((row: { id: string }) => row.id);
    expect(ids).toEqual(expect.arrayContaining([successor.user.id, bystander.user.id]));
    for (const excluded of [owner.user.id, factorless.id, inactive.user.id]) expect(ids).not.toContain(excluded);
    expect(list.body.data.find((row: { id: string }) => row.id === successor.user.id)).toEqual({ id: successor.user.id, firstName: 'QA', lastName: 'ADMIN',
      email: successor.user.email, canManageAdmins: false, mfa: { totp: 1, passkeys: 0 } });

    // Refusals leave both accounts unchanged (each transfer attempt counts toward the 5-per-15-minute credential limiter).
    expect((await transfer(owner.accessToken, successor.user.id, { currentPassword: 'Not-The-Password-1' })).body.error.code).toBe('INVALID_CURRENT_PASSWORD');
    expect((await transfer(owner.accessToken, factorless.id)).body.error.code).toBe('SUCCESSOR_MFA_REQUIRED');
    expect((await transfer(owner.accessToken, inactive.user.id)).body.error.code).toBe('SUCCESSOR_INACTIVE');
    expect(await ownerState(owner.user.id)).toEqual({ isActive: true, isOwner: true });
    expect(await ownerState(successor.user.id)).toEqual({ isActive: true, isOwner: false });

    const disconnect = vi.spyOn(DeliveryPublisher, 'disconnectUser');
    try {
      const done = await transfer(owner.accessToken, successor.user.id);
      expect(done.status).toBe(200);
      expect(done.body.data).toEqual({ deleted: true, ownershipTransferred: true });
      expect(disconnect).toHaveBeenCalledWith(owner.user.id, 'ACCOUNT_DELETED');
      expect(disconnect).toHaveBeenCalledWith(successor.user.id, 'LOGOUT');
    } finally { disconnect.mockRestore(); }

    expect(await ownerState(successor.user.id)).toEqual({ isActive: true, isOwner: true });
    const gone = await prisma.user.findUniqueOrThrow({ where: { id: owner.user.id }, include: { adminSecurity: true } });
    expect(gone).toMatchObject({ isActive: false, passwordHash: null, email: `deleted-admin-${owner.user.id}@deleted.invalid` });
    expect(gone.adminSecurity).toMatchObject({ isOwner: false, canManageAdmins: false });
    expect(await prisma.adminMfaFactor.count({ where: { userId: owner.user.id } })).toBe(0);
    expect(await countEligibleOwners(prisma)).toBe(1);
    // History is kept and both halves are audited in the same commit.
    expect(await prisma.adminAuditLog.count({ where: { actorId: owner.user.id, outcome: 'SUCCESS', action: { in: ['ADMIN_OWNERSHIP_TRANSFERRED', 'ADMIN_ACCOUNT_DELETED'] } } })).toBe(2);
    expect((await prisma.adminAuditLog.findFirstOrThrow({ where: { actorId: owner.user.id, action: 'ADMIN_ACCOUNT_DELETED' } })).details).toMatchObject({ wasOwner: true, successorId: successor.user.id });
    expect(await prisma.securityEvent.count({ where: { userId: owner.user.id, type: 'LOGIN_SUCCESS' } })).toBeGreaterThan(0);
    expect(sentOwnerGrants).toContain(successor.user.email);

    // The old Owner is locked out; a retry of the same request cannot touch anyone.
    expect((await api().post('/api/auth/login', { email: owner.user.email, password: PASSWORD })).status).toBe(401);
    expect((await api().post('/api/auth/admin/refresh', undefined, undefined, owner.cookie)).status).toBe(401);
    expect((await transfer(owner.accessToken, bystander.user.id)).status).toBe(401);
    expect(await ownerState(bystander.user.id)).toEqual({ isActive: true, isOwner: false });
    // The new Owner must authenticate freshly, then holds Owner capability.
    expect((await api().get('/api/admin/me/profile', successor.accessToken)).status).toBe(401);
    const fresh = await signIn(successor.user.email, successor.secret);
    expect(fresh.status).toBe(200);
    expect((await api().get('/api/admin/me/profile', fresh.accessToken)).body.data).toMatchObject({ isOwner: true, deletion: { allowed: false, reason: 'LAST_OWNER' } });
    expect((await api().get('/api/admin/me/ownership-successors', fresh.accessToken)).status).toBe(200);
  });

  it('OWN-03: transfer needs a recent step-up and current Owner capability; a successor that lost MFA is refused', async () => {
    const owner = await onlyOwner();
    const successor = await enrolledAdmin();
    await prisma.adminSession.updateMany({ where: { userId: owner.user.id }, data: { mfaVerifiedAt: new Date(Date.now() - 20 * 60_000), stepUpAt: null } });
    expect((await transfer(owner.accessToken, successor.user.id)).body.error.code).toBe('STEP_UP_REQUIRED');
    expect((await api().post('/api/admin/me/security/step-up', { method: 'RECOVERY_CODE', code: owner.recoveryCodes[0] }, owner.accessToken)).status).toBe(200);
    // The successor's only factor is reset while the Owner is confirming.
    await prisma.adminMfaFactor.updateMany({ where: { userId: successor.user.id }, data: { disabledAt: new Date() } });
    expect((await transfer(owner.accessToken, successor.user.id)).body.error.code).toBe('SUCCESSOR_MFA_REQUIRED');
    await prisma.adminMfaFactor.updateMany({ where: { userId: successor.user.id }, data: { disabledAt: null } });
    expect((await transfer(owner.accessToken, owner.user.id)).body.error.code).toBe('SUCCESSOR_NOT_ELIGIBLE');
    // The caller stops being an Owner mid-flow.
    await prisma.adminAccountSecurity.update({ where: { userId: owner.user.id }, data: { isOwner: false } });
    expect((await transfer(owner.accessToken, successor.user.id)).status).toBe(403);
    await prisma.adminAccountSecurity.update({ where: { userId: owner.user.id }, data: { isOwner: true } });
    expect(await ownerState(owner.user.id)).toEqual({ isActive: true, isOwner: true });
    expect(await ownerState(successor.user.id)).toEqual({ isActive: true, isOwner: false });
  });

  it('OWN-04: a failure after the successor update rolls everything back; both accounts keep their original security state', async () => {
    const owner = await onlyOwner();
    const successor = await enrolledAdmin();
    // Strict validation: a successor, the exact typed confirmation and no extra fields.
    expect((await api().post('/api/admin/me/ownership-transfer-and-delete', { currentPassword: PASSWORD, confirmation: 'DELETE' }, owner.accessToken)).status).toBe(400);
    expect((await transfer(owner.accessToken, successor.user.id, { confirmation: 'delete' })).status).toBe(400);
    expect((await transfer(owner.accessToken, successor.user.id, { userId: randomUUID() })).status).toBe(400);
    ownershipTestHooks.afterSuccessorPromoted = async () => { throw new Error('injected failure after successor promotion'); };
    try {
      expect((await transfer(owner.accessToken, successor.user.id)).status).toBe(500);
    } finally { delete ownershipTestHooks.afterSuccessorPromoted; }
    expect(await ownerState(owner.user.id)).toEqual({ isActive: true, isOwner: true });
    expect(await ownerState(successor.user.id)).toEqual({ isActive: true, isOwner: false });
    expect(await prisma.adminMfaFactor.count({ where: { userId: owner.user.id, verifiedAt: { not: null } } })).toBe(1);
    expect(await prisma.adminAuditLog.count({ where: { actorId: owner.user.id, outcome: 'SUCCESS', action: { in: ['ADMIN_OWNERSHIP_TRANSFERRED', 'ADMIN_ACCOUNT_DELETED'] } } })).toBe(0);
    // Neither account lost its sessions; the Owner can retry and succeed.
    expect((await api().get('/api/admin/me/profile', owner.accessToken)).status).toBe(200);
    expect((await api().get('/api/admin/me/profile', successor.accessToken)).status).toBe(200);
    expect((await transfer(owner.accessToken, successor.user.id)).status).toBe(200);
    expect(await ownerState(successor.user.id)).toEqual({ isActive: true, isOwner: true });
  });

  it('OWN-05: concurrent owner operations never leave zero eligible Owners or a partial transfer', async () => {
    // Double-clicked transfer: exactly one commit; nothing unrelated changes.
    const owner = await onlyOwner();
    const successor = await enrolledAdmin();
    const bystander = await enrolledAdmin();
    const twice = await Promise.all([transfer(owner.accessToken, successor.user.id), transfer(owner.accessToken, successor.user.id)]);
    expect(twice.filter(response => response.status === 200)).toHaveLength(1);
    expect(await ownerState(successor.user.id)).toEqual({ isActive: true, isOwner: true });
    expect(await ownerState(owner.user.id)).toEqual({ isActive: false, isOwner: false });
    expect(await ownerState(bystander.user.id)).toEqual({ isActive: true, isOwner: false });
    expect(await countEligibleOwners(prisma)).toBe(1);

    // Transfer racing the same Owner's ordinary deletion: never both, and the store keeps an Owner.
    const lone = await onlyOwner();
    const heir = await enrolledAdmin();
    const raced = await Promise.all([transfer(lone.accessToken, heir.user.id),
      api().post('/api/admin/me/delete', { currentPassword: PASSWORD, confirmation: 'DELETE' }, lone.accessToken)]);
    expect(raced[1].status).not.toBe(200);
    expect(raced[0].status).toBe(200);
    expect(await countEligibleOwners(prisma)).toBe(1);

    // Transfer racing the successor's deactivation by another Owner: either order is consistent.
    const first = await onlyOwner();
    const second = await enrolledAdmin({ owner: true });
    const target = await enrolledAdmin();
    const [moved, deactivated] = await Promise.all([transfer(first.accessToken, target.user.id),
      api().patch(`/api/admin/administrators/${target.user.id}/access`, { isActive: false }, second.accessToken)]);
    expect(deactivated.status).toBe(200);
    if (moved.status === 200) {
      expect(await ownerState(first.user.id)).toEqual({ isActive: false, isOwner: false });
    } else {
      expect(moved.body.error.code).toBe('SUCCESSOR_INACTIVE');
      expect(await ownerState(first.user.id)).toEqual({ isActive: true, isOwner: true });
      expect(await ownerState(target.user.id)).toEqual({ isActive: false, isOwner: false });
    }
    expect(await countEligibleOwners(prisma)).toBeGreaterThanOrEqual(1);

    // Two Owners leaving at once (one by transfer, one by deletion) still leave an eligible Owner.
    const a = await onlyOwner();
    const b = await enrolledAdmin({ owner: true });
    const c = await enrolledAdmin();
    const both = await Promise.all([transfer(a.accessToken, c.user.id),
      api().post('/api/admin/me/delete', { currentPassword: PASSWORD, confirmation: 'DELETE' }, b.accessToken)]);
    expect(both.map(response => response.status)).toEqual([200, 200]);
    expect(await prisma.adminAccountSecurity.findMany({ where: { isOwner: true, user: { isActive: true } }, select: { userId: true } })).toEqual([{ userId: c.user.id }]);
    expect(await countEligibleOwners(prisma)).toBe(1);
  });

  // ── Owner revocation ─────────────────────────────────────────────────────
  const revoke = (token: string, id: string, body: object = { confirmation: 'REVOKE' }) =>
    api().post(`/api/admin/administrators/${id}/revoke-owner`, body, token);
  const capabilities = async (id: string) => {
    const row = await prisma.user.findUniqueOrThrow({ where: { id }, select: { isActive: true, passwordHash: true, roleId: true, email: true,
      adminSecurity: { select: { isOwner: true, canManageAdmins: true } } } });
    return { isActive: row.isActive, isOwner: row.adminSecurity?.isOwner ?? false, canManageAdmins: row.adminSecurity?.canManageAdmins ?? false,
      passwordHash: row.passwordHash, roleId: row.roleId, email: row.email };
  };

  describe('DNOTE deleted administrators are hidden and Owners get a one-time notice', () => {
    const del = (admin: { accessToken: string }) => api().post('/api/admin/me/delete', { currentPassword: PASSWORD, confirmation: 'DELETE' }, admin.accessToken);
    const list = (token: string, query = '') => api().get(`/api/admin/administrators${query}`, token);
    /** Every visible row, 50 per page (the API maximum), plus the reported total. */
    const everyone = async (token: string) => {
      const rows: Array<{ id: string; email: string }> = [];
      let total = 0;
      for (let pageNumber = 1; ; pageNumber += 1) {
        const page = await list(token, `?page=${pageNumber}&pageSize=50`);
        expect(page.status).toBe(200);
        total = page.body.meta.total;
        rows.push(...page.body.data);
        if (pageNumber >= page.body.meta.totalPages) return { rows, total };
      }
    };
    const notice = (token: string) => api().get('/api/admin/administrators/deletion-notice', token);
    const ack = (token: string, through: string) => api().post('/api/admin/administrators/deletion-notice/acknowledge', { through }, token);

    it('DNOTE-01: deleted administrators and Owners vanish from the list, search, pagination and counts; inactive ones stay; history and links are kept', async () => {
      const viewer = await onlyOwner();
      const doomed = await enrolledAdmin({ manage: true });
      const doomedOwner = await enrolledAdmin({ owner: true });
      const inactive = await enrolledAdmin();
      await prisma.user.update({ where: { id: inactive.user.id }, data: { isActive: false } });
      const before = await everyone(viewer.accessToken);
      expect(before.rows.map(row => row.id)).toEqual(expect.arrayContaining([doomed.user.id, doomedOwner.user.id, inactive.user.id]));
      expect((await del(doomed)).status).toBe(200);
      expect((await del(doomedOwner)).status).toBe(200); // another Owner (viewer) remains
      const after = await everyone(viewer.accessToken);
      const ids = after.rows.map(row => row.id);
      expect(ids).not.toContain(doomed.user.id);
      expect(ids).not.toContain(doomedOwner.user.id);
      expect(ids).toContain(inactive.user.id);
      expect(after.rows.every(row => !row.email.endsWith('@deleted.invalid'))).toBe(true);
      expect(after.total).toBe(before.total - 2);
      // Search never finds the anonymized rows; pagination covers exactly the visible set.
      expect((await list(viewer.accessToken, '?search=deleted')).body.data).toHaveLength(0);
      const visibleTotal = after.total;
      const paged: string[] = [];
      for (let pageNumber = 1; pageNumber <= Math.ceil(visibleTotal / 3); pageNumber += 1) {
        const page = await list(viewer.accessToken, `?page=${pageNumber}&pageSize=3`);
        expect(page.body.meta.totalPages).toBe(Math.ceil(visibleTotal / 3));
        paged.push(...page.body.data.map((row: { id: string }) => row.id));
      }
      expect(paged).toHaveLength(visibleTotal);
      expect(new Set(paged).size).toBe(visibleTotal);
      // Records are preserved, and a deleted account cannot be reached through access management or activation.
      expect(await prisma.user.count({ where: { id: { in: [doomed.user.id, doomedOwner.user.id] } } })).toBe(2);
      expect(await prisma.adminAuditLog.count({ where: { actorId: doomed.user.id, action: 'ADMIN_ACCOUNT_DELETED' } })).toBe(1);
      const reactivate = await api().patch(`/api/admin/administrators/${doomed.user.id}/access`, { isActive: true }, viewer.accessToken);
      expect([404, 403]).toContain(reactivate.status);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: doomed.user.id } })).isActive).toBe(false);
    });

    it('DNOTE-02: each Owner is notified once per deletion event, independently, across refreshes; rollbacks and non-Owners get nothing', async () => {
      const a = await onlyOwner();
      const b = await enrolledAdmin({ owner: true });
      const manager = await enrolledAdmin({ manage: true });
      expect((await notice(a.accessToken)).body.data).toEqual({ count: 0, through: null });
      expect((await notice(manager.accessToken)).status).toBe(403); // not an Owner
      expect((await ack(manager.accessToken, new Date().toISOString())).status).toBe(403);

      // A failed (rolled-back) deletion creates no event.
      const survivor = await enrolledAdmin();
      ownershipTestHooks.afterSuccessorPromoted = async () => { throw new Error('injected failure before commit'); };
      try { expect((await transfer(a.accessToken, survivor.user.id)).status).toBe(500); } finally { delete ownershipTestHooks.afterSuccessorPromoted; }
      expect((await notice(b.accessToken)).body.data.count).toBe(0);

      const first = await enrolledAdmin();
      expect((await del(first)).status).toBe(200);
      const aSees = (await notice(a.accessToken)).body.data;
      expect(aSees.count).toBe(1);
      expect(JSON.stringify(aSees)).not.toMatch(/deleted\.invalid|@|Deleted Administrator/);
      expect((await notice(a.accessToken)).body.data.count).toBe(1); // a refresh does not consume it
      expect((await ack(a.accessToken, aSees.through)).status).toBe(200);
      expect((await notice(a.accessToken)).body.data).toEqual({ count: 0, through: null }); // stays dismissed
      expect((await ack(a.accessToken, aSees.through)).status).toBe(200); // idempotent
      expect(await prisma.adminAuditLog.count({ where: { actorId: a.user.id, action: 'ADMIN_DELETION_NOTICE_ACKNOWLEDGED' } })).toBe(1);
      expect((await notice(b.accessToken)).body.data.count).toBe(1); // the other Owner is independent
      expect((await ack(b.accessToken, (await notice(b.accessToken)).body.data.through)).status).toBe(200);
      expect((await notice(b.accessToken)).body.data.count).toBe(0);

      // New deletions raise new notices (two at once are one banner with a count, not two).
      const second = await enrolledAdmin();
      const third = await enrolledAdmin();
      expect((await del(second)).status).toBe(200);
      expect((await del(third)).status).toBe(200);
      expect((await notice(a.accessToken)).body.data.count).toBe(2);
      expect((await notice(b.accessToken)).body.data.count).toBe(2);
      // A future timestamp cannot pre-acknowledge deletions that have not happened.
      expect((await ack(a.accessToken, new Date(Date.now() + 3_600_000).toISOString())).status).toBe(400);
      // Ordinary Owner transfer-and-delete is announced to the successor (an Owner) too.
      const leaving = await onlyOwner();
      const heir = await enrolledAdmin();
      expect((await transfer(leaving.accessToken, heir.user.id)).status).toBe(200);
      const heirSees = await signIn(heir.user.email, heir.secret, 1);
      expect((await notice(heirSees.accessToken)).body.data.count).toBe(1);
    });
  });

  describe('RECREATE reusing a deleted administrator email creates a completely new security identity', () => {
    const del = (admin: { accessToken: string }) => api().post('/api/admin/me/delete', { currentPassword: PASSWORD, confirmation: 'DELETE' }, admin.accessToken);

    /** Delete `old` (an enrolled administrator), then invite the same address as `inviter` and accept + enroll MFA. */
    async function recreate(old: Awaited<ReturnType<typeof enrolledAdmin>>, inviter: { accessToken: string }, body: object) {
      const email = old.user.email;
      expect((await del(old)).status).toBe(200);
      const invite = await api().post('/api/admin/invitations', { email, ...body }, inviter.accessToken);
      expect(invite.status).toBe(201);
      const token = sentInvitations.at(-1)!.token;
      const accepted = await api().post('/api/auth/admin/invitations/accept', { token, firstName: 'Fresh', lastName: 'Person', password: PASSWORD });
      expect(accepted.status).toBe(201);
      const client = api();
      const start = await client.post('/api/auth/admin/mfa/enrollment/start', { mfaToken: accepted.body.mfaToken });
      const confirm = await client.post('/api/auth/admin/mfa/enrollment/confirm', { mfaToken: accepted.body.mfaToken, factorId: start.body.factorId, code: code(start.body.secret) });
      expect(confirm.status).toBe(200);
      const fresh = await prisma.user.findUniqueOrThrow({ where: { email } });
      return { email, fresh, secret: start.body.secret as string, accessToken: confirm.body.accessToken as string, recoveryCodes: confirm.body.recoveryCodes as string[] };
    }
    const security = (id: string) => prisma.adminAccountSecurity.findUniqueOrThrow({ where: { userId: id }, select: { isOwner: true, canManageAdmins: true } });

    it('RECREATE-01: a deleted manager (with MFA) is recreated without the permission; the old identity stays anonymized, inactive and audited', async () => {
      const inviter = await enrolledAdmin({ owner: true });
      const old = await enrolledAdmin({ manage: true });
      const oldFactors = await prisma.adminMfaFactor.findMany({ where: { userId: old.user.id }, select: { id: true } });
      expect(oldFactors.length).toBeGreaterThan(0);
      const oldProfile = await api().get('/api/admin/me/profile', old.accessToken);
      expect(oldProfile.status).toBe(200);
      const next = await recreate(old, inviter, {}); // grantManageAdmins omitted → backend default
      // New identity.
      expect(next.fresh.id).not.toBe(old.user.id);
      expect(next.fresh.isActive).toBe(true);
      expect(await security(next.fresh.id)).toEqual({ isOwner: false, canManageAdmins: false });
      const newFactors = await prisma.adminMfaFactor.findMany({ where: { userId: next.fresh.id }, select: { id: true } });
      expect(newFactors).toHaveLength(1);
      expect(oldFactors.map(row => row.id)).not.toContain(newFactors[0]!.id);
      expect(next.secret).not.toBe(old.secret);
      expect(next.recoveryCodes.filter(codeValue => old.recoveryCodes.includes(codeValue))).toHaveLength(0);
      // Old sessions and tokens are dead; the old secret and recovery codes do not sign into the new account.
      expect((await api().get('/api/admin/me/profile', old.accessToken)).status).toBe(401);
      expect((await api().post('/api/auth/admin/refresh', {}, undefined, old.cookie)).status).toBe(401);
      const login = await api().post('/api/auth/login', { email: next.email, password: PASSWORD });
      expect((await api().post('/api/auth/admin/mfa/totp/verify', { mfaToken: login.body.mfaToken, code: code(old.secret, 2) })).status).toBe(401);
      expect((await api().post('/api/auth/admin/mfa/recovery/verify', { mfaToken: login.body.mfaToken, code: old.recoveryCodes[0] })).status).toBe(401);
      // The new administrator is a standard one: no management access.
      expect((await api().get('/api/admin/me/profile', next.accessToken)).status).toBe(200);
      expect((await api().get('/api/admin/invitations', next.accessToken)).status).toBe(403);
      // The previous record: same row, anonymized, inactive, credential-free, still tied to its original audit trail.
      const previous = await prisma.user.findUniqueOrThrow({ where: { id: old.user.id }, select: { email: true, isActive: true, passwordHash: true } });
      expect(previous).toEqual({ email: `deleted-admin-${old.user.id}@deleted.invalid`, isActive: false, passwordHash: null });
      expect(await security(old.user.id)).toEqual({ isOwner: false, canManageAdmins: false });
      expect(await prisma.adminMfaFactor.count({ where: { userId: old.user.id } })).toBe(0);
      expect(await prisma.adminRecoveryCode.count({ where: { userId: old.user.id } })).toBe(0);
      expect(await prisma.adminWebAuthnCredential.count({ where: { userId: old.user.id } })).toBe(0);
      expect(await prisma.adminAuditLog.count({ where: { actorId: old.user.id, action: 'ADMIN_ACCOUNT_DELETED' } })).toBe(1);
      expect(await prisma.adminAuditLog.count({ where: { actorId: next.fresh.id, action: 'ADMIN_ACCOUNT_DELETED' } })).toBe(0);
      expect((await api().patch(`/api/admin/administrators/${old.user.id}/access`, { isActive: true }, inviter.accessToken)).status).toBe(404);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: old.user.id } })).isActive).toBe(false);
    });

    it('RECREATE-02: an explicit Owner grant gives Manages admins to the new account only; a deleted Owner never returns as Owner', async () => {
      const inviter = await enrolledAdmin({ owner: true });
      const oldManager = await enrolledAdmin({ manage: true });
      const granted = await recreate(oldManager, inviter, { grantManageAdmins: true });
      expect(granted.fresh.id).not.toBe(oldManager.user.id);
      expect(await security(granted.fresh.id)).toEqual({ isOwner: false, canManageAdmins: true });
      expect((await api().get('/api/admin/invitations', granted.accessToken)).status).toBe(200);
      expect((await api().post('/api/admin/administrators/deletion-notice/acknowledge', { through: new Date().toISOString() }, granted.accessToken)).status).toBe(403); // not an Owner

      // A former Owner (another Owner remains) is deleted, then recreated with no grant and then with the grant: never Owner.
      const oldOwner = await enrolledAdmin({ owner: true });
      const plain = await recreate(oldOwner, inviter, {});
      expect(await security(plain.fresh.id)).toEqual({ isOwner: false, canManageAdmins: false });
      const ownerId = plain.fresh.id;
      expect((await del({ accessToken: plain.accessToken })).status).toBe(200);
      const anotherOwner = await enrolledAdmin({ owner: true });
      const withGrant = await recreate(await enrolledAdmin({ owner: true }), anotherOwner, { grantManageAdmins: true });
      expect(await security(withGrant.fresh.id)).toEqual({ isOwner: false, canManageAdmins: true });
      expect((await api().post('/api/admin/me/ownership-transfer-and-delete', { successorId: ownerId, currentPassword: PASSWORD, confirmation: 'DELETE' }, withGrant.accessToken)).status).toBe(403);
    });

    it('RECREATE-03: the backend defaults grantManageAdmins to false and only an Owner may set it', async () => {
      const owner = await enrolledAdmin({ owner: true });
      const manager = await enrolledAdmin({ manage: true });
      const bare = `bare-${randomUUID().slice(0, 8)}@qa.invalid`;
      expect((await api().post('/api/admin/invitations', { email: bare }, owner.accessToken)).status).toBe(201);
      expect((await prisma.adminInvitation.findFirstOrThrow({ where: { email: bare } })).grantManageAdmins).toBe(false);
      const refused = await api().post('/api/admin/invitations', { email: `deny-${randomUUID().slice(0, 8)}@qa.invalid`, grantManageAdmins: true }, manager.accessToken);
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('CAPABILITY_REQUIRED');
      // Non-boolean or unknown fields cannot smuggle a grant in.
      for (const body of [{ grantManageAdmins: 'true' }, { grantManageAdmins: 1 }, { isOwner: true }, { canManageAdmins: true }, { role: 'ADMIN' }]) {
        expect((await api().post('/api/admin/invitations', { email: `bad-${randomUUID().slice(0, 8)}@qa.invalid`, ...body }, owner.accessToken)).status).toBe(400);
      }
      // A stale grant on an old invitation row for the address cannot attach to a later account: grants come from the accepted invitation only.
      const email = `stale-${randomUUID().slice(0, 8)}@qa.invalid`;
      await prisma.adminInvitation.create({ data: { email, tokenHash: randomBytes(32).toString('hex'), invitedById: owner.user.id, expiresAt: new Date(Date.now() - 1000),
        status: 'REVOKED', revokedAt: new Date(), grantManageAdmins: true } });
      expect((await api().post('/api/admin/invitations', { email }, owner.accessToken)).status).toBe(201);
      const token = sentInvitations.at(-1)!.token;
      expect((await api().post('/api/auth/admin/invitations/accept', { token, firstName: 'No', lastName: 'Grant', password: PASSWORD })).status).toBe(201);
      const created = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(await security(created.id)).toEqual({ isOwner: false, canManageAdmins: false });
    });
  });

  describe('DELN administrator deletion confirmation email', () => {
    const sink: Array<{ to: string; subject: string; htmlContent: string; textContent?: string }> = [];
    let send: ReturnType<typeof vi.spyOn>;
    beforeAll(() => {
      send = vi.spyOn(brevoProvider, 'sendTransactionalEmail').mockImplementation((async (options: { to: string; subject: string; htmlContent: string; textContent?: string }) => {
        sink.push(options);
        return { success: true, messageId: `sink-${randomUUID()}` };
      }) as never);
    });
    afterAll(() => { send.mockRestore(); });
    const noticesFor = (email: string) => sink.filter(item => item.to === email);
    const ledger = (userId: string) => prisma.emailDelivery.findMany({ where: { userId, type: 'SECURITY_ALERT' } });
    const settled = async (userId: string, status: string) => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if ((await ledger(userId)).some(row => row.status === status)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    };

    it('DELN-01: a regular administrator deletion sends exactly one confirmation to the original address, after anonymization', async () => {
      const admin = await enrolledAdmin({ manage: true });
      const original = admin.user.email;
      const deleted = await api().post('/api/admin/me/delete', { currentPassword: PASSWORD, confirmation: 'DELETE' }, admin.accessToken);
      expect(deleted.status).toBe(200);
      await settled(admin.user.id, 'SENT');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })).email).toBe(`deleted-admin-${admin.user.id}@deleted.invalid`);
      const mails = noticesFor(original);
      expect(mails).toHaveLength(1);
      expect(mails[0].subject).toBe('Your ElectroHub administrator account was deleted');
      for (const body of [mails[0].htmlContent, mails[0].textContent ?? '']) {
        expect(body).toMatch(/deleted/i);
        expect(body).toMatch(/audit records/i);
        expect(body).toMatch(/signed out/i);
        expect(body).toMatch(/support/i);
        expect(body).not.toContain(PASSWORD);
        expect(body).not.toContain(admin.secret);
        for (const recoveryCode of admin.recoveryCodes) expect(body).not.toContain(recoveryCode);
        expect(body).not.toContain(admin.accessToken);
      }
      expect(mails[0].htmlContent).toContain('width=device-width'); // mobile viewport
      const rows = await ledger(admin.user.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ recipient: original, status: 'SENT' });
      // Repeating the request cannot create a second notification (the account is gone).
      expect((await api().post('/api/admin/me/delete', { currentPassword: PASSWORD, confirmation: 'DELETE' }, admin.accessToken)).status).toBeGreaterThanOrEqual(400);
      expect(noticesFor(original)).toHaveLength(1);
      expect(await ledger(admin.user.id)).toHaveLength(1);
    });

    it('DELN-02: an Owner transfer-and-delete notifies the deleted Owner once and never the successor', async () => {
      const owner = await onlyOwner();
      const successor = await enrolledAdmin();
      const done = await transfer(owner.accessToken, successor.user.id);
      expect(done.status).toBe(200);
      await settled(owner.user.id, 'SENT');
      expect(noticesFor(owner.user.email)).toHaveLength(1);
      expect(noticesFor(successor.user.email).filter(item => item.subject.includes('account was deleted'))).toHaveLength(0);
      expect(await ledger(successor.user.id)).toHaveLength(0);
    });

    it('DELN-03: a rolled-back deletion queues and sends nothing', async () => {
      const owner = await onlyOwner();
      const successor = await enrolledAdmin();
      const before = sink.length;
      ownershipTestHooks.afterSuccessorPromoted = async () => { throw new Error('injected failure before commit'); };
      try {
        expect((await transfer(owner.accessToken, successor.user.id)).status).toBe(500);
      } finally { delete ownershipTestHooks.afterSuccessorPromoted; }
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(await ledger(owner.user.id)).toHaveLength(0);
      expect(sink.length).toBe(before);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.user.id } })).isActive).toBe(true);
    });

    it('DELN-04: a delivery failure keeps the deletion committed, is recorded, and the retry sends it exactly once', async () => {
      const admin = await enrolledAdmin({ manage: true });
      const original = admin.user.email;
      send.mockImplementationOnce((async () => ({ success: false, error: 'provider down' })) as never);
      const deleted = await api().post('/api/admin/me/delete', { currentPassword: PASSWORD, confirmation: 'DELETE' }, admin.accessToken);
      expect(deleted.status).toBe(200);
      expect(deleted.body.data).toEqual({ deleted: true }); // never reported as failed
      await settled(admin.user.id, 'FAILED');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })).isActive).toBe(false);
      const [failed] = await ledger(admin.user.id);
      expect(failed).toMatchObject({ status: 'FAILED', recipient: original });
      expect(failed.failureReason).not.toContain('provider down');
      expect(noticesFor(original)).toHaveLength(0);
      // Two overlapping retry sweeps: exactly one delivery.
      await Promise.all([retryDeletionNotices(), retryDeletionNotices()]);
      expect(noticesFor(original)).toHaveLength(1);
      expect((await ledger(admin.user.id))[0].status).toBe('SENT');
      await retryDeletionNotices();
      expect(noticesFor(original)).toHaveLength(1);
    });
  });

  it('REV-01: an Owner revokes another Owner; the account stays an active ADMIN with its credentials, sessions end, a fresh MFA sign-in has no Owner access', async () => {
    const a = await onlyOwner();
    const b = await enrolledAdmin({ owner: true });
    const before = await capabilities(b.user.id);
    const factorsBefore = await prisma.adminMfaFactor.count({ where: { userId: b.user.id, verifiedAt: { not: null }, disabledAt: null } });
    const codesBefore = await prisma.adminRecoveryCode.count({ where: { userId: b.user.id, consumedAt: null } });
    // B exercises Owner-only access before the change.
    expect((await api().get(`/api/admin/administrators/${a.user.id}/mfa-activation`, b.accessToken)).status).toBe(200);

    const disconnect = vi.spyOn(DeliveryPublisher, 'disconnectUser');
    try {
      const done = await revoke(a.accessToken, b.user.id);
      expect(done.status).toBe(200);
      expect(done.body.data).toEqual({ id: b.user.id, isOwner: false, canManageAdmins: false, isActive: true, signInRequired: true });
      expect(disconnect).toHaveBeenCalledWith(b.user.id, 'LOGOUT');
    } finally { disconnect.mockRestore(); }

    // Identity preserved; least privilege applied.
    const after = await capabilities(b.user.id);
    expect(after).toEqual({ ...before, isOwner: false, canManageAdmins: false });
    expect(after.isActive).toBe(true);
    expect(await prisma.adminMfaFactor.count({ where: { userId: b.user.id, verifiedAt: { not: null }, disabledAt: null } })).toBe(factorsBefore);
    expect(await prisma.adminRecoveryCode.count({ where: { userId: b.user.id, consumedAt: null } })).toBe(codesBefore);
    const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { actorId: a.user.id, action: 'ADMIN_OWNER_REVOKED', outcome: 'SUCCESS', resourceId: b.user.id } });
    expect(audit.details).toEqual({ previous: { isOwner: true, canManageAdmins: true }, resulting: { isOwner: false, canManageAdmins: false } });
    expect(sentOwnerRevocations).toContain(b.user.email);

    // Old access and refresh tokens are dead; a fresh password + MFA sign-in works and carries no Owner capability.
    expect((await api().get('/api/admin/me/profile', b.accessToken)).status).toBe(401);
    expect((await api().post('/api/auth/admin/refresh', undefined, undefined, b.cookie)).status).toBe(401);
    const fresh = await signIn(b.user.email, b.secret);
    expect(fresh.status).toBe(200);
    expect((await api().get('/api/admin/me/profile', fresh.accessToken)).body.data).toMatchObject({ isOwner: false, canManageAdmins: false });
    expect((await api().get(`/api/admin/administrators/${a.user.id}/mfa-activation`, fresh.accessToken)).status).toBe(403); // Owner-only
    expect((await revoke(fresh.accessToken, a.user.id)).status).toBe(403);
    expect((await api().get('/api/admin/catalog/products', fresh.accessToken)).status).toBe(200); // ordinary ADMIN access remains

    // Repeating the revocation changes nothing; promotion still works afterwards; management can be re-granted explicitly.
    expect((await revoke(a.accessToken, b.user.id)).body.error.code).toBe('TARGET_NOT_OWNER');
    expect(await prisma.adminAuditLog.count({ where: { action: 'ADMIN_OWNER_REVOKED', outcome: 'SUCCESS', resourceId: b.user.id } })).toBe(1);
    expect((await api().patch(`/api/admin/administrators/${b.user.id}/access`, { canManageAdmins: true }, a.accessToken)).body.data)
      .toMatchObject({ isOwner: false, canManageAdmins: true });
    expect((await api().post(`/api/admin/administrators/${b.user.id}/grant-owner`, {}, a.accessToken)).status).toBe(200);
    expect(await capabilities(b.user.id)).toMatchObject({ isOwner: true, canManageAdmins: true, isActive: true });
  });

  it('REV-02: only an active Owner with a recent step-up and the typed confirmation can revoke; self, unknown and inactive targets are refused', async () => {
    const a = await onlyOwner();
    const b = await enrolledAdmin({ owner: true });
    const manager = await enrolledAdmin({ manage: true });
    const plain = await enrolledAdmin();
    const customer = await createUser('CUSTOMER');
    const customerToken = (await api().post('/api/auth/login', { email: customer.email, password: PASSWORD })).body.accessToken as string;

    for (const token of [manager.accessToken, plain.accessToken, customerToken]) expect((await revoke(token, b.user.id)).status).toBe(403);
    expect((await revoke(a.accessToken, b.user.id, {})).status).toBe(400);
    expect((await revoke(a.accessToken, b.user.id, { confirmation: 'revoke' })).status).toBe(400);
    expect((await revoke(a.accessToken, b.user.id, { confirmation: 'REVOKE', isOwner: false })).status).toBe(400);
    expect((await revoke(a.accessToken, a.user.id)).body.error.code).toBe('SELF_OWNER_REVOCATION_FORBIDDEN');
    expect((await revoke(a.accessToken, randomUUID())).body.error.code).toBe('TARGET_NOT_FOUND');
    expect((await revoke(a.accessToken, customer.id)).body.error.code).toBe('TARGET_NOT_FOUND');
    expect((await revoke(a.accessToken, plain.user.id)).body.error.code).toBe('TARGET_NOT_OWNER');
    const inactiveOwner = await enrolledAdmin({ owner: true });
    await prisma.user.update({ where: { id: inactiveOwner.user.id }, data: { isActive: false } });
    expect((await revoke(a.accessToken, inactiveOwner.user.id)).body.error.code).toBe('TARGET_INACTIVE');

    await prisma.adminSession.updateMany({ where: { userId: a.user.id }, data: { mfaVerifiedAt: new Date(Date.now() - 20 * 60_000), stepUpAt: null } });
    expect((await revoke(a.accessToken, b.user.id)).body.error.code).toBe('STEP_UP_REQUIRED');
    expect(await capabilities(b.user.id)).toMatchObject({ isOwner: true, canManageAdmins: true, isActive: true });
    expect((await api().get('/api/admin/me/profile', b.accessToken)).status).toBe(200); // nothing happened to B
    expect(await prisma.adminAuditLog.count({ where: { actorId: a.user.id, action: 'ADMIN_OWNER_REVOKED', outcome: 'DENIED' } })).toBeGreaterThanOrEqual(5);
    expect(await prisma.adminAuditLog.count({ where: { action: 'ADMIN_OWNER_REVOKED', outcome: 'SUCCESS', resourceId: b.user.id } })).toBe(0);
  });

  it('REV-03: revocation that would leave no eligible Owner is refused inside the transaction', async () => {
    const a = await onlyOwner();
    const b = await enrolledAdmin({ owner: true });
    // A keeps a live session but no longer has a usable factor (MFA credentials revoked): B is the only ELIGIBLE Owner.
    await prisma.adminMfaFactor.updateMany({ where: { userId: a.user.id }, data: { disabledAt: new Date() } });
    const refused = await revoke(a.accessToken, b.user.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: 'LAST_OWNER',
      message: 'This is the last eligible Owner. Assign another active, MFA-enrolled administrator as Owner before revoking these privileges.' });
    expect(await capabilities(b.user.id)).toMatchObject({ isOwner: true, canManageAdmins: true, isActive: true });
    expect((await api().get('/api/admin/me/profile', b.accessToken)).status).toBe(200); // sessions untouched by the rolled-back attempt
    expect(await prisma.adminAuditLog.count({ where: { action: 'ADMIN_OWNER_REVOKED', outcome: 'SUCCESS', resourceId: b.user.id } })).toBe(0);
    await prisma.adminMfaFactor.updateMany({ where: { userId: a.user.id }, data: { disabledAt: null } });
  });

  it('REV-04: a failure after the capability update rolls everything back', async () => {
    const a = await onlyOwner();
    const b = await enrolledAdmin({ owner: true });
    ownershipTestHooks.afterOwnerRevoked = async () => { throw new Error('injected failure after owner revocation'); };
    try {
      expect((await revoke(a.accessToken, b.user.id)).status).toBe(500);
    } finally { delete ownershipTestHooks.afterOwnerRevoked; }
    expect(await capabilities(b.user.id)).toMatchObject({ isOwner: true, canManageAdmins: true, isActive: true });
    expect((await api().get('/api/admin/me/profile', b.accessToken)).status).toBe(200);
    expect(await prisma.refreshToken.count({ where: { userId: b.user.id, isRevoked: false } })).toBeGreaterThan(0);
    expect(await prisma.adminAuditLog.count({ where: { action: 'ADMIN_OWNER_REVOKED', outcome: 'SUCCESS', resourceId: b.user.id } })).toBe(0);
    expect((await revoke(a.accessToken, b.user.id)).status).toBe(200); // the retry succeeds
  });

  it('REV-05: concurrent revocations, deletions and transfers serialize and always leave an eligible Owner', async () => {
    // Two Owners revoking each other at once: exactly one wins; the loser has lost Owner (or its session) and cannot complete.
    const a = await onlyOwner();
    const b = await enrolledAdmin({ owner: true });
    const mutual = await Promise.all([revoke(a.accessToken, b.user.id), revoke(b.accessToken, a.user.id)]);
    expect(mutual.filter(response => response.status === 200)).toHaveLength(1);
    expect(mutual.find(response => response.status !== 200)!.status).toBeOneOf([401, 403]);
    expect(await countEligibleOwners(prisma)).toBe(1);

    // Double-clicked revocation: one success, one TARGET_NOT_OWNER, one audit row.
    const c = await onlyOwner();
    const d = await enrolledAdmin({ owner: true });
    const twice = await Promise.all([revoke(c.accessToken, d.user.id), revoke(c.accessToken, d.user.id)]);
    expect(twice.map(response => response.status).sort()).toEqual([200, 409]);
    expect(twice.find(response => response.status === 409)!.body.error.code).toBe('TARGET_NOT_OWNER');
    expect(await prisma.adminAuditLog.count({ where: { action: 'ADMIN_OWNER_REVOKED', outcome: 'SUCCESS', resourceId: d.user.id } })).toBe(1);

    // Revocation racing the actor's own deletion: never both; an eligible Owner remains.
    const e = await onlyOwner();
    const f = await enrolledAdmin({ owner: true });
    const [revoked, deleted] = await Promise.all([revoke(e.accessToken, f.user.id),
      api().post('/api/admin/me/delete', { currentPassword: PASSWORD, confirmation: 'DELETE' }, e.accessToken)]);
    expect(revoked.status === 200 && deleted.status === 200).toBe(false);
    expect(await countEligibleOwners(prisma)).toBeGreaterThanOrEqual(1);

    // Revocation of B racing B's transfer-and-delete to C: either order is consistent and leaves an eligible Owner.
    const g = await onlyOwner();
    const h = await enrolledAdmin({ owner: true });
    const heir = await enrolledAdmin();
    const [revokedH, moved] = await Promise.all([revoke(g.accessToken, h.user.id), transfer(h.accessToken, heir.user.id)]);
    expect(revokedH.status === 200 && moved.status === 200).toBe(false);
    if (moved.status === 200) {
      expect(await capabilities(heir.user.id)).toMatchObject({ isOwner: true });
      expect(revokedH.body.error.code).toBeOneOf(['TARGET_INACTIVE', 'TARGET_NOT_OWNER']);
    } else {
      expect(await capabilities(h.user.id)).toMatchObject({ isOwner: false, isActive: true });
      expect(await capabilities(heir.user.id)).toMatchObject({ isOwner: false });
    }
    expect(await countEligibleOwners(prisma)).toBeGreaterThanOrEqual(1);
  });

  describe('REC administrator forgot-password recovery', () => {
    const NEW_PASSWORD = 'Recovered-Unique-7-Pass';
    const otps = new Map<string, string>();
    beforeAll(() => {
      vi.spyOn(emailService, 'sendPasswordResetOtp').mockImplementation(async (to: string, otp: string) => { otps.set(to, otp); return true; });
      vi.spyOn(emailService, 'sendPasswordChangedNotification').mockResolvedValue(true);
    });
    const recoveryApi = '/api/auth/admin/password-recovery';
    /** Email OTP stage: returns the restricted recovery transaction. */
    async function verifiedEmail(email: string) {
      otps.delete(email);
      const requested = await api().post(`${recoveryApi}/request`, { email });
      expect(requested.status).toBe(200);
      const verified = await api().post(`${recoveryApi}/verify-email`, { email, code: otps.get(email) });
      return { requested, verified };
    }

    it('REC-01: the request is enumeration-safe and only a live administrator receives a code', async () => {
      const admin = await createUser('ADMIN');
      const customer = await createUser('CUSTOMER');
      otps.clear();
      const responses = await Promise.all([admin.email, customer.email, 'nobody@qa.invalid'].map(email => api().post(`${recoveryApi}/request`, { email })));
      expect(new Set(responses.map(response => JSON.stringify(response.body))).size).toBe(1);
      expect(responses.map(response => response.status)).toEqual([200, 200, 200]);
      expect([...otps.keys()]).toEqual([admin.email]);
    });

    it('REC-02: the generic customer reset path is no email-only bypass for an administrator', async () => {
      const enrolled = await enrolledAdmin();
      otps.clear();
      await api().post('/api/auth/forgot-password', { email: enrolled.user.email });
      expect(otps.has(enrolled.user.email)).toBe(false);
      // Even a genuine admin recovery code cannot be traded for a reset token on the legacy endpoint.
      await api().post(`${recoveryApi}/request`, { email: enrolled.user.email });
      const legacy = await api().post('/api/auth/verify-reset-otp', { email: enrolled.user.email, code: otps.get(enrolled.user.email) });
      expect(legacy.status).toBe(400);
      expect(legacy.body.resetToken).toBeUndefined();
      expect(await prisma.passwordResetToken.count({ where: { userId: enrolled.user.id } })).toBe(0);
    });

    it('REC-03: a verified email alone yields no reset authorization, no session and no cookie', async () => {
      const enrolled = await enrolledAdmin();
      const { verified } = await verifiedEmail(enrolled.user.email);
      expect(verified.status).toBe(200);
      expect(verified.body.factors).toEqual({ totp: true, passkey: false, recoveryCode: true });
      expect(verified.body.accessToken).toBeUndefined();
      expect(verified.body.resetToken).toBeUndefined();
      expect(refreshCookie(verified)).toBeUndefined();
      expect(await prisma.passwordResetToken.count({ where: { userId: enrolled.user.id } })).toBe(0);
      // The recovery transaction cannot be used to reset, to sign in, or for the login endpoints (and vice versa).
      expect((await api().post(`${recoveryApi}/complete`, { resetToken: verified.body.recoveryToken, newPassword: NEW_PASSWORD })).status).toBe(400);
      expect((await api().post('/api/auth/admin/mfa/totp/verify', { mfaToken: verified.body.recoveryToken, code: code(enrolled.secret, 1) })).status).toBe(401);
      const login = await api().post('/api/auth/login', { email: enrolled.user.email, password: PASSWORD });
      expect((await api().post(`${recoveryApi}/totp`, { recoveryToken: login.body.mfaToken, code: code(enrolled.secret, 1) })).status).toBe(401);
    });

    it('REC-04: a wrong or replayed email code and a customer address are refused', async () => {
      const admin = await createUser('ADMIN');
      const customer = await createUser('CUSTOMER');
      otps.clear();
      await api().post(`${recoveryApi}/request`, { email: admin.email });
      const wrong = await api().post(`${recoveryApi}/verify-email`, { email: admin.email, code: '000000' === otps.get(admin.email) ? '111111' : '000000' });
      expect(wrong.status).toBe(400);
      const good = await api().post(`${recoveryApi}/verify-email`, { email: admin.email, code: otps.get(admin.email) });
      expect(good.status).toBe(200);
      expect((await api().post(`${recoveryApi}/verify-email`, { email: admin.email, code: otps.get(admin.email) })).status).toBe(400);
      await api().post('/api/auth/forgot-password', { email: customer.email });
      expect((await api().post(`${recoveryApi}/verify-email`, { email: customer.email, code: otps.get(customer.email) ?? '123456' })).status).toBe(400);
    });

    it('REC-05: TOTP recovery resets the password atomically; old credentials die, MFA stays, replay and double-submit fail', async () => {
      const enrolled = await enrolledAdmin();
      const secondLogin = await api().post('/api/auth/login', { email: enrolled.user.email, password: PASSWORD }); // a second live session
      const secondVerified = await api().post('/api/auth/admin/mfa/recovery/verify', { mfaToken: secondLogin.body.mfaToken, code: enrolled.recoveryCodes[1] });
      expect(secondVerified.status).toBe(200);
      const second = { accessToken: secondVerified.body.accessToken as string, cookie: refreshCookie(secondVerified) };
      const before = await prisma.adminAccountSecurity.findUniqueOrThrow({ where: { userId: enrolled.user.id } });
      const { verified } = await verifiedEmail(enrolled.user.email);
      const token = verified.body.recoveryToken as string;
      const wrong = await api().post(`${recoveryApi}/totp`, { recoveryToken: token, code: '000000' });
      expect(wrong.status).toBe(401);
      expect(wrong.body.error.attemptsRemaining).toBe(4);
      const proven = await api().post(`${recoveryApi}/totp`, { recoveryToken: token, code: code(enrolled.secret, 1) });
      expect(proven.status).toBe(200);
      expect(proven.body.accessToken).toBeUndefined();
      expect(refreshCookie(proven)).toBeUndefined();
      const resetToken = proven.body.resetToken as string;
      // The recovery transaction is single-use.
      expect((await api().post(`${recoveryApi}/totp`, { recoveryToken: token, code: code(enrolled.secret, 1) })).status).toBe(401);
      // The same time step cannot prove a second recovery either (TOTP replay guard).
      const again = await verifiedEmail(enrolled.user.email);
      expect((await api().post(`${recoveryApi}/totp`, { recoveryToken: again.verified.body.recoveryToken, code: code(enrolled.secret, 1) })).status).toBe(401);
      // Policy is enforced server-side, then two simultaneous submissions: exactly one wins.
      expect((await api().post(`${recoveryApi}/complete`, { resetToken, newPassword: 'weakpassword' })).status).toBe(400);
      const disconnect = vi.spyOn(DeliveryPublisher, 'disconnectUser');
      const both = await Promise.all([1, 2].map(() => api().post(`${recoveryApi}/complete`, { resetToken, newPassword: NEW_PASSWORD })));
      expect(both.map(response => response.status).sort()).toEqual([200, 400]);
      expect(disconnect).toHaveBeenCalledWith(enrolled.user.id, 'LOGOUT');
      // Old password, both old sessions and the replayed reset authorization are dead.
      expect((await api().post('/api/auth/login', { email: enrolled.user.email, password: PASSWORD })).status).toBe(401);
      expect((await api().get('/api/admin/me/profile', enrolled.accessToken)).status).toBe(401);
      expect((await api().get('/api/admin/me/profile', second.accessToken)).status).toBe(401);
      expect((await api().post('/api/auth/admin/refresh', undefined, undefined, second.cookie!)).status).toBe(401);
      expect((await api().post(`${recoveryApi}/complete`, { resetToken, newPassword: 'Another-Unique-8-Pass' })).status).toBe(400);
      // MFA is untouched: same enrollment, factor and codes; no enrollment window was opened.
      const after = await prisma.adminAccountSecurity.findUniqueOrThrow({ where: { userId: enrolled.user.id } });
      expect(after.mfaEnrolledAt).toEqual(before.mfaEnrolledAt);
      expect(after.enrollmentAllowedUntil).toEqual(before.enrollmentAllowedUntil);
      expect(await adminMfaService.factorSummary(enrolled.user.id)).toMatchObject({ totp: 1, recoveryCodes: 9 });
      // The new password alone yields no session; password + the existing factor does.
      const login = await api().post('/api/auth/login', { email: enrolled.user.email, password: NEW_PASSWORD });
      expect(login.body).toMatchObject({ requiresMfa: true });
      expect(login.body.accessToken).toBeUndefined();
      const recovery = await api().post('/api/auth/admin/mfa/recovery/verify', { mfaToken: login.body.mfaToken, code: enrolled.recoveryCodes[2] });
      expect(recovery.status).toBe(200);
      expect((await api().get('/api/admin/me/profile', recovery.body.accessToken)).status).toBe(200);
    });

    it('REC-06: a recovery code works exactly once for password recovery', async () => {
      const enrolled = await enrolledAdmin();
      const first = await verifiedEmail(enrolled.user.email);
      const used = await api().post(`${recoveryApi}/recovery-code`, { recoveryToken: first.verified.body.recoveryToken, code: enrolled.recoveryCodes[0] });
      expect(used.status).toBe(200);
      expect(used.body.resetToken).toBeTruthy();
      const second = await verifiedEmail(enrolled.user.email);
      const replay = await api().post(`${recoveryApi}/recovery-code`, { recoveryToken: second.verified.body.recoveryToken, code: enrolled.recoveryCodes[0] });
      expect(replay.status).toBe(401);
      expect(await adminMfaService.factorSummary(enrolled.user.id)).toMatchObject({ recoveryCodes: 9 });
    });

    it('REC-07: attempts are limited, and an account without a registered factor cannot recover by email alone', async () => {
      const enrolled = await enrolledAdmin();
      const { verified } = await verifiedEmail(enrolled.user.email);
      const statuses: number[] = [];
      for (let index = 0; index < 5; index += 1) statuses.push((await api().post(`${recoveryApi}/totp`, { recoveryToken: verified.body.recoveryToken, code: '000000' })).status);
      expect(statuses).toEqual([401, 401, 401, 401, 429]);
      expect((await api().post(`${recoveryApi}/totp`, { recoveryToken: verified.body.recoveryToken, code: code(enrolled.secret, 0) })).status).toBe(401);

      const legacy = await createUser('ADMIN', { enrollWindow: false }); // factor-less legacy administrator
      const email = await verifiedEmail(legacy.email);
      expect(email.verified.body.factors).toEqual({ totp: false, passkey: false, recoveryCode: false });
      for (const route of ['totp', 'recovery-code']) {
        expect((await api().post(`${recoveryApi}/${route}`, { recoveryToken: email.verified.body.recoveryToken, code: route === 'totp' ? '123456' : 'ABCDEFGHIJKL' })).status).toBe(401);
      }
      expect((await api().post(`${recoveryApi}/passkey/options`, { recoveryToken: email.verified.body.recoveryToken })).status).toBe(422);
      expect(await prisma.passwordResetToken.count({ where: { userId: legacy.id } })).toBe(0);
      expect(await prisma.adminAccountSecurity.findUniqueOrThrow({ where: { userId: legacy.id } })).toMatchObject({ enrollmentAllowedUntil: null, mfaEnrolledAt: null });
    });

    it('REC-09: the current password cannot be reused; the reset authorization survives the rejection; a different password works (admin and customer)', async () => {
      const enrolled = await enrolledAdmin();
      const { verified } = await verifiedEmail(enrolled.user.email);
      const proven = await api().post(`${recoveryApi}/totp`, { recoveryToken: verified.body.recoveryToken, code: code(enrolled.secret, 1) });
      const resetToken = proven.body.resetToken as string;
      const beforeHash = (await prisma.user.findUniqueOrThrow({ where: { id: enrolled.user.id } })).passwordHash;
      const reused = await api().post(`${recoveryApi}/complete`, { resetToken, newPassword: PASSWORD });
      expect(reused.status).toBe(422);
      expect(reused.body.error).toMatchObject({ code: 'PASSWORD_REUSED', message: 'Your new password must be different from your current password.' });
      // Nothing moved: password, sessions, factors and the unconsumed authorization.
      expect((await prisma.user.findUniqueOrThrow({ where: { id: enrolled.user.id } })).passwordHash).toBe(beforeHash);
      expect((await prisma.passwordResetToken.findUniqueOrThrow({ where: { userId: enrolled.user.id } })).consumedAt).toBeNull();
      expect((await api().get('/api/admin/me/profile', enrolled.accessToken)).status).toBe(200);
      expect(await adminMfaService.factorSummary(enrolled.user.id)).toMatchObject({ totp: 1 });
      expect((await api().post(`${recoveryApi}/complete`, { resetToken, newPassword: NEW_PASSWORD })).status).toBe(200);
      // A fresh password plus MFA is now required.
      expect((await api().get('/api/admin/me/profile', enrolled.accessToken)).status).toBe(401);
      expect((await api().post('/api/auth/login', { email: enrolled.user.email, password: NEW_PASSWORD })).body).toMatchObject({ requiresMfa: true });

      // Customer: generic reset path and authenticated change both refuse the current password.
      const customer = await createUser('CUSTOMER');
      otps.clear();
      await api().post('/api/auth/forgot-password', { email: customer.email });
      const otp = await api().post('/api/auth/verify-reset-otp', { email: customer.email, code: otps.get(customer.email) });
      const same = await api().post('/api/auth/reset-password', { resetToken: otp.body.resetToken, newPassword: PASSWORD });
      expect(same.status).toBe(422);
      expect(same.body.error.code).toBe('PASSWORD_REUSED');
      expect((await api().post('/api/auth/reset-password', { resetToken: otp.body.resetToken, newPassword: NEW_PASSWORD })).status).toBe(200);
      const login = await api().post('/api/auth/login', { email: customer.email, password: NEW_PASSWORD });
      const sameChange = await api().post('/api/auth/change-password', { currentPassword: NEW_PASSWORD, newPassword: NEW_PASSWORD }, login.body.accessToken);
      expect(sameChange.status).toBe(422);
      expect(sameChange.body.error.code).toBe('PASSWORD_REUSED');
      expect((await api().post('/api/auth/change-password', { currentPassword: NEW_PASSWORD, newPassword: 'Different-Valid-4-Pass' }, login.body.accessToken)).status).toBe(200);
      // Invalid reset token stays rejected.
      expect((await api().post('/api/auth/reset-password', { resetToken: 'x'.repeat(40), newPassword: 'Another-Valid-5-Pass' })).status).toBe(400);
    });

    it('REC-10: a password changed between the check and the write is never bypassed (stale-hash race)', async () => {
      const customer = await createUser('CUSTOMER');
      const repo = new AuthRepository();
      const stale = (await prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).passwordHash as string;
      const raced = await hashPassword('Raced-Unique-6-Pass');
      await prisma.user.update({ where: { id: customer.id }, data: { passwordHash: raced } });
      await expect(repo.updatePasswordAndRevokeSessions(customer.id, await hashPassword('Whatever-Unique-3-Pass'), SecurityEventType.PASSWORD_CHANGED, stale)).rejects.toBeInstanceOf(StalePasswordHashError);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).passwordHash).toBe(raced);
      // Service level: two simultaneous changes to the same new password; the loser is told it is reused or has a wrong current password, never silently applied twice.
      const login = await api().post('/api/auth/login', { email: customer.email, password: 'Raced-Unique-6-Pass' });
      const results = await Promise.all([1, 2].map(() => api().post('/api/auth/change-password', { currentPassword: 'Raced-Unique-6-Pass', newPassword: 'Winner-Unique-2-Pass' }, login.body.accessToken)));
      expect(results.filter(response => response.status === 200)).toHaveLength(1);
    });

    it('REC-11: one recovery MFA earns exactly one MFA-assured session; recovery and login tokens stay separate; normal login still needs MFA (TOTP path)', async () => {
      const enrolled = await enrolledAdmin();
      const outstanding = await api().post('/api/auth/login', { email: enrolled.user.email, password: PASSWORD }); // login challenge opened before the reset
      const { verified } = await verifiedEmail(enrolled.user.email);
      const recoveryToken = verified.body.recoveryToken as string;
      // A login challenge is no recovery transaction and a recovery transaction is no login challenge.
      expect((await api().post(`${recoveryApi}/totp`, { recoveryToken: outstanding.body.mfaToken, code: code(enrolled.secret, 1) })).status).toBe(401);
      expect((await api().post('/api/auth/admin/mfa/totp/verify', { mfaToken: recoveryToken, code: code(enrolled.secret, 1) })).status).toBe(401);
      expect((await api().post('/api/auth/admin/mfa/recovery/verify', { mfaToken: recoveryToken, code: enrolled.recoveryCodes[0] })).status).toBe(401);
      expect((await api().post('/api/auth/admin/mfa/webauthn/options', { mfaToken: recoveryToken })).status).toBeGreaterThanOrEqual(400);
      // Pinned: recomputing "next step" later in this slow test can land on a newer, still-unused step and pass a replay check by accident.
      const recoveryTotp = code(enrolled.secret, 1);
      const proven = await api().post(`${recoveryApi}/totp`, { recoveryToken, code: recoveryTotp });
      expect(proven.status).toBe(200);
      const reset = await api().post(`${recoveryApi}/complete`, { resetToken: proven.body.resetToken, newPassword: NEW_PASSWORD });
      expect(reset.status).toBe(200);
      // The completed recovery establishes one session on the verified method; every pre-reset session and login challenge is dead.
      expect(reset.body).toMatchObject({ signInRequired: false });
      expect(refreshCookie(reset)).toBeDefined();
      const recovered = await prisma.adminSession.findMany({ where: { userId: enrolled.user.id, revokedAt: null } });
      expect(recovered).toHaveLength(1);
      expect(recovered[0]).toMatchObject({ mfaMethod: 'TOTP' });
      expect(recovered[0].mfaVerifiedAt).not.toBeNull();
      expect((await api().get('/api/admin/dashboard/overview', enrolled.accessToken)).status).toBe(401);
      expect((await api().get('/api/admin/dashboard/overview', reset.body.accessToken)).status).toBe(200);
      expect((await api().post('/api/auth/admin/refresh', undefined, undefined, refreshCookie(reset)!)).status).toBe(200);
      // The reset authorization is spent: replaying it yields no second session.
      expect((await api().post(`${recoveryApi}/complete`, { resetToken: proven.body.resetToken, newPassword: 'Another-Unique-8-Pass' })).status).toBe(400);
      expect((await api().post('/api/auth/admin/mfa/totp/verify', { mfaToken: outstanding.body.mfaToken, code: code(enrolled.secret, 2) })).status).toBe(401);
      // The consumed recovery transaction cannot be replayed as anything.
      expect((await api().post('/api/auth/admin/mfa/totp/verify', { mfaToken: recoveryToken, code: code(enrolled.secret, 2) })).status).toBe(401);
      // Old password is refused; the new password alone opens only a restricted login challenge.
      expect((await api().post('/api/auth/login', { email: enrolled.user.email, password: PASSWORD })).status).toBe(401);
      const login = await api().post('/api/auth/login', { email: enrolled.user.email, password: NEW_PASSWORD });
      expect(login.body).toMatchObject({ requiresMfa: true });
      expect(login.body.accessToken).toBeUndefined();
      expect(refreshCookie(login)).toBeUndefined();
      // Skipping the second verification: the challenge is not a bearer token for any administrator API.
      for (const path of ['/api/admin/dashboard/overview', '/api/admin/me/profile', '/api/admin/invitations']) {
        expect((await api().get(path, login.body.mfaToken)).status, path).toBe(401);
      }
      // The recovery proof's TOTP step cannot be replayed at login, and a wrong code fails.
      expect((await api().post('/api/auth/admin/mfa/totp/verify', { mfaToken: login.body.mfaToken, code: recoveryTotp })).status).toBe(401);
      expect((await api().post('/api/auth/admin/mfa/totp/verify', { mfaToken: login.body.mfaToken, code: '000000' })).status).toBe(401);
      // TOTP steps only move forward (recovery used the next one), so login MFA uses a different registered factor: an unused recovery code.
      const ok = await api().post('/api/auth/admin/mfa/recovery/verify', { mfaToken: login.body.mfaToken, code: enrolled.recoveryCodes[0] });
      expect(ok.status).toBe(200);
      expect(refreshCookie(ok)).toBeDefined();
      expect((await api().get('/api/admin/dashboard/overview', ok.body.accessToken)).status).toBe(200);
      expect(await prisma.adminSession.count({ where: { userId: enrolled.user.id, revokedAt: null, mfaMethod: 'RECOVERY_CODE' } })).toBe(1);
      // Replaying the finished login challenge grants nothing.
      expect((await api().post('/api/auth/admin/mfa/recovery/verify', { mfaToken: login.body.mfaToken, code: enrolled.recoveryCodes[1] })).status).toBe(401);
    });

    it('REC-12: a recovery code spent on recovery cannot open the next login; another code does; expiry and cancellation grant nothing', async () => {
      const enrolled = await enrolledAdmin();
      const first = await verifiedEmail(enrolled.user.email);
      const proven = await api().post(`${recoveryApi}/recovery-code`, { recoveryToken: first.verified.body.recoveryToken, code: enrolled.recoveryCodes[0] });
      expect(proven.status).toBe(200);
      const done = await api().post(`${recoveryApi}/complete`, { resetToken: proven.body.resetToken, newPassword: NEW_PASSWORD });
      expect(done.status).toBe(200);
      expect(done.body.signInRequired).toBe(false); // single-use code spent once; the recovery session is its result
      expect(await prisma.adminSession.count({ where: { userId: enrolled.user.id, revokedAt: null, mfaMethod: 'RECOVERY_CODE' } })).toBe(1);
      const login = await api().post('/api/auth/login', { email: enrolled.user.email, password: NEW_PASSWORD });
      expect((await api().post('/api/auth/admin/mfa/recovery/verify', { mfaToken: login.body.mfaToken, code: enrolled.recoveryCodes[0] })).status).toBe(401);
      const ok = await api().post('/api/auth/admin/mfa/recovery/verify', { mfaToken: login.body.mfaToken, code: enrolled.recoveryCodes[1] });
      expect(ok.status).toBe(200);
      expect((await api().get('/api/admin/dashboard/overview', ok.body.accessToken)).status).toBe(200);

      // Expiry: an expired login challenge and an expired recovery transaction both refuse a correct proof.
      const expiredLogin = await api().post('/api/auth/login', { email: enrolled.user.email, password: NEW_PASSWORD });
      await prisma.adminAuthChallenge.updateMany({ where: { userId: enrolled.user.id, purpose: 'LOGIN', consumedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await api().post('/api/auth/admin/mfa/recovery/verify', { mfaToken: expiredLogin.body.mfaToken, code: enrolled.recoveryCodes[2] })).status).toBe(401);
      const second = await verifiedEmail(enrolled.user.email);
      await prisma.adminAuthChallenge.updateMany({ where: { userId: enrolled.user.id, purpose: 'PASSWORD_RECOVERY', consumedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await api().post(`${recoveryApi}/recovery-code`, { recoveryToken: second.verified.body.recoveryToken, code: enrolled.recoveryCodes[2] })).status).toBe(401);

      // Cancellation: an abandoned recovery is superseded by a new one; the abandoned token proves nothing and no reset authorization exists.
      const abandoned = await verifiedEmail(enrolled.user.email);
      const replacement = await verifiedEmail(enrolled.user.email);
      expect(replacement.verified.body.recoveryToken).not.toBe(abandoned.verified.body.recoveryToken);
      expect((await api().post(`${recoveryApi}/recovery-code`, { recoveryToken: abandoned.verified.body.recoveryToken, code: enrolled.recoveryCodes[2] })).status).toBe(401);
      expect(await prisma.passwordResetToken.count({ where: { userId: enrolled.user.id, consumedAt: null } })).toBe(0);
    });

    /** Email code + TOTP, ending at the password step: returns the reset authorization. */
    async function provenReset(enrolled: Awaited<ReturnType<typeof enrolledAdmin>>, offset = 1) {
      const { verified } = await verifiedEmail(enrolled.user.email);
      const proven = await api().post(`${recoveryApi}/totp`, { recoveryToken: verified.body.recoveryToken, code: code(enrolled.secret, offset) });
      expect(proven.status).toBe(200);
      return proven.body.resetToken as string;
    }

    it('REC-13: failed session establishment falls back to normal password + MFA sign-in, never a bypass', async () => {
      const enrolled = await enrolledAdmin();
      const resetToken = await provenReset(enrolled);
      const failing = vi.spyOn(AuthService.prototype, 'createAssuredAdminSession').mockRejectedValueOnce(new Error('simulated session store failure'));
      const done = await api().post(`${recoveryApi}/complete`, { resetToken, newPassword: NEW_PASSWORD });
      failing.mockRestore();
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({ signInRequired: true });
      expect(done.body.accessToken).toBeUndefined();
      expect(refreshCookie(done)).toBeUndefined();
      expect(await prisma.adminSession.count({ where: { userId: enrolled.user.id, revokedAt: null } })).toBe(0);
      // The password did change, and sign-in is the normal restricted MFA login.
      expect((await api().post('/api/auth/login', { email: enrolled.user.email, password: PASSWORD })).status).toBe(401);
      expect((await api().post('/api/auth/login', { email: enrolled.user.email, password: NEW_PASSWORD })).body).toMatchObject({ requiresMfa: true });
    });

    it('REC-14: deactivation, a competing password change or a vanished factor at issuance yields no session', async () => {
      const original = AuthService.prototype.createAssuredAdminSession;
      const scenarios: Array<[string, (userId: string) => Promise<void>]> = [
        ['deactivated', async userId => { await prisma.user.update({ where: { id: userId }, data: { isActive: false } }); }],
        ['password changed again', async userId => { await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword('Competing-Unique-5-Pass') } }); }],
        ['every factor revoked', async userId => {
          await prisma.adminMfaFactor.updateMany({ where: { userId }, data: { disabledAt: new Date() } });
          await prisma.adminRecoveryCode.updateMany({ where: { userId }, data: { revokedAt: new Date() } });
        }],
      ];
      for (const [label, interfere] of scenarios) {
        const enrolled = await enrolledAdmin();
        const resetToken = await provenReset(enrolled);
        const spy = vi.spyOn(AuthService.prototype, 'createAssuredAdminSession').mockImplementationOnce(async function (this: AuthService, ...args) {
          await interfere(enrolled.user.id); // lands between the reset commit and session issuance
          return original.apply(this, args);
        });
        const done = await api().post(`${recoveryApi}/complete`, { resetToken, newPassword: NEW_PASSWORD });
        spy.mockRestore();
        expect(done.status, label).toBe(200);
        expect(done.body.accessToken, label).toBeUndefined();
        expect(refreshCookie(done), label).toBeUndefined();
        expect(await prisma.adminSession.count({ where: { userId: enrolled.user.id, revokedAt: null } }), label).toBe(0);
      }
    });

    it('REC-15: an invalid, expired or replayed proof gets no session, and email OTP alone never does', async () => {
      const enrolled = await enrolledAdmin();
      const { verified } = await verifiedEmail(enrolled.user.email);
      expect(verified.body.accessToken).toBeUndefined();
      expect(refreshCookie(verified)).toBeUndefined();
      const bogus = await api().post(`${recoveryApi}/complete`, { resetToken: `${'a'.repeat(60)}.TOTP`, newPassword: NEW_PASSWORD });
      expect(bogus.status).toBe(400);
      expect(bogus.body.accessToken).toBeUndefined();
      // A forged method suffix on a real authorization does not match the stored secret.
      const resetToken = await provenReset(enrolled);
      const forged = await api().post(`${recoveryApi}/complete`, { resetToken: `${resetToken.split('.')[0]}.RECOVERY_CODE`, newPassword: NEW_PASSWORD });
      expect(forged.status).toBe(400);
      expect(refreshCookie(forged)).toBeUndefined();
      // Expired authorization.
      await prisma.passwordResetToken.update({ where: { userId: enrolled.user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const expired = await api().post(`${recoveryApi}/complete`, { resetToken, newPassword: NEW_PASSWORD });
      expect(expired.status).toBe(400);
      expect(refreshCookie(expired)).toBeUndefined();
      expect(await prisma.adminSession.count({ where: { userId: enrolled.user.id, revokedAt: null } })).toBe(1); // only the original enrollment session
      expect((await api().post('/api/auth/login', { email: enrolled.user.email, password: PASSWORD })).body).toMatchObject({ requiresMfa: true });
    });

    it('REC-08: deactivation during recovery denies the proof; customer recovery is unchanged', async () => {
      const enrolled = await enrolledAdmin();
      const { verified } = await verifiedEmail(enrolled.user.email);
      await prisma.user.update({ where: { id: enrolled.user.id }, data: { isActive: false } });
      expect((await api().post(`${recoveryApi}/totp`, { recoveryToken: verified.body.recoveryToken, code: code(enrolled.secret, 1) })).status).toBe(401);
      expect(await prisma.passwordResetToken.count({ where: { userId: enrolled.user.id } })).toBe(0);

      const customer = await createUser('CUSTOMER');
      otps.clear();
      expect((await api().post('/api/auth/forgot-password', { email: customer.email })).status).toBe(200);
      const verifiedCustomer = await api().post('/api/auth/verify-reset-otp', { email: customer.email, code: otps.get(customer.email) });
      expect(verifiedCustomer.status).toBe(200);
      expect((await api().post('/api/auth/reset-password', { resetToken: verifiedCustomer.body.resetToken, newPassword: NEW_PASSWORD })).status).toBe(200);
      expect((await api().post('/api/auth/login', { email: customer.email, password: NEW_PASSWORD })).status).toBe(200);
    });
  });

  describe('ISO administrator and customer sessions are independent credential scopes in one browser', () => {
    const named = (response: request.Response, name: string) => ((response.headers['set-cookie'] as unknown as string[] | undefined) ?? []).find(value => value.startsWith(`${name}=`));
    const valueOf = (cookie: string) => cookie.split(';')[0]!.split('=')[1]!;
    const customerCookie = (response: request.Response) => named(response, 'electrohub_customer_refresh')?.split(';')[0];
    /** An MFA-assured administrator and a customer signed in separately, as one browser would hold them. */
    async function both() {
      const admin = await enrolledAdmin({ owner: true });
      const customer = await createUser('CUSTOMER');
      const login = await api().post('/api/auth/login', { email: customer.email, password: PASSWORD });
      expect(login.status).toBe(200);
      return { admin, customer, customerToken: login.body.accessToken as string, customerCookie: customerCookie(login)!, login };
    }

    it('ISO-01/04: a password alone creates no session; MFA creates an ADMIN-only cookie, a customer login a CUSTOMER-only cookie, and both coexist', async () => {
      const user = await createUser('ADMIN', { owner: true });
      const passwordOnly = await api().post('/api/auth/login', { email: user.email, password: PASSWORD });
      expect(passwordOnly.status).toBe(200);
      expect(passwordOnly.body.accessToken).toBeUndefined();
      expect(named(passwordOnly, 'electrohub_admin_refresh')).toBeUndefined();
      expect(named(passwordOnly, 'electrohub_customer_refresh')).toBeUndefined();
      expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);

      const { admin, customer, login } = await both();
      const adminSet = named(await api().post('/api/auth/admin/refresh', undefined, undefined, admin.cookie), 'electrohub_admin_refresh')!;
      expect(valueOf(adminSet)).toMatch(/^admin\.[0-9a-f]{128}$/);
      expect(adminSet).toContain('Path=/api/auth/admin');
      expect(adminSet).toContain('HttpOnly');
      expect(adminSet).toContain('SameSite=Lax');
      const customerSet = named(login, 'electrohub_customer_refresh')!;
      expect(valueOf(customerSet)).toMatch(/^customer\.[0-9a-f]{128}$/);
      expect(customerSet).toContain('Path=/api/auth/customer');
      expect(customerSet).toContain('HttpOnly');
      expect(named(login, 'electrohub_admin_refresh')).toBeUndefined();
      // Two distinct, simultaneously live session families, each bound to its own identity; only the administrator's has an MFA session.
      const adminFamily = await prisma.refreshToken.findFirstOrThrow({ where: { userId: admin.user.id, isRevoked: false }, select: { familyId: true } });
      const customerFamily = await prisma.refreshToken.findFirstOrThrow({ where: { userId: customer.id, isRevoked: false }, select: { familyId: true } });
      expect(adminFamily.familyId).not.toBe(customerFamily.familyId);
      expect(await prisma.adminSession.count({ where: { familyId: customerFamily.familyId } })).toBe(0);
    });

    it('ISO-05/07/08/09/17/18: each refresh returns only its own role, and each token works only on its own API surface', async () => {
      const { admin, customerToken, customerCookie: cookie } = await both();
      const adminRefresh = await api().post('/api/auth/admin/refresh', undefined, undefined, admin.cookie);
      const customerRefresh = await api().post('/api/auth/customer/refresh', undefined, undefined, cookie);
      expect(adminRefresh.status).toBe(200);
      expect(customerRefresh.status).toBe(200);
      expect(adminRefresh.body.user.role).toBe('ADMIN');
      expect(customerRefresh.body.user.role).toBe('CUSTOMER');
      expect(adminRefresh.body.user.id).not.toBe(customerRefresh.body.user.id);
      expect(named(adminRefresh, 'electrohub_customer_refresh')).toBeUndefined();
      expect(named(customerRefresh, 'electrohub_admin_refresh')).toBeUndefined();
      // ADMIN token: Admin Console yes; cart, wishlist and the customer profile surface no. CUSTOMER token: the reverse.
      expect((await api().get('/api/admin/me/profile', adminRefresh.body.accessToken)).status).toBe(200);
      expect((await api().get('/api/cart', adminRefresh.body.accessToken)).status).toBe(403);
      expect((await api().get('/api/wishlist', adminRefresh.body.accessToken)).status).toBe(403);
      expect((await api().get('/api/cart', customerRefresh.body.accessToken)).status).toBe(200);
      expect((await api().get('/api/admin/me/profile', customerRefresh.body.accessToken)).status).toBe(403);
      expect((await api().get('/api/admin/me/profile', customerToken)).status).toBe(403);
    });

    it('ISO-10: a wrong-scope refresh credential is rejected without revoking the other portal\'s family, in both directions', async () => {
      const { admin, customerCookie: cookie } = await both();
      const customerValue = valueOf(cookie);
      const adminValue = valueOf(admin.cookie);
      const familiesBefore = await prisma.refreshToken.count({ where: { isRevoked: false, userId: admin.user.id } });
      // A customer token presented to the administrator route (and the reverse), under the route's own cookie name.
      expect((await api().post('/api/auth/admin/refresh', undefined, undefined, `electrohub_admin_refresh=${customerValue}`)).status).toBe(401);
      expect((await api().post('/api/auth/customer/refresh', undefined, undefined, `electrohub_customer_refresh=${adminValue}`)).status).toBe(401);
      // The other portal's cookie name is simply not read.
      expect((await api().post('/api/auth/admin/refresh', undefined, undefined, cookie)).status).toBe(401);
      expect((await api().post('/api/auth/customer/refresh', undefined, undefined, admin.cookie)).status).toBe(401);
      // Neither family was revoked or even touched by the wrong-scope attempts: both still refresh.
      expect(await prisma.refreshToken.count({ where: { isRevoked: false, userId: admin.user.id } })).toBe(familiesBefore);
      expect((await api().post('/api/auth/admin/refresh', undefined, undefined, admin.cookie)).status).toBe(200);
      expect((await api().post('/api/auth/customer/refresh', undefined, undefined, cookie)).status).toBe(200);
    });

    it('ISO-11/12: signing out of one portal revokes only that family and clears only that cookie', async () => {
      const { admin, customerCookie: cookie } = await both();
      const adminOut = await api().post('/api/auth/admin/logout', undefined, undefined, admin.cookie);
      expect(adminOut.status).toBe(200);
      expect(named(adminOut, 'electrohub_admin_refresh')).toContain('electrohub_admin_refresh=;');
      expect(named(adminOut, 'electrohub_customer_refresh')).toBeUndefined();
      expect((await api().post('/api/auth/admin/refresh', undefined, undefined, admin.cookie)).status).toBe(401);
      const stillCustomer = await api().post('/api/auth/customer/refresh', undefined, undefined, cookie);
      expect(stillCustomer.status).toBe(200);

      const second = await both();
      const customerOut = await api().post('/api/auth/customer/logout', undefined, undefined, second.customerCookie);
      expect(customerOut.status).toBe(200);
      expect(named(customerOut, 'electrohub_customer_refresh')).toContain('electrohub_customer_refresh=;');
      expect(named(customerOut, 'electrohub_admin_refresh')).toBeUndefined();
      expect((await api().post('/api/auth/customer/refresh', undefined, undefined, second.customerCookie)).status).toBe(401);
      expect((await api().post('/api/auth/admin/refresh', undefined, undefined, second.admin.cookie)).status).toBe(200);
      // Presenting the wrong portal's cookie to a logout route revokes nothing.
      const third = await both();
      await api().post('/api/auth/customer/logout', undefined, undefined, `electrohub_customer_refresh=${valueOf(third.admin.cookie)}`);
      expect((await api().post('/api/auth/admin/refresh', undefined, undefined, third.admin.cookie)).status).toBe(200);
    });

    it('ISO-10/15: replay inside one scope revokes only that scope\'s family; concurrent rotation hands out exactly one successor', async () => {
      const { admin, customerCookie: cookie } = await both();
      const results = await Promise.all([1, 2].map(() => api().post('/api/auth/customer/refresh', undefined, undefined, cookie)));
      expect(results.map(result => result.status).sort()).toEqual([200, 409]);
      // A real replay: the family is dead after sign-out, and presenting its old cookie again must not disturb the administrator.
      const winner = results.find(result => result.status === 200)!;
      expect((await api().post('/api/auth/customer/logout', undefined, undefined, customerCookie(winner)!)).status).toBe(200);
      expect((await api().post('/api/auth/customer/refresh', undefined, undefined, customerCookie(winner)!)).status).toBe(401);
      expect((await api().post('/api/auth/admin/refresh', undefined, undefined, admin.cookie)).status).toBe(200);
    });

    it('ISO-16: the retired shared cookie authenticates neither portal and is only ever expired', async () => {
      const { admin, customer, customerCookie: cookie } = await both();
      const family = randomUUID();
      const legacyRaw = randomBytes(64).toString('hex'); // the pre-isolation format: no scope prefix
      const { createHash } = await import('node:crypto');
      await prisma.refreshToken.create({ data: { userId: customer.id, tokenHash: createHash('sha256').update(legacyRaw).digest('hex'), familyId: family,
        expiresAt: new Date(Date.now() + 3600_000) } });
      for (const route of ['/api/auth/customer/refresh', '/api/auth/admin/refresh']) {
        const name = route.includes('admin') ? 'electrohub_admin_refresh' : 'electrohub_customer_refresh';
        expect((await api().post(route, undefined, undefined, `${name}=${legacyRaw}`)).status).toBe(401);
      }
      // The retired route and cookie name never restore anything, and the stale cookie is expired.
      const retired = await api().post('/api/auth/refresh', undefined, undefined, `electrohub_refresh=${legacyRaw}`);
      expect(retired.status).toBe(401);
      expect(retired.body.accessToken).toBeUndefined();
      expect(named(retired, 'electrohub_refresh')).toContain('electrohub_refresh=;');
      expect(named(retired, 'electrohub_admin_refresh')).toBeUndefined();
      expect(named(retired, 'electrohub_customer_refresh')).toBeUndefined();
      const retiredLogout = await api().post('/api/auth/logout', undefined, undefined, `electrohub_refresh=${legacyRaw}`);
      expect(retiredLogout.status).toBe(200);
      expect(named(retiredLogout, 'electrohub_refresh')).toContain('electrohub_refresh=;');
      // Wrong-scope rejection came before replay handling: the legacy row was not revoked, and no valid family of either portal was touched.
      expect(await prisma.refreshToken.count({ where: { familyId: family, isRevoked: true } })).toBe(0);
      expect((await api().post('/api/auth/admin/refresh', undefined, undefined, admin.cookie)).status).toBe(200);
      expect((await api().post('/api/auth/customer/refresh', undefined, undefined, cookie)).status).toBe(200);
    });

    it('ISO-19: administrator step-up and Owner capability are unchanged by the scoped cookie', async () => {
      const { admin } = await both();
      const refreshed = await api().post('/api/auth/admin/refresh', undefined, undefined, admin.cookie);
      expect(refreshed.status).toBe(200);
      const noStepUp = await api().post('/api/admin/administrators/' + randomUUID() + '/mfa-activation', undefined, refreshed.body.accessToken);
      expect([403, 404]).toContain(noStepUp.status); // still gated (step-up or eligibility), never a silent success
      const plain = await enrolledAdmin();
      expect((await api().get('/api/admin/invitations', plain.accessToken)).status).toBe(403); // no inherited Owner/manage capability
    });
  });
});
