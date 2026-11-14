/*
 * Task 03.6 disposable-PostgreSQL acceptance runner (scope: DISPOSABLE).
 *
 * This is a SEPARATE scope from payment-concurrency-integration-suite.cjs, which stays restricted to the
 * pre-provisioned schema in the DEV project and is not modified. This runner can only ever target a throwaway
 * PostgreSQL 17 instance (the one started by .github/actions/disposable-postgres, or an equivalent the owner
 * starts locally). It never calls Stripe, never uses DATABASE_URL/DIRECT_URL from the environment or env files,
 * and never connects to a hosted database.
 *
 * "Disposable" is PROVED, not declared. An environment flag only expresses authorization. The target must:
 *   1. be a loopback host with a database named electrohub_ci* / electrohub_disposable*;
 *   2. present a TLS certificate that chains to a per-run, self-signed, short-lived CA supplied as a file
 *      (CN=electrohub-ci-ca, valid at most 48 hours, issued within the last 48 hours); a hosted or general-purpose
 *      server cannot present such a certificate;
 *   3. be a dedicated, fresh instance: PostgreSQL 17, connected over TLS as `postgres`, no other databases, no other
 *      login roles, no hosted-platform roles or schemas, and no relations at all.
 * The run then marks the database, applies every repository migration to its `public` schema (the Task 04.2 pgvector
 * migrations reference `public.*` and cannot be replayed into a side schema; Task 06.1 R-7), runs the suite, and resets the
 * marked database to empty so the instance is fresh again.
 * Any failed or unverifiable check blocks the run before a write.
 *
 *   node scripts/payment-pg-disposable.cjs --check-config   # offline: configuration and CA proof only
 *   node scripts/payment-pg-disposable.cjs --run             # connects, proves, provisions, tests, cleans up
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const backendRoot = path.resolve(__dirname, '..');
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const DATABASE_NAME = /^electrohub_(ci|disposable)[a-z0-9_]{0,40}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const CA_COMMON_NAME = 'electrohub-ci-ca';
const CA_MAX_LIFETIME_MS = 48 * 3_600_000;
const FORBIDDEN_TARGET_TEXT = ['supabase', 'pooler', 'pzxekjybdiulzmssalfo', 'yepfgjehdstlxbpespun', 'amazonaws',
  'ap-northeast', 'neon.tech', 'azure', 'rds.'];
const PLATFORM_ROLES = ['supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin', 'supabase_read_only_user',
  'authenticator', 'anon', 'authenticated', 'service_role', 'pgbouncer', 'dashboard_user'];
const PLATFORM_SCHEMAS = ['auth', 'storage', 'realtime', 'supabase_migrations', 'vault', 'graphql', 'graphql_public', 'extensions'];
/** Objects the repository's own migrations create outside `public` (Task 04.2 pgvector, Task 04.3 media). Tolerated only after migration. */
const MIGRATION_SCHEMAS = ['ai', 'extensions'];
const MIGRATION_ROLES = ['ai_vector_reader', 'ai_vector_ingest', 'ai_media_worker'];
const LIVE_STRIPE = /(?:sk|rk|pk)_live_[A-Za-z0-9]+/i;
const SCENARIOS = 'ABCDEFGHIJKLMNOPQRS'.split('');
const TEST_FILES = [
  'src/services/__tests__/payment.concurrency.postgres.integration.test.ts',
  'src/services/__tests__/payment.lifecycle.postgres.integration.test.ts',
  // Task 06.2: exact sellable-stock arithmetic (T-Y). Only the A-Y suite runs it; A-S and A-J keep their exact file sets.
  'src/services/__tests__/payment.stock-integrity.postgres.integration.test.ts',
  // Task 06.2 (PR #51): two customers competing for the last unit (Z). Only the A-Z suite runs it; A-Y keeps its exact three files.
  'src/services/__tests__/payment.last-unit.postgres.integration.test.ts',
];
const ALL_SCENARIOS = 'ABCDEFGHIJKLMNOPQRSTUVWXY'.split('');
const ALL_SCENARIOS_WITH_LAST_UNIT = [...ALL_SCENARIOS, 'Z'];
/**
 * Scenario suites this runner can execute. Each suite has its own exact authorization scope, so approval of A–J alone
 * can never start K–S (and the A–S string is not needed to run A–J).
 */
