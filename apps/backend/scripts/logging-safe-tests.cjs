'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function testArguments(input) {
  if (input.length === 0) return [];
  if (input.length === 2 && ['-t', '--testNamePattern'].includes(input[0]) && input[1].length > 0) return input;
  throw new Error('Logging tests accept only an optional -t TEST_NAME_PATTERN; file paths and configuration overrides are forbidden.');
}

function run(input) {
  let args;
  try { args = testArguments(input); }
  catch (error) { process.stderr.write(`${error.message}\n`); return 2; }
  const backend = path.resolve(__dirname, '..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'electrohub-logging-review-'));
  const database = 'postgresql://logging_only:logging_only@127.0.0.1:1/logging_only?schema=public';
  const env = { ...process.env, NODE_ENV: 'test', ELECTROHUB_LOGGING_OFFLINE: '1', ELECTROHUB_LOG_DIR: directory,
    DATABASE_URL: database, DIRECT_URL: database, JWT_SECRET: crypto.randomBytes(32).toString('hex'), OTP_HASH_SECRET: 'offline-logging-only',
    DB_SSL_CA_CERT_PATH: '', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '',
    GOOGLE_REDIRECT_URI: 'http://127.0.0.1:1/offline', BREVO_API_KEY: '', BREVO_SENDER_EMAIL: 'logging@electrohub-test.invalid',
    CLOUDINARY_URL: '', SUPABASE_ACCESS_TOKEN: '', E2E_TEST_SUPPORT_TOKEN: '', CHECKOUT_LIVE_DEV: 'false', STRIPE_LIVE_DEV: 'false' };
  try {
    const executable = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
    const result = spawnSync(process.execPath, [executable, 'run', '--config', 'vitest.logging.config.mts', ...args], {
      cwd: backend, env, stdio: 'inherit',
    });
    if (result.error) { process.stderr.write('Logging test process failed to start.\n'); return 1; }
    return result.status ?? 1;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

module.exports = { testArguments };
if (require.main === module) process.exitCode = run(process.argv.slice(2));
