import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../app.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../utils/hash.js';
import { generateAccessToken } from '../utils/jwt.js';
import { base32Decode, hotp, totpStep } from './admin-crypto.js';
import { AuthService } from './auth.service.js';
import { env } from '../config/env.js';
import { DeliveryPublisher } from '../sockets/delivery.publisher.js';
import { adminMfaService } from './admin-mfa.service.js';

/**
 * Task 05.2 administrator security against a real, freshly migrated, disposable PostgreSQL through the real Express stack (run only by
 * scripts/admin-security-pg.cjs). Synthetic *.invalid identities; the invitation email provider is replaced by a capture.
 */
const { sentInvitations } = vi.hoisted(() => ({ sentInvitations: [] as { to: string; token: string }[] }));
vi.mock('./admin-invitation-email.js', () => ({
  sendAdminInvitationEmail: vi.fn(async (input: { to: string; token: string }) => { sentInvitations.push({ to: input.to, token: input.token }); return true; }),
  invitationLink: (token: string) => `http://localhost:3000/admin/invite#token=${token}`,
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
  .find(value => value.startsWith('electrohub_refresh='))?.split(';')[0];
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

  it('SEC-01/D02 cutover: a legacy pre-MFA admin refresh family is refused and revoked; a session-less ADMIN access token is refused', async () => {
    const refreshed = await api().post('/api/auth/refresh', undefined, undefined, 'electrohub_refresh=legacy-admin-refresh-token');
    expect(refreshed.status).toBe(401);
    expect(refreshed.body).toEqual({ error: 'Invalid or expired refresh token' }); // existing generic refresh contract
    expect(await prisma.refreshToken.count({ where: { userId: LEGACY_ADMIN, isRevoked: false } })).toBe(0);
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
    const rotated = await api().post('/api/auth/refresh', undefined, undefined, refreshCookie(session));
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
    expect((await api().post('/api/auth/refresh', undefined, undefined, other.cookie)).status).toBe(401);
    expect((await api().get('/api/admin/me/profile', admin.accessToken)).status).toBe(200);
    // Logout of the current session ends its access token too (not only the refresh cookie).
    expect((await api().post('/api/auth/logout', undefined, undefined, admin.cookie)).status).toBeLessThan(300);
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
    expect((await api().post('/api/auth/refresh', undefined, undefined, target.cookie)).status).toBe(401);
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
    expect(((changed.headers['set-cookie'] as unknown as string[]) ?? []).some(value => value.startsWith('electrohub_refresh=;'))).toBe(true);
    for (const token of [admin.accessToken, second.accessToken]) expect((await api().get('/api/admin/me/profile', token)).status).toBe(401);
    for (const cookie of [admin.cookie, second.cookie]) expect((await api().post('/api/auth/refresh', undefined, undefined, cookie)).status).toBe(401);
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
    expect((await api().post('/api/auth/refresh', undefined, undefined, manager.cookie)).status).toBe(401);
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
      message: 'You are the last active Owner. Assign another trusted administrator as Owner before deleting your account.' });
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
});
