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

import { UserRole, ProductStatus, InventoryStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { prisma, pool } from '../src/lib/prisma';

// ─── Production Safety Gate ──────────────────────────────

if (process.env.NODE_ENV === 'production') {
  console.error(
    '🚫 Seed script cannot run in production. Set NODE_ENV to "development" or "test".'
  );
  process.exit(1);
}

// ─── Development Password Hashing ────────────────────────
// Uses SHA-256 for development seed only. The application will use bcrypt
// for real authentication. These are NOT production credentials.

function devHash(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

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

  // 2. Users
  console.log('  → Users');
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@electrohub.dev' },
    update: {},
    create: {
      email: 'admin@electrohub.dev',
      passwordHash: devHash('admin-dev-password'),
      firstName: 'Admin',
      lastName: 'Dev',
      phone: '+1000000001',
      isActive: true,
      roleId: adminRole.id,
    },
  });

  const customerUser = await prisma.user.upsert({
    where: { email: 'customer@electrohub.dev' },
    update: {},
    create: {
      email: 'customer@electrohub.dev',
      passwordHash: devHash('customer-dev-password'),
      firstName: 'Customer',
      lastName: 'Dev',
      phone: '+1000000002',
      isActive: true,
      roleId: customerRole.id,
    },
  });
  console.log(`    ✓ admin@electrohub.dev (${adminUser.id})`);
  console.log(`    ✓ customer@electrohub.dev (${customerUser.id})`);

  // 3. Categories
  console.log('  → Categories');
  const categories = [
    { name: 'Smartphones', slug: 'smartphones', description: 'Mobile phones and accessories' },
    { name: 'Laptops', slug: 'laptops', description: 'Notebook computers and ultrabooks' },
    { name: 'Tablets', slug: 'tablets', description: 'Tablet computers and e-readers' },
    { name: 'Accessories', slug: 'accessories', description: 'Electronics accessories and peripherals' },
  ];

  const seededCategories: Record<string, string> = {};
  for (const cat of categories) {
    const created = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: {
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        isActive: true,
      },
    });
    seededCategories[cat.slug] = created.id;
    console.log(`    ✓ ${cat.name} (${created.id})`);
  }

  // 4. Products
  console.log('  → Products');
  const products = [
    // Smartphones (2)
    {
      sku: 'EH-SP-001',
      name: 'ProMax Ultra 15',
      slug: 'promax-ultra-15',
      description: 'Flagship smartphone with advanced camera system',
      price: 999.99,
      categorySlug: 'smartphones',
      status: ProductStatus.ACTIVE,
    },
    {
      sku: 'EH-SP-002',
      name: 'Galaxy Nova S24',
      slug: 'galaxy-nova-s24',
      description: 'Premium Android smartphone with AI features',
      price: 849.99,
      categorySlug: 'smartphones',
      status: ProductStatus.ACTIVE,
    },
    // Laptops (2)
    {
      sku: 'EH-LP-001',
      name: 'UltraBook Pro 16',
      slug: 'ultrabook-pro-16',
      description: 'Professional laptop with M-series processor',
      price: 2499.99,
      categorySlug: 'laptops',
      status: ProductStatus.ACTIVE,
    },
    {
      sku: 'EH-LP-002',
      name: 'DevStation X1',
      slug: 'devstation-x1',
      description: 'Developer-focused laptop with Linux support',
      price: 1799.99,
      categorySlug: 'laptops',
      status: ProductStatus.ACTIVE,
    },
    // Tablets (2)
    {
      sku: 'EH-TB-001',
      name: 'AirTab Pro 12.9',
      slug: 'airtab-pro-12-9',
      description: 'Professional tablet with stylus support',
      price: 1099.99,
      categorySlug: 'tablets',
      status: ProductStatus.ACTIVE,
    },
    {
      sku: 'EH-TB-002',
      name: 'Galaxy Tab Ultra',
      slug: 'galaxy-tab-ultra',
      description: 'Android tablet with AMOLED display',
      price: 649.99,
      categorySlug: 'tablets',
      status: ProductStatus.INACTIVE,
    },
    // Accessories (2)
    {
      sku: 'EH-AC-001',
      name: 'ProCharge 65W GaN',
      slug: 'procharge-65w-gan',
      description: 'Compact GaN charger with multiple ports',
      price: 49.99,
      categorySlug: 'accessories',
      status: ProductStatus.ACTIVE,
    },
    {
      sku: 'EH-AC-002',
      name: 'AirBuds Pro Max',
      slug: 'airbuds-pro-max',
      description: 'Wireless noise-cancelling earbuds',
      price: 249.99,
      categorySlug: 'accessories',
      status: ProductStatus.ACTIVE,
    },
  ];

  const seededProducts: Array<{ id: string; sku: string }> = [];
  for (const prod of products) {
    const created = await prisma.product.upsert({
      where: { sku: prod.sku },
      update: {},
      create: {
        sku: prod.sku,
        name: prod.name,
        slug: prod.slug,
        description: prod.description,
        price: prod.price,
        status: prod.status,
        categoryId: seededCategories[prod.categorySlug],
      },
    });
    seededProducts.push({ id: created.id, sku: created.sku });
    console.log(`    ✓ ${prod.name} [${prod.sku}] (${created.id})`);
  }

  // 5. Inventory (one per product, mix of statuses)
  console.log('  → Inventory');
  const inventoryData: Array<{
    productIndex: number;
    quantity: number;
    lowStockAt: number;
    status: InventoryStatus;
  }> = [
    { productIndex: 0, quantity: 50, lowStockAt: 5, status: InventoryStatus.IN_STOCK },
    { productIndex: 1, quantity: 35, lowStockAt: 5, status: InventoryStatus.IN_STOCK },
    { productIndex: 2, quantity: 20, lowStockAt: 5, status: InventoryStatus.IN_STOCK },
    { productIndex: 3, quantity: 3, lowStockAt: 5, status: InventoryStatus.LOW_STOCK },
    { productIndex: 4, quantity: 15, lowStockAt: 5, status: InventoryStatus.IN_STOCK },
    { productIndex: 5, quantity: 0, lowStockAt: 5, status: InventoryStatus.OUT_OF_STOCK },
    { productIndex: 6, quantity: 100, lowStockAt: 10, status: InventoryStatus.IN_STOCK },
    { productIndex: 7, quantity: 4, lowStockAt: 5, status: InventoryStatus.LOW_STOCK },
  ];

  for (const inv of inventoryData) {
    const product = seededProducts[inv.productIndex];
    await prisma.inventory.upsert({
      where: { productId: product.id },
      update: {},
      create: {
        productId: product.id,
        quantity: inv.quantity,
        lowStockAt: inv.lowStockAt,
        status: inv.status,
      },
    });
    console.log(`    ✓ ${product.sku} → qty: ${inv.quantity}, status: ${inv.status}`);
  }

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
    await pool.end();
  });
