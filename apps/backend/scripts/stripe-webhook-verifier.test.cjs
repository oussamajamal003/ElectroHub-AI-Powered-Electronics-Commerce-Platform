const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const path = require('node:path');
const {
  ensureBackend,
  isExpectedBackend,
  resolveStripeExecutable,
  startListener,
  stopOwnedProcess,
  waitForCondition,
  waitForPersistedEvent,
  verifyDuplicateDelivery,
} = require('./stripe-webhook-verifier.cjs');

const backendEntrypoint = path.resolve('apps/backend/dist/server.js');

test('buffers split listener lines and correlates explicit event identity with forwarding status', async () => {
  const child=childProcess();child.pid=123;const receipts=[];
  const pending=startListener({apiKey:'never-persist',forwardUrl:'http://localhost:5000/api/webhooks/stripe',
    spawnProcess:()=>child,onReceipt:row=>receipts.push(row)});
  child.stdout.write('Ready whsec_disposable\n');await pending;
  child.stdout.write('--> payment_intent.succ');child.stdout.write('eeded [evt_test]\n');
  child.stderr.write('<-- [200] POST http://localhost:5000/api/webhooks/stripe [evt_');child.stderr.write('test]\n');
  assert.equal(receipts.length,2);assert.equal(receipts[0].eventId,'evt_test');assert.equal(receipts[1].eventId,'evt_test');
  assert.equal(receipts[1].status,200);assert.equal(receipts[0].listenerPid,123);
  assert.equal(receipts[1].eventType,'payment_intent.succeeded');
  assert.equal(receipts[1].forwardingDestination,'http://localhost:5000/api/webhooks/stripe');
  assert.doesNotMatch(JSON.stringify(receipts),/whsec_|never-persist/);
});

function childProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  return child;
}

test('recognizes only the expected backend entrypoint', () => {
  assert.equal(isExpectedBackend(`node "${backendEntrypoint}"`, backendEntrypoint), true);
  assert.equal(isExpectedBackend('node unrelated-server.js', backendEntrypoint), false);
});

test('prefers explicit Stripe CLI path and resolves the official Windows npm binary over PATH shims', () => {
  assert.equal(resolveStripeExecutable({ configuredPath: 'C:/explicit/stripe.exe', platform: 'win32' }), 'C:/explicit/stripe.exe');
  const appData = 'C:/Users/test/AppData/Roaming';
  assert.equal(resolveStripeExecutable({ platform: 'win32', appData, exists: () => true }),
    path.join(appData, 'npm', 'node_modules', '@stripe', 'cli', 'node_modules', '@stripe', 'cli-win32-x64', 'bin', 'stripe.exe'));
  assert.equal(resolveStripeExecutable({ platform: 'win32', appData, exists: () => false }), 'stripe');
});

test('preserves a verified existing backend whose active signing secret cannot be proved', async () => {
  const process = childProcess();
  await assert.rejects(ensureBackend({
    port: 5000,
    signingSecret: 'never-logged',
    entrypoint: backendEntrypoint,
    findOwner: async () => 42,
    processCommandLine: async () => `node "${backendEntrypoint}"`,
    health: async () => true,
    spawnProcess: () => { throw new Error('must not spawn'); },
  }), /signing secret cannot be bound/);
  assert.equal(process.killed, false);
});

test('refuses an unknown process on the configured port without spawning or killing it', async () => {
  let spawned = false;
  await assert.rejects(ensureBackend({
    port: 5000, signingSecret: 'never-logged', entrypoint: backendEntrypoint,
    findOwner: async () => 99,
    processCommandLine: async () => 'node unknown.js',
    health: async () => true,
    spawnProcess: () => { spawned = true; return childProcess(); },
  }), /unknown or unhealthy process/);
  assert.equal(spawned, false);
});

test('refuses if any reported owner of a port is not the expected backend', async () => {
  let spawned = false;
  await assert.rejects(ensureBackend({
    port: 5000, signingSecret: 'never-logged', entrypoint: backendEntrypoint,
    findOwner: async () => [42, 99],
    processCommandLine: async pid => pid === 42 ? `node "${backendEntrypoint}"` : 'unrelated.exe',
    health: async () => true,
    spawnProcess: () => { spawned = true; return childProcess(); },
  }), /unknown or unhealthy process/);
  assert.equal(spawned, false);
});

