'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { startEmailWorker, readinessOf, acquireWorkerLock } = require('./commerce-email-dev.cjs');
function harness() {
  const backend = fs.mkdtempSync(path.join(os.tmpdir(), 'electrohub-email-drain-'));
  const children = [];
  const worker = startEmailWorker({ backend, entry: { command: process.execPath, args: ['runner.js'] },
    env: { COMMERCE_EMAIL_DISPATCH_ENABLED: 'true', COMMERCE_EMAIL_SEND_MODE: 'capture', FRONTEND_URL: 'http://localhost:3000' },
    log: () => {}, readiness: false, backoffMs: [5], spawn: () => {
      const child = new EventEmitter(); Object.assign(child, { pid: 1 + children.length, stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null, connected: true });
      child.kill = () => { throw new Error('Worker was force-stopped instead of draining'); };
      child.disconnect = () => { child.connected = false; setTimeout(() => { child.exitCode = 0; child.emit('exit', 0); }, 10); };
      children.push(child); return child;
    } });
  return { backend, children, worker };
}
test('shutdown disconnects IPC, retains lock while draining and removes it only after child exits', async () => {
  const h = harness(); const file = path.join(h.backend, '.cache/commerce-email-worker.lock');
  try {
    assert.equal(h.worker.status().ready, false);
    assert.equal(acquireWorkerLock(h.backend).held, false, 'same supervisor cannot start duplicate worker');
    const stopped = h.worker.stop(); assert.equal(fs.existsSync(file), true); await stopped;
    assert.equal(fs.existsSync(file), false); assert.equal(h.worker.status().started, false);
  } finally { await h.worker.stop(); fs.rmSync(h.backend, { recursive: true }); }
});
test('startup errors share the bounded crash path and stopped workers never restart', async () => {
  const h = harness();
  try {
    h.children[0].emit('error', new Error('spawn fixture'));
    h.children[0].exitCode = 1; h.children[0].emit('exit', 1);
    assert.equal(h.worker.status().ready, false);
    await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(h.children.length, 2);
    await h.worker.stop(); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(h.children.length, 2);
  } finally { await h.worker.stop(); fs.rmSync(h.backend, { recursive: true }); }
});
test('readiness ignores previous PID generations and reflects a later degraded heartbeat', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'electrohub-email-heartbeat-')); const file = path.join(folder, 'app.log');
  try {
    const at = Date.now();
    fs.writeFileSync(file, JSON.stringify({ event: 'email_worker_ready', pid: 123, timestamp: new Date(at - 1000).toISOString() }) + '\n');
    assert.equal(readinessOf(file, 123, at), null);
    fs.appendFileSync(file, JSON.stringify({ event: 'email_worker_ready', pid: 123, timestamp: new Date(at).toISOString(), sendMode: 'capture' }) + '\n');
    assert.equal(readinessOf(file, 123, at).ready, true);
    fs.appendFileSync(file, JSON.stringify({ event: 'email_worker_heartbeat', pid: 123, timestamp: new Date(at + 1).toISOString(), paused: true }) + '\n');
    assert.equal(readinessOf(file, 123, at).ready, false);
  } finally { fs.rmSync(folder, { recursive: true }); }
});
test('corrupt worker ownership is retained rather than guessed stale', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'electrohub-email-corrupt-'));
  const file = path.join(folder, '.cache/commerce-email-worker.lock'); fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, '{broken');
  try { assert.throws(() => acquireWorkerLock(folder), /unreadable/); assert.equal(fs.readFileSync(file, 'utf8'), '{broken'); }
  finally { fs.rmSync(folder, { recursive: true }); }
});

test('push environment: one generated VAPID pair, stored privately and reused, bound to the verified identity', () => {
  const { pushEnvironment, PUSH_SUBJECT } = require('./commerce-email-dev.cjs');
  const backend = fs.mkdtempSync(path.join(os.tmpdir(), 'electrohub-push-env-'));
  let generated = 0;
  const generate = () => { generated += 1; return { publicKey: 'B' + 'p'.repeat(86), privateKey: 'k'.repeat(43) }; };
  const first = pushEnvironment(backend, 'supabase:project/postgres', generate);
  assert.equal(first.CUSTOMER_PUSH_ENABLED, 'true');
  assert.equal(first.CUSTOMER_PUSH_APPROVED_TARGET, 'supabase:project/postgres');
  assert.equal(first.WEB_PUSH_VAPID_SUBJECT, PUSH_SUBJECT);
  assert.match(PUSH_SUBJECT, /^https:\/\//); // no personal mailbox goes to push services
  const again = pushEnvironment(backend, 'supabase:project/postgres', generate);
  assert.equal(generated, 1); // existing subscriptions stay valid across restarts
  assert.equal(again.WEB_PUSH_VAPID_PRIVATE_KEY, first.WEB_PUSH_VAPID_PRIVATE_KEY);
  assert.throws(() => pushEnvironment(backend, '', generate), /identity/);
  assert.throws(() => pushEnvironment(fs.mkdtempSync(path.join(os.tmpdir(), 'electrohub-push-bad-')), 'id', () => ({ publicKey: 'x', privateKey: 'y' })), /malformed/);
  const real = pushEnvironment(fs.mkdtempSync(path.join(os.tmpdir(), 'electrohub-push-real-')), 'id');
  assert.match(real.WEB_PUSH_VAPID_PUBLIC_KEY, /^[A-Za-z0-9_-]{87}$/);
});

test('a heartbeat with old rows awaiting review is still sending; only a paused worker is not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electrohub-heartbeat-'));
  const file = path.join(dir, 'app.log');
  const line = fields => JSON.stringify({ pid: 7, timestamp: new Date().toISOString(), event: 'email_worker_heartbeat', sendMode: 'live', ...fields });
  fs.writeFileSync(file, line({ paused: false, attention: true, staleNeedingReview: 26 }) + '\n');
  assert.deepEqual(readinessOf(file, 7), { ready: true, attention: true, staleNeedingReview: 26, reason: 'QUEUE_NEEDS_ATTENTION', sendMode: 'live', observedAt: readinessOf(file, 7).observedAt });
  fs.writeFileSync(file, line({ paused: true, attention: false }) + '\n');
  assert.equal(readinessOf(file, 7).ready, false);
  assert.equal(readinessOf(file, 7).reason, 'PAUSED');
});
