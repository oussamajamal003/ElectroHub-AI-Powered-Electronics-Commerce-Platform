// Offline startup rehearsal only. Real service/SDK/database startup remains blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { bootstrapAcceptance } = require('./acceptance-launcher.cjs');
const { diskProvider } = require('./guarded-acceptance.cjs');
async function main(argv) {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(argv[0], '--offline-boundary'); assert.equal(argv.length, 3);
  const manifest = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
  // Identity supplied by the owning parent must name this exact spawned child.
  const directory = argv[2];
  return executeOffline(manifest, directory);
}
async function executeOffline(manifest, directory) {
  assert.equal(process.env.NODE_ENV, 'test');
  const work = { id: manifest.workId, attemptId: manifest.config.attemptId, state: 'READY', leaseToken: null, leaseUntil: null };
  const installed = bootstrapAcceptance({ manifest, directory, providerFactory: () => diskProvider(directory, manifest.config),
    database: { paymentWork: { findUnique: async () => ({ ...work }), updateMany: async args => {
      assert.equal(args.where.attemptId, work.attemptId); assert.equal(args.where.id, work.id);
      if (work.state === 'LEASED' && work.leaseUntil > new Date()) return { count: 0 };
      Object.assign(work, args.data); return { count: 1 };
    } } },
    serviceFactory: (_db, adapter) => ({ process: async id => {
      assert.equal(id, manifest.config.attemptId);
      return adapter.create({ id, userId: manifest.config.userId, amountCents: manifest.config.amountCents, stripeAccountId: manifest.config.accountId });
    } }),
  });
  if (manifest.offlineOperation === 'abandon-owner') return; // Deterministic startup-crash rehearsal: no provider call.
  return installed.run(async runtime => {
    if (manifest.offlineOperation === 'reconcile-capture') {
      await runtime.claimForReconciliation();
      await runtime.reconcileUnknown();
      return;
    }
    assert.equal(manifest.offlineOperation === undefined || manifest.offlineOperation === 'create', true);
    return runtime.runOnce();
  });
}
if (require.main === module) {
  if (process.argv.length === 3 && process.argv[2] === '--offline-ipc' && process.send) {
    const timer = setTimeout(() => { process.exitCode = 2; process.disconnect(); }, 3000);
    process.once('message', message => {
      clearTimeout(timer);
      executeOffline(message.manifest, message.directory).catch(() => { process.exitCode = 2; }).finally(() => process.disconnect());
    });
    process.send({ pid: process.pid, parentPid: process.ppid, executable: process.execPath, cwd: process.cwd() });
  } else main(process.argv.slice(2)).catch(() => { process.exitCode = 2; });
}
module.exports = { main };
