/** Explicit zero-value, unpaid QA data; never creates a payment, attempt, outbox row or inventory row. */
import '../src/config/env.js';
import { randomUUID } from 'node:crypto';
import { assertDeliveryQaRuntime } from '../src/delivery-qa-runtime.config.js';
import { sharedDevSimulationScope } from '../src/services/delivery-simulation/simulation.config.js';
import { prisma } from '../src/lib/prisma.js';

async function main() {
  const action = process.argv[2];
  if (action !== '--create' && action !== '--dry-run') throw new Error('DELIVERY_QA_FIXTURE_ACTION_REQUIRED');
  assertDeliveryQaRuntime(process.env);
  const scope = sharedDevSimulationScope();
  const productId = process.env.DELIVERY_QA_PRODUCT_ID;
  const categoryId = process.env.DELIVERY_QA_CATEGORY_ID;
  const itemIds = (process.env.DELIVERY_QA_ITEM_IDS ?? '').split(',');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (!scope || scope.orderIds.length !== 2 || !productId || !categoryId || !uuid.test(productId) || !uuid.test(categoryId) ||
      itemIds.length !== 2 || itemIds.some(id => !uuid.test(id)) || new Set([...scope.orderIds, productId, categoryId, ...itemIds]).size !== 6) {
    throw new Error('DELIVERY_QA_FIXTURE_SCOPE_INVALID');
  }
  const { runId, orderIds, customerUserId } = scope;
  if (action === '--dry-run') {
    const owner = await prisma.user.findFirst({ where: { id: customerUserId, isActive: true, role: { name: 'CUSTOMER' } }, select: { id: true } });
    if (!owner) throw new Error('DELIVERY_QA_OWNER_UNAVAILABLE');
    console.log(JSON.stringify({ status: 'READY', runId, orderIds }));
    return;
  }
  await prisma.$transaction(async tx => {
    const owner = await tx.user.findFirst({ where: { id: customerUserId, isActive: true, role: { name: 'CUSTOMER' } }, select: { id: true } });
    if (!owner) throw new Error('DELIVERY_QA_OWNER_UNAVAILABLE');
    await tx.category.create({ data: { id: categoryId, name: runId, slug: runId.toLowerCase(), isActive: false } });
    await tx.product.create({ data: { id: productId, categoryId, name: runId, sku: runId, slug: `${runId.toLowerCase()}-product`,
      price: 0, isTestFixture: true, storefrontVisible: false } });
    for (const [index, id] of orderIds.entries()) {
      await tx.order.create({ data: { id, userId: owner.id, status: 'CONFIRMED', subtotal: 0, total: 0, shippingCost: 0,
        checkoutAttemptId: randomUUID(), checkoutRequestHash: '0'.repeat(64), deliveryMethod: 'STANDARD', paymentMethod: 'CARD',
        shippingRecipient: runId, shippingLine1: runId, shippingCity: 'QA', shippingPostalCode: '00000', shippingCountry: 'QA',
        shippingPhone: '+10000000000', estimatedDeliveryStart: new Date(), estimatedDeliveryEnd: new Date(Date.now() + 86400000),
        items: { create: { id: itemIds[index], productId, productName: runId, sku: runId, unitPrice: 0, quantity: 1, lineTotal: 0 } } } });
    }
  }, { maxWait: 10000, timeout: 30000 });
  console.log(JSON.stringify({ status: 'CREATED', runId, categoryId, productId, orderIds, itemIds }));
}
void main().catch(error => { console.error(`Fixture failed: ${error instanceof Error ? error.name : 'UnknownError'}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
