#!/usr/bin/env node
/**
 * Isolated local payment development (Task 03.6). Shared DEV is deliberately payment-write-disabled for the watched dev server
 * (src/payment-isolation.ts), so local checkout, Try Again, Remove and Cancel purchase need a DISPOSABLE database. This script provisions and
 * runs one, and fails closed unless every database URL is a verified disposable loopback target.
 *
 *   PG_BIN=<dir containing initdb, pg_ctl, createdb, psql> (PostgreSQL 17)
 *   ISOLATED_PG_DOCKER=1  (Task 04.2) run the disposable cluster as the pinned pgvector image in WSL Docker instead of the Windows
 *                         binaries (visual search needs the pgvector extension). State lives in apps/backend/.isolated-docker; PG_BIN is
 *                         then only used for the psql client. Same port, verified TLS, scram and identity checks.
 *   node scripts/dev-isolated.cjs init       create cluster (TLS, scram, loopback), database, schema (migrate deploy), fixtures
 *   node scripts/dev-isolated.cjs start-db   start the disposable cluster
 *   node scripts/dev-isolated.cjs stop-db    stop it (data kept in apps/backend/.isolated)
 *   node scripts/dev-isolated.cjs status     show identity checks
 *   node scripts/dev-isolated.cjs backend    run the watched backend against it (PORT, default 5200) AND the commerce email worker (Task 03.8)
 *   node scripts/dev-isolated.cjs backend --real-email
 *                                            same, but send real Brevo emails to the approved COMMERCE_EMAIL_ALLOWED_RECIPIENTS only
 *   node scripts/dev-isolated.cjs backend --real-email --all-recipients
 *                                            general transactional sending (send mode `live`, allowed only because the target is disposable):
 *                                            every eligible account's own email, no allowlist. Refuses when more than 10 sendable events are
 *                                            already pending, so starting it can never blast a backlog.
 *   node scripts/dev-isolated.cjs migrate    apply pending repository migrations to the disposable database (also done by `backend`)
 *   node scripts/dev-isolated.cjs captured   list emails captured by the default (capture) mode
 *   node scripts/dev-isolated.cjs restore-recipient   put the fixture customer back on its original address
 *   node scripts/dev-isolated.cjs use-real-recipient <approved address>
 *                                            point the fixture customer at an approved address (must be in COMMERCE_EMAIL_ALLOWED_RECIPIENTS)
 *
 * Never touches shared DEV/PROD: every database action targets the URL written by `init`, re-verified before use. The Stripe key comes from
 * the app's own configuration (.env); the SDK refuses any non-test key, so every checkout here creates Stripe TEST MODE PaymentIntents only.
 */
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');
const emailDev = require('./lib/commerce-email-dev.cjs');

const backend = path.resolve(__dirname, '..');
const dockerMode = process.env.ISOLATED_PG_DOCKER === '1';
const home = path.join(backend, dockerMode ? '.isolated-docker' : '.isolated');
// Pinned image (pgvector 0.8.0 on PostgreSQL 17) and WSL distribution for the Docker mode.
const docker = { image: 'pgvector/pgvector:0.8.0-pg17', container: 'electrohub-isolated-pgvector',
  volume: 'electrohub-isolated-pgvector-data', distro: process.env.ISOLATED_WSL_DISTRO || 'Ubuntu' };
const port = Number(process.env.ISOLATED_PG_PORT || 55434);
const database = 'electrohub_disposable';
const files = { data: path.join(home, 'data'), certs: path.join(home, 'certs'), password: path.join(home, 'password.txt'),
  env: path.join(home, 'env.json'), credentials: path.join(home, 'fixture-credentials.txt'), logs: path.join(home, 'logs'), pglog: path.join(home, 'postgres.log'), capture: path.join(home, 'email-capture'), recipientSwitch: path.join(home, 'recipient-switch.json') };
