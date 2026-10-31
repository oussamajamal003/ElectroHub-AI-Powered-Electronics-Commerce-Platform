/**
 * Task 04.5 browser-QA fixtures for the DISPOSABLE cluster started by scripts/delivery-qa-stack.cjs (never a hosted database: the Prisma
 * client refuses any non-loopback `electrohub_disposable*` target outside production rules, and the launcher re-checks the URL).
 * Payment rows represent an already-verified state; Stripe is never contacted. Delivery history is written through the real
 * DeliveryService, so every event, revision and email-outbox row is produced by the code under test. Credentials go to the run directory only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { OrderStatus, PaymentStatus } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/utils/hash.js';
import { DeliveryService } from '../src/services/delivery.service.js';

const output = process.argv[2];
if (!output) throw new Error('Usage: tsx scripts/delivery-qa-seed.ts <credentials.json>');
if (!/^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\/electrohub_disposable_[a-z0-9_]+/.test(process.env.DATABASE_URL ?? '')) throw new Error('Refusing: not a disposable loopback database.');

const service = new DeliveryService();
const hours = (value: number) => new Date(Date.now() + value * 3_600_000).toISOString();

async function user(role: 'CUSTOMER' | 'ADMIN', email: string, firstName: string, lastName: string) {
  const roleRow = await prisma.role.upsert({ where: { name: role }, create: { name: role }, update: {} });
  const password = `Qa-${randomBytes(9).toString('base64url')}9!`;
  const row = await prisma.user.create({ data: { roleId: roleRow.id, email, firstName, lastName, emailVerifiedAt: new Date(), passwordHash: await hashPassword(password) } });
  return { id: row.id, email, password };
}

async function main() {
  const admin = await user('ADMIN', 'admin@delivery-qa.electrohub.test', 'Avery', 'Admin');
  const customer = await user('CUSTOMER', 'customer@delivery-qa.electrohub.test', 'Alex', 'Morgan');
  const other = await user('CUSTOMER', 'other@delivery-qa.electrohub.test', 'Blake', 'Other');
  const category = await prisma.category.create({ data: { name: 'Delivery QA', slug: `delivery-qa-${randomUUID().slice(0, 6)}` } });
  const product = await prisma.product.create({ data: { categoryId: category.id, sku: 'DQA-HEADPHONES', name: 'Sony WH-1000XM5 Wireless Headphones',
    slug: `delivery-qa-headphones-${randomUUID().slice(0, 6)}`, price: '349.99', status: 'ACTIVE', storefrontVisible: true, isTestFixture: true,
    inventory: { create: { quantity: 50, lowStockAt: 5 } } } });

  async function order(owner: { id: string }, status: OrderStatus, payment: PaymentStatus | null, method: 'STANDARD' | 'EXPRESS' = 'EXPRESS') {
    const row = await prisma.order.create({ data: { userId: owner.id, status, subtotal: '349.99', total: '349.99', checkoutAttemptId: randomUUID(),
      checkoutRequestHash: 'e'.repeat(64), deliveryMethod: method, paymentMethod: 'CARD', shippingPhone: '+15550100',
      estimatedDeliveryStart: new Date(hours(24).slice(0, 10)), estimatedDeliveryEnd: new Date(hours(72).slice(0, 10)),
      shippingRecipient: 'Alex Morgan', shippingLine1: '12 Harbor Street', shippingCity: 'Demo City', shippingState: 'CA', shippingPostalCode: '90001', shippingCountry: 'US',
      items: { create: { productId: product.id, productName: product.name, sku: product.sku, unitPrice: '349.99', quantity: 1, lineTotal: '349.99' } } } });
    if (payment) await prisma.payment.create({ data: { orderId: row.id, status: payment, amount: '349.99', providerPaymentId: `delivery_qa_${randomUUID()}`,
      cardBrand: 'visa', cardLast4: '4242', paidAt: payment === 'SUCCEEDED' || payment === 'REFUNDED' ? new Date() : null,
      refundedAt: payment === 'REFUNDED' ? new Date() : null } });
    return `ORD-${row.id.toUpperCase()}`;
  }
  const start = (reference: string) => service.start(admin.id, reference);
  const patch = (reference: string, body: Parameters<DeliveryService['applyUpdate']>[2]) => service.applyUpdate(admin.id, reference, body);

  const notStarted = await order(customer, 'CONFIRMED', 'SUCCEEDED');
  const adminFlow = await order(customer, 'CONFIRMED', 'SUCCEEDED', 'STANDARD');
  const confirmedTracked = await order(customer, 'CONFIRMED', 'SUCCEEDED'); await start(confirmedTracked);
  const preparing = await order(customer, 'PREPARING', 'SUCCEEDED'); await start(preparing);
  await patch(preparing, { expectedRevision: 1, estimatedAt: hours(28) });
  const outFresh = await order(customer, 'CONFIRMED', 'SUCCEEDED'); await start(outFresh);
  await patch(outFresh, { expectedRevision: 1, status: 'PREPARING' });
  await patch(outFresh, { expectedRevision: 2, status: 'OUT_FOR_DELIVERY', estimatedAt: hours(4) });
  await patch(outFresh, { expectedRevision: 3, location: { latitude: 34.0522, longitude: -118.2437, label: 'Downtown Distribution Point' }, note: 'Van 3 departed' });
  const outStale = await order(customer, 'PREPARING', 'SUCCEEDED'); await start(outStale);
  await patch(outStale, { expectedRevision: 1, status: 'OUT_FOR_DELIVERY', estimatedAt: hours(3), location: { latitude: 34.06, longitude: -118.25, label: 'Eastside Sorting Hub' } });
  // Fixture-only clock shift: makes the recorded position 45 minutes old so the stale rule (> 30 min, from server time) is exercised.
  await prisma.delivery.update({ where: { orderId: outStale.slice(4).toLowerCase() }, data: { locationUpdatedAt: new Date(Date.now() - 45 * 60_000) } });
  const outNoLocation = await order(customer, 'PREPARING', 'SUCCEEDED'); await start(outNoLocation);
  await patch(outNoLocation, { expectedRevision: 1, status: 'OUT_FOR_DELIVERY' });
  const delivered = await order(customer, 'CONFIRMED', 'SUCCEEDED'); await start(delivered);
  await patch(delivered, { expectedRevision: 1, status: 'PREPARING', estimatedAt: hours(30) });
  await patch(delivered, { expectedRevision: 2, status: 'OUT_FOR_DELIVERY', location: { latitude: 34.05, longitude: -118.24, label: 'Harbor Street' } });
  await patch(delivered, { expectedRevision: 3, status: 'DELIVERED' });
  const cancelled = await order(customer, 'CONFIRMED', 'SUCCEEDED'); await start(cancelled);
  // Cancellation is owned by PaymentService.compensate; the fixture records its persisted outcome directly.
  await prisma.order.update({ where: { id: cancelled.slice(4).toLowerCase() }, data: { status: 'CANCELLED' } });
  await prisma.payment.update({ where: { orderId: cancelled.slice(4).toLowerCase() }, data: { status: 'REFUNDED', refundedAt: new Date() } });
  const awaitingCapture = await order(customer, 'AWAITING_CAPTURE', 'PROCESSING');
  const legacyUnpaid = await order(customer, 'CONFIRMED', null);
  const otherCustomer = await order(other, 'CONFIRMED', 'SUCCEEDED'); await start(otherCustomer);
  // Task 04.6 map fixtures: several recorded positions (fictional, around the demo hub) and stored delivery-area coordinates.
  const outRoute = await order(customer, 'PREPARING', 'SUCCEEDED'); await start(outRoute);
  await prisma.order.update({ where: { id: outRoute.slice(4).toLowerCase() }, data: { shippingLatitude: 34.0612, shippingLongitude: -118.2268 } });
  const route: [number, number][] = [[34.0405, -118.2620], [34.0452, -118.2551], [34.0498, -118.2478], [34.0533, -118.2402], [34.0561, -118.2339]];
  await patch(outRoute, { expectedRevision: 1, status: 'OUT_FOR_DELIVERY', estimatedAt: hours(2), location: { latitude: route[0]![0], longitude: route[0]![1], label: 'Left the hub' } });
  for (const [index, [latitude, longitude]] of route.slice(1).entries()) {
    await patch(outRoute, { expectedRevision: index + 2, location: { latitude, longitude, label: index === route.length - 2 ? 'Harbor district' : null } });
  }
  const outSimulated = await order(customer, 'PREPARING', 'SUCCEEDED'); await start(outSimulated);
  await patch(outSimulated, { expectedRevision: 1, status: 'OUT_FOR_DELIVERY', location: { latitude: 34.0420, longitude: -118.2600 } });
  await patch(outSimulated, { expectedRevision: 2, location: { latitude: 34.0470, longitude: -118.2500 } });
  await patch(outSimulated, { expectedRevision: 3, location: { latitude: 34.0510, longitude: -118.2450 } });
  // The 04.7 simulation runner does not exist yet; the fixture marks the delivery as simulated directly so the dashed route can be reviewed.
  const simulated = await prisma.delivery.update({ where: { orderId: outSimulated.slice(4).toLowerCase() }, data: { isSimulated: true } });
  await prisma.deliveryEvent.updateMany({ where: { deliveryId: simulated.id, changes: { has: 'LOCATION' } }, data: { source: 'SIMULATION' } });

  writeFileSync(output, JSON.stringify({ admin, customer, other, orders: { notStarted, adminFlow, confirmedTracked, preparing, outFresh, outStale, outNoLocation,
    delivered, cancelled, awaitingCapture, legacyUnpaid, otherCustomer, outRoute, outSimulated } }, null, 2));
  const counts = { orders: await prisma.order.count(), deliveries: await prisma.delivery.count(), events: await prisma.deliveryEvent.count(),
    outbox: await prisma.commerceEmailOutbox.count() };
  console.log(`Delivery QA fixtures seeded: ${JSON.stringify(counts)}`);
}

main().finally(() => prisma.$disconnect());
