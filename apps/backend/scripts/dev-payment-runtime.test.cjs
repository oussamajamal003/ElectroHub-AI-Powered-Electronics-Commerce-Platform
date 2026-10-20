'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const safety = require('./stripe-gate-safety.cjs');
const { argumentsFor, migrationNames, migrationChecksumCandidates, verifyMigrationLedger, assertNoPaymentBacklog,
  assertNoEmailBacklog, assertReviewedRecovery, assertTask04FixtureAttempt, normalizeWorkerAttemptIds, preflight, supervise, main } = require('./dev-payment-runtime.cjs');

const REVIEWED_ID = '11111111-1111-4111-8111-111111111111';
const TASK04_ID = '22222222-2222-4222-8222-222222222222';
const TASK04_USER_ID = '33333333-3333-4333-8333-333333333333';
const workerAttemptIds = [REVIEWED_ID, TASK04_ID];

function makeChild(pid, role = null, protocol = {}) {
  const child = new EventEmitter(); child.pid = pid; child.exitCode = null; child.signalCode = null; child.connected = true; child.signals = [];
  child.messages = [];
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.send = (message, callback) => {
    child.messages.push(message);
    if (message.type === 'payment-supervisor.prepare') {
      queueMicrotask(() => {
        child.emit('message', { event: 'payment.supervisor.prepared', role, nonce: message.nonce });
        child.emit('message', { event: role === 'worker' ? 'payment.supervisor.worker-ready' : 'payment.supervisor.api-ready', role, nonce: message.nonce });
      });
    } else if (message.type === 'payment-supervisor.activate') {
      if (role === 'api') assert.equal(protocol.runnerReady, true, 'API must not activate before the payment runner is ready');
      queueMicrotask(() => {
        child.emit('message', { event: 'payment.supervisor.activated', role, nonce: message.nonce });
        if (role === 'worker') { protocol.runnerReady = true; child.emit('message', { event: 'payment.supervisor.runner-ready', role, nonce: message.nonce }); }
      });
    }
    callback?.(); return true;
  };
  child.disconnect = () => { child.connected = false; child.exitCode = 0; child.emit('exit', 0); };
  child.kill = signal => { child.signals.push(signal || 'SIGTERM'); child.signalCode = signal || 'SIGTERM'; child.exitCode = null; child.emit('exit', null, child.signalCode); return true; };
  return child;
}

function fixtureRows() {
  const directory = path.join(__dirname, '..', 'prisma', 'migrations');
  return migrationNames(directory).map(name => {
    const file = path.join(directory, name, 'migration.sql');
    const checksum = [...migrationChecksumCandidates(name, fs.readFileSync(file))][0];
    return { migration_name: name, checksum, started_at: new Date(), finished_at: new Date(), rolled_back_at: null, logs: null };
  });
}

function fakePrisma(overrides = {}) {
  const tx = {
    $queryRaw: async strings => strings.join('').includes('pg_stat_activity') ? [{ others: 0 }] :
      strings.join('').includes('_prisma_migrations') ? (overrides.migrations || fixtureRows()) : [{ '?column?': 1 }],
    $executeRaw: async () => 0,
    paymentWork: { count: async () => overrides.unfinishedWork ?? 0 },
    paymentAttempt: { count: async ({ where }) => where.state === 'INCIDENT' ? overrides.historicalIncidents ?? 0 : overrides.unresolvedAttempts ?? 0,
      findUnique: async () => overrides.reviewedAttempt, findMany: async () => overrides.fixtureAttempts ?? [] },
    user: { findFirst: async () => overrides.fixtureOwner === undefined ? { id: TASK04_USER_ID } : overrides.fixtureOwner },
    commerceEmailOutbox: { count: async () => overrides.emailBacklog ?? 0 },
  };
  return {
    ...tx,
    $transaction: async callback => callback(tx),
    $disconnect: async () => { overrides.disconnected = true; },
  };
}

