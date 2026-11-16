const fs = require('node:fs');
const path = require('node:path');
const safety = require('./stripe-gate-safety.cjs');
const backendDir = path.resolve(__dirname, '..');

function parseCleanupArguments(argv) {
  const forwarded = [];
  for (const argument of argv) {
    if (argument.startsWith('--ownership-manifest=')) forwarded.push(argument.replace('--ownership-manifest=', '--fixture-manifest='));
    else if (['--execute', '--dry-run', '--preflight', '--help'].includes(argument)) forwarded.push(argument);
    else throw new Error('Cleanup accepts an ownership manifest and explicit execution mode only.');
  }
  return safety.parseArguments(forwarded);
}

function readOwnership(file) {
  const ownership = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownership.userId) || ownership.fixturesCreated !== true) throw new Error('Owned fixture customer identity is missing.');
  const manifest = Object.fromEntries(['runId', 'projectRef', 'isolatedDev', 'productIds', 'sourceFingerprint', 'approvedRunner', 'postgresReliabilityVerified', 'connectionBudgetVerified'].map(name => [name, ownership[name]]));
  return { manifest, userId: ownership.userId };
}

async function executeCleanup({ manifest, userId, values }) {
  process.env.NODE_ENV = 'test';
  const { Prisma } = require('@prisma/client');
  const { env } = require('../dist/config/env.js');
  for (const name of ['DATABASE_URL', 'DIRECT_URL', 'STRIPE_SECRET_KEY', 'DB_SSL_CA_CERT_PATH']) if (env[name] !== values[name]) throw new Error('Cleanup runtime differs from approved preflight.');
  const { prisma } = require('../dist/lib/prisma.js');
  const { stripeProvider } = require('../dist/services/stripe.provider.js');
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true } });
    const attempts = await prisma.paymentAttempt.findMany({ where: { userId }, include: { work: true } });
    const orders = await prisma.order.findMany({ where: { userId }, select: { id: true } });
    const payments = await prisma.payment.findMany({ where: { order: { userId } }, select: { id: true } });
    const initial = safety.cleanupEligibility({ manifest, user, attempts, orders, payments, providerIntents: [] });
    if ((!initial.allowed && attempts.some(attempt => attempt.state !== 'CANCELED' || attempt.orderId)) || orders.length || payments.length) throw new Error('Purchase or uncertain state preserved; cleanup requires independent reconciliation.');
    const providerIntents = [];
    for (const attempt of attempts) if (attempt.providerIntentId) providerIntents.push(await stripeProvider.retrieve(attempt.providerIntentId));
    const decision = safety.cleanupEligibility({ manifest, user, attempts, orders, payments, providerIntents });
    if (!decision.allowed) throw new Error(decision.reason);
    await prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "carts" WHERE "userId" = ${userId}::uuid ORDER BY "id" FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "payment_attempts" WHERE "userId" = ${userId}::uuid ORDER BY "id" FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT "attemptId" FROM "payment_work" WHERE "attemptId" IN (SELECT "id" FROM "payment_attempts" WHERE "userId" = ${userId}::uuid) ORDER BY "attemptId" FOR UPDATE`);
      const current = safety.cleanupEligibility({ manifest,
        user: await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true } }),
        attempts: await tx.paymentAttempt.findMany({ where: { userId }, include: { work: true } }),
        orders: await tx.order.findMany({ where: { userId }, select: { id: true } }),
        payments: await tx.payment.findMany({ where: { order: { userId } }, select: { id: true } }), providerIntents });
      if (!current.allowed) throw new Error('Fixture state changed; financial records preserved.');
      await tx.stripeEvent.deleteMany({ where: { attempt: { userId } } });
      await tx.paymentWork.deleteMany({ where: { attempt: { userId } } });
      await tx.paymentAttemptItem.deleteMany({ where: { attempt: { userId } } });
      await tx.paymentAttempt.deleteMany({ where: { userId } });
      await tx.cartItem.deleteMany({ where: { cart: { userId } } });
      await tx.user.delete({ where: { id: userId } });
    }, { isolationLevel: 'Serializable', timeout: 30000, maxWait: 10000 });
    if (await prisma.user.count({ where: { id: userId } })) throw new Error('Fixture cleanup readback failed.');
    return { status: 'READY_TO_RUN', cleanup: 'OWNED_NON_PURCHASE_CUSTOMER_REMOVED', products: 'PRESERVED', financialAcceptance: 'NOT_VERIFIED' };
  } finally { await prisma.$disconnect(); }
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const output = dependencies.output || (value => console.log(safety.sanitize(JSON.stringify(value))));
  try {
    const options = parseCleanupArguments(argv);
    if (options.help) { output({ usage: 'Default offline preflight; --ownership-manifest=PATH; --execute also requires STRIPE_GATE_CLEANUP_AUTHORIZED=<runId>. Captured, declined, leased or uncertain outcomes are preserved.' }); return 0; }
    const values = dependencies.values || safety.loadTestEnvironment(backendDir);
    const ownership = options.manifestPath ? (dependencies.readOwnership || readOwnership)(options.manifestPath) : null;
    const report = safety.preflight({ options, values, backendDir, fingerprint: dependencies.fingerprint || safety.sourceFingerprint(backendDir),
      readJson: () => ownership?.manifest, ...(dependencies.exists ? { exists: dependencies.exists } : {}) });
    const { manifest, ...visible } = report;
    output({ ...visible, cleanup: 'NOT_VERIFIED' });
    if (report.status !== 'READY_TO_RUN') return report.exitCode;
    if (options.mode !== 'execute') return 0;
    if (values.STRIPE_GATE_CLEANUP_AUTHORIZED !== manifest.runId) { output({ status: 'BLOCKED_BY_ENVIRONMENT', cleanup: 'EXPLICIT_APPROVAL_REQUIRED' }); return 2; }
    const restoreOutput = dependencies.execute ? () => {} : safety.installSanitizedOutput(process.stdout);
    const restoreErrors = dependencies.execute ? () => {} : safety.installSanitizedOutput(process.stderr);
    try { output(await (dependencies.execute || executeCleanup)({ manifest, userId: ownership.userId, values })); }
    finally { restoreOutput(); restoreErrors(); }
    return 0;
  } catch (error) { output({ status: 'FAILED_PRECONDITION', cleanup: 'PRESERVED', error: safety.sanitize(error.message) }); return 3; }
}

if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { main, parseCleanupArguments, readOwnership };
