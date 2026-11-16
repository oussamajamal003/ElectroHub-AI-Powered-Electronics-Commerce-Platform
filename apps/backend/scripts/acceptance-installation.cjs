// Explicit dependency injection for an isolated acceptance child. No automatic startup or SDK patch.
const assert = require('node:assert/strict');
const { openBudget } = require('./acceptance-budget.cjs');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { responseLossHook } = require('./real-capture-response-loss.cjs');
const { finishLifecycle } = require('./acceptance-lifecycle.cjs');
const { captureContract, assertCaptureContract } = require('./acceptance-capture-contract.cjs');
const { claimOwner } = require('./acceptance-owner.cjs');
function installAcceptance({ manifest, directory, provider, database, serviceFactory }) {
  assert.equal(process.env.NODE_ENV, 'test');
  manifest = Object.freeze({ ...manifest, config: Object.freeze({ ...manifest?.config }),
    captureAuthorization: manifest?.captureAuthorization ? Object.freeze({ ...manifest.captureAuthorization }) : null });
  assert.equal(manifest.ownerPid, process.pid);
  assert.equal(manifest.parentPid, process.ppid);
  assert.equal(manifest.executable, process.execPath);
  assert.equal(manifest.cwd, process.cwd());
  assert.match(manifest.workId, /^[a-f0-9-]{36}$/i);
  assert.match(manifest.browserSessionId, /^[a-f0-9-]{36}$/i);
  assert.equal(manifest.role === 'api' || manifest.role === 'runner', true);
  const config = manifest.config;
  const budget = openBudget({ directory, config });
  const originalInstance = provider;
  // Bind before installing on an owned singleton; never patch Stripe SDK classes/globals.
  provider = Object.freeze(Object.fromEntries(['account', 'create', 'retrieve', 'capture', 'cancel', 'refund', 'retrieveRefund']
    .filter(key => typeof provider[key] === 'function').map(key => [key, provider[key].bind(originalInstance)])));
  if (manifest.loseCaptureResponse) assert.equal(manifest.capacityVerified, true);
  const identity = { pid: process.pid, parentPid: process.ppid, executable: process.execPath, cwd: process.cwd(),
    runId: config.runId, attemptId: config.attemptId, workId: manifest.workId, sourceFingerprint: config.sourceFingerprint, instanceId: randomUUID() };
  const identityFile = claimOwner(directory, manifest.role, identity, manifest.restartOfProcessId);
  let closed = false;
  function assertOwned() {
    assert.equal(closed, false, 'Acceptance runtime is closed'); assert.equal(process.env.NODE_ENV, 'test');
    assert.equal(fs.lstatSync(identityFile).isSymbolicLink(), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(identityFile, 'utf8')), identity, 'Acceptance role ownership changed');
  }
  function closeOwned() {
    assertOwned(); closed = true;
    fs.renameSync(identityFile, `${identityFile}.${randomUUID()}.preserved`);
  }
  async function account() { assertOwned(); assert.equal(await provider.account(), config.accountId); assertOwned(); return config.accountId; }
  function request(kind, attempt) {
    assertOwned();
    assert.equal(attempt.id, config.attemptId); assert.equal(attempt.userId, config.userId);
    assert.equal(attempt.amountCents, config.amountCents); assert.equal(attempt.stripeAccountId, config.accountId);
    const creation = budget.summary().operations.find(o => o.kind === 'create');
    if (kind !== 'create') assert.equal(attempt.providerIntentId, creation?.provider?.id);
    return { attemptId: attempt.id, userId: attempt.userId, amountCents: attempt.amountCents,
      intentId: attempt.providerIntentId, idempotencyKey: `electrohub:03.6:${attempt.id}:${kind === 'authorize' ? 'authorization' : kind}`,
      orderId: attempt.orderId, committedPurchaseVerified: Boolean(attempt.orderId) };
  }
  const deny = async () => { throw Error('Cancellation/refund/compensation is not approved'); };
  let ownedClaim = null;
  // Observe only this child's successful exact-attempt claim; never infer ownership from an arbitrary DB token.
  const guardedDatabase = new Proxy(database, { get(target, key) {
    if (key !== 'paymentWork') return Reflect.get(target, key);
    return new Proxy(target.paymentWork, { get(workTarget, method) {
      if (method === 'findMany') return async () => { throw Error('Unrestricted payment queue scanning forbidden'); };
      if (method !== 'updateMany') return Reflect.get(workTarget, method);
      return async args => {
        assertOwned();
        assert.equal(args.where?.attemptId, config.attemptId, 'Unscoped worker claim');
        if (args.data?.state === 'LEASED') {
          assert.equal(manifest.role, 'runner');
          assert.match(args.data.leaseToken, /^[a-f0-9-]{36}$/i);
          assert.ok(args.data.leaseUntil instanceof Date && args.data.leaseUntil > new Date());
        }
        const result = await workTarget.updateMany({ ...args, where: { ...args.where, id: manifest.workId } });
        assertOwned();
        if (args.data?.state === 'LEASED' && result.count === 1) ownedClaim = Object.freeze({
          token: args.data.leaseToken, until: args.data.leaseUntil.getTime(), ownerPid: process.pid });
        return result;
      };
    } });
  } });
  const adapter = Object.freeze({ account,
    create: async attempt => { await account(); return budget.execute('create', request('create', attempt), async () => {
      const truth = await provider.create(attempt); assertOwned(); return truth;
    }); },
    retrieve: async id => {
      const expected = budget.summary().operations.find(o => o.kind === 'create')?.provider?.id;
      assert.equal(id, expected); await account(); const truth = await provider.retrieve(id);
      assertOwned();
      assert.equal(truth.id, expected); assert.equal(truth.account, config.accountId); assert.equal(truth.livemode, false);
      assert.equal(truth.attemptId, config.attemptId); assert.equal(truth.amount, config.amountCents);
      assert.equal(truth.currency, 'usd'); assert.equal(truth.captureMethod, 'manual'); return truth;
    },
    capture: async attempt => {
      assert.equal(manifest.role, 'runner', 'Only the isolated scoped runner may capture');
      assert.equal(attempt.state, 'CAPTURE_PENDING'); assert.equal(attempt.currency, 'USD');
      request('capture', attempt); // Reject foreign attempt/intent/amount before any provider access.
      await account(); const work = await database.paymentWork.findUnique({ where: { attemptId: config.attemptId } });
      assert.equal(work?.id, manifest.workId); assert.equal(work?.attemptId, config.attemptId);
      assert.equal(work?.state, 'LEASED'); assert.ok(work?.leaseToken && work?.leaseUntil > new Date());
      let contract = manifest.captureAuthorization;
      if (!contract) {
        assert.equal(ownedClaim?.ownerPid, process.pid, 'Capture authorization contract missing');
        assert.equal(work.leaseToken, ownedClaim.token); assert.equal(work.leaseUntil.getTime(), ownedClaim.until);
        contract = captureContract(config, work, attempt.providerIntentId);
      }
      assertCaptureContract(contract, config, attempt, work, manifest.workId);
      const verifyLease = async () => {
        assertOwned();
        const current = await database.paymentWork.findUnique({ where: { attemptId: config.attemptId } });
        assertOwned();
        assertCaptureContract(contract, config, attempt, current, manifest.workId);
      };
      const order = await database.order.findUnique({ where: { id: attempt.orderId }, select: {
        id: true, userId: true, status: true, payment: { select: { provider: true, providerPaymentId: true, status: true, amount: true, currency: true } },
      } });
      assert.equal(order?.id, attempt.orderId); assert.equal(order?.userId, config.userId); assert.equal(order?.status, 'AWAITING_CAPTURE');
      assert.equal(order?.payment?.provider, 'STRIPE'); assert.equal(order?.payment?.status, 'PROCESSING');
      assert.equal(order?.payment?.providerPaymentId, attempt.providerIntentId); assert.equal(order?.payment?.currency, 'USD');
      const amount = String(order.payment.amount); assert.match(amount, /^\d+(?:\.\d{1,2})?$/);
      const [whole, fraction = ''] = amount.split('.'); assert.equal(Number(whole) * 100 + Number(fraction.padEnd(2, '0')), config.amountCents);
      const send = manifest.loseCaptureResponse ? responseLossHook({ provider, beforeCapture: verifyLease, context: {
        ...config, runtime: 'test', intentId: attempt.providerIntentId, orderId: attempt.orderId,
        isolatedDev: true, connectionBudgetVerified: manifest.capacityVerified,
        workerScopeAttemptId: config.attemptId, committedPurchaseVerified: true, ownerProcessId: process.pid,
        backendOrigin: manifest.backendOrigin, authorization: { runId: config.runId, scenario: config.scenario,
          maxCaptureCalls: 1, maxAmountCents: config.amountCents, backendOrigin: manifest.backendOrigin },
      } }) : null;
      return budget.execute('capture', request('capture', attempt), async () => {
        await verifyLease();
        const permission = path.join(directory, 'capture.permission.json');
        const permissionFd = fs.openSync(permission, 'wx', 0o600);
        try { fs.writeFileSync(permissionFd, JSON.stringify(contract)); fs.fsyncSync(permissionFd); } finally { fs.closeSync(permissionFd); }
        if (!send) { const truth = await provider.capture(attempt); assertOwned(); return truth; }
        let primary, result;
        try { result = await send.capture(attempt); } catch (error) { primary = error; }
        const failures = [];
        try { send.assertFired(); } catch (error) { failures.push(error); }
        finishLifecycle(primary, failures);
        return result;
      });
    }, cancel: deny, refund: deny, retrieveRefund: deny,
  });
  let service;
  try { service = serviceFactory(guardedDatabase, adapter); }
  catch (error) {
    const failures = []; try { closeOwned(); } catch (cleanup) { failures.push(cleanup); }
    finishLifecycle(error, failures);
  }
  const ownedContexts = new WeakSet();
  return Object.freeze({ adapter, service, budget: Object.freeze({ summary: () => budget.summary() }),
    async claimForReconciliation() {
      assertOwned(); assert.equal(manifest.role, 'runner');
      const now = new Date();
      const result = await guardedDatabase.paymentWork.updateMany({ where: { attemptId: config.attemptId, OR: [
        { state: 'READY', nextRunAt: { lte: now } }, { state: 'LEASED', leaseUntil: { lt: now } } ] },
        data: { state: 'LEASED', leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 120000) } });
      assert.equal(result.count, 1, 'Reconciliation lease not acquired');
    },
    async reconcileUnknown() {
      assertOwned();
      const summary = budget.summary(); const uncertain = summary.operations.find(operation => operation.classification === 'unknown');
      if (!uncertain) return summary;
      assert.notEqual(uncertain.kind, 'create', 'Unknown creation identity requires operator reconciliation');
      const id = summary.operations.find(operation => operation.kind === 'create')?.provider?.id;
      const verifyReconciliationLease = async () => {
        assertOwned();
        if (manifest.role === 'api') { assert.equal(uncertain.kind, 'authorize'); return; }
        const work = await database.paymentWork.findUnique({ where: { attemptId: config.attemptId } });
        assertOwned(); assert.equal(work?.id, manifest.workId); assert.equal(work?.attemptId, config.attemptId);
        assert.equal(work?.state, 'LEASED'); assert.equal(ownedClaim?.ownerPid, process.pid);
        assert.equal(work?.leaseToken, ownedClaim.token); assert.equal(work?.leaseUntil?.getTime(), ownedClaim.until);
        assert.ok(work.leaseUntil > new Date(), 'Reconciliation lease expired');
      };
      await verifyReconciliationLease();
      // Only an authoritative guarded GET can update accounting; callers cannot inject provider truth or a send callback.
      const truth = await adapter.retrieve(id); await verifyReconciliationLease();
      budget.reconcile(uncertain.kind, truth);
      return budget.summary();
    },
    bindOwnedInstance() {
      assert.equal(manifest.ownerPid, process.pid);
      const previous = Object.fromEntries(Object.keys(adapter).map(key => [key, Object.getOwnPropertyDescriptor(originalInstance, key)]));
      Object.assign(originalInstance, adapter);
      return () => {
        for (const key of Object.keys(adapter)) {
          assert.equal(originalInstance[key], adapter[key], 'Owned adapter changed unexpectedly');
          if (previous[key]) Object.defineProperty(originalInstance, key, previous[key]); else delete originalInstance[key];
        }
      };
    },
    async runOnce() {
      assertOwned();
      assert.equal(manifest.role, 'runner');
      const work = await database.paymentWork.findUnique({ where: { attemptId: config.attemptId } });
      assert.equal(work?.id, manifest.workId); assert.equal(work?.attemptId, config.attemptId);
      // Never runBatch: no queue scan; production process() retains lease/fencing checks.
      return service.process(config.attemptId);
    },
    async createBrowserContext(browser, sessionId) {
      assertOwned();
      assert.equal(manifest.role, 'api');
      assert.equal(sessionId, manifest.browserSessionId);
      const context = await browser.newContext({ serviceWorkers: 'block' });
      ownedContexts.add(context);
      await this.installBrowserBoundary(context, sessionId);
      return context;
    },
    async installBrowserBoundary(context, sessionId) {
      assert.equal(manifest.role, 'api'); assert.equal(sessionId, manifest.browserSessionId);
      assert.equal(ownedContexts.has(context), true, 'Only an isolated service-worker-blocked context is permitted');
      const authorizePath = /^https:\/\/api\.stripe\.com\/v1\/payment_intents\/(pi_[A-Za-z0-9]+)\/confirm$/;
      await context.route('https://api.stripe.com/**', async route => {
        try { assertOwned(); } catch { await route.abort('blockedbyclient'); return; }
        const req = route.request();
        if (req.method() !== 'POST') return route.continue();
        const url = new URL(req.url());
        const financial = /\/payment_intents(?:\/|$)|\/refunds(?:\/|$)|\/charges(?:\/|$)/.test(url.pathname);
        if (!financial) return route.continue(); // Hosted payment-method collection, never raw body logging.
        let fulfilled = false;
        try {
          const match = authorizePath.exec(`${url.origin}${url.pathname}`);
          assert.ok(match); assert.equal(url.search, '');
          const created = budget.summary().operations.find(o => o.kind === 'create')?.provider;
          assert.equal(match[1], created?.id);
          await account();
          await budget.execute('authorize', { attemptId: config.attemptId, userId: config.userId, amountCents: config.amountCents,
            intentId: match[1], idempotencyKey: `electrohub:03.6:${config.attemptId}:authorization` }, async () => {
            const response = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
            assertOwned();
            assert.ok(response.status() < 300 || response.status() >= 400, 'Financial redirects are forbidden');
            await route.fulfill({ response });
            fulfilled = true;
            return adapter.retrieve(match[1]); // Provider truth, never trusts browser response or amount.
          });
        } catch { if (!fulfilled) await route.abort('blockedbyclient'); }
      });
    },
    close() {
      closeOwned();
    },
  });
}
function installBeforeBootstrap(options, bootstrap) {
  const runtime = installAcceptance(options);
  let restore;
  try { restore = runtime.bindOwnedInstance(); }
  catch (error) {
    const failures = []; try { runtime.close(); } catch (cleanup) { failures.push(cleanup); }
    finishLifecycle(error, failures);
  }
  function dispose(primary = null) {
    const failures = [];
    try { restore(); } catch (error) { failures.push(error); }
    try { runtime.close(); } catch (error) { failures.push(error); }
    finishLifecycle(primary, failures);
  }
  try { return { runtime, application: bootstrap(), dispose }; }
  catch (error) { dispose(error); throw error; }
}
module.exports = { installAcceptance, installBeforeBootstrap };
