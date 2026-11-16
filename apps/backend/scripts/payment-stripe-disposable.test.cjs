'use strict';
// Offline tests for the disposable real-Stripe entrypoint. No database, no Stripe call, no network.
//   node --test scripts/payment-stripe-disposable.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const disposable = require('./payment-pg-disposable.cjs');
const live = require('./payment-stripe-disposable.cjs');

const openssl = spawnSync('openssl', ['version']).status === 0;
const certOptions = { skip: openssl ? false : 'openssl is not available' };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-stripe-disposable-test-'));
test.after(() => fs.rmSync(work, { recursive: true, force: true }));
const backendRoot = path.resolve(__dirname, '..');

function makeCa(name) {
  const key = path.join(work, `${name}.key`);
  const crt = path.join(work, `${name}.crt`);
  const result = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=electrohub-ci-ca', '-keyout', key, '-out', crt], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return crt;
}

const DB = 'electrohub_ci';
const ACCOUNT = 'acct_TEST123abc';
const ALLOWANCE = 5000;
function baseEnv(caFile, overrides = {}) {
  return {
    PAYMENT_PG_DISPOSABLE_APPROVED: 'true',
    PAYMENT_PG_DISPOSABLE_URL: `postgresql://postgres:secret@localhost:55432/${DB}`,
    PAYMENT_PG_DISPOSABLE_CA_FILE: caFile,
    PAYMENT_PG_DISPOSABLE_AUTHORIZATION: disposable.expectedAuthorization(DB, 'stripe-live'),
    PAYMENT_STRIPE_DISPOSABLE_APPROVED: 'true',
    PAYMENT_STRIPE_DISPOSABLE_EXPECTED_ACCOUNT: ACCOUNT,
    PAYMENT_STRIPE_DISPOSABLE_ALLOWANCE_CENTS: String(ALLOWANCE),
    PAYMENT_STRIPE_DISPOSABLE_AUTHORIZATION: live.expectedStripeAuthorization(ACCOUNT, ALLOWANCE, DB),
    STRIPE_SECRET_KEY: 'sk_test_abcdef0123456789',
    ...overrides,
  };
}
const validate = (env, options = {}) => live.validateStripeConfiguration(env, { scanFiles: false, ...options });

test('a fully authorized configuration is accepted and exposes only what the run needs', certOptions, () => {
  const ca = makeCa('ok');
  const result = validate(baseEnv(ca));
  assert.ok(result.config && result.stripe, result.error);
  assert.equal(result.stripe.account, ACCOUNT);
  assert.equal(result.stripe.allowance, ALLOWANCE);
  assert.equal(result.config.database, DB);
});

test('the Stripe approval is independent of the PostgreSQL approval and exact', certOptions, () => {
  const ca = makeCa('indep');
  const env = baseEnv(ca);
  assert.match(validate({ ...env, PAYMENT_STRIPE_DISPOSABLE_APPROVED: 'false' }).error, /separate approval/);
  assert.match(validate({ ...env, PAYMENT_STRIPE_DISPOSABLE_APPROVED: undefined }).error, /separate approval/);
  // PostgreSQL approval alone, or the A-S authorization string, is not Stripe authorization
  assert.match(validate({ ...env, PAYMENT_STRIPE_DISPOSABLE_AUTHORIZATION: disposable.expectedAuthorization(DB) }).error, /does not match the exact account/);
  for (const [name, value] of [['PAYMENT_STRIPE_DISPOSABLE_EXPECTED_ACCOUNT', 'acct_OTHER'], ['PAYMENT_STRIPE_DISPOSABLE_ALLOWANCE_CENTS', '9999']]) {
    assert.match(validate({ ...env, [name]: value }).error, /does not match the exact account/, name);
  }
  assert.match(validate({ ...env, PAYMENT_STRIPE_DISPOSABLE_AUTHORIZATION: live.expectedStripeAuthorization(ACCOUNT, ALLOWANCE, 'electrohub_other') }).error, /does not match/);
  assert.match(validate({ ...env, PAYMENT_STRIPE_DISPOSABLE_EXPECTED_ACCOUNT: 'not-an-account' }).error, /exact Stripe Test Mode account id/);
  for (const bad of ['0', '-5', '1.5', 'abc', '', '10000001']) {
    assert.match(validate({ ...env, PAYMENT_STRIPE_DISPOSABLE_ALLOWANCE_CENTS: bad }).error, /positive integer/, bad);
  }
});

