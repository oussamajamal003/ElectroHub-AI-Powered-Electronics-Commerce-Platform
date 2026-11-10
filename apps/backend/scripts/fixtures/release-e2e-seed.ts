/**
 * Task 06.1 release-critical E2E fixtures. Run only by scripts/release-e2e-stack.cjs against its verified disposable loopback database.
 *
 * Synthetic `*.release.invalid` identities and `REL-` catalog rows only. Re-runnable on the same disposable database: fixture accounts,
 * products and stock are reset to a known state on every stack start, and each start adds one fresh paid order per shopper so order,
 * document and tracking journeys never depend on state left by an earlier run. Every delete below is scoped to the fixture identities.
 * Writes the per-run synthetic credentials file the specs read (git-ignored); prints nothing secret.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { prisma } from '../../src/lib/prisma.js';
import { hashPassword } from '../../src/utils/hash.js';

const target = new URL(process.env.DATABASE_URL!);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !/^electrohub_(?:disposable|ci)[a-z0-9_]*$/.test(target.pathname.slice(1))) {
  throw new Error('Refusing to seed: the release E2E fixtures only target a verified disposable loopback database.');
}
const out = process.argv[2];
if (!out) throw new Error('usage: release-e2e-seed.ts <fixtures.json>');
const day = 86_400_000;

/** One isolated shopper per Playwright project, so parallel browser projects never share a cart, wishlist or order. */
export const SHOPPER_SLOTS = ['chromium', 'firefox', 'webkit', 'mobile', 'tablet', 'wide', 'journey'] as const;
/** Spec families that may run in parallel workers within one project get separate shoppers too (`<slot>-<family>`). */
export const SHOPPER_FAMILIES = ['auth', 'cart', 'checkout', 'orders', 'admin'] as const;
const shopperEmail = (slot: string) => `shopper-${slot}@release.invalid`;
const OUTSIDER = 'outsider@release.invalid';
const ownerEmail = (slot: string) => `owner-${slot}@release.invalid`;
const staffEmail = (slot: string) => `staff-${slot}@release.invalid`;

const catalog = [
  { sku: 'REL-AURORA-HP', name: 'Aurora Studio Headphones', category: 'audio', price: '249.00', quantity: 40,
    description: 'Closed-back studio headphones with adaptive noise cancelling.', specs: [['Audio', 'Driver', '40 mm dynamic'], ['Battery', 'Playback', '30 hours']] },
  { sku: 'REL-PULSE-EB', name: 'Pulse Mini Earbuds', category: 'audio', price: '79.00', quantity: 2,
    description: 'Compact wireless earbuds with a pocketable charging case.', specs: [['Audio', 'Driver', '10 mm'], ['Battery', 'Playback', '8 hours']] },
  { sku: 'REL-ECHO-SPK', name: 'Echo Monitor Speakers', category: 'audio', price: '399.00', quantity: 0,
    description: 'Active bookshelf monitors for desktop production.', specs: [['Audio', 'Woofer', '5 inch']] },
  { sku: 'REL-NIMBUS-14', name: 'Nimbus 14 Ultrabook', category: 'laptops', price: '1299.00', quantity: 12,
    description: 'A 14-inch ultrabook with an all-day battery.', specs: [['Display', 'Size', '14 inch'], ['Memory', 'RAM', '16 GB']] },
  { sku: 'REL-VECTOR-16', name: 'Vector 16 Creator Laptop', category: 'laptops', price: '1899.00', quantity: 7,
    description: 'A 16-inch creator laptop with a dedicated GPU.', specs: [['Display', 'Size', '16 inch'], ['Memory', 'RAM', '32 GB']] },
  { sku: 'REL-ATLAS-DOCK', name: 'Atlas USB-C Dock', category: 'laptops', price: '89.00', quantity: 25,
    description: 'A twelve-port USB-C docking station.', specs: [['Connectivity', 'Ports', '12']] },
] as const;

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const inventoryStatus = (quantity: number) => quantity === 0 ? 'OUT_OF_STOCK' as const : quantity <= 5 ? 'LOW_STOCK' as const : 'IN_STOCK' as const;

