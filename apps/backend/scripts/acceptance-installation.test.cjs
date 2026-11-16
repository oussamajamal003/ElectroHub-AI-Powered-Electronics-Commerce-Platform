const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { openBudget } = require('./acceptance-budget.cjs');
const { diskProvider } = require('./guarded-acceptance.cjs');
const { installAcceptance, installBeforeBootstrap } = require('./acceptance-installation.cjs');
const { main: childMain } = require('./acceptance-child.cjs');
const safety = require('./stripe-gate-safety.cjs');
const { fork } = require('node:child_process');
const { captureContract } = require('./acceptance-capture-contract.cjs');
const { secureNewLedger } = require('./acceptance-ledger-permissions.cjs');
// Ledger directories are named by a fresh random run id. Each is registered here and removed in afterEach; only paths created by THIS process
// are removed, so other runs' ledgers, integration-owner.json and parallel test processes are never touched.
const ledgerRoot = require('node:path').resolve(__dirname, '../.cache/stripe-acceptance-budget');
const ownedLedgerDirectories = new Set();
function ownedLedgerDirectory(id) { const directory = require('node:path').resolve(ledgerRoot, id); ownedLedgerDirectories.add(directory); return directory; }
test.after(() => {
  const failures = [];
  for (const directory of ownedLedgerDirectories) {
    try {
      if (require('node:path').dirname(directory) !== ledgerRoot) throw new Error('Refusing to remove a path outside the owned ledger root.');
      require('node:fs').rmSync(directory, { recursive: true, force: true }); ownedLedgerDirectories.delete(directory);
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw failures[0];
});
function fixture(role = 'api') {
  process.env.NODE_ENV = 'test';
  const runId = randomUUID(), config = { runId, approvedRunId: runId, attemptId: randomUUID(), userId: randomUUID(),
    scenario: 'POST_PROVIDER_CAPTURE_RESPONSE_LOSS', projectRef: safety.DEV_PROJECT, accountId: safety.DEV_STRIPE_ACCOUNT,
    amountCents: 1349, sourceFingerprint: safety.sourceFingerprint(path.resolve(__dirname, '..')) };
  const directory = ownedLedgerDirectory(runId);
  const budget = openBudget({ directory, config, initialize: true });
  secureNewLedger(directory);
  const manifest = { config, role, ownerPid: process.pid, parentPid: process.ppid, executable: process.execPath, cwd: process.cwd(),
    workId: randomUUID(), browserSessionId: randomUUID(), backendOrigin: 'http://127.0.0.1:5000' };
  manifest.listenerDestination = `${manifest.backendOrigin}/api/webhooks/stripe`;
  const provider = diskProvider(directory, config);
  const attempt = { id: config.attemptId, userId: config.userId, amountCents: 1349, stripeAccountId: config.accountId, currency: 'USD' };
  const work = { id: manifest.workId, attemptId: config.attemptId, state: 'LEASED', leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 120000) };
  manifest.leaseToken = work.leaseToken;
  manifest.captureAuthorization = captureContract(config, work, `pi_${config.attemptId.replaceAll('-', '')}`);
  const database = { paymentWork: { findUnique: async () => work }, order: { findUnique: async () => ({ id: attempt.orderId,
    userId: config.userId, status: 'AWAITING_CAPTURE', payment: { provider: 'STRIPE', providerPaymentId: attempt.providerIntentId, status: 'PROCESSING', amount: '13.49', currency: 'USD' } }) } };
  const serviceFactory = (_db, adapter) => ({ process: id => { assert.equal(id, attempt.id); return adapter.create(attempt); } });
  return { manifest, directory, provider, database, serviceFactory, attempt, budget, work };
}
test('injected service calls guarded adapter; forbidden compensation never reaches provider', async () => {
  const f = fixture('runner'), r = installAcceptance(f);
  await r.runOnce(); assert.equal(f.budget.summary().operations[0].classification, 'confirmed');
  await assert.rejects(r.runOnce()); await assert.rejects(r.adapter.cancel()); await assert.rejects(r.adapter.refund()); r.close();
});
test('browser route reserves authorization before forwarding and rejects a second/foreign submission', async () => {
  const f = fixture(), r = installAcceptance(f); const intent = await r.adapter.create(f.attempt);
  let handler; await r.createBrowserContext({ newContext: async options => { assert.equal(options.serviceWorkers, 'block'); return { route: async (_pattern, callback) => { handler = callback; } }; } }, f.manifest.browserSessionId);
  await assert.rejects(r.installBrowserBoundary({}, f.manifest.browserSessionId));
  await assert.rejects(r.createBrowserContext({ newContext: async () => { throw Error('must not open'); } }, randomUUID()));
  let forwards = 0, aborts = 0;
  const route = id => ({ request: () => ({ method: () => 'POST', url: () => `https://api.stripe.com/v1/payment_intents/${id}/confirm` }),
    fetch: async options => { assert.deepEqual(options, { maxRetries: 0, maxRedirects: 0 }); forwards++; assert.equal(f.budget.summary().unknown, true); await f.provider.authorize(); return { status: () => 200 }; },
    fulfill: async () => {}, abort: async () => { aborts++; }, continue: async () => { throw Error('financial bypass'); } });
  await handler(route('pi_foreign')); assert.equal(forwards, 0);
  await handler(route(intent.id)); await handler(route(intent.id));
  assert.equal(forwards, 1); assert.equal(aborts, 2); assert.equal(f.budget.summary().operations[1].classification, 'confirmed'); r.close();
});
test('lost browser response reserves authorization across restart without resubmission', async () => {
  const f = fixture(), r = installAcceptance(f); const intent = await r.adapter.create(f.attempt);
  let handler; await r.createBrowserContext({ newContext: async () => ({ route: async (_p, cb) => { handler = cb; } }) }, f.manifest.browserSessionId);
  let calls = 0;
  const route = { request: () => ({ method: () => 'POST', url: () => `https://api.stripe.com/v1/payment_intents/${intent.id}/confirm` }),
    fetch: async () => { calls++; await f.provider.authorize(); throw Error('response lost'); }, abort: async () => {}, continue: async () => {} };
  await handler(route); r.close(); const reopened = installAcceptance(f);
  await reopened.createBrowserContext({ newContext: async () => ({ route: async (_p, cb) => { handler = cb; } }) }, f.manifest.browserSessionId);
  await handler(route); assert.equal(calls, 1); assert.equal(f.budget.summary().unknown, true);
  f.budget.reconcile('authorize', await reopened.adapter.retrieve(intent.id)); reopened.close();
});
test('post capture interception on injected adapter leaves budget unknown until authoritative retrieval', async () => {
  const f = fixture('runner'); f.manifest.loseCaptureResponse = true; f.manifest.capacityVerified = true;
  const r = installAcceptance(f), intent = await r.adapter.create(f.attempt);
  f.attempt.providerIntentId = intent.id; f.attempt.orderId = randomUUID(); f.attempt.state = 'CAPTURE_PENDING';
  await f.budget.execute('authorize', { attemptId: f.attempt.id, userId: f.attempt.userId, amountCents: 1349,
    intentId: intent.id, idempotencyKey: `electrohub:03.6:${f.attempt.id}:authorization` }, () => f.provider.authorize());
  await assert.rejects(r.adapter.capture(f.attempt), /response loss/); assert.equal(f.budget.summary().unknown, true);
  f.budget.reconcile('capture', await r.adapter.retrieve(intent.id)); await assert.rejects(r.adapter.capture(f.attempt));
  assert.equal(f.budget.summary().operations[2].classification, 'confirmed'); r.close();
});
test('startup, owner, source, account, session and work failures reject at execution boundaries', async () => {
  for (const change of [{ ownerPid: 0 }, { parentPid: 0 }, { cwd: 'foreign' }, { executable: 'foreign' }, { role: 'unscoped' }]) {
    const f = fixture(); assert.throws(() => installAcceptance({ ...f, manifest: { ...f.manifest, ...change } }));
  }
  const f = fixture('runner'); const r = installAcceptance(f); f.work.id = randomUUID();
  await assert.rejects(r.runOnce()); assert.equal(fs.existsSync(path.join(f.directory, 'double-create.json')), false);
  assert.throws(() => installAcceptance(f)); r.close();
  const stale = fixture(); stale.manifest.config.sourceFingerprint = '0'.repeat(64); assert.throws(() => installAcceptance(stale));
  const wrong = fixture(); wrong.provider.account = async () => 'acct_wrong'; const w = installAcceptance(wrong);
  await assert.rejects(w.adapter.create(wrong.attempt)); assert.equal(fs.existsSync(path.join(wrong.directory, 'double-create.json')), false); w.close();
  const missing = fixture(); assert.throws(() => installAcceptance({ ...missing, manifest: {} }));
  const prod = fixture(); process.env.NODE_ENV = 'production'; assert.throws(() => installAcceptance(prod)); process.env.NODE_ENV = 'test';
});
test('child entry rejects missing guard and non-offline startup; exact owned startup uses injected boundary', async () => {
  const f = fixture('runner'), file = path.join(f.directory, 'child-manifest.json'); fs.writeFileSync(file, JSON.stringify(f.manifest));
  await assert.rejects(childMain(['--live', file, f.directory]));
  await childMain(['--offline-boundary', file, f.directory]);
  assert.equal(f.budget.summary().operations[0].classification, 'confirmed');
});
test('actual separate child handshake binds executable/PID/parent/source before injected adapter callback', async () => {
  for (const stale of [false, true]) {
    const f = fixture('runner');
    const code = await new Promise((resolve, reject) => {
      const child = fork(path.resolve(__dirname, 'acceptance-child.cjs'), ['--offline-ipc'], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, NODE_ENV: 'test' } });
      child.once('error', reject); child.once('exit', resolve);
      child.once('message', identity => {
        assert.equal(identity.pid, child.pid); assert.equal(identity.parentPid, process.pid);
        Object.assign(f.manifest, { ownerPid: identity.pid, parentPid: identity.parentPid, executable: identity.executable, cwd: identity.cwd });
        if (stale) f.manifest.config.sourceFingerprint = '0'.repeat(64);
        child.send({ manifest: f.manifest, directory: f.directory });
      });
    });
    assert.equal(code, stale ? 2 : 0);
    assert.equal(fs.existsSync(path.join(f.directory, 'double-create.json')), !stale);
  }
});
test('owned singleton is guarded before bootstrap; indirect and foreign calls cannot bypass the ledger', async () => {
  const f = fixture(), originalCreate = f.provider.create;
  const installed = installBeforeBootstrap(f, () => ({ setup: attempt => f.provider.create(attempt) }));
  assert.notEqual(f.provider.create, originalCreate);
  await assert.rejects(installed.application.setup({ ...f.attempt, id: randomUUID() }));
  await installed.application.setup(f.attempt); await assert.rejects(installed.application.setup(f.attempt));
  await assert.rejects(f.provider.cancel()); installed.dispose(); assert.equal(f.provider.create, originalCreate);
});

