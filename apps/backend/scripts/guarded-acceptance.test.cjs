const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const os = require('node:os');
const { execFile } = require('node:child_process');
const safety = require('./stripe-gate-safety.cjs');
const { guardedAcceptance, diskProvider } = require('./guarded-acceptance.cjs');
// Everything this file creates is tracked and removed in afterEach. Only paths created by THIS process are ever removed: ledger directories are
// named by a fresh random runId, and temporary manifests live in a private mkdtemp directory, so shared acceptance records (including
// integration-owner.json and other runs' ledgers) and parallel test processes are never touched.
const ledgerRoot = path.resolve(__dirname, '../.cache/stripe-acceptance-budget');
const createdDirectories = new Set(), createdTemporaryDirectories = new Set();
function removeOwned(directory, withinRoot) {
  const resolved = path.resolve(directory);
  if (withinRoot && path.dirname(resolved) !== withinRoot) throw new Error('Refusing to remove a path outside the owned fixture root.');
  fs.rmSync(resolved, { recursive: true, force: true });
}
function fixture(loseCaptureResponse = false) {
  const runId = randomUUID(), config = { runId, approvedRunId: runId, attemptId: randomUUID(), userId: randomUUID(),
    scenario: 'POST_PROVIDER_CAPTURE_RESPONSE_LOSS', projectRef: safety.DEV_PROJECT, accountId: 'acct_1UEZW5KiVgdl63pN', amountCents: 1349,
    sourceFingerprint: safety.sourceFingerprint(path.resolve(__dirname, '..')) };
  const directory = path.resolve(ledgerRoot, runId); createdDirectories.add(directory);
  const manifest = { config, ownerProcessId: process.pid, workerAttemptId: config.attemptId, workId: randomUUID(),
    approvedScenario: config.scenario, credentialsMode: 'test', backendOrigin: 'http://127.0.0.1:5000',
    listenerDestination: 'http://127.0.0.1:5000/api/webhooks/stripe', budgetStoreOwned: true, loseCaptureResponse,
    services: Object.fromEntries(['api', 'frontend', 'listener', 'runner'].map(role => [role, { pid: process.pid, owned: true }])) };
  return { directory, manifest, provider: diskProvider(directory, config) };
}
test.beforeEach(() => { process.env.NODE_ENV = 'test'; });
test.afterEach(() => {
  const failures = [];
  for (const directory of createdDirectories) { try { removeOwned(directory, ledgerRoot); createdDirectories.delete(directory); } catch (error) { failures.push(error); } }
  for (const directory of createdTemporaryDirectories) { try { removeOwned(directory, fs.realpathSync(os.tmpdir())); createdTemporaryDirectories.delete(directory); } catch (error) { failures.push(error); } }
  if (failures.length) throw failures[0];
});
test('normal indirectly called provider operations all traverse same budget', async () => {
  const f = fixture(), a = guardedAcceptance({ ...f, initialize: true });
  await a.provider.create(a.attempt); await a.authorize(); a.commit();
  const claim = a.claim(a.attempt.id, f.manifest.workId); await a.provider.capture(claim);
  const state = await a.reconcile(claim);
  assert.deepEqual([state.orderCount, state.paymentCount, state.inventory, state.state, state.workState], [1, 1, [8, 7], 'PAID', 'DONE']);
  assert.equal(a.budget.summary().operations.filter(o => o.classification === 'confirmed').length, 3);
  assert.throws(() => a.provider.cancel()); assert.throws(() => a.provider.refund());
  a.close();
});
test('response loss, replacement lease and stale completion preserve one financial effect', async () => {
  const f = fixture(true), a = guardedAcceptance({ ...f, initialize: true });
  await a.provider.create(a.attempt); await a.authorize(); a.commit();
  const old = a.claim(a.attempt.id, f.manifest.workId); await assert.rejects(a.provider.capture(old), /response loss/);
  assert.equal(a.budget.summary().unknown, true); a.expireDoubleLease();
  const fresh = a.claim(a.attempt.id, f.manifest.workId); assert.notEqual(old.leaseToken, fresh.leaseToken);
  const state = await a.reconcile(fresh); await assert.rejects(a.reconcile(old));
  assert.throws(() => a.provider.capture(fresh));
  assert.deepEqual(state.inventory, [8, 7]); assert.equal(state.orderCount, 1); assert.equal(state.paymentCount, 1); a.close();
});
test('bypass and unowned service rejection happens before any provider effect', async () => {
  const f = fixture();
  assert.throws(() => guardedAcceptance({ ...f, manifest: null, initialize: true }));
  assert.throws(() => guardedAcceptance({ ...f, provider: {}, initialize: true }));
  for (const change of [{ workerAttemptId: randomUUID() }, { approvedScenario: 'implicit' }, { credentialsMode: 'live' },
    { ownerProcessId: process.pid + 1 }, { workId: 'implicit' }, { listenerDestination: 'http://wrong/api/webhooks/stripe' }, { services: {} }]) {
    assert.throws(() => guardedAcceptance({ ...f, manifest: { ...f.manifest, ...change }, initialize: true }));
  }
  const a = guardedAcceptance({ ...f, initialize: true });
  assert.throws(() => a.provider.create({ ...a.attempt, id: randomUUID() }));
  assert.throws(() => a.provider.create({ ...a.attempt, providerIntentId: 'pi_other' }));
  assert.throws(() => a.provider.create({ ...a.attempt, stripeAccountId: 'acct_other' }));
  assert.throws(() => a.claim(randomUUID(), f.manifest.workId));
  assert.throws(() => a.claim(a.attempt.id, randomUUID()));
  assert.throws(() => a.provider.retrieve('pi_other'));
  assert.throws(() => guardedAcceptance(f));
  assert.equal(fs.existsSync(path.join(f.directory, 'double-create.json')), false); a.close();
});
test('guard state corruption or disappearance cannot reach an indirect provider call', async () => {
  const f = fixture(), a = guardedAcceptance({ ...f, initialize: true });
  fs.writeFileSync(path.join(f.directory, 'config.json'), '{}');
  await assert.rejects(a.provider.create(a.attempt));
  assert.equal(fs.existsSync(path.join(f.directory, 'double-create.json')), false); a.close();
});
test('child exits after captured response loss; new process reconciles retained budget and modeled purchase', async () => {
  const f = fixture(true), temporaryDirectory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'electrohub-guarded-acceptance-')), manifestFile = path.join(temporaryDirectory, 'manifest.json');
  createdTemporaryDirectories.add(temporaryDirectory); fs.writeFileSync(manifestFile, JSON.stringify(f.manifest));
  const modulePath = path.resolve(__dirname, 'guarded-acceptance.cjs');
  const script = `const fs=require('fs');process.env.NODE_ENV='test';const{guardedAcceptance,diskProvider}=require(process.argv[1]);const m=JSON.parse(fs.readFileSync(process.argv[2])),dir=process.argv[3],phase=process.argv[4];m.ownerProcessId=process.pid;for(const s of Object.values(m.services))s.pid=process.pid;if(phase==='recover')m.restartOfProcessId=JSON.parse(fs.readFileSync(dir+'/integration-owner.json')).pid;const a=guardedAcceptance({manifest:m,directory:dir,initialize:phase==='purchase',provider:diskProvider(dir,m.config)});(async()=>{if(phase==='purchase'){await a.provider.create(a.attempt);await a.authorize();a.commit();const c=a.claim(a.attempt.id,m.workId);try{await a.provider.capture(c);}catch(e){if(!/response loss/.test(e.message))throw e;}process.exit(0);}a.commit();a.expireDoubleLease();const c=a.claim(a.attempt.id,m.workId);const state=await a.reconcile(c);if(state.state!=='PAID'||state.orderCount!==1||state.paymentCount!==1)throw Error('invariants');try{await a.provider.capture(c);throw Error('unexpected repeat');}catch(e){if(e.message==='unexpected repeat')throw e;}a.close();})().catch(()=>process.exit(2));`;
  const launch = phase => new Promise((resolve, reject) => execFile(process.execPath, ['-e', script, modulePath, manifestFile, f.directory, phase], { windowsHide: true }, (error, stdout, stderr) => error ? reject(new Error(`${error.message}
child stderr: ${stderr}`)) : resolve()));
  await launch('purchase'); await launch('recover');
  const p = JSON.parse(fs.readFileSync(path.join(f.directory, 'double-purchase.json')));
  assert.deepEqual([p.state, p.workState, p.orderCount, p.paymentCount, p.inventory], ['PAID', 'DONE', 1, 1, [8, 7]]);
  for (const kind of ['create', 'authorize', 'capture']) assert.ok(fs.existsSync(path.join(f.directory, `double-${kind}.json`)));
});

test('fixture cleanup is scoped to this invocation: it refuses foreign paths and never touches a sibling ledger or the owner record', () => {
  const owned = fixture().directory;
  const sibling = path.join(ledgerRoot, `sibling-${randomUUID()}`);
  fs.mkdirSync(owned, { recursive: true }); fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, 'ledger.json'), '{}');
  try {
    assert.throws(() => removeOwned(path.join(ledgerRoot, '..', 'integration-owner.json'), ledgerRoot), /outside the owned fixture root/);
    assert.throws(() => removeOwned(path.join(ledgerRoot, owned, 'nested'), ledgerRoot) , /outside the owned fixture root/);
    removeOwned(owned, ledgerRoot);
    assert.equal(fs.existsSync(owned), false);
    assert.equal(fs.existsSync(path.join(sibling, 'ledger.json')), true, 'a sibling ledger must survive');
    assert.ok(createdDirectories.has(owned) && path.dirname(owned) === ledgerRoot, 'the removed directory was registered as run-owned');
  } finally { fs.rmSync(sibling, { recursive: true, force: true }); }
});
