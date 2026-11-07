'use strict';

/*
 * Task 05.2 disposable BROWSER-QA stack (DISPOSABLE only). Provisions a brand-new local PostgreSQL cluster on a random loopback
 * port, applies repository migration SQL through psql (with explicit pgvector skips), and runs a local API for browser tests.
 * It never reads .env DATABASE_URL/DIRECT_URL and cannot target a hosted database: the only URL it builds is its own loopback cluster.
 * This harness provides browser evidence, not Prisma ledger/checksum or migrate-deploy repeatability evidence.
 *
 *   node scripts/task05-2-browser-stack.cjs   (Ctrl+C stops the backend and the cluster)       (ELECTROHUB_LOCAL_PG_BIN / ELECTROHUB_LOCAL_OPENSSL override binary locations)
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const backend = path.resolve(__dirname, '..');
const root = path.resolve(backend, '../..');
fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
const work = fs.mkdtempSync(path.join(root, '.cache/task05-2-browser-stack-'));
const data = path.join(work, 'data');
const binaries = process.env.ELECTROHUB_LOCAL_PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const exe = name => path.join(binaries, process.platform === 'win32' ? `${name}.exe` : name);
const database = `electrohub_disposable_browser_${crypto.randomBytes(4).toString('hex')}`;
let started = false;
let child;

function command(executable, args, env = process.env) {
  const output = fs.openSync(path.join(work, 'provisioning.log'), 'a');
  let result;
  try { result = spawnSync(executable, args, { cwd: work, env, stdio: ['ignore', output, output], windowsHide: true, timeout: 120000, shell: false }); }
  finally { fs.closeSync(output); }
  if (result.error || result.status !== 0) throw new Error(`Disposable prerequisite failed: ${path.basename(executable)}; inspect ${path.relative(root, work)}/provisioning.log`);
}
async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  return port;
}
// Optional overrides so a second disposable stack can run beside another one (defaults keep the existing contract). A non-default API
// port also gets its own credentials file, so two stacks never overwrite each other's disposable credentials.
const apiPort = process.env.TASK05_2_API_PORT || '5200';
const frontendOrigin = `http://localhost:${process.env.TASK05_2_FRONTEND_PORT || '3200'}`;
const credentialsFile = process.env.TASK05_2_CREDENTIALS
  || (apiPort === '5200' ? '.cache/task05-2-browser-credentials.json' : `.cache/task05-2-browser-credentials-${apiPort}.json`);

/** True when something already listens on the loopback port (another stack, a dev server). */
function portInUse(portNumber) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port: Number(portNumber) });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

