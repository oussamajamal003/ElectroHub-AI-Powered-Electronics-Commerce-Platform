import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma.js';

const BACKEND_ROLE = 'qa_admin_email_change_backend';
const PUBLIC_ROLES = ['anon', 'authenticated'] as const;
const createdUserIds: string[] = [];

describe.skipIf(process.env.ADMIN_SECURITY_PG_RUN !== '1').sequential('administrator email-change RLS on disposable PostgreSQL', { timeout: 60000 }, () => {
  beforeAll(async () => {
    const host = new URL(process.env.DATABASE_URL!).hostname;
    if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('Refusing to run against a non-loopback database.');

    await prisma.$executeRawUnsafe(`DO $roles$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'CREATE ROLE anon NOLOGIN'; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'CREATE ROLE authenticated NOLOGIN'; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${BACKEND_ROLE}') THEN
          EXECUTE 'CREATE ROLE ${BACKEND_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS';
        END IF;
      END
      $roles$;`);
    await prisma.$executeRawUnsafe(`ALTER ROLE ${BACKEND_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS`);
    await prisma.$executeRawUnsafe(`GRANT USAGE, CREATE ON SCHEMA public TO ${BACKEND_ROLE}`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.admin_email_change_authorizations OWNER TO ${BACKEND_ROLE}`);
    await prisma.$executeRawUnsafe(`REVOKE CREATE ON SCHEMA public FROM ${BACKEND_ROLE}`);
  });

  afterAll(async () => {
    for (const userId of createdUserIds) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('enables policy-free RLS, denies public roles every table privilege, and preserves the trusted backend path', async () => {
    const state = await prisma.$queryRaw<Array<{
      rls: boolean; forced: boolean; owner: string; bypass: boolean; superuser: boolean; policies: bigint; publicAcl: bigint;
    }>>`
      SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced, owner.rolname::text AS owner,
        backend.rolbypassrls AS bypass, backend.rolsuper AS superuser,
        (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'admin_email_change_authorizations') AS policies,
        (SELECT count(*) FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) WHERE grantee = 0) AS "publicAcl"
      FROM pg_class c JOIN pg_roles owner ON owner.oid = c.relowner JOIN pg_roles backend ON backend.rolname = ${BACKEND_ROLE}
      WHERE c.oid = 'public.admin_email_change_authorizations'::regclass`;
    expect(state[0]).toMatchObject({ rls: true, forced: false, owner: BACKEND_ROLE, bypass: true, superuser: false, policies: 0n, publicAcl: 0n });
    const columnGrants = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM information_schema.column_privileges
      WHERE table_schema = 'public' AND table_name = 'admin_email_change_authorizations'
        AND grantee IN ('anon','authenticated','PUBLIC')`;
    expect(columnGrants[0].count).toBe(0n);

    for (const role of PUBLIC_ROLES) {
      const privileges = await prisma.$queryRaw<Array<{ privilege: string; allowed: boolean }>>`
        SELECT privilege, has_table_privilege(${role}, 'public.admin_email_change_authorizations', privilege) AS allowed
        FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES']) AS privilege`;
      expect(privileges.every(item => !item.allowed), `${role} must have no table privileges`).toBe(true);

      for (const statement of [
        'SELECT * FROM public.admin_email_change_authorizations',
        `INSERT INTO public.admin_email_change_authorizations ("userId","currentEmail","targetEmail","sessionFamilyId","credentialFingerprint","securityFingerprint","stepUpAt","expiresAt","resendAvailableAt","updatedAt") VALUES ('00000000-0000-4000-8000-000000000001','old@qa.invalid','new@qa.invalid','00000000-0000-4000-8000-000000000002','${'a'.repeat(64)}','${'b'.repeat(64)}',now(),now(),now(),now())`,
        'UPDATE public.admin_email_change_authorizations SET "consumedAt" = now()',
        'DELETE FROM public.admin_email_change_authorizations',
        'TRUNCATE public.admin_email_change_authorizations',
      ]) {
        await expect(prisma.$transaction(async tx => {
          await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
          return statement.startsWith('SELECT') ? tx.$queryRawUnsafe(statement) : tx.$executeRawUnsafe(statement);
        })).rejects.toThrow(/permission denied/i);
      }
    }

    const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    const user = await prisma.user.create({ data: { email: `rls-${randomUUID()}@qa.invalid`, passwordHash: 'not-used',
      firstName: 'RLS', lastName: 'QA', roleId: adminRole.id, emailVerifiedAt: new Date() }, select: { id: true, email: true } });
    createdUserIds.push(user.id);
    const sessionFamilyId = randomUUID();
    const inserted = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${BACKEND_ROLE}`);
      const role = await tx.$queryRaw<Array<{ currentRole: string; bypass: boolean; owner: boolean }>>`
        SELECT current_user::text AS "currentRole", r.rolbypassrls AS bypass,
          c.relowner = r.oid AS owner
        FROM pg_roles r CROSS JOIN pg_class c
        WHERE r.rolname = current_user AND c.oid = 'public.admin_email_change_authorizations'::regclass`;
      expect(role[0]).toEqual({ currentRole: BACKEND_ROLE, bypass: true, owner: true });
      await tx.$executeRaw`
        INSERT INTO public.admin_email_change_authorizations
          ("userId","currentEmail","targetEmail","sessionFamilyId","credentialFingerprint","securityFingerprint","stepUpAt","expiresAt","resendAvailableAt","updatedAt")
        VALUES (${user.id}::uuid, ${user.email}, 'new@qa.invalid', ${sessionFamilyId}::uuid, ${'a'.repeat(64)}, ${'b'.repeat(64)}, now(), now(), now(), now())`;
      const visible = await tx.$queryRaw<Array<{ targetEmail: string }>>`
        SELECT "targetEmail" FROM public.admin_email_change_authorizations WHERE "userId" = ${user.id}::uuid`;
      const updated = await tx.$executeRaw`UPDATE public.admin_email_change_authorizations SET "consumedAt" = now() WHERE "userId" = ${user.id}::uuid`;
      const deleted = await tx.$executeRaw`DELETE FROM public.admin_email_change_authorizations WHERE "userId" = ${user.id}::uuid`;
      return { visible, updated, deleted };
    });
    expect(inserted).toEqual({ visible: [{ targetEmail: 'new@qa.invalid' }], updated: 1, deleted: 1 });
  });
});