function preflightDependencies(overrides = {}) {
  return {
    inspectProcesses: () => [],
    env: { NODE_ENV: 'development', PORT: 5136, DATABASE_URL: 'postgres://user:pass@pooler:5432/postgres',
      DIRECT_URL: 'postgres://user:pass@pooler:5432/postgres', DB_SSL_CA_CERT_PATH: 'ca.pem', STRIPE_SECRET_KEY: 'rk_test_example' },
    task04Fixture: { userId: TASK04_USER_ID, email: 'task04-33333333-3333-4333-8333-333333333333@electrohub.invalid' },
    resolveTargets: () => ({ runtime: { category: 'dev', identity: 'supabase:pzxekjybdiulzmssalfo/postgres', transport: 'session-pooler' },
      migration: { category: 'dev', identity: 'supabase:pzxekjybdiulzmssalfo/postgres' } }),
    prisma: fakePrisma(overrides), exists: () => true, assertPortAvailable: async () => {},
    stripeAccount: async () => safety.DEV_STRIPE_ACCOUNT, ...overrides.deps,
  };
}

function fakeRuntime(onReady = () => {}) {
  const children = []; const logs = []; let capturedEmailEnv = null;
  const lock = { record: pids => { lock.pids = pids; }, release: () => { lock.released = true; } };
  const protocol = { runnerReady: false };
  let nextPid = 800;
  const deps = {
    acquireLock: () => lock,
    writeDiagnosticToken: token => { assert.match(token, /^[a-f0-9]{64}$/); },
    spawn: () => { const child = makeChild(nextPid++); children.push(child); return child; },
    fork: (_entry, args, spawnOptions) => {
      const role = args.includes('--payment-worker') ? 'worker' : 'api';
      const child = makeChild(nextPid++, role, protocol); child.spawnArgs = args; child.spawnOptions = spawnOptions; children.push(child);
      queueMicrotask(() => child.emit('message', { event: 'payment.supervisor.awaiting', role }));
      return child;
    },
    startListener: async args => ({ process: args.spawnProcess('stripe', [], {}), secret: 'whsec_fixture' }),
    health: async () => true,
    waitForCondition: async (read, _expected, { timeoutMs = 1000 } = {}) => {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) { if (await read()) return true; await new Promise(resolve => setTimeout(resolve, 0)); }
      throw new Error('condition timed out');
    },
    log: value => { const record = JSON.parse(value); logs.push(record); onReady(record, children); },
    describeEmail: () => ({ dispatchEnabled: false, sendMode: 'disabled', allowlistSize: 0, workerWillRun: false }),
    startEmailWorker: ({ env }) => { capturedEmailEnv = env; return { started: true, reason: 'fixture', runtime: null, stop: async () => {} }; },
    exists: () => true,
  };
  return { deps, children, logs, lock, get emailEnv() { return capturedEmailEnv; } };
}

test('default is preflight; shared recovery and allowlist email each require explicit opt-in', () => {
  assert.deepEqual(argumentsFor([]), { start: false, allowEmailAllowlist: false });
  assert.throws(() => argumentsFor(['--start']), /explicit/);
  assert.throws(() => argumentsFor(['--start', '--preflight', '--allow-dev-recovery']));
  assert.throws(() => argumentsFor(['--production']));
  assert.deepEqual(argumentsFor(['--start', '--allow-dev-recovery', '--allow-email-allowlist', `--reviewed-recovery-attempt=${REVIEWED_ID}`]),
    { start: true, allowEmailAllowlist: true, reviewedRecoveryAttempt: REVIEWED_ID });
  assert.throws(() => argumentsFor(['--start', '--allow-dev-recovery']), /one exact reviewed recovery attempt/);
});

