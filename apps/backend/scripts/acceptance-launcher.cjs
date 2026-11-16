// The launcher and owned children share this bootstrap. Financial execution stays blocked at the CLI.
const assert = require('node:assert/strict');
const { openBudget } = require('./acceptance-budget.cjs');
const { assertLedgerPermissions } = require('./acceptance-ledger-permissions.cjs');
const { installAcceptance } = require('./acceptance-installation.cjs');
const { withOwnedCleanup, finishLifecycle } = require('./acceptance-lifecycle.cjs');
const fs = require('node:fs');
const path = require('node:path');
function bootstrapAcceptance({ manifest, directory, database, providerFactory, serviceFactory, bootstrap }) {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(manifest.ownerPid, process.pid); assert.equal(manifest.parentPid, process.ppid);
  assert.equal(manifest.executable, process.execPath); assert.equal(manifest.cwd, process.cwd());
  const origin = new URL(manifest.backendOrigin);
  assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname)); assert.equal(origin.protocol, 'http:');
  assert.ok(origin.port); assert.equal(origin.pathname, '/'); assert.equal(origin.search, ''); assert.equal(origin.hash, '');
  assert.equal(manifest.listenerDestination, `${origin.origin}/api/webhooks/stripe`);
  const budget = openBudget({ directory, config: manifest.config }); // Accounting and source verification precede provider initialization.
  assertLedgerPermissions(directory);
  const permissionFile = path.join(directory, 'capture.permission.json');
  if (fs.existsSync(permissionFile)) {
    const permission = JSON.parse(fs.readFileSync(permissionFile, 'utf8'));
    const capture = budget.summary().operations.find(o => o.kind === 'capture');
    assert.ok(capture?.reserved, 'Orphan capture permission');
    assert.equal(permission.operationId, `${manifest.config.runId}:${manifest.config.attemptId}:capture`);
    assert.equal(permission.runId, manifest.config.runId); assert.equal(permission.attemptId, manifest.config.attemptId);
    assert.equal(permission.workId, manifest.workId); assert.equal(permission.accountId, manifest.config.accountId);
    assert.equal(permission.amountCents, manifest.config.amountCents);
  }
  let installed = false, actual;
  const provider = Object.freeze(Object.fromEntries(['account', 'create', 'retrieve', 'capture', 'cancel', 'refund', 'retrieveRefund'].map(method => [method, async (...args) => {
    assert.equal(installed, true, 'Unguarded provider initialization');
    assertLedgerPermissions(directory);
    if (method === 'capture') {
      const permission = JSON.parse(fs.readFileSync(permissionFile, 'utf8'));
      assert.equal(permission.ownerPid, process.pid); assert.equal(permission.parentPid, process.ppid);
      assert.equal(permission.executable, process.execPath); assert.ok(permission.leaseUntilMs > Date.now());
      assert.equal(permission.intentId, args[0]?.providerIntentId); assert.equal(permission.attemptId, args[0]?.id);
      assert.equal(permission.amountCents, args[0]?.amountCents);
      const reservation = budget.summary().operations.find(o => o.kind === 'capture');
      assert.equal(reservation?.classification, 'unknown'); assert.equal(reservation?.dispatchAttempts, 1);
    }
    actual ??= providerFactory();
    assert.equal(typeof actual?.[method], 'function');
    return actual[method](...args);
  }])));
  const runtime = installAcceptance({ manifest, directory, database, provider, serviceFactory });
  installed = true;
  // Bootstrap receives only the guarded capability, never the raw factory/provider/SDK.
  let application;
  try { application = bootstrap ? bootstrap(runtime) : undefined; }
  catch (error) {
    const failures = []; try { runtime.close(); } catch (cleanup) { failures.push(cleanup); }
    finishLifecycle(error, failures);
  }
  return Object.freeze({ runtime, application, async run(operation) { return withOwnedCleanup(() => operation(runtime, application), () => runtime.close()); } });
}
module.exports = { bootstrapAcceptance };
