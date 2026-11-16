'use strict';
// Offline tests for the disposable-PostgreSQL scope. No network, no database, no Stripe.
//   node --test scripts/payment-pg-disposable.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const disposable = require('./payment-pg-disposable.cjs');

const openssl = spawnSync('openssl', ['version']).status === 0;
const certOptions = { skip: openssl ? false : 'openssl is not available' };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-disposable-test-'));
test.after(() => fs.rmSync(work, { recursive: true, force: true }));

function makeCa(name, { cn = 'electrohub-ci-ca', days = 1, extra = [], signer } = {}) {
  const key = path.join(work, `${name}.key`);
  const crt = path.join(work, `${name}.crt`);
  if (!signer) {
    const result = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', String(days), '-subj', `/CN=${cn}`,
      '-keyout', key, '-out', crt, ...extra], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } else {
    const csr = path.join(work, `${name}.csr`);
    assert.equal(spawnSync('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${cn}`, '-keyout', key, '-out', csr]).status, 0);
    assert.equal(spawnSync('openssl', ['x509', '-req', '-in', csr, '-CA', signer.crt, '-CAkey', signer.key, '-CAcreateserial', '-days', String(days), '-out', crt]).status, 0);
  }
  return { key, crt, pem: fs.readFileSync(crt, 'utf8') };
}

const DB = 'electrohub_ci';
const baseEnv = caFile => ({
  PAYMENT_PG_DISPOSABLE_APPROVED: 'true',
  PAYMENT_PG_DISPOSABLE_URL: `postgresql://postgres:secret@localhost:55432/${DB}`,
  PAYMENT_PG_DISPOSABLE_AUTHORIZATION: disposable.expectedAuthorization(DB),
  PAYMENT_PG_DISPOSABLE_CA_FILE: caFile,
});
const validate = (env, options = {}) => disposable.validateConfiguration(env, { scanFiles: false, ...options });

test('CA proof accepts a fresh self-signed short-lived CA and rejects every other kind', certOptions, () => {
  const good = makeCa('good');
  assert.equal(disposable.inspectCa(good.pem), null);
  assert.match(disposable.inspectCa(makeCa('wrongcn', { cn: 'some-other-ca' }).pem), /subject must be exactly/);
  assert.match(disposable.inspectCa(makeCa('long', { days: 400 }).pem), /short-lived/);
  assert.match(disposable.inspectCa(good.pem, Date.now() + 3 * 86_400_000), /not currently valid/);
  assert.match(disposable.inspectCa(good.pem, Date.now() - 86_400_000 * 2), /not currently valid/);
  assert.match(disposable.inspectCa(makeCa('notca', { extra: ['-addext', 'basicConstraints=critical,CA:FALSE'] }).pem), /not a certificate authority/);
  assert.match(disposable.inspectCa(makeCa('leaf', { signer: good }).pem), /self-signed/);
  assert.match(disposable.inspectCa('not a certificate'), /not a readable/);
});

test('configuration: a fully valid disposable configuration yields a config and nothing else is accepted by flag alone', certOptions, () => {
  const ca = makeCa('cfg');
  const ok = validate(baseEnv(ca.crt));
  assert.ok(ok.config, ok.error);
  assert.equal(ok.config.database, DB);
  assert.equal(ok.config.port, 55432);
  // authorization flag alone, no proof inputs: blocked
  assert.match(validate({ PAYMENT_PG_DISPOSABLE_APPROVED: 'true' }).error, /PAYMENT_PG_DISPOSABLE_URL is required/);
  assert.match(validate({ ...baseEnv(ca.crt), PAYMENT_PG_DISPOSABLE_APPROVED: 'false' }).error, /APPROVED=true is required/);
});

test('configuration fails closed for DEV, PROD, hosted, non-loopback, wrong-name, wrong-role and wrong-authorization targets', certOptions, () => {
  const ca = makeCa('closed');
  const env = baseEnv(ca.crt);
  const withUrl = url => validate({ ...env, PAYMENT_PG_DISPOSABLE_URL: url });
  const hostedDev = 'postgresql://postgres.pzxekjybdiulzmssalfo:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres';
  const hostedProd = 'postgresql://postgres.yepfgjehdstlxbpespun:pw@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres';
  assert.match(withUrl(hostedDev).error, /hosted, DEV or PROD/);
  assert.match(withUrl(hostedProd).error, /hosted, DEV or PROD/);
  assert.match(withUrl(`postgresql://postgres:pw@db.example.com:5432/${DB}`).error, /loopback/);
  assert.match(withUrl(`postgresql://postgres:pw@10.0.0.5:5432/${DB}`).error, /loopback/);
  assert.match(withUrl(`postgresql://postgres:pw@localhost/${DB}`).error, /explicit port/);
  assert.match(withUrl(`postgresql://postgres:pw@localhost:80/${DB}`).error, /explicit port/);
  assert.match(withUrl('postgresql://postgres:pw@localhost:5432/postgres').error, /database name must start/);
  assert.match(withUrl(`postgresql://someone:pw@localhost:55432/${DB}`).error, /instance owner role postgres/);
  assert.match(withUrl(`postgresql://postgres:pw@localhost:55432/${DB}?sslmode=disable`).error, /must not carry query options/);
  assert.match(withUrl('mysql://postgres:pw@localhost:55432/electrohub_ci').error, /PostgreSQL URL/);
  assert.match(withUrl('not a url').error, /not a valid/);
  assert.match(validate({ ...env, PAYMENT_PG_DISPOSABLE_AUTHORIZATION: 'DISPOSABLE:other:scenarios-A-S:fixtures+reset-run-database' }).error, /exact database/);
  assert.match(validate({ ...env, PAYMENT_PG_DISPOSABLE_CA_FILE: 'relative/ca.crt' }).error, /absolute path/);
  assert.match(validate({ ...env, PAYMENT_PG_DISPOSABLE_CA_FILE: path.join(work, 'missing.crt') }).error, /cannot be read/);
  assert.match(validate({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }).error, /unsafe TLS override/);
});

test('configuration refuses live Stripe values in the environment or env files, and a stale or foreign CA', certOptions, () => {
  const ca = makeCa('stripe');
  const env = baseEnv(ca.crt);
  assert.match(validate({ ...env, STRIPE_SECRET_KEY: 'sk_live_abcdef123' }).error, /Live Stripe/);
  const read = (file, enc) => (String(file).endsWith('.env.local') ? 'STRIPE_SECRET_KEY=sk_live_zzzz1234' : fs.readFileSync(file, enc));
  assert.match(disposable.validateConfiguration(env, { read, scanFiles: true }).error, /env file/);
  assert.match(validate(env, { now: Date.now() + 5 * 86_400_000 }).error, /not currently valid/);
  assert.match(validate({ ...env, PAYMENT_PG_DISPOSABLE_CA_FILE: makeCa('foreign', { cn: 'DigiCert Root' }).crt }).error, /subject must be exactly/);
});

const goodRow = { db: DB, usr: 'postgres', version: '17.2 (Debian 17.2-1.pgdg120+1)', ssl: true, other_databases: 0, other_roles: 0,
  platform_roles: 0, platform_schemas: 0, foreign_relations: 0 };
function scriptedClient(row) {
  const calls = [];
  return { calls, async query(sql, params) {
    calls.push({ sql: String(sql), params });
    if (/BEGIN READ ONLY|ROLLBACK/.test(String(sql))) return { rows: [] };
    if (row instanceof Error) throw row;
    return { rows: [row] };
  } };
}

test('server proof passes only for a dedicated, fresh, TLS-connected PostgreSQL 17 owner session', async () => {
  const client = scriptedClient(goodRow);
  assert.deepEqual(await disposable.verifyDisposableServer(client, { expectedDatabase: DB }), { database: DB, version: goodRow.version });
  assert.equal(client.calls[0].sql, 'BEGIN READ ONLY');
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
  assert.deepEqual(client.calls[1].params[2], null); // no allowed schema before provisioning
  const inRun = scriptedClient(goodRow);
  await disposable.verifyDisposableServer(inRun, { expectedDatabase: DB, allowedSchema: 'pgrun_0123456789ab' });
  assert.equal(inRun.calls[1].params[2], 'pgrun_0123456789ab');
  assert.equal(inRun.calls[1].params[3], false); // migration-created objects are tolerated only for a migrated public run
  assert.equal(client.calls[1].params[3], false);
  const migrated = scriptedClient(goodRow);
  await disposable.verifyDisposableServer(migrated, { expectedDatabase: DB, allowedSchema: 'public' });
  assert.deepEqual(migrated.calls[1].params.slice(2), ['public', true, disposable.MIGRATION_ROLES, disposable.MIGRATION_SCHEMAS]);
  assert.deepEqual(disposable.MIGRATION_SCHEMAS, ['ai', 'extensions']);
  assert.match(migrated.calls[1].sql, /NOT rolcanlogin AND NOT rolsuper/);
});

test('server proof rejects each way a target can fail to be a dedicated disposable instance', async () => {
  const cases = [
    [{ db: 'postgres' }, /DATABASE_MISMATCH/], [{ usr: 'app' }, /ROLE_MISMATCH/], [{ version: '18.0' }, /NOT_POSTGRESQL_17/],
    [{ version: '16.4' }, /NOT_POSTGRESQL_17/], [{ ssl: false }, /TLS_NOT_ACTIVE/], [{ ssl: null }, /TLS_NOT_ACTIVE/],
    [{ other_databases: 1 }, /DATABASES/], [{ other_roles: 2 }, /ROLES/], [{ platform_roles: 1 }, /HOSTED_PLATFORM/],
    [{ platform_schemas: 3 }, /HOSTED_PLATFORM/], [{ foreign_relations: 4 }, /NOT_FRESH/],
  ];
  for (const [patch, pattern] of cases) {
    await assert.rejects(disposable.verifyDisposableServer(scriptedClient({ ...goodRow, ...patch }), { expectedDatabase: DB }),
      error => pattern.test(error.label), JSON.stringify(patch));
  }
  await assert.rejects(disposable.verifyDisposableServer(scriptedClient(new Error('boom with secret host')), { expectedDatabase: DB }),
    error => error.label === 'DISPOSABLE_PROOF_QUERY_FAILED' && !/secret/.test(error.message));
  await assert.rejects(disposable.verifyDisposableServer(scriptedClient(undefined), { expectedDatabase: DB }), /DATABASE_MISMATCH|PROOF/);
});

test('cleanup resets only the database that carries this run marker, and drops only the migrations\' NOLOGIN roles (R-7)', async () => {
  const identity = disposable.newRunIdentity(() => Buffer.from('0123456789ab', 'hex'));
  assert.deepEqual(identity, { runId: '0123456789ab', schema: 'public', marker: 'electrohub-disposable-run:0123456789ab' });
  const config = { url: 'postgresql://postgres:pw@localhost:55432/electrohub_ci', database: DB, caPem: 'ca' };
  const make = (marker, { present = 1, rolesLeft = 0, markerAfter = null, databasesAfter = 1 } = {}) => {
    const state = { sql: [], params: [], url: null, ended: false };
    const create = cfg => { state.url = cfg.url; return { async connect() {}, async end() { state.ended = true; }, async query(text, params) {
      state.sql.push(text); state.params.push(params);
      if (/AS marker FROM pg_database WHERE datname = \$1/.test(text)) return present ? { rowCount: 1, rows: [{ marker }] } : { rowCount: 0, rows: [] };
      if (/SELECT rolname FROM pg_roles/.test(text)) return { rows: [{ rolname: 'ai_vector_reader' }, { rolname: 'ai_media_worker' }] };
      if (/AS databases/.test(text)) return { rows: [{ marker: markerAfter, databases: databasesAfter, roles: rolesLeft }] };
      return { rows: [] };
    } }; };
    return { state, create };
  };
  const ok = make(identity.marker);
  assert.equal(await disposable.resetRunDatabase(config, identity, { create: ok.create }), 'reset');
  assert.equal(new URL(ok.state.url).pathname, '/postgres');
  assert.ok(ok.state.ended);
  assert.deepEqual(ok.state.sql.filter(text => /^(DROP|CREATE)/.test(text)), ['DROP DATABASE "electrohub_ci" WITH (FORCE)',
    'CREATE DATABASE "electrohub_ci"', 'DROP ROLE "ai_vector_reader"', 'DROP ROLE "ai_media_worker"']);
  const roleQuery = ok.state.sql.findIndex(text => /SELECT rolname FROM pg_roles/.test(text));
  assert.match(ok.state.sql[roleQuery], /NOT rolcanlogin AND NOT rolsuper/);
  assert.deepEqual(ok.state.params[roleQuery][0], disposable.MIGRATION_ROLES);

  for (const [variant, label] of [[make('electrohub-disposable-run:ffffffffffff'), 'CLEANUP_MARKER_MISMATCH'], [make(null), 'CLEANUP_MARKER_MISMATCH'],
    [make(identity.marker, { present: 0 }), 'CLEANUP_DATABASE_ABSENT']]) {
    await assert.rejects(disposable.resetRunDatabase(config, identity, { create: variant.create }), error => error.label === label);
    assert.ok(!variant.state.sql.some(text => /^DROP|^CREATE/.test(text)), label);
    assert.ok(variant.state.ended);
  }
  for (const after of [{ rolesLeft: 1 }, { markerAfter: identity.marker }, { databasesAfter: 0 }]) {
    await assert.rejects(disposable.resetRunDatabase(config, identity, { create: make(identity.marker, after).create }), error => error.label === 'CLEANUP_NOT_VERIFIED');
  }
  await assert.rejects(disposable.resetRunDatabase({ ...config, database: 'postgres' }, identity, { create: ok.create }), error => error.label === 'CLEANUP_IDENTITY_INVALID');
  await assert.rejects(disposable.resetRunDatabase(config, { marker: 'other' }, { create: ok.create }), error => error.label === 'CLEANUP_IDENTITY_INVALID');
  assert.throws(() => disposable.quoteIdentifier('public"; DROP TABLE x;--'), error => error.label === 'IDENTIFIER_INVALID');
});

test('each run gets fresh, valid, unpredictable identifiers', () => {
  const first = disposable.newRunIdentity();
  const second = disposable.newRunIdentity();
  assert.notEqual(first.runId, second.runId);
  assert.match(first.runId, /^[a-f0-9]{12}$/);
  assert.equal(first.schema, 'public'); // R-7: the run owns the proved-fresh instance and migrates its public schema
  assert.match(first.marker, /^electrohub-disposable-run:[a-f0-9]{12}$/);
});

test('stages: ambient database variables are overridden, Stripe is blank, concurrency and time are bounded, TLS is strict end to end', certOptions, () => {
  const ca = makeCa('stages');
  const { config } = validate(baseEnv(ca.crt));
  const identity = disposable.newRunIdentity();
  const ambient = { DATABASE_URL: 'postgresql://postgres.pzxekjybdiulzmssalfo:pw@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres',
    DIRECT_URL: 'postgresql://postgres.pzxekjybdiulzmssalfo:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres', STRIPE_SECRET_KEY: 'sk_test_ambient', PATH: process.env.PATH };
  const [probe, migration, tests] = disposable.stageDefinitions(config, identity, ambient, { probeFile: path.join(work, 'probe.sql') });
  assert.deepEqual([probe.name, migration.name, tests.name], ['migration_tls', 'migration', 'tests']);
  for (const stage of [probe, migration, tests]) {
    assert.equal(stage.env.STRIPE_SECRET_KEY, '');
    assert.equal(stage.env.NODE_ENV, 'test');
    assert.equal(stage.env.NODE_EXTRA_CA_CERTS, config.caFile);
    assert.ok(!/supabase|pooler|pzxekj|yepfgj/i.test(`${stage.env.DATABASE_URL} ${stage.env.DIRECT_URL}`), stage.name);
    assert.ok(stage.timeoutMs <= 600_000);
    assert.equal(new URL(stage.env.DATABASE_URL).hostname, 'localhost');
    assert.equal(new URL(stage.env.DATABASE_URL).searchParams.get('schema'), identity.schema);
  }
  for (const stage of [probe, migration]) {
    const url = new URL(stage.env.DATABASE_URL);
    assert.equal(url.searchParams.get('sslmode'), 'require');
    assert.equal(url.searchParams.get('sslaccept'), 'strict');
    assert.equal(url.searchParams.get('sslcert'), config.caFile);
    assert.equal(url.searchParams.get('connection_limit'), '1');
    assert.equal(url.searchParams.get('options'), null); // public: Prisma's default search_path
  }
  assert.ok(probe.args.includes('execute') && probe.args.includes(path.join(work, 'probe.sql')));
  assert.ok(migration.args.includes('deploy') && migration.args.includes('migrate'));
  const testUrl = new URL(tests.env.DATABASE_URL);
  assert.equal(testUrl.searchParams.get('options'), null); // public: the app's database-target guard rejects `options`
  assert.equal(new URL(disposable.runUrl(config, 'pgrun_0123456789ab')).searchParams.get('options'), '-csearch_path=pgrun_0123456789ab');
  assert.equal(testUrl.searchParams.get('connection_limit'), '4');
  assert.equal(tests.env.PAYMENT_PG_TEST_INTERNAL_RUN, 'disposable');
  assert.equal(tests.env.PAYMENT_PG_TEST_DATABASE_URL, tests.env.DATABASE_URL);
  assert.equal(tests.env.PAYMENT_PG_DISPOSABLE_SCHEMA, identity.schema);
  for (const flag of ['--pool=forks', '--maxWorkers=1', '--no-file-parallelism']) assert.ok(tests.args.includes(flag), flag);
  for (const file of disposable.SUITES['scenarios-A-S'].files) { assert.ok(tests.args.includes(file)); assert.ok(fs.existsSync(path.resolve(__dirname, '..', file)), file); }
  assert.ok(!tests.args.includes(disposable.TEST_FILES[2])); // the default A-S run never picks up the A-Y-only file
  assert.ok(!tests.args.includes(disposable.TEST_FILES[3])); // nor the A-Z-only last-unit file
  for (const file of disposable.TEST_FILES) assert.ok(fs.existsSync(path.resolve(__dirname, '..', file)), file);
});

test('the native-engine TLS probe is read-only and embeds only validated identifiers', () => {
  const sql = disposable.probeSql('electrohub_ci', 'pgrun_0123456789ab');
  assert.match(sql, /^BEGIN READ ONLY;/);
  assert.match(sql, /ROLLBACK;\s*$/);
  assert.match(sql, /current_database\(\) = 'electrohub_ci'/);
  assert.match(sql, /current_schema\(\) = 'pgrun_0123456789ab'/);
  assert.match(sql, /pg_stat_ssl WHERE pid = pg_backend_pid\(\)/);
  assert.match(disposable.probeSql('electrohub_ci', 'public'), /current_schema\(\) = 'public'/);
  for (const [db, schema] of [["electrohub_ci'; DROP TABLE x;--", 'public'], ['postgres', 'public'], ['electrohub_ci', "public'; --"], ['electrohub_ci', 'pgrun_XYZ']]) {
    assert.throws(() => disposable.probeSql(db, schema), error => error.label === 'PROBE_IDENTIFIER_INVALID', `${db} ${schema}`);
  }
  const written = [];
  const file = disposable.writeProbeFile('electrohub_ci', 'public', (name, data, options) => written.push({ name, data, options }), '/tmp', size => Buffer.alloc(size, 1));
  assert.equal(path.basename(file), 'electrohub-pg-probe-010101010101.sql');
  assert.equal(written[0].options.flag, 'wx'); // never overwrite an existing file
  assert.equal(written[0].options.mode, 0o600);
});

function report(titles, { files = disposable.SUITES['scenarios-A-S'].files, status = 'passed', extra = {} } = {}) {
  const per = Math.ceil(titles.length / files.length);
  return JSON.stringify({ numTotalTestSuites: 2, success: true, numTotalTests: titles.length, numPassedTests: titles.length,
    numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, ...extra,
    testResults: files.map((file, index) => ({ name: path.resolve(__dirname, '..', file),
      assertionResults: titles.slice(index * per, (index + 1) * per).map(title => ({ title, status })) })) });
}
const allTitles = disposable.SCENARIOS.map(letter => `${letter} — scenario ${letter}`);

test('report verification demands every scenario A-S exactly once, passed, none skipped', () => {
  assert.deepEqual(disposable.verifyReport(`noise\n${report(allTitles)}`), { passed: 19, failed: 0, skipped: 0 });
  assert.throws(() => disposable.verifyReport(report(allTitles.slice(1))), /FAILED_SKIPPED/);
  assert.throws(() => disposable.verifyReport(report(allTitles, { status: 'skipped' })), /FAILED_SKIPPED/);
  assert.throws(() => disposable.verifyReport(report(allTitles, { extra: { numPendingTests: 1 } })), /FAILED_SKIPPED/);
  assert.throws(() => disposable.verifyReport(report(allTitles, { extra: { success: false } })), /FAILED_SKIPPED/);
  assert.throws(() => disposable.verifyReport(report(allTitles, { files: [disposable.TEST_FILES[0]] })), /FAILED_SKIPPED/);
  const duplicated = [...allTitles.slice(0, 18), allTitles[0]];
  assert.throws(() => disposable.verifyReport(report(duplicated)), /SCENARIOS_MISSING/);
  assert.throws(() => disposable.verifyReport(report(allTitles.map((title, index) => (index === 3 ? 'D without the dash' : title)))), /SCENARIOS_MISSING/);
  assert.throws(() => disposable.verifyReport('not json'), /REPORT_INVALID/);
});

test('A-J scope: its own exact authorization, only the A-J file, only A-J scenarios; A-S approval cannot start it and vice versa', certOptions, () => {
  const ca = makeCa('aj');
  const ajEnv = { ...baseEnv(ca.crt), PAYMENT_PG_DISPOSABLE_AUTHORIZATION: disposable.expectedAuthorization(DB, 'scenarios-A-J') };
  assert.equal(disposable.expectedAuthorization(DB, 'scenarios-A-J'), 'DISPOSABLE:electrohub_ci:scenarios-A-J:fixtures+reset-run-database');
  assert.ok(validate(ajEnv, { scope: 'scenarios-A-J' }).config);
  assert.match(validate(baseEnv(ca.crt), { scope: 'scenarios-A-J' }).error, /exact database, scenario set/);
  assert.match(validate(ajEnv).error, /exact database, scenario set/);
  assert.equal(disposable.selectedScope(['--run', '--scope=scenarios-A-J']), 'scenarios-A-J');
  assert.equal(disposable.selectedScope(['--run']), 'scenarios-A-S');
  assert.equal(disposable.selectedScope(['--run', '--scope=scenarios-A-ZZ']), null);
  const { config } = validate(ajEnv, { scope: 'scenarios-A-J' });
  const tests = disposable.stageDefinitions(config, disposable.newRunIdentity(), { PATH: process.env.PATH }, { scope: 'scenarios-A-J' })[2];
  assert.ok(tests.args.includes(disposable.TEST_FILES[0]));
  assert.ok(!tests.args.includes(disposable.TEST_FILES[1]));
  assert.equal(tests.env.PAYMENT_PG_DISPOSABLE_SCOPE, 'scenarios-A-J');
  assert.equal(tests.env.PAYMENT_PG_DISPOSABLE_AUTHORIZATION, disposable.expectedAuthorization(DB, 'scenarios-A-J'));
  const suite = disposable.SUITES['scenarios-A-J'];
  const titles = suite.scenarios.map(letter => `${letter} — scenario ${letter}`);
  assert.deepEqual(disposable.verifyReport(report(titles, { files: suite.files }), undefined, suite), { passed: 10, failed: 0, skipped: 0 });
  assert.throws(() => disposable.verifyReport(report(titles.slice(1), { files: suite.files }), undefined, suite), /FAILED_SKIPPED/);
  assert.throws(() => disposable.verifyReport(report([...titles.slice(0, 9), 'K — scenario K'], { files: suite.files }), undefined, suite), /SCENARIOS_MISSING/);
  assert.throws(() => disposable.verifyReport(report(titles, { files: disposable.TEST_FILES }), undefined, suite), /FAILED_SKIPPED/);
});

test('A-Y scope (Task 06.2): its own exact authorization, its three files, every scenario A-Y once; A-S approval cannot start it', certOptions, () => {
  const ca = makeCa('ay');
  const ayEnv = { ...baseEnv(ca.crt), PAYMENT_PG_DISPOSABLE_AUTHORIZATION: disposable.expectedAuthorization(DB, 'scenarios-A-Y') };
  assert.equal(disposable.expectedAuthorization(DB, 'scenarios-A-Y'), 'DISPOSABLE:electrohub_ci:scenarios-A-Y:fixtures+reset-run-database');
  assert.ok(validate(ayEnv, { scope: 'scenarios-A-Y' }).config);
  assert.match(validate(baseEnv(ca.crt), { scope: 'scenarios-A-Y' }).error, /exact database, scenario set/);
  assert.match(validate(ayEnv).error, /exact database, scenario set/);
  assert.equal(disposable.selectedScope(['--run', '--scope=scenarios-A-Y']), 'scenarios-A-Y');
  const { config } = validate(ayEnv, { scope: 'scenarios-A-Y' });
  const tests = disposable.stageDefinitions(config, disposable.newRunIdentity(), { PATH: process.env.PATH }, { scope: 'scenarios-A-Y' })[2];
  for (const file of disposable.TEST_FILES.slice(0, 3)) assert.ok(tests.args.includes(file));
  assert.ok(!tests.args.includes(disposable.TEST_FILES[3]));
  assert.equal(tests.env.PAYMENT_PG_DISPOSABLE_SCOPE, 'scenarios-A-Y');
  const suite = disposable.SUITES['scenarios-A-Y'];
  assert.equal(suite.scenarios.join(''), 'ABCDEFGHIJKLMNOPQRSTUVWXY');
  const titles = suite.scenarios.map(letter => `${letter} — scenario ${letter}`);
  assert.deepEqual(disposable.verifyReport(report(titles, { files: suite.files }), undefined, suite), { passed: 25, failed: 0, skipped: 0 });
  assert.throws(() => disposable.verifyReport(report(titles.slice(1), { files: suite.files }), undefined, suite), /FAILED_SKIPPED/);
  assert.throws(() => disposable.verifyReport(report([...titles.slice(0, 24), 'Z — scenario Z'], { files: suite.files }), undefined, suite), /SCENARIOS_MISSING/);
  // The A-S suite still runs exactly its two files and cannot be satisfied by a T-Y title.
  const asSuite = disposable.SUITES['scenarios-A-S'];
  assert.equal(asSuite.files.length, 2);
  assert.throws(() => disposable.verifyReport(report([...allTitles.slice(0, 18), 'T — scenario T']), undefined, asSuite), /SCENARIOS_MISSING/);
});

test('A-Z scope (PR #51 last unit): its own exact authorization, all four files, every scenario A-Z once; A-Y approval cannot start it', certOptions, () => {
  const ca = makeCa('az');
  const azEnv = { ...baseEnv(ca.crt), PAYMENT_PG_DISPOSABLE_AUTHORIZATION: disposable.expectedAuthorization(DB, 'scenarios-A-Z') };
  assert.equal(disposable.expectedAuthorization(DB, 'scenarios-A-Z'), 'DISPOSABLE:electrohub_ci:scenarios-A-Z:fixtures+reset-run-database');
  assert.ok(validate(azEnv, { scope: 'scenarios-A-Z' }).config);
  const ayEnv = { ...baseEnv(ca.crt), PAYMENT_PG_DISPOSABLE_AUTHORIZATION: disposable.expectedAuthorization(DB, 'scenarios-A-Y') };
  assert.match(validate(ayEnv, { scope: 'scenarios-A-Z' }).error, /exact database, scenario set/);
  assert.match(validate(azEnv, { scope: 'scenarios-A-Y' }).error, /exact database, scenario set/);
  assert.equal(disposable.selectedScope(['--run', '--scope=scenarios-A-Z']), 'scenarios-A-Z');
  const { config } = validate(azEnv, { scope: 'scenarios-A-Z' });
  const tests = disposable.stageDefinitions(config, disposable.newRunIdentity(), { PATH: process.env.PATH }, { scope: 'scenarios-A-Z' })[2];
  assert.equal(disposable.TEST_FILES.length, 4);
  for (const file of disposable.TEST_FILES) assert.ok(tests.args.includes(file));
  assert.equal(tests.env.PAYMENT_PG_DISPOSABLE_SCOPE, 'scenarios-A-Z');
  const suite = disposable.SUITES['scenarios-A-Z'];
  assert.equal(suite.scenarios.join(''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  const titles = suite.scenarios.map(letter => `${letter} — scenario ${letter}`);
  assert.deepEqual(disposable.verifyReport(report(titles, { files: suite.files }), undefined, suite), { passed: 26, failed: 0, skipped: 0 });
  assert.throws(() => disposable.verifyReport(report(titles.slice(0, 25), { files: suite.files }), undefined, suite), /FAILED_SKIPPED/);
  assert.throws(() => disposable.verifyReport(report(titles, { files: suite.files.slice(0, 3) }), undefined, suite), /FAILED_SKIPPED/);
});

test('the two scopes reject each other: the DEV runner refuses disposable settings, the disposable runner refuses DEV settings', certOptions, () => {
  const dev = require('./payment-concurrency-integration-suite.cjs');
  const saved = { ...process.env };
  try {
    const ca = makeCa('cross');
    Object.assign(process.env, baseEnv(ca.crt), { PAYMENT_PG_TEST_DATABASE_URL: process.env.PAYMENT_PG_DISPOSABLE_URL, PAYMENT_PG_TEST_APPROVED: 'true' });
    assert.match(dev.validateConfiguration(), /PAYMENT_PG_TEST_TARGET=dev-isolated-schema is required/);
    const devUrl = 'postgresql://eh_payment_concurrency_runner.pzxekjybdiulzmssalfo:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?schema=electrohub_payment_concurrency_20261012&options=-csearch_path%3Delectrohub_payment_concurrency_20261012&sslmode=require&connection_limit=4';
    assert.match(validate({ ...baseEnv(ca.crt), PAYMENT_PG_DISPOSABLE_URL: devUrl }).error, /hosted, DEV or PROD/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test('the DEV scope guard and its execution helpers are still present and still DEV-only', () => {
  const runner = fs.readFileSync(path.join(__dirname, 'payment-concurrency-integration-suite.cjs'), 'utf8');
  const execution = fs.readFileSync(path.join(__dirname, 'payment-pg-execution.cjs'), 'utf8');
  assert.match(runner, /const PROJECT_REF = 'pzxekjybdiulzmssalfo'/);
  assert.match(runner, /Only the DEV ap-northeast-2 session pooler on port 5432 is accepted\./);
  assert.match(execution, /report\.numTotalTests !== 10/);
  assert.ok(!/disposable/i.test(execution), 'DEV execution helpers must not gain a disposable branch');
  assert.ok(!/payment-pg-disposable/.test(runner));
});

// ---- process containment, interrupted runs and atomic provisioning ---------------------------------------------------

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
async function waitUntil(predicate, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (predicate()) return true; await new Promise(resolve => setTimeout(resolve, 50)); }
  return predicate();
}
const treeScript = `
  const { spawn } = require('node:child_process');
  const fs = require('node:fs');
  const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  fs.writeFileSync(process.env.PID_FILE, String(grandchild.pid));
  setInterval(() => {}, 1000);`;
const readPid = file => Number(fs.readFileSync(file, 'utf8'));

test('a timed-out stage is killed together with the processes it started', async () => {
  const pidFile = path.join(work, 'tree-timeout.pid');
  await assert.rejects(disposable.runStage({ name: 'tree', timeoutMs: 1500, args: ['-e', treeScript],
    env: { ...process.env, PID_FILE: pidFile } }), error => error.label === 'CHILD_TIMEOUT' && error.treeStopped === true);
  const grandchild = readPid(pidFile);
  assert.ok(await waitUntil(() => !alive(grandchild)), 'the grandchild must not outlive its stage');
});

test('an owner interrupt kills the whole tree, rejects as canceled, and reports the tree as stopped', async () => {
  const pidFile = path.join(work, 'tree-abort.pid');
  const owner = new AbortController();
  const running = disposable.runStage({ name: 'tree', timeoutMs: 30_000, args: ['-e', treeScript], env: { ...process.env, PID_FILE: pidFile } },
    { signal: owner.signal });
  assert.ok(await waitUntil(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').length > 0));
  const grandchild = readPid(pidFile);
  owner.abort();
  await assert.rejects(running, error => error.label === 'OWNER_CANCELED' && error.treeStopped === true);
  assert.ok(await waitUntil(() => !alive(grandchild)));
  await assert.rejects(disposable.runStage({ name: 'late', timeoutMs: 1000, args: ['-e', ''], env: process.env }, { signal: owner.signal }),
    error => error.label === 'OWNER_CANCELED');
});

test('a stage whose termination cannot be confirmed is reported as such, so cleanup is never attempted', async () => {
  const pidFile = path.join(work, 'tree-stuck.pid');
  let child;
  const spawnObserved = (...args) => { child = require('node:child_process').spawn(...args); return child; };
  await assert.rejects(disposable.runStage({ name: 'tree', timeoutMs: 400, args: ['-e', treeScript], env: { ...process.env, PID_FILE: pidFile } },
    { spawnChild: spawnObserved, graceMs: 600, killTreeFn: () => false }),
  error => error.label === 'CHILD_TERMINATION_UNCONFIRMED' && error.treeStopped === false);
  // test hygiene only: the stuck child is really terminated here, by the test itself
  disposable.killTree(child);
  const grandchild = readPid(pidFile);
  assert.ok(await waitUntil(() => !alive(grandchild)));
});

test('stage failures are classified without leaking child output', async () => {
  await assert.rejects(disposable.runStage({ name: 'tests', timeoutMs: 5000, args: ['-e', 'console.error("secret-host.example"); process.exit(3)'], env: process.env }),
    error => error.label === 'CHILD_NONZERO_EXIT_TESTS' && !/secret/.test(error.message));
  const ok = await disposable.runStage({ name: 'ok', timeoutMs: 5000, args: ['-e', 'console.log("fine")'], env: process.env });
  assert.equal(ok.stdout.trim(), 'fine');
  await assert.rejects(disposable.runStage({ name: 'flood', timeoutMs: 20_000, args: ['-e', 'const b = "x".repeat(1 << 20); for (let i = 0; i < 10; i++) process.stdout.write(b); setInterval(() => {}, 1000)'], env: process.env }),
    error => error.label === 'CHILD_OUTPUT_LIMIT');
});

test('POSIX containment helpers: group kill targets the negative pid; Windows uses taskkill with the tree flag', () => {
  const calls = [];
  assert.equal(disposable.killTree({ pid: 4242, kill() {} }, { platform: 'linux', kill: (pid, signal) => calls.push([pid, signal]) }), true);
  assert.deepEqual(calls, [[-4242, 'SIGKILL']]);
  const spawned = [];
  assert.equal(disposable.killTree({ pid: 77 }, { platform: 'win32', spawnSyncFn: (...args) => { spawned.push(args); return { status: 0 }; } }), true);
  assert.deepEqual(spawned[0].slice(0, 2), ['taskkill', ['/PID', '77', '/T', '/F']]);
  assert.equal(disposable.killTree({ pid: 77 }, { platform: 'win32', spawnSyncFn: () => ({ status: 1 }) }), false);
  assert.equal(disposable.groupAlive(1, { platform: 'win32' }), false);
  assert.equal(disposable.groupAlive(9, { platform: 'linux', kill: () => { const error = new Error('gone'); error.code = 'ESRCH'; throw error; } }), false);
  assert.equal(disposable.groupAlive(9, { platform: 'linux', kill: () => true }), true);
});

test('the run marks the proved database itself; malformed identifiers never reach SQL', async () => {
  const identity = disposable.newRunIdentity(() => Buffer.from('0123456789ab', 'hex'));
  const calls = [];
  const client = { async query(text) { calls.push(text); return { rows: [] }; } };
  await disposable.markDatabase(client, DB, identity.marker);
  assert.deepEqual(calls, ["COMMENT ON DATABASE \"electrohub_ci\" IS 'electrohub-disposable-run:0123456789ab'"]);
  await assert.rejects(disposable.markDatabase(client, 'postgres', identity.marker), error => error.label === 'MARKER_INVALID');
  await assert.rejects(disposable.markDatabase(client, DB, "x'; DROP DATABASE y;--"), error => error.label === 'MARKER_INVALID');
  assert.equal(calls.length, 1);
});

test('children never inherit variables that select or authorize another execution path', certOptions, () => {
  const ca = makeCa('scrub');
  const { config } = validate(baseEnv(ca.crt));
  const identity = disposable.newRunIdentity();
  const ambient = { PATH: process.env.PATH, PAYMENT_STRIPE_LIVE_DEV: 'true', PAYMENT_STRIPE_LIVE_AUTHORIZATION: 'x', PAYMENT_STRIPE_DISPOSABLE_APPROVED: 'true',
    PAYMENT_PG_TEST_APPROVED: 'true', PAYMENT_PG_TEST_TARGET: 'dev-isolated-schema', PAYMENT_PG_TEST_MONITOR_FILE: 'C:/monitor.json', UNRELATED: 'kept' };
  assert.deepEqual(Object.keys(disposable.scrubbedEnvironment(ambient)).sort(), ['PATH', 'UNRELATED']);
  for (const stage of disposable.stageDefinitions(config, identity, ambient)) {
    assert.equal(stage.env.PAYMENT_STRIPE_LIVE_DEV, undefined);
    assert.equal(stage.env.PAYMENT_PG_TEST_TARGET, undefined);
    assert.equal(stage.env.PAYMENT_PG_TEST_APPROVED, undefined);
    assert.equal(stage.env.PAYMENT_PG_TEST_MONITOR_FILE, undefined);
    assert.equal(stage.env.UNRELATED, 'kept');
  }
});
