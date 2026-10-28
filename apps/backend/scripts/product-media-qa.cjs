'use strict';
// Creates a fresh database only inside the launcher's authenticated disposable cluster.
// No database is dropped; no shared credential or provider operation is used.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { disposableUrlIssue } = require('./dev-isolated.cjs');
const backend = path.resolve(__dirname, '..');
const home = path.join(backend, '.isolated-docker');
const state = JSON.parse(fs.readFileSync(path.join(home, 'env.json'), 'utf8'));
const issue = disposableUrlIssue(state.DATABASE_URL, fs.readFileSync(path.join(home, 'password.txt'), 'utf8').trim());
if (issue) throw new Error('MEDIA_QA_TARGET_REFUSED');
function connection(url) {
  const endpoint = new URL(url);
  endpoint.search = '';
  return { connectionString: endpoint.toString(), ssl: { ca: fs.readFileSync(state.DB_SSL_CA_CERT_PATH, 'utf8'), rejectUnauthorized: true } };
}
async function main() {
  const admin = new Client(connection(state.DATABASE_URL));
  await admin.connect();
  let database;
  try {
    const identity = (await admin.query("SELECT current_database() AS name, inet_server_port() AS port, ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()" )).rows[0];
    if (identity.name !== 'electrohub_disposable' || identity.port !== 55434 || !identity.ssl) throw new Error('MEDIA_QA_IDENTITY_REFUSED');
    database = `electrohub_disposable_media_${crypto.randomBytes(5).toString('hex')}`;
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  const url = new URL(state.DATABASE_URL); url.pathname = `/${database}`;
  const cli = new URL(url); cli.search = '?sslmode=disable';
  const runtime = { ...process.env, DATABASE_URL: url.toString(), DIRECT_URL: url.toString(), DB_SSL_CA_CERT_PATH: state.DB_SSL_CA_CERT_PATH,
    NODE_ENV: 'test', PRODUCT_MEDIA_QA_RUN: database, JWT_SECRET: crypto.randomBytes(48).toString('hex'),
    STRIPE_SECRET_KEY: '', BREVO_API_KEY: '', SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_PROJECT_REF: '', PRODUCT_MEDIA_BUCKET: '',
    AI_SERVICE_URL: '', AI_SERVICE_API_KEY: '', COMMERCE_EMAIL_ENQUEUE_ENABLED: 'false', COMMERCE_EMAIL_DISPATCH_ENABLED: 'false' };
  const run = (args, env = runtime) => {
    const result = spawnSync(process.execPath, args, { cwd: backend, env, stdio: 'inherit' });
    if (result.status !== 0) throw new Error('MEDIA_QA_COMMAND_FAILED');
  };
  for (let pass = 0; pass < 2; pass++) run(['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { ...runtime, DATABASE_URL: cli.toString(), DIRECT_URL: cli.toString() });
  const client = new Client(connection(url)); await client.connect();
  try {
    const ledger = (await client.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name')).rows;
    const dirs = fs.readdirSync(path.join(backend, 'prisma/migrations')).filter(name => /^\d{14}_/.test(name)).sort();
    if (ledger.length !== dirs.length) throw new Error('MEDIA_QA_LEDGER_COUNT');
    for (const row of ledger) {
      const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(backend, 'prisma/migrations', row.migration_name, 'migration.sql'))).digest('hex');
      if (hash !== row.checksum || !row.finished_at || row.rolled_back_at) throw new Error('MEDIA_QA_LEDGER_CHECKSUM');
    }
    console.log(`PASS clean replay, no-op replay and ${ledger.length} exact migration checksums (${database})`);
  } finally { await client.end(); }
  fs.writeFileSync(path.join(home, 'media-qa.json'), JSON.stringify({ ...runtime, database }), { mode: 0o600 });
  if (process.argv.includes('--ci')) {
    run([path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs'), 'run', '--exclude', 'tests/adminSeedLogin.test.ts', '--exclude', 'tests/auth.integration.test.ts', '--maxWorkers', '2'],
      { ...runtime, STRIPE_SECRET_KEY: 'sk_test_placeholder', STRIPE_WEBHOOK_SECRET: 'whsec_test_placeholder',
        JWT_REFRESH_SECRET: crypto.randomBytes(48).toString('hex'), OTP_HASH_SECRET: crypto.randomBytes(48).toString('hex'),
        TEMP: path.join(rootDirectory(), '.tmp'), TMP: path.join(rootDirectory(), '.tmp') });
  } else if (!process.argv.includes('--schema-only')) run(['--import', 'tsx', 'scripts/product-media-qa.ts']);
}
function rootDirectory() { return path.resolve(backend, '../..'); }
main().catch(() => { console.error('Product-media QA failed; inspect preceding sanitized command output.'); process.exitCode = 1; });