test('redirected confirmation is never followed or acknowledged; allowance stays unknown', async () => {
  const f = fixture(), r = installAcceptance(f), intent = await r.adapter.create(f.attempt);
  let handler, forwarded = 0, aborted = 0;
  await r.createBrowserContext({ newContext: async () => ({ route: async (_p, cb) => { handler = cb; } }) }, f.manifest.browserSessionId);
  const route = { request: () => ({ method: () => 'POST', url: () => `https://api.stripe.com/v1/payment_intents/${intent.id}/confirm` }),
    fetch: async options => { assert.equal(options.maxRedirects, 0); forwarded++; return { status: () => 307 }; },
    fulfill: async () => { assert.fail('Redirect must not reach browser'); }, abort: async () => { aborted++; } };
  await handler(route); await handler(route);
  assert.equal(forwarded, 1); assert.equal(aborted, 2); assert.equal(f.budget.summary().unknown, true); r.close();
});

test('readback failure after browser acknowledgement does not handle the route twice', async () => {
  const f = fixture(); f.provider.retrieve = async () => { throw Error('readback unavailable'); };
  const r = installAcceptance(f), intent = await r.adapter.create(f.attempt); let handler, acknowledged = 0;
  await r.createBrowserContext({ newContext: async () => ({ route: async (_p, cb) => { handler = cb; } }) }, f.manifest.browserSessionId);
  await handler({ request: () => ({ method: () => 'POST', url: () => `https://api.stripe.com/v1/payment_intents/${intent.id}/confirm` }),
    fetch: async () => ({ status: () => 200 }), fulfill: async () => { acknowledged++; }, abort: async () => { assert.fail('Already fulfilled'); } });
  assert.equal(acknowledged, 1); assert.equal(f.budget.summary().unknown, true); r.close();
});

