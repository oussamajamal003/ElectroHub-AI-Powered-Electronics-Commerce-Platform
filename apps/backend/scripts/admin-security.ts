/**
 * Task 05.2 operator CLI for administrator security bootstrap and recovery. Never exposed over HTTP.
 *
 *   npm run admin:security -- status --confirm-target=<ref>
 *   npm run admin:security -- authorize-enrollment <email> --confirm-target=<ref> [--hours=24]
 *   npm run admin:security -- grant-owner <email> --confirm-target=<ref>        (only while no owner exists: one-time bootstrap)
 *   npm run admin:security -- reset-mfa <email> --confirm-target=<ref>          (lost device: disables factors, revokes sessions,
 *                                                                               opens a fresh enrollment window; operator identity
 *                                                                               check happens out of band and is recorded in the audit)
 *
 * Seeded DEV administrators without a mailbox (admin1–2@electrohub.com). Only on "local" (disposable loopback) or the shared DEV
 * project; production, unknown databases and NODE_ENV=production are refused before any database access. Not email verification
 * and not a production recovery mechanism; see docs/10_Operations/ADMIN_SEED_PROVISIONING_RUNBOOK.md.
 *   npm run admin:security -- seed-status --confirm-target=<ref>
 *   npm run admin:security -- register-seed-identity <email> --user-id=<uuid> --operator=<name> --reason="<why>" --confirm-target=<ref>
 *                                                                               [--supersede-deleted]
 *   npm run admin:security -- provision-seeded-admin <email> --user-id=<uuid> --operator=<name> --tester=<name> --reason="<why>"
 *                                                       --handoff-file=<path outside any git checkout> --confirm-target=<ref> [--minutes=30]
 *   npm run admin:security -- recover-seeded-admin-password <email> --user-id=<uuid> --operator=<name> --tester=<name> --reason="<why>"
 *                                                       --handoff-file=<path outside any git checkout> --confirm-target=<ref> [--minutes=30]
 *                                                       (account must HAVE a factor; replaces only the emailed code, factor still required)
 *   npm run admin:security -- revoke-seed-password-recovery <email> --user-id=<uuid> --operator=<name> --reason="<why>" --confirm-target=<ref>
 *   npm run admin:security -- revoke-seed-provisioning <email> --user-id=<uuid> --operator=<name> --reason="<why>" --confirm-target=<ref>
 *
 * <ref> must equal the database identity derived from DATABASE_URL (Supabase project ref, or "local" for a loopback cluster), so a
 * command can never run against an environment the operator did not name. Output never contains URLs, hosts or credentials.
 */
import 'dotenv/config';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/prisma.js';
import { recordAdminAudit } from '../src/services/admin-audit.js';
import {
  assertProvisioningTarget, authorizeSeedPasswordRecovery, authorizeSeedProvisioning, passwordRecoveryLink, databaseIdentity, provisioningLink, registerSeedIdentity, revokeSeedProvisioning, seedIdentityStatus,
} from '../src/services/admin-seed-provisioning.service.js';

const targetRef = databaseIdentity;
const SEED_COMMANDS = new Set(['seed-status', 'register-seed-identity', 'provision-seeded-admin', 'revoke-seed-provisioning',
  'recover-seeded-admin-password', 'revoke-seed-password-recovery']);

/** The handoff file must not be inside any git checkout (it could be committed) and must not already exist. */
function assertHandoffPath(file: string | undefined): string {
  if (!file) throw new Error('Pass --handoff-file=<path> outside any git checkout for the one-time setup link.');
  const resolved = path.resolve(file);
  for (let dir = path.dirname(resolved); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.git'))) throw new Error('Refusing to write the setup link inside a git checkout. Choose a private folder.');
    if (path.dirname(dir) === dir) break;
  }
  if (existsSync(resolved)) throw new Error('The handoff file already exists. Choose a new path.');
  return resolved;
}