test('reviewed recovery is scoped to one exact READY card-entry attempt', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const attempt = { id, state: 'AWAITING_INPUT', orderId: null, providerIntentId: 'pi_mock', work: { state: 'READY' } };
  assert.equal(argumentsFor([`--reviewed-recovery-attempt=${id}`]).reviewedRecoveryAttempt, id);
  assert.throws(() => argumentsFor(['--reviewed-recovery-attempt=all']));
  assert.throws(() => argumentsFor([`--reviewed-recovery-attempt=${id}`, '--reviewed-recovery-attempt=22222222-2222-4222-8222-222222222222']));
  assert.doesNotThrow(() => assertReviewedRecovery(attempt, id));
  for (const patch of [{ id: 'other' }, { state: 'INCIDENT' }, { orderId: 'order' }, { work: { state: 'LEASED' } }, { providerIntentId: null }]) {
    assert.throws(() => assertReviewedRecovery({ ...attempt, ...patch }, id), /changed/);
  }
});

test('worker scope requires exactly two canonical, distinct role-validated IDs', () => {
  assert.deepEqual(normalizeWorkerAttemptIds(workerAttemptIds), workerAttemptIds);
  assert.throws(() => normalizeWorkerAttemptIds(undefined), /exactly two/);
  assert.throws(() => normalizeWorkerAttemptIds([]), /exactly two/);
  assert.throws(() => normalizeWorkerAttemptIds([REVIEWED_ID]), /exactly two/);
  assert.throws(() => normalizeWorkerAttemptIds([REVIEWED_ID, 'not-a-uuid']), /exactly two/);
  assert.throws(() => normalizeWorkerAttemptIds([REVIEWED_ID, REVIEWED_ID]), /exactly two/);
  assert.throws(() => normalizeWorkerAttemptIds([REVIEWED_ID, TASK04_ID, '44444444-4444-4444-8444-444444444444']), /exactly two/);
  assert.throws(() => assertTask04FixtureAttempt({ id: TASK04_ID, userId: 'other', state: 'AWAITING_INPUT',
    providerIntentId: 'pi_mock', work: { state: 'READY' } }, TASK04_USER_ID), /uniquely owned/);
});

test('reviewed startup still blocks all other backlog and changed provider truth; reports no private attempt', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const reviewedAttempt = { id, state: 'AWAITING_INPUT', orderId: null, providerIntentId: 'pi_mock', work: { state: 'READY' } };
  const prior = process.env.NODE_ENV; process.env.NODE_ENV = 'development';
  try {
    const deps = { retrieveIntent: async () => ({ livemode: false, status: 'requires_payment_method', received: 0 }), verifyBinding: () => {} };
    const options = { reviewedRecoveryAttempt: id };
    const report = await preflight(preflightDependencies({ unfinishedWork: 1, reviewedAttempt, deps }), options);
    assert.equal(report.reviewedRecoveryCount, 1); assert.ok(!JSON.stringify(report).includes(id));
    await assert.rejects(preflight(preflightDependencies({ unfinishedWork: 2, reviewedAttempt, deps }), options), /backlog/);
    for (const patch of [{ livemode: true }, { status: 'succeeded' }, { received: 1 }]) {
      await assert.rejects(preflight(preflightDependencies({ unfinishedWork: 1, reviewedAttempt,
        deps: { ...deps, retrieveIntent: async () => ({ livemode: false, status: 'requires_payment_method', received: 0, ...patch }) } }), options), /provider state changed/);
    }
  } finally { if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior; }
});