const FIXTURE_CUSTOMER = 'customer@isolated.electrohub.test';
const fail = message => { console.error(`dev-isolated: ${message}`); process.exit(1); };
const bin = name => {
  if (!process.env.PG_BIN) fail('Set PG_BIN to the directory containing the PostgreSQL 17 binaries (initdb, pg_ctl, createdb, psql).');
  const file = path.join(process.env.PG_BIN, process.platform === 'win32' ? `${name}.exe` : name);
  if (!fs.existsSync(file)) fail(`${file} not found.`);
  return file;
};
const run = (file, args, extraEnv = {}, options = {}) => execFileSync(file, args, { encoding: 'utf8', stdio: options.stdio ?? 'pipe',
  env: { ...process.env, MSYS_NO_PATHCONV: '1', ...extraEnv }, cwd: options.cwd ?? backend, shell: options.shell ?? false });
// npx is a .cmd shim on Windows, which only a shell can launch (arguments here are fixed and contain no spaces).
const npx = (args, extraEnv) => run(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, extraEnv, { stdio: 'inherit', shell: process.platform === 'win32' });

/** Resolves the same development-file precedence as src/config/env.ts without printing any values. */
function applicationEnvironment(source = process.env, readFile = name => {
  const file = path.join(backend, name);
  return fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
}) {
  return { ...readFile('.env'), ...readFile('.env.local'), ...source };
}
function testStripeKeyError(environment) {
  const raw = String(environment.STRIPE_SECRET_KEY ?? '');
  const key = raw.trim();
  if (raw !== key) return 'isolated backend requires a Stripe Test Mode secret key. Nothing was started.';
  if (!key || /^(?:sk|rk)_test_[A-Za-z0-9]+$/.test(key)) return null;
  return 'isolated backend requires a Stripe Test Mode secret key. Nothing was started.';
}
function childEnvironment(isolated, mail, extra = {}, source = process.env) {
  const environment = { ...source, ...isolated, ...mail, ...extra };
  // Never pass reusable payment approval or supervisor state into an isolated process. Blank values also
  // prevent dotenv in the child from restoring a stale approval from .env or .env.local.
  for (const name of Object.keys(environment)) {
    if (name === 'PAYMENT_SHARED_MUTATIONS_APPROVED' ||
      /^(?:PAYMENT|ELECTROHUB)_.*(?:SUPERVISOR|ATTESTATION|APPROVAL|APPROVED|AUTHORIZATION)(?:_|$)/i.test(name)) environment[name] = '';
  }
  environment.PAYMENT_SHARED_MUTATIONS_APPROVED = '';
  environment.PAYMENT_DEV_SUPERVISED = '';
  // Task 04.1: never inherit the MAIN DEV AI service target or credential. Isolated QA reaches an AI service only through
  // explicit ISOLATED_AI_SERVICE_* values (its own instance and key), bound to the 'qa' environment; otherwise AI stays
  // disabled. Blank values also stop dotenv in the child from restoring the DEV values from .env or .env.local.
  environment.AI_SERVICE_URL = source.ISOLATED_AI_SERVICE_URL ?? '';
  environment.AI_SERVICE_API_KEY = source.ISOLATED_AI_SERVICE_API_KEY ?? '';
  environment.AI_SERVICE_ENVIRONMENT = 'qa';
  environment.AI_SERVICE_TIMEOUT_MS = source.ISOLATED_AI_SERVICE_TIMEOUT_MS ?? '';
  environment.AI_IMAGE_SEARCH_TIMEOUT_MS = source.ISOLATED_AI_IMAGE_SEARCH_TIMEOUT_MS ?? '';
  return environment;
}

function isolatedRuntimeSecrets() {
  const file = path.join(home, 'runtime-secrets.json');
  if (!fs.existsSync(file)) {
    const values = Object.fromEntries(['JWT_SECRET', 'JWT_REFRESH_SECRET', 'OTP_HASH_SECRET'].map(key => [key, crypto.randomBytes(48).toString('hex')]));
    fs.writeFileSync(file, JSON.stringify(values), { flag: 'wx', mode: 0o600 });
  }
  const values = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!['JWT_SECRET', 'JWT_REFRESH_SECRET', 'OTP_HASH_SECRET'].every(key => /^[a-f0-9]{96}$/.test(values[key] ?? ''))) {
    fail('isolated runtime secrets are invalid; existing file retained. Nothing was started.');
  }
  return values;
}

