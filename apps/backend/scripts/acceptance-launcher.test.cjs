const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fork } = require('node:child_process');
const { openBudget } = require('./acceptance-budget.cjs');
const { secureNewLedger, assertLedgerPermissions } = require('./acceptance-ledger-permissions.cjs');
const { captureContract } = require('./acceptance-capture-contract.cjs');
const { bootstrapAcceptance } = require('./acceptance-launcher.cjs');
const { diskProvider } = require('./guarded-acceptance.cjs');
const { main } = require('./stripe-browser-gate.cjs');
const safety = require('./stripe-gate-safety.cjs');
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

function fixture(role = 'runner', secure = true) {
  process.env.NODE_ENV = 'test';
  const runId = randomUUID();
  const config = { runId, approvedRunId: runId, attemptId: randomUUID(), userId: randomUUID(), scenario: 'POST_PROVIDER_CAPTURE_RESPONSE_LOSS',
    projectRef: safety.DEV_PROJECT, accountId: safety.DEV_STRIPE_ACCOUNT, amountCents: 1349, sourceFingerprint: safety.sourceFingerprint(path.resolve(__dirname, '..')) };
  const directory = ownedLedgerDirectory(runId);
  const budget = openBudget({ directory, config, initialize: true });
  if (secure) secureNewLedger(directory);
  const work = { id: randomUUID(), attemptId: config.attemptId, state: 'READY', leaseToken: null, leaseUntil: null };
  const manifest = { config, role, ownerPid: process.pid, parentPid: process.ppid, executable: process.execPath, cwd: process.cwd(),
    workId: work.id, browserSessionId: randomUUID(), backendOrigin: 'http://127.0.0.1:5107', listenerDestination: 'http://127.0.0.1:5107/api/webhooks/stripe' };
  const attempt = { id: config.attemptId, userId: config.userId, amountCents: 1349, stripeAccountId: config.accountId, currency: 'USD' };
  const double = diskProvider(directory, config); let initialized = 0, captures = 0;
  const providerFactory = () => { initialized++; return { ...double, capture: async a => { captures++; return double.capture(a); } }; };
  const database = { paymentWork: {
    findUnique: async args => { assert.equal(args.where.attemptId, config.attemptId); return { ...work }; },
    updateMany: async args => { assert.equal(args.where.attemptId, config.attemptId); if (work.state === 'LEASED' && work.leaseUntil > new Date()) return { count: 0 };
      Object.assign(work, args.data); return { count: 1 }; },
  }, order: { findUnique: async () => ({ id: attempt.orderId, userId: config.userId, status: 'AWAITING_CAPTURE',
    payment: { provider: 'STRIPE', status: 'PROCESSING', providerPaymentId: attempt.providerIntentId, currency: 'USD', amount: '13.49' } }) } };
  const serviceFactory = (db, adapter) => ({ process: async id => {
    assert.equal(id, config.attemptId);
    const claimed = await db.paymentWork.updateMany({ where: { attemptId: id }, data: { state: 'LEASED', leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 120000) } });
    if (!claimed.count) return null;
    return adapter.capture(attempt);
  } });
  const options = { manifest, directory, database, providerFactory, serviceFactory };
  async function prepare(runtime) {
    const intent = await runtime.adapter.create(attempt); Object.assign(attempt, { providerIntentId: intent.id, state: 'CAPTURE_PENDING', orderId: randomUUID() });
    await budget.execute('authorize', { attemptId: attempt.id, userId: attempt.userId, amountCents: 1349, intentId: intent.id,
      idempotencyKey: `electrohub:03.6:${attempt.id}:authorization` }, () => double.authorize());
  }
  return { options, manifest, config, directory, budget, work, attempt, double, prepare, stats: () => ({ initialized, captures }) };
}

test('actual launcher bootstrap installs before lazy provider initialization and binds its successful worker claim', async () => {
  const f = fixture(); let bootstrapped = 0;
  const exit = await main(['--offline-bootstrap'], { installation: { ...f.options, bootstrap: runtime => {
    assert.equal(f.stats().initialized, 0); assert.ok(runtime.budget); assert.equal(runtime.budget.execute, undefined);
    assert.equal(runtime.budget.reconcile, undefined); bootstrapped++; return {}; } },
  offlineScenario: async runtime => {
    await f.prepare(runtime); const truth = await runtime.runOnce(); assert.equal(truth.status, 'succeeded');
    await assert.rejects(runtime.adapter.capture(f.attempt));
    assert.equal(f.budget.summary().operations.filter(o => o.classification === 'confirmed').length, 3);
    const receipt = JSON.parse(fs.readFileSync(path.join(f.directory, 'capture.permission.json')));
    assert.equal(receipt.ownerPid, process.pid); assert.equal(receipt.workId, f.work.id);
    assert.equal(receipt.fencingToken, f.work.leaseToken); assert.equal(receipt.operationId, `${f.config.runId}:${f.attempt.id}:capture`);
  }, output: () => {} });
  assert.equal(exit, 0); assert.equal(bootstrapped, 1); assert.deepEqual(f.stats(), { initialized: 1, captures: 1 });
});

