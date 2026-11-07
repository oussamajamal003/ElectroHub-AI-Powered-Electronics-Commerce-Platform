import bcrypt from 'bcrypt';
import type { PrismaClient } from '@prisma/client';

/**
 * Development administrator accounts. Seeding only ever CREATES a missing account: an existing administrator keeps its password,
 * active flag, role, owner/management capabilities, MFA enrollment and any activation state, so a re-run can neither reset a
 * credential nor reactivate a deliberately deactivated account. Seeded accounts get no enrollment window; a factor-less one is
 * activated by an Owner (email proof + new password + MFA).
 *
 * Provenance: an account this seed CREATES is recorded in admin_seed_identities by its user id, in the same write. Nothing is
 * recorded for an existing account (it may not be the original seed identity), and a recreated account whose seed email already
 * has a provenance row (the original was deleted) gets none, so it can never be mistaken for the seeded identity.
 */
export const SEED_ADMIN_EMAILS = [
  'admin@electrohub.com',
  'admin1@electrohub.com',
  'admin2@electrohub.com',
  'admin3@electrohub.com',
  'admin4@electrohub.com',
];

/** Seed identities an operator may provision without a mailbox. The primary Owner seed (admin@electrohub.com) is never one. */
export const PROVISIONABLE_SEED_EMAILS = SEED_ADMIN_EMAILS.filter(email => email !== 'admin@electrohub.com');

export async function seedAdministrators(client: PrismaClient, input: { adminRoleId: string; passwordFor: (index: number) => string }) {
  const created: string[] = [];
  for (let i = 0; i < SEED_ADMIN_EMAILS.length; i++) {
    const email = SEED_ADMIN_EMAILS[i]!;
    if (await client.user.findUnique({ where: { email }, select: { id: true } })) continue;
    const passwordHash = await bcrypt.hash(input.passwordFor(i), 12);
    const provenanceTaken = await client.adminSeedIdentity.findUnique({ where: { seedEmail: email }, select: { userId: true } });
    await client.user.create({ data: { email, passwordHash, firstName: i === 0 ? 'Admin' : `Admin${i}`, lastName: 'ElectroHub',
      isActive: true, emailVerifiedAt: new Date(), roleId: input.adminRoleId,
      ...(provenanceTaken ? {} : { adminSeedIdentity: { create: { seedEmail: email, source: 'SEED' } } }) } });
    created.push(email);
  }
  return created;
}
