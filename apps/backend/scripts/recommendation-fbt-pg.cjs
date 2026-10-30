'use strict';

/*
 * Task 04.4 FBT real-PostgreSQL gate (DISPOSABLE only). Provisions a brand-new local PostgreSQL cluster on a random loopback
 * port, applies every repository migration with the pinned Prisma CLI (`migrate deploy`), runs the co-purchase behavioural suite
 * against it, and stops the cluster. It never reads .env DATABASE_URL/DIRECT_URL and cannot target a hosted database: the only
 * URL it builds is its own loopback cluster. Mirrors scripts/commerce-email-pg.cjs.
 *
 *   node scripts/recommendation-fbt-pg.cjs       (ELECTROHUB_LOCAL_PG_BIN / ELECTROHUB_LOCAL_OPENSSL override binary locations)
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const backend = path.resolve(__dirname, '..');
const root = path.resolve(backend, '../..');
fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
const work = fs.mkdtempSync(path.join(root, '.cache/recommendation-fbt-pg-run-'));
const data = path.join(work, 'data');
const binaries = process.env.ELECTROHUB_LOCAL_PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const exe = name => path.join(binaries, process.platform === 'win32' ? `${name}.exe` : name);
const database = `electrohub_disposable_fbt_${crypto.randomBytes(4).toString('hex')}`;
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
async function run() {
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
    command(exe('psql'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q',
      '-f', path.join(migrations, name, 'migration.sql')]);
  }
  const env = {
    ...process.env, NODE_ENV: 'test', RECOMMENDATION_FBT_PG_RUN: '1', DATABASE_URL: url, DIRECT_URL: url,
    DB_SSL_CA_CERT_PATH: path.join(work, 'server.crt'), NODE_EXTRA_CA_CERTS: path.join(work, 'server.crt'),
    JWT_SECRET: crypto.randomBytes(48).toString('base64url'), ELECTROHUB_LOG_DIR: path.join(work, 'logs'),
    STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', BREVO_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '',
    PAYMENT_SHARED_MUTATIONS_APPROVED: '', COMMERCE_EMAIL_SEND_MODE: 'disabled', PAYMENT_CONFIRMATION_SIGNAL: 'false',
  };
  const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  child = spawn(process.execPath, [vitest, 'run', '--config', 'vitest.recommendation-fbt-pg.config.mts'], { cwd: backend, env, stdio: 'inherit', windowsHide: true });
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
