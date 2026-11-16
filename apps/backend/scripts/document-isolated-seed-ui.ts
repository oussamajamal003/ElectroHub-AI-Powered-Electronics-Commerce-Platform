/* eslint-disable no-console */
/**
 * Task 03.9 browser-QA fixtures for the disposable isolated database (launched via document-isolated-check.cjs --seed-ui).
 * Adds labelled synthetic orders (paid, pending, legacy, refunded, long names, plus enough paid orders to paginate) to the isolated
 * fixture customer. The customer's email is read from .isolated/fixture-credentials.txt and never printed.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';

const credentials = Object.fromEntries(readFileSync(path.join(__dirname, '..', '.isolated', 'fixture-credentials.txt'), 'utf8')
  .split(/\r?\n/).filter(Boolean).map(line => line.split('=') as [string, string]));
const d = (value: string) => new Prisma.Decimal(value);

(async () => {
  const [db] = await prisma.$queryRaw<{ db: string; port: number }[]>`select current_database()::text as db, inet_server_port()::int as port`;
  if (db!.db !== 'electrohub_disposable' || db!.port !== 55434) throw new Error('Refusing: not the disposable isolated database.');
  const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.customer!.trim() } });
  const products = await prisma.product.findMany({ where: { isTestFixture: false }, select: { id: true, name: true, sku: true }, take: 12, orderBy: { id: 'asc' } });
  const kinds = ['paid', 'pending', 'legacy', 'refunded', 'longNames', ...Array.from({ length: 12 }, () => 'paid')];
  for (const [index, kind] of kinds.entries()) {
    const lines = products.slice(0, kind === 'longNames' ? 6 : 2).map((product, line) => {
      const unitPrice = d(line % 2 ? '24.50' : '1299.00'); const quantity = line + 1;
      return { productId: product.id, sku: product.sku, unitPrice, quantity, lineTotal: unitPrice.mul(quantity),
        productName: kind === 'longNames' ? `${product.name} — synthetic extended edition with a deliberately long descriptive title for layout QA` : product.name };
    });
    const subtotal = lines.reduce((sum, line) => sum.plus(line.lineTotal), d('0')); const shippingCost = d('9.99'); const total = subtotal.plus(shippingCost);
    const createdAt = new Date(Date.now() - (index + 1) * 3_600_000); const paidAt = new Date(createdAt.getTime() + 4_000);
    await prisma.order.create({ data: {
      userId: user.id, status: kind === 'pending' ? 'AWAITING_CAPTURE' : kind === 'refunded' ? 'CANCELLED' : 'CONFIRMED', subtotal, shippingCost, total,
      currency: 'USD', checkoutAttemptId: randomUUID(), checkoutRequestHash: 'e'.repeat(64), deliveryMethod: 'STANDARD', paymentMethod: 'CARD',
      shippingPhone: '+1 555 010 0000', createdAt, estimatedDeliveryStart: new Date('2026-10-23T00:00:00Z'), estimatedDeliveryEnd: new Date('2026-10-27T00:00:00Z'),
      shippingRecipient: 'Synthetic QA Customer', shippingLine1: '42 Synthetic Avenue', shippingLine2: 'Apartment 7', shippingCity: 'Testville',
      shippingState: 'CA', shippingPostalCode: '90002', shippingCountry: 'United States', items: { create: lines },
      ...(kind === 'legacy' ? {} : { payment: { create: { provider: 'STRIPE', providerPaymentId: `pi_docqa_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        amount: total, currency: 'USD', status: kind === 'pending' ? 'PROCESSING' : kind === 'refunded' ? 'REFUNDED' : 'SUCCEEDED',
        paidAt: kind === 'pending' ? null : paidAt, refundedAt: kind === 'refunded' ? new Date(paidAt.getTime() + 600_000) : null,
        cardBrand: kind === 'pending' ? null : 'visa', cardLast4: kind === 'pending' ? null : '4242' } } }),
    } });
  }
  console.log(`seeded ${kinds.length} synthetic orders for the isolated fixture customer`);
  await prisma.$disconnect();
})().catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
