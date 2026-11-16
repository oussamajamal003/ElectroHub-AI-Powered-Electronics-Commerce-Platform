'use strict';
// Explicit Task 04.0 synthetic DEV account provisioning and read-only purchase witness.
// Never seeds the catalog, submits provider payments, resets fixtures or deletes financial rows.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const backend = path.resolve(__dirname, '..');
const directory = path.join(backend, '.cache/task04-acceptance');
const fixtureFile = path.join(directory, 'fixture.json');
const stateFile = path.join(directory, 'fixture.state.json');
const lockFile = path.join(directory, 'real-dev-playwright.lock');
const STAGES = ['prepared', 'journeyStarted', 'confirmSubmitted', 'purchased'];
const RESUME_WINDOW_MS = 15 * 60 * 1000;

/**
 * Pre-submit resume classification for the one synthetic fixture. Only an interruption before Place Order is resumable:
 * no order, at most one attempt, never submitted/confirmation-started, no payment method, nothing received/capturable,
 * no signed event, an unexpired attempt whose work is idle, and a provider readback bound to that attempt in Test Mode.
 * Everything else (post-submit, uncertain, contradictory or missing evidence) is refused; nothing is ever rewritten.
 */
function classifyResume({ stage, orders, attempts, intent, events, now = Date.now() }) {
  if (stage === 'prepared') return { resumable: false, reason: 'NOT_NEEDED_FIXTURE_UNUSED' };
  if (stage !== 'journeyStarted') return { resumable: false, reason: STAGES.includes(stage) ? 'REFUSED_SUBMISSION_RECORDED' : 'REFUSED_UNKNOWN_PROGRESS' };
  if (!Array.isArray(orders) || !Array.isArray(attempts) || !Number.isInteger(events)) return { resumable: false, reason: 'REFUSED_STATE_UNAVAILABLE' };
  if (orders.length) return { resumable: false, reason: 'REFUSED_ORDER_EXISTS' };
  if (attempts.length > 1) return { resumable: false, reason: 'REFUSED_MULTIPLE_ATTEMPTS' };
  if (!attempts.length) {
    if (events) return { resumable: false, reason: 'REFUSED_CONTRADICTORY_EVENTS' };
    return intent ? { resumable: false, reason: 'REFUSED_CONTRADICTORY_PROVIDER' } : { resumable: true, reason: 'PRE_SUBMIT_NO_ATTEMPT', attemptId: null };
  }
  const [attempt] = attempts;
  // A never-submitted attempt the scoped worker already released (provider canceled, nothing received or capturable, no
  // method) is a closed pre-submit record: the resumed checkout creates one new attempt. Its cancellation webhook is expected.
  if (isReleasedPreSubmit(attempt, intent)) return { resumable: true, reason: 'PRE_SUBMIT_ATTEMPT_RELEASED', attemptId: null };
  if (events) return { resumable: false, reason: 'REFUSED_CONTRADICTORY_EVENTS' };
  if (attempt.submittedAt || attempt.confirmationStartedAt) return { resumable: false, reason: 'REFUSED_ATTEMPT_SUBMITTED' };
  if (attempt.state !== 'AWAITING_INPUT' || attempt.orderId || attempt.cancelRequested || attempt.failureCode) {
    return { resumable: false, reason: 'REFUSED_ATTEMPT_NOT_PRE_SUBMIT' };
  }
  if (!attempt.work || attempt.work.state !== 'READY') return { resumable: false, reason: 'REFUSED_WORK_NOT_IDLE' };
  if (!(attempt.expiresAt instanceof Date) || attempt.expiresAt.getTime() <= now + RESUME_WINDOW_MS) {
    // Expiry/release is a payment-worker transition; it needs its own exact operational authorization.
    return { resumable: false, reason: 'REFUSED_ATTEMPT_EXPIRED_NEEDS_OPERATOR' };
  }
  if (!intent || intent.id !== attempt.providerIntentId || intent.attemptId !== attempt.id) return { resumable: false, reason: 'REFUSED_PROVIDER_UNBOUND' };
  if (intent.livemode !== false || intent.status !== 'requires_payment_method' || intent.received !== 0 || intent.capturable !== 0 ||
    intent.methodType !== null || intent.declined) return { resumable: false, reason: 'REFUSED_PROVIDER_NOT_PRE_SUBMIT' };
  return { resumable: true, reason: 'PRE_SUBMIT_ATTEMPT_PRESERVED', attemptId: attempt.id };
}

