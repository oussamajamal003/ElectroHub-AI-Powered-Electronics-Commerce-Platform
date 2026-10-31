'use strict';

/*
 * Task 04.5 delivery tracking real-PostgreSQL gate (DISPOSABLE only). Provisions a brand-new local PostgreSQL cluster on a random loopback
 * port, applies every repository migration with psql (pgvector-only migrations skipped and logged), runs the delivery tracking service + HTTP suites (T5-01…T5-20)
 * against it, and stops the cluster. It never reads .env DATABASE_URL/DIRECT_URL and cannot target a hosted database: the only
 * URL it builds is its own loopback cluster. Mirrors scripts/commerce-email-pg.cjs.
 *
 *   node scripts/delivery-pg.cjs                (ELECTROHUB_LOCAL_PG_BIN / ELECTROHUB_LOCAL_OPENSSL override binary locations)
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const backend = path.resolve(__dirname, '..');
const root = path.resolve(backend, '../..');
fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
const work = fs.mkdtempSync(path.join(root, '.cache/delivery-pg-run-'));
const data = path.join(work, 'data');
const binaries = process.env.ELECTROHUB_LOCAL_PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const exe = name => path.join(binaries, process.platform === 'win32' ? `${name}.exe` : name);
const database = `electrohub_disposable_delivery_${crypto.randomBytes(4).toString('hex')}`;
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
  // PostgreSQL has no pgvector extension) and the media overlay that depends on them. Delivery tracking reads/writes only public commerce
  // tables (orders, payments, deliveries, delivery_events, commerce_email_outbox). Skips are logged to provisioning.log so the evidence states them.
  const skipped = new Set(['20261024000000_ai_vector_search', '20261025000000_ai_vector_staging_guard',
    '20261028010000_catalog_media_overlay', '20261028020000_product_media_worker_health']);
  const migrations = path.join(backend, 'prisma/migrations');
  for (const name of fs.readdirSync(migrations).filter(entry => /^\d/.test(entry)).sort()) {
    if (skipped.has(name)) { fs.appendFileSync(path.join(work, 'provisioning.log'), `SKIPPED ${name}: requires pgvector (not installed)\n`); continue; }
    command(exe('psql'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q',
      '-f', path.join(migrations, name, 'migration.sql')]);
  }
  // Task 04.5 drift gate: the migrated public schema must equal schema.prisma (written to drift.sql; empty means no drift).
  const prismaCli = path.join(path.dirname(require.resolve('prisma/package.json')), 'build', 'index.js');
  const drift = spawnSync(process.execPath, [prismaCli, 'migrate', 'diff', '--from-url', `${url}?sslmode=require&sslaccept=accept_invalid_certs`,
    '--to-schema-datamodel', path.join(backend, 'prisma/schema.prisma'), '--script'], { cwd: work, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  fs.writeFileSync(path.join(work, 'drift.sql'), drift.stdout ?? '');
  const statements = (drift.stdout ?? '').split('\n').filter(line => line.trim() && !line.startsWith('--'));
  // Pre-existing drift on early auth tables (DB-side id/updatedAt defaults) predates Task 04.5 and is reported, not failed; any drift on a
  // delivery object fails the gate.
  const deliveryDrift = statements.filter(line => /"(deliveries|delivery_events)"|"Delivery(Event|Location)/.test(line));
  console.log(`Prisma drift (migrated disposable DB -> schema.prisma): ${drift.status === 0 ? `${statements.length} statement(s), ${deliveryDrift.length} on delivery objects` : 'diff failed'}`);
  if (drift.status !== 0 || deliveryDrift.length) throw new Error(`Delivery schema drift detected; inspect ${path.relative(root, work)}/drift.sql`);
  const env = {
    ...process.env, NODE_ENV: 'test', DELIVERY_PG_RUN: '1', DATABASE_URL: url, DIRECT_URL: url,
    DB_SSL_CA_CERT_PATH: path.join(work, 'server.crt'), NODE_EXTRA_CA_CERTS: path.join(work, 'server.crt'),
    // Task 04.6: clearly fictional demo hub for the map projection.
    DELIVERY_ORIGIN_LAT: '33.9', DELIVERY_ORIGIN_LNG: '35.5', DELIVERY_ORIGIN_LABEL: 'ElectroHub demo hub',
    JWT_SECRET: crypto.randomBytes(48).toString('base64url'), ELECTROHUB_LOG_DIR: path.join(work, 'logs'),
    STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', BREVO_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '',
    PAYMENT_SHARED_MUTATIONS_APPROVED: '', COMMERCE_EMAIL_ENQUEUE_ENABLED: 'true', COMMERCE_EMAIL_DISPATCH_ENABLED: 'false',
    COMMERCE_EMAIL_SEND_MODE: 'disabled', COMMERCE_EMAIL_ORIGIN: 'http://localhost:5173', PAYMENT_CONFIRMATION_SIGNAL: 'false',
  };
  const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  child = spawn(process.execPath, [vitest, 'run', '--config', 'vitest.delivery-pg.config.mts'], { cwd: backend, env, stdio: 'inherit', windowsHide: true });
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
