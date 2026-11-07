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
 * <ref> must equal the database identity derived from DATABASE_URL (Supabase project ref, or "local" for a loopback cluster), so a
 * command can never run against an environment the operator did not name. Output never contains URLs, hosts or credentials.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { recordAdminAudit } from '../src/services/admin-audit.js';

function targetRef(url: string | undefined): string {
  if (!url) return 'unknown';
  const parsed = new URL(url);
  if (['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) return 'local';
  const fromUser = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(parsed.username))?.[1];
  const fromHost = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname)?.[1];
  return fromUser ?? fromHost ?? 'unknown';
}

async function main() {
  const [command, email] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  const flags = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--')).map(arg => arg.slice(2).split('=') as [string, string]));
  const ref = targetRef(process.env.DATABASE_URL);
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
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('An administrator email is required.');
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
  throw new Error('Unknown command. Use status | authorize-enrollment | grant-owner | reset-mfa.');
}

main().then(() => prisma.$disconnect()).catch(async error => {
  console.error(error instanceof Error ? error.message : 'Command failed.');
  await prisma.$disconnect();
  process.exit(1);
});
