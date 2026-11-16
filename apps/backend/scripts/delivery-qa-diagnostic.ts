import '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { sharedDevSimulationScope } from '../src/services/delivery-simulation/simulation.config.js';
import { paymentEligible } from '../src/services/delivery.service.js';
import { activateDeliveryQaRuntime } from '../src/delivery-qa-runtime.config.js';

async function run() {
  activateDeliveryQaRuntime();
  const scope = sharedDevSimulationScope();
  if (!scope) throw new Error('QA_SCOPE_UNAVAILABLE');
  const order = await prisma.order.findUniqueOrThrow({ where: { id: scope.orderIds[0] }, include: {
    payment: { select: { status: true } }, delivery: true, paymentAttempt: { select: { id: true } },
    items: { select: { product: { select: { id: true, isTestFixture: true } } } },
  } });
  console.log(JSON.stringify({ scope: true, eligible: paymentEligible(order), hasPayment: !!order.payment,
    hasAttempt: !!order.paymentAttempt, testProducts: order.items.every(item => item.product.isTestFixture), zeroTotal: order.total.isZero() }));
}
void run().finally(() => prisma.$disconnect());
