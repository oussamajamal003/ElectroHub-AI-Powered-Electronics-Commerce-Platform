'use strict';

/*
 * Task 04.5 real-browser QA stack (DISPOSABLE only). Provisions a brand-new TLS PostgreSQL cluster on a random loopback port, applies every
 * repository migration (pgvector-only migrations skipped and logged, as in scripts/delivery-pg.cjs), seeds synthetic delivery fixtures
 * through the real DeliveryService (scripts/delivery-qa-seed.ts), then runs the backend on :5310 and Vite on :3310 (proxying /api to it).
 * Stripe and Brevo keys are blanked, the email outbox is enqueue-only (no dispatch), and the only database URL it builds is its own
 * loopback cluster. Ctrl+C (or killing this process) stops both servers and the cluster.
 *
 *   node scripts/delivery-qa-stack.cjs      → writes <run>/state.json { frontend, backend, credentials } and keeps running
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const backend = path.resolve(__dirname, '..');
const frontend = path.resolve(backend, '../frontend');
const root = path.resolve(backend, '../..');
fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
const work = fs.mkdtempSync(path.join(root, '.cache/delivery-qa-stack-'));
const data = path.join(work, 'data');
const binaries = process.env.ELECTROHUB_LOCAL_PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const exe = name => path.join(binaries, process.platform === 'win32' ? `${name}.exe` : name);
const database = `electrohub_disposable_delivery_qa_${crypto.randomBytes(4).toString('hex')}`;
const ports = { backend: Number(process.env.DELIVERY_QA_BACKEND_PORT || 5310), frontend: Number(process.env.DELIVERY_QA_FRONTEND_PORT || 3310) };
const children = [];
let started = false;

function command(executable, args, env = process.env, cwd = work) {
  const output = fs.openSync(path.join(work, 'provisioning.log'), 'a');
  let result;
  try { result = spawnSync(executable, args, { cwd, env, stdio: ['ignore', output, output], windowsHide: true, timeout: 180000, shell: false }); }
  finally { fs.closeSync(output); }
  if (result.error || result.status !== 0) throw new Error(`QA stack prerequisite failed: ${path.basename(executable)} ${args[0] ?? ''}; inspect ${path.relative(root, work)}/provisioning.log`);
}
async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  return port;
}
function serve(name, args, env, cwd) {
  const log = fs.openSync(path.join(work, `${name}.log`), 'a');
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', log, log], windowsHide: true });
  children.push(child);
  child.once('exit', code => { if (!stopping) { console.error(`${name} exited (${code}); inspect ${path.relative(root, work)}/${name}.log`); shutdown(1); } });
}
async function waitFor(url, label) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try { const response = await fetch(url); if (response.status < 500) return; } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

async function run() {
  const pgPort = await unusedPort();
  const openssl = process.env.ELECTROHUB_LOCAL_OPENSSL || 'C:/Program Files/Git/usr/bin/openssl.exe';
  command(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', 'server.key', '-out', 'server.crt']);
  command(exe('initdb'), ['-D', data, '-U', 'postgres', '--auth-local=trust', '--auth-host=trust', '--encoding=UTF8', '--locale=C']);
  fs.copyFileSync(path.join(work, 'server.crt'), path.join(data, 'server.crt'));
  fs.copyFileSync(path.join(work, 'server.key'), path.join(data, 'server.key'));
  fs.appendFileSync(path.join(data, 'postgresql.conf'), `\nlisten_addresses = '127.0.0.1'\nport = ${pgPort}\nssl = on\nssl_cert_file = 'server.crt'\n` +
    `ssl_key_file = 'server.key'\nmax_connections = 60\n`);
  command(exe('pg_ctl'), ['-D', data, '-l', path.join(work, 'postgres.log'), '-w', 'start']);
  started = true;
  command(exe('createdb'), ['-h', '127.0.0.1', '-p', String(pgPort), '-U', 'postgres', database]);
  const skipped = new Set(['20261024000000_ai_vector_search', '20261025000000_ai_vector_staging_guard',
    '20261028010000_catalog_media_overlay', '20261028020000_product_media_worker_health']);
  const migrations = path.join(backend, 'prisma/migrations');
  for (const name of fs.readdirSync(migrations).filter(entry => /^\d/.test(entry)).sort()) {
    if (skipped.has(name)) { fs.appendFileSync(path.join(work, 'provisioning.log'), `SKIPPED ${name}: requires pgvector (not installed)\n`); continue; }
    command(exe('psql'), ['-h', '127.0.0.1', '-p', String(pgPort), '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-f', path.join(migrations, name, 'migration.sql')]);
  }
  const url = `postgresql://postgres@127.0.0.1:${pgPort}/${database}?sslmode=require`;
  const env = {
    ...process.env, NODE_ENV: 'development', PORT: String(ports.backend), DATABASE_URL: url, DIRECT_URL: url, DB_SSL_CA_CERT_PATH: path.join(work, 'server.crt'),
    NODE_EXTRA_CA_CERTS: path.join(work, 'server.crt'), JWT_SECRET: crypto.randomBytes(48).toString('base64url'), ELECTROHUB_LOG_DIR: path.join(work, 'logs'),
    FRONTEND_URL: `http://localhost:${ports.frontend}`, STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', BREVO_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '',
    PAYMENT_SHARED_MUTATIONS_APPROVED: '', PAYMENT_CONFIRMATION_SIGNAL: 'false', COMMERCE_EMAIL_ENQUEUE_ENABLED: 'true', COMMERCE_EMAIL_DISPATCH_ENABLED: 'false',
    COMMERCE_EMAIL_SEND_MODE: 'disabled', COMMERCE_EMAIL_ORIGIN: `http://localhost:${ports.frontend}`, OTP_HASH_SECRET: crypto.randomBytes(24).toString('hex'),
  };
  const tsx = path.join(path.dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');
  const credentials = path.join(work, 'credentials.json');
  command(process.execPath, [tsx, 'scripts/delivery-qa-seed.ts', credentials], env, backend);
  serve('backend', [tsx, 'src/bootstrap.ts'], env, backend);
  await waitFor(`http://127.0.0.1:${ports.backend}/api/health`, 'backend');
  const vite = path.join(path.dirname(require.resolve('vite/package.json', { paths: [frontend] })), 'bin', 'vite.js');
  serve('frontend', [vite, '--port', String(ports.frontend), '--strictPort'], { ...process.env, E2E_FRONTEND_PORT: String(ports.frontend),
    E2E_API_PROXY_TARGET: `http://localhost:${ports.backend}` }, frontend);
  await waitFor(`http://localhost:${ports.frontend}/`, 'frontend');
  const state = { frontend: `http://localhost:${ports.frontend}`, backend: `http://127.0.0.1:${ports.backend}`, credentials, database: `loopback:${pgPort}/${database}`, run: work };
  fs.writeFileSync(path.join(work, 'state.json'), JSON.stringify(state, null, 2));
  fs.writeFileSync(path.join(root, '.cache', 'delivery-qa-stack.current'), path.join(work, 'state.json'));
  console.log(`Delivery QA stack ready: ${state.frontend} (API ${state.backend}, ${state.database}); state: ${path.relative(root, path.join(work, 'state.json'))}`);
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return; stopping = true;
  for (const child of children) { try { child.kill(); } catch { /* gone */ } }
  if (started) { try { command(exe('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop']); } catch { process.stderr.write('Disposable PostgreSQL stop failed.\n'); } }
  try { fs.rmSync(path.join(root, '.cache', 'delivery-qa-stack.current'), { force: true }); } catch { /* ignore */ }
  console.log(`Delivery QA stack stopped. Evidence: ${path.relative(root, work)}`);
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => shutdown(0));
// A stop file lets automation end the stack cleanly on Windows, where signals to detached processes are unreliable.
setInterval(() => { if (fs.existsSync(path.join(work, 'STOP'))) shutdown(0); }, 1000).unref();
run().catch(error => { process.stderr.write(`${error.message}\n`); shutdown(1); });
setInterval(() => {}, 1 << 30);