test('marks a child it starts as owned and cleanup kills only that child', async () => {
  const child = childProcess();
  const owned = await ensureBackend({
    port: 5001, signingSecret: 'never-logged', entrypoint: backendEntrypoint,
    findOwner: async () => null,
    health: async () => true,
    spawnProcess: () => child,
  });
  assert.equal(owned.owned, true);
  assert.equal(stopOwnedProcess({ ...owned, owned: false }), false);
  assert.equal(child.killed, false);
  assert.equal(stopOwnedProcess(owned), true);
  assert.equal(child.killed, true);
});

test('fails safely when Stripe CLI cannot be started', async () => {
  await assert.rejects(startListener({
    executable: 'missing-stripe', apiKey: 'secret', forwardUrl: 'http://127.0.0.1:1',
    spawnProcess: () => {
      const child = childProcess();
      queueMicrotask(() => child.emit('error', new Error('spawn missing-stripe ENOENT')));
      return child;
    },
  }), /ENOENT/);
});

test('fails if Stripe CLI exits before listener readiness', async () => {
  await assert.rejects(startListener({
    executable: 'stripe', apiKey: 'secret', forwardUrl: 'http://127.0.0.1:1',
    spawnProcess: () => {
      const child = childProcess();
      queueMicrotask(() => child.emit('exit', 2));
      return child;
    },
  }), /exited before readiness/);
});

test('terminates only its Stripe CLI child when listener readiness times out', async () => {
  const child = childProcess();
  await assert.rejects(startListener({
    executable: 'stripe', apiKey: 'secret', forwardUrl: 'http://127.0.0.1:1', readinessTimeoutMs: 1,
    spawnProcess: () => child,
  }), /Timed out waiting for Stripe CLI listener readiness/);
  assert.equal(child.killed, true);
});

test('condition polling returns only after its predicate is true', async () => {
  let calls = 0;
  const result = await waitForCondition(async () => ++calls, value => value === 3, {
    timeoutMs: 100, intervalMs: 0, pause: async () => {},
  });
  assert.equal(result, 3);
});

test('event persistence timeout cannot become a success result', async () => {
  const database = { stripeEvent: { findUnique: async () => null } };
  await assert.rejects(waitForPersistedEvent('evt_missing', 'payment_intent.succeeded', database, {
    timeoutMs: 0, now: () => 0, pause: async () => {},
  }), /Timed out/);
});

test('persisted bound event requires a durable work row', async () => {
  const database = {
    stripeEvent: { findUnique: async () => ({ id: 'evt_bound', type: 'payment_intent.succeeded', attemptId: 'attempt-1', disposition: 'ACCEPTED' }) },
    paymentWork: { findUnique: async () => null },
  };
  await assert.rejects(waitForPersistedEvent('evt_bound', 'payment_intent.succeeded', database, {
    timeoutMs: 0, now: () => 0, pause: async () => {},
  }), /Timed out/);
});

test('signed event readback validates event type and accepts unbound ignored fixture honestly', async () => {
  const database = { stripeEvent: { findUnique: async () => ({ id: 'evt_fixture', type: 'payment_intent.succeeded', attemptId: null, disposition: 'IGNORED' }) } };
  const result = await waitForPersistedEvent('evt_fixture', 'payment_intent.succeeded', database, { timeoutMs: 0, now: () => 0 });
  assert.equal(result.bound, false);
  assert.equal(result.work, null);
  await assert.rejects(waitForPersistedEvent('evt_fixture', 'payment_intent.canceled', database, { timeoutMs: 0, now: () => 0 }), /type did not match/);
});

test('invalid event identities are rejected before database access', async () => {
  let read = false;
  const database = { stripeEvent: { findUnique: async () => { read = true; return null; } } };
  await assert.rejects(waitForPersistedEvent('not-an-event', 'payment_intent.succeeded', database), /Invalid Stripe event identity/);
  assert.equal(read, false);
});

test('same signed duplicate remains one event and leaves bound work unchanged', async () => {
  const work = { state: 'DONE', retryCount: 0, leaseToken: null, updatedAt: new Date(1000) };
  assert.equal(await verifyDuplicateDelivery({
    replay: async () => ({ status: 200 }),
    countEvents: async () => 1,
    eventId: 'evt_once',
    readWork: async () => work,
    attemptId: 'attempt-1',
    priorWork: work,
  }), true);
});

test('duplicate delivery fails evidence if durable work changes', async () => {
  const before = { state: 'DONE', retryCount: 0, leaseToken: null, updatedAt: new Date(1000) };
  const after = { ...before, updatedAt: new Date(2000) };
  await assert.rejects(verifyDuplicateDelivery({
    replay: async () => ({ status: 200 }),
    countEvents: async () => 1,
    eventId: 'evt_once',
    readWork: async () => after,
    attemptId: 'attempt-1',
    priorWork: before,
  }), /changed durable work/);
});
