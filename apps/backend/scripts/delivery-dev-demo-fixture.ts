/**
 * Shared-DEV demo fixture check for the delivery simulation (Task 04.7). READ-ONLY and idempotent: it verifies that the named QA orders are
 * exactly the approved unpaid fixtures and prints the DELIVERY_DEV_DEMO_* configuration to add to apps/backend/.env. It never writes data,
 * never contacts Stripe and refuses any database other than the verified DEV project.
 *
 * Usage: npx tsx scripts/delivery-dev-demo-fixture.ts <QA-DELIVERY-run-id> <order-uuid>[,<order-uuid>...]
 */
import { prisma } from '../src/lib/prisma.js';
import { resolveDatabaseTargets } from '../src/lib/database-target.js';

const [runId = '', ids = ''] = process.argv.slice(2);
const orderIds = ids.split(',').map(id => id.trim().toLowerCase()).filter(Boolean);
if (!/^QA-DELIVERY-[0-9]{8}-[a-z0-9]{4,32}$/.test(runId) || !orderIds.length) throw new Error('Usage: tsx scripts/delivery-dev-demo-fixture.ts <QA-DELIVERY-run-id> <order-uuid>[,<order-uuid>...]');
const targets = resolveDatabaseTargets(process.env);
if (targets.runtime.category !== 'dev' || targets.runtime.identity !== 'supabase:pzxekjybdiulzmssalfo/postgres') throw new Error('Refusing: not the verified shared DEV project.');

async function main() {
  const problems: string[] = [];
  const owners = new Set<string>();
  const products = new Set<string>();
  for (const id of orderIds) {
    const order = await prisma.order.findUnique({ where: { id }, select: { userId: true, total: true, status: true, shippingRecipient: true, shippingLine1: true,
      payment: { select: { id: true } }, paymentAttempt: { select: { id: true } }, items: { select: { product: { select: { id: true, isTestFixture: true } } } } } });
    if (!order) { problems.push(`${id}: not found`); continue; }
    if (order.shippingRecipient !== runId || order.shippingLine1 !== runId) problems.push(`${id}: run marker mismatch`);
    if (!order.total.isZero()) problems.push(`${id}: total is not zero`);
    if (order.payment || order.paymentAttempt) problems.push(`${id}: has payment data`);
    if (!order.items.length || order.items.some(item => !item.product.isTestFixture)) problems.push(`${id}: not test-fixture items only`);
    owners.add(order.userId);
    order.items.forEach(item => products.add(item.product.id));
  }
  if (owners.size !== 1) problems.push('orders must belong to exactly one QA customer');
  if (products.size !== 1) problems.push('orders must use exactly one test-fixture product');
  if (problems.length) { console.error(`Fixture rejected:\n- ${problems.join('\n- ')}`); process.exitCode = 1; return; }
  console.log('Fixture verified (unpaid, zero-value, test-fixture product, single QA customer). Add to apps/backend/.env:');
  console.log(['DELIVERY_SIMULATION_ENABLED=true', 'DELIVERY_DEV_DEMO=true', `DELIVERY_DEV_DEMO_RUN_ID=${runId}`, `DELIVERY_DEV_DEMO_ORDER_IDS=${orderIds.join(',')}`,
    `DELIVERY_DEV_DEMO_CUSTOMER_USER_ID=${[...owners][0]}`, `DELIVERY_DEV_DEMO_PRODUCT_ID=${[...products][0]}`].join('\n'));
}

main().finally(() => prisma.$disconnect());