test('the PostgreSQL authorization of the A-S entrypoint cannot start the live entrypoint, and vice versa', certOptions, () => {
  const ca = makeCa('scopes');
  const env = baseEnv(ca);
  assert.match(validate({ ...env, PAYMENT_PG_DISPOSABLE_AUTHORIZATION: disposable.expectedAuthorization(DB, 'scenarios-A-S') }).error, /exact database, scenario set/);
  assert.notEqual(disposable.expectedAuthorization(DB, 'stripe-live'), disposable.expectedAuthorization(DB, 'scenarios-A-S'));
  // the A-S validator rejects the live scope's string
  const asAR = disposable.validateConfiguration(env, { scanFiles: false, scope: 'scenarios-A-S' });
  assert.match(asAR.error, /exact database, scenario set/);
});

test('live keys, missing keys, DEV flags and hosted or DEV/PROD database targets are refused', certOptions, () => {
  const ca = makeCa('refuse');
  const env = baseEnv(ca);
  // either refusal is correct: the shared scan for live values runs first, the key-mode check is the second line of defence
  assert.match(validate({ ...env, STRIPE_SECRET_KEY: 'sk_live_abcdef123456' }).error, /Test Mode secret key|Live Stripe/);
  assert.match(validate({ ...env, STRIPE_SECRET_KEY: 'rk_live_abcdef123456' }).error, /Test Mode secret key|Live Stripe/);
  assert.match(validate({ ...env, STRIPE_SECRET_KEY: 'rk_test_abcdef123456' }).error, /Test Mode secret key/);
  assert.match(validate({ ...env, STRIPE_SECRET_KEY: undefined }).error, /set explicitly/);
  assert.match(validate({ ...env, PAYMENT_STRIPE_LIVE_DEV: 'true' }).error, /DEV live-suite flag/);
  for (const url of ['postgresql://postgres.pzxekjybdiulzmssalfo:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',
    'postgresql://postgres.yepfgjehdstlxbpespun:pw@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres',
    `postgresql://postgres:pw@db.example.com:5432/${DB}`]) {
    assert.match(validate({ ...env, PAYMENT_PG_DISPOSABLE_URL: url }).error, /hosted, DEV or PROD|loopback/, url);
  }
  assert.match(validate({ ...env, STRIPE_PUBLISHABLE: 'pk_live_zzzzzzzz' }).error, /Live Stripe/);
});

test('stage environments are explicit: disposable URLs only, fresh JWT secret, test key, no DEV flags or ambient database settings', certOptions, () => {
  const ca = makeCa('stages');
  const { config, stripe } = validate(baseEnv(ca));
  const identity = disposable.newRunIdentity();
  const ambient = { PATH: process.env.PATH, JWT_SECRET: 'ambient-dev-jwt-secret-that-must-not-leak-0123456789',
    DATABASE_URL: 'postgresql://postgres.pzxekjybdiulzmssalfo:pw@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres',
    DIRECT_URL: 'postgresql://postgres.pzxekjybdiulzmssalfo:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',
    PAYMENT_STRIPE_LIVE_DEV: 'true', PAYMENT_PG_TEST_APPROVED: 'true', PAYMENT_PG_TEST_MONITOR_FILE: 'C:/monitor.json' };
  const random = size => Buffer.alloc(size, 7);
  const [probe, migration, tests] = live.stageDefinitions(config, stripe, identity, ambient, random, { probeFile: path.join(work, 'probe.sql') });
  assert.deepEqual([probe.name, migration.name, tests.name], ['migration_tls', 'migration', 'tests']);
  for (const stage of [probe, migration, tests]) {
    assert.ok(!/supabase|pooler|pzxekj|yepfgj/i.test(`${stage.env.DATABASE_URL} ${stage.env.DIRECT_URL}`), stage.name);
    assert.equal(new URL(stage.env.DATABASE_URL).hostname, 'localhost');
    assert.equal(stage.env.PAYMENT_STRIPE_LIVE_DEV, undefined);
    assert.equal(stage.env.PAYMENT_PG_TEST_APPROVED, undefined);
    assert.equal(stage.env.PAYMENT_PG_TEST_MONITOR_FILE, undefined);
    assert.notEqual(stage.env.JWT_SECRET, ambient.JWT_SECRET);
    assert.ok(stage.env.JWT_SECRET.length >= 32);
    assert.equal(stage.env.STRIPE_SECRET_KEY, stripe.key);
    assert.equal(stage.env.NODE_EXTRA_CA_CERTS, config.caFile);
    assert.equal(stage.env.DB_SSL_CA_CERT_PATH, config.caFile);
  }
  for (const stage of [probe, migration]) {
    const url = new URL(stage.env.DATABASE_URL);
    assert.equal(url.searchParams.get('schema'), 'public');
    assert.equal(url.searchParams.get('sslmode'), 'require');
    assert.equal(url.searchParams.get('sslaccept'), 'strict');
    assert.equal(url.searchParams.get('sslcert'), config.caFile);
    assert.equal(url.searchParams.get('connection_limit'), '1');
  }
  assert.equal(tests.env.DATABASE_URL, config.url); // the application sees the plain loopback URL; TLS is verified against the CA
  assert.equal(tests.env.PAYMENT_STRIPE_LIVE_DISPOSABLE, 'true');
  assert.equal(tests.env.PAYMENT_STRIPE_LIVE_AUTHORIZATION, live.expectedStripeAuthorization(ACCOUNT, ALLOWANCE, DB));
  assert.equal(tests.env.PAYMENT_PG_DISPOSABLE_AUTHORIZATION, disposable.expectedAuthorization(DB, 'stripe-live'));
  assert.equal(tests.env.PAYMENT_PG_DISPOSABLE_RUN_ID, identity.runId);
  assert.ok(tests.args.includes(live.TEST_FILE) && tests.args.includes('--no-file-parallelism') && tests.args.includes('--maxWorkers=1'));
  assert.ok(tests.timeoutMs <= 2_400_000 && migration.timeoutMs <= 180_000 && probe.timeoutMs <= 60_000);
  assert.notEqual(stageDefinitionsKey(tests), stageDefinitionsKey(migration));
});
const stageDefinitionsKey = stage => stage.args.join(' ');