const SUITES = {
  'scenarios-A-S': { scenarios: SCENARIOS, files: TEST_FILES.slice(0, 2) },
  'scenarios-A-J': { scenarios: 'ABCDEFGHIJ'.split(''), files: [TEST_FILES[0]] },
  'scenarios-A-Y': { scenarios: ALL_SCENARIOS, files: TEST_FILES.slice(0, 3) },
  'scenarios-A-Z': { scenarios: ALL_SCENARIOS_WITH_LAST_UNIT, files: TEST_FILES },
};
const CONFIG_FILE = 'vitest.config.mts';
const ENV_FILE_NAMES = ['.env', '.env.local', '.env.test.local', '.env.production.local', '.env.development.local'];

function failure(label, treeStopped = true) {
  const error = new Error(label);
  error.label = label;
  error.treeStopped = treeStopped;
  return error;
}

/** Variables that select or authorize another execution path; a disposable child must never inherit them. */
const AMBIENT_MODE_VARIABLES = /^PAYMENT_(STRIPE_LIVE|STRIPE_DISPOSABLE|PG_TEST)_/;
function scrubbedEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !AMBIENT_MODE_VARIABLES.test(name)));
}

/**
 * The exact authorization string the owner supplies; it binds a run to one database name and one entrypoint scope.
 * Each entrypoint expects its own scope, so approval of one cannot start the other.
 */
const AUTH_SCOPES = {
  'scenarios-A-S': 'scenarios-A-S:fixtures+reset-run-database',
  'scenarios-A-J': 'scenarios-A-J:fixtures+reset-run-database',
  'scenarios-A-Y': 'scenarios-A-Y:fixtures+reset-run-database',
  'scenarios-A-Z': 'scenarios-A-Z:fixtures+reset-run-database',
  'stripe-live': 'stripe-live-suite:disposable-fixtures-owned-ids',
};
function expectedAuthorization(database, scope = 'scenarios-A-S') {
  if (!AUTH_SCOPES[scope]) throw failure('AUTHORIZATION_SCOPE_UNKNOWN');
  return `DISPOSABLE:${database}:${AUTH_SCOPES[scope]}`;
}

function quoteIdentifier(value) {
  if (!IDENTIFIER.test(value)) throw failure('IDENTIFIER_INVALID');
  return `"${value}"`;
}

function newRunIdentity(random = crypto.randomBytes) {
  const runId = random(6).toString('hex');
  return { runId, schema: 'public', marker: `electrohub-disposable-run:${runId}` };
}

/** Inspects the per-run CA certificate. Returns an error string or null. */
function inspectCa(pem, now = Date.now()) {
  let cert;
  try { cert = new crypto.X509Certificate(pem); } catch { return 'The CA file is not a readable X.509 certificate.'; }
  if (cert.subject.trim() !== `CN=${CA_COMMON_NAME}`) return `The CA subject must be exactly CN=${CA_COMMON_NAME}.`;
  if (cert.subject !== cert.issuer || !cert.verify(cert.publicKey)) return 'The CA must be self-signed.';
  if (!cert.ca) return 'The CA certificate is not a certificate authority.';
  const from = Date.parse(cert.validFrom);
  const to = Date.parse(cert.validTo);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 'The CA validity period is unreadable.';
  if (to - from > CA_MAX_LIFETIME_MS) return 'The CA must be short-lived (at most 48 hours of validity).';
  if (now < from || now > to) return 'The CA is not currently valid.';
  if (now - from > CA_MAX_LIFETIME_MS) return 'The CA was not issued for this run (older than 48 hours).';
  return null;
}

