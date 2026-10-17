const safety = require('./stripe-gate-safety.cjs');
const { finishLifecycle, withOwnedCleanup } = require('./acceptance-lifecycle.cjs');
const backendDir = require('node:path').resolve(__dirname, '..');
const RUNNER_BEFORE_PAYMENT_SCENARIOS = new Set(['success', 'decline-retry', 'sca', 'sca-cancel', 'sca-fail', 'sca-refresh']);
function runnerStartPhase(scenario) {
  if (scenario === 'capture-recovery') return 'after-capture-pending';
  return RUNNER_BEFORE_PAYMENT_SCENARIOS.has(scenario) ? 'before-payment' : 'none';
}

async function captureFailureScreenshot(page, file) {
  // A failure can occur after card/3DS input. Never persist hosted field values.
  return page.screenshot({ path: file, fullPage: true, mask: [page.locator('iframe')] });
}

async function markHostedInputsInteractive(page, field) {
  await field.focus();
  require('node:assert/strict').equal(await field.evaluate(input => input === input.ownerDocument.activeElement), true,
    'Hosted card field must accept focus before measuring interactivity');
  await page.evaluate(() => performance.mark('electrohub.payment.inputs-interactive'));
}

async function executeGate(config, options) {
process.env.NODE_ENV = 'test';
process.env.ELECTROHUB_SQL_DIAGNOSTICS = '1';
process.env.FRONTEND_URL = `http://127.0.0.1:${options.frontendPort}`;
process.env.PORT = String(options.backendPort);
const { randomUUID, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { AsyncLocalStorage } = require('node:async_hooks');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');
const variables = config.values;
const verifier = require('./stripe-webhook-verifier.cjs');
const stripeExe = verifier.resolveStripeExecutable();
const frontend = path.resolve(backendDir, '../frontend');
const outputBase = path.resolve(frontend, 'screenshots/stripe-live');
const output = process.env.STRIPE_GATE_OUTPUT_DIR ? path.resolve(process.env.STRIPE_GATE_OUTPUT_DIR) : path.join(outputBase, config.manifest.runId);
const outputRelative = path.relative(outputBase, output);
if (!outputRelative || outputRelative === '..' || outputRelative.startsWith(`..${path.sep}`) || path.isAbsolute(outputRelative)) {
  throw new Error('Stripe gate output must be a new child directory of frontend/screenshots/stripe-live.');
}
if (fs.existsSync(output) && fs.readdirSync(output).length > 0) {
  throw new Error('Stripe gate output directory must be empty to preserve existing evidence.');
}
const label = config.manifest.label; const userId = process.env.STRIPE_GATE_CUSTOMER_ID || randomUUID();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) throw new Error('Fresh fixture customer UUID required.');
const productIds = config.manifest.productIds;
const ownedProcesses = new safety.OwnedProcesses();
const transactionContext = new AsyncLocalStorage();
const network = []; const cliEvents = []; const failures = []; const captures = []; const attemptRequestKeys = [];
const setupPayloads = [];
const apiRequestTiming = new WeakMap(); const providerTimings = []; const transactionTimings = []; const queryTimings = [];
const sqlQueries = []; const setupTransactionFailures = []; const purchaseTransactionDiagnostics = []; const setupPerformanceDiagnostics = [];
const runStartedAt = Date.now();
let paymentReadiness = null;
const scenario = options.scenario;
const resumeRetry = process.env.STRIPE_GATE_RESUME_DECLINE_RETRY === '1';
const resumeRecovery = process.env.STRIPE_GATE_RESUME_RECOVERY === '1';
if (resumeRecovery && (scenario !== 'capture-recovery' || userId !== 'ccff45ca-7180-4795-9ed1-19581ea59fe3' || config.manifest.runId !== '185cea43-13a8-40c7-87d0-0f0fd46413b4')) throw new Error('Recovery reuse must match the explicitly approved isolated fixture');
if (resumeRetry && scenario !== 'decline-retry') throw new Error('Resume is restricted to the approved decline/retry case');
const expectedLines = options.buyNow ? [[productIds[0], 2]] : [[productIds[0], 2], [productIds[1], 3]];
const expectedAmount = options.buyNow ? 1199 : 1349;
let cli, vite, server, browser, prisma, provider, paymentService, originalCapture, cleanupPhase = false;
let acceptancePassed = false; let fixturesCreated = false;
let primaryFailure = null;
const cleanupFailures = [];
let challengeUiMs = null; let challengeResolutionMs = null;
let scopedRunnerReady = false;
let currentScopedRunner = null;
let abortFinancial;
let financialStopReason = null;
const financialAbort = new Promise((_, reject) => { abortFinancial = reject; });
financialAbort.catch(() => {});
let gatePhase = 'preflight'; let activePage = null;
const safe = safety.sanitize;
const shipping = { recipient: 'Stripe Browser Customer', line1: '123 Long Demonstration Boulevard, Building A', line2: 'Apartment 405, Fourth Floor',
  city: 'Demonstration City', state: 'Demonstration Province', postalCode: '12345', country: 'United States', phone: '+1 555 010 2000' };
function listener() {
  return verifier.startListener({ executable: stripeExe, apiKey: variables.STRIPE_SECRET_KEY,
    forwardUrl: `http://127.0.0.1:${options.backendPort}/api/webhooks/stripe`,
    onEventId: (id, type) => cliEvents.push({ id, type }), spawnProcess: (...args) => {
      cli = ownedProcesses.track(spawn(...args)); return cli;
    },
  }).then(result => {
    cli = result.process;
    return result.secret;
  });
}
async function startVite() {
  vite = ownedProcesses.track(spawn(process.execPath, [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1', '--port', String(options.frontendPort), '--strictPort'],
    { cwd: frontend, env: { ...process.env, NODE_ENV: 'development', E2E_API_PROXY_TARGET: `http://127.0.0.1:${options.backendPort}` }, windowsHide: true, stdio: 'ignore' }));
  const deadline = Date.now() + 60000;
  while (true) {
    if (vite.exitCode !== null) throw new Error('Owned frontend server exited.');
    try { if ((await fetch(`http://127.0.0.1:${options.frontendPort}`, { signal: AbortSignal.timeout(1500) })).ok) return; } catch { /* Server readiness, not a loading timer. */ }
    if (Date.now() >= deadline) throw new Error('Frontend readiness failed.');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}
async function runner(id) {
  await paymentService.wake(id);
  const child = ownedProcesses.track(spawn(process.execPath, [path.join(backendDir, 'dist/payment-runner.js'), '--once', `--attempt=${id}`],
    { cwd: backendDir, env: { ...process.env, NODE_ENV: 'test' }, windowsHide: true, stdio: 'ignore' }));
  let spawnFailed = false;
  child.once('error', () => { spawnFailed = true; });
  let code;
  try { code = await verifier.waitForCondition(() => {
    if (spawnFailed) throw new Error('Owned scoped runner could not start.');
    return child.exitCode;
  }, result => result !== null, { timeoutMs: 60000, intervalMs: 250 }); }
  catch (error) { ownedProcesses.stop(child); throw error; }
  assert.equal(code, 0, 'Fresh scoped runner exited successfully');
}
async function startScopedRunner(id) {
  if (currentScopedRunner && currentScopedRunner.exitCode === null) {
    ownedProcesses.stop(currentScopedRunner);
    await verifier.waitForCondition(() => currentScopedRunner.exitCode !== null || currentScopedRunner.signalCode !== null, Boolean, { timeoutMs: 10000, intervalMs: 100 });
  }
  let ready = false;
  let failed = false;
  const child = ownedProcesses.track(spawn(process.execPath, [path.join(backendDir, 'dist/payment-runner.js'), `--attempt=${id}`],
    { cwd: backendDir, env: { ...process.env, NODE_ENV: 'test' }, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }));
  let pending = '';
  child.stdout.on('data', chunk => {
    pending += chunk.toString();
    if (pending.includes('payment.runner.ready')) ready = true;
    if (pending.includes('P2028')) {
      financialStopReason = 'Scoped runner P2028 safety stop; preserve evidence.';
      abortFinancial(new Error(financialStopReason));
    }
    pending = pending.slice(-4096);
  });
  child.once('error', () => { failed = true; });
  await verifier.waitForCondition(() => {
    if (failed || child.exitCode !== null) throw new Error('Owned scoped runner stopped before readiness.');
    return ready;
  }, Boolean, { timeoutMs: 20000, intervalMs: 250 });
  console.log('Owned scoped runner readiness PASS; database round trip verified.');
  scopedRunnerReady = true;
  currentScopedRunner = child;
}
async function verifyPaid(id) {
  const paid = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id }, include: { order: { include: { payment: true, items: true } }, work: true } });
  assert.equal(paid.userId, userId);
  assert.equal(paid.state, 'PAID');
  assert.equal(paid.order?.payment?.status, 'SUCCEEDED');
  assert.equal(paid.order.payment.amount.mul(100).toNumber(), expectedAmount);
  assert.equal(paid.work?.state, 'DONE');
  assert.equal(await prisma.order.count({ where: { userId } }), 1);
  assert.equal(await prisma.payment.count({ where: { order: { userId } } }), 1);
  assert.deepEqual(paid.order.items.map(item => [item.productId, item.quantity]).sort(), [...expectedLines].sort());
  const intent = await provider.retrieve(paid.providerIntentId);
  require('../dist/services/payment.domain.js').verifyBinding({ ...paid, items: [] }, intent);
  assert.equal(intent.status, 'succeeded');
  assert.equal(intent.received, expectedAmount);
  for (const productId of productIds) {
    const purchased = expectedLines.find(item => item[0] === productId)?.[1] ?? 0;
    assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId } })).quantity, 10 - purchased);
  }
  const cartLines = await prisma.cartItem.findMany({ where: { cart: { userId } }, select: { productId: true, quantity: true } });
  assert.deepEqual(cartLines.map(item => [item.productId, item.quantity]).sort(), options.buyNow ? [[productIds[0], 2], [productIds[1], 3]].sort() : []);
  if (options.buyNow) { assert.equal(paid.cartId, null); assert.equal(paid.activeCartId, null); }
  assert.ok(providerTimings.some(item => item.method === 'capture' && item.result === 'success') || scenario === 'capture-recovery' || scopedRunnerReady,
    'Capture requires an instrumented provider operation or a verified owned runner plus authoritative succeeded/received readback');
  return paid;
}
function instrumentPaymentDiagnostics() {
  prisma.$on('query', event => {
    const verb = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.exec(event.query)?.[1]?.toUpperCase() ?? 'OTHER';
    const table = /\b(?:FROM|INTO|UPDATE|JOIN)\s+(?:"?[a-z_][a-z0-9_]*"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/i.exec(event.query)?.[1]?.toLowerCase() ?? 'unknown';
    sqlQueries.push({ startedAtMs: Date.now() - runStartedAt - event.duration, durationMs: event.duration, operation: `${verb}_${table}` });
  });
  const appLogger = require('../dist/utils/logger.js').logger;
  appLogger.clear();
  appLogger.info = (...args) => {
    const metadata = args[1];
    if (metadata?.event === 'order.purchase.transaction') purchaseTransactionDiagnostics.push(metadata);
    if (['payment.setup.performance', 'payment.setup.http_performance'].includes(metadata?.event)) setupPerformanceDiagnostics.push(metadata);
    return appLogger;
  };
  appLogger.warn = (...args) => {
    const metadata = args[1];
    if (metadata?.event === 'payment.setup.transaction_failed') {
      setupTransactionFailures.push({ stage: metadata.stage, prismaCode: metadata.prismaCode, sqlState: metadata.sqlState,
        retryable: metadata.retryable, transactionAborted: metadata.transactionAborted, retryNumber: metadata.retryNumber,
        willRetry: metadata.willRetry });
    }
    if (metadata?.event === 'order.purchase.transaction') purchaseTransactionDiagnostics.push(metadata);
    return appLogger;
  };
  for (const method of ['account', 'create', 'retrieve', 'capture', 'cancel', 'refund', 'retrieveRefund']) {
    const original = provider[method].bind(provider);
    provider[method] = async (...args) => {
      assert.notEqual(transactionContext.getStore(), true, 'Stripe operation must remain outside the transaction');
      const started = Date.now(); let result = 'success';
      try { return await original(...args); }
      catch (error) { result = 'error'; throw error; }
      finally { if (!cleanupPhase) providerTimings.push({ method, startedAtMs: started - runStartedAt, durationMs: Date.now() - started, result }); }
    };
  }

  const transaction = prisma.$transaction.bind(prisma);
  prisma.$transaction = (...args) => {
    const started = Date.now();
    const startedAtMs = started - runStartedAt;
    let result;
    const instrumentedArgs = args.map((arg, index) => index === 0 && typeof arg === 'function'
      ? callback => transactionContext.run(true, () => arg(instrumentTransactionClient(callback))) : arg);
    const record = (outcome, error) => {
      if (cleanupPhase) return;
      const finishedAtMs = Date.now() - runStartedAt;
      const code = error && typeof error === 'object' && typeof error.code === 'string' && /^[A-Z]\d{4}$/.test(error.code) ? error.code : undefined;
      const rawSqlState = error && typeof error === 'object' && error.meta && typeof error.meta.code === 'string' ? error.meta.code : undefined;
      const sqlState = rawSqlState && /^[0-9A-Z]{5}$/.test(rawSqlState) ? rawSqlState : undefined;
      transactionTimings.push({ startedAtMs, durationMs: finishedAtMs - startedAtMs, finishedAtMs, result: outcome,
        ...(code ? { prismaCode: code } : {}), ...(sqlState ? { sqlState } : {}) });
      if (code === 'P2028') {
        financialStopReason = 'P2028 safety stop: preserve pending financial evidence; do not retry the purchase.';
        abortFinancial(new Error(financialStopReason));
      }
    };
    try { result = transaction(...instrumentedArgs); }
    catch (error) { record('error', error); throw error; }
    return Promise.resolve(result).then(value => { record('success'); return value; }, error => { record('error', error); throw error; });
  };
}
function instrumentTransactionClient(tx) {
  const delegates = new WeakMap();
  return new Proxy(tx, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (typeof property === 'string' && ['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe'].includes(property) && typeof value === 'function') {
      return (...parameters) => {
        const started = Date.now(); let result;
        try { result = Reflect.apply(value, target, parameters); }
        catch (error) { if (!cleanupPhase) queryTimings.push({ model: '$raw', operation: property, startedAtMs: started - runStartedAt, durationMs: Date.now() - started, result: 'error' }); throw error; }
        return Promise.resolve(result).finally(() => {
          if (!cleanupPhase) queryTimings.push({ model: '$raw', operation: property, startedAtMs: started - runStartedAt, durationMs: Date.now() - started, result: 'settled' });
        });
      };
    }
    if (!value || typeof value !== 'object' || typeof property !== 'string' || property.startsWith('$') || property.startsWith('_')) return value;
    if (delegates.has(value)) return delegates.get(value);
    const delegate = new Proxy(value, { get(model, operation) {
      const method = Reflect.get(model, operation, model);
      if (typeof method !== 'function') return method;
      return (...parameters) => {
        const started = Date.now();
        let result;
        try { result = Reflect.apply(method, model, parameters); }
        catch (error) { if (!cleanupPhase) queryTimings.push({ model: property, operation: String(operation), startedAtMs: started - runStartedAt, durationMs: Date.now() - started, result: 'error' }); throw error; }
        return Promise.resolve(result).finally(() => {
          if (!cleanupPhase) queryTimings.push({ model: property, operation: String(operation), startedAtMs: started - runStartedAt, durationMs: Date.now() - started, result: 'settled' });
        });
      };
    } });
    delegates.set(value, delegate);
    return delegate;
  } });
}
function printPaymentDiagnostics() {
  const setupRequests = network.filter(request => request.method === 'POST' && request.path === '/api/checkout/payment-attempts' && request.finishedAtMs !== undefined);
  const diagnostics = {
    scenario,
    apiRequests: network,
    paymentSetupSqlStatements: setupRequests.map(request => {
      const statements = sqlQueries.filter(query => query.startedAtMs >= request.startedAtMs && query.startedAtMs <= request.finishedAtMs);
      return { startedAtMs: request.startedAtMs, durationMs: request.durationMs, count: statements.length,
        operations: statements.map(({ operation, durationMs }) => ({ operation, durationMs })) };
    }),
    paymentReadiness,
    providerCalls: providerTimings,
    dbTransactions: transactionTimings.map(transaction => ({ ...transaction,
      sqlStatementCount: sqlQueries.filter(query => query.startedAtMs >= transaction.startedAtMs && query.startedAtMs <= transaction.finishedAtMs).length })),
    transactionQueries: queryTimings,
    purchaseTransactions: purchaseTransactionDiagnostics.map(transaction => ({
      outcome: transaction.outcome, failureStage: transaction.failureStage ?? null, prismaCode: transaction.prismaCode ?? null,
      sqlState: transaction.sqlState ?? null, transactionOutcome: transaction.transactionOutcome ?? transaction.outcome,
      retryNumber: transaction.retryNumber, retryCount: transaction.retryCount, willRetry: transaction.willRetry ?? false,
      preflightDurationMs: transaction.preflightDurationMs,
      acquisitionAndBeginMs: transaction.acquisitionAndBeginMs,
      transactionBodyMs: transaction.transactionBodyMs, commitAndResolutionMs: transaction.commitAndResolutionMs ?? null,
      rollbackAndResolutionMs: transaction.rollbackAndResolutionMs ?? null, transactionDurationMs: transaction.transactionDurationMs,
      stageTimings: (transaction.stageTimings ?? []).map(stage => {
        const startedAtMs = stage.startedAtEpochMs - runStartedAt;
        const endedAtMs = stage.endedAtEpochMs - runStartedAt;
        const statements = sqlQueries.filter(query => query.startedAtMs >= startedAtMs && query.startedAtMs <= endedAtMs);
        return { stage: stage.stage, elapsedMs: stage.elapsedMs, prismaOperationCount: stage.prismaOperationCount,
          sqlStatementCount: statements.length,
          sqlStatements: statements.map(({ operation, durationMs }) => ({ operation, durationMs })) };
      }),
    })),
    sqlStatementCount: sqlQueries.length,
    setupTransactionFailures,
    setupPerformanceDiagnostics,
    hostedChallenge: { challengeUiMs, challengeResolutionMs },
  };
  if (fs.existsSync(output)) fs.writeFileSync(path.join(output, 'payment-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
  console.log('PAYMENT_DIAGNOSTIC ' + JSON.stringify(diagnostics));
}
return withOwnedCleanup(async () => {
  try {
    await safety.assertPortAvailable(options.backendPort);
    await safety.assertPortAvailable(options.frontendPort);
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'fixture-ownership.json'), JSON.stringify({ ...config.manifest, userId, fixturesCreated: false }, null, 2));
    gatePhase = 'webhook listener and DEV preflight';
    process.env.STRIPE_WEBHOOK_SECRET = await listener();
    const app = require('../dist/app.js').default; prisma = require('../dist/lib/prisma.js').prisma;
    const env = require('../dist/config/env.js').env; const { hashPassword } = require('../dist/utils/hash.js');
    provider = require('../dist/services/stripe.provider.js').stripeProvider;
    paymentService = require('../dist/services/payment.service.js').paymentService;
    instrumentPaymentDiagnostics();
    for (const name of ['DATABASE_URL', 'DIRECT_URL', 'STRIPE_SECRET_KEY', 'DB_SSL_CA_CERT_PATH']) if (env[name] !== variables[name]) throw new Error('Runtime environment must match approved preflight.');
    assert.equal(env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_WEBHOOK_SECRET, 'Backend uses active listener signing secret');
    assert.ok(safety.describeDatabase(env.DIRECT_URL || env.DATABASE_URL).dev, 'Exact DEV targeting required');
    const ledger = await prisma.$queryRaw`SELECT migration_name, checksum FROM "_prisma_migrations" WHERE migration_name IN ('20261007000000_stripe_orchestration','20261009000000_product_test_fixture_visibility') AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    for (const migration of ['20261007000000_stripe_orchestration', '20261009000000_product_test_fixture_visibility']) {
      assert.equal(ledger.find(item => item.migration_name === migration)?.checksum, createHash('sha256').update(fs.readFileSync(path.join(backendDir, 'prisma/migrations', migration, 'migration.sql'))).digest('hex'));
    }
    safety.assertFixtureProducts(await prisma.product.findMany({ where: { id: { in: productIds } }, include: { inventory: true, category: true } }), config.manifest);
    safety.assertCanonicalStripeAccount(await provider.account());
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
    const priorOwner = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (priorOwner && !resumeRetry && !resumeRecovery) throw new Error('Planned fixture customer already exists; preserve prior evidence.');
    if (resumeRecovery) {
      assert.equal(priorOwner?.email, label + '@example.invalid');
      const existing = await prisma.paymentAttempt.findMany({ where: { userId }, include: { work: true } });
      assert.equal(existing.length, 1);
      const saved = existing[0];
      assert.equal(saved.state, 'CANCELED'); assert.equal(saved.work?.state, 'DONE');
      assert.equal(saved.orderId, null); assert.equal(saved.activeCartId, null);
      assert.equal(await prisma.order.count({ where: { userId } }), 0);
      const intent = await provider.retrieve(saved.providerIntentId);
      require('../dist/services/payment.domain.js').verifyBinding(saved, intent);
      assert.equal(intent.status, 'canceled'); assert.equal(intent.received, 0); assert.equal(intent.capturable, 0);
      const lines = await prisma.cartItem.findMany({ where: { cart: { userId } } });
      assert.equal(lines.length, 2);
      for (const [index, productId] of productIds.entries()) assert.equal(lines.find(line => line.productId === productId)?.quantity, index ? 3 : 2);
    }
    if (resumeRetry) {
      assert.equal(priorOwner?.email, label + '@example.invalid');
      const existing = await prisma.paymentAttempt.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
      assert.equal(await prisma.order.count({where:{userId}}),0);
      if (existing.length === 1 && existing[0].state === 'DECLINED') {
        const rejected = existing[0];
        assert.equal(rejected.orderId, null);
        const intent = await provider.retrieve(rejected.providerIntentId);
        require('../dist/services/payment.domain.js').verifyBinding(rejected, intent);
        assert.equal(intent.status, 'requires_payment_method'); assert.equal(intent.received, 0); assert.equal(intent.capturable, 0);
      } else {
        assert.equal(existing.length, 2); assert.equal(existing[0].state, 'CANCELED'); assert.equal(existing[1].state, 'AWAITING_INPUT');
        for (const saved of existing) { const intent=await provider.retrieve(saved.providerIntentId); require('../dist/services/payment.domain.js').verifyBinding(saved,intent); assert.equal(intent.received,0); assert.equal(intent.status, saved === existing[0] ? 'canceled' : 'requires_payment_method'); }
      }
      const cartLines = await prisma.cartItem.findMany({ where: { cart: { userId } } });
      assert.equal(cartLines.length, 2);
      for (const [index, productId] of productIds.entries()) assert.equal(cartLines.find(line => line.productId === productId)?.quantity, index ? 3 : 2);
      for (const productId of productIds) assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId } })).quantity, 10);
    }
    const email = `${label}@example.invalid`; const password = `Browser-${randomUUID()}-Aa1!`;
    fixturesCreated = true;
    fs.writeFileSync(path.join(output, 'fixture-ownership.json'), JSON.stringify({ ...config.manifest, userId, fixturesCreated }, null, 2));
    if (resumeRetry || resumeRecovery) await prisma.user.update({where:{id:userId},data:{passwordHash:await hashPassword(password)}});
    else await prisma.user.create({ data: { id: userId, roleId: role.id, email, passwordHash: await hashPassword(password), firstName: 'Stripe', lastName: 'Browser', emailVerifiedAt: new Date() } });
    const cartService = new (require('../dist/services/cart.service.js').CartService)();
    if (!resumeRetry && !resumeRecovery) for (const [productId, quantity] of [[productIds[0], 2], [productIds[1], 3]]) await cartService.add(userId, { productId, quantity });
    const OrderService = require('../dist/services/order.service.js').OrderService;
    const commitAuthorized = OrderService.prototype.commitAuthorized;
    OrderService.prototype.commitAuthorized = async function(id, intent, leaseToken) {
      const current = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id }, include: { items: true } });
      assert.equal(current.userId, userId, 'Harness cannot execute another customer purchase');
      require('../dist/services/payment.domain.js').verifyAuthorization(current, await provider.retrieve(current.providerIntentId));
      return commitAuthorized.call(this, id, intent, leaseToken);
    };
    server = await new Promise((resolve, reject) => { const current = app.listen(options.backendPort, '127.0.0.1', () => resolve(current)); current.on('error', reject); });
    await startVite(); fs.mkdirSync(output, { recursive: true });
    browser = await chromium.launch({ headless: true }); const context = await browser.newContext({ baseURL: `http://127.0.0.1:${options.frontendPort}`, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(180000);
    await page.addInitScript(() => {
      let currentCount = 0; let visibleSince = null; let totalVisibleMs = 0; let maxConcurrent = 0;
      const update = () => {
        const nextCount = document.querySelectorAll('[aria-label="Loading secure payment form"]').length;
        maxConcurrent = Math.max(maxConcurrent, nextCount);
        if (currentCount === 0 && nextCount > 0) visibleSince = performance.now();
        if (currentCount > 0 && nextCount === 0 && visibleSince !== null) {
          totalVisibleMs += performance.now() - visibleSince;
          visibleSince = null;
        }
        currentCount = nextCount;
      };
      new MutationObserver(update).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] });
      update();
      window.__paymentSkeletonStats = () => {
        update();
        return { totalVisibleMs: Math.round(totalVisibleMs + (visibleSince === null ? 0 : performance.now() - visibleSince)), maxConcurrent };
      };
    });
    const slowNetwork = options.slow;
    if (slowNetwork) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400,
        downloadThroughput: 100 * 1024, uploadThroughput: 50 * 1024 });
      console.log('Real browser network: 400ms latency, 100KiB/s download, 50KiB/s upload.');
    }
    page.on('pageerror', error => failures.push(safe(error.message)));
    page.on('console', value => { if (value.type() === 'error') console.log(JSON.stringify({ browserError: safe(value.text()).replace(/https?:\/\/\S+/g, '[URL REDACTED]') })); });
    page.on('console', value => { if (value.text().startsWith('PAYMENT_DIAGNOSTIC')) console.log(value.text()); });
    page.on('requestfailed', value => { const url = new URL(value.url()); if (url.hostname.includes('stripe')) console.log(JSON.stringify({ providerRequest: url.hostname + url.pathname, failure: value.failure()?.errorText })); });
    page.on('request', value => {
      const url = new URL(value.url());
      if (!url.pathname.startsWith('/api/')) return;
      if (url.pathname === '/api/checkout/payment-attempts' && value.method() === 'POST') {
        attemptRequestKeys.push(value.headers()['idempotency-key'] ?? null);
        setupPayloads.push(value.postDataJSON());
      }
      const record = { method: value.method(), path: url.pathname.replace(/\/[0-9a-f-]{36}(?=\/|$)/ig, '/:id'), startedAtMs: Date.now() - runStartedAt, durationMs: null };
      const correlationId = value.headers()['x-request-id'];
      if (correlationId && /^[a-z0-9-]{1,100}$/i.test(correlationId)) record.correlationId = correlationId;
      network.push(record); apiRequestTiming.set(value, { record, started: Date.now() });
    });
    page.on('requestfinished', value => {
      const timing = apiRequestTiming.get(value); if (timing) { timing.record.durationMs = Date.now() - timing.started; timing.record.finishedAtMs = Date.now() - runStartedAt; }
    });
    page.on('requestfailed', value => {
      const timing = apiRequestTiming.get(value);
      if (timing) { timing.record.durationMs = Date.now() - timing.started; timing.record.finishedAtMs = Date.now() - runStartedAt; timing.record.failed = true; }
    });
    activePage = page;
    gatePhase = 'authenticated login and fixture Cart setup';
    const login = await context.request.post('/api/auth/login', { data: { email, password } }); assert.equal(login.status(), 200);
    const accessToken = (await login.json()).accessToken;
    const seededLines = await prisma.cartItem.findMany({ where: { cart: { userId } }, select: { productId: true, quantity: true } });
    assert.deepEqual(seededLines.map(value => [value.productId, value.quantity]).sort(),
      [[productIds[0], 2], [productIds[1], 3]].sort());
    const screenshot = async state => {
      for (const width of [390, 768, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        if (state === 'payment-ready') {
          const secure = page.frames().find(value => value.url().includes('elements-inner-accessory-target'));
          assert.ok(secure, 'Actual hosted card frame remains mounted');
          // Stripe responds to parent resize asynchronously. Assert usable hosted fields,
          // not a fixed sleep or a screenshot taken between its responsive layouts.
          await secure.waitForFunction(() => {
            const number = document.querySelector('input[name="number"]');
            return number && number.getBoundingClientRect().width >= Math.min(200, innerWidth * 0.6);
          });
        }
        if (state.startsWith('sca-surrounding')) {
          // Provider resize can briefly replace the ACS with its bank splash.
          // Trial activation waits for an uncovered, stable real control without
          // completing authentication or imposing a screenshot delay.
          let actionable = false;
          for (const candidate of page.frames()) {
            const control = candidate.getByRole('button', { name: scenario === 'sca-cancel' ? /^Cancel$/i : scenario === 'sca-fail' ? /^Fail$/i : /^Complete$/i });
            if (await control.isVisible()) { await control.click({ trial: true }); actionable = true; break; }
          }
          assert.ok(actionable, 'Real authentication control actionable at capture width');
          for (const candidate of page.frames()) {
            if (candidate.url().includes('three-ds-2-challenge') || candidate.url().includes('3d_secure_2_test')) {
              await candidate.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
            }
          }
        }
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        // Full-page capture temporarily changes Chromium's viewport height and can
        // distort third-party responsive iframes. Capture actual visible card entry;
        // other full-page states separately retain Header/Footer composition proof.
        const file = path.join(output, `${state}-${width}.png`); await page.screenshot({ path: file, fullPage: state !== 'payment-ready' && !state.startsWith('sca-surrounding') }); captures.push(file); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${state} ${width} overflow`);
      }
    };
    gatePhase = 'Authenticated Checkout and PaymentAttempt setup';
    if (options.buyNow) {
      await page.goto('/');
      await page.evaluate(selection => sessionStorage.setItem('electrohub:buynow:v1', JSON.stringify(selection)), { productId: productIds[0], quantity: 2 });
    }
    await page.goto(options.buyNow ? '/checkout/buy-now' : '/checkout');
    await page.getByRole('heading', { name: 'Shipping Information' }).waitFor();
    for (const [field, value] of Object.entries(shipping)) await page.locator(`#shipping-${field}`).fill(value);
    await page.getByRole('button', { name: 'Continue to Delivery' }).click(); await page.getByRole('radio', { name: /Express Delivery/ }).check();
    gatePhase = 'PaymentAttempt setup and Payment Element readiness';
    await page.getByRole('button', { name: 'Continue to Payment' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Review Order' && !button.disabled));
    const frame = page.frameLocator('iframe[src*="elements-inner-accessory-target"]');
    await markHostedInputsInteractive(page, frame.getByLabel('Card number', { exact: true }));
    const readFrontendTiming = () => page.evaluate(() => {
      const names = ['payment-step-entered', 'payment-setup-start', 'payment-request-start', 'payment-request-response', 'payment-setup-response', 'client-secret-received', 'stripe-client-init-start', 'stripe-client-init-ready', 'elements-mounted', 'elements-context-ready', 'payment-element-loader-start', 'payment-element-ready', 'inputs-interactive'];
      const latest = name => performance.getEntriesByName(`electrohub.payment.${name}`, 'mark').at(-1)?.startTime ?? null;
      const delta = (from, to) => latest(from) === null || latest(to) === null ? null : Math.round(latest(to) - latest(from));
      return {
        correlationId: performance.getEntriesByName('electrohub.payment.payment-request-start', 'mark').at(-1)?.detail?.correlationId ?? null,
        frontendRequestMs: delta('payment-request-start', 'payment-request-response'),
        paymentElementInitializationMs: delta('elements-mounted', 'payment-element-ready'),
        stepToOnReadyMs: delta('payment-step-entered', 'payment-element-ready'),
        totalInteractiveReadyMs: delta('payment-step-entered', 'inputs-interactive'),
        readinessSemantics: 'onReady separately timed; interactivity requires hosted card field focus; typing excluded',
        marks: Object.fromEntries(names.map(name => [name, latest(name) === null ? null : Math.round(latest(name))])),
        stripeClientInitMs: delta('stripe-client-init-start', 'stripe-client-init-ready'),
        apiToElementsContextMs: delta('payment-setup-response', 'elements-context-ready'),
        elementsMountMs: delta('elements-context-ready', 'payment-element-loader-start'),
        paymentElementReadyMs: delta('payment-element-loader-start', 'payment-element-ready'),
        setupStartToPaymentElementReadyMs: delta('payment-setup-start', 'payment-element-ready'),
        skeleton: window.__paymentSkeletonStats?.() ?? null,
      };
    });
    const readAttempt = () => prisma.paymentAttempt.findMany({ where: { userId }, select: { id: true, providerIntentId: true }, orderBy: {createdAt:'desc'} });
    await screenshot('payment-ready'); assert.equal(await prisma.order.count({ where: { userId } }), 0);
    const firstAttempt = await readAttempt(); assert.equal(firstAttempt.length, resumeRetry || resumeRecovery ? 2 : 1);
    if (runnerStartPhase(scenario) === 'before-payment') await startScopedRunner(firstAttempt[0].id);
    const ownedAttempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: firstAttempt[0].id }, include: { items: true } });
    const readyIntent = await provider.retrieve(ownedAttempt.providerIntentId);
    require('../dist/services/payment.domain.js').verifyBinding(ownedAttempt, readyIntent);
    assert.equal(readyIntent.amount, expectedAmount); assert.equal(readyIntent.received, 0);
    const firstFrontendTiming = await readFrontendTiming();
    const firstSetupRequest = network.find(value => value.method === 'POST' && value.path === '/api/checkout/payment-attempts');
    gatePhase = 'refresh and same-attempt Payment Element recovery';
    await page.reload();
    await frame.getByLabel('Card number', { exact: true }).waitFor();
    await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
    await markHostedInputsInteractive(page, frame.getByLabel('Card number', { exact: true }));
    const resumedAttempt = await readAttempt();
    assert.equal(resumedAttempt.length, resumeRetry || resumeRecovery ? 2 : 1, 'Refresh reuses the existing database attempt');
    assert.equal(resumedAttempt[0].id, firstAttempt[0].id);
    assert.equal(resumedAttempt[0].providerIntentId, firstAttempt[0].providerIntentId, 'Refresh reuses the existing Stripe PaymentIntent');
    assert.equal(attemptRequestKeys.length, 2, 'One initial setup request and one safe refresh/reuse request');
    assert.ok(attemptRequestKeys[0]); assert.equal(attemptRequestKeys[1], attemptRequestKeys[0], 'Refresh reuses the original idempotency key');
    const secondSetupRequest = network.filter(value => value.method === 'POST' && value.path === '/api/checkout/payment-attempts')[1];
    const createsBeforeReplay = providerTimings.filter(item => item.method === 'create').length;
    const replay = await context.request.post('/api/checkout/payment-attempts', { data: setupPayloads[0],
      headers: { Authorization: `Bearer ${accessToken}`, 'Idempotency-Key': attemptRequestKeys[0] } });
    assert.equal(replay.status(), 200);
    assert.equal((await replay.json()).data.attemptId, firstAttempt[0].id);
    assert.equal(providerTimings.filter(item => item.method === 'create').length, createsBeforeReplay);
    paymentReadiness = {
      firstLoad: { ...firstFrontendTiming, paymentSetupApiMs: firstSetupRequest?.durationMs ?? null },
      refreshReuse: { ...(await readFrontendTiming()), paymentSetupApiMs: secondSetupRequest?.durationMs ?? null },
      attemptCountAfterRefresh: resumedAttempt.length,
    };
    assert.equal(await prisma.order.count({ where: { userId } }), 0);
    await frame.getByLabel('Card number', { exact: true }).fill(scenario.startsWith('decline') && !resumeRetry ? '4000000000000002' : scenario.startsWith('sca') ? '4000000000003220' : '4242424242424242');
    await frame.getByLabel(/Expiration/).fill('1230');
    gatePhase = 'secure card entry and Review';
    await frame.getByLabel('Security code', { exact: true }).fill('123');
    const postal = frame.getByLabel(/ZIP|Postal code/); if (await postal.count()) await postal.fill('12345');
    assert.equal(await prisma.order.count({ where: { userId } }), 0);
    console.log('Browser stage: hosted entry captured before data entry, fields filled in memory; no Order before Review.');
    await page.getByRole('button', { name: 'Review Order' }).focus(); await page.keyboard.press('Enter'); console.log('Browser stage: Review control activated by keyboard.'); await page.getByRole('heading', { name: 'Review Your Order' }).waitFor();
    assert.equal(await prisma.order.count({ where: { userId } }), 0); await screenshot('review');
    console.log('Browser stage: Review reached without authorization/purchase.');
    // Back/Edit must keep the exact iframe and secure entry; only the final consent confirms.
    await page.getByRole('button', { name: /3\. Payment/ }).click(); await frame.getByLabel('Card number', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Review Order' }).focus(); await page.keyboard.press('Enter'); await page.getByRole('heading', { name: 'Review Your Order' }).waitFor();
    if (slowNetwork && scenario === 'capture-recovery' && !options.buyNow) {
      const second = await context.newPage(); second.setDefaultTimeout(60000);
      await second.goto('/checkout'); await second.getByRole('heading', { name: 'Shipping Information' }).waitFor();
      for (const [field, value] of Object.entries(shipping)) await second.locator(`#shipping-${field}`).fill(value);
      await second.getByRole('button', { name: 'Continue to Delivery' }).click();
      await second.getByRole('button', { name: 'Continue to Payment' }).click();
      await second.getByRole('alert').waitFor();
      assert.equal(await prisma.paymentAttempt.count({ where: { userId } }), 1);
      assert.equal(await prisma.order.count({ where: { userId } }), 0);
      await second.close();
      console.log('Real second-tab setup blocked; one attempt, no premature Order.');
    }
    if (scenario.startsWith('sca')) {
      const paymentStarted = Date.now();
      const challengeReady = page.waitForEvent('framenavigated', { predicate: value => value.url().includes('three-ds-2-challenge') });
      await page.getByRole('button', { name: /Place Order/ }).focus(); await page.keyboard.press('Enter');
      await challengeReady;
      const activeCheckoutUrl = page.url();
      assert.equal(new URL(activeCheckoutUrl).pathname, options.buyNow ? '/checkout/buy-now' : '/checkout');
      await expect(page.getByTestId('header-lock-wrapper')).toHaveAttribute('inert', '');
      await expect(page.getByTestId('footer-lock-wrapper')).toHaveAttribute('inert', '');
      await page.locator('header a[href="/products"]').evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })));
      await expect(page).toHaveURL(activeCheckoutUrl);
      await page.evaluate(() => window.history.back()); await expect(page).toHaveURL(activeCheckoutUrl);
      await page.evaluate(() => window.history.forward()); await expect(page).toHaveURL(activeCheckoutUrl);
      console.log('Real test authentication frame reached; no provider payload printed.');
      await expect.poll(async () => {
        for (const candidate of page.frames()) {
          if (await candidate.getByRole('button', { name: scenario === 'sca-cancel' ? /^Cancel$/i : scenario === 'sca-fail' ? /^Fail$/i : /^Complete$/i }).isVisible()) return true;
        }
        return false;
      }, { message: 'Hosted authentication UI ready before visual capture', timeout: 60000 }).toBe(true);
      challengeUiMs = Date.now() - paymentStarted;
      for (const width of [390, 768, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect.poll(async () => {
          for (const candidate of page.frames()) {
            if (await candidate.getByRole('button', { name: scenario === 'sca-cancel' ? /^Cancel$/i : scenario === 'sca-fail' ? /^Fail$/i : /^Complete$/i }).isVisible()) return true;
          }
          return false;
        }, { message: `Hosted authentication control remains visible at ${width}px`, timeout: 30000 }).toBe(true);
        await screenshot(`sca-challenge-${width}`);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await screenshot('sca-surrounding');
      // The official test ACS can be nested under a different provider origin.
      // Locate its visible test control by accessible name, without assuming a URL.
      const authenticationCompletedAt = Date.now();
      const authenticationFrame = await verifier.waitForCondition(async () => {
        for (const candidate of page.frames()) {
          const complete = candidate.getByRole('button', { name: scenario === 'sca-cancel' ? /^Cancel$/i : scenario === 'sca-fail' ? /^Fail$/i : /^Complete$/i });
          if (await complete.isVisible()) return candidate;
        }
        return null;
      }, candidate => Boolean(candidate), { timeoutMs: 60000, intervalMs: 250 });
      await authenticationFrame.getByRole('button', { name: scenario === 'sca-cancel' ? /^Cancel$/i : scenario === 'sca-fail' ? /^Fail$/i : /^Complete$/i }).focus();
      await page.keyboard.press('Enter');
      if (scenario === 'sca-cancel' || scenario === 'sca-fail') {
        await page.getByRole('heading', { name: 'Payment Failed', exact: true }).waitFor();
        await expect(page.getByRole('button', { name: 'Check payment status', exact: true })).toHaveCount(0);
        await screenshot(scenario === 'sca-fail' ? 'sca-failed' : 'sca-canceled');
        const canceled = await prisma.paymentAttempt.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: 'desc' } });
        assert.equal(canceled.orderId, null); assert.equal(await prisma.order.count({ where: { userId } }), 0);
        assert.equal(await prisma.cartItem.count({ where: { cart: { userId } } }), 2);
        for (const productId of productIds) assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId } })).quantity, 10);
        const intent = await provider.retrieve(canceled.providerIntentId);
        assert.equal(intent.received, 0); assert.notEqual(intent.status, 'requires_capture');
        assert.equal(await page.getByText('Total Paid', { exact: true }).count(), 0);
        fs.writeFileSync(path.join(output, scenario === 'sca-fail' ? 'sca-fail-evidence.json' : 'sca-cancel-evidence.json'), JSON.stringify({ scenario, result: 'PASS', attemptId: canceled.id, state: canceled.state, screenshots: captures, network }, null, 2));
        challengeResolutionMs = Date.now() - authenticationCompletedAt;
        acceptancePassed = true;
        console.log('REAL hosted browser ' + scenario + ' PASS; terminal Payment Failed shown, no Order, Cart/Inventory preserved.'); return;
      }
      if (scenario === 'sca-refresh') {
        const before = await prisma.paymentAttempt.findUniqueOrThrow({where:{id:firstAttempt[0].id}});
        await verifier.waitForCondition(async () => { const live = await provider.retrieve(before.providerIntentId); if(live.status === 'succeeded') throw new Error('Interruption window already completed; preserve purchase, do not resubmit'); return live.status; }, state => state === 'requires_capture', {timeoutMs:10000,intervalMs:250});
        page.on('dialog', dialog => dialog.accept());
        await page.reload();
        const after = await readAttempt(); assert.equal(after.length,1); assert.equal(after[0].id,before.id); assert.equal(after[0].providerIntentId,before.providerIntentId);
        console.log('Real reload during provider requires_capture; same durable attempt/intent; no second submission.');
      }
      await page.getByRole('heading', { name: 'Order Confirmed!' }).waitFor(); challengeResolutionMs = Date.now() - authenticationCompletedAt; await screenshot('sca-paid-confirmation');
      const paid = await verifyPaid(firstAttempt[0].id);
      fs.writeFileSync(path.join(output, 'sca-evidence.json'), JSON.stringify({ scenario, result: 'PASS', attemptId: paid.id, orderId: paid.orderId, amountCents: expectedAmount, screenshots: captures, network }, null, 2));
      acceptancePassed = true;
      console.log('REAL hosted browser 3DS authentication and captured purchase PASS.');
      return;
    }
    if (!resumeRetry && (scenario === 'decline' || scenario === 'decline-retry')) {
      await page.getByRole('button', { name: /Place Order/ }).focus(); await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: /^(Payment Failed|Payment needs a different card)$/ }).waitFor(); await screenshot('payment-failed');
      const rejected = await prisma.paymentAttempt.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: 'desc' } });
      assert.equal(rejected.state, 'DECLINED'); assert.equal(rejected.orderId, null);
      assert.equal(await prisma.order.count({ where: { userId } }), 0);
      assert.equal(await prisma.cartItem.count({ where: { cart: { userId } } }), 2);
      for (const productId of productIds) assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId } })).quantity, 10);
      assert.equal((await provider.retrieve(rejected.providerIntentId)).status, 'requires_payment_method');
      assert.deepEqual(failures, []);
      fs.writeFileSync(path.join(output, 'decline-evidence.json'), JSON.stringify({ scenario, result: 'PASS', attemptId: rejected.id, paymentReadiness, screenshots: captures, network }, null, 2));
      console.log('REAL hosted browser decline PASS; Cart/Inventory preserved, no Order, four-width failure captures.');
      if (scenario === 'decline-retry') {
        gatePhase = 'genuine decline to fresh secure retry';
        await page.getByRole('button', { name: 'Try Again', exact: true }).click();
        await frame.getByLabel('Card number', { exact: true }).waitFor();
        const secondAttempt = await verifier.waitForCondition(readAttempt, rows => rows.length === 2, { timeoutMs: 20000, intervalMs: 250 });
        const retry = secondAttempt.find(value => value.id !== rejected.id);
        assert.ok(retry && retry.providerIntentId && retry.providerIntentId !== rejected.providerIntentId, 'Fresh attempt and provider intent after genuine decline');
        await startScopedRunner(retry.id);
        await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
        await expect(page.getByText(/Secure card entry is (unavailable|paused)/)).toHaveCount(0);
        await frame.getByLabel('Card number', { exact: true }).fill('4242424242424242');
        await frame.getByLabel(/Expiration/).fill('1230');
        await frame.getByLabel('Security code', { exact: true }).fill('123');
        const retryPostal = frame.getByLabel(/ZIP|Postal code/); if (await retryPostal.count()) await retryPostal.fill('12345');
        await page.getByRole('button', { name: 'Review Order' }).click();
        await page.getByRole('heading', { name: 'Review Your Order' }).waitFor();
        if (financialStopReason) throw new Error(financialStopReason);
        await page.getByRole('button', { name: /Place Order/ }).click();
        await Promise.race([page.getByRole('heading', { name: 'Order Confirmed!' }).waitFor(), financialAbort]);
        const paid = await verifyPaid(retry.id);
        assert.equal(await prisma.paymentAttempt.count({ where: { userId } }), 2);
        assert.equal((await provider.retrieve(rejected.providerIntentId)).received, 0);
        await screenshot('decline-retry-confirmed');
        fs.writeFileSync(path.join(output, 'decline-retry-evidence.json'), JSON.stringify({ result: 'PASS',
          failedAttemptId: rejected.id, failedIntentId: rejected.providerIntentId, attemptId: retry.id,
          intentId: retry.providerIntentId, orderId: paid.orderId, scope: config.scope, screenshots: captures, network }, null, 2));
      }
      acceptancePassed = true;
      return;
    }
    if (scenario === 'success' || resumeRetry) {
      if (financialStopReason) throw new Error(financialStopReason);
      await page.getByRole('button', { name: /Place Order/ }).click();
      await Promise.race([page.getByRole('heading', { name: 'Order Confirmed!' }).waitFor(), financialAbort]);
      const paid = await verifyPaid(firstAttempt[0].id);
      const signedEvent = await verifier.waitForCondition(async () => {
        const rows = await prisma.stripeEvent.findMany({ where: { attemptId: paid.id, type: 'payment_intent.succeeded', disposition: 'ACCEPTED' } });
        return rows.find(row => cliEvents.some(event => event.id === row.id && event.type === row.type));
      }, Boolean, { timeoutMs: 30000, intervalMs: 1000 });
      assert.equal(signedEvent.providerIntentId, paid.providerIntentId);
      const actualEvent = await provider.sdk().events.retrieve(signedEvent.id);
      assert.equal(actualEvent.livemode, false);
      assert.equal(actualEvent.data.object.id, paid.providerIntentId);
      fs.writeFileSync(path.join(output, 'signed-success-webhook.json'), JSON.stringify({ id: signedEvent.id,
        attemptId: paid.id, providerIntentId: paid.providerIntentId, disposition: signedEvent.disposition,
        type: signedEvent.type, providerVerified: true, runnerReady: scopedRunnerReady }, null, 2));
      await screenshot('paid-confirmation');
      await page.reload(); await page.getByText('Total Paid', { exact: true }).waitFor();
      await verifyPaid(paid.id);
      fs.writeFileSync(path.join(output, 'success-evidence.json'), JSON.stringify({ scenario, scope: config.scope, result: 'PASS', attemptId: paid.id, orderId: paid.orderId, screenshots: captures, network }, null, 2));
      acceptancePassed = true;
      return;
    }
    if (currentScopedRunner) {
      ownedProcesses.stop(currentScopedRunner);
      await verifier.waitForCondition(() => currentScopedRunner.exitCode !== null || currentScopedRunner.signalCode !== null, Boolean, {timeoutMs:10000,intervalMs:100});
      console.log('Approved interruption: ready owned scoped runner stopped before controlled capture outage.');
    }
    originalCapture = provider.capture.bind(provider);
    const { captureFault, PRE_PROVIDER_CAPTURE_FAILURE } = require('./capture-fault.cjs');
    const captureOutage = captureFault({ mode: PRE_PROVIDER_CAPTURE_FAILURE, provider });
    provider.capture = captureOutage.capture;
    const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: 'desc' } });
    assert.equal(attempt.amountCents, expectedAmount);
    await page.getByRole('button', { name: /Place Order/ }).focus(); await page.keyboard.press('Enter'); await page.getByText('Processing your order…').waitFor(); await screenshot('processing');
    await page.getByRole('heading', { name: 'Checking your payment' }).waitFor(); await screenshot('unknown-recovery');
    await expect.poll(async () => (await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).state,
      { message: 'Durable recovery worker records the injected capture outage before reload', timeout: 120_000 }).toBe('CAPTURE_PENDING');
    const committed = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } }); assert.equal(committed.state, 'CAPTURE_PENDING'); assert.ok(committed.orderId);
    assert.equal(currentScopedRunner, null, 'Capture recovery must not keep a worker lease open before the order is durably committed');
    assert.equal(await prisma.cartItem.count({ where: { cart: { userId } } }), options.buyNow ? 2 : 0);
    const reloadReconciliation = page.waitForResponse(response => new URL(response.url()).pathname === `/api/checkout/payment-attempts/${attempt.id}/reconcile`);
    await page.reload(); await page.getByRole('heading', { name: 'Checking your payment' }).waitFor();
    await reloadReconciliation;
    captureOutage.assertFired();
    provider.capture = originalCapture;
    // A fresh real process drains the durable claim after the browser lost its callback/entry state.
    await runner(attempt.id);
    // Owned status polling may already navigate after the fresh worker commits Paid.
    // Do not race that transition by requiring a recovery button that should disappear.
    await page.getByRole('heading', { name: 'Order Confirmed!' }).waitFor(); await screenshot('paid-confirmation');
    await page.reload(); await page.getByText('Total Paid', { exact: true }).waitFor();
    const paid = await verifyPaid(attempt.id);
    assert.equal(paid.work.state, 'DONE'); const actualIntent = await provider.retrieve(paid.providerIntentId);
    assert.equal(actualIntent.status, 'succeeded'); assert.equal(actualIntent.received, expectedAmount);
    const accepted = await prisma.stripeEvent.findMany({ where: { attemptId: attempt.id }, select: { id: true, type: true, disposition: true } });
    assert.ok(accepted.some(value => value.type === 'payment_intent.amount_capturable_updated' && value.disposition === 'ACCEPTED'));
    assert.ok(accepted.some(value => value.type === 'payment_intent.succeeded' && value.disposition === 'ACCEPTED'));
    // Replay genuine provider events in reversed order using the local endpoint's
    // signing secret in memory. Original delivery above is real Stripe CLI;
    // these duplicate deliveries prove real DB deduplication, not new provider truth.
    const inventoryBeforeReplay = await prisma.inventory.findMany({ where: { productId: { in: productIds } },
      select: { productId: true, quantity: true }, orderBy: { productId: 'asc' } });
    for (const event of [...accepted].reverse()) {
      const payload = JSON.stringify(await provider.sdk().events.retrieve(event.id));
      const signature = require('stripe').webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
      for (let delivery = 0; delivery < 2; delivery++) {
        const response = await context.request.post('/api/webhooks/stripe', { data: payload,
          headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature } });
        assert.equal(response.status(), 200);
      }
    }
    assert.equal(await prisma.stripeEvent.count({ where: { attemptId: attempt.id } }), accepted.length);
    assert.deepEqual(await prisma.inventory.findMany({ where: { productId: { in: productIds } },
      select: { productId: true, quantity: true }, orderBy: { productId: 'asc' } }), inventoryBeforeReplay);
    assert.equal(await prisma.order.count({ where: { userId } }), 1);
    assert.equal((await prisma.paymentWork.findUniqueOrThrow({ where: { attemptId: attempt.id } })).state, 'DONE');
    assert.equal(network.filter(value => value.method === 'POST' && value.path === '/api/orders').length, 0);
    assert.equal(network.filter(value => value.path.includes('/inventory')).length, 0); assert.deepEqual(failures, []);
    fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({ gate: 'REAL browser/API/DEV/Stripe/CLI/fresh runner', result: 'PASS',
      providerAccount: await provider.account(), attemptId: paid.id, intentId: paid.providerIntentId, orderId: paid.orderId, amountCents: actualIntent.received,
      acceptedEvents: accepted, duplicateReversedDeliveries: accepted.length * 2, cliEvents, captures, network,
      slowNetwork: slowNetwork ? { latencyMs: 400, downloadKiB: 100, uploadKiB: 50 } : null,
      limitations: ['Controlled capture transport fault; duplicate replay uses genuine event bodies with locally generated signatures; decline/3DS use separately labeled runs.'] }, null, 2));
    console.log(JSON.stringify({ gate: 'REAL browser/API/DEV/Stripe/CLI/fresh runner', result: 'PASS', attemptId: paid.id, orderId: paid.orderId,
      capture: actualIntent.received, signedEvents: accepted.length, screenshots: captures.length, output }));
    acceptancePassed = true;
  } catch (error) {
    primaryFailure = error instanceof Error ? error : new Error('Acceptance execution failed.');
    primaryFailure.gateStatus = fixturesCreated ? 'FAILED_ACCEPTANCE' : 'FAILED_PRECONDITION';
    try {
    const failure = { result: 'FAIL', phase: gatePhase, error: safe(String(error.message).split('\n')[0]) };
    if (activePage && !activePage.isClosed()) {
      failure.browser = await activePage.evaluate(() => ({
        path: window.location.pathname,
        headings: [...document.querySelectorAll('h1,h2,h3')].map(value => value.textContent?.trim()).filter(Boolean),
        alerts: [...document.querySelectorAll('[role="alert"]')].map(value => value.textContent?.trim()).filter(Boolean),
        visibleButtons: [...document.querySelectorAll('button')].filter(value => value.offsetParent !== null).map(value => value.textContent?.trim()).filter(Boolean),
      })).catch(() => null);
      if (failure.browser) for (const key of ['headings', 'alerts', 'visibleButtons']) failure.browser[key] = failure.browser[key].map(safe);
      await captureFailureScreenshot(activePage, path.join(output, 'failure-1440.png')).catch(() => undefined);
      if (browser) {
        for (const frame of activePage.frames()) {
          const url = new URL(frame.url() || 'about:blank');
          if (frame === activePage.mainFrame()) continue;
          const fields = await frame.evaluate(() => ({ labels: [...document.querySelectorAll('label')].map(value => value.textContent?.trim().slice(0, 60)),
            buttons: [...document.querySelectorAll('button,input[type="submit"]')].map(value => value.textContent?.trim() || value.getAttribute('value')),
            inputs: [...document.querySelectorAll('input:not([type="hidden"])')].map(value => ({ type: value.getAttribute('type'), name: value.getAttribute('name'), label: value.getAttribute('aria-label'), placeholder: value.getAttribute('placeholder') })) })).catch(() => null);
          console.log(JSON.stringify({ diagnostic: 'provider field labels only; no values/URL parameters', path: url.pathname, fields }));
        }
      }
    }
    if (fs.existsSync(output)) fs.writeFileSync(path.join(output, 'failure-evidence.json'), JSON.stringify(failure, null, 2));
    } catch (diagnosticError) { cleanupFailures.push(diagnosticError); }
    throw primaryFailure;
  }
  }, async () => {
    cleanupPhase = true;
    const disposal = await Promise.allSettled([
      Promise.resolve().then(() => { printPaymentDiagnostics(); }),
      Promise.resolve().then(() => { if (provider && originalCapture) provider.capture = originalCapture; ownedProcesses.stopAll(); }),
      Promise.resolve().then(() => browser ? browser.close() : undefined),
      Promise.resolve().then(() => server ? new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) : undefined),
      Promise.resolve().then(() => prisma ? prisma.$disconnect() : undefined),
      Promise.resolve().then(() => { if (fs.existsSync(output)) fs.writeFileSync(path.join(output, 'run-status.json'), JSON.stringify({
      status: acceptancePassed ? 'READY_TO_RUN' : fixturesCreated ? 'FAILED_ACCEPTANCE' : 'FAILED_PRECONDITION',
      scenario, scope: config.scope, scenarioPassed: acceptancePassed, fullFinancialMatrix: 'NOT_VERIFIED',
      fixturesCreated, userId, fixtureRunId: config.manifest.runId, fixtureCleanup: 'NOT_REQUESTED_PRESERVED',
    }, null, 2)); }),
    ]);
    cleanupFailures.push(...disposal.filter(result => result.status === 'rejected').map(result => result.reason));
    finishLifecycle(null, cleanupFailures);
  });
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const output = dependencies.output || (value => console.log(safety.sanitize(JSON.stringify(value))));
  let report;
  try {
    if (argv.length === 1 && argv[0] === '--offline-bootstrap') {
      const { bootstrapAcceptance } = require('./acceptance-launcher.cjs');
      if (process.env.NODE_ENV !== 'test' || !dependencies.installation || typeof dependencies.offlineScenario !== 'function') throw new Error('Explicit offline bootstrap dependencies required');
      const installed = bootstrapAcceptance(dependencies.installation);
      await installed.run(dependencies.offlineScenario);
      output({ status: 'OFFLINE_VERIFIED', financialAcceptance: 'NOT_VERIFIED' });
      return 0;
    }
    const options = safety.parseArguments(argv);
    if (options.help) { output({ usage: 'Default: offline --dry-run. --execute is BLOCKED pending complete browser and child-provider budget installation. Manifest: --fixture-manifest=PATH; scenarios: --success, --capture-recovery, --decline, --sca, --sca-cancel; optional --buy-now, --slow, --backend-port=PORT, --frontend-port=PORT.' }); return 0; }
    if (options.mode === 'execute') {
      output({ status: 'BLOCKED', financialAcceptance: 'NOT_VERIFIED',
        reason: 'Live execution disabled: hosted-provider coverage, operational prerequisites and explicit financial authorization remain independently gated.' });
      return safety.EXIT_CODES.BLOCKED_BY_ENVIRONMENT;
    }
    const values = dependencies.values || safety.loadTestEnvironment(backendDir);
    report = safety.preflight({ options, values, backendDir, fingerprint: dependencies.fingerprint || safety.sourceFingerprint(backendDir),
      ...(dependencies.exists ? { exists: dependencies.exists } : {}), ...(dependencies.readJson ? { readJson: dependencies.readJson } : {}) });
    const visible = Object.fromEntries(Object.entries(report).filter(([key]) => key !== 'manifest'));
    output(visible);
    if (report.status !== 'READY_TO_RUN' || options.mode !== 'execute') return report.exitCode;
    const restoreOutput = dependencies.output ? () => {} : safety.installSanitizedOutput(process.stdout);
    const restoreErrors = dependencies.output ? () => {} : safety.installSanitizedOutput(process.stderr);
    try { await (dependencies.execute || executeGate)({ ...report, values }, options); }
    finally { restoreOutput(); restoreErrors(); }
    output({ status: 'READY_TO_RUN', scenarioPassed: true, financialMatrix: 'NOT_VERIFIED', verificationKind: dependencies.verificationKind || 'REAL_STRIPE_SCENARIO', scenario: options.scenario, scope: report.scope });
    return 0;
  } catch (error) {
    const status = error.gateStatus || 'FAILED_PRECONDITION';
    output({ status, financialAcceptance: 'NOT_VERIFIED', error: safety.sanitize(error.message) });
    return safety.EXIT_CODES[status];
  }
}

if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { main, runnerStartPhase, captureFailureScreenshot, markHostedInputsInteractive };
