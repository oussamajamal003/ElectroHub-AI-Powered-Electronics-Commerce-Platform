/**
 * Task 05.2 disposable browser-QA fixtures (run only by scripts/task05-2-browser-stack.cjs against its own loopback cluster).
 * Synthetic *.invalid identities and QA products; prints nothing secret beyond the disposable test credentials file it writes.
 */
import { randomUUID, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { prisma } from '../../src/lib/prisma.js';
import { hashPassword } from '../../src/utils/hash.js';

const host = new URL(process.env.DATABASE_URL!).hostname;
if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('Refusing to seed a non-loopback database.');
const out = process.argv[2];
const day = 86_400_000;

async function main() {
  const adminRole = await prisma.role.upsert({ where: { name: 'ADMIN' }, create: { name: 'ADMIN' }, update: {} });
  const customerRole = await prisma.role.upsert({ where: { name: 'CUSTOMER' }, create: { name: 'CUSTOMER' }, update: {} });
  const password = `Qa-${randomUUID().slice(0, 8)}-Pass9`;
  const passwordHash = await hashPassword(password);
  const owner = await prisma.user.create({ data: { email: 'owner@qa.invalid', passwordHash, firstName: 'Olivia', lastName: 'Owner', roleId: adminRole.id, emailVerifiedAt: new Date() } });
  await prisma.adminAccountSecurity.create({ data: { userId: owner.id, isOwner: true, canManageAdmins: true, enrollmentAllowedUntil: new Date(Date.now() + day) } });
  const staff = await prisma.user.create({ data: { email: 'staff@qa.invalid', passwordHash, firstName: 'Sam', lastName: 'Staff', roleId: adminRole.id, emailVerifiedAt: new Date() } });
  await prisma.adminAccountSecurity.create({ data: { userId: staff.id, enrollmentAllowedUntil: new Date(Date.now() + day) } });
  const customers = [];
  for (let index = 0; index < 6; index++) {
    customers.push(await prisma.user.create({ data: { email: `shopper${index}@qa.invalid`, passwordHash, firstName: 'Shopper', lastName: String(index), roleId: customerRole.id,
      emailVerifiedAt: new Date(), createdAt: new Date(Date.now() - index * 9 * day) } }));
  }
  await prisma.recommendationPreference.create({ data: { userId: customers[0].id, personalizationEnabled: true, consentedAt: new Date() } });

  const audio = await prisma.category.create({ data: { name: 'QA Audio', slug: 'qa-audio' } });
  const laptops = await prisma.category.create({ data: { name: 'QA Laptops', slug: 'qa-laptops' } });
  const catalog = [
    ['Aurora Noise-Cancelling Headphones', audio.id, '249.00', 40], ['Pulse Wireless Earbuds', audio.id, '129.00', 3], ['Studio Monitor Speakers', audio.id, '399.00', 0],
    ['Nimbus 14 Ultrabook', laptops.id, '1299.00', 12], ['Vector 16 Creator Laptop', laptops.id, '1899.00', 7], ['Atlas Travel Dock', laptops.id, '89.00', 25],
  ] as const;
  const products = [];
  for (const [name, categoryId, price, quantity] of catalog) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    products.push(await prisma.product.create({ data: { categoryId, sku: `QA-${slug.slice(0, 20)}`, name, slug, price, status: 'ACTIVE', storefrontVisible: true,
      isTestFixture: false, inventory: { create: { quantity, lowStockAt: 5, status: quantity === 0 ? 'OUT_OF_STOCK' : quantity <= 5 ? 'LOW_STOCK' : 'IN_STOCK' } } } }));
  }
  // Paid history across 12 months; one refunded and one failed payment that analytics must exclude.
  for (let index = 0; index < 28; index++) {
    const product = products[index % products.length];
    const quantity = 1 + (index % 2);
    const amount = (Number(product.price) * quantity).toFixed(2);
    const placed = new Date(Date.now() - (index * 11 % 330) * day - 3600_000);
    const order = await prisma.order.create({ data: { userId: customers[index % customers.length].id, status: index % 4 === 0 ? 'DELIVERED' : 'CONFIRMED',
      subtotal: amount, total: amount, checkoutAttemptId: randomUUID(), checkoutRequestHash: 'c'.repeat(64), deliveryMethod: 'STANDARD', paymentMethod: 'CARD',
      shippingPhone: '+10000000000', estimatedDeliveryStart: new Date(), estimatedDeliveryEnd: new Date(), shippingRecipient: 'QA Shopper', shippingLine1: '1 QA Street',
      shippingCity: 'QA City', shippingCountry: 'US', createdAt: placed } });
    await prisma.orderItem.create({ data: { orderId: order.id, productId: product.id, productName: product.name, sku: product.sku, unitPrice: product.price, quantity, lineTotal: amount } });
    const status = index === 5 ? 'REFUNDED' : index === 6 ? 'FAILED' : 'SUCCEEDED';
    await prisma.payment.create({ data: { orderId: order.id, status, amount, paidAt: status === 'FAILED' ? null : placed, providerPaymentId: `qa_${randomUUID()}`,
      refundedAt: status === 'REFUNDED' ? new Date() : null } });
  }
  for (let index = 0; index < 40; index++) {
    const batchId = randomUUID();
    const product = products[index % 4];
    await prisma.recommendationEvent.create({ data: { batchId, productId: product.id, eventType: 'IMPRESSION', mode: 'POPULAR_PRODUCTS', strategy: 'MEASURED_POPULARITY', surface: 'home', rank: 1, occurredAt: new Date(Date.now() - (index % 25) * day) } });
    if (index % 5 === 0) await prisma.recommendationEvent.create({ data: { batchId, productId: product.id, eventType: 'CLICK', mode: 'POPULAR_PRODUCTS', strategy: 'MEASURED_POPULARITY', surface: 'home', rank: 1, occurredAt: new Date(Date.now() - (index % 25) * day) } });
  }
  for (let index = 0; index < 18; index++) {
    const correlationId = randomUUID();
    const failed = index % 9 === 0;
    await prisma.analyticsEvent.create({ data: { type: failed ? 'image_search.failed' : 'image_search.completed', source: 'SERVER', outcome: failed ? 'AI_UNAVAILABLE' : index % 6 === 0 ? 'NO_RESULTS' : 'COMPLETED',
      correlationId, resultCount: failed ? null : index % 6 === 0 ? 0 : 6, durationMs: 300 + index * 40, idempotencyKey: `isr:${correlationId}`, occurredAt: new Date(Date.now() - (index % 20) * day) } });
  }
  const invitationToken = `qa-invitation-${randomUUID()}`;
  await prisma.adminInvitation.create({ data: { email: 'newhire@qa.invalid', tokenHash: createHash('sha256').update(invitationToken).digest('hex'), invitedById: owner.id,
    expiresAt: new Date(Date.now() + 3 * day), deliveryStatus: 'SENT', sendCount: 1, lastSentAt: new Date() } });
  // A separate pending row is old enough to exercise resend without weakening the production cooldown. Its token is never issued to a browser.
  const resendToken = `qa-resend-${randomUUID()}`;
  await prisma.adminInvitation.create({ data: { email: 'resendable@qa.invalid', tokenHash: createHash('sha256').update(resendToken).digest('hex'), invitedById: owner.id,
    expiresAt: new Date(Date.now() + 3 * day), deliveryStatus: 'SENT', sendCount: 1, lastSentAt: new Date(Date.now() - 2 * 60_000) } });
  // Existing factor-less administrators (no MFA, no enrollment window), as left behind by development seeding.
  const legacy = async (email: string, firstName: string) => prisma.user.create({ data: { email, passwordHash, firstName, lastName: 'Legacy', roleId: adminRole.id, emailVerifiedAt: new Date() } });
  await legacy('legacy-delivery@qa.invalid', 'Dana');
  const linked = await legacy('legacy-linked@qa.invalid', 'Lee');
  await legacy('legacy-unactivated@qa.invalid', 'Uma');
  // A pending Owner-authorized activation whose single-use token exists only in the git-ignored credentials file.
  const activationToken = `qa-activation-${randomUUID()}`;
  await prisma.adminMfaActivation.create({ data: { userId: linked.id, authorizedById: owner.id, email: linked.email, tokenHash: createHash('sha256').update(activationToken).digest('hex'),
    expiresAt: new Date(Date.now() + 25 * 60_000), deliveryStatus: 'SENT', sendCount: 1, lastSentAt: new Date() } });
  writeFileSync(out, JSON.stringify({ ownerEmail: owner.email, staffEmail: staff.email, customerEmail: customers[0].email, password, invitationToken,
    activationToken, legacyDeliveryEmail: 'legacy-delivery@qa.invalid', legacyLinkedEmail: linked.email, legacyUnactivatedEmail: 'legacy-unactivated@qa.invalid' }, null, 2));
}

main().then(() => prisma.$disconnect()).catch(async error => { console.error(error instanceof Error ? error.message : 'seed failed'); await prisma.$disconnect(); process.exit(1); });