test('scoped start validates the reviewed attempt and unique Task04-owned synthetic attempt', async () => {
  const reviewedAttempt = { id: REVIEWED_ID, state: 'AWAITING_INPUT', orderId: null, providerIntentId: 'pi_reviewed', work: { state: 'READY' } };
  const fixtureAttempt = { id: TASK04_ID, userId: TASK04_USER_ID, state: 'AWAITING_INPUT', orderId: null,
    providerIntentId: 'pi_task04', submittedAt: null, work: { state: 'READY' } };
  const prior = process.env.NODE_ENV; process.env.NODE_ENV = 'development';
  try {
    const options = { start: true, reviewedRecoveryAttempt: REVIEWED_ID };
    const deps = { retrieveIntent: async () => ({ livemode: false, status: 'requires_payment_method', received: 0 }), verifyBinding: () => {} };
    const config = await preflight(preflightDependencies({ unfinishedWork: 2, reviewedAttempt, fixtureAttempts: [fixtureAttempt], deps }), options);
    assert.deepEqual(config.workerAttemptIds, workerAttemptIds);
    assert.equal(config.reviewedRecoveryCount, 1);
    assert.ok(!JSON.stringify({ ...config, workerAttemptIds: undefined }).includes(REVIEWED_ID));
    await assert.rejects(preflight(preflightDependencies({ unfinishedWork: 3, reviewedAttempt, fixtureAttempts: [fixtureAttempt], deps }), options), /backlog/);
    await assert.rejects(preflight(preflightDependencies({ unfinishedWork: 2, reviewedAttempt, fixtureAttempts: [fixtureAttempt, fixtureAttempt], deps }), options), /exactly one attempt/);
    await assert.rejects(preflight(preflightDependencies({ unfinishedWork: 2, reviewedAttempt, fixtureAttempts: [
      { ...fixtureAttempt, submittedAt: new Date() }], deps }), options), /uniquely owned/);
    await assert.rejects(preflight(preflightDependencies({ unfinishedWork: 2, reviewedAttempt,
      fixtureAttempts: [fixtureAttempt], fixtureOwner: null, deps }), options), /owner changed/);
  } finally { if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior; }
});

test('migration preflight requires every local migration exactly once with an accepted exact checksum', () => {
  const rows = fixtureRows();
  assert.equal(verifyMigrationLedger(rows), 20);
  for (const invalid of [rows.slice(1), [...rows, { ...rows[0] }], [...rows, { ...rows[0], migration_name: 'unknown' }],
    rows.map((row, index) => index ? row : { ...row, checksum: '0'.repeat(64) }),
    rows.map((row, index) => index ? row : { ...row, finished_at: null }),
    rows.map((row, index) => index ? row : { ...row, logs: 'failed' })]) {
    assert.throws(() => verifyMigrationLedger(invalid));
  }
});

test('payment and email backlog gates fail closed', () => {
  assert.doesNotThrow(() => assertNoPaymentBacklog(0, 0));
  assert.throws(() => assertNoPaymentBacklog(1, 0), /backlog/);
  assert.throws(() => assertNoPaymentBacklog(0, 1), /incident/);
  assert.doesNotThrow(() => assertNoEmailBacklog(0));
  assert.throws(() => assertNoEmailBacklog(1), /email backlog/);
});