function isReleasedPreSubmit(attempt, intent) {
  return Boolean(attempt && intent) && !attempt.submittedAt && !attempt.confirmationStartedAt && attempt.state === 'CANCELED' &&
    attempt.providerStatus === 'canceled' && !attempt.orderId && attempt.work?.state === 'DONE' &&
    intent.id === attempt.providerIntentId && intent.attemptId === attempt.id && intent.livemode === false &&
    intent.status === 'canceled' && intent.received === 0 && intent.capturable === 0 && intent.methodType === null;
}

/**
 * Witness: exactly one PAID attempt bound to the one Order; any other fixture attempt must be a released, never-submitted
 * pre-submit record (CANCELED, no order). Anything else is not a unique purchase.
 */
function uniquePurchase(orders, attempts) {
  const paid = attempts.filter(attempt => attempt.state === 'PAID');
  const others = attempts.filter(attempt => attempt.state !== 'PAID');
  return orders.length === 1 && paid.length === 1 && paid[0].orderId === orders[0].id && paid[0].work?.state === 'DONE' &&
    others.length <= 1 && others.every(attempt => attempt.state === 'CANCELED' && !attempt.submittedAt && !attempt.orderId) ? paid[0] : null;
}

/** Adds one single-use authorization; the original progress fields and every earlier authorization are kept. */
function withResumeAuthorization(state, classification, now = new Date()) {
  if (!classification.resumable || state.stage !== 'journeyStarted') throw new Error('TASK04_RESUME_NOT_PERMITTED');
  if (state.resumeAuthorization && !state.resumeAuthorization.consumedAt) throw new Error('TASK04_RESUME_ALREADY_PENDING');
  const authorization = { id: crypto.randomUUID(), runId: state.runId, reason: classification.reason,
    attemptId: classification.attemptId, verifiedAt: now.toISOString(), expiresAt: new Date(now.getTime() + RESUME_WINDOW_MS).toISOString() };
  return { ...state, resumeAuthorization: authorization,
    resumeHistory: [...(state.resumeHistory ?? []), ...(state.resumeAuthorization ? [state.resumeAuthorization] : [])] };
}