test('lease replacement during order verification prevents capture callback', async () => {
  const f = fixture('runner'); let captures = 0; f.provider.capture = async () => { captures++; assert.fail('Stale worker'); };
  const readOrder = f.database.order.findUnique;
  f.database.order.findUnique = async () => { f.work.leaseToken = randomUUID(); return readOrder(); };
  const r = installAcceptance(f), intent = await r.adapter.create(f.attempt);
  Object.assign(f.attempt, { providerIntentId: intent.id, orderId: randomUUID(), state: 'CAPTURE_PENDING' });
  await f.budget.execute('authorize', { attemptId: f.attempt.id, userId: f.attempt.userId, amountCents: 1349,
    intentId: intent.id, idempotencyKey: `electrohub:03.6:${f.attempt.id}:authorization` }, () => f.provider.authorize());
  await assert.rejects(r.adapter.capture(f.attempt)); assert.equal(captures, 0); assert.equal(f.budget.summary().unknown, true); r.close();
});

test('capture cannot adopt a foreign lease even before its first database read', async () => {
  const f = fixture('runner'); let captures = 0; f.provider.capture = async () => { captures++; };
  const r = installAcceptance(f); f.work.leaseToken = randomUUID();
  await assert.rejects(r.adapter.capture({ ...f.attempt, state: 'CAPTURE_PENDING' }));
  assert.equal(captures, 0); assert.equal(f.budget.summary().operations.length, 0); r.close();
});