async function upsertUser(email: string, roleId: string, passwordHash: string, firstName: string, lastName: string) {
  return prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, firstName, lastName, roleId, emailVerifiedAt: new Date(), isActive: true },
    update: { passwordHash, firstName, lastName, roleId, emailVerifiedAt: new Date(), isActive: true },
  });
}

async function main() {
  const adminRole = await prisma.role.upsert({ where: { name: 'ADMIN' }, create: { name: 'ADMIN' }, update: {} });
  const customerRole = await prisma.role.upsert({ where: { name: 'CUSTOMER' }, create: { name: 'CUSTOMER' }, update: {} });
  // A fresh synthetic password per stack start; it exists only in the git-ignored fixtures file of this run.
  const password = `Rel-${randomUUID().slice(0, 8)}-Pass9`;
  const passwordHash = await hashPassword(password);

  // Administrators: per browser project an Owner and a non-Owner staff member (so parallel projects never race one MFA enrollment),
  // each with a fresh mandatory TOTP enrollment window. Earlier factors, recovery codes, passkeys, challenges and sessions of these
  // fixture accounts only are removed so enrollment starts clean.
  const admins: Record<string, { ownerEmail: string; staffEmail: string }> = {};
  const adminUsers: { id: string; isOwner: boolean }[] = [];
  for (const slot of SHOPPER_SLOTS) {
    const owner = await upsertUser(ownerEmail(slot), adminRole.id, passwordHash, 'Olive', `Owner ${slot}`);
    const staff = await upsertUser(staffEmail(slot), adminRole.id, passwordHash, 'Stan', `Staff ${slot}`);
    adminUsers.push({ id: owner.id, isOwner: true }, { id: staff.id, isOwner: false });
    admins[slot] = { ownerEmail: owner.email, staffEmail: staff.email };
  }
  const adminIds = adminUsers.map(user => user.id);
  await prisma.adminRecoveryCode.deleteMany({ where: { userId: { in: adminIds } } });
  await prisma.adminMfaFactor.deleteMany({ where: { userId: { in: adminIds } } });
  await prisma.adminWebAuthnCredential.deleteMany({ where: { userId: { in: adminIds } } });
  await prisma.adminAuthChallenge.deleteMany({ where: { userId: { in: adminIds } } });
  await prisma.adminSession.updateMany({ where: { userId: { in: adminIds }, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'release-e2e-reseed' } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: adminIds } } });
  for (const { id, isOwner } of adminUsers) {
    const window = { isOwner, canManageAdmins: isOwner, enrollmentAllowedUntil: new Date(Date.now() + day), mfaEnrolledAt: null };
    await prisma.adminAccountSecurity.upsert({ where: { userId: id }, create: { userId: id, ...window }, update: window });
  }

  // Catalog.
  const categories = new Map<string, string>();
  for (const [key, name] of [['audio', 'Release Audio'], ['laptops', 'Release Laptops']] as const) {
    const slug = `release-${key}`;
    const saved = await prisma.category.upsert({ where: { slug }, create: { name, slug, isActive: true }, update: { name, isActive: true } });
    categories.set(key, saved.id);
  }
  const products = [];
  for (const item of catalog) {
    const slug = slugify(item.name);
    const data = { name: item.name, slug, description: item.description, price: item.price, status: 'ACTIVE' as const, storefrontVisible: true,
      isTestFixture: false, categoryId: categories.get(item.category)! };
    const product = await prisma.product.upsert({ where: { sku: item.sku }, create: { sku: item.sku, ...data }, update: data });
    const stock = { quantity: item.quantity, lowStockAt: 5, status: inventoryStatus(item.quantity) };
    await prisma.inventory.upsert({ where: { productId: product.id }, create: { productId: product.id, ...stock }, update: stock });
    await prisma.productSpecification.deleteMany({ where: { productId: product.id } });
    await prisma.productSpecification.createMany({ data: item.specs.map(([group, name, value], sortOrder) => ({ productId: product.id, group, name, value, sortOrder })) });
    products.push({ ...product, quantity: item.quantity });
  }

  // Customers: one isolated shopper per browser project plus an outsider used for cross-user isolation checks. Each start empties the
  // fixture shoppers' carts and wishlists and adds one fresh paid, CONFIRMED order per shopper.
  // No Delivery row is written: production only creates one through "Start tracking" (revision 1 + TRACKING_STARTED event), and a
  // hand-made revision-0 row is a state the product never produces (the update API rightly rejects expectedRevision 0).
  const shoppers: Record<string, { email: string; orderReference: string; orderId: string }> = {};
  const [headphones, dock] = [products[0], products[5]];
  const shopperKeys = SHOPPER_SLOTS.flatMap(slot => SHOPPER_FAMILIES.map(family => `${slot}-${family}`));
  for (const slot of [...shopperKeys, 'outsider']) {
    const email = slot === 'outsider' ? OUTSIDER : shopperEmail(slot);
    const user = await upsertUser(email, customerRole.id, passwordHash, 'Release', slot === 'outsider' ? 'Outsider' : `Shopper ${slot}`);
    await prisma.cartItem.deleteMany({ where: { cart: { userId: user.id } } });
    await prisma.wishlistItem.deleteMany({ where: { wishlist: { userId: user.id } } });
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    const lines = [{ product: headphones, quantity: 1 }, { product: dock, quantity: 2 }];
    const subtotal = lines.reduce((sum, line) => sum + Number(line.product.price) * line.quantity, 0);
    const placed = new Date(Date.now() - 2 * day);
    const order = await prisma.order.create({ data: {
      userId: user.id, status: 'CONFIRMED', subtotal: subtotal.toFixed(2), shippingCost: '0.00', total: subtotal.toFixed(2),
      checkoutAttemptId: randomUUID(), checkoutRequestHash: 'r'.repeat(64), deliveryMethod: 'STANDARD', paymentMethod: 'CARD',
      shippingPhone: '+15550100000', estimatedDeliveryStart: new Date(Date.now() + 2 * day), estimatedDeliveryEnd: new Date(Date.now() + 5 * day),
      shippingRecipient: `Release ${slot}`, shippingLine1: '100 Release Way', shippingCity: 'Austin', shippingState: 'TX', shippingPostalCode: '73301',
      shippingCountry: 'US', createdAt: placed,
      items: { create: lines.map(line => ({ productId: line.product.id, productName: line.product.name, sku: line.product.sku, unitPrice: line.product.price,
        quantity: line.quantity, lineTotal: (Number(line.product.price) * line.quantity).toFixed(2) })) },
      payment: { create: { status: 'SUCCEEDED', amount: subtotal.toFixed(2), paidAt: placed, providerPaymentId: `pi_release_${randomUUID().replace(/-/g, '')}`, cardBrand: 'visa' } },
    } });
    shoppers[slot] = { email, orderId: order.id, orderReference: `ORD-${order.id.toUpperCase()}` };
  }

  writeFileSync(out, JSON.stringify({
    password, admins, outsider: shoppers.outsider, shoppers,
    products: products.map(product => ({ id: product.id, sku: product.sku, name: product.name, slug: product.slug, price: Number(product.price), quantity: product.quantity })),
  }, null, 2), { mode: 0o600 });
  console.log(`release-e2e-seed: ${products.length} products, ${Object.keys(shoppers).length} customers, ${adminIds.length} administrators`);
}

main().then(() => prisma.$disconnect()).catch(async error => {
  console.error(`release-e2e-seed failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  await prisma.$disconnect();
  process.exit(1);
});