test('preflight verifies both DEV identities, all migration checksums, no payment backlog, and canonical Stripe account', async () => {
  const previous = { nodeEnv: process.env.NODE_ENV, tls: process.env.NODE_TLS_REJECT_UNAUTHORIZED, source: process.env.DB_RUNTIME_URL_SOURCE };
  process.env.NODE_ENV = ''; delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; process.env.DB_RUNTIME_URL_SOURCE = 'direct';
  try {
    const config = await preflight(preflightDependencies());
    assert.equal(config.targetIdentity, 'supabase:pzxekjybdiulzmssalfo/postgres');
    assert.equal(config.migrationCount, 20);
    assert.deepEqual(config.paymentBacklog, { unfinishedWork: 0, unresolvedAttempts: 0, historicalIncidentAttempts: 0 });
    assert.equal(config.stripeAccountVerified, true);
  } finally {
    for (const [name, value] of [['NODE_ENV', previous.nodeEnv], ['NODE_TLS_REJECT_UNAUTHORIZED', previous.tls], ['DB_RUNTIME_URL_SOURCE', previous.source]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('preflight blocks target mismatch, payment backlog, and noncanonical Stripe account before startup', async () => {
  const previous = { nodeEnv: process.env.NODE_ENV, tls: process.env.NODE_TLS_REJECT_UNAUTHORIZED, source: process.env.DB_RUNTIME_URL_SOURCE };
  process.env.NODE_ENV = ''; delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; process.env.DB_RUNTIME_URL_SOURCE = 'direct';
  try {
    const mismatch = preflightDependencies(); mismatch.resolveTargets = () => ({ runtime: { category: 'dev', identity: 'wrong' }, migration: { category: 'dev', identity: 'wrong' } });
    await assert.rejects(preflight(mismatch), /Exact shared DEV/);
    await assert.rejects(preflight(preflightDependencies({ unfinishedWork: 1 })), /backlog/);
    const wrongAccount = preflightDependencies(); wrongAccount.stripeAccount = async () => 'acct_wrong';
    await assert.rejects(preflight(wrongAccount), /canonical/);
  } finally {
    for (const [name, value] of [['NODE_ENV', previous.nodeEnv], ['NODE_TLS_REJECT_UNAUTHORIZED', previous.tls], ['DB_RUNTIME_URL_SOURCE', previous.source]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('preflight-only mode never starts a runtime', async () => {
  let starts = 0;
  const output = []; const priorLog = console.log;
  console.log = value => output.push(value);
  try {
    assert.equal(await main([], { preflight: async () => ({ port: 5000, workerAttemptIds }), supervise: async () => { starts++; } }), 0);
  } finally { console.log = priorLog; }
  assert.equal(starts, 0);
  assert.equal(output.some(value => value.includes(REVIEWED_ID) || value.includes(TASK04_ID)), false, 'preflight output never exposes private attempt IDs');
});

test('supervisor refuses a missing allowlist before acquiring a lock or starting children', async () => {
  let locks = 0; let forks = 0;
  await assert.rejects(supervise({ port: 5136, targetIdentity: 'supabase:pzxekjybdiulzmssalfo/postgres' }, {}, {
    acquireLock: () => { locks++; return { record() {}, release() {} }; },
    fork: () => { forks++; },
  }), /exactly two distinct canonical attempt IDs/);
  assert.equal(locks, 0); assert.equal(forks, 0);
});

test('email worker receives no payment scope or shared-payment supervisor flags', async () => {
  const state = fakeRuntime(record => { if (record.readiness === 'PASS') process.emit('SIGINT'); });
  state.deps.describeEmail = () => ({ sendMode: 'allowlist', workerWillRun: true });
  const keys = ['PAYMENT_DEV_ATTEMPT_IDS', 'PAYMENT_DEV_SUPERVISED', 'PAYMENT_INPROCESS_RECOVERY',
    'COMMERCE_EMAIL_DISPATCH_ENABLED', 'COMMERCE_EMAIL_SEND_MODE'];
  const before = new Map(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { PAYMENT_DEV_ATTEMPT_IDS: 'untrusted-caller-scope', PAYMENT_DEV_SUPERVISED: '1',
    PAYMENT_INPROCESS_RECOVERY: 'true', COMMERCE_EMAIL_DISPATCH_ENABLED: 'true', COMMERCE_EMAIL_SEND_MODE: 'allowlist' });
  try {
    await supervise({ port: 5136, targetIdentity: 'supabase:pzxekjybdiulzmssalfo/postgres', runtimeUrlSource: 'direct', migrationCount: 20,
      workerAttemptIds, paymentBacklog: { unfinishedWork: 0, unresolvedAttempts: 0, historicalIncidentAttempts: 0 }, stripeAccountVerified: true },
    { start: true, reviewedRecoveryAttempt: REVIEWED_ID, allowEmailAllowlist: true }, state.deps);
  } finally {
    for (const [key, value] of before) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  assert.ok(state.emailEnv);
  for (const key of ['PAYMENT_DEV_ATTEMPT_IDS', 'PAYMENT_DEV_SUPERVISED', 'PAYMENT_INPROCESS_RECOVERY']) {
    assert.equal(Object.hasOwn(state.emailEnv, key), false, `${key} is not passed to the email worker`);
  }
  const worker = state.children.find(child => child.spawnArgs?.includes('--payment-worker'));
  assert.equal(worker.messages.find(message => message.type === 'payment-supervisor.prepare').attemptIds.length, 2);
});

test('failed process inventory blocks before credentials or database access', async () => {
  await assert.rejects(preflight({ inspectProcesses: () => { throw new Error('Process inventory access denied'); } }), /access denied/);
});

test('supervisor activates only after both child preparations, DB readiness signals, and API health', async () => {
  const state = fakeRuntime((record, children) => {
    assert.equal(record.readiness, 'PASS');
    assert.equal(record.supervisorIPC, 'prepared-and-activated');
    assert.equal(record.financialAcceptance, 'NOT_VERIFIED');
    assert.equal(record.emailAllowlist.sendMode, 'disabled');
    assert.equal(record.workerReady, true);
    assert.ok(children.filter(child => child.pid >= 801).every(child => child.connected));
    process.emit('SIGINT');
  });
  const priorAttemptEnv = process.env.PAYMENT_DEV_ATTEMPT_IDS;
  process.env.PAYMENT_DEV_ATTEMPT_IDS = 'untrusted-caller-scope';
  try {
    await supervise({ port: 5136, targetIdentity: 'supabase:pzxekjybdiulzmssalfo/postgres', runtimeUrlSource: 'direct', migrationCount: 20,
      workerAttemptIds,
      paymentBacklog: { unfinishedWork: 0, unresolvedAttempts: 0, historicalIncidentAttempts: 0 }, stripeAccountVerified: true },
    { start: true, reviewedRecoveryAttempt: REVIEWED_ID }, state.deps);
  } finally {
    if (priorAttemptEnv === undefined) delete process.env.PAYMENT_DEV_ATTEMPT_IDS;
    else process.env.PAYMENT_DEV_ATTEMPT_IDS = priorAttemptEnv;
  }
  assert.equal(state.children.length, 3);
  assert.ok(state.children.every(child => child.signalCode === 'SIGTERM' || child.exitCode === 0));
  assert.ok(state.children.filter(child => child.pid >= 801).every(child => child.signals.length === 0), 'IPC children drain before force signals');
  assert.equal(state.lock.released, true);
  const api = state.children.find(child => child.spawnArgs?.length === 0);
  const worker = state.children.find(child => child.spawnArgs?.includes('--payment-worker'));
  const apiPrepare = api.messages.find(message => message.type === 'payment-supervisor.prepare');
  const workerPrepare = worker.messages.find(message => message.type === 'payment-supervisor.prepare');
  assert.equal(Object.hasOwn(apiPrepare, 'attemptIds'), false, 'API never receives the payment allowlist');
  assert.deepEqual(workerPrepare.attemptIds, workerAttemptIds, 'only the worker receives the exact scope over IPC');
  assert.equal(Object.hasOwn(api.spawnOptions.env, 'PAYMENT_DEV_ATTEMPT_IDS'), false);
  assert.equal(Object.hasOwn(worker.spawnOptions.env, 'PAYMENT_DEV_ATTEMPT_IDS'), false, 'scope is not copied into mutable environment variables');
});

test('a child exit before readiness stops only tracked siblings and releases lock after exit', async () => {
  const state = fakeRuntime();
  state.deps.fork = (_entry, args) => {
    const role = args.includes('--payment-worker') ? 'worker' : 'api'; const child = makeChild(900 + state.children.length, role); state.children.push(child);
    queueMicrotask(() => { child.emit('message', { event: 'payment.supervisor.awaiting', role }); if (role === 'api') { child.exitCode = 1; child.emit('exit', 1); } });
    return child;
  };
  await assert.rejects(supervise({ port: 5136, targetIdentity: 'supabase:pzxekjybdiulzmssalfo/postgres', runtimeUrlSource: 'direct', migrationCount: 20,
    workerAttemptIds,
    paymentBacklog: {}, stripeAccountVerified: true }, { start: true, reviewedRecoveryAttempt: REVIEWED_ID }, state.deps), /exited unexpectedly|timed out/);
  assert.equal(state.children.every(child => child.signalCode === 'SIGTERM' || child.exitCode !== null), true);
  assert.equal(state.lock.released, true);
});

test('preflight reports but does not block a historical INCIDENT whose work is DONE', async () => {
  const previous = { nodeEnv: process.env.NODE_ENV, tls: process.env.NODE_TLS_REJECT_UNAUTHORIZED, source: process.env.DB_RUNTIME_URL_SOURCE };
  process.env.NODE_ENV = ''; delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; process.env.DB_RUNTIME_URL_SOURCE = 'direct';
  try {
    const config = await preflight(preflightDependencies({ historicalIncidents: 1 }));
    assert.equal(config.paymentBacklog.historicalIncidentAttempts, 1);
    assert.equal(config.paymentBacklog.unfinishedWork, 0);
  } finally {
    for (const [name, value] of [['NODE_ENV', previous.nodeEnv], ['NODE_TLS_REJECT_UNAUTHORIZED', previous.tls], ['DB_RUNTIME_URL_SOURCE', previous.source]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('allowlist email opt-in requires explicit configuration and an empty sendable backlog', async () => {
  const previous = { nodeEnv: process.env.NODE_ENV, tls: process.env.NODE_TLS_REJECT_UNAUTHORIZED, source: process.env.DB_RUNTIME_URL_SOURCE };
  process.env.NODE_ENV = ''; delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; process.env.DB_RUNTIME_URL_SOURCE = 'direct';
  try {
    const configured = () => ({ dispatchEnabled: true, sendMode: 'allowlist', allowlistSize: 1 });
    await assert.rejects(preflight(preflightDependencies({ emailBacklog: 1, deps: { describeEmail: configured } }), { allowEmailAllowlist: true }), /email backlog/);
    const config = await preflight(preflightDependencies({ deps: { describeEmail: configured } }), { allowEmailAllowlist: true });
    assert.deepEqual(config.emailAllowlist, { enabled: true, pendingBacklog: 0 });
  } finally {
    for (const [name, value] of [['NODE_ENV', previous.nodeEnv], ['NODE_TLS_REJECT_UNAUTHORIZED', previous.tls], ['DB_RUNTIME_URL_SOURCE', previous.source]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('bounded shutdown escalates owned children and retains the lock while a child remains alive', async () => {
  const state = fakeRuntime((_record) => process.emit('SIGINT'));
  state.deps.shutdownGraceMs = 10; state.deps.forcedShutdownWaitMs = 10;
  state.deps.fork = (_entry, args) => {
    const role = args.includes('--payment-worker') ? 'worker' : 'api'; const child = makeChild(1000 + state.children.length, role, { runnerReady: true });
    child.kill = signal => { child.signals.push(signal); return true; };
    child.disconnect = () => { child.connected = false; };
    state.children.push(child);
    queueMicrotask(() => {
      child.emit('message', { event: 'payment.supervisor.awaiting', role });
      if (role === 'api') child.emit('message', { event: 'payment.supervisor.api-ready', role, nonce: 'x' });
    });
    return child;
  };
  await assert.rejects(supervise({ port: 5136, targetIdentity: 'supabase:pzxekjybdiulzmssalfo/postgres', runtimeUrlSource: 'direct', migrationCount: 20,
    workerAttemptIds,
    paymentBacklog: {}, stripeAccountVerified: true }, { start: true, reviewedRecoveryAttempt: REVIEWED_ID }, state.deps), /exited unexpectedly|condition timed out|Owned process did not stop/);
  assert.ok(state.children.filter(child => child.pid >= 1000).every(child => child.signals.includes('SIGKILL')));
  assert.equal(state.lock.released, undefined);
});
