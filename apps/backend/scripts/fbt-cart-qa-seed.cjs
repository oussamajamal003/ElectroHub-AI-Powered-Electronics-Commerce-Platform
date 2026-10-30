'use strict';

/*
 * Task 04.4 cart FBT browser QA helper (ISOLATED DISPOSABLE QA ONLY). Writes and removes temporary paid orders for the isolated
 * fixture customer so the cart "Frequently Bought Together" rail can be checked in Chromium. Refuses any database that is not the
 * loopback disposable cluster written by scripts/dev-isolated.cjs. Prints no URL, password or customer credential.
 *
 *   node scripts/fbt-cart-qa-seed.cjs seed     write temporary orders (A+B x2, C+D x2); prints the products as JSON
 *   node scripts/fbt-cart-qa-seed.cjs reset    remove the fixture customer's cart lines
 *   node scripts/fbt-cart-qa-seed.cjs cleanup  remove the temporary orders and the state file
 */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const home = path.resolve(__dirname, '..', '.isolated-docker');
const stateFile = path.join(home, 'fbt-cart-state.json');

function readEnvironment() {
  const env = JSON.parse(fs.readFileSync(path.join(home, 'env.json'), 'utf8'));
  const url = new URL(env.DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '55434' || !url.pathname.startsWith('/electrohub_disposable')) {
    throw new Error('Refusing: the target is not the disposable loopback QA cluster.');
  }
  return env.DATABASE_URL;
}

function readCustomerEmail() {
  const line = fs.readFileSync(path.join(home, 'fixture-credentials.txt'), 'utf8').split('\n').find(entry => entry.startsWith('customer='));
  if (!line) throw new Error('Fixture customer is not provisioned.');
  return line.slice('customer='.length).trim();
}

async function pickProducts(prisma) {
  const rows = await prisma.product.findMany({
    where: { status: 'ACTIVE', storefrontVisible: true, isTestFixture: false, inventory: { quantity: { gt: 0 } } },
    select: { id: true, name: true, slug: true, sku: true }, orderBy: { name: 'asc' }, take: 40,
  });
  if (rows.length < 4) throw new Error('Not enough in-stock visible products on the disposable database.');
  return rows.slice(0, 4);
}

async function createOrder(prisma, userId, lines) {
  const row = await prisma.order.create({ data: { userId, status: 'CONFIRMED', subtotal: '0.00', total: '0.00', checkoutAttemptId: randomUUID(),
    checkoutRequestHash: 'a'.repeat(64), deliveryMethod: 'STANDARD', paymentMethod: 'CARD', shippingPhone: '+10000000000',
    estimatedDeliveryStart: new Date('2026-12-01'), estimatedDeliveryEnd: new Date('2026-12-05'), shippingRecipient: 'FBT QA',
    shippingLine1: '1 QA Street', shippingCity: 'QA City', shippingCountry: 'US' } });
  for (const product of lines) {
    await prisma.orderItem.create({ data: { orderId: row.id, productId: product.id, productName: product.name, sku: product.sku,
      unitPrice: '100.00', quantity: 1, lineTotal: '100.00' } });
  }
  await prisma.payment.create({ data: { orderId: row.id, status: 'SUCCEEDED', amount: '100.00', providerPaymentId: `fbt_qa_${randomUUID()}` } });
  return row.id;
}

async function main(mode) {
  const prisma = new PrismaClient({ datasources: { db: { url: readEnvironment() } } });
  try {
    if (mode === 'seed') {
      const user = await prisma.user.findUnique({ where: { email: readCustomerEmail() } });
      if (!user) throw new Error('Fixture customer not found.');
      const [a, b, c, d] = await pickProducts(prisma);
      // A+B twice: anchor A suggests B with support 2. C+D twice: anchor C suggests D with support 2.
      const orderIds = [await createOrder(prisma, user.id, [a, b]), await createOrder(prisma, user.id, [a, b]),
        await createOrder(prisma, user.id, [c, d]), await createOrder(prisma, user.id, [c, d])];
      fs.writeFileSync(stateFile, JSON.stringify({ userId: user.id, orderIds }), { mode: 0o600 });
      return { products: { a, b, c, d } };
    }
    if (mode === 'reset') {
      const { userId } = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const removed = await prisma.$executeRaw`DELETE FROM "cart_items" WHERE "cartId" IN (SELECT "id" FROM "carts" WHERE "userId" = ${userId}::uuid)`;
      return { cartLinesRemoved: removed };
    }
    if (mode === 'cleanup') {
      const { orderIds } = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      const remaining = await prisma.order.count({ where: { id: { in: orderIds } } });
      fs.unlinkSync(stateFile);
      return { removedOrders: orderIds.length, remaining };
    }
    throw new Error('Unknown mode: use seed, reset or cleanup.');
  } finally {
    await prisma.$disconnect();
  }
}

main(process.argv[2]).then(result => { process.stdout.write(`${JSON.stringify(result)}\n`); })
  .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
