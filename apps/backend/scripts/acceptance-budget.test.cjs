const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { openBudget } = require('./acceptance-budget.cjs');
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
function fixture() {
  const id = randomUUID(), directory = ownedLedgerDirectory(id);
  const config = { runId: id, approvedRunId: id, attemptId: randomUUID(), userId: randomUUID(),
    scenario: 'POST_PROVIDER_CAPTURE_RESPONSE_LOSS', projectRef: 'pzxekjybdiulzmssalfo', accountId: 'acct_1UEZW5KiVgdl63pN', amountCents: 1349,
    sourceFingerprint: require('./stripe-gate-safety.cjs').sourceFingerprint(path.resolve(__dirname, '..')) };
  const budget = openBudget({ directory, config, initialize: true });
  const provider = { id: 'pi_owned', account: config.accountId, attemptId: config.attemptId, amount: 1349,
    livemode: false, currency: 'usd', captureMethod: 'manual', status: 'requires_payment_method', received: 0, capturable: 0 };
  const request = kind => ({ attemptId: config.attemptId, userId: config.userId, amountCents: 1349,
    intentId: provider.id, orderId: randomUUID(), committedPurchaseVerified: true,
    idempotencyKey: `electrohub:03.6:${config.attemptId}:${kind === 'authorize' ? 'authorization' : kind}` });
  return { directory, config, budget, provider, request, reopen: () => openBudget({ directory, config }) };
}
test.beforeEach(() => { process.env.NODE_ENV = 'test'; });
test('durable create/authorize/capture accounting separates effects and refuses duplicate/refund', async () => {
  const f = fixture(); let sends = 0;
  await f.budget.execute('create', f.request('create'), async () => { sends++; return f.provider; });
  await f.budget.execute('authorize', f.request('authorize'), async () => { sends++; return { ...f.provider, status: 'requires_capture', capturable: 1349 }; });
  await f.budget.execute('capture', f.request('capture'), async () => { sends++; return { ...f.provider, status: 'succeeded', received: 1349 }; });
  assert.equal(f.reopen().summary().operations.filter(o => o.classification === 'confirmed').length, 3);
  await assert.rejects(f.reopen().execute('capture', f.request('capture'), async () => { sends++; }));
  await assert.rejects(f.budget.execute('refund', f.request('capture'), async () => { sends++; })); assert.equal(sends, 3);
});
test('parallel independent guards cannot bypass one exclusive reservation', async () => {
  const f = fixture(), b = f.reopen(); let sends = 0;
  const send = async () => { sends++; return f.provider; };
  const results = await Promise.allSettled([f.budget.execute('create', f.request('create'), send), b.execute('create', f.request('create'), send)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(sends, 1);
});
test('response lost/timeout consumes allowance across restart; GET reconciliation never resubmits', async () => {
  const f = fixture(); let sends = 0;
  await assert.rejects(f.budget.execute('create', f.request('create'), async () => { sends++; throw Error('response lost'); }));
  assert.equal(f.reopen().summary().unknown, true);
  await assert.rejects(f.reopen().execute('create', f.request('create'), async () => { sends++; }));
  f.reopen().reconcile('create', f.provider); assert.equal(f.reopen().summary().unknown, false); assert.equal(sends, 1);
});
test('partial accounting after provider success fails closed without automatic repair', async () => {
  const f = fixture();
  await assert.rejects(f.budget.execute('create', f.request('create'), async () => {
    fs.writeFileSync(path.join(f.directory, 'create.result.json'), 'incomplete'); return f.provider;
  }));
  assert.throws(() => f.reopen().summary()); // Corrupt/partial accounting is never repaired automatically.
});
test('crash after provider success before update retains unknown and GET can confirm it', async () => {
  const f = fixture(); let capturedProviderTruth = null;
  await assert.rejects(f.budget.execute('create', f.request('create'), async () => {
    capturedProviderTruth = { ...f.provider }; throw Error('runner stopped before accounting');
  }));
  assert.equal(f.reopen().summary().unknown, true);
  f.reopen().reconcile('create', capturedProviderTruth);
  assert.equal(f.reopen().summary().operations[0].classification, 'confirmed');
});
test('exact runner plan excludes historical jobs and refuses wrong ownership or scenario', () => {
  const { runnerPlan } = require('./acceptance-runner-scope.cjs');
  const f = fixture(), config = { scenario: f.config.scenario, runId: f.config.runId, approvedRunId: f.config.runId,
    ownerProcessId: process.pid, budgetVerified: true, attemptId: f.config.attemptId };
  const plan = runnerPlan(config); assert.deepEqual(plan.args, ['--once', `--attempt=${config.attemptId}`]);
  plan.assertClaim(config.attemptId); assert.throws(() => plan.assertClaim(randomUUID()));
  assert.throws(() => runnerPlan({ ...config, ownerProcessId: process.pid + 1 }));
  assert.throws(() => runnerPlan({ ...config, scenario: 'implicit' }));
});
test('independent Node processes share one durable allowance', async () => {
  const { execFile } = require('node:child_process');
  const f = fixture(), modulePath = path.resolve(__dirname, 'acceptance-budget.cjs');
  const script = `const fs=require('fs');process.env.NODE_ENV='test';const {openBudget}=require(process.argv[1]);const directory=process.argv[2],config=JSON.parse(fs.readFileSync(directory+'/config.json'));const b=openBudget({directory,config});b.execute('create',{attemptId:config.attemptId,userId:config.userId,amountCents:config.amountCents,idempotencyKey:'electrohub:03.6:'+config.attemptId+':create'},async()=>{fs.appendFileSync(directory+'/effects.txt','effect\\n');return {id:'pi_owned',account:config.accountId,attemptId:config.attemptId,amount:config.amountCents,livemode:false,currency:'usd',captureMethod:'manual',status:'requires_payment_method',received:0,capturable:0};}).then(()=>process.exit(0),()=>process.exit(2));`;
  const launch = () => new Promise(resolve => execFile(process.execPath, ['-e', script, modulePath, f.directory], { windowsHide: true }, error => resolve(error ? 2 : 0)));
  const codes = await Promise.all([launch(), launch()]);
  assert.equal(codes.filter(c => c === 0).length, 1);
  assert.equal(fs.readFileSync(path.join(f.directory, 'effects.txt'), 'utf8'), 'effect\n');
});
test('durable reservation surrounds response-loss hook and prevents a restarted hook recapture', async () => {
  const { responseLossHook, SCENARIO } = require('./real-capture-response-loss.cjs');
  const safety = require('./stripe-gate-safety.cjs');
  const f = fixture();
  await f.budget.execute('create', f.request('create'), async () => f.provider);
  await f.budget.execute('authorize', f.request('authorize'), async () => ({ ...f.provider, status: 'requires_capture', capturable: 1349 }));
  const captureRequest = f.request('capture'); let effects = 0;
  const captured = { ...f.provider, status: 'succeeded', received: 1349, capturable: 0 };
  const provider = { account: async () => f.config.accountId, retrieve: async () => captured,
    capture: async () => { effects++; return captured; } };
  const context = { runtime: 'test', scenario: SCENARIO, projectRef: f.config.projectRef, accountId: f.config.accountId,
    runId: f.config.runId, attemptId: f.config.attemptId, userId: f.config.userId, intentId: f.provider.id, amountCents: 1349,
    isolatedDev: true, connectionBudgetVerified: true, workerScopeAttemptId: f.config.attemptId,
    committedPurchaseVerified: true, orderId: captureRequest.orderId, ownerProcessId: process.pid,
    backendOrigin: 'http://127.0.0.1:5000', sourceFingerprint: safety.sourceFingerprint(path.resolve(__dirname, '..')),
    authorization: { runId: f.config.runId, scenario: SCENARIO, maxCaptureCalls: 1, maxAmountCents: 1349, backendOrigin: 'http://127.0.0.1:5000' } };
  const attempt = { id: f.config.attemptId, userId: f.config.userId, providerIntentId: f.provider.id,
    stripeAccountId: f.config.accountId, amountCents: 1349, currency: 'USD', state: 'CAPTURE_PENDING', orderId: captureRequest.orderId };
  const hook = responseLossHook({ provider, context });
  await assert.rejects(f.budget.execute('capture', captureRequest, () => hook.capture(attempt)), /response loss/);
  hook.assertFired(); assert.equal(f.reopen().summary().unknown, true);
  const restarted = responseLossHook({ provider, context });
  await assert.rejects(f.reopen().execute('capture', captureRequest, () => restarted.capture(attempt)), /Unknown/);
  f.reopen().reconcile('capture', await provider.retrieve());
  assert.equal(f.reopen().summary().operations[2].classification, 'confirmed'); assert.equal(effects, 1);
});
test('request never sent still reserves conservative allowance and cannot auto-reset', async () => {
  const f = fixture();
  await assert.rejects(f.budget.execute('create', f.request('create'), async () => { throw Error('not sent'); }));
  assert.equal(f.reopen().summary().operations[0].dispatchAttempts, 1);
  assert.throws(() => openBudget({ directory: f.directory, config: f.config, initialize: true }));
});
test('definitive decline is separate from confirmed authorization and blocks capture', async () => {
  const f = fixture(); await f.budget.execute('create', f.request('create'), async () => f.provider);
  await f.budget.execute('authorize', f.request('authorize'), async () => ({ ...f.provider, declined: true }));
  assert.equal(f.reopen().summary().operations[1].classification, 'definitive_failure');
  await assert.rejects(f.budget.execute('capture', f.request('capture'), async () => assert.fail('must not capture')));
});
test('provider identity, amount, live mode and store tampering fail closed', async () => {
  for (const change of [{ id: 'bad' }, { account: 'wrong' }, { livemode: true }, { amount: 1 }]) {
    const f = fixture(); await assert.rejects(f.budget.execute('create', f.request('create'), async () => ({ ...f.provider, ...change })));
    assert.equal(f.reopen().summary().unknown, true);
  }
  const f = fixture(); fs.writeFileSync(path.join(f.directory, 'config.json'), '{}');
  await assert.rejects(f.budget.execute('create', f.request('create'), async () => assert.fail('not sent')));
});
test('production, wrong location and secret-bearing configuration rejected', () => {
  const f = fixture(); process.env.NODE_ENV = 'production'; assert.throws(f.reopen); process.env.NODE_ENV = 'test';
  assert.throws(() => openBudget({ directory: f.directory, config: { ...f.config, apiKey: 'forbidden' } }));
  assert.throws(() => openBudget({ directory: f.directory, config: f.config, credential: 'sk_live_forbidden' }));
  assert.throws(() => openBudget({ directory: path.join(f.directory, f.config.runId), config: f.config }));
});
test('budget store unavailable fails before callback', async () => {
  const f = fixture(); fs.renameSync(path.join(f.directory, 'config.json'), path.join(f.directory, 'config.unavailable.json'));
  await assert.rejects(f.budget.execute('create', f.request('create'), async () => assert.fail('not sent')));
});
test('missing reservation with retained effect evidence fails closed', async () => {
  const f = fixture(); await f.budget.execute('create', f.request('create'), async () => f.provider);
  fs.renameSync(path.join(f.directory, 'create.reservation.json'), path.join(f.directory, 'reservation.quarantined.json'));
  assert.throws(() => f.reopen().summary(), /Orphan/);
});
test('fixture contract has immutable unique planned IDs and no implicit creation approval', () => {
  const { fixtureContract } = require('./acceptance-runner-scope.cjs');
  const contract = fixtureContract(randomUUID());
  assert.equal(new Set(contract.products.map(p => p.id)).size, 2);
  assert.equal(contract.products.reduce((n, p) => n + p.priceCents * p.quantity, 0) + contract.shippingCents, 1349);
  assert.equal(contract.creationApproved, false); assert.ok(Object.isFrozen(contract.products[0]));
  assert.equal(contract.products.every(product => product.storefrontVisible === false), true);
});