function scanEnvFilesForLiveStripe(read = fs.readFileSync) {
  const roots = [backendRoot, path.resolve(backendRoot, '..', 'frontend')];
  for (const root of roots) {
    for (const name of ENV_FILE_NAMES) {
      let content;
      try { content = read(path.join(root, name), 'utf8'); } catch { continue; }
      if (LIVE_STRIPE.test(content)) return true;
    }
  }
  return false;
}

/**
 * Offline validation of configuration plus the CA proof. No network, no database. Returns { error } or { config }.
 */
function validateConfiguration(env = process.env, { read = fs.readFileSync, now = Date.now(), scanFiles = true, scope = 'scenarios-A-S' } = {}) {
  const fail = error => ({ error });
  if (env.PAYMENT_PG_DISPOSABLE_APPROVED !== 'true') return fail('PAYMENT_PG_DISPOSABLE_APPROVED=true is required (authorization only; it does not establish the target).');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') return fail('An unsafe TLS override is prohibited.');
  const raw = env.PAYMENT_PG_DISPOSABLE_URL;
  if (!raw) return fail('PAYMENT_PG_DISPOSABLE_URL is required; DATABASE_URL and DIRECT_URL are never used as the test target.');
  let url;
  try { url = new URL(raw); } catch { return fail('PAYMENT_PG_DISPOSABLE_URL is not a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) return fail('The disposable target must be a PostgreSQL URL.');
  const lowered = `${url.hostname} ${decodeURIComponent(url.username)} ${url.pathname}`.toLowerCase();
  if (FORBIDDEN_TARGET_TEXT.some(text => lowered.includes(text))) return fail('A hosted, DEV or PROD identity is prohibited as a disposable target.');
  if (!LOOPBACK_HOSTS.has(url.hostname)) return fail('The disposable target must be a loopback host.');
  if ([...url.searchParams].length > 0) return fail('The disposable URL must not carry query options; the runner sets them.');
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return fail('The disposable target needs an explicit port between 1024 and 65535.');
  if (decodeURIComponent(url.username) !== 'postgres') return fail('The disposable target must authenticate as the instance owner role postgres.');
  const database = url.pathname.replace(/^\//, '');
  if (!DATABASE_NAME.test(database)) return fail('The database name must start with electrohub_ci or electrohub_disposable.');
  if (env.PAYMENT_PG_DISPOSABLE_AUTHORIZATION !== expectedAuthorization(database, scope)) {
    return fail('PAYMENT_PG_DISPOSABLE_AUTHORIZATION does not match the exact database, scenario set and cleanup scope.');
  }
  const caFile = env.PAYMENT_PG_DISPOSABLE_CA_FILE;
  if (!caFile || !path.isAbsolute(caFile)) return fail('PAYMENT_PG_DISPOSABLE_CA_FILE must be an absolute path to the per-run CA certificate.');
  let caPem;
  try { caPem = read(caFile, 'utf8'); } catch { return fail('The per-run CA file cannot be read.'); }
  const caError = inspectCa(caPem, now);
  if (caError) return fail(caError);
  if (Object.entries(env).some(([name, value]) => /stripe/i.test(name) && typeof value === 'string' && LIVE_STRIPE.test(value))) {
    return fail('Live Stripe configuration is present; the PostgreSQL suites refuse to start.');
  }
  if (scanFiles && scanEnvFilesForLiveStripe(read)) return fail('Live Stripe configuration is present in an env file; the PostgreSQL suites refuse to start.');
  return { config: { url: url.toString(), host: url.hostname, port, database, caFile, caPem, password: decodeURIComponent(url.password) } };
}

/** Base URL (no query) -> URL with the run schema pinned for the application's Prisma client and PostgreSQL. */
function runUrl(config, schema) {
  const url = new URL(config.url);
  url.searchParams.set('schema', schema);
  // A side schema needs search_path pinned; `public` is Prisma's default, and the app's database-target guard rejects `options`.
  if (schema !== 'public') url.searchParams.set('options', `-csearch_path=${schema}`);
  url.searchParams.set('connection_limit', '4');
  return url.toString();
}

/**
 * URL for Prisma's native schema engine (CLI): strict TLS verified against the per-run CA, one connection, short timeouts.
 * Prisma 6.12's native connector reads `sslcert` as the trusted root. `schema` is 'public' for runs that use the public schema.
 */
function strictCliUrl(config, schema) {
  const url = new URL(config.url);
  url.searchParams.set('schema', schema);
  url.searchParams.set('sslmode', 'require');
  url.searchParams.set('sslaccept', 'strict');
  url.searchParams.set('sslcert', config.caFile);
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('connect_timeout', '5');
  url.searchParams.set('pool_timeout', '5');
  url.searchParams.set('socket_timeout', '30');
  if (schema !== 'public') url.searchParams.set('options', `-csearch_path=${schema}`);
  return url.toString();
}

/**
 * Read-only probe executed by Prisma's native engine: fails (division by zero) unless the engine's own session is on TLS, in the
 * proved database, on the expected schema. Only validated identifiers are embedded.
 */
function probeSql(database, schema) {
  if (!DATABASE_NAME.test(database) || !(schema === 'public' || /^pgrun_[a-f0-9]{12}$/.test(schema))) throw failure('PROBE_IDENTIFIER_INVALID');
  return `BEGIN READ ONLY;
SELECT 1 / CASE WHEN current_database() = '${database}'
  AND current_schema() = '${schema}'
  AND (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid())
  THEN 1 ELSE 0 END;
ROLLBACK;
`;
}

function writeProbeFile(database, schema, write = fs.writeFileSync, tmp = os.tmpdir(), random = crypto.randomBytes) {
  const file = path.join(tmp, `electrohub-pg-probe-${random(6).toString('hex')}.sql`);
  write(file, probeSql(database, schema), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return file;
}

function createClient(config) {
  const { Client } = require('pg');
  const url = new URL(config.url);
  return new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000, query_timeout: 15000,
    statement_timeout: 15000, lock_timeout: 5000, ssl: { ca: config.caPem, rejectUnauthorized: true } });
}

/**
 * Server-side proof that the connected instance is a dedicated, fresh disposable PostgreSQL 17. The client must have
 * connected with certificate verification against the per-run CA. `allowedSchema` is the run schema (null before provisioning).
 * With `allowedSchema === 'public'` (after migration) the repository's own migration schemas and NOLOGIN roles are tolerated;
 * nothing else is.
 * Throws failure(label) on any unmet condition; returns a small sanitized summary.
 */
async function verifyDisposableServer(client, { expectedDatabase, allowedSchema = null } = {}) {
  let row;
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query(`
      SELECT current_database() AS db, current_user AS usr, current_setting('server_version') AS version,
        (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl,
        (SELECT count(*)::int FROM pg_database WHERE datname NOT IN ('postgres', 'template0', 'template1', current_database())) AS other_databases,
        (SELECT count(*)::int FROM pg_roles WHERE rolname !~ '^pg_' AND rolname <> current_user
          AND NOT ($4::boolean AND rolname = ANY($5::text[]) AND NOT rolcanlogin AND NOT rolsuper)) AS other_roles,
        (SELECT count(*)::int FROM pg_roles WHERE rolname = ANY($1::text[])) AS platform_roles,
        (SELECT count(*)::int FROM pg_namespace WHERE nspname = ANY($2::text[]) AND NOT ($4::boolean AND nspname = ANY($6::text[]))) AS platform_schemas,
        (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S') AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
            AND ($3::text IS NULL OR n.nspname <> $3::text) AND NOT ($4::boolean AND n.nspname = ANY($6::text[]))) AS foreign_relations`,
    [PLATFORM_ROLES, PLATFORM_SCHEMAS, allowedSchema, allowedSchema === 'public', MIGRATION_ROLES, MIGRATION_SCHEMAS]);
    row = result.rows[0];
    await client.query('ROLLBACK');
  } catch {
    throw failure('DISPOSABLE_PROOF_QUERY_FAILED');
  }
  if (!row || row.db !== expectedDatabase) throw failure('DISPOSABLE_DATABASE_MISMATCH');
  if (row.usr !== 'postgres') throw failure('DISPOSABLE_ROLE_MISMATCH');
  if (typeof row.version !== 'string' || !row.version.startsWith('17.')) throw failure('DISPOSABLE_NOT_POSTGRESQL_17');
  if (row.ssl !== true) throw failure('DISPOSABLE_TLS_NOT_ACTIVE');
  if (row.other_databases !== 0) throw failure('DISPOSABLE_NOT_A_DEDICATED_INSTANCE_DATABASES');
  if (row.other_roles !== 0) throw failure('DISPOSABLE_NOT_A_DEDICATED_INSTANCE_ROLES');
  if (row.platform_roles !== 0 || row.platform_schemas !== 0) throw failure('DISPOSABLE_LOOKS_LIKE_A_HOSTED_PLATFORM');
  if (row.foreign_relations !== 0) throw failure('DISPOSABLE_NOT_FRESH');
  return { database: row.db, version: row.version };
}

/** Marks the (disposable) database itself; the marker comment is the run's ownership record for cleanup. */
async function markDatabase(client, database, marker) {
  if (!DATABASE_NAME.test(database) || !/^electrohub-disposable-run:[a-f0-9]{12}$/.test(marker)) throw failure('MARKER_INVALID');
  await client.query(`COMMENT ON DATABASE ${quoteIdentifier(database)} IS '${marker}'`);
}

/**
 * Returns the proved disposable instance to its fresh, empty state after a run (Task 06.1 R-7). Connects to the instance's
 * `postgres` maintenance database, refuses unless the run database still carries THIS run's marker, then drops and recreates
 * it (removing every migrated schema, including `ai` / `extensions`) and drops only the NOLOGIN roles the repository's own
 * migrations create. Verifies the result: the database exists unmarked and none of those roles remain.
 */
async function resetRunDatabase(config, { marker }, { create = createClient } = {}) {
  if (!DATABASE_NAME.test(config.database) || !/^electrohub-disposable-run:[a-f0-9]{12}$/.test(marker ?? '')) throw failure('CLEANUP_IDENTITY_INVALID');
  const maintenance = new URL(config.url);
  maintenance.pathname = '/postgres';
  const client = create({ ...config, url: maintenance.toString() });
  await client.connect();
  try {
    const found = await client.query(`SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = $1`, [config.database]);
    if (found.rowCount !== 1) throw failure('CLEANUP_DATABASE_ABSENT');
    if (found.rows[0].marker !== marker) throw failure('CLEANUP_MARKER_MISMATCH');
    await client.query(`DROP DATABASE ${quoteIdentifier(config.database)} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${quoteIdentifier(config.database)}`);
    const roles = (await client.query('SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[]) AND NOT rolcanlogin AND NOT rolsuper',
      [MIGRATION_ROLES])).rows.map(row => row.rolname);
    for (const role of roles) await client.query(`DROP ROLE ${quoteIdentifier(role)}`);
    const after = await client.query(`SELECT
        (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = $1) AS marker,
        (SELECT count(*)::int FROM pg_database WHERE datname = $1) AS databases,
        (SELECT count(*)::int FROM pg_roles WHERE rolname = ANY($2::text[])) AS roles`, [config.database, MIGRATION_ROLES]);
    const row = after.rows[0];
    if (!row || row.databases !== 1 || row.marker !== null || row.roles !== 0) throw failure('CLEANUP_NOT_VERIFIED');
    return 'reset';
  } finally {
    try { await client.end(); } catch { /* connection already closed */ }
  }
}

/** Strict verification of the vitest JSON report: both files, every scenario once, all passed, nothing skipped. */
function verifyReport(stdout, root = backendRoot, suite = SUITES['scenarios-A-S']) {
  const start = stdout.search(/\{\s*"numTotalTestSuites"\s*:/);
  let report;
  try { report = JSON.parse(stdout.slice(start)); } catch { throw failure('TEST_REPORT_INVALID'); }
  const files = report.testResults;
  const total = suite.scenarios.length;
  if (start < 0 || report.success !== true || report.numTotalTests !== total || report.numPassedTests !== total ||
      report.numFailedTests !== 0 || report.numPendingTests !== 0 || report.numTodoTests !== 0 ||
      !Array.isArray(files) || files.length !== suite.files.length) throw failure('TESTS_FAILED_SKIPPED_OR_WRONG_SELECTION');
  const expectedNames = new Set(suite.files.map(file => path.resolve(root, file)));
  if (!files.every(file => expectedNames.has(path.resolve(file.name)))) throw failure('TEST_SELECTION_MISMATCH');
  const results = files.flatMap(file => file.assertionResults ?? []);
  if (results.length !== total || results.some(test => test.status !== 'passed')) throw failure('TESTS_FAILED_SKIPPED_OR_WRONG_SELECTION');
  const letters = results.map(test => test.title?.match(/^([A-Z]) — /)?.[1]);
  if (new Set(letters).size !== total || letters.includes(undefined) || letters.some(letter => !suite.scenarios.includes(letter))) {
    throw failure('TEST_SCENARIOS_MISSING');
  }
  return { passed: total, failed: 0, skipped: 0 };
}

/**
 * Terminates a child AND everything it started. POSIX children lead their own process group (detached) and the whole
 * group is killed; on Windows `taskkill /T /F` kills the tree. Returns true when the platform call reported success.
 */
function killTree(child, { platform = process.platform, spawnSyncFn = spawnSync, kill = process.kill.bind(process) } = {}) {
  if (!child || !child.pid) return false;
  try {
    if (platform === 'win32') {
      const result = spawnSyncFn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      return result.status === 0 || result.status === 128; // 128: the process had already exited
    }
    kill(-child.pid, 'SIGKILL');
    return true;
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    return false;
  }
}

/** POSIX only: true while any process of the child's group is alive. Windows relies on taskkill tree semantics. */
function groupAlive(pid, { platform = process.platform, kill = process.kill.bind(process) } = {}) {
  if (platform === 'win32') return false;
  try { kill(-pid, 0); return true; } catch (error) { return error?.code !== 'ESRCH'; }
}

/**
 * Platform-neutral bounded child process. Resolves { stdout }. Rejects with failure(label); `treeStopped` is false only
 * when termination of the whole tree could not be confirmed, in which case the caller must NOT clean up (ownership is uncertain).
 */
function runStage(stage, { spawnChild = spawn, signal, graceMs = 5000, platform = process.platform, kill, killTreeFn = killTree } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let bytes = 0;
    let reason = null;
    let child;
    let terminationTimer;
    if (signal?.aborted) { reject(failure('OWNER_CANCELED')); return; }
    try {
      child = spawnChild(process.execPath, stage.args, { cwd: backendRoot, env: stage.env, stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true, detached: platform !== 'win32' });
    } catch { reject(failure('CHILD_START_FAILED')); return; }
    const terminate = label => {
      if (reason) return;
      reason = label;
      killTreeFn(child);
      terminationTimer = setTimeout(() => {
        cleanup();
        reject(failure('CHILD_TERMINATION_UNCONFIRMED', false));
      }, graceMs);
    };
    const onAbort = () => terminate('OWNER_CANCELED');
    const timer = setTimeout(() => terminate('CHILD_TIMEOUT'), stage.timeoutMs);
    const cleanup = () => { clearTimeout(timer); clearTimeout(terminationTimer); signal?.removeEventListener('abort', onAbort); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const consume = collect => chunk => {
      bytes += chunk.length;
      if (bytes > 4 * 1024 * 1024) { terminate('CHILD_OUTPUT_LIMIT'); return; }
      if (collect) stdout += chunk.toString('utf8');
    };
    child.stdout.on('data', consume(true));
    child.stderr.on('data', consume(false)); // Raw child errors are never forwarded.
    child.once('error', () => { cleanup(); reject(failure('CHILD_START_FAILED')); });
    child.once('close', code => {
      // The leader exited. Descendants may remain: make sure the group is gone before any outcome is reported.
      const finish = () => {
        cleanup();
        if (reason) reject(failure(reason));
        else if (code !== 0) reject(Object.assign(failure(`CHILD_NONZERO_EXIT_${stage.name.toUpperCase()}`), { stdout }));
        else resolve({ stdout });
      };
      if (!child.pid || !groupAlive(child.pid, { platform, kill })) { finish(); return; }
      killTreeFn(child);
      setTimeout(() => {
        if (groupAlive(child.pid, { platform, kill })) { cleanup(); reject(failure('CHILD_TERMINATION_UNCONFIRMED', false)); }
        else finish();
      }, 500);
    });
  });
}

function stageDefinitions(config, identity, env = process.env, { probeFile, scope = 'scenarios-A-S' } = {}) {
  const suite = SUITES[scope];
  if (!suite) throw failure('AUTHORIZATION_SCOPE_UNKNOWN');
  const common = { ...scrubbedEnvironment(env), NODE_ENV: 'test', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: 'whsec_local_signature_fixture_only',
    ELECTROHUB_SQL_DIAGNOSTICS: '0', NODE_EXTRA_CA_CERTS: config.caFile };
  const cliUrl = strictCliUrl(config, identity.schema);
  const prismaCli = path.join(backendRoot, 'node_modules/prisma/build/index.js');
  const testUrl = runUrl(config, identity.schema);
  const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  return [
    { name: 'migration_tls', timeoutMs: 60_000, args: [prismaCli, 'db', 'execute', '--schema', 'prisma/schema.prisma', '--file', probeFile ?? ''],
      env: { ...common, DATABASE_URL: cliUrl, DIRECT_URL: cliUrl } },
    { name: 'migration', timeoutMs: 180_000, args: [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      env: { ...common, DATABASE_URL: cliUrl, DIRECT_URL: cliUrl } },
    { name: 'tests', timeoutMs: 600_000, args: [vitest, 'run', '--pool=forks', '--maxWorkers=1', '--no-file-parallelism', ...suite.files,
      '--config', CONFIG_FILE, '--reporter=json', '--testTimeout=60000', '--hookTimeout=60000'],
    env: { ...common, DATABASE_URL: testUrl, DIRECT_URL: testUrl, PAYMENT_PG_TEST_DATABASE_URL: testUrl, PAYMENT_PG_TEST_INTERNAL_RUN: 'disposable',
      PAYMENT_PG_DISPOSABLE_URL: config.url, PAYMENT_PG_DISPOSABLE_CA_FILE: config.caFile, PAYMENT_PG_DISPOSABLE_APPROVED: 'true',
      PAYMENT_PG_DISPOSABLE_AUTHORIZATION: expectedAuthorization(config.database, scope), PAYMENT_PG_DISPOSABLE_SCOPE: scope,
      PAYMENT_PG_DISPOSABLE_SCHEMA: identity.schema,
      PAYMENT_PG_DISPOSABLE_RUN_ID: identity.runId } },
  ];
}

/** `--scope=scenarios-A-J` / `--scope=scenarios-A-Y` / `--scope=scenarios-A-Z` select those suites; the default stays A–S. Only suites with their own scope are accepted. */
function selectedScope(argv) {
  const option = argv.find(arg => arg.startsWith('--scope='));
  const scope = option ? option.slice('--scope='.length) : 'scenarios-A-S';
  return SUITES[scope] ? scope : null;
}

async function main(argv = process.argv.slice(2)) {
  const scope = selectedScope(argv);
  if (!scope) { console.error('BLOCKED: unknown --scope; use scenarios-A-S, scenarios-A-J, scenarios-A-Y or scenarios-A-Z.'); process.exitCode = 2; return; }
  const suite = SUITES[scope];
  const validated = validateConfiguration(process.env, { scope });
  if (validated.error) { console.error(`BLOCKED: ${validated.error}`); process.exitCode = 2; return; }
  const { config } = validated;
  if (argv.includes('--check-config')) {
    console.log('CONFIG PASS: loopback target, database name, exact authorization and per-run CA proof; no database connection made.');
    return;
  }
  if (!argv.includes('--run')) { console.error('BLOCKED: pass --run for the authorized disposable run or --check-config for offline validation.'); process.exitCode = 2; return; }

  const identity = newRunIdentity();
  const client = createClient(config);
  const owner = new AbortController();
  const onSignal = () => owner.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  let provisioned = false;
  let failed = false;
  let treeStopped = true;
  let probeFile = null;
  let clientEnded = false;
  try {
    await client.connect();
    const proof = await verifyDisposableServer(client, { expectedDatabase: config.database });
    console.log(`DISPOSABLE TARGET PROVED: PostgreSQL ${proof.version}, database ${proof.database}, verified TLS, dedicated and empty.`);
    await markDatabase(client, config.database, identity.marker);
    provisioned = true;
    probeFile = writeProbeFile(config.database, identity.schema);
    for (const stage of stageDefinitions(config, identity, process.env, { probeFile, scope })) {
      const result = await runStage(stage, { signal: owner.signal });
      if (stage.name === 'tests') {
        if (process.env.PAYMENT_PG_DISPOSABLE_REPORT_FILE) fs.writeFileSync(process.env.PAYMENT_PG_DISPOSABLE_REPORT_FILE, result.stdout, 'utf8');
        verifyReport(result.stdout, backendRoot, suite);
      }
      console.log(`${stage.name.toUpperCase()} PASS`);
    }
    console.log(`DISPOSABLE SUITE PASS: ${suite.scenarios.length} scenarios (${scope.slice('scenarios-'.length)}) passed on real PostgreSQL (database ${config.database}, schema ${identity.schema}).`);
  } catch (error) {
    failed = true;
    if (error && error.treeStopped === false) treeStopped = false;
    // Owner-requested evidence: the child's JSON report (test titles, assertion messages) is kept even when the stage fails.
    if (process.env.PAYMENT_PG_DISPOSABLE_REPORT_FILE && typeof error?.stdout === 'string') {
      try { fs.writeFileSync(process.env.PAYMENT_PG_DISPOSABLE_REPORT_FILE, error.stdout, 'utf8'); } catch { /* evidence only */ }
    }
    console.error(`SUITE FAIL: ${error && error.label ? error.label : 'EXECUTION_FAILED'}`);
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    if (probeFile && treeStopped) { try { fs.rmSync(probeFile, { force: true }); } catch { /* temp probe only */ } }
    if (provisioned && !treeStopped) {
      // Ownership of live processes is uncertain: never drop anything. The marker identifies the residue for the owner.
      console.error(`CLEANUP SKIPPED: child termination could not be confirmed; database ${config.database} (marker ${identity.marker}) keeps the run's objects.`);
    } else if (provisioned) {
      try {
        clientEnded = true;
        try { await client.end(); } catch { /* the reset terminates every session on the run database anyway */ }
        const result = await resetRunDatabase(config, identity);
        console.log(`CLEANUP PASS: run database ${result}.`);
      } catch (error) {
        failed = true;
        console.error(`CLEANUP FAIL: ${error && error.label ? error.label : 'CLEANUP_FAILED'}; the run database may keep its objects.`);
      }
    }
    if (!clientEnded) { try { await client.end(); } catch { /* connection already closed */ } }
  }
  if (failed) process.exitCode = 1;
}

module.exports = { SCENARIOS, TEST_FILES, SUITES, selectedScope, AUTH_SCOPES, markDatabase, strictCliUrl, probeSql, writeProbeFile, expectedAuthorization, inspectCa, validateConfiguration, runUrl, newRunIdentity, createClient,
  verifyDisposableServer, resetRunDatabase, MIGRATION_ROLES, MIGRATION_SCHEMAS, verifyReport, runStage, killTree, groupAlive, scrubbedEnvironment,
  stageDefinitions, quoteIdentifier, failure };

if (require.main === module) main().catch(() => { console.error('FATAL: DISPOSABLE_RUNNER_FAILED'); process.exitCode = 1; });
