import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app.js';
import { prisma } from '../lib/prisma.js';
import { base32Decode, hotp, totpStep } from './admin-crypto.js';
import { seedAdministrators } from '../utils/admin-seed.js';
import { SeedProvisioningError, authorizeSeedPasswordRecovery, authorizeSeedProvisioning, revokeSeedProvisioning } from './admin-seed-provisioning.service.js';

/**
 * Task 05.2 operator-issued password recovery for seeded DEV administrators that HAVE a factor but no mailbox, on a real, freshly migrated,
 * disposable PostgreSQL (run only by scripts/admin-security-pg.cjs). The proof replaces only the emailed code; the factor stays mandatory.
 */
const SEED_PASSWORD = 'Seed-Fallback-9-Password';
const FIRST_PASSWORD = 'Provisioned-Unique-9-Secret';
const RECOVERED_PASSWORD = 'Recovered-Unique-9-Secret';
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const post = (url: string, body?: object) => { const call = request(app).post(url).set('X-Forwarded-For', ip()); return body ? call.send(body) : call; };
const code = (secret: string, offset = 0) => hotp(base32Decode(secret), totpStep(Date.now()) + BigInt(offset));
const approval = { operator: 'QA Operator', tester: 'QA Tester', reason: 'Disposable QA of seed password recovery' };
const SEEDS = ['admin@electrohub.com', 'admin1@electrohub.com', 'admin2@electrohub.com', 'admin3@electrohub.com', 'admin4@electrohub.com'];
const handoffDir = mkdtempSync(path.join(tmpdir(), 'eh-seed-recovery-'));
const target = (email: string, userId: string) => ({ databaseIdentity: 'local', email, userId });
const codeOf = async (promise: Promise<unknown>) => {
  try { await promise; return 'OK'; } catch (error) { return error instanceof SeedProvisioningError ? error.code : `UNEXPECTED:${String(error)}`; }
};
function cli(args: string[]) {
  const tsx = path.join(path.dirname(require.resolve('tsx/package.json')), 'dist/cli.mjs');
  const result = spawnSync(process.execPath, [tsx, 'scripts/admin-security.ts', ...args], { cwd: path.resolve(__dirname, '../..'),
    env: process.env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

/** First-time setup through the existing provisioning path, so the account has a real verified TOTP factor and recovery codes. */
async function enroll(email: string, userId: string) {
  const issued = await authorizeSeedProvisioning(target(email, userId), approval);
  const redeemed = await post('/api/auth/admin/provisioning/redeem', { token: issued.token, password: FIRST_PASSWORD });
  const start = await post('/api/auth/admin/mfa/enrollment/start', { mfaToken: redeemed.body.mfaToken });
  const confirm = await post('/api/auth/admin/mfa/enrollment/confirm', { mfaToken: redeemed.body.mfaToken, factorId: start.body.factorId, code: code(start.body.secret) });
  expect(confirm.status).toBe(200);
  return { secret: start.body.secret as string, recoveryCodes: confirm.body.recoveryCodes as string[] };
}

describe.skipIf(process.env.ADMIN_SECURITY_PG_RUN !== '1').sequential('Task 05.2 seed administrator password recovery on real PostgreSQL', { timeout: 120_000 }, () => {
  let ids: Record<string, string>;
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: SEEDS } } });
    await prisma.adminSeedIdentity.deleteMany({ where: { seedEmail: { in: SEEDS } } });
    const adminRoleId = (await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } })).id;
    await seedAdministrators(prisma, { adminRoleId, passwordFor: () => SEED_PASSWORD });
    ids = Object.fromEntries(await Promise.all(SEEDS.map(async email => [email, (await prisma.user.findUniqueOrThrow({ where: { email } })).id])));
  });
  afterAll(async () => { rmSync(handoffDir, { recursive: true, force: true }); await prisma.$disconnect(); });

  it('REC-01 refusal: factor-less, Owner, primary Owner and missing approval refused and audited; purpose separation; revocation', async () => {
    const admin2 = ids['admin2@electrohub.com']!;
    expect(await codeOf(authorizeSeedPasswordRecovery(target('admin2@electrohub.com', admin2), approval))).toBe('NOT_ENROLLED');
    expect(await codeOf(authorizeSeedPasswordRecovery(target('admin@electrohub.com', ids['admin@electrohub.com']!), approval))).toBe('PRIMARY_OWNER_REFUSED');
    expect(await codeOf(authorizeSeedPasswordRecovery(target('admin2@electrohub.com', admin2), { ...approval, tester: '' }))).toBe('APPROVAL_REQUIRED');
    await enroll('admin2@electrohub.com', admin2);
    await prisma.adminAccountSecurity.update({ where: { userId: admin2 }, data: { isOwner: true } });
    expect(await codeOf(authorizeSeedPasswordRecovery(target('admin2@electrohub.com', admin2), approval))).toBe('OWNER_REFUSED');
    await prisma.adminAccountSecurity.update({ where: { userId: admin2 }, data: { isOwner: false } });
    const codes = (await prisma.adminAuditLog.findMany({ where: { action: 'ADMIN_SEED_PASSWORD_RECOVERY_AUTHORIZED', outcome: 'DENIED' } }))
      .map(row => (row.details as { code: string }).code);
    expect(codes).toEqual(expect.arrayContaining(['NOT_ENROLLED', 'PRIMARY_OWNER_REFUSED', 'APPROVAL_REQUIRED', 'OWNER_REFUSED']));
    // A recovery proof is never a provisioning or Owner-activation proof.
    const issued = await authorizeSeedPasswordRecovery(target('admin2@electrohub.com', admin2), approval);
    expect((await post('/api/auth/admin/provisioning/redeem', { token: issued.token, password: RECOVERED_PASSWORD })).status).toBe(410);
    expect((await post('/api/auth/admin/activation/redeem', { token: issued.token, password: RECOVERED_PASSWORD })).status).toBe(410);
    expect(await codeOf(revokeSeedProvisioning(target('admin2@electrohub.com', admin2), approval, 'PASSWORD_RECOVERY'))).toBe('OK');
    expect((await post('/api/auth/admin/password-recovery/seed-proof', { token: issued.token })).body.error.code).toBe('SEED_RECOVERY_UNAVAILABLE');
  });

  it('REC-02 CLI handoff, factor still required, single use, password rotated, factors and emailVerifiedAt untouched, audit without secrets', async () => {
    const id = ids['admin1@electrohub.com']!;
    const { secret } = await enroll('admin1@electrohub.com', id);
    const before = await prisma.user.findUniqueOrThrow({ where: { id } });
    const factorsBefore = await prisma.adminMfaFactor.count({ where: { userId: id, verifiedAt: { not: null }, disabledAt: null } });
    const handoff = path.join(handoffDir, 'admin1.txt');
    const issued = cli(['recover-seeded-admin-password', 'admin1@electrohub.com', `--user-id=${id}`, '--operator=QA Operator', '--tester=QA Tester',
      '--reason=Disposable QA of seed password recovery', `--handoff-file=${handoff}`, '--confirm-target=local']);
    expect(issued.status, issued.out).toBe(0);
    const link = readFileSync(handoff, 'utf8').trim();
    expect(link).toMatch(/^http:\/\/localhost:3000\/admin\/forgot-password#seed-recovery=/);
    const token = decodeURIComponent(link.split('#seed-recovery=')[1]!);
    expect(issued.out).not.toContain(token);

    const opened = await post('/api/auth/admin/password-recovery/seed-proof', { token });
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ recoveryToken: expect.any(String), factors: { totp: true } });
    expect(opened.body.resetToken).toBeUndefined();
    expect(opened.body.accessToken).toBeUndefined();
    expect(opened.headers['set-cookie']).toBeUndefined();
    expect((await post('/api/auth/admin/password-recovery/seed-proof', { token })).body.error.code).toBe('SEED_RECOVERY_UNAVAILABLE');
    // The recovery transaction alone cannot reset: only a verified factor mints the reset authorization.
    expect((await post('/api/auth/admin/password-recovery/complete', { resetToken: opened.body.recoveryToken, newPassword: RECOVERED_PASSWORD })).status).not.toBe(200);
    expect((await post('/api/auth/admin/password-recovery/totp', { recoveryToken: opened.body.recoveryToken, code: '000000' })).status).not.toBe(200);
    const verified = await post('/api/auth/admin/password-recovery/totp', { recoveryToken: opened.body.recoveryToken, code: code(secret, 1) });
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    const done = await post('/api/auth/admin/password-recovery/complete', { resetToken: verified.body.resetToken, newPassword: RECOVERED_PASSWORD });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((await post('/api/auth/login', { email: 'admin1@electrohub.com', password: FIRST_PASSWORD })).status).toBe(401);
    const login = await post('/api/auth/login', { email: 'admin1@electrohub.com', password: RECOVERED_PASSWORD });
    expect(login.body.mfaToken).toEqual(expect.any(String));
    expect(login.body.accessToken).toBeUndefined();

    const after = await prisma.user.findUniqueOrThrow({ where: { id }, include: { adminSecurity: true } });
    expect(after.emailVerifiedAt?.getTime()).toBe(before.emailVerifiedAt?.getTime());
    expect(after.adminSecurity?.isOwner).toBe(false);
    expect(await prisma.adminMfaFactor.count({ where: { userId: id, verifiedAt: { not: null }, disabledAt: null } })).toBe(factorsBefore);
    const audits = await prisma.adminAuditLog.findMany({ where: { resourceId: id, action: { startsWith: 'ADMIN_SEED_PASSWORD_RECOVERY' } } });
    expect(audits.map(row => `${row.action}:${row.outcome}`)).toEqual(expect.arrayContaining([
      'ADMIN_SEED_PASSWORD_RECOVERY_AUTHORIZED:SUCCESS', 'ADMIN_SEED_PASSWORD_RECOVERY_REDEEMED:SUCCESS', 'ADMIN_SEED_PASSWORD_RECOVERY_REDEEMED:DENIED']));
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(opened.body.recoveryToken);
    expect(serialized).not.toContain(RECOVERED_PASSWORD);
    expect(serialized).not.toMatch(/tokenHash|passwordHash|secret/i);
  });

  it('REC-03 expiry, and a factor removed after issue: both refused at redemption and audited; no recovery transaction opened', async () => {
    const id = ids['admin2@electrohub.com']!;
    const issued = await authorizeSeedPasswordRecovery(target('admin2@electrohub.com', id), approval);
    await prisma.adminMfaActivation.update({ where: { id: issued.recoveryProofId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await post('/api/auth/admin/password-recovery/seed-proof', { token: issued.token })).status).toBe(410);
    const second = await authorizeSeedPasswordRecovery(target('admin2@electrohub.com', id), approval);
    const now = new Date();
    await prisma.adminMfaFactor.updateMany({ where: { userId: id }, data: { disabledAt: now } });
    await prisma.adminRecoveryCode.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
    expect((await post('/api/auth/admin/password-recovery/seed-proof', { token: second.token })).status).toBe(410);
    const codes = (await prisma.adminAuditLog.findMany({ where: { resourceId: id, action: 'ADMIN_SEED_PASSWORD_RECOVERY_REDEEMED', outcome: 'DENIED' } }))
      .map(row => (row.details as { code: string }).code);
    expect(codes).toEqual(expect.arrayContaining(['EXPIRED', 'NOT_ENROLLED']));
    expect(await prisma.adminAuthChallenge.count({ where: { userId: id, purpose: 'PASSWORD_RECOVERY', consumedAt: null } })).toBe(0);
  });

  it('REC-04 a recovery code is accepted as the mandatory factor proof', async () => {
    const id = ids['admin3@electrohub.com']!;
    const { recoveryCodes } = await enroll('admin3@electrohub.com', id);
    const issued = await authorizeSeedPasswordRecovery(target('admin3@electrohub.com', id), approval);
    const opened = await post('/api/auth/admin/password-recovery/seed-proof', { token: issued.token });
    expect(opened.status).toBe(200);
    const verified = await post('/api/auth/admin/password-recovery/recovery-code', { recoveryToken: opened.body.recoveryToken, code: recoveryCodes[0] });
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    expect(verified.body.resetToken).toEqual(expect.any(String));
  });
});
