/**
 * ElectroHub — Prisma Seed Script
 * TASK 02.2 — Database Foundation
 *
 * Deterministic, idempotent seed for development/test environments.
 * Uses upsert operations with stable unique identifiers to prevent duplicates.
 *
 * Safety:
 * - Refuses to run in production (NODE_ENV === 'production')
 * - Uses development-only hashed passwords (never real credentials)
 * - Creates only minimal foundation data required by the 02.2 schema
 *
 * Usage:
 *   npx prisma db seed
 */

import { UserRole } from '@prisma/client';
import { assertDevSeedTarget, isDisposableSeedTarget, seedProductDataset } from './product-seed';
import { randomBytes } from 'node:crypto';
import { seedAdministrators } from '../src/utils/admin-seed';
import { seedReviewDataset } from './review-seed';
import bcrypt from 'bcrypt';
import { prisma } from '../src/lib/prisma';

// ─── Production Safety Gate ──────────────────────────────

if (process.env.NODE_ENV === 'production') {
  console.error(
    '🚫 Seed script cannot run in production. Set NODE_ENV to "development" or "test".'
  );
  process.exit(1);
}

assertDevSeedTarget(process.env);

// ─── Development Credentials Configuration ───────────────
// Uses secure bcrypt hashing (SALT_ROUNDS = 12) for local dev/testing.
// Never log passwords or password hashes.

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@electrohub.com').toLowerCase().trim();
// A public fallback password is only ever acceptable inside a verified disposable database. Shared DEV administrators are created with an
// unguessable password nobody holds, so they cannot sign in until an Owner activates them (email proof + new password + MFA).
const DISPOSABLE_TARGET = isDisposableSeedTarget(process.env);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (DISPOSABLE_TARGET ? 'admin123!' : randomBytes(24).toString('base64url'));
const CUSTOMER_EMAIL = (process.env.CUSTOMER_EMAIL || 'customer@electrohub.com').toLowerCase().trim();
const CUSTOMER_PASSWORD = process.env.CUSTOMER_PASSWORD || 'customer123!';

// ─── Seed Data ───────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding ElectroHub database...\n');

  // 1. Roles
  console.log('  → Roles');
  const adminRole = await prisma.role.upsert({
    where: { name: UserRole.ADMIN },
    update: {},
    create: {
      name: UserRole.ADMIN,
      description: 'Administrator with full platform access',
    },
  });

  const customerRole = await prisma.role.upsert({
    where: { name: UserRole.CUSTOMER },
    update: {},
    create: {
      name: UserRole.CUSTOMER,
      description: 'Standard customer account',
    },
  });
  console.log(`    ✓ ADMIN (${adminRole.id})`);
  console.log(`    ✓ CUSTOMER (${customerRole.id})`);

  // Clean up any legacy dev emails to guarantee exactly ONE controlled administrator
  if (ADMIN_EMAIL !== 'admin@electrohub.dev') {
    await prisma.user.deleteMany({
      where: { email: 'admin@electrohub.dev' },
    });
  }
  if (CUSTOMER_EMAIL !== 'customer@electrohub.dev') {
    await prisma.user.deleteMany({
      where: { email: 'customer@electrohub.dev' },
    });
  }

  // 2. Users (Bcrypt hashed)
  console.log('  → Users');
  // Existing administrators are never modified (see src/utils/admin-seed.ts).
  const createdAdmins = await seedAdministrators(prisma, {
    adminRoleId: adminRole.id,
    passwordFor: index => process.env[`ADMIN${index === 0 ? '' : index}_PASSWORD`] || ADMIN_PASSWORD,
  });
  console.log(`    ✓ Administrators: ${createdAdmins.length} created, existing accounts left untouched`);

  const customerPasswordHash = await bcrypt.hash(CUSTOMER_PASSWORD, 12);
  const customerUser = await prisma.user.upsert({
    where: { email: CUSTOMER_EMAIL },
    update: {
      passwordHash: customerPasswordHash,
      roleId: customerRole.id,
      isActive: true,
      emailVerifiedAt: new Date(),
    },
    create: {
      email: CUSTOMER_EMAIL,
      passwordHash: customerPasswordHash,
      firstName: 'Customer',
      lastName: 'Dev',
      isActive: true,
      emailVerifiedAt: new Date(),
      roleId: customerRole.id,
    },
  });
  console.log(`    ✓ Customer: ${CUSTOMER_EMAIL} (${customerUser.id})`);

  const productCounts = await seedProductDataset(prisma);
  console.log('    Curated product dataset:', productCounts);
  const reviewCounts = await seedReviewDataset(prisma, customerRole.id);
  console.log('    Synthetic review dataset:', reviewCounts);

  console.log('\n✅ Seed completed successfully.\n');

  // Summary
  const counts = {
    roles: await prisma.role.count(),
    users: await prisma.user.count(),
    categories: await prisma.category.count(),
    products: await prisma.product.count(),
    inventory: await prisma.inventory.count(),
  };

  console.log('📊 Database summary:');
  console.log(`   Roles:      ${counts.roles}`);
  console.log(`   Users:      ${counts.users}`);
  console.log(`   Categories: ${counts.categories}`);
  console.log(`   Products:   ${counts.products}`);
  console.log(`   Inventory:  ${counts.inventory}`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
