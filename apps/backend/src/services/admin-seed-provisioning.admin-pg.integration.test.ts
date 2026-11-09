import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../utils/hash.js';
import { base32Decode, hotp, totpStep } from './admin-crypto.js';
import { seedAdministrators } from '../utils/admin-seed.js';
import { seedProvisioningRoutesEnabled } from '../routes/admin-security.routes.js';
import { validateEnvironment } from '../config/env.js';
import { adminTeamService } from './admin-team.service.js';
import {
  PRODUCTION_REF, SHARED_DEV_REF, SeedProvisioningError, assertProvisioningTarget, authorizeSeedProvisioning, databaseIdentity, registerSeedIdentity,
  revokeSeedProvisioning,
} from './admin-seed-provisioning.service.js';

/**
 * Task 05.2 operator provisioning of seeded DEV administrators without a mailbox, on a real, freshly migrated, disposable PostgreSQL
 * through the real Express stack and the real operator CLI (run only by scripts/admin-security-pg.cjs). Never shared DEV or PROD.
 */
const SEED_PASSWORD = 'Seed-Fallback-9-Password';
const NEW_PASSWORD = 'Provisioned-Unique-9-Secret';
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const post = (url: string, body?: object, token?: string) => {
  let call = request(app).post(url).set('X-Forwarded-For', ip());
  if (token) call = call.set('Authorization', `Bearer ${token}`);
  return body ? call.send(body) : call;
};
const get = (url: string, token?: string) => { const call = request(app).get(url).set('X-Forwarded-For', ip()); return token ? call.set('Authorization', `Bearer ${token}`) : call; };
const code = (secret: string, offset = 0) => hotp(base32Decode(secret), totpStep(Date.now()) + BigInt(offset));
const approval = { operator: 'QA Operator', tester: 'QA Tester', reason: 'Disposable QA of seed administrator provisioning' };
const SEEDS = ['admin@electrohub.com', 'admin1@electrohub.com', 'admin2@electrohub.com'];
const handoffDir = mkdtempSync(path.join(tmpdir(), 'eh-seed-handoff-'));

async function roleId(name: 'ADMIN' | 'CUSTOMER') { return (await prisma.role.findUniqueOrThrow({ where: { name } })).id; }
async function freshSeeds() {
  // Deleting the users cascades their provenance, sessions and activations; the seed then recreates all five accounts.
  await prisma.user.deleteMany({ where: { email: { in: SEEDS } } });
  await prisma.adminSeedIdentity.deleteMany({ where: { seedEmail: { in: SEEDS } } });
  await seedAdministrators(prisma, { adminRoleId: await roleId('ADMIN'), passwordFor: () => SEED_PASSWORD });
  return Object.fromEntries(await Promise.all(SEEDS.map(async email => [email, (await prisma.user.findUniqueOrThrow({ where: { email } })).id]))) as Record<string, string>;
}
const target = (email: string, userId: string) => ({ databaseIdentity: 'local', email, userId });
const codeOf = async (promise: Promise<unknown>) => {
  try { await promise; return 'OK'; } catch (error) { return error instanceof SeedProvisioningError ? error.code : `UNEXPECTED:${String(error)}`; }
};
const tokenFrom = (link: string) => decodeURIComponent(link.trim().split('#token=')[1]!);

