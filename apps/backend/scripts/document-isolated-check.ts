/* eslint-disable no-console */
/**
 * Task 03.9 REAL POSTGRES gate body (run through document-isolated-check.cjs, which pins the disposable target).
 * Fixture writes happen first and are labelled; the document assertions then compare hashes of every commerce table before and
 * after repeated metadata/preview/download reads through the real Express app, auth middleware, Prisma and worker renderer.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import app from '../src/app.js';
import { generateAccessToken } from '../src/utils/jwt.js';

const output = path.resolve(process.argv[2] ?? path.join(__dirname, '..', '.isolated', 'document-check'));
const TABLES = ['users', 'carts', 'cart_items', 'inventory', 'orders', 'order_items', 'payments', 'payment_attempts', 'payment_attempt_items',
  'payment_work', 'stripe_events', 'commerce_email_outbox', 'commerce_email_attempts', 'refresh_tokens'];
const d = (value: string) => new Prisma.Decimal(value);
let failures = 0;
function check(label: string, condition: boolean, detail = '') {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

/**
 * Row hashes scoped to the gate's own fixture customers/orders (plus the inventory of the products they bought). The disposable
 * database may be shared with a concurrently running isolated backend whose recovery/email workers legitimately touch other rows.
 */
async function snapshot(users: string[], products: string[]) {
  const u = users.map(id => `'${id}'`).join(','); const p = products.map(id => `'${id}'`).join(',');
  const scoped: Record<string, string> = {
    users: `select * from users where id in (${u})`, carts: `select * from carts where "userId" in (${u})`,
    cart_items: `select ci.* from cart_items ci join carts c on c.id = ci."cartId" where c."userId" in (${u})`,
    inventory: `select * from inventory where "productId" in (${p})`, orders: `select * from orders where "userId" in (${u})`,
    order_items: `select oi.* from order_items oi join orders o on o.id = oi."orderId" where o."userId" in (${u})`,
    payments: `select pm.* from payments pm join orders o on o.id = pm."orderId" where o."userId" in (${u})`,
    payment_attempts: `select * from payment_attempts where "userId" in (${u})`,
    commerce_email_outbox: `select * from commerce_email_outbox where "userId" in (${u})`,
    refresh_tokens: `select * from refresh_tokens where "userId" in (${u})`,
  };
  const rows: Record<string, string> = {};
  for (const [table, query] of Object.entries(scoped)) {
    const [row] = await prisma.$queryRawUnsafe<{ n: bigint; h: string | null }[]>(
      `select count(*) as n, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as h from (${query}) t`);
    rows[table] = `${row!.n}:${row!.h}`;
  }
  return rows;
}

/** Whole-table counts only, reported as context (other local processes may write unrelated rows). */
async function tableCounts() {
  const counts: Record<string, string> = {};
  for (const table of TABLES) {
    const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`select count(*) as n from "${table}"`);
    counts[table] = String(row!.n);
  }
  return counts;
}

async function customer(label: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
  return prisma.user.create({ data: { roleId: role.id, email: `doc-gate-${label}-${randomUUID().slice(0, 8)}@example.test`, firstName: 'Doc',
    lastName: `Gate ${label}`, isActive: true, emailVerifiedAt: new Date() } });
}

type Scenario = 'paid' | 'pending' | 'legacy' | 'failed' | 'paidCancelled' | 'refunded' | 'refundUnverified' | 'mismatch' | 'fifty';
async function order(userId: string, scenario: Scenario, products: { id: string; name: string; sku: string }[]) {
  const lines = (scenario === 'fifty' ? products.slice(0, 50) : products.slice(0, 2)).map((product, index) => {
    const unitPrice = d(index % 2 ? '24.50' : '1299.00'); const quantity = (index % 3) + 1;
    return { productId: product.id, productName: product.name, sku: product.sku, unitPrice, quantity, lineTotal: unitPrice.mul(quantity) };
  });
  const subtotal = lines.reduce((sum, line) => sum.plus(line.lineTotal), d('0'));
  const shippingCost = d('9.99');
  const total = scenario === 'mismatch' ? subtotal.plus(shippingCost).plus('1.00') : subtotal.plus(shippingCost);
  const status = { paid: 'CONFIRMED', pending: 'AWAITING_CAPTURE', legacy: 'CONFIRMED', failed: 'CANCELLED', paidCancelled: 'CANCELLED',
    refunded: 'CANCELLED', refundUnverified: 'CANCELLED', mismatch: 'CONFIRMED', fifty: 'DELIVERED' }[scenario] as 'CONFIRMED';
  const createdAt = new Date(Date.now() - 3_600_000);
  const paidAt = new Date(createdAt.getTime() + 5_000);
  const payment = scenario === 'legacy' ? undefined : { create: {
    provider: 'STRIPE' as const, providerPaymentId: `pi_docgate_${randomUUID().replace(/-/g, '').slice(0, 20)}`, amount: total, currency: 'USD',
    status: ({ pending: 'PROCESSING', failed: 'FAILED', refunded: 'REFUNDED', refundUnverified: 'REFUNDED' } as Record<string, 'PROCESSING'>)[scenario] ?? 'SUCCEEDED',
    paidAt: ['pending', 'failed', 'refundUnverified'].includes(scenario) ? null : paidAt,
    refundedAt: ['refunded', 'refundUnverified'].includes(scenario) ? new Date(paidAt.getTime() + 60_000) : null,
    cardBrand: ['pending', 'failed'].includes(scenario) ? null : 'visa', cardLast4: ['pending', 'failed'].includes(scenario) ? null : '4242' } };
  return prisma.order.create({ data: {
    userId, status, subtotal, shippingCost, total, currency: 'USD', checkoutAttemptId: randomUUID(), checkoutRequestHash: 'd'.repeat(64),
    deliveryMethod: 'EXPRESS', paymentMethod: 'CARD', shippingPhone: '+1 555 010 0000', createdAt,
    estimatedDeliveryStart: new Date('2026-10-22T00:00:00Z'), estimatedDeliveryEnd: new Date('2026-10-24T00:00:00Z'),
    shippingRecipient: 'Doc Gate Synthetic', shippingLine1: '1 Synthetic Way', shippingLine2: null, shippingCity: 'Testville',
    shippingState: 'CA', shippingPostalCode: '90001', shippingCountry: 'United States',
    items: { create: lines }, ...(payment ? { payment } : {}),
  } });
}