test('the runner and the live suite compute the same authorization, and the DEV login read is DEV-mode only', () => {
  const source = fs.readFileSync(path.join(backendRoot, live.TEST_FILE), 'utf8');
  assert.ok(source.includes('`STRIPE-TEST:${liveAccount}:${liveAllowance}:DISPOSABLE:${disposableDatabase}:create+authorize+capture+cancel+refund:disposable-fixtures`'));
  assert.match(live.expectedStripeAuthorization('acct_X', 7, 'electrohub_ci'), /^STRIPE-TEST:acct_X:7:DISPOSABLE:electrohub_ci:create\+authorize\+capture\+cancel\+refund:disposable-fixtures$/);
  const envRead = source.indexOf("readFileSync('.env'");
  const guard = source.lastIndexOf('if (!disposableLive) {', envRead);
  assert.ok(envRead > 0 && guard > 0 && envRead - guard < 200, 'the .env DEV login read must sit inside the DEV-only block');
  assert.match(source, /if \(disposableLive\) await assertDisposableLive\(\);/);
  assert.match(source, /Payment live tests require exact DEV and Stripe Test Mode\./); // DEV guard text retained
  assert.match(source, /if \(devMode && \(!\[env\.DATABASE_URL, env\.DIRECT_URL\]\.every\(value => value\.includes\('pzxekjybdiulzmssalfo'\)\)/);
});

test('neither entrypoint can start the other', () => {
  const ar = fs.readFileSync(path.join(__dirname, 'payment-pg-disposable.cjs'), 'utf8');
  const stripe = fs.readFileSync(path.join(__dirname, 'payment-stripe-disposable.cjs'), 'utf8');
  assert.ok(!ar.includes('payment-stripe-disposable'), 'the A-S runner must not reference the live runner');
  assert.ok(!/['"]--run['"]/.test(stripe.replace(/argv\.includes\('--run'\)/g, '')), 'the live runner must not invoke any runner with --run');
  assert.ok(!disposable.TEST_FILES.includes(live.TEST_FILE));
  assert.ok(!/payment\.stripe\.live/.test(ar.replace(/\/\*[\s\S]*?\*\//, '')));
});

function report(count, { status = 'passed', extra = {}, name } = {}) {
  const file = name ?? path.resolve(backendRoot, live.TEST_FILE);
  return JSON.stringify({ numTotalTestSuites: 1, success: true, numTotalTests: count, numPassedTests: count, numFailedTests: 0,
    numPendingTests: 0, numTodoTests: 0, ...extra,
    testResults: [{ name: file, assertionResults: Array.from({ length: count }, (_, index) => ({ title: `case ${index}`, status })) }] });
}

test('live report verification requires every case to have run and passed', () => {
  assert.deepEqual(live.verifyLiveReport(`noise\n${report(26)}`), { passed: 26, failed: 0, skipped: 0 });
  assert.deepEqual(live.verifyLiveReport(report(30)), { passed: 30, failed: 0, skipped: 0 });
  assert.throws(() => live.verifyLiveReport(report(25)), /FAILED_SKIPPED/);
  assert.throws(() => live.verifyLiveReport(report(26, { status: 'skipped' })), /FAILED_SKIPPED/);
  assert.throws(() => live.verifyLiveReport(report(26, { extra: { numPendingTests: 26, numPassedTests: 0 } })), /FAILED_SKIPPED/);
  assert.throws(() => live.verifyLiveReport(report(26, { extra: { success: false } })), /FAILED_SKIPPED/);
  assert.throws(() => live.verifyLiveReport(report(26, { name: path.join(backendRoot, 'src/other.test.ts') })), /FAILED_SKIPPED/);
  assert.throws(() => live.verifyLiveReport('not json'), /REPORT_INVALID/);
});

test('a stale or missing compiled build blocks the run', () => {
  const at = map => file => { const key = path.relative(backendRoot, file).replaceAll('\\', '/'); if (!(key in map)) throw new Error('ENOENT'); return { mtimeMs: map[key] }; };
  assert.match(live.checkBuild(backendRoot, at({})), /missing/);
  assert.match(live.checkBuild(backendRoot, at({ 'dist/payment-runner.js': 1000, 'src/services/payment.service.ts': 9000 })), /older than src\/services\/payment\.service\.ts/);
  assert.equal(live.checkBuild(backendRoot, at({ 'dist/payment-runner.js': 9000, 'src/services/payment.service.ts': 1000 })), null);
  assert.equal(live.checkBuild(backendRoot, at({ 'dist/payment-runner.js': 5000, 'src/services/payment.service.ts': 5500 })), null); // within the 1 s tolerance rule
});

test('the post-run residue check is read-only, scoped to the suite prefix, and fails on any leftover fixture', async () => {
  const calls = [];
  const client = rowFor => ({ async query(sql, params) { calls.push({ sql, params }); return { rows: [rowFor] }; } });
  assert.deepEqual(await live.verifyNoResidue(client({ users: 0, products: 0, categories: 0 })), { users: 0, products: 0, categories: 0 });
  assert.ok(calls.every(call => /^\s*SELECT/i.test(call.sql)));
  assert.deepEqual(calls[0].params, ['payment-gate-%@example.invalid', 'payment-gate-%']);
  for (const row of [{ users: 1, products: 0, categories: 0 }, { users: 0, products: 2, categories: 0 }, { users: 0, products: 0, categories: 1 }]) {
    await assert.rejects(live.verifyNoResidue(client(row)), error => error.label === 'FIXTURE_RESIDUE_REMAINS');
  }
});

// ---- the live suite itself rejects mis-scoped environments at import, before any database or Stripe activity ----------

function importLiveSuite(extra) {
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'test',
    JWT_SECRET: crypto.randomBytes(48).toString('base64url'), STRIPE_SECRET_KEY: 'sk_test_abcdef0123456789', ...extra };
  const run = spawnSync(process.execPath, [path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs'), 'run',
    live.TEST_FILE, '--config', 'vitest.config.mts', '--reporter=json'], { cwd: backendRoot, env, encoding: 'utf8', timeout: 120_000, windowsHide: true });
  return `${run.stdout}\n${run.stderr}`;
}

test('the live suite refuses mis-scoped environments at import', { timeout: 300_000 }, () => {
  const devUrl = 'postgresql://postgres.pzxekjybdiulzmssalfo:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres';
  const localUrl = `postgresql://postgres:pw@localhost:55432/${DB}`;
  assert.match(importLiveSuite({ PAYMENT_STRIPE_LIVE_DISPOSABLE: 'true', DATABASE_URL: devUrl, DIRECT_URL: devUrl }),
    /refuse DEV, PROD and hosted database URLs/);
  assert.match(importLiveSuite({ PAYMENT_STRIPE_LIVE_DISPOSABLE: 'true', PAYMENT_STRIPE_LIVE_DEV: 'true', DATABASE_URL: localUrl, DIRECT_URL: localUrl }),
    /mutually exclusive/);
  assert.match(importLiveSuite({ PAYMENT_STRIPE_LIVE_DISPOSABLE: 'true', DATABASE_URL: localUrl, DIRECT_URL: localUrl }),
    /exact owner Stripe Test Mode authorization/);
  assert.match(importLiveSuite({ PAYMENT_STRIPE_LIVE_DEV: 'true', DATABASE_URL: localUrl, DIRECT_URL: localUrl }),
    /require exact DEV and Stripe Test Mode/);
  // without any flag the suite is discovered and skipped, never started
  const skipped = importLiveSuite({ DATABASE_URL: localUrl, DIRECT_URL: localUrl });
  assert.match(skipped, /"numPassedTests":0/);
  assert.match(skipped, /"numFailedTests":0/);
});
