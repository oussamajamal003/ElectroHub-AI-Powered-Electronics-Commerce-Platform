'use strict';

// A separate exact-selection runner. Never loads .env, runs migrations, or starts commerce workers.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const backend = path.resolve(__dirname, '..');
const root = path.resolve(backend, '../..');
const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg !== '--postgres')) {
  throw new Error('Only --postgres is supported; test selection and targets are fixed.');
}
const postgres = args.includes('--postgres');
const work = fs.mkdtempSync(path.join(root, '.cache/database-reliability-run-'));
const data = path.join(work, 'data');
const binaries = process.env.ELECTROHUB_LOCAL_PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const pgctl = path.join(binaries, process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');
let initialized = false;
let child;
let interrupted = false;

function command(executable, options) {
  // Native pg_ctl can leave inherited pipe handles open in its background server on Windows.
  const output = fs.openSync(path.join(work, 'provisioning.log'), 'a');
  let result;
  try {
    result = spawnSync(executable, options, { cwd: work, stdio: ['ignore', output, output], windowsHide: true, timeout: 30000 });
  } finally { fs.closeSync(output); }
  if (result.error || result.status !== 0) {
    throw new Error(`Disposable prerequisite failed: ${path.basename(executable)}; inspect local provisioning.log`);
  }
}
async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}
async function run() {
  const env = {
    ...process.env, NODE_ENV: 'test', ELECTROHUB_DB_RELIABILITY_RUN: '1',
    ELECTROHUB_DB_RELIABILITY_POSTGRES: postgres ? '1' : '0',
    DATABASE_URL: 'postgresql://offline:offline@127.0.0.1:1/offline',
    DIRECT_URL: 'postgresql://offline:offline@127.0.0.1:1/offline',
    JWT_SECRET: crypto.randomBytes(48).toString('base64url'), DB_SSL_CA_CERT_PATH: '',
    ELECTROHUB_LOG_DIR: path.join(work, 'logs'), ELECTROHUB_SQL_DIAGNOSTICS: '0',
    STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', CHECKOUT_LIVE_DEV: 'false', STRIPE_LIVE_DEV: 'false',
    BREVO_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '',
  };
  if (postgres) {
    const port = await unusedPort();
    const openssl = process.env.ELECTROHUB_LOCAL_OPENSSL || 'C:/Program Files/Git/usr/bin/openssl.exe';
    command(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
      '-keyout', 'server.key', '-out', 'server.crt']);
    command(path.join(binaries, process.platform === 'win32' ? 'initdb.exe' : 'initdb'),
      ['-D', data, '-U', 'postgres', '--auth-local=trust', '--auth-host=trust', '--encoding=UTF8', '--locale=C']);
    initialized = true;
    // Relative paths avoid PostgreSQL/Windows locale conversion of the repository's Unicode path.
    fs.copyFileSync(path.join(work, 'server.crt'), path.join(data, 'server.crt'));
    fs.copyFileSync(path.join(work, 'server.key'), path.join(data, 'server.key'));
    fs.appendFileSync(path.join(data, 'postgresql.conf'),
      `\nlisten_addresses = '127.0.0.1'\nport = ${port}\nssl = on\nssl_cert_file = 'server.crt'\nssl_key_file = 'server.key'\n`);
    // Only this newly initialized directory can be started/stopped. No existing server is touched.
    command(pgctl, ['-D', data, '-l', path.join(work, 'postgres.log'), '-w', 'start']);
    env.DATABASE_URL = env.DIRECT_URL = `postgresql://postgres@127.0.0.1:${port}/postgres`;
    env.DB_SSL_CA_CERT_PATH = path.join(work, 'server.crt');
  }
  const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  child = spawn(process.execPath, [vitest, 'run', '--config', 'vitest.database-reliability.config.mts'], {
    cwd: backend, env, stdio: 'inherit', windowsHide: true,
  });
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
  return interrupted ? 1 : exit;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true; child?.kill(signal); });
run().then(code => { process.exitCode = code; }).catch(error => {
  process.stderr.write(`${error.message}\n`); process.exitCode = 1;
}).finally(() => {
  if (initialized && fs.existsSync(path.join(data, 'postmaster.pid'))) {
    try { command(pgctl, ['-D', data, '-m', 'immediate', '-w', 'stop']); }
    catch { process.stderr.write('Disposable PostgreSQL stop failed; inspect the owned run directory.\n'); process.exitCode = 1; }
  }
  console.log(`Isolated evidence: ${path.relative(root, work)}`);
});