// Require the exact local cluster initialized by this launcher. A loopback URL alone can still target a
// different local PostgreSQL instance or a local tunnel, so it is not sufficient evidence of isolation.
function disposableUrlIssue(url, expectedPassword = fs.existsSync(files.password) ? fs.readFileSync(files.password, 'utf8').trim() : '') {
  let parsed;
  try {
    parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.hash) return 'database URL must use PostgreSQL without fragments';
    for (const key of parsed.searchParams.keys()) {
      if (key !== 'sslmode' || parsed.searchParams.getAll(key).length !== 1 || parsed.searchParams.get(key) !== 'verify-full') {
        return 'database URL options cannot override the pinned endpoint or TLS policy';
      }
    }
    if (parsed.hostname.toLowerCase() !== 'localhost' || Number(parsed.port || 5432) !== port || name !== database ||
      decodeURIComponent(parsed.username) !== 'postgres' || !expectedPassword || decodeURIComponent(parsed.password) !== expectedPassword) {
      return 'database target must match the launcher-owned disposable cluster';
    }
    return null;
  } catch { return 'database URL is malformed'; }
}
function assertDisposable(url) {
  const issue = disposableUrlIssue(url);
  if (issue) fail(issue);
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port}/${decodeURIComponent(parsed.pathname.replace(/^\//, ''))}`;
}
function databaseUrlsIssue(env, expectedPassword) {
  for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
    const issue = disposableUrlIssue(env[name], expectedPassword);
    if (issue) return `${name}: ${issue}`;
  }
  const identity = url => {
    const parsed = new URL(url);
    return `${parsed.hostname.toLowerCase()}/${Number(parsed.port || 5432)}/${decodeURIComponent(parsed.pathname.replace(/^\//, ''))}/${decodeURIComponent(parsed.username)}`;
  };
  if (identity(env.DATABASE_URL) !== identity(env.DIRECT_URL)) return 'DATABASE_URL and DIRECT_URL must identify the same isolated cluster.';
  return null;
}
function assertDatabaseUrls(env) {
  const issue = databaseUrlsIssue(env);
  if (issue) fail(issue);
}
function config() {
  if (!fs.existsSync(files.env)) fail('not initialised; run `node scripts/dev-isolated.cjs init` first.');
  const env = JSON.parse(fs.readFileSync(files.env, 'utf8'));
  assertDatabaseUrls(env);
  return env;
}
/** Proves identity over verified TLS before any use: database name, port, and SSL in use. */
function verifyIdentity(env) {
  const out = run(bin('psql'), ['-h', 'localhost', '-p', String(port), '-U', 'postgres', '-d', database, '-At', '-c',
    'select current_database() || \'|\' || inet_server_port() || \'|\' || ssl from pg_stat_ssl where pid = pg_backend_pid()'],
  { PGPASSWORD: fs.readFileSync(files.password, 'utf8').trim(), PGSSLMODE: 'verify-full', PGSSLROOTCERT: env.DB_SSL_CA_CERT_PATH }).trim();
  // psql renders the boolean as `t` (older) or `true` (PostgreSQL 17).
  if (out !== `${database}|${port}|t` && out !== `${database}|${port}|true`) fail(`identity check failed (${out})`);
  return out;
}

/** Runs a docker command inside WSL as root (the daemon socket is root-owned there). Arguments never contain secrets. */
function wslDocker(args, options = {}) { return run('wsl', ['-d', docker.distro, '-u', 'root', '--', 'docker', ...args], {}, options); }
function toWslPath(windowsPath) { return run('wsl', ['-d', docker.distro, '--', 'wslpath', '-a', windowsPath.replace(/\\/g, '/')]).trim(); }
function createDockerCluster() {
  // PostgreSQL requires a postgres-owned 0600 key, which a Windows bind mount cannot express, so the entrypoint copies the launcher's
  // certificate and key into the container, then starts PostgreSQL with TLS on the launcher port (the identity check reads that port).
  const prepare = 'install -d -o postgres -m 700 /var/lib/postgresql/tls && ' +
    'install -o postgres -m 600 /isolated/certs/server.key /var/lib/postgresql/tls/server.key && ' +
    'install -o postgres -m 644 /isolated/certs/server.crt /var/lib/postgresql/tls/server.crt && ' +
    `exec docker-entrypoint.sh postgres -c port=${port} -c ssl=on -c ssl_cert_file=/var/lib/postgresql/tls/server.crt ` +
    '-c ssl_key_file=/var/lib/postgresql/tls/server.key';
  wslDocker(['run', '-d', '--name', docker.container, '-p', `${port}:${port}`, '-v', `${docker.volume}:/var/lib/postgresql/data`,
    '-v', `${toWslPath(home)}:/isolated:ro`, '-e', 'POSTGRES_PASSWORD_FILE=/isolated/password.txt', '-e', `POSTGRES_DB=${database}`,
    '-e', `PGPORT=${port}`, '-e', 'POSTGRES_INITDB_ARGS=--auth=scram-sha-256', '-e', 'POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
    '--entrypoint', 'bash', docker.image, '-c', prepare]);
}
/**
 * WSL stops an idle distribution (and with it the container) once no wsl.exe session is attached, so a detached `docker logs -f`
 * keeps one session open for as long as the container runs and doubles as the server log.
 */
function keepDockerAlive() {
  const pidFile = path.join(home, 'keepalive.pid');
  if (fs.existsSync(pidFile)) {
    try { process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 0); return; } catch { /* stale */ }
  }
  const log = fs.openSync(files.pglog, 'a');
  const child = spawn('wsl', ['-d', docker.distro, '-u', 'root', '--', 'docker', 'logs', '-f', '--since', '1s', docker.container],
    { detached: true, stdio: ['ignore', log, log], windowsHide: true });
  child.unref();
  fs.writeFileSync(pidFile, String(child.pid));
}
function waitForDatabase() {
  keepDockerAlive();
  const password = fs.readFileSync(files.password, 'utf8').trim();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      run(bin('psql'), ['-h', 'localhost', '-p', String(port), '-U', 'postgres', '-d', database, '-At', '-c', 'select 1'], { PGPASSWORD: password, PGSSLMODE: 'require' });
      return;
    } catch { execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 1000)']); }
  }
  fail('the disposable pgvector container did not accept connections within 60 seconds.');
}

