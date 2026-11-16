#!/usr/bin/env node
'use strict';
/**
 * Task 06.1 release-critical E2E backend stack (DISPOSABLE only). Started by apps/frontend/playwright.release.config.ts as a webServer.
 *
 *   1. Resolves the database: in CI the .github/actions/disposable-postgres outputs (ELECTROHUB_DISPOSABLE_DATABASE=1); locally the state
 *      written by `node scripts/release-e2e-db.cjs start`. Refuses anything that is not a loopback `electrohub_ci*`/`electrohub_disposable*`
 *      database, before any command runs.
 *   2. `prisma migrate deploy` (the repository's real migrations, pgvector included) and the release fixtures.
 *   3. Runs the real backend with NODE_ENV=test and ELECTROHUB_ENV_FILES=none: no `.env` file is read, so the process is configured only by
 *      the hermetic environment below. No email provider (OTP mail is captured to a local outbox), no Stripe key, no AI service, no Google
 *      OAuth: nothing leaves the machine. Payment availability is therefore the "provider unavailable" path; genuine Stripe Test Mode is
 *      covered separately by the isolated real-Stripe harness (docs/08_Quality/E2E.md).
 *
 * Environment: RELEASE_E2E_API_PORT (default 5206), RELEASE_E2E_FRONTEND_PORT (default 3206).
 */
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const backend = path.resolve(__dirname, '..');
const root = path.resolve(backend, '../..');
const home = path.join(root, '.cache', 'release-e2e');
const apiPort = process.env.RELEASE_E2E_API_PORT || '5206';
const frontendOrigin = `http://localhost:${process.env.RELEASE_E2E_FRONTEND_PORT || '3206'}`;
const supportToken = process.env.E2E_TEST_SUPPORT_TOKEN || 'electrohub-release-e2e-support-only';

const fail = message => { process.stderr.write(`release-e2e-stack: ${message}\n`); process.exit(1); };

function databaseEnvironment() {
  const source = process.env.ELECTROHUB_DISPOSABLE_DATABASE === '1' && process.env.DATABASE_URL
    ? { DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL, DB_SSL_CA_CERT_PATH: process.env.DB_SSL_CA_CERT_PATH }
    : (() => {
      const stateFile = path.join(home, 'db.json');
      if (!fs.existsSync(stateFile)) fail('no disposable database. Run `node apps/backend/scripts/release-e2e-db.cjs start` first.');
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    })();
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    let url;
    try { url = new URL(source[key]); } catch { fail(`${key} is not a valid URL.`); }
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !/^electrohub_(?:disposable|ci)[a-z0-9_]*$/.test(url.pathname.slice(1))) {
      fail(`${key} is not a disposable loopback database; refusing to migrate, seed or start anything.`);
    }
  }
  if (!source.DB_SSL_CA_CERT_PATH || !fs.existsSync(source.DB_SSL_CA_CERT_PATH)) fail('the disposable database CA certificate is missing.');
  // The runtime ignores URL ssl parameters and always verifies TLS against the CA; strip them for the application.
  const runtime = url => { const u = new URL(url); u.search = ''; return u.toString(); };
  return { DATABASE_URL: runtime(source.DATABASE_URL), DIRECT_URL: runtime(source.DIRECT_URL), DB_SSL_CA_CERT_PATH: source.DB_SSL_CA_CERT_PATH };
}

const database = databaseEnvironment();
fs.mkdirSync(home, { recursive: true });
const outbox = path.join(home, 'outbox');
fs.rmSync(outbox, { recursive: true, force: true });
fs.mkdirSync(outbox, { recursive: true });
// Concurrent ports and a previous Windows child draining after shutdown must never contend for one logging lease.
const logs = fs.mkdtempSync(path.join(home, 'logs-'));

// Hermetic base: only what the OS/toolchain needs, never inherited application secrets.
const passthrough = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec',
  'CI', 'GITHUB_ACTIONS', 'RUNNER_TEMP', 'PROGRAMDATA', 'ProgramData', 'WINDIR', 'NUMBER_OF_PROCESSORS', 'OS'];
const base = Object.fromEntries(passthrough.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
const cliUrl = url => { const u = new URL(url); u.search = 'sslmode=disable'; return u.toString(); };
const tsx = path.join(path.dirname(require.resolve('tsx/package.json', { paths: [backend] })), 'dist/cli.mjs');
const prismaCli = require.resolve('prisma/build/index.js', { paths: [backend] });

function step(label, args, env) {
  const result = spawnSync(process.execPath, args, { cwd: backend, env, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) fail(`${label} failed.`);
}

const cliEnv = { ...base, ELECTROHUB_ENV_FILES: 'none', DATABASE_URL: cliUrl(database.DATABASE_URL), DIRECT_URL: cliUrl(database.DIRECT_URL) };
step('prisma migrate deploy', [prismaCli, 'migrate', 'deploy'], cliEnv);

const appEnv = {
  ...base,
  NODE_ENV: 'test', ELECTROHUB_ENV_FILES: 'none', PORT: apiPort, ...database,
  JWT_SECRET: crypto.randomBytes(48).toString('base64url'), JWT_REFRESH_SECRET: crypto.randomBytes(48).toString('base64url'),
  OTP_HASH_SECRET: crypto.randomBytes(24).toString('base64url'),
  ADMIN_MFA_ENCRYPTION_KEYS: `1:${crypto.randomBytes(32).toString('base64')}`, ADMIN_MFA_ACTIVE_KEY_VERSION: '1',
  FRONTEND_URL: frontendOrigin, WEBAUTHN_RP_ID: 'localhost', WEBAUTHN_ORIGIN: frontendOrigin,
  E2E_OTP_OUTBOX_DIR: outbox, E2E_TEST_SUPPORT_TOKEN: supportToken, ELECTROHUB_LOG_DIR: logs,
  COMMERCE_EMAIL_SEND_MODE: 'disabled', PAYMENT_CONFIRMATION_SIGNAL: 'false',
};
step('release fixtures', [tsx, 'scripts/fixtures/release-e2e-seed.ts', path.join(home, 'fixtures.json')], appEnv);

const child = spawn(process.execPath, [tsx, 'src/bootstrap.ts'], { cwd: backend, env: appEnv, stdio: 'inherit', windowsHide: true });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.once('exit', code => { process.exitCode = code ?? 1; });
