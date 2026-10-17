// OFFLINE composition only. Branded disk-backed doubles; never imports SDK, Prisma or a server.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { openBudget } = require('./acceptance-budget.cjs');
const { runnerPlan } = require('./acceptance-runner-scope.cjs');
const { responseLossHook } = require('./real-capture-response-loss.cjs');
const doubles = new WeakSet();
function writeNew(file, data) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function diskProvider(directory, config) {
  assert.equal(process.env.NODE_ENV, 'test');
  const intentId = `pi_${config.attemptId.replaceAll('-', '')}`;
  const state = () => {
    assert.ok(fs.existsSync(path.join(directory, 'double-create.json')));
    return { id: intentId, account: config.accountId, attemptId: config.attemptId, livemode: false, amount: config.amountCents,
      currency: 'usd', captureMethod: 'manual', status: fs.existsSync(path.join(directory, 'double-capture.json')) ? 'succeeded' :
        fs.existsSync(path.join(directory, 'double-authorize.json')) ? 'requires_capture' : 'requires_payment_method',
      received: fs.existsSync(path.join(directory, 'double-capture.json')) ? config.amountCents : 0,
      capturable: fs.existsSync(path.join(directory, 'double-authorize.json')) && !fs.existsSync(path.join(directory, 'double-capture.json')) ? config.amountCents : 0 };
  };
  const p = { account: async () => config.accountId,
    create: async () => { writeNew(path.join(directory, 'double-create.json'), { id: intentId }); return state(); },
    authorize: async () => { writeNew(path.join(directory, 'double-authorize.json'), { id: intentId }); return state(); },
    capture: async () => { writeNew(path.join(directory, 'double-capture.json'), { id: intentId }); return state(); },
    retrieve: async id => { assert.equal(id, intentId); return state(); } };
  doubles.add(p); return p;
}
function guardedAcceptance({ manifest, directory, initialize = false, provider }) {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.ok(manifest?.config && doubles.has(provider), 'Missing approval/guard or non-offline provider');
  const c = manifest.config;
  assert.equal(manifest.ownerProcessId, process.pid);
  assert.equal(manifest.workerAttemptId, c.attemptId);
  assert.match(manifest.workId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(manifest.approvedScenario, c.scenario); assert.equal(manifest.credentialsMode, 'test');
  for (const role of ['api', 'frontend', 'listener', 'runner']) {
    assert.ok(Number.isInteger(manifest.services?.[role]?.pid) && manifest.services[role].pid > 0);
    assert.equal(manifest.services[role].owned, true);
  }
  assert.equal(manifest.listenerDestination, `${manifest.backendOrigin}/api/webhooks/stripe`);
  assert.equal(manifest.budgetStoreOwned, true);
  const budget = openBudget({ directory, config: c, initialize });
  const ownerPath = path.join(directory, 'integration-owner.json');
  if (fs.existsSync(ownerPath)) {
    const old = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    assert.equal(manifest.restartOfProcessId, old.pid, 'Duplicate startup or unapproved restart');
    let exited = false;
    try { process.kill(old.pid, 0); } catch (error) { if (error.code === 'ESRCH') exited = true; }
    assert.equal(exited, true, 'Previous owner still alive or unverifiable');
    fs.renameSync(ownerPath, `${ownerPath}.${randomUUID()}.preserved`);
  }
  writeNew(ownerPath, { pid: process.pid, runId: c.runId, attemptId: c.attemptId });
  const plan = runnerPlan({ ...c, ownerProcessId: process.pid, budgetVerified: true });
  const intentId = `pi_${c.attemptId.replaceAll('-', '')}`;
  const purchasePath = path.join(directory, 'double-purchase.json');
  function request(kind, attempt) {
    plan.assertClaim(attempt.id); assert.equal(attempt.userId, c.userId); assert.equal(attempt.amountCents, c.amountCents);
    assert.equal(attempt.providerIntentId, intentId); assert.equal(attempt.stripeAccountId, c.accountId);
    return { attemptId: c.attemptId, userId: c.userId, amountCents: c.amountCents, intentId,
      idempotencyKey: `electrohub:03.6:${c.attemptId}:${kind === 'authorize' ? 'authorization' : kind}`,
      orderId: attempt.orderId, committedPurchaseVerified: Boolean(attempt.orderId) };
  }
  function load() { return JSON.parse(fs.readFileSync(purchasePath, 'utf8')); }
  function save(value) {
    const temp = `${purchasePath}.${randomUUID()}.tmp`;
    writeNew(temp, value); fs.renameSync(temp, purchasePath);
  }
  const attempt = { id: c.attemptId, userId: c.userId, amountCents: c.amountCents, providerIntentId: intentId,
    stripeAccountId: c.accountId, currency: 'USD', state: 'CAPTURE_PENDING', orderId: null };
  const deny = () => { throw Error('Unapproved financial operation: STOP'); };
  const guardedProvider = Object.freeze({
    create: a => budget.execute('create', request('create', a), () => provider.create(a)),
    capture: a => {
      const current = load(); assert.equal(current.workId, manifest.workId);
      assert.equal(a.orderId, current.orderId); assert.equal(a.leaseToken, current.token);
      assert.ok(current.leaseUntil > Date.now());
      const context = { runtime: 'test', scenario: c.scenario, projectRef: c.projectRef, accountId: c.accountId,
        runId: c.runId, attemptId: c.attemptId, userId: c.userId, intentId, amountCents: c.amountCents,
        sourceFingerprint: c.sourceFingerprint, isolatedDev: true, connectionBudgetVerified: true,
        workerScopeAttemptId: c.attemptId, committedPurchaseVerified: true, orderId: current.orderId,
        ownerProcessId: process.pid, backendOrigin: manifest.backendOrigin,
        authorization: { runId: c.runId, scenario: c.scenario, maxCaptureCalls: 1, maxAmountCents: c.amountCents, backendOrigin: manifest.backendOrigin } };
      const hook = responseLossHook({ provider, context });
      return budget.execute('capture', request('capture', a), async () => {
        if (manifest.loseCaptureResponse) {
          try { return await hook.capture(a); } finally { hook.assertFired(); }
        }
        return provider.capture(a);
      });
    },
    retrieve: id => { assert.equal(id, intentId); return provider.retrieve(id); },
    cancel: deny, refund: deny,
  });
  return Object.freeze({ provider: guardedProvider, budget, attempt, runnerArgs: plan.args,
    close: () => {
      const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
      assert.equal(owner.pid, process.pid); assert.equal(owner.runId, c.runId);
      fs.renameSync(ownerPath, `${ownerPath}.${randomUUID()}.preserved`);
    },
    authorize: () => budget.execute('authorize', request('authorize', attempt), () => provider.authorize(attempt)),
    commit: () => {
      assert.equal(budget.summary().operations.find(o => o.kind === 'authorize')?.classification, 'confirmed');
      if (!fs.existsSync(purchasePath)) writeNew(purchasePath, { orderId: randomUUID(), workId: manifest.workId,
        orderCount: 1, paymentCount: 1, inventory: [8, 7], token: null, leaseUntil: 0, state: 'CAPTURE_PENDING' });
      const p = load(); attempt.orderId = p.orderId; return p;
    },
    claim: (id, workId) => {
      plan.assertClaim(id); assert.equal(workId, manifest.workId);
      const p = load(); assert.ok(p.leaseUntil <= Date.now(), 'Competing lease cannot be claimed');
      p.token = randomUUID(); p.leaseUntil = Date.now() + 120000; save(p);
      return { ...attempt, orderId: p.orderId, leaseToken: p.token };
    },
    expireDoubleLease: () => { const p = load(); p.leaseUntil = 0; save(p); },
    reconcile: async claimed => {
      plan.assertClaim(claimed.id);
      const p = load(); assert.equal(claimed.leaseToken, p.token); assert.ok(p.leaseUntil > Date.now());
      const truth = await guardedProvider.retrieve(intentId);
      const current = load(); assert.equal(claimed.leaseToken, current.token); assert.ok(current.leaseUntil > Date.now());
      if (budget.summary().operations.find(o => o.kind === 'capture')?.classification === 'unknown') budget.reconcile('capture', truth);
      assert.equal(truth.status, 'succeeded'); assert.equal(truth.received, c.amountCents);
      p.state = 'PAID'; p.workState = 'DONE'; p.token = null; p.leaseUntil = 0; save(p); return p;
    },
  });
}
module.exports = { diskProvider, guardedAcceptance };
