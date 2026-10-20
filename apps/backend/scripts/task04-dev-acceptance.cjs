'use strict';
// Explicit Task 04.0 synthetic DEV account provisioning and read-only purchase witness.
// Never seeds the catalog, submits provider payments, resets fixtures or deletes financial rows.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const backend = path.resolve(__dirname, '..');
const directory = path.join(backend, '.cache/task04-acceptance');
const fixtureFile = path.join(directory, 'fixture.json');

function assertAcceptanceTarget(environment, targets) {
  if (environment.NODE_ENV !== 'development' || targets.runtime.category !== 'dev' ||
    targets.runtime.identity !== 'supabase:pzxekjybdiulzmssalfo/postgres' ||
    targets.migration.identity !== targets.runtime.identity || !/^(sk|rk)_test_/.test(environment.STRIPE_SECRET_KEY ?? '')) {
    throw new Error('TASK04_EXACT_DEV_TEST_MODE_REQUIRED');
  }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !['--prepare', '--witness'].includes(argv[0])) throw new Error('Use --prepare or --witness explicitly.');
  const { env } = require('../dist/config/env.js');
  const targets = require('../dist/lib/database-target.js').resolveDatabaseTargets(process.env);
  assertAcceptanceTarget(process.env, targets);
  const { prisma } = require('../dist/lib/prisma.js');
  try {
    const identity = await prisma.$queryRaw`SELECT current_database()::text AS database,
      (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls`;
    // For a session pooler pg_stat_ssl reports the internal pooler->Postgres hop. The app client already
    // enforces the supplied CA and rejectUnauthorized:true on its external TLS connection.
    if (identity[0]?.database !== 'postgres' || (targets.runtime.transport !== 'session-pooler' && !identity[0]?.tls) ||
      !env.DB_SSL_CA_CERT_PATH) throw new Error('TASK04_TLS_IDENTITY_REQUIRED');
    fs.mkdirSync(directory, { recursive: true });
    if (argv[0] === '--prepare') {
      if (fs.existsSync(fixtureFile)) {
        const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
        if (!/^task04-[a-f0-9-]+@electrohub\.invalid$/.test(fixture.email)) throw new Error('TASK04_FIXTURE_OWNERSHIP_REQUIRED');
        const existing = await prisma.user.findFirst({ where: { id: fixture.userId, email: fixture.email, role: { name: 'CUSTOMER' } }, select: { id: true } });
        if (!existing) throw new Error('TASK04_FIXTURE_CHANGED_PRESERVED');
        console.log(JSON.stringify({ fixture: 'REUSED', scope: 'one-synthetic-DEV-customer', credentials: 'private-local-file' }));
        return;
      }
      const { publicProductWhere } = require('../dist/services/product.service.js');
      const product = await prisma.product.findFirst({ where: { ...publicProductWhere, price: { gt: 0, lte: 100 }, inventory: { quantity: { gt: 0 } } },
        orderBy: [{ price: 'asc' }, { id: 'asc' }], select: { id: true, slug: true, price: true } });
      if (!product) throw new Error('TASK04_BOUNDED_VISIBLE_PRODUCT_UNAVAILABLE');
      const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' }, select: { id: true } });
      const runId = crypto.randomUUID();
      const fixture = { runId, userId: crypto.randomUUID(), email: `task04-${runId}@electrohub.invalid`,
        password: `Task04-${crypto.randomBytes(24).toString('hex')}!`, productId: product.id, productSlug: product.slug,
        productPrice: product.price.toFixed(2), purchaseLimit: 1, createdAt: new Date().toISOString() };
      // Persist ownership BEFORE the bounded write, so interruptions never create a second customer on rerun.
      fs.writeFileSync(fixtureFile, JSON.stringify(fixture), { flag: 'wx', mode: 0o600 });
      const { hashPassword } = require('../dist/utils/hash.js');
      await prisma.user.create({ data: { id: fixture.userId, roleId: role.id, email: fixture.email,
        passwordHash: await hashPassword(fixture.password), firstName: 'Task04', lastName: 'Synthetic', emailVerifiedAt: new Date() } });
      fs.writeFileSync(path.join(directory, 'fixture.state.json'), JSON.stringify({ stage: 'prepared', runId }), { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ fixture: 'CREATED', scope: 'one-synthetic-DEV-customer', catalogWrites: 0,
        purchaseLimit: 1, productPrice: fixture.productPrice, credentials: 'private-local-file' }));
      return;
    }
    const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
    if (!/^task04-[a-f0-9-]+@electrohub\.invalid$/.test(fixture.email)) throw new Error('TASK04_FIXTURE_OWNERSHIP_REQUIRED');
    const orders = await prisma.order.findMany({ where: { userId: fixture.userId }, select: { id: true, status: true, payment: true, items: true } });
    const attempts = await prisma.paymentAttempt.findMany({ where: { userId: fixture.userId }, include: { work: true } });
    if (orders.length !== 1 || attempts.length !== 1 || attempts[0].state !== 'PAID' || attempts[0].orderId !== orders[0].id ||
      attempts[0].work?.state !== 'DONE' || orders[0].items.length !== 1 || orders[0].items[0].productId !== fixture.productId ||
      orders[0].items[0].quantity !== 1) throw new Error('TASK04_PURCHASE_NOT_CONFIRMED_OR_NOT_UNIQUE');
    const intent = await require('../dist/services/stripe.provider.js').stripeProvider.retrieve(attempts[0].providerIntentId);
    require('../dist/services/payment.domain.js').verifyBinding(attempts[0], intent);
    if (intent.livemode || intent.status !== 'succeeded' || intent.received !== attempts[0].amountCents) throw new Error('TASK04_PROVIDER_OUTCOME_NOT_CONFIRMED');
    const events = await prisma.stripeEvent.count({ where: { attemptId: attempts[0].id } });
    const email = await prisma.commerceEmailOutbox.groupBy({ by: ['dispatchState'], where: { userId: fixture.userId }, _count: true });
    const report = { environment: 'SHARED_DEV_TEST_MODE', orders: 1, attempts: 1, state: attempts[0].state,
      workState: attempts[0].work.state, providerMode: 'test', providerState: intent.status, receivedCents: intent.received,
      signedWebhookEvents: events, email: email.map(row => ({ state: row.dispatchState, count: row._count })),
      orderReference: `ORD-${orders[0].id.toUpperCase()}`, financialRecordsRetained: true, observedAt: new Date().toISOString() };
    if (!events) throw new Error('TASK04_SIGNED_WEBHOOK_NOT_WITNESSED');
    fs.writeFileSync(path.join(directory, 'witness.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch(error => {
  console.error(require('./stripe-gate-safety.cjs').sanitize(error.message)); process.exitCode = 1;
});
module.exports = { assertAcceptanceTarget, main };