test('capture execution rejects every missing, foreign, expired and stale contract boundary', async () => {
  const f = fixture(); Object.assign(f.work, { state: 'LEASED', leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 120000) });
  const intentId = `pi_${f.config.attemptId.replaceAll('-', '')}`;
  const contract = captureContract(f.config, f.work, intentId);
  const changes = [{ captureAuthorization: null }, ...[
    ['runId', randomUUID()], ['accountId', 'acct_wrong'], ['intentId', 'pi_wrong'], ['attemptId', randomUUID()],
    ['workId', randomUUID()], ['ownerPid', process.pid + 1], ['fencingToken', randomUUID()], ['leaseUntilMs', Date.now() - 1], ['amountCents', 1350],
  ].map(([key, value]) => ({ captureAuthorization: { ...contract, [key]: value } }))];
  for (const change of changes) {
    const installed = bootstrapAcceptance({ ...f.options, manifest: { ...f.manifest, ...change } });
    if (!f.attempt.providerIntentId) await f.prepare(installed.runtime);
    await assert.rejects(installed.runtime.adapter.capture(f.attempt)); installed.runtime.close();
  }
  const installed = bootstrapAcceptance({ ...f.options, manifest: { ...f.manifest, captureAuthorization: contract } });
  f.work.leaseUntil = new Date(Date.now() - 1); await assert.rejects(installed.runtime.adapter.capture(f.attempt));
  installed.runtime.close(); assert.equal(f.stats().captures, 0);
});

test('foreign attempt, changed intent, historical work and concurrent claim never dispatch capture', async () => {
  const f = fixture(), installed = bootstrapAcceptance(f.options); await f.prepare(installed.runtime);
  for (const change of [{ id: randomUUID() }, { providerIntentId: 'pi_foreign' }, { amountCents: 1350 }]) await assert.rejects(installed.runtime.adapter.capture({ ...f.attempt, ...change }));
  f.work.id = randomUUID(); await assert.rejects(installed.runtime.runOnce()); f.work.id = f.manifest.workId;
  Object.assign(f.work, { state: 'LEASED', leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 120000) });
  assert.equal(await installed.runtime.runOnce(), null); await assert.rejects(installed.runtime.adapter.capture(f.attempt));
  installed.runtime.close(); assert.equal(f.stats().captures, 0);
});

test('missing ownership, source, listener, account and unavailable ledger reject before provider initialization', async () => {
  const f = fixture();
  for (const change of [{ ownerPid: 0 }, { listenerDestination: 'http://127.0.0.1:9999/api/webhooks/stripe' },
    { config: { ...f.config, sourceFingerprint: '0'.repeat(64) } }, { config: { ...f.config, accountId: 'acct_wrong' } }]) {
    assert.throws(() => bootstrapAcceptance({ ...f.options, manifest: { ...f.manifest, ...change } }));
  }
  assert.throws(() => bootstrapAcceptance({ ...f.options, directory: path.join(f.directory, 'missing') }));
  assert.equal(f.stats().initialized, 0);
  assert.equal(await main(['--offline-bootstrap'], { output: () => {} }), 3);
  assert.equal(await main(['--execute'], { ...f.options, execute: () => { assert.fail('Live barrier'); }, output: () => {} }), 2);
});

test('protected filesystem ownership is verified; shared permissions fail closed', () => {
  const f = fixture(); assert.equal(assertLedgerPermissions(f.directory).verified, true);
  const shared = fixture('runner', false);
  if (process.platform === 'win32') assert.throws(() => assertLedgerPermissions(shared.directory));
  else { fs.chmodSync(shared.directory, 0o777); assert.throws(() => assertLedgerPermissions(shared.directory)); }
  assert.throws(() => bootstrapAcceptance(shared.options)); assert.equal(shared.stats().initialized, 0);
  fs.writeFileSync(path.join(f.directory, 'financial-evidence.json'), '{}'); assert.throws(() => secureNewLedger(f.directory));
});