async function run() {
  // Refuse BEFORE provisioning or seeding: a busy port used to fail only after the shared credentials file had been rewritten.
  if (await portInUse(apiPort)) {
    throw new Error(`Port ${apiPort} is already in use (another stack?). Set TASK05_2_API_PORT/TASK05_2_FRONTEND_PORT to run beside it.`);
  }
  const port = await unusedPort();
  const openssl = process.env.ELECTROHUB_LOCAL_OPENSSL || 'C:/Program Files/Git/usr/bin/openssl.exe';
  command(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', 'server.key', '-out', 'server.crt']);
  command(exe('initdb'), ['-D', data, '-U', 'postgres', '--auth-local=trust', '--auth-host=trust', '--encoding=UTF8', '--locale=C']);
  fs.copyFileSync(path.join(work, 'server.crt'), path.join(data, 'server.crt'));
  fs.copyFileSync(path.join(work, 'server.key'), path.join(data, 'server.key'));
  fs.appendFileSync(path.join(data, 'postgresql.conf'), `\nlisten_addresses = '127.0.0.1'\nport = ${port}\nssl = on\nssl_cert_file = 'server.crt'\n` +
    `ssl_key_file = 'server.key'\nmax_connections = 60\n`);
  command(exe('pg_ctl'), ['-D', data, '-l', path.join(work, 'postgres.log'), '-w', 'start']);
  started = true;
  command(exe('createdb'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', database]);
  const url = `postgresql://postgres@127.0.0.1:${port}/${database}`;
  // Every repository migration is applied in order, except the ones that create the pgvector `ai`/`extensions` objects (this host's
  // PostgreSQL has no pgvector extension) and the media overlay that depends on them. Co-purchase SQL reads only public commerce
  // tables (orders, order_items, payments, products, inventory). Skips are logged to provisioning.log so the evidence states them.
  const skipped = new Set(['20261024000000_ai_vector_search', '20261025000000_ai_vector_staging_guard',
    '20261028010000_catalog_media_overlay', '20261028020000_product_media_worker_health']);
  const migrations = path.join(backend, 'prisma/migrations');
  for (const name of fs.readdirSync(migrations).filter(entry => /^\d/.test(entry)).sort()) {
    if (skipped.has(name)) { fs.appendFileSync(path.join(work, 'provisioning.log'), `SKIPPED ${name}: requires pgvector (not installed)\n`); continue; }
    // Upgrade proof: legacy rows are written on the pre-05.2 schema, then the 05.2 migration is applied over them.
    if (name === '20261105000000_admin_security_settings_analytics') {
      command(exe('psql'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q',
        '-f', path.join(backend, 'scripts/fixtures/admin-security-pre-upgrade.sql')]);
      fs.appendFileSync(path.join(work, 'provisioning.log'), 'APPLIED pre-upgrade fixture before 20261105000000\n');
    }
    command(exe('psql'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q',
      '-f', path.join(migrations, name, 'migration.sql')]);
  }
  const emailCapture = process.env.TASK05_2_EMAIL_CAPTURE === '1';
  const env = {
    ...process.env, NODE_ENV: 'development', DATABASE_URL: url, DIRECT_URL: url, PORT: apiPort,
    DB_SSL_CA_CERT_PATH: path.join(work, 'server.crt'), NODE_EXTRA_CA_CERTS: path.join(work, 'server.crt'),
    JWT_SECRET: crypto.randomBytes(48).toString('base64url'), ELECTROHUB_LOG_DIR: path.join(work, 'logs'),
    ADMIN_MFA_ENCRYPTION_KEYS: `1:${crypto.randomBytes(32).toString('base64')}`, ADMIN_MFA_ACTIVE_KEY_VERSION: '1',
    FRONTEND_URL: frontendOrigin, WEBAUTHN_RP_ID: 'localhost', WEBAUTHN_ORIGIN: frontendOrigin,
    // No real providers: email, Stripe and AI are disabled so nothing leaves this machine.
    STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', BREVO_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', AI_SERVICE_URL: '', AI_SERVICE_API_KEY: '',
    PAYMENT_SHARED_MUTATIONS_APPROVED: '', COMMERCE_EMAIL_SEND_MODE: 'disabled', PAYMENT_CONFIRMATION_SIGNAL: 'false',
    // Operator seed-provisioning redemption endpoints are mounted on this throwaway stack. With TASK05_2_EMAIL_CAPTURE=1, admin
    // activation / password-recovery mail to synthetic .invalid recipients is captured in this run's own folder instead (loopback DB
    // only; any other recipient is refused); without it the stack keeps having no email provider, as earlier journeys expect.
    ADMIN_SEED_PROVISIONING_ENABLED: 'true', ...(emailCapture ? { E2E_OTP_OUTBOX_DIR: path.join(work, 'outbox') } : {}),
  };
  const credentials = path.join(root, credentialsFile);
  const tsx = path.join(path.dirname(require.resolve('tsx/package.json')), 'dist/cli.mjs');
  const seeded = spawnSync(process.execPath, [tsx, 'scripts/fixtures/task05-2-browser-seed.ts', credentials], { cwd: backend, env, stdio: 'inherit', windowsHide: true });
  if (seeded.status !== 0) throw new Error('Browser fixtures could not be seeded.');
  // Lets a browser spec age its own disposable admin session (to make the REAL server demand a step-up) without any test-only
  // backend code. Loopback, trust-auth, throwaway cluster only; the file is git-ignored and removed with the run.
  const written = JSON.parse(fs.readFileSync(credentials, 'utf8'));
  fs.writeFileSync(credentials, JSON.stringify({ ...written, disposableDb: { psql: exe('psql'), port, database }, outboxDir: emailCapture ? path.join(work, 'outbox') : null,
    // Loopback trust-auth cluster only (no password): lets a browser spec run the operator CLI against THIS throwaway database.
    backendDir: backend, databaseUrl: url, caCert: path.join(work, 'server.crt') }, null, 2));
  console.log(`Disposable browser stack: backend http://127.0.0.1:${apiPort} (credentials file: ${path.relative(root, credentials)})`);
  child = spawn(process.execPath, [tsx, 'src/bootstrap.ts'], { cwd: backend, env, stdio: 'inherit', windowsHide: true });
  return new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child?.kill(signal));
run().then(code => { process.exitCode = code; }).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; })
  .finally(() => {
    if (started) {
      try { command(exe('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop']); }
      catch { process.stderr.write('Disposable PostgreSQL stop failed; inspect the run directory.\n'); process.exitCode = 1; }
    }
    console.log(`Disposable evidence directory: ${path.relative(root, work)}`);
  });