/** The real operator CLI, exactly as an operator would run it (tsx scripts/admin-security.ts), against a chosen DATABASE_URL. */
function cli(args: string[], env: Record<string, string | undefined> = {}) {
  const tsx = path.join(path.dirname(require.resolve('tsx/package.json')), 'dist/cli.mjs');
  const result = spawnSync(process.execPath, [tsx, 'scripts/admin-security.ts', ...args], { cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

describe.skipIf(process.env.ADMIN_SECURITY_PG_RUN !== '1').sequential('Task 05.2 seed administrator provisioning on real PostgreSQL', { timeout: 120_000 }, () => {
  let ids: Record<string, string>;
  beforeAll(async () => { ids = await freshSeeds(); });
  afterAll(async () => { rmSync(handoffDir, { recursive: true, force: true }); await prisma.$disconnect(); });

  it('PROV-01 target gate: exact database identity required; production, unknown and NODE_ENV=production refused before any access', () => {
    expect(databaseIdentity('postgresql://postgres@127.0.0.1:5432/db')).toBe('local');
    expect(databaseIdentity(`postgresql://postgres.${SHARED_DEV_REF}:x@aws-0-eu.pooler.supabase.com:6543/postgres`)).toBe(SHARED_DEV_REF);
    expect(databaseIdentity(`postgresql://postgres:x@db.${PRODUCTION_REF}.supabase.co:5432/postgres`)).toBe(PRODUCTION_REF);
    // A pooler user naming one project and a host naming another is ambiguous: unknown.
    expect(databaseIdentity(`postgresql://postgres.${SHARED_DEV_REF}:x@db.${PRODUCTION_REF}.supabase.co:5432/postgres`)).toBe('unknown');
    expect(databaseIdentity('not a url')).toBe('unknown');
    const gate = (resolved: string, confirmed: string | undefined, nodeEnv = 'development') => {
      try { assertProvisioningTarget({ resolved, confirmed, nodeEnv }); return 'OK'; } catch (error) { return (error as SeedProvisioningError).code; }
    };
    expect(gate('local', 'local')).toBe('OK');
    expect(gate(SHARED_DEV_REF, SHARED_DEV_REF)).toBe('OK');
    expect(gate(SHARED_DEV_REF, undefined)).toBe('TARGET_CONFIRMATION_MISMATCH');
    expect(gate(SHARED_DEV_REF, 'local')).toBe('TARGET_CONFIRMATION_MISMATCH');
    expect(gate(PRODUCTION_REF, PRODUCTION_REF)).toBe('PRODUCTION_REFUSED');
    expect(gate('unknown', 'unknown')).toBe('TARGET_NOT_ALLOWED');
    expect(gate('abcdefghijklmnopqrst', 'abcdefghijklmnopqrst')).toBe('TARGET_NOT_ALLOWED');
    expect(gate('local', 'local', 'production')).toBe('PRODUCTION_REFUSED');
  });

  it('PROV-02 the real CLI refuses production and unknown databases (spoofed confirmation included) without connecting', () => {
    // Unreachable hosts: a refusal that tried to connect would time out or report a connection error instead of the code.
    const prodUrl = `postgresql://postgres.${PRODUCTION_REF}:x@127.0.0.2.invalid:6543/postgres`;
    const refused = cli(['provision-seeded-admin', 'admin1@electrohub.com', `--user-id=${randomUUID()}`, '--operator=QA', '--tester=QA',
      '--reason=Attempt against production', `--handoff-file=${path.join(handoffDir, 'never.txt')}`, `--confirm-target=${PRODUCTION_REF}`],
    { DATABASE_URL: prodUrl, DIRECT_URL: prodUrl });
    expect(refused.status).toBe(1);
    // Refused by the CLI's own gate or, earlier still, by the application's database-target guard at import: never a connection.
    expect(refused.out).toMatch(/\[PRODUCTION_REFUSED\]|DATABASE_TARGET_UNAPPROVED/);
    expect(refused.out).not.toMatch(/P1001|Can't reach database/);
    const unknownUrl = 'postgresql://postgres:x@db.example.invalid:5432/postgres';
    const unknown = cli(['seed-status', '--confirm-target=unknown'], { DATABASE_URL: unknownUrl, DIRECT_URL: unknownUrl });
    expect(unknown.status).toBe(1);
    expect(unknown.out).toMatch(/\[TARGET_NOT_ALLOWED\]|DATABASE_TARGET_UNAPPROVED/);
    expect(unknown.out).not.toMatch(/P1001|Can't reach database/);
    const productionMode = cli(['seed-status', '--confirm-target=local'], { NODE_ENV: 'production' });
    expect(productionMode.status).toBe(1);
    expect(productionMode.out).not.toContain('"userId"');
  });

  it('PROV-03 an approved seed account is provisioned end to end: CLI handoff, password rotation, sessions revoked, mandatory TOTP, no Owner', async () => {
    const id = ids['admin1@electrohub.com']!;
    const before = await prisma.user.findUniqueOrThrow({ where: { id } });
    // Previously authorized management access must survive; a stale refresh token and admin session must not.
    await prisma.adminAccountSecurity.upsert({ where: { userId: id }, create: { userId: id, canManageAdmins: true }, update: { canManageAdmins: true } });
    const family = randomUUID();
    await prisma.refreshToken.create({ data: { userId: id, tokenHash: randomUUID().replace(/-/g, ''), familyId: family, expiresAt: new Date(Date.now() + 86_400_000) } });
    // The seeded password is still the credential (accepted, then refused for lack of an authorized first factor: 403, not 401).
    const oldLogin = await post('/api/auth/login', { email: 'admin1@electrohub.com', password: SEED_PASSWORD });
    expect(oldLogin.status).toBe(403);
    expect(oldLogin.body.error.code).toBe('ENROLLMENT_NOT_AUTHORIZED');
    expect(oldLogin.body.accessToken).toBeUndefined();

    const status = cli(['seed-status', '--confirm-target=local']);
    expect(status.status).toBe(0);
    expect(status.out).toContain(`"userId":"${id}"`);
    expect(status.out).toContain('"provenance":"SEED"');
    const handoff = path.join(handoffDir, 'admin1.txt');
    const issued = cli(['provision-seeded-admin', 'admin1@electrohub.com', `--user-id=${id}`, '--operator=QA Operator', '--tester=QA Tester',
      '--reason=Disposable QA of seed provisioning', `--handoff-file=${handoff}`, '--confirm-target=local']);
    expect(issued.status, issued.out).toBe(0);
    const link = readFileSync(handoff, 'utf8');
    expect(link).toMatch(/^http:\/\/localhost:3000\/admin\/provision#token=/);
    const token = tokenFrom(link);
    expect(issued.out).not.toContain(token); // the secret is only in the handoff file
    // Writing over an existing handoff file is refused.
    expect(cli(['provision-seeded-admin', 'admin1@electrohub.com', `--user-id=${id}`, '--operator=QA', '--tester=QA', '--reason=Second handoff attempt',
      `--handoff-file=${handoff}`, '--confirm-target=local']).out).toContain('already exists');

    expect((await post('/api/auth/admin/provisioning/preview', { token })).body).toMatchObject({ email: 'admin1@electrohub.com' });
    const redeemed = await post('/api/auth/admin/provisioning/redeem', { token, password: NEW_PASSWORD });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.mfaToken).toEqual(expect.any(String));
    expect(redeemed.body.accessToken).toBeUndefined();
    expect(redeemed.headers['set-cookie']).toBeUndefined(); // no session before MFA
    expect((await post('/api/auth/admin/provisioning/redeem', { token, password: 'Another-Unique-9-Secret' })).body.error.code).toBe('PROVISIONING_UNAVAILABLE');

    expect((await post('/api/auth/login', { email: 'admin1@electrohub.com', password: SEED_PASSWORD })).status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { userId: id, isRevoked: false } })).toBe(0);
    // The restricted challenge cannot reach the console; only a confirmed authenticator produces a session.
    expect((await get('/api/admin/me/profile', redeemed.body.mfaToken)).status).toBe(401);
    const start = await post('/api/auth/admin/mfa/enrollment/start', { mfaToken: redeemed.body.mfaToken });
    expect(start.status).toBe(200);
    expect((await post('/api/auth/admin/mfa/enrollment/confirm', { mfaToken: redeemed.body.mfaToken, factorId: start.body.factorId, code: '000000' })).status).not.toBe(200);
    const confirm = await post('/api/auth/admin/mfa/enrollment/confirm', { mfaToken: redeemed.body.mfaToken, factorId: start.body.factorId, code: code(start.body.secret) });
    expect(confirm.status).toBe(200);
    expect(confirm.body.recoveryCodes).toHaveLength(10);
    expect((await get('/api/admin/me/profile', confirm.body.accessToken)).body.data.capabilities).toEqual({ isOwner: false, canManageAdmins: true });

    // Normal MFA login with the new password.
    const login = await post('/api/auth/login', { email: 'admin1@electrohub.com', password: NEW_PASSWORD });
    expect(login.body.accessToken).toBeUndefined();
    expect((await post('/api/auth/admin/mfa/totp/verify', { mfaToken: login.body.mfaToken, code: code(start.body.secret, 1) })).status).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { id }, include: { adminSecurity: true } });
    expect(after.emailVerifiedAt?.getTime()).toBe(before.emailVerifiedAt?.getTime()); // not presented as email verification
    expect(after.adminSecurity).toMatchObject({ isOwner: false, canManageAdmins: true });
    const audits = await prisma.adminAuditLog.findMany({ where: { resourceId: id, action: { startsWith: 'ADMIN_SEED_PROVISIONING' } }, orderBy: { createdAt: 'asc' } });
    expect(audits.map(row => `${row.action}:${row.outcome}`)).toEqual(expect.arrayContaining(['ADMIN_SEED_PROVISIONING_AUTHORIZED:SUCCESS', 'ADMIN_SEED_PROVISIONING_REDEEMED:SUCCESS']));
    expect(audits.find(row => row.action === 'ADMIN_SEED_PROVISIONING_AUTHORIZED')!.details).toMatchObject({ databaseIdentity: 'local', operator: 'QA Operator',
      tester: 'QA Tester', reason: 'Disposable QA of seed provisioning' });
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(NEW_PASSWORD);
    expect(serialized).not.toMatch(/tokenHash|passwordHash|secret/i);
    // Now enrolled: provisioning is refused (lost factors follow the separate recovery procedure).
    expect(await codeOf(authorizeSeedProvisioning(target('admin1@electrohub.com', id), approval))).toBe('ALREADY_ENROLLED');
    // A seed re-run never resets the rotated password or provenance.
    await seedAdministrators(prisma, { adminRoleId: await roleId('ADMIN'), passwordFor: () => SEED_PASSWORD });
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).passwordHash).toBe(after.passwordHash);
    expect(await prisma.adminSeedIdentity.findUniqueOrThrow({ where: { userId: id } })).toMatchObject({ seedEmail: 'admin1@electrohub.com', source: 'SEED' });
  });

  it('PROV-04 refusals: non-seed ADMIN, primary Owner, Owner, CUSTOMER, inactive, deleted, wrong id, missing approval — each audited, nothing changed', async () => {
    ids = await freshSeeds(); // fresh, factor-less admin1/admin2 for this test
    const plain = await prisma.user.create({ data: { email: `plain-${randomUUID().slice(0, 8)}@qa.invalid`, passwordHash: await hashPassword(SEED_PASSWORD),
      firstName: 'Plain', lastName: 'Admin', roleId: await roleId('ADMIN') } });
    expect(await codeOf(authorizeSeedProvisioning(target(plain.email, plain.id), approval))).toBe('NOT_SEED_EMAIL');
    expect(await codeOf(authorizeSeedProvisioning(target('admin@electrohub.com', ids['admin@electrohub.com']!), approval))).toBe('PRIMARY_OWNER_REFUSED');
    // An Owner among admin1–2 is refused too.
    const admin2 = ids['admin2@electrohub.com']!;
    await prisma.adminAccountSecurity.upsert({ where: { userId: admin2 }, create: { userId: admin2, isOwner: true, canManageAdmins: true }, update: { isOwner: true } });
    expect(await codeOf(authorizeSeedProvisioning(target('admin2@electrohub.com', admin2), approval))).toBe('OWNER_REFUSED');
    await prisma.adminAccountSecurity.update({ where: { userId: admin2 }, data: { isOwner: false, canManageAdmins: false } });
    // The id must belong to that exact email.
    expect(await codeOf(authorizeSeedProvisioning(target('admin2@electrohub.com', ids['admin1@electrohub.com']!), approval))).toBe('IDENTITY_MISMATCH');
    expect(await codeOf(authorizeSeedProvisioning(target('admin2@electrohub.com', randomUUID()), approval))).toBe('USER_NOT_FOUND');
    expect(await codeOf(authorizeSeedProvisioning(target('admin2@electrohub.com', 'not-a-uuid'), approval))).toBe('USER_ID_REQUIRED');
    // Explicit approval is mandatory.
    expect(await codeOf(authorizeSeedProvisioning(target('admin2@electrohub.com', admin2), { ...approval, tester: '' }))).toBe('APPROVAL_REQUIRED');
    expect(await codeOf(authorizeSeedProvisioning(target('admin2@electrohub.com', admin2), { ...approval, reason: 'short' }))).toBe('APPROVAL_REQUIRED');
    expect(await codeOf(authorizeSeedProvisioning(target('admin2@electrohub.com', admin2), { ...approval, operator: '' }))).toBe('APPROVAL_REQUIRED');
    // Deactivation is never bypassed.
    await prisma.user.update({ where: { id: admin2 }, data: { isActive: false } });
    expect(await codeOf(authorizeSeedProvisioning(target('admin2@electrohub.com', admin2), approval))).toBe('ACCOUNT_INACTIVE');
    await prisma.user.update({ where: { id: admin2 }, data: { isActive: true } });
    // A CUSTOMER that happens to hold a seed email is not an administrator.
    const admin1 = ids['admin1@electrohub.com']!;
    await prisma.user.update({ where: { id: admin1 }, data: { roleId: await roleId('CUSTOMER') } });
    expect(await codeOf(authorizeSeedProvisioning(target('admin1@electrohub.com', admin1), approval))).toBe('NOT_ADMIN');
    await prisma.user.update({ where: { id: admin1 }, data: { roleId: await roleId('ADMIN') } });
    // A deleted (anonymized) account is never restored.
    const deleted = await prisma.user.create({ data: { email: `deleted-admin-${randomUUID()}@deleted.invalid`, passwordHash: null, firstName: 'Deleted', lastName: 'Administrator',
      isActive: false, roleId: await roleId('ADMIN') } });
    expect(await codeOf(authorizeSeedProvisioning(target('admin1@electrohub.com', deleted.id), approval))).toBe('ACCOUNT_DELETED');

    expect(await prisma.adminMfaActivation.count({ where: { purpose: 'SEED_PROVISIONING', userId: { in: [plain.id, admin2, admin1, deleted.id] } } })).toBe(0);
    const denials = await prisma.adminAuditLog.findMany({ where: { action: 'ADMIN_SEED_PROVISIONING_AUTHORIZED', outcome: 'DENIED' } });
    const codes = denials.map(row => (row.details as { code: string }).code);
    expect(codes).toEqual(expect.arrayContaining(['NOT_SEED_EMAIL', 'PRIMARY_OWNER_REFUSED', 'OWNER_REFUSED', 'IDENTITY_MISMATCH', 'APPROVAL_REQUIRED',
      'ACCOUNT_INACTIVE', 'NOT_ADMIN', 'ACCOUNT_DELETED']));
    expect(JSON.stringify(denials)).not.toMatch(/token|password/i);
  });

  it('PROV-05 provenance: a recreated account with the same email is never mistaken for the seed identity until explicitly approved', async () => {
    ids = await freshSeeds();
    // The original admin1 is deleted (anonymized, as the product does); the seed re-run recreates the email with a NEW id.
    const original = ids['admin1@electrohub.com']!;
    await prisma.user.update({ where: { id: original }, data: { email: `deleted-admin-${original}@deleted.invalid`, isActive: false, passwordHash: null } });
    await seedAdministrators(prisma, { adminRoleId: await roleId('ADMIN'), passwordFor: () => SEED_PASSWORD });
    const recreated = await prisma.user.findUniqueOrThrow({ where: { email: 'admin1@electrohub.com' }, include: { adminSeedIdentity: true } });
    expect(recreated.id).not.toBe(original);
    expect(recreated.adminSeedIdentity).toBeNull();
    expect(await codeOf(authorizeSeedProvisioning(target('admin1@electrohub.com', recreated.id), approval))).toBe('PROVENANCE_MISSING');
    expect(await codeOf(registerSeedIdentity(target('admin1@electrohub.com', recreated.id), approval))).toBe('SUPERSEDE_REQUIRED');
    expect(await codeOf(registerSeedIdentity(target('admin1@electrohub.com', recreated.id), { ...approval, supersedeDeleted: true }))).toBe('OK');
    expect(await codeOf(registerSeedIdentity(target('admin1@electrohub.com', recreated.id), approval))).toBe('ALREADY_REGISTERED');
    expect(await prisma.adminSeedIdentity.findUniqueOrThrow({ where: { userId: recreated.id } })).toMatchObject({ source: 'OPERATOR', approvedBy: 'QA Operator' });
    expect(await codeOf(authorizeSeedProvisioning(target('admin1@electrohub.com', recreated.id), approval))).toBe('OK');

    // An account that predates provenance (as on shared DEV today) needs the same explicit registration.
    const admin2 = ids['admin2@electrohub.com']!;
    await prisma.adminSeedIdentity.delete({ where: { userId: admin2 } });
    expect(await codeOf(authorizeSeedProvisioning(target('admin2@electrohub.com', admin2), approval))).toBe('PROVENANCE_MISSING');
    expect(await codeOf(registerSeedIdentity(target('admin2@electrohub.com', admin2), { operator: 'QA Operator', reason: '' }))).toBe('APPROVAL_REQUIRED');
    expect(await codeOf(registerSeedIdentity(target('admin2@electrohub.com', admin2), approval))).toBe('OK');
    expect(await prisma.adminAuditLog.count({ where: { action: 'ADMIN_SEED_IDENTITY_REGISTERED', outcome: 'SUCCESS', resourceId: admin2 } })).toBe(1);
  });

  it('PROV-06 expiry, revocation, purpose separation and Owner resend: a proof works only on its own path, once, before it expires', async () => {
    ids = await freshSeeds();
    const id = ids['admin2@electrohub.com']!;
    const issued = await authorizeSeedProvisioning(target('admin2@electrohub.com', id), approval);
    expect(await codeOf(authorizeSeedProvisioning(target('admin2@electrohub.com', id), approval))).toBe('PENDING_EXISTS');
    // A seed proof is never accepted by the Owner activation endpoint.
    expect((await post('/api/auth/admin/activation/preview', { token: issued.token })).body.error.code).toBe('ACTIVATION_UNAVAILABLE');
    expect((await post('/api/auth/admin/activation/redeem', { token: issued.token, password: NEW_PASSWORD })).status).toBe(410);
    // Expired.
    await prisma.adminMfaActivation.update({ where: { id: issued.provisioningId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await post('/api/auth/admin/provisioning/preview', { token: issued.token })).status).toBe(410);
    expect((await post('/api/auth/admin/provisioning/redeem', { token: issued.token, password: NEW_PASSWORD })).body.error.code).toBe('PROVISIONING_UNAVAILABLE');
    // An expired pending proof is closed when a new one is issued; the new one can then be revoked by the operator.
    const second = await authorizeSeedProvisioning(target('admin2@electrohub.com', id), approval);
    expect(await codeOf(revokeSeedProvisioning(target('admin2@electrohub.com', id), { operator: 'QA Operator', reason: 'Tester no longer needs the account' }))).toBe('OK');
    expect((await post('/api/auth/admin/provisioning/redeem', { token: second.token, password: NEW_PASSWORD })).status).toBe(410);
    expect(await codeOf(revokeSeedProvisioning(target('admin2@electrohub.com', id), approval))).toBe('NOT_PENDING');
    // The seeded password is unchanged (nothing was redeemed: 403 ENROLLMENT_NOT_AUTHORIZED, not 401) and no window was opened.
    expect((await post('/api/auth/login', { email: 'admin2@electrohub.com', password: SEED_PASSWORD })).body.error.code).toBe('ENROLLMENT_NOT_AUTHORIZED');
    expect((await prisma.adminAccountSecurity.findUnique({ where: { userId: id } }))?.enrollmentAllowedUntil ?? null).toBeNull();

    // An Owner-emailed activation token is never accepted by the provisioning endpoint.
    const ownerToken = `owner-activation-${randomUUID()}`;
    const { createHash } = await import('node:crypto');
    await prisma.adminMfaActivation.create({ data: { userId: id, email: 'admin2@electrohub.com', tokenHash: createHash('sha256').update(ownerToken).digest('hex'),
      expiresAt: new Date(Date.now() + 600_000) } });
    expect((await post('/api/auth/admin/provisioning/preview', { token: ownerToken })).status).toBe(410);
    expect((await post('/api/auth/admin/provisioning/redeem', { token: ownerToken, password: NEW_PASSWORD })).status).toBe(410);
    expect((await post('/api/auth/admin/activation/preview', { token: ownerToken })).status).toBe(200);
    await prisma.adminMfaActivation.updateMany({ where: { userId: id, status: 'PENDING' }, data: { status: 'REVOKED', revokedAt: new Date() } });
  });

  it('PROV-07 concurrent redemption of one proof: exactly one winner; the loser gets the unavailable answer', async () => {
    const id = ids['admin2@electrohub.com']!;
    const issued = await authorizeSeedProvisioning(target('admin2@electrohub.com', id), approval);
    const results = await Promise.all([
      post('/api/auth/admin/provisioning/redeem', { token: issued.token, password: 'Racer-One-9-Unique-Secret' }),
      post('/api/auth/admin/provisioning/redeem', { token: issued.token, password: 'Racer-Two-9-Unique-Secret' }),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([200, 410]);
    const winner = results.find(result => result.status === 200)!;
    expect(winner.body.mfaToken).toEqual(expect.any(String));
    expect(await prisma.adminAuditLog.count({ where: { resourceId: id, action: 'ADMIN_SEED_PROVISIONING_REDEEMED' } })).toBe(1);
  });

  it('PROV-08 production isolation of the redemption routes and of the local email capture', () => {
    expect(seedProvisioningRoutesEnabled({ NODE_ENV: 'production', ADMIN_SEED_PROVISIONING_ENABLED: 'true' })).toBe(false);
    expect(seedProvisioningRoutesEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(seedProvisioningRoutesEnabled({ NODE_ENV: 'development', ADMIN_SEED_PROVISIONING_ENABLED: 'true' })).toBe(true);
    const base = { DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/db', DIRECT_URL: 'postgresql://postgres@127.0.0.1:5432/db',
      JWT_SECRET: 'q9W!x2Lr#7vB@m4Kz8Tn$1Hs6Yp3Gd5Fj0', BREVO_API_KEY: 'k', BREVO_SENDER_EMAIL: 'no-reply@example.com', OTP_HASH_SECRET: 'a-long-otp-hash-secret' };
    const remote = 'postgresql://postgres.abcdefghijklmnopqrst:x@aws-0-eu.pooler.supabase.com:6543/postgres';
    const valid = (extra: Record<string, string>) => { try { validateEnvironment({ ...base, ...extra }); return true; } catch { return false; } };
    expect(valid({ NODE_ENV: 'production', ADMIN_SEED_PROVISIONING_ENABLED: 'true' })).toBe(false);
    expect(valid({ NODE_ENV: 'production', E2E_OTP_OUTBOX_DIR: '/tmp/outbox' })).toBe(false);
    expect(valid({ NODE_ENV: 'development', E2E_OTP_OUTBOX_DIR: '/tmp/outbox', DATABASE_URL: remote })).toBe(false);
    expect(valid({ NODE_ENV: 'development', E2E_OTP_OUTBOX_DIR: '/tmp/outbox' })).toBe(true);
    expect(valid({ NODE_ENV: 'test', E2E_OTP_OUTBOX_DIR: '/tmp/outbox', DATABASE_URL: remote })).toBe(true);
  });
  it('PROV-09 the administrator list marks seed mailboxes (recorded or not) and tags operator-issued setup links by purpose', async () => {
    const ids = await freshSeeds();
    // A pre-provenance seed account: same email, provenance removed, so it is a seed mailbox that is not yet recorded.
    await prisma.adminSeedIdentity.delete({ where: { userId: ids['admin2@electrohub.com']! } });
    await authorizeSeedProvisioning(target('admin1@electrohub.com', ids['admin1@electrohub.com']!), approval);
    const other = await prisma.user.create({ data: { email: `prov09-${randomUUID()}@qa.invalid`, firstName: 'Real', lastName: 'Admin',
      passwordHash: await hashPassword(SEED_PASSWORD), roleId: await roleId('ADMIN') } });
    // Searched one by one: earlier suites leave many administrators, so a single page would not reach every row.
    const rows = (await Promise.all([...SEEDS, other.email].map(email => adminTeamService.listAdministrators({ page: 1, pageSize: 10, search: email })))).flatMap(page => page.data);
    const byEmail = (email: string) => rows.find(row => row.email === email)!;
    expect(byEmail('admin1@electrohub.com').seedAccount).toEqual({ recorded: true });
    expect(byEmail('admin1@electrohub.com').mfaActivation).toMatchObject({ status: 'PENDING', purpose: 'SEED_PROVISIONING' });
    expect(byEmail('admin2@electrohub.com').seedAccount).toEqual({ recorded: false });
    expect(byEmail('admin@electrohub.com').seedAccount).toBeNull(); // the primary Owner is never a provisioning target
    expect(byEmail(other.email).seedAccount).toBeNull(); // a real mailbox keeps the emailed activation
  });
});
