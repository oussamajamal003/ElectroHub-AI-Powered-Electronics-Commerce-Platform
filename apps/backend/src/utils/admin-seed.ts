import bcrypt from 'bcrypt';
import type { PrismaClient } from '@prisma/client';

/**
 * Development administrator accounts. Seeding only ever CREATES a missing account: an existing administrator keeps its password,
 * active flag, role, owner/management capabilities, MFA enrollment and any activation state, so a re-run can neither reset a
 * credential nor reactivate a deliberately deactivated account. Seeded accounts get no enrollment window; a factor-less one is
 * activated by an Owner (email proof + new password + MFA).
 */
export const SEED_ADMIN_EMAILS = [
  'admin@electrohub.com',
  'admin1@electrohub.com',
  'admin2@electrohub.com',
  'admin3@electrohub.com',
  'admin4@electrohub.com',
];

export async function seedAdministrators(client: PrismaClient, input: { adminRoleId: string; passwordFor: (index: number) => string }) {
  const created: string[] = [];
  for (let i = 0; i < SEED_ADMIN_EMAILS.length; i++) {
    const email = SEED_ADMIN_EMAILS[i]!;
    if (await client.user.findUnique({ where: { email }, select: { id: true } })) continue;
    const passwordHash = await bcrypt.hash(input.passwordFor(i), 12);
    await client.user.create({ data: { email, passwordHash, firstName: i === 0 ? 'Admin' : `Admin${i}`, lastName: 'ElectroHub',
      isActive: true, emailVerifiedAt: new Date(), roleId: input.adminRoleId } });
    created.push(email);
  }
  return created;
}
