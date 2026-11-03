// Task 05.1 G03: bounded, read-only reconciliation of the admin customer API against the database it reads.
// For a few customers that have orders (refunded payments preferred), it recomputes paid spend per currency from the individual stored
// SUCCEEDED payment rows (summed here, not by SQL), plus order count and last-order date, and compares them with GET /api/admin/customers/:id.
// Refuses production targets. Prints one JSON evidence record; customers appear only as short hashes (no names or emails).
// Usage: EH_RECON_API=http://127.0.0.1:5000 EH_RECON_ADMIN_EMAIL=… EH_RECON_ADMIN_PASSWORD=… npx tsx scripts/admin-spend-reconciliation.ts [--customers=5]
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { resolveDatabaseTargets } from '../src/lib/database-target.js';

const limit = Number(/^--customers=(\d+)$/.exec(process.argv[2] ?? '')?.[1] ?? 5);
if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Use --customers=1..20.');
const api = process.env.EH_RECON_API;
const email = process.env.EH_RECON_ADMIN_EMAIL;
const password = process.env.EH_RECON_ADMIN_PASSWORD;
if (!api || !email || !password) throw new Error('EH_RECON_API, EH_RECON_ADMIN_EMAIL and EH_RECON_ADMIN_PASSWORD are required.');
const target = resolveDatabaseTargets(process.env).runtime;
if (target.category !== 'dev' && target.category !== 'disposable') throw new Error('Reconciliation is limited to DEV or disposable targets.');

const hash = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 10);
type Expected = { orderCount: number; lastOrderAt: string | null; paidSpend: { currency: string; amount: string }[] };

async function expected(userId: string): Promise<Expected & { refundedPayments: number }> {
  const [orders, payments] = await Promise.all([
    prisma.order.findMany({ where: { userId }, select: { createdAt: true } }),
    prisma.payment.findMany({ where: { order: { userId } }, select: { status: true, currency: true, amount: true } }),
  ]);
  const totals = new Map<string, Prisma.Decimal>();
  for (const payment of payments) {
    if (payment.status !== 'SUCCEEDED') continue;
    totals.set(payment.currency, (totals.get(payment.currency) ?? new Prisma.Decimal(0)).plus(payment.amount));
  }
  const last = orders.reduce<Date | null>((latest, order) => !latest || order.createdAt > latest ? order.createdAt : latest, null);
  return {
    orderCount: orders.length, lastOrderAt: last?.toISOString() ?? null,
    paidSpend: [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) })),
    refundedPayments: payments.filter(payment => payment.status === 'REFUNDED').length,
  };
}

async function main() {
  const login = await fetch(`${api}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (login.status !== 200) throw new Error(`Admin login failed with HTTP ${login.status}.`);
  const { accessToken, user } = await login.json() as { accessToken: string; user: { role?: string } };
  if (user.role && user.role !== 'ADMIN') throw new Error('The reconciliation account is not an administrator.');

  const candidates = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT u."id" FROM "users" u JOIN "roles" r ON r."id" = u."roleId" JOIN "orders" o ON o."userId" = u."id"
    LEFT JOIN "payments" p ON p."orderId" = o."id"
    WHERE r."name" = 'CUSTOMER'
    GROUP BY u."id" ORDER BY COUNT(*) FILTER (WHERE p."status" = 'REFUNDED') DESC, MAX(o."createdAt") DESC LIMIT ${limit}`);

  const customers = [];
  for (const { id } of candidates) {
    const want = await expected(id);
    const response = await fetch(`${api}/api/admin/customers/${id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await response.json() as { data?: Expected };
    const got = body.data;
    const differences: string[] = [];
    if (response.status !== 200 || !got) differences.push(`HTTP ${response.status}`);
    else {
      if (got.orderCount !== want.orderCount) differences.push(`orderCount api=${got.orderCount} db=${want.orderCount}`);
      if (got.lastOrderAt !== want.lastOrderAt) differences.push(`lastOrderAt api=${got.lastOrderAt} db=${want.lastOrderAt}`);
      if (JSON.stringify(got.paidSpend) !== JSON.stringify(want.paidSpend)) differences.push(`paidSpend api=${JSON.stringify(got.paidSpend)} db=${JSON.stringify(want.paidSpend)}`);
    }
    customers.push({ customer: hash(id), orderCount: want.orderCount, refundedPayments: want.refundedPayments, paidSpend: want.paidSpend,
      result: differences.length ? 'FAIL' : 'PASS', differences });
  }

  const revision = (() => { try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })();
  const failed = customers.some(customer => customer.result === 'FAIL');
  const record = {
    testId: 'G03', environment: target.identity, category: target.category, revision, route: 'GET /api/admin/customers/:id',
    action: 'Recompute paid spend (SUCCEEDED payments only, per currency), order count and last-order date from stored rows; compare with the admin API',
    expected: 'Every sampled customer matches; refunded payments excluded', checkedAt: new Date().toISOString(),
    result: customers.length === 0 ? 'NOT VERIFIED' : failed ? 'FAIL' : 'PASS', customers,
  };
  console.log(JSON.stringify(record, null, 2));
  if (record.result !== 'PASS') process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