async function main() {
  const [command, email] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  // Split at the FIRST "=" only, so a reason may contain "=".
  const flags: Record<string, string | undefined> = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--'))
    .map(arg => { const body = arg.slice(2); const at = body.indexOf('='); return at < 0 ? [body, 'true'] : [body.slice(0, at), body.slice(at + 1)]; }));
  const ref = targetRef(process.env.DATABASE_URL);
  // Seed provisioning has a stricter, allowlisted target check that runs before any database access.
  if (SEED_COMMANDS.has(command ?? '')) assertProvisioningTarget({ resolved: ref, confirmed: flags['confirm-target'], nodeEnv: process.env.NODE_ENV });
  if (ref === 'unknown' || flags['confirm-target'] !== ref) {
    throw new Error(`Refusing to run: pass --confirm-target=<database identity>. Resolved identity: ${ref}.`);
  }
  console.log(`Target database identity: ${ref}`);

  if (command === 'status') {
    const [admins, owners, enrolled] = await Promise.all([
      prisma.user.count({ where: { role: { name: 'ADMIN' }, isActive: true } }),
      prisma.adminAccountSecurity.count({ where: { isOwner: true, user: { isActive: true } } }),
      prisma.adminAccountSecurity.count({ where: { mfaEnrolledAt: { not: null } } }),
    ]);
    console.log(JSON.stringify({ activeAdmins: admins, activeOwners: owners, mfaEnrolled: enrolled }));
    return;
  }
  if (command === 'seed-status') {
    for (const row of await seedIdentityStatus()) console.log(JSON.stringify(row));
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('An administrator email is required.');
  const seedTarget = { databaseIdentity: ref, email, userId: flags['user-id'] ?? '' };
  const approval = { operator: flags.operator ?? '', reason: flags.reason ?? '' };
  if (command === 'register-seed-identity') {
    const registered = await registerSeedIdentity(seedTarget, { ...approval, supersedeDeleted: flags['supersede-deleted'] === 'true' });
    console.log(`Seed identity registered for ${registered.email} (${registered.userId}).`);
    return;
  }
  if (command === 'provision-seeded-admin') {
    const handoff = assertHandoffPath(flags['handoff-file']);
    const minutes = flags.minutes ? Number(flags.minutes) : undefined;
    const issued = await authorizeSeedProvisioning(seedTarget, { ...approval, tester: flags.tester ?? '', minutes });
    // The link exists only in this file (owner-only where the filesystem supports it); it is never printed or logged.
    const link = provisioningLink(issued.token);
    writeFileSync(handoff, `${link}\n`, { flag: 'wx', mode: 0o600 });
    console.log(`One-time setup link written to ${handoff}. It expires at ${issued.expiresAt.toISOString()}. Hand it to the tester privately, then delete the file.`);
    return;
  }
  if (command === 'revoke-seed-provisioning') {
    const revoked = await revokeSeedProvisioning(seedTarget, approval);
    console.log(`Provisioning ${revoked.provisioningId} revoked.`);
    return;
  }
  if (command === 'recover-seeded-admin-password') {
    const handoff = assertHandoffPath(flags['handoff-file']);
    const minutes = flags.minutes ? Number(flags.minutes) : undefined;
    const issued = await authorizeSeedPasswordRecovery(seedTarget, { ...approval, tester: flags.tester ?? '', minutes });
    writeFileSync(handoff, `${passwordRecoveryLink(issued.token)}
`, { flag: 'wx', mode: 0o600 });
    console.log(`One-time recovery link written to ${handoff}. It expires at ${issued.expiresAt.toISOString()}. The tester still needs their authenticator, a recovery code or a passkey. Delete the file after handing it over.`);
    return;
  }
  if (command === 'revoke-seed-password-recovery') {
    const revoked = await revokeSeedProvisioning(seedTarget, approval, 'PASSWORD_RECOVERY');
    console.log(`Recovery proof ${revoked.provisioningId} revoked.`);
    return;
  }
  const user = await prisma.user.findFirst({ where: { email: email.toLowerCase().trim(), role: { name: 'ADMIN' }, isActive: true }, select: { id: true } });
  if (!user) throw new Error('No active administrator has that email.');

  if (command === 'authorize-enrollment') {
    const hours = Math.min(72, Math.max(1, Number(flags.hours ?? 24)));
    const factors = await prisma.adminMfaFactor.count({ where: { userId: user.id, verifiedAt: { not: null }, disabledAt: null } })
      + await prisma.adminWebAuthnCredential.count({ where: { userId: user.id, revokedAt: null } });
    if (factors > 0) throw new Error('This administrator already has a factor; use reset-mfa for a lost device.');
    const until = new Date(Date.now() + hours * 3600_000);
    await prisma.$transaction(async tx => {
      await tx.adminAccountSecurity.upsert({ where: { userId: user.id }, create: { userId: user.id, enrollmentAllowedUntil: until }, update: { enrollmentAllowedUntil: until } });
      await recordAdminAudit({ actorId: null, action: 'OPERATOR_ENROLLMENT_AUTHORIZED', resourceType: 'admin_user', resourceId: user.id, outcome: 'SUCCESS', details: { hours } }, tx);
    });
    console.log(`Enrollment authorized until ${until.toISOString()}.`);
    return;
  }
  if (command === 'grant-owner') {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('admin_owner_bootstrap'))`;
      if (await tx.adminAccountSecurity.count({ where: { isOwner: true } }) > 0) throw new Error('An owner already exists; bootstrap is closed.');
      await tx.adminAccountSecurity.upsert({ where: { userId: user.id }, create: { userId: user.id, isOwner: true, canManageAdmins: true },
        update: { isOwner: true, canManageAdmins: true } });
      await recordAdminAudit({ actorId: null, action: 'OPERATOR_OWNER_BOOTSTRAP', resourceType: 'admin_user', resourceId: user.id, outcome: 'SUCCESS' }, tx);
    });
    console.log('Owner granted (bootstrap now closed).');
    return;
  }
  if (command === 'reset-mfa') {
    const until = new Date(Date.now() + 24 * 3600_000);
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('user_token_lifecycle'), hashtext(${user.id}))`;
      const now = new Date();
      await tx.adminMfaFactor.updateMany({ where: { userId: user.id, disabledAt: null }, data: { disabledAt: now } });
      await tx.adminWebAuthnCredential.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.adminRecoveryCode.updateMany({ where: { userId: user.id, consumedAt: null, revokedAt: null }, data: { revokedAt: now } });
      await tx.refreshToken.updateMany({ where: { userId: user.id }, data: { isRevoked: true, expiresAt: new Date(0) } });
      await tx.adminSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now, revokedReason: 'OPERATOR_MFA_RESET' } });
      await tx.adminAccountSecurity.upsert({ where: { userId: user.id }, create: { userId: user.id, enrollmentAllowedUntil: until },
        update: { enrollmentAllowedUntil: until, mfaEnrolledAt: null } });
      await tx.securityEvent.create({ data: { userId: user.id, type: 'ADMIN_MFA_DISABLED' } });
      await recordAdminAudit({ actorId: null, action: 'OPERATOR_MFA_RESET', resourceType: 'admin_user', resourceId: user.id, outcome: 'SUCCESS' }, tx);
    });
    console.log(`MFA reset; re-enrollment allowed until ${until.toISOString()}.`);
    return;
  }
  throw new Error('Unknown command. Use status | authorize-enrollment | grant-owner | reset-mfa | seed-status | register-seed-identity | provision-seeded-admin | revoke-seed-provisioning | recover-seeded-admin-password | revoke-seed-password-recovery.');
}

main().then(() => prisma.$disconnect()).catch(async error => {
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? `[${error.code}] ` : '';
  console.error(`${code}${error instanceof Error ? error.message : 'Command failed.'}`);
  await prisma.$disconnect();
  process.exit(1);
});
