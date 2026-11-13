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