(async () => {
  mkdirSync(output, { recursive: true });
  const [db] = await prisma.$queryRaw<{ db: string; port: number }[]>`select current_database()::text as db, inet_server_port()::int as port`;
  check('target is the disposable isolated database', db!.db === 'electrohub_disposable' && db!.port === 55434, `${db!.db}:${db!.port}`);
  if (failures) process.exit(1);
  const migrations = await prisma.$queryRaw<{ ok: bigint; bad: bigint }[]>`select count(*) filter (where finished_at is not null and rolled_back_at is null) as ok,
    count(*) filter (where finished_at is null or rolled_back_at is not null) as bad from _prisma_migrations`;
  console.log(`ledger: ${migrations[0]!.ok} finished, ${migrations[0]!.bad} unfinished/rolled back`);

  // ---- FIXTURE WRITES (setup only; not part of the read-only assertions) ----
  const products = await prisma.product.findMany({ where: { isTestFixture: false }, select: { id: true, name: true, sku: true }, take: 50, orderBy: { id: 'asc' } });
  if (products.length < 50) throw new Error('Need 50 seeded products in the disposable catalog.');
  const [a, b, c] = [await customer('A'), await customer('B'), await customer('C')];
  const scenarios: Scenario[] = ['paid', 'pending', 'legacy', 'failed', 'paidCancelled', 'refunded', 'refundUnverified', 'mismatch', 'fifty'];
  // One owner per scenario keeps every customer under the production 20-per-5-minute file limit (the real router is used).
  const owners = Object.fromEntries(await Promise.all(scenarios.map(async scenario => [scenario, scenario === 'paid' ? a : await customer(`A-${scenario}`)] as const)));
  const orders = Object.fromEntries(await Promise.all(scenarios.map(async scenario => [scenario, await order(owners[scenario]!.id, scenario, products)] as const)));
  const cOrder = await order(c.id, 'paid', products);
  console.log(`fixtures: customers A/B/C (+${scenarios.length - 1} scenario owners) created, ${scenarios.length} orders, 1 order for C`);

  // ---- READ-ONLY DOCUMENT ASSERTIONS ----
  const token = (userId: string) => `Bearer ${generateAccessToken({ userId, role: 'CUSTOMER' })}`;
  const ref = (id: string) => `ORD-${id.toUpperCase()}`;
  const fixtureUsers = [a.id, b.id, c.id, ...Object.values(owners).map(owner => owner!.id)];
  const fixtureProducts = products.map(product => product.id);
  const before = await snapshot(fixtureUsers, fixtureProducts);
  const countsBefore = await tableCounts();
  const binary = (req: request.Test) => req.buffer(true).parse((res, done) => { const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk)); res.on('end', () => done(null, Buffer.concat(chunks))); });

  const expected: Record<Scenario, Record<'invoice' | 'receipt' | 'summary', string>> = {
    paid: { invoice: 'AVAILABLE', receipt: 'AVAILABLE', summary: 'AVAILABLE' },
    pending: { invoice: 'PAYMENT_NOT_CONFIRMED', receipt: 'PAYMENT_NOT_CONFIRMED', summary: 'AVAILABLE' },
    legacy: { invoice: 'PAYMENT_NOT_CONFIRMED', receipt: 'PAYMENT_NOT_CONFIRMED', summary: 'AVAILABLE' },
    failed: { invoice: 'PAYMENT_NOT_CONFIRMED', receipt: 'PAYMENT_NOT_CONFIRMED', summary: 'AVAILABLE' },
    paidCancelled: { invoice: 'AVAILABLE', receipt: 'AVAILABLE', summary: 'AVAILABLE' },
    refunded: { invoice: 'AVAILABLE', receipt: 'AVAILABLE', summary: 'AVAILABLE' },
    refundUnverified: { invoice: 'HISTORICAL_PAYMENT_UNVERIFIED', receipt: 'HISTORICAL_PAYMENT_UNVERIFIED', summary: 'AVAILABLE' },
    mismatch: { invoice: 'DATA_INCONSISTENT', receipt: 'DATA_INCONSISTENT', summary: 'DATA_INCONSISTENT' },
    fifty: { invoice: 'AVAILABLE', receipt: 'AVAILABLE', summary: 'AVAILABLE' },
  };
  for (const scenario of scenarios) {
    const owner = owners[scenario]!.id;
    const response = await request(app).get(`/api/orders/${ref(orders[scenario]!.id)}/documents`).set('Authorization', token(owner));
    const actual = Object.fromEntries((response.body.data?.documents ?? []).map((entry: { kind: string; availability: string; reasonCode: string | null }) =>
      [entry.kind, entry.availability === 'AVAILABLE' ? 'AVAILABLE' : entry.reasonCode]));
    check(`metadata ${scenario}`, response.status === 200 && JSON.stringify(actual) === JSON.stringify(expected[scenario]), JSON.stringify(actual));
    for (const kind of ['invoice', 'receipt', 'summary'] as const) {
      const file = await binary(request(app).get(`/api/orders/${ref(orders[scenario]!.id)}/documents/${kind}`).set('Authorization', token(owner)));
      if (expected[scenario][kind] === 'AVAILABLE') {
        const bytes = file.body as Buffer;
        const ok = file.status === 200 && file.headers['content-type'] === 'application/pdf' && bytes.subarray(0, 5).toString() === '%PDF-' &&
          Number(file.headers['content-length']) === bytes.length && file.headers['cache-control'] === 'private, no-store, max-age=0';
        check(`pdf ${scenario}/${kind}`, ok, `${file.status} ${bytes.length}B`);
        if (ok) {
          writeFileSync(path.join(output, `${scenario}-${kind}.pdf`), bytes);
          console.log(`      sha256=${createHash('sha256').update(bytes).digest('hex')}`);
        }
      } else {
        const want = expected[scenario][kind] === 'DATA_INCONSISTENT' ? 422 : 409;
        check(`pdf ${scenario}/${kind} refused`, file.status === want && !String(file.headers['content-type']).includes('pdf'), String(file.status));
      }
    }
  }
  // Ownership: B and C cannot read A's documents; A cannot read C's. Identical 404 bodies to an unknown order.
  const unknown = await request(app).get(`/api/orders/${ref(randomUUID())}/documents`).set('Authorization', token(b.id));
  for (const [label, owner, target] of [['B on A', b.id, orders.paid!.id], ['C on A', c.id, orders.paid!.id], ['A on C', a.id, cOrder.id]] as const) {
    const meta = await request(app).get(`/api/orders/${ref(target)}/documents`).set('Authorization', token(owner));
    const file = await request(app).get(`/api/orders/${ref(target)}/documents/invoice`).set('Authorization', token(owner));
    check(`ownership ${label}`, meta.status === 404 && file.status === 404 && JSON.stringify(meta.body) === JSON.stringify(unknown.body)
      && JSON.stringify(file.body) === JSON.stringify(unknown.body));
  }
  // Repeat reads (preview + download) and determinism across requests against the same committed facts.
  const first = await binary(request(app).get(`/api/orders/${ref(orders.paid!.id)}/documents/invoice?disposition=inline`).set('Authorization', token(a.id)));
  const again = await binary(request(app).get(`/api/orders/${ref(orders.paid!.id)}/documents/invoice?disposition=attachment`).set('Authorization', token(a.id)));
  check('inline and attachment bytes identical across repeated requests', Buffer.compare(first.body, again.body) === 0);

  // Snapshot immutability: change the live Product name/price and the customer profile; documents still use Order snapshots.
  const after = await snapshot(fixtureUsers, fixtureProducts);
  const changed = Object.keys(before).filter(table => before[table] !== after[table]);
  check('no fixture-owned row changed in any commerce/auth table during document reads', changed.length === 0, changed.join(',') || `${Object.keys(before).length} scoped hashes equal`);
  const countsAfter = await tableCounts();
  const grown = TABLES.filter(table => countsBefore[table] !== countsAfter[table]);
  check('no row inserted or deleted in any commerce/auth table (whole-table counts)', grown.length === 0, grown.join(',') || 'counts equal');
  const product = products[0]!;
  await prisma.product.update({ where: { id: product.id }, data: { name: `${product.name} (renamed after purchase)` } }); // FIXTURE WRITE
  const renamed = await binary(request(app).get(`/api/orders/${ref(orders.paid!.id)}/documents/invoice`).set('Authorization', token(a.id)));
  await prisma.product.update({ where: { id: product.id }, data: { name: product.name } }); // FIXTURE RESTORE
  check('product rename after purchase does not change the invoice bytes', Buffer.compare(first.body, renamed.body) === 0);

  console.log(`\noutput: ${output}\n${failures ? `${failures} FAILED` : 'ALL PASSED'}`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
})().catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
