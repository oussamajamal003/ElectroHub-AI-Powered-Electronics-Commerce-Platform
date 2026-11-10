#!/usr/bin/env node
'use strict';
/**
 * Task 06.1 local disposable PostgreSQL for the release-critical test suite. Mirrors .github/actions/disposable-postgres exactly
 * (pinned pgvector/pgvector:0.8.0-pg17 image, per-run CA + TLS server certificate, per-run random password, loopback-only port,
 * database name `electrohub_ci`) so local runs and CI exercise the same database shape, including the pgvector `ai` schema.
 *
 *   node scripts/release-e2e-db.cjs start   fresh container (any previous release-e2e container is removed first; no volume is kept)
 *   node scripts/release-e2e-db.cjs stop    remove the container (its data lives only inside it)
 *   node scripts/release-e2e-db.cjs status
 *
 * On Windows Docker runs inside WSL (RELEASE_E2E_WSL_DISTRO, default Ubuntu) as root, the same mechanism dev-isolated.cjs uses.
 * Writes .cache/release-e2e/db.json (git-ignored, mode 0600) with the loopback URL and CA path. Never reads .env files and can only
 * ever describe its own 127.0.0.1 container, so it cannot point anything at shared DEV/PROD.
 */
const { execFileSync, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const home = path.join(root, '.cache', 'release-e2e');
const stateFile = path.join(home, 'db.json');
const container = 'electrohub-release-e2e-pg';
const image = 'pgvector/pgvector:0.8.0-pg17';
const port = Number(process.env.RELEASE_E2E_PG_PORT || 55436);
const database = 'electrohub_ci';
const windows = process.platform === 'win32';
const distro = process.env.RELEASE_E2E_WSL_DISTRO || 'Ubuntu';
const openssl = process.env.ELECTROHUB_LOCAL_OPENSSL || (windows ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');

const fail = message => { console.error(`release-e2e-db: ${message}`); process.exit(1); };
const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', stdio: options.stdio ?? 'pipe', cwd: options.cwd,
  env: { ...process.env, MSYS_NO_PATHCONV: '1' }, windowsHide: true });
const docker = (args, options) => windows ? run('wsl', ['-d', distro, '-u', 'root', '--', 'docker', ...args], options) : run('docker', args, options);
const toDockerPath = p => windows ? run('wsl', ['-d', distro, '--', 'wslpath', '-a', p.replace(/\\/g, '/')]).trim() : p;

function exists() {
  try { return docker(['inspect', '-f', '{{.State.Running}}', container]).trim(); } catch { return 'missing'; }
}

const keepalivePid = path.join(root, '.cache', 'release-e2e-keepalive.pid');
/**
 * WSL stops an idle distribution (and with it this tmpfs-backed container) once no wsl.exe session is attached. A detached
 * `docker logs -f` keeps one session open for as long as the container runs, the same mechanism dev-isolated.cjs uses.
 */
function keepAlive() {
  if (!windows) return;
  const log = fs.openSync(path.join(home, 'postgres.log'), 'a');
  const child = spawn('wsl', ['-d', distro, '-u', 'root', '--', 'docker', 'logs', '-f', container],
    { detached: true, stdio: ['ignore', log, log], windowsHide: true });
  child.unref();
  fs.writeFileSync(keepalivePid, String(child.pid));
}

function stop() {
  if (fs.existsSync(keepalivePid)) {
    try { process.kill(Number(fs.readFileSync(keepalivePid, 'utf8'))); } catch { /* already gone */ }
    fs.rmSync(keepalivePid, { force: true });
  }
  if (exists() !== 'missing') docker(['rm', '-f', container]);
  fs.rmSync(home, { recursive: true, force: true });
  console.log('release-e2e-db: stopped and removed');
}

function waitReady() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { docker(['exec', container, 'pg_isready', '-U', 'postgres', '-d', database, '-h', '127.0.0.1']); return; } catch { /* not yet */ }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  fail('disposable PostgreSQL did not become ready');
}

function start() {
  stop();
  const certs = path.join(home, 'certs');
  fs.mkdirSync(certs, { recursive: true });
  const ssl = (...args) => run(openssl, args, { cwd: certs });
  ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=electrohub-release-e2e-ca', '-keyout', 'ca.key', '-out', 'ca.crt');
  ssl('req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', 'server.key', '-out', 'server.csr');
  fs.writeFileSync(path.join(certs, 'san.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\n');
  ssl('x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '2', '-out', 'server.crt', '-extfile', 'san.cnf');
  const password = crypto.randomBytes(24).toString('hex');
  // The server key must be owned by the postgres UID (999) with 0600 before the entrypoint's first server start. The certificates are
  // copied into the created container (never bind-mounted from a Windows path) and installed by a tiny wrapper before the stock
  // entrypoint runs. The data directory is tmpfs: nothing survives `stop`.
  const install = 'mkdir -p /certs && cp /certs-src/server.crt /certs-src/server.key /certs/ && chown -R 999:999 /certs && chmod 600 /certs/server.key && ' +
    'exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/certs/server.crt -c ssl_key_file=/certs/server.key -c max_connections=200';
  docker(['create', '--name', container, '-p', `127.0.0.1:${port}:5432`, '-e', `POSTGRES_PASSWORD=${password}`, '-e', `POSTGRES_DB=${database}`,
    '--tmpfs', '/var/lib/postgresql/data', '--entrypoint', 'sh', image, '-c', install]);
  docker(['cp', toDockerPath(certs), `${container}:/certs-src`]);
  docker(['start', container]);
  keepAlive();
  waitReady();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`;
  fs.writeFileSync(stateFile, JSON.stringify({ DATABASE_URL: url, DIRECT_URL: url, DB_SSL_CA_CERT_PATH: path.join(certs, 'ca.crt'),
    ELECTROHUB_DISPOSABLE_DATABASE: '1' }, null, 2), { mode: 0o600 });
  console.log(`release-e2e-db: ready on 127.0.0.1:${port}/${database} (state: ${path.relative(root, stateFile)})`);
}

function status() {
  console.log(`container ${container}: ${exists()}; state file: ${fs.existsSync(stateFile) ? 'present' : 'absent'}`);
}

const command = process.argv[2];
const commands = { start, stop, status };
if (!commands[command]) fail('usage: release-e2e-db.cjs start|stop|status');
commands[command]();