function writeAtomically(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function assertAcceptanceTarget(environment, targets) {
  if (environment.NODE_ENV !== 'development' || targets.runtime.category !== 'dev' ||
    targets.runtime.identity !== 'supabase:pzxekjybdiulzmssalfo/postgres' ||
    targets.migration.identity !== targets.runtime.identity || !/^(sk|rk)_test_/.test(environment.STRIPE_SECRET_KEY ?? '')) {
    throw new Error('TASK04_EXACT_DEV_TEST_MODE_REQUIRED');
  }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !['--prepare', '--witness', '--reconcile-resume'].includes(argv[0])) throw new Error('Use --prepare, --witness or --reconcile-resume explicitly.');
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
    if (argv[0] === '--reconcile-resume') return await reconcileResume(prisma);
    const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
    if (!/^task04-[a-f0-9-]+@electrohub\.invalid$/.test(fixture.email)) throw new Error('TASK04_FIXTURE_OWNERSHIP_REQUIRED');
    const orders = await prisma.order.findMany({ where: { userId: fixture.userId }, select: { id: true, status: true, payment: true, items: true } });
    const attempts = await prisma.paymentAttempt.findMany({ where: { userId: fixture.userId }, include: { work: true } });
    const paid = uniquePurchase(orders, attempts);
    if (!paid || orders[0].items.length !== 1 || orders[0].items[0].productId !== fixture.productId ||
      orders[0].items[0].quantity !== 1) throw new Error('TASK04_PURCHASE_NOT_CONFIRMED_OR_NOT_UNIQUE');
    const intent = await require('../dist/services/stripe.provider.js').stripeProvider.retrieve(paid.providerIntentId);
    require('../dist/services/payment.domain.js').verifyBinding(paid, intent);
    if (intent.livemode || intent.status !== 'succeeded' || intent.received !== paid.amountCents) throw new Error('TASK04_PROVIDER_OUTCOME_NOT_CONFIRMED');
    const events = await prisma.stripeEvent.count({ where: { attemptId: paid.id } });
    const email = await prisma.commerceEmailOutbox.groupBy({ by: ['dispatchState'], where: { userId: fixture.userId }, _count: true });
    const report = { environment: 'SHARED_DEV_TEST_MODE', orders: 1, attempts: attempts.length, paidAttempts: 1, state: paid.state,
      workState: paid.work.state, providerMode: 'test', providerState: intent.status, receivedCents: intent.received,
      signedWebhookEvents: events, email: email.map(row => ({ state: row.dispatchState, count: row._count })),
      orderReference: `ORD-${orders[0].id.toUpperCase()}`, financialRecordsRetained: true, observedAt: new Date().toISOString() };
    if (!events) throw new Error('TASK04_SIGNED_WEBHOOK_NOT_WITNESSED');
    fs.writeFileSync(path.join(directory, 'witness.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await prisma.$disconnect(); }
}
/** Read-only DB/provider reconciliation; on success writes only the local single-use resume authorization. */
async function reconcileResume(prisma) {
  // Same exclusive lock as the browser run: no reconcile while a run is active, and no run during reconcile.
  const lock = fs.openSync(lockFile, 'wx', 0o600);
  try {
    const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
    if (!/^task04-[a-f0-9-]+@electrohub\.invalid$/.test(fixture.email)) throw new Error('TASK04_FIXTURE_OWNERSHIP_REQUIRED');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (state.runId !== fixture.runId) throw new Error('TASK04_PROGRESS_NOT_BOUND_TO_FIXTURE');
    const owner = await prisma.user.findFirst({ where: { id: fixture.userId, email: fixture.email, role: { name: 'CUSTOMER' } }, select: { id: true } });
    if (!owner) throw new Error('TASK04_FIXTURE_CHANGED_PRESERVED');
    const orders = await prisma.order.findMany({ where: { userId: fixture.userId }, select: { id: true } });
    const attempts = await prisma.paymentAttempt.findMany({ where: { userId: fixture.userId }, include: { work: true } });
    const events = attempts.length ? await prisma.stripeEvent.count({ where: { attemptId: { in: attempts.map(row => row.id) } } }) : 0;
    const intent = attempts.length === 1 && attempts[0].providerIntentId
      ? await require('../dist/services/stripe.provider.js').stripeProvider.retrieve(attempts[0].providerIntentId) : null;
    const classification = classifyResume({ stage: state.stage, orders, attempts, intent, events });
    const report = { reason: classification.reason, resumable: classification.resumable, orders: orders.length, attempts: attempts.length,
      signedEvents: events, attemptExpired: attempts.length === 1 ? attempts[0].expiresAt.getTime() <= Date.now() : null,
      providerStatus: intent?.status ?? null, receivedCents: intent?.received ?? null, capturableCents: intent?.capturable ?? null,
      paymentMethodAttached: intent ? intent.methodType !== null : null, observedAt: new Date().toISOString() };
    if (classification.resumable) writeAtomically(stateFile, withResumeAuthorization(state, classification));
    console.log(JSON.stringify(report));
    if (!classification.resumable) process.exitCode = 2;
    return report;
  } finally { fs.closeSync(lock); fs.rmSync(lockFile, { force: true }); }
}

if (require.main === module) main().catch(error => {
  console.error(require('./stripe-gate-safety.cjs').sanitize(error.message)); process.exitCode = 1;
});
module.exports = { assertAcceptanceTarget, classifyResume, uniquePurchase, withResumeAuthorization, main, RESUME_WINDOW_MS };
