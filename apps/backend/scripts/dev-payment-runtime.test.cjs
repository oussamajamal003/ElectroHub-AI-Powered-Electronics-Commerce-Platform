const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { argumentsFor, preflight, supervise, main } = require('./dev-payment-runtime.cjs');

function child(pid) {
  const p = new EventEmitter(); p.pid = pid; p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.exitCode = null; p.killed = false;
  p.kill = () => { p.killed = true; p.exitCode = 0; p.emit('exit', 0); return true; };
  return p;
}
function dependencies(onReady) {
  const processes = []; const configurations = []; const lock = { record: () => {}, release: () => { lock.released = true; } };
  const deps = { acquireLock: () => lock,
    spawn: (_exe, _args, config) => { const p = child(100 + processes.length); processes.push(p); configurations.push(config); return p; },
    startListener: async args => ({ process: args.spawnProcess('stripe', [], {}), secret: 'whsec_runtime_test_placeholder' }),
    health: async () => true,
    waitForCondition: async read => { processes[2].stdout.write('payment.runner.ready'); assert.equal(await read(), true); return true; },
    log: value => onReady(processes, JSON.parse(value)) };
  return { deps, processes, configurations, lock };
}
test('default is preflight, and recovery requires explicit opt-in', () => {
  assert.deepEqual(argumentsFor([]), { start: false });
  assert.throws(() => argumentsFor(['--start']), /explicit/);
  assert.throws(() => argumentsFor(['--start','--preflight','--allow-dev-recovery']));
  assert.throws(() => argumentsFor(['--production']));
});
test('preflight alone never starts any service or runner', async () => {
  let starts = 0;
  assert.equal(await main([], { preflight: async () => ({ port: 5000 }), supervise: async () => { starts++; } }), 0);
  assert.equal(starts, 0);
});
test('failed identity/capacity/port preflight prevents all process effects', async () => {
  let starts = 0;
  assert.equal(await main(['--start','--allow-dev-recovery'], { preflight: async () => { throw new Error('Unknown occupied port'); },
    supervise: async () => { starts++; } }), 1);
  assert.equal(starts, 0);
});
for (const kind of ['backend', 'runner']) {
  test(`existing ${kind} blocks before credentials/database loading even without a listening port`, async () => {
    let starts = 0;
    const code = await main(['--start', '--allow-dev-recovery'], {
      preflight: () => preflight({ inspectProcesses: () => [{ pid: 42, kind }] }),
      supervise: async () => { starts++; },
    });
    assert.equal(code, 1);
    assert.equal(starts, 0);
  });
}
test('failed process inspection cannot be mistaken for an empty runtime', async () => {
  await assert.rejects(preflight({ inspectProcesses: () => { throw new Error('Process inventory access denied'); } }), /access denied/);
});
test('active supervisor lock prevents another runner without spawning/killing', async () => {
  await assert.rejects(supervise({ port: 5000 }, { acquireLock: () => { throw new Error('Lock occupied'); },
    spawn: () => { throw new Error('Must not spawn'); } }), /Lock occupied/);
});
test('API and runner use the same fresh signing secret; Ctrl+C stops only owned children', async () => {
  const state = dependencies((_ps, readiness) => {
    assert.equal(readiness.runnerDatabaseReady, true);
    assert.equal(readiness.financialAcceptance, 'NOT_VERIFIED');
    process.emit('SIGINT');
  });
  await supervise({ port: 5136 }, state.deps);
  assert.equal(state.configurations[1].env.STRIPE_WEBHOOK_SECRET, state.configurations[2].env.STRIPE_WEBHOOK_SECRET);
  assert.equal(state.configurations[1].env.PORT, '5136');
  assert.equal(state.configurations[1].env.NODE_ENV, 'development');
  assert.ok(state.processes.every(p => p.killed)); assert.equal(state.lock.released, true);
});
test('runner/API failure stops owned siblings and cannot report continuing readiness', async () => {
  const state = dependencies(ps => { ps[1].exitCode = 1; ps[1].emit('exit', 1); });
  await assert.rejects(supervise({ port: 5136 }, state.deps), /process exited/);
  assert.equal(state.processes[0].killed, true); assert.equal(state.processes[2].killed, true);
  assert.equal(state.lock.released, true);
});
test('listener startup failure releases ownership and never starts an API', async () => {
  const state = dependencies(() => {});
  state.deps.startListener = async () => { throw new Error('CLI unavailable'); };
  await assert.rejects(supervise({ port: 5136 }, state.deps), /CLI unavailable/);
  assert.equal(state.processes.length, 0); assert.equal(state.lock.released, true);
});