test('uncontrolled browser confirmation and unapproved provider methods are rejected by launcher capability', async () => {
  const f = fixture('api'), installed = bootstrapAcceptance(f.options);
  await assert.rejects(installed.runtime.installBrowserBoundary({}, f.manifest.browserSessionId));
  await assert.rejects(installed.runtime.adapter.create({ ...f.attempt, id: randomUUID() }));
  await assert.rejects(installed.runtime.adapter.cancel()); await assert.rejects(installed.runtime.adapter.refund());
  assert.equal(f.budget.summary().operations.length, 0); installed.runtime.close();
});

test('exposed service cannot scan historical work or claim foreign work before database access', async () => {
  const f = fixture(); let read = 0;
  f.options.database.paymentWork.findMany = async () => { read++; return []; };
  f.options.serviceFactory = db => ({ process: async () => {}, scan: () => db.paymentWork.findMany({}),
    foreignClaim: () => db.paymentWork.updateMany({ where: { attemptId: randomUUID() }, data: { state: 'LEASED' } }) });
  const installed = bootstrapAcceptance(f.options);
  await assert.rejects(installed.runtime.service.scan(), /queue scanning/);
  await assert.rejects(installed.runtime.service.foreignClaim(), /Unscoped worker/);
  assert.equal(read, 0); assert.equal(f.stats().initialized, 0); installed.runtime.close();
});

test('post-capture response loss survives a fresh child using the same actual bootstrap and ledger', async () => {
  const f = fixture(); f.manifest.loseCaptureResponse = true; f.manifest.capacityVerified = true;
  const installed = bootstrapAcceptance(f.options); await f.prepare(installed.runtime);
  await assert.rejects(installed.runtime.runOnce(), /response loss/); assert.equal(f.budget.summary().unknown, true);
  assert.equal((await installed.runtime.adapter.retrieve(f.attempt.providerIntentId)).status, 'succeeded');
  installed.runtime.close(); f.manifest.offlineOperation = 'reconcile-capture';
  const code = await new Promise((resolve, reject) => {
    const child = fork(path.resolve(__dirname, 'acceptance-child.cjs'), ['--offline-ipc'], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, NODE_ENV: 'test' } });
    child.once('error', reject); child.once('exit', resolve); child.once('message', identity => {
      assert.equal(identity.pid, child.pid); assert.equal(identity.parentPid, process.pid);
      child.send({ manifest: { ...f.manifest, ownerPid: identity.pid, parentPid: identity.parentPid, executable: identity.executable, cwd: identity.cwd }, directory: f.directory });
    });
  });
  assert.equal(code, 0); assert.equal(f.budget.summary().unknown, false);
  assert.equal(f.stats().captures, 1); assert.equal(f.budget.summary().operations.find(o => o.kind === 'capture').classification, 'confirmed');
  const replacement = bootstrapAcceptance(f.options); await assert.rejects(replacement.runtime.adapter.capture(f.attempt)); replacement.runtime.close();
  assert.equal(f.stats().captures, 1);
});

test('abandoned role requires an exact dead predecessor; live duplicate startup is rejected', async () => {
  const f = fixture(), installed = bootstrapAcceptance(f.options);
  assert.throws(() => bootstrapAcceptance(f.options)); installed.runtime.close();
  const file = path.join(f.directory, 'runner.owner.json');
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, runId: f.config.runId, attemptId: f.config.attemptId, workId: f.work.id, sourceFingerprint: f.config.sourceFingerprint }));
  assert.throws(() => bootstrapAcceptance({ ...f.options, manifest: { ...f.manifest, restartOfProcessId: process.pid } }));
  assert.equal(f.stats().initialized, 0);
});

test('verified dead child ownership is preserved and reclaimed only for the same run/work/source', async () => {
  const f = fixture(); let previousPid;
  const code = await new Promise((resolve, reject) => {
    const child = fork(path.resolve(__dirname, 'acceptance-child.cjs'), ['--offline-ipc'], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, NODE_ENV: 'test' } });
    child.once('error', reject); child.once('exit', resolve); child.once('message', identity => {
      previousPid = child.pid;
      child.send({ manifest: { ...f.manifest, ownerPid: identity.pid, parentPid: identity.parentPid, executable: identity.executable, cwd: identity.cwd, offlineOperation: 'abandon-owner' }, directory: f.directory });
    });
  });
  assert.equal(code, 0); assert.throws(() => bootstrapAcceptance(f.options));
  const replacement = bootstrapAcceptance({ ...f.options, manifest: { ...f.manifest, restartOfProcessId: previousPid } });
  assert.equal(f.stats().initialized, 0); replacement.runtime.close();
  assert.ok(fs.readdirSync(f.directory).some(name => name.endsWith('.preserved')));
});

