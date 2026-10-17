#!/usr/bin/env node
/**
 * Isolated local payment development (Task 03.6). Shared DEV is deliberately payment-write-disabled for the watched dev server
 * (src/payment-isolation.ts), so local checkout, Try Again, Remove and Cancel purchase need a DISPOSABLE database. This script provisions and
 * runs one, and fails closed unless every database URL is a verified disposable loopback target.
 *
 *   PG_BIN=<dir containing initdb, pg_ctl, createdb, psql> (PostgreSQL 17)
 *   node scripts/dev-isolated.cjs init       create cluster (TLS, scram, loopback), database, schema (migrate deploy), fixtures
 *   node scripts/dev-isolated.cjs start-db   start the disposable cluster
 *   node scripts/dev-isolated.cjs stop-db    stop it (data kept in apps/backend/.isolated)
 *   node scripts/dev-isolated.cjs status     show identity checks
 *   node scripts/dev-isolated.cjs backend    run the watched backend against it (PORT, default 5000)
 *
 * Never touches shared DEV/PROD: every database action targets the URL written by `init`, re-verified before use. The Stripe key comes from
 * the app's own configuration (.env); the SDK refuses any non-test key, so every checkout here creates Stripe TEST MODE PaymentIntents only.
 */
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const backend = path.resolve(__dirname, '..');
const home = path.join(backend, '.isolated');
const port = Number(process.env.ISOLATED_PG_PORT || 55434);
const database = 'electrohub_disposable';
const files = { data: path.join(home, 'data'), certs: path.join(home, 'certs'), password: path.join(home, 'password.txt'),
  env: path.join(home, 'env.json'), credentials: path.join(home, 'fixture-credentials.txt'), logs: path.join(home, 'logs'), pglog: path.join(home, 'postgres.log') };
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

// Same rule as src/payment-isolation.ts: every URL loopback AND an electrohub_disposable or electrohub_ci database.
function assertDisposable(url) {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname) || !/^electrohub_(?:disposable|ci)[a-z0-9_]*$/.test(name)) {
    fail(`refusing non-disposable database target ${parsed.hostname}:${parsed.port}/${name}`);
  }
  return `${parsed.hostname}:${parsed.port}/${name}`;
}
function config() {
  if (!fs.existsSync(files.env)) fail('not initialised; run `node scripts/dev-isolated.cjs init` first.');
  const env = JSON.parse(fs.readFileSync(files.env, 'utf8'));
  assertDisposable(env.DATABASE_URL); assertDisposable(env.DIRECT_URL);
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
  run(bin('initdb'), ['-D', files.data, '-U', 'postgres', '--auth=scram-sha-256', `--pwfile=${files.password}`, '-E', 'UTF8']);
  // Relative to the data directory: PostgreSQL on Windows cannot open absolute paths containing non-ASCII characters (the repository name has
  // an em dash), and relative paths keep the cluster relocatable.
  fs.appendFileSync(path.join(files.data, 'postgresql.conf'), `\nport = ${port}\nlisten_addresses = '127.0.0.1'\nssl = on\n` +
    `ssl_cert_file = '../certs/server.crt'\nssl_key_file = '../certs/server.key'\n`);
  startDb();
  run(bin('createdb'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', database], { PGPASSWORD: password });
  const url = `postgresql://postgres:${password}@localhost:${port}/${database}`;
  const env = { DATABASE_URL: url, DIRECT_URL: url, DB_SSL_CA_CERT_PATH: path.join(files.certs, 'ca.crt') };
  assertDisposable(url);
  fs.writeFileSync(files.env, JSON.stringify(env, null, 2), { mode: 0o600 });
  console.log(`identity: ${verifyIdentity(env)}`);
  provision(env);
}
function provision(env) {
  // Isolated fixture provisioning (NOT a shared migration rollout): the repository schema into this disposable database only.
  const cliUrl = `${env.DATABASE_URL}?sslmode=disable`;
  npx(['prisma', 'migrate', 'deploy'], { DATABASE_URL: cliUrl, DIRECT_URL: cliUrl });
  // Test-only fixtures with generated credentials; never .env accounts or real customer data (seed guard requires a disposable target).
  const customer = 'customer@isolated.electrohub.test'; const admin = 'admin@isolated.electrohub.test';
  const customerPassword = `Iso-${crypto.randomBytes(8).toString('hex')}!`; const adminPassword = `Iso-${crypto.randomBytes(8).toString('hex')}!`;
  fs.writeFileSync(files.credentials, `customer=${customer}\ncustomer_password=${customerPassword}\nadmin=${admin}\nadmin_password=${adminPassword}\n`, { mode: 0o600 });
  npx(['tsx', 'prisma/seed.ts'], { ...env, NODE_ENV: 'development', CUSTOMER_EMAIL: customer, CUSTOMER_PASSWORD: customerPassword, ADMIN_EMAIL: admin,
    ADMIN_PASSWORD: adminPassword, ADMIN1_PASSWORD: adminPassword, ADMIN2_PASSWORD: adminPassword, ADMIN3_PASSWORD: adminPassword, ADMIN4_PASSWORD: adminPassword });
  console.log(`\nReady. Test sign-in credentials: ${files.credentials}\nNext: node scripts/dev-isolated.cjs backend`);
}
function startDb() {
  try { run(bin('pg_ctl'), ['-D', files.data, 'status']); console.log('disposable PostgreSQL already running'); return; } catch { /* not running */ }
  // Output detached: on Windows the server inherits pg_ctl's stdout, so a piped stdout would never close and this would wait forever.
  run(bin('pg_ctl'), ['-D', files.data, '-l', files.pglog, '-w', 'start'], {}, { stdio: 'ignore' });
  console.log(`disposable PostgreSQL started on 127.0.0.1:${port}`);
}
function stopDb() { run(bin('pg_ctl'), ['-D', files.data, '-m', 'fast', 'stop'], {}, { stdio: 'inherit' }); }
function status() { const env = config(); console.log(`target: ${assertDisposable(env.DATABASE_URL)}\nidentity: ${verifyIdentity(env)}`); }
function startBackend() {
  const env = config(); startDb();
  const identity = verifyIdentity(env);
  const appPort = process.env.PORT || '5000';
  console.log(`dev-isolated: database ${assertDisposable(env.DATABASE_URL)} verified (${identity}); backend on :${appPort}.`);
  console.log('dev-isolated: Stripe key comes from .env; the SDK accepts TEST keys only, so every checkout here creates Test Mode PaymentIntents.');
  const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'watch', 'src/bootstrap.ts'], { cwd: backend, stdio: 'inherit', shell: process.platform === 'win32',
    env: { ...process.env, ...env, PORT: appPort, NODE_ENV: 'development', PAYMENT_CONFIRMATION_SIGNAL: 'true',
      // Never inherit a shared-target approval; the disposable target needs none.
      PAYMENT_SHARED_MUTATIONS_APPROVED: '', ELECTROHUB_LOG_DIR: files.logs } });
  child.on('exit', code => process.exit(code ?? 0));
}

const command = process.argv[2];
({ init, 'start-db': startDb, 'stop-db': stopDb, status, backend: startBackend }[command] ?? (() => fail(`unknown command "${command ?? ''}"`)))();
