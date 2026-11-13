'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const net = require('node:net');
const { start, assertFree, diskReadiness, publicDependencyStatuses, main } = require('./dev-stack.cjs');

function harness(overrides = {}) {
  const children = []; const actions = []; let stop; let snapshot; let pid = 100;
  const deps = {
    controlRequest: async () => null,
    paymentOwner: async () => null,
    verifiedPayment: async () => true,
    assertFree: async port => { actions.push(`free:${port}`); },
    build: async () => { actions.push('build'); },
    diskReadiness: () => ({ status: 'READY' }),
    openControl: async (_file, _identity, read, onStop) => {
      stop = onStop; snapshot = read; actions.push('control');
      return { close: async () => { actions.push('closed'); } };
    },
    fork: (file, args, options) => {
      const child = new EventEmitter(); Object.assign(child, { pid: pid++, exitCode: null, signalCode: null, connected: true, file, args, options });
      child.disconnect = () => { actions.push('frontend:drain'); child.connected = false; child.exitCode = 0; child.emit('exit', 0); };
      child.send = (message, callback) => { actions.push(message.type); child.exitCode = 0; child.emit('exit', 0); callback?.(); };
      child.kill = () => { throw new Error('Unnecessary forced termination'); };
      children.push(child); actions.push(file.endsWith('dev-stack-vite.cjs') ? 'vite' : 'supervisor');
      if (file.endsWith('dev-stack-vite.cjs')) queueMicrotask(() => child.emit('message', { event: 'dev-stack.vite-ready', port: 3000 }));
      return child;
    },
    probe: async () => ({ ok: true, data: { instanceId: 'same-backend' } }),
    report: async () => { assert.equal(snapshot().phase, 'ready'); actions.push('report'); setImmediate(() => { void stop(); }); },
    ...overrides,
  };
  return { deps, children, actions, get stop() { return stop; } };
}
test('single session builds, starts only checkout supervisor, binds Vite to 3000/5000 and drains owned children', async () => {
  const h = harness(); await start({}, h.deps);
  assert.deepEqual(h.actions.slice(0, 7), ['control', 'free:3000', 'free:5000', 'build', 'supervisor', 'vite', 'report']);
  assert.deepEqual(h.children[0].args, ['--start', '--allow-dev-checkout', '--recovery-mode=checkout']);
  assert.equal(h.children[0].options.env.PORT, '5000');
  assert.equal(h.children[1].options.env.E2E_FRONTEND_PORT, '3000');
  assert.equal(h.children[1].options.env.E2E_API_PROXY_TARGET, 'http://localhost:5000');
  assert.ok(h.actions.includes('dev-stack.stop')); assert.ok(h.actions.includes('frontend:drain')); assert.ok(h.actions.includes('closed'));
});
test('email opt-in is forwarded to existing backlog/configuration gates without recovery authority', async () => {
  const h = harness(); await start({ email: true }, h.deps);
  assert.ok(h.children[0].args.includes('--allow-email-allowlist'));
  assert.equal(h.children[0].args.some(arg => arg.includes('allow-dev-recovery')), false);
});
test('healthy authenticated checkout owner is reused and never stopped by a borrowing session', async () => {
  const h = harness({ paymentOwner: async () => ({ phase: 'ready' }) }); await start({}, h.deps);
  assert.equal(h.children.length, 1); assert.ok(h.children[0].file.endsWith('dev-stack-vite.cjs'));
  assert.equal(h.actions.includes('build'), false); assert.equal(h.actions.includes('free:5000'), false);
  assert.equal(h.actions.includes('dev-stack.stop'), false);
});
test('duplicate healthy stack invocation creates no child and no lock', async () => {
  const h = harness({ controlRequest: async () => ({ phase: 'ready' }), report: async () => {} });
  await start({}, h.deps); assert.equal(h.children.length, 0); assert.equal(h.actions.length, 0);
});
test('unhealthy existing ownership and concurrent startup refuse replacement', async () => {
  for (const overrides of [
    { paymentOwner: async () => ({ phase: 'ready' }), verifiedPayment: async () => false },
    { controlRequest: async () => ({ phase: 'starting' }) },
    { assertFree: async () => { throw new Error('port occupied'); } },
    { build: async () => { throw new Error('build failed'); } },
  ]) {
    const h = harness(overrides); await assert.rejects(start({}, h.deps)); assert.equal(h.children.length, 0);
  }
});
test('supervisor crash stops Vite without restarting financial children', async () => {
  let h; h = harness({ report: async () => { setImmediate(() => { h.children[0].exitCode = 1; h.children[0].emit('exit', 1); }); } });
  await assert.rejects(start({}, h.deps), /automatic payment restart is forbidden/);
  assert.equal(h.children.length, 2); assert.ok(h.actions.includes('frontend:drain'));
});
test('occupied dual-stack port is refused and original listener is left running', async () => {
  const listener = net.createServer(); await new Promise(resolve => listener.listen({ host: '::', port: 0 }, resolve));
  try { await assert.rejects(assertFree(listener.address().port), /occupied/); assert.equal(listener.listening, true); }
  finally { await new Promise(resolve => listener.close(resolve)); }
});
test('unknown flags and recovery scopes are rejected before any operation', async () => {
  for (const argv of [['start', '--allow-dev-recovery'], ['stop', '--allow-email-allowlist'], ['start', '--accepted-backlog-attempt=x']])
    await assert.rejects(main(argv), /Use start/);
});
test('production/insecure caller is refused before ownership, build or child operations', async () => {
  const prior = { NODE_ENV: process.env.NODE_ENV, NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED };
  try {
    for (const [key, value] of [['NODE_ENV', 'production'], ['NODE_TLS_REJECT_UNAUTHORIZED', '0']]) {
      const h = harness(); process.env[key] = value;
      await assert.rejects(start({}, h.deps), /refuses production/); assert.equal(h.actions.length, 0);
      if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    }
  } finally { for (const key of Object.keys(prior)) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key]; } }
});
test('disk exhaustion is diagnosed and blocks a fresh build without launching financial children', async () => {
  const capacity = freeMiB => () => ({ bsize: 1048576, bavail: freeMiB });
  assert.equal(diskReadiness('.', capacity(0)).status, 'BLOCKED');
  assert.equal(diskReadiness('.', capacity(1024)).status, 'DEGRADED');
  assert.equal(diskReadiness('.', capacity(4096)).status, 'READY');
  assert.equal(diskReadiness('.', () => { throw new Error('Unavailable'); }).status, 'NOT VERIFIED');
  const h = harness({ diskReadiness: () => ({ status: 'BLOCKED' }) });
  await assert.rejects(start({}, h.deps), /less than 256 MiB/);
  assert.equal(h.children.length, 0); assert.equal(h.actions.includes('build'), false);
});
test('doctor distinguishes stale photo routes and missing contact recipient from healthy process liveness', () => {
  const broken = publicDependencyStatuses({ ok: true, data: { supportEmail: null } }, { status: 404 });
  assert.deepEqual(broken.map(row => row.status), ['UNAVAILABLE', 'BLOCKED']);
  assert.match(broken[0].evidence, /controlled supervisor restart/);
  const configured = publicDependencyStatuses({ ok: true, data: { supportEmail: 'support@example.invalid' } }, { status: 401 }, true);
  assert.deepEqual(configured.map(row => row.status), ['READY', 'READY']);
  assert.equal(JSON.stringify(configured).includes('support@example.invalid'), false);
  assert.deepEqual(publicDependencyStatuses({}, {}).map(row => row.status), ['UNAVAILABLE', 'NOT VERIFIED']);
});