test('two independent children cannot both reclaim the same dead owner', async () => {
  const f = fixture();
  const spawn = manifest => new Promise((resolve, reject) => {
    const child = fork(path.resolve(__dirname, 'acceptance-child.cjs'), ['--offline-ipc'], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, NODE_ENV: 'test' } });
    child.once('error', reject); child.once('exit', code => resolve({ code, pid: child.pid })); child.once('message', identity => {
      child.send({ manifest: { ...manifest, ownerPid: identity.pid, parentPid: identity.parentPid, executable: identity.executable, cwd: identity.cwd, offlineOperation: 'abandon-owner' }, directory: f.directory });
    });
  });
  const original = await spawn(f.manifest); assert.equal(original.code, 0);
  const outcomes = await Promise.all([spawn({ ...f.manifest, restartOfProcessId: original.pid }), spawn({ ...f.manifest, restartOfProcessId: original.pid })]);
  assert.equal(outcomes.filter(o => o.code === 0).length, 1); assert.equal(outcomes.filter(o => o.code === 2).length, 1);
  const owner = JSON.parse(fs.readFileSync(path.join(f.directory, 'runner.owner.json')));
  assert.equal(owner.pid, outcomes.find(o => o.code === 0).pid); assert.equal(f.budget.summary().operations.length, 0);
});

test('closed runtime cannot execute through an old adapter after replacement startup', async () => {
  const f = fixture(); const old = bootstrapAcceptance(f.options); old.runtime.close();
  const replacement = bootstrapAcceptance(f.options);
  await assert.rejects(old.runtime.adapter.create(f.attempt), /closed/);
  await assert.rejects(old.runtime.runOnce(), /closed/); await assert.rejects(old.runtime.reconcileUnknown(), /closed/);
  assert.equal(f.stats().initialized, 0); assert.equal(f.budget.summary().operations.length, 0); replacement.runtime.close();
  const api = fixture('api'), installed = bootstrapAcceptance(api.options); let handler, aborted = 0;
  await installed.runtime.createBrowserContext({ newContext: async () => ({ route: async (_pattern, callback) => { handler = callback; } }) }, api.manifest.browserSessionId);
  installed.runtime.close();
  await handler({ abort: async () => { aborted++; }, request: () => { assert.fail('Closed browser boundary'); } });
  assert.equal(aborted, 1); assert.equal(api.stats().initialized, 0);
});

test('reconciliation checks exact owner fencing again after authoritative provider readback', async () => {
  const f = fixture(); f.manifest.loseCaptureResponse = true; f.manifest.capacityVerified = true;
  f.options.providerFactory = () => ({ ...f.double, retrieve: async id => { const truth = await f.double.retrieve(id); f.work.leaseToken = randomUUID(); return truth; } });
  const installed = bootstrapAcceptance(f.options); await f.prepare(installed.runtime);
  await assert.rejects(installed.runtime.runOnce(), /response loss/);
  await assert.rejects(installed.runtime.reconcileUnknown());
  assert.equal(f.budget.summary().unknown, true); assert.equal(fs.existsSync(path.join(f.directory, 'capture.result.json')), false);
  installed.runtime.close();
});

test('worker claim includes immutable work identity in its atomic predicate', async () => {
  const f = fixture(); let claims = 0;
  f.options.database.paymentWork.updateMany = async args => {
    assert.equal(args.where.id, f.manifest.workId); claims++; return { count: 0 };
  };
  const installed = bootstrapAcceptance(f.options);
  await assert.rejects(installed.runtime.claimForReconciliation(), /not acquired/);
  assert.equal(claims, 1); assert.equal(f.stats().initialized, 0); installed.runtime.close();
});

test('failed service construction preserves primary error and releases only its owned role', () => {
  const f = fixture(); const primary = new Error('service construction failed');
  assert.throws(() => bootstrapAcceptance({ ...f.options, serviceFactory: () => { throw primary; } }), error => error === primary);
  assert.equal(fs.existsSync(path.join(f.directory, 'runner.owner.json')), false);
  const installed = bootstrapAcceptance(f.options); installed.runtime.close(); assert.equal(f.stats().initialized, 0);
});