function init() {
  // An interrupted init (cluster and env.json created, schema/fixtures not yet) resumes at provisioning instead of refusing.
  if (fs.existsSync(files.data) && fs.existsSync(files.env) && !fs.existsSync(files.credentials)) {
    const env = config(); startDb(); console.log(`identity: ${verifyIdentity(env)}`); return provision(env);
  }
  if (fs.existsSync(files.data)) fail(`${files.data} already exists; it is kept. Use start-db, or remove the folder deliberately to start over.`);
  fs.mkdirSync(files.certs, { recursive: true }); fs.mkdirSync(files.logs, { recursive: true });
  const password = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(files.password, password, { mode: 0o600 });
  // Per-environment CA and server certificate for localhost only (the runtime always requires verified TLS).
  const openssl = (...args) => run('openssl', args, {}, { cwd: files.certs });
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365', '-subj', '/CN=electrohub-isolated-ca', '-keyout', 'ca.key', '-out', 'ca.crt');
  openssl('req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', 'server.key', '-out', 'server.csr');
  fs.writeFileSync(path.join(files.certs, 'san.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\n');
  openssl('x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '365', '-out', 'server.crt', '-extfile', 'san.cnf');
  if (dockerMode) {
    fs.mkdirSync(files.data, { recursive: true }); // marker: this launcher owns the container and its volume
    createDockerCluster();
    waitForDatabase();
  } else {
  run(bin('initdb'), ['-D', files.data, '-U', 'postgres', '--auth=scram-sha-256', `--pwfile=${files.password}`, '-E', 'UTF8']);
  // Relative to the data directory: PostgreSQL on Windows cannot open absolute paths containing non-ASCII characters (the repository name has
  // an em dash), and relative paths keep the cluster relocatable.
  fs.appendFileSync(path.join(files.data, 'postgresql.conf'), `\nport = ${port}\nlisten_addresses = '127.0.0.1'\nssl = on\n` +
    `ssl_cert_file = '../certs/server.crt'\nssl_key_file = '../certs/server.key'\n`);
  startDb();
  run(bin('createdb'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', database], { PGPASSWORD: password });
  }
  const url = `postgresql://postgres:${password}@localhost:${port}/${database}`;
  const env = { DATABASE_URL: url, DIRECT_URL: url, DB_SSL_CA_CERT_PATH: path.join(files.certs, 'ca.crt') };
  assertDisposable(url);
  fs.writeFileSync(files.env, JSON.stringify(env, null, 2), { mode: 0o600 });
  console.log(`identity: ${verifyIdentity(env)}`);
  provision(env);
}
/** Idempotent `prisma migrate deploy` against the VERIFIED disposable database only (a no-op when nothing is pending). */
function migrate(env = config()) {
  assertDatabaseUrls(env);
  verifyIdentity(env);
  const cliUrl = new URL(env.DATABASE_URL);
  cliUrl.searchParams.set('sslmode', 'disable');
  npx(['prisma', 'migrate', 'deploy'], { DATABASE_URL: cliUrl.toString(), DIRECT_URL: cliUrl.toString() });
}
function runVerifiedMigration(env, dependencies = {}) {
  (dependencies.startDatabase ?? startDb)();
  (dependencies.verify ?? verifyIdentity)(env);
  return (dependencies.apply ?? migrate)(env);
}
function provision(env) {
  // Isolated fixture provisioning (NOT a shared migration rollout): the repository schema into this disposable database only.
  migrate(env);
  // Test-only fixtures with generated credentials; never .env accounts or real customer data (seed guard requires a disposable target).
  const customer = 'customer@isolated.electrohub.test'; const admin = 'admin@isolated.electrohub.test';
  const customerPassword = `Iso-${crypto.randomBytes(8).toString('hex')}!`; const adminPassword = `Iso-${crypto.randomBytes(8).toString('hex')}!`;
  fs.writeFileSync(files.credentials, `customer=${customer}\ncustomer_password=${customerPassword}\nadmin=${admin}\nadmin_password=${adminPassword}\n`, { mode: 0o600 });
  npx(['tsx', 'prisma/seed.ts'], { ...env, NODE_ENV: 'development', CUSTOMER_EMAIL: customer, CUSTOMER_PASSWORD: customerPassword, ADMIN_EMAIL: admin,
    ADMIN_PASSWORD: adminPassword, ADMIN1_PASSWORD: adminPassword, ADMIN2_PASSWORD: adminPassword, ADMIN3_PASSWORD: adminPassword, ADMIN4_PASSWORD: adminPassword });
  console.log(`\nReady. Test sign-in credentials: ${files.credentials}\nNext: node scripts/dev-isolated.cjs backend`);
}
function startDb() {
  if (dockerMode) {
    let state = 'missing';
    try { state = wslDocker(['inspect', '-f', '{{.State.Running}}', docker.container]).trim(); } catch { /* no container */ }
    if (state === 'missing') fail('no disposable pgvector container; run `ISOLATED_PG_DOCKER=1 node scripts/dev-isolated.cjs init` first.');
    if (state !== 'true') wslDocker(['start', docker.container]);
    waitForDatabase();
    console.log(`disposable PostgreSQL (pgvector container) running on localhost:${port}`);
    return;
  }
  try { run(bin('pg_ctl'), ['-D', files.data, 'status']); console.log('disposable PostgreSQL already running'); return; } catch { /* not running */ }
  // Output detached: on Windows the server inherits pg_ctl's stdout, so a piped stdout would never close and this would wait forever.
  run(bin('pg_ctl'), ['-D', files.data, '-l', files.pglog, '-w', 'start'], {}, { stdio: 'ignore' });
  console.log(`disposable PostgreSQL started on 127.0.0.1:${port}`);
}
function stopDb() {
  if (dockerMode) {
    wslDocker(['stop', docker.container], { stdio: 'inherit' });
    const pidFile = path.join(home, 'keepalive.pid');
    if (fs.existsSync(pidFile)) { try { process.kill(Number(fs.readFileSync(pidFile, 'utf8'))); } catch { /* already gone */ } fs.unlinkSync(pidFile); }
    return;
  }
  run(bin('pg_ctl'), ['-D', files.data, '-m', 'fast', 'stop'], {}, { stdio: 'inherit' }); }
function status() { const env = config(); console.log(`target: ${assertDisposable(env.DATABASE_URL)}\nidentity: ${verifyIdentity(env)}`); }
/** Email switches from the app's own env files (never printed): only the approved-recipient list and the Brevo key's presence are needed here. */
function emailSettings() {
  const merged = applicationEnvironment();
  const allowed = String(merged.COMMERCE_EMAIL_ALLOWED_RECIPIENTS ?? '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  return { allowed, brevo: Boolean(merged.BREVO_API_KEY), origin: merged.COMMERCE_EMAIL_ORIGIN || merged.FRONTEND_URL || 'http://localhost:3000' };
}
function emailEnvironment(real, allRecipients) {
  const settings = emailSettings();
  if (allRecipients && !real) fail('--all-recipients needs --real-email. Nothing was started.');
  if (allRecipients && !settings.brevo) fail('--all-recipients needs BREVO_API_KEY (and BREVO_SENDER_EMAIL) in the app environment. Nothing was started.');
  if (allRecipients) return { COMMERCE_EMAIL_ENQUEUE_ENABLED: 'true', COMMERCE_EMAIL_DISPATCH_ENABLED: 'true', COMMERCE_EMAIL_SEND_MODE: 'live',
    COMMERCE_EMAIL_ALLOWED_RECIPIENTS: '', COMMERCE_EMAIL_ORIGIN: settings.origin };
  if (real && !settings.allowed.length) fail('--real-email needs COMMERCE_EMAIL_ALLOWED_RECIPIENTS (approved test mailboxes) in apps/backend/.env.local. Nothing was started.');
  if (real && !settings.brevo) fail('--real-email needs BREVO_API_KEY (and BREVO_SENDER_EMAIL) in the app environment. Nothing was started.');
  // Explicit values win over anything in .env.local (process.env takes precedence in src/config/env.ts), so the mode cannot drift.
  return real
    ? { COMMERCE_EMAIL_ENQUEUE_ENABLED: 'true', COMMERCE_EMAIL_DISPATCH_ENABLED: 'true', COMMERCE_EMAIL_SEND_MODE: 'allowlist',
        COMMERCE_EMAIL_ALLOWED_RECIPIENTS: settings.allowed.join(','), COMMERCE_EMAIL_ORIGIN: settings.origin }
    : { COMMERCE_EMAIL_ENQUEUE_ENABLED: 'true', COMMERCE_EMAIL_DISPATCH_ENABLED: 'true', COMMERCE_EMAIL_SEND_MODE: 'capture',
        COMMERCE_EMAIL_ALLOWED_RECIPIENTS: '', COMMERCE_EMAIL_CAPTURE_DIR: files.capture, COMMERCE_EMAIL_ORIGIN: settings.origin };
}
function isolatedBackendPort(raw = '5200') {
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1024 || port > 65535 || [3000, 5000, 3200].includes(port)) {
    throw new Error('use an isolated backend port (default 5200); MAIN DEV and frontend ports are reserved. Nothing was started.');
  }
  return String(port);
}
function startBackend() {
  // Check all effective sources before starting PostgreSQL, migrations, API, or workers. Process values
  // override .env.local, matching the application runtime's configuration precedence.
  const runtime = applicationEnvironment();
  const stripeError = testStripeKeyError(runtime);
  if (stripeError) fail(stripeError);
  let appPort;
  try { appPort = isolatedBackendPort(process.env.PORT || '5200'); } catch (error) { fail(error.message); }
  const env = config(); startDb();
  const identity = verifyIdentity(env);
  // The producer runs inside payment finalization, so the commerce email schema must exist before the API starts. Disposable database only.
  console.log('dev-isolated: applying any pending migrations to the disposable database (no-op when current)...');
  migrate(env);
  const real = process.argv.includes('--real-email');
  const allRecipients = process.argv.includes('--all-recipients');
  const stripeTestMode = process.argv.includes('--stripe-test-mode');
  const mail = emailEnvironment(real, allRecipients);
  if (allRecipients) {
    // Pending sendable work the live worker would pick up immediately (same 24h window as the dispatcher). Counts only, never addresses.
    const pending = Number(psqlUpdate(env, `SELECT count(*) FROM commerce_email_outbox WHERE "dispatchState" IN ('READY','RETRY_WAIT')
      AND "createdAt" > now() - interval '24 hours'`) || 0);
    console.log(`dev-isolated: ${pending} pending commerce email event(s) will be sent to their own account addresses.`);
    if (pending > 10) fail('more than 10 pending events: refusing general sending so a backlog is never blasted. Review the queue first. Nothing was started.');
  }
  console.log(`dev-isolated: database ${assertDisposable(env.DATABASE_URL)} verified (${identity}); backend on :${appPort}.`);
  console.log(`dev-isolated: Stripe provider ${stripeTestMode ? 'explicit Test Mode opt-in' : 'disabled (use mocks; explicit --stripe-test-mode required for provider operations)'}.`);
  // Private per-launch diagnostic token binds the browser proxy to this actual backend instance.
  const diagnosticToken = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(home, 'runtime-token.txt'), diagnosticToken, { mode: 0o600 });
  const childEnv = childEnvironment(env, mail, { PORT: appPort, FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3200',
    ELECTROHUB_DEV_DIAGNOSTIC_TOKEN: diagnosticToken,
    ...isolatedRuntimeSecrets(), STRIPE_SECRET_KEY: stripeTestMode ? runtime.STRIPE_SECRET_KEY : '',
    STRIPE_WEBHOOK_SECRET: stripeTestMode ? runtime.STRIPE_WEBHOOK_SECRET : '', BREVO_API_KEY: real ? runtime.BREVO_API_KEY : '',
    NODE_ENV: 'development', PAYMENT_CONFIRMATION_SIGNAL: 'true', ELECTROHUB_LOG_DIR: files.logs }, runtime);
  // The app loads BREVO_API_KEY from its own .env files at startup; this launcher reads the same files, so report that source (never the value).
  const report = emailDev.describeEmailRuntime({ ...childEnv, BREVO_API_KEY: childEnv.BREVO_API_KEY || (emailSettings().brevo ? 'present' : '') });
  console.log(`dev-isolated: commerce email ${allRecipients ? 'REAL Brevo, GENERAL (every eligible account; disposable database only)' : real ? 'REAL Brevo (approved recipients only: ' + report.allowlistSize + ')' : 'CAPTURE (no external email; files in ' + path.relative(backend, files.capture) + ')'}; ` +
    `producer=${report.producerEnabled} dispatch=${report.dispatchEnabled} mode=${report.sendMode}`);
  for (const warning of report.warnings) console.log(`dev-isolated: [commerce-email] ${warning}`);
  const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'watch', 'src/bootstrap.ts'], { cwd: backend, stdio: 'inherit', shell: process.platform === 'win32', env: childEnv });
  // The email worker runs for as long as the backend does, restarts after crashes (bounded), and is stopped with it. Watched hot-reload of the
  // API does not restart it; restart this command after changing email settings.
  const worker = emailDev.startEmailWorker({ backend, entry: { command: process.execPath, args: ['--import', 'tsx', 'src/commerce-email-runner.ts'] },
    env: childEnv, lockName: 'commerce-email-worker.isolated', log: line => console.log(`dev-isolated: ${line}`) });
  console.log(worker.started ? 'dev-isolated: commerce email worker started (supervised).' : `dev-isolated: commerce email worker NOT started: ${worker.reason}`);
  const stopAll = () => { void worker.stop(); };
  process.once('SIGINT', stopAll); process.once('SIGTERM', stopAll);
  child.on('exit', code => { void worker.stop().finally(() => process.exit(code ?? 0)); });
}
function captured() {
  if (!fs.existsSync(files.capture)) return console.log('No captured emails yet.');
  const messages = fs.readdirSync(files.capture).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(files.capture, name), 'utf8')));
  console.log(`${messages.length} captured email(s) in ${path.relative(backend, files.capture)}:`);
  for (const message of messages) console.log(` ${message.messageId}  to=${message.to}  subject=${message.subject}`);
}
function psqlUpdate(env, sql) {
  return run(bin('psql'), ['-h', 'localhost', '-p', String(port), '-U', 'postgres', '-d', database, '-At', '-c', sql],
    { PGPASSWORD: fs.readFileSync(files.password, 'utf8').trim(), PGSSLMODE: 'verify-full', PGSSLROOTCERT: env.DB_SSL_CA_CERT_PATH }).trim();
}
const emailPattern = /^[a-z0-9._+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}$/;
function useRealRecipient() {
  const address = String(process.argv[3] ?? '').trim().toLowerCase();
  if (!emailPattern.test(address)) fail('usage: use-real-recipient <approved email address>');
  if (!emailSettings().allowed.includes(address)) fail('that address is not in COMMERCE_EMAIL_ALLOWED_RECIPIENTS; add it there first (approved test mailboxes only).');
  const env = config(); startDb(); verifyIdentity(env);
  if (psqlUpdate(env, `SELECT 1 FROM users WHERE email = '${address}'`)) fail('an account already uses that address in the isolated database; use that account to sign in instead.');
  const current = fs.existsSync(files.recipientSwitch) ? JSON.parse(fs.readFileSync(files.recipientSwitch, 'utf8')).current : FIXTURE_CUSTOMER;
  const out = psqlUpdate(env, `UPDATE users SET email = '${address}' WHERE email = '${current}' RETURNING 1`);
  if (out) fs.writeFileSync(files.recipientSwitch, JSON.stringify({ current: address }), { mode: 0o600 });
  console.log(out ? 'Fixture customer now uses the approved address (isolated database only). Sign in with it and the fixture password; run `restore-recipient` when done.'
    : 'No fixture customer row was changed (not initialised?).');
}
function restoreRecipient() {
  if (!fs.existsSync(files.recipientSwitch)) return console.log('Fixture customer is already on its original address.');
  const env = config(); startDb(); verifyIdentity(env);
  const { current } = JSON.parse(fs.readFileSync(files.recipientSwitch, 'utf8'));
  if (!emailPattern.test(current)) fail('recorded address is not valid; nothing changed.');
  psqlUpdate(env, `UPDATE users SET email = '${FIXTURE_CUSTOMER}' WHERE email = '${current}' RETURNING 1`);
  fs.unlinkSync(files.recipientSwitch);
  console.log('Fixture customer restored to its original address.');
}

const command = process.argv[2];
if (require.main === module) {
  ({ init, 'start-db': startDb, 'stop-db': stopDb, status, backend: startBackend,
    migrate: () => runVerifiedMigration(config()), captured,
    'use-real-recipient': useRealRecipient, 'restore-recipient': restoreRecipient }[command] ?? (() => fail(`unknown command "${command ?? ''}"`)))();
}
module.exports = { applicationEnvironment, testStripeKeyError, childEnvironment, disposableUrlIssue, databaseUrlsIssue, runVerifiedMigration, isolatedBackendPort };