test('response-loss assertion never replaces an actual provider failure; installed role is immutable', async () => {
  const f = fixture('runner'), primary = Object.assign(new Error('transport outcome unknown'), { code: 'PAYMENT_PROVIDER_UNKNOWN' });
  f.manifest.loseCaptureResponse = true; f.manifest.capacityVerified = true;
  f.provider.capture = async () => { throw primary; };
  const r = installAcceptance(f), intent = await r.adapter.create(f.attempt);
  Object.assign(f.attempt, { providerIntentId: intent.id, orderId: randomUUID(), state: 'CAPTURE_PENDING' });
  await f.budget.execute('authorize', { attemptId: f.attempt.id, userId: f.attempt.userId, amountCents: 1349,
    intentId: intent.id, idempotencyKey: `electrohub:03.6:${f.attempt.id}:authorization` }, () => f.provider.authorize());
  await assert.rejects(r.adapter.capture(f.attempt), error => error === primary);
  assert.equal(primary.cleanupFailureCount, 1); assert.equal(f.budget.summary().unknown, true); r.close();
  const api = fixture(), installed = installAcceptance(api); api.manifest.role = 'runner';
  await assert.rejects(installed.adapter.capture({ ...api.attempt, state: 'CAPTURE_PENDING' }), /Only the isolated scoped runner/); installed.close();
});
