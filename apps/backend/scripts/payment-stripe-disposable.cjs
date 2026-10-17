/*
 * Task 03.6 real Stripe Test Mode acceptance runner against a DISPOSABLE PostgreSQL instance.
 *
 * This is its own entrypoint with its own approval, authorization and secrets. It never starts the A-S PostgreSQL suite
 * (payment-pg-disposable.cjs) and that runner never starts this one. It reuses only the disposable target proof and process
 * containment from payment-pg-disposable.cjs. It never touches the shared DEV project, never reads DEV login data, never uses
 * DATABASE_URL/DIRECT_URL from the environment or env files, and refuses live Stripe keys.
 *
 * It performs REAL Stripe Test Mode operations (PaymentIntent creation, authorization, capture, cancel, refund) on disposable
 * fixtures. It must only be run after the Project Owner authorizes the exact account, allowance and operations:
 *
 *   PAYMENT_STRIPE_DISPOSABLE_APPROVED=true
 *   PAYMENT_STRIPE_DISPOSABLE_EXPECTED_ACCOUNT=acct_...
 *   PAYMENT_STRIPE_DISPOSABLE_ALLOWANCE_CENTS=<positive integer>
 *   PAYMENT_STRIPE_DISPOSABLE_AUTHORIZATION=STRIPE-TEST:<account>:<allowance>:DISPOSABLE:<database>:create+authorize+capture+cancel+refund:disposable-fixtures
 *   STRIPE_SECRET_KEY=sk_test_...        (explicit; never read from env files)
 *   plus the disposable-PostgreSQL variables (PAYMENT_PG_DISPOSABLE_URL, _CA_FILE, _APPROVED, and _AUTHORIZATION for scope stripe-live)
 *
 *   node scripts/payment-stripe-disposable.cjs --check-config   # offline: no database, no Stripe call
 *   node scripts/payment-stripe-disposable.cjs --run            # proves the target, migrates, runs the live suite, verifies cleanup
 *
 * Ambiguous provider outcomes are read back by the suite; nothing here ever replays a capture or refund.
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const disposable = require('./payment-pg-disposable.cjs');

const backendRoot = path.resolve(__dirname, '..');
const TEST_FILE = 'src/services/__tests__/payment.stripe.live.test.ts';
const CONFIG_FILE = 'vitest.config.mts';
const MIN_EXPECTED_TESTS = 26;
const MAX_ALLOWANCE_CENTS = 10_000_000;
const LIVE_STRIPE = /(?:sk|rk|pk)_live_/i;
const BUILD_WATCH = ['src/services/payment.service.ts', 'src/services/order.service.ts', 'src/services/payment.domain.ts', 'src/services/stripe.provider.ts',
  'src/services/cart.service.ts', 'src/services/inventory.service.ts', 'src/payment-runner.ts', 'src/lib/prisma.ts'];
const FIXTURE_PREFIX = 'payment-gate-';

function expectedStripeAuthorization(account, allowance, database) {
  return `STRIPE-TEST:${account}:${allowance}:DISPOSABLE:${database}:create+authorize+capture+cancel+refund:disposable-fixtures`;
}

/** Offline validation. Returns { error } or { config, stripe }. No network, no database. */
function validateStripeConfiguration(env = process.env, options = {}) {
  const fail = error => ({ error });
  if (env.PAYMENT_STRIPE_DISPOSABLE_APPROVED !== 'true') return fail('PAYMENT_STRIPE_DISPOSABLE_APPROVED=true is required (a separate approval from the PostgreSQL suites).');
  if (env.PAYMENT_STRIPE_LIVE_DEV === 'true') return fail('The DEV live-suite flag is set; refusing an ambiguous execution mode.');
  const pg = disposable.validateConfiguration(env, { ...options, scope: 'stripe-live' });
  if (pg.error) return pg;
  const account = env.PAYMENT_STRIPE_DISPOSABLE_EXPECTED_ACCOUNT ?? '';
  const allowance = Number(env.PAYMENT_STRIPE_DISPOSABLE_ALLOWANCE_CENTS ?? '');
  if (!/^acct_[A-Za-z0-9]+$/.test(account)) return fail('PAYMENT_STRIPE_DISPOSABLE_EXPECTED_ACCOUNT must be the exact Stripe Test Mode account id.');
  if (!Number.isInteger(allowance) || allowance <= 0 || allowance > MAX_ALLOWANCE_CENTS) return fail('PAYMENT_STRIPE_DISPOSABLE_ALLOWANCE_CENTS must be a positive integer within the sanity ceiling.');
  if (env.PAYMENT_STRIPE_DISPOSABLE_AUTHORIZATION !== expectedStripeAuthorization(account, allowance, pg.config.database)) {
    return fail('PAYMENT_STRIPE_DISPOSABLE_AUTHORIZATION does not match the exact account, allowance, database and operation set.');
  }
  const key = env.STRIPE_SECRET_KEY ?? '';
  if (!key.startsWith('sk_test_') || LIVE_STRIPE.test(key)) return fail('STRIPE_SECRET_KEY must be set explicitly and be a Stripe Test Mode secret key.');
  return { config: pg.config, stripe: { account, allowance, key } };
}

/** The compiled runner is spawned by the suite: refuse a missing or stale build instead of testing old code. */
function checkBuild(root = backendRoot, stat = fs.statSync) {
  let built;
  try { built = stat(path.join(root, 'dist/payment-runner.js')).mtimeMs; } catch { return 'dist/payment-runner.js is missing; run the backend build first.'; }
  for (const file of BUILD_WATCH) {
    let modified;
    try { modified = stat(path.join(root, file)).mtimeMs; } catch { continue; }
    if (modified > built + 1000) return `The compiled build is older than ${file}; rebuild before the run.`;
  }
  return null;
}

/** Child environment: explicit and minimal on database/secret identity; nothing from env files can select a target. */
function liveStage(name, args, env, timeoutMs) { return { name, args, env, timeoutMs }; }
function stageDefinitions(config, stripe, identity, env = process.env, random = crypto.randomBytes, { probeFile } = {}) {
  const base = { ...disposable.scrubbedEnvironment(env), NODE_ENV: 'test', DATABASE_URL: config.url, DIRECT_URL: config.url,
    DB_SSL_CA_CERT_PATH: config.caFile, NODE_EXTRA_CA_CERTS: config.caFile, JWT_SECRET: random(48).toString('base64url'),
    STRIPE_SECRET_KEY: stripe.key, STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET || 'whsec_local_signature_fixture_only',
    ELECTROHUB_SQL_DIAGNOSTICS: '0' };
  const cliUrl = disposable.strictCliUrl(config, 'public'); // strict native TLS against the per-run CA
  const prismaCli = path.join(backendRoot, 'node_modules/prisma/build/index.js');
  const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  return [
    liveStage('migration_tls', [prismaCli, 'db', 'execute', '--schema', 'prisma/schema.prisma', '--file', probeFile ?? ''],
      { ...base, DATABASE_URL: cliUrl, DIRECT_URL: cliUrl }, 60_000),
    liveStage('migration', [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      { ...base, DATABASE_URL: cliUrl, DIRECT_URL: cliUrl }, 180_000),
    liveStage('tests', [vitest, 'run', '--pool=forks', '--maxWorkers=1', '--no-file-parallelism', TEST_FILE, '--config', CONFIG_FILE,
      '--reporter=json', '--testTimeout=300000', '--hookTimeout=300000'],
    { ...base, PAYMENT_STRIPE_LIVE_DISPOSABLE: 'true', PAYMENT_STRIPE_LIVE_EXPECTED_ACCOUNT: stripe.account,
      PAYMENT_STRIPE_LIVE_ALLOWANCE_CENTS: String(stripe.allowance),
      PAYMENT_STRIPE_LIVE_AUTHORIZATION: expectedStripeAuthorization(stripe.account, stripe.allowance, config.database),
      PAYMENT_PG_DISPOSABLE_URL: config.url, PAYMENT_PG_DISPOSABLE_CA_FILE: config.caFile, PAYMENT_PG_DISPOSABLE_APPROVED: 'true',
      PAYMENT_PG_DISPOSABLE_AUTHORIZATION: disposable.expectedAuthorization(config.database, 'stripe-live'),
      PAYMENT_PG_DISPOSABLE_RUN_ID: identity.runId }, 2_400_000),
  ];
}

/** Every live case must have run and passed; skipped or failed cases mean the acceptance run is not valid. */
function verifyLiveReport(stdout, root = backendRoot) {
  const start = stdout.search(/\{\s*"numTotalTestSuites"\s*:/);
  let report;
  try { report = JSON.parse(stdout.slice(start)); } catch { throw disposable.failure('TEST_REPORT_INVALID'); }
  const files = report.testResults;
  if (start < 0 || report.success !== true || !Number.isInteger(report.numTotalTests) || report.numTotalTests < MIN_EXPECTED_TESTS ||
      report.numPassedTests !== report.numTotalTests || report.numFailedTests !== 0 || report.numPendingTests !== 0 || report.numTodoTests !== 0 ||
      !Array.isArray(files) || files.length !== 1 || path.resolve(files[0].name) !== path.resolve(root, TEST_FILE) ||
      (files[0].assertionResults ?? []).length !== report.numTotalTests || files[0].assertionResults.some(test => test.status !== 'passed')) {
    throw disposable.failure('LIVE_TESTS_FAILED_SKIPPED_OR_WRONG_SELECTION');
  }
  return { passed: report.numTotalTests, failed: 0, skipped: 0 };
}

/** Read-only: no fixture of this suite may remain, and no relation outside public may exist. */
async function verifyNoResidue(client) {
  const result = await client.query(`SELECT
    (SELECT count(*)::int FROM "users" WHERE "email" LIKE $1) AS users,
    (SELECT count(*)::int FROM "products" WHERE "sku" LIKE $2) AS products,
    (SELECT count(*)::int FROM "categories" WHERE "slug" LIKE $2) AS categories`, [`${FIXTURE_PREFIX}%@example.invalid`, `${FIXTURE_PREFIX}%`]);
  const row = result.rows[0];
  if (row.users !== 0 || row.products !== 0 || row.categories !== 0) throw disposable.failure('FIXTURE_RESIDUE_REMAINS');
  return row;
}

async function main(argv = process.argv.slice(2)) {
  const validated = validateStripeConfiguration();
  if (validated.error) { console.error(`BLOCKED: ${validated.error}`); process.exitCode = 2; return; }
  const { config, stripe } = validated;
  const buildError = checkBuild();
  if (buildError) { console.error(`BLOCKED: ${buildError}`); process.exitCode = 2; return; }
  if (argv.includes('--check-config')) {
    console.log('CONFIG PASS: disposable target proof inputs, exact Stripe Test Mode authorization, test key mode and build freshness; no database or Stripe call made.');
    return;
  }
  if (!argv.includes('--run')) { console.error('BLOCKED: pass --run for the authorized run or --check-config for offline validation.'); process.exitCode = 2; return; }

  const identity = disposable.newRunIdentity();
  const client = disposable.createClient(config);
  const owner = new AbortController();
  const onSignal = () => owner.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  let failed = false;
  let treeStopped = true;
  let probeFile = null;
  try {
    await client.connect();
    const proof = await disposable.verifyDisposableServer(client, { expectedDatabase: config.database });
    console.log(`DISPOSABLE TARGET PROVED: PostgreSQL ${proof.version}, database ${proof.database}, verified TLS, dedicated and empty.`);
    await disposable.markDatabase(client, config.database, identity.marker);
    probeFile = disposable.writeProbeFile(config.database, 'public');
    for (const stage of stageDefinitions(config, stripe, identity, process.env, crypto.randomBytes, { probeFile })) {
      const result = await disposable.runStage(stage, { signal: owner.signal });
      if (stage.name === 'tests') {
        if (process.env.PAYMENT_STRIPE_DISPOSABLE_REPORT_FILE) fs.writeFileSync(process.env.PAYMENT_STRIPE_DISPOSABLE_REPORT_FILE, result.stdout, 'utf8');
        verifyLiveReport(result.stdout);
      }
      console.log(`${stage.name.toUpperCase()} PASS`);
    }
  } catch (error) {
    failed = true;
    if (error && error.treeStopped === false) treeStopped = false;
    // Owner-requested evidence: keep the child's JSON report even when the stage fails.
    if (process.env.PAYMENT_STRIPE_DISPOSABLE_REPORT_FILE && typeof error?.stdout === 'string') {
      try { fs.writeFileSync(process.env.PAYMENT_STRIPE_DISPOSABLE_REPORT_FILE, error.stdout, 'utf8'); } catch { /* evidence only */ }
    }
    console.error(`SUITE FAIL: ${error && error.label ? error.label : 'EXECUTION_FAILED'}`);
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    if (probeFile && treeStopped) { try { fs.rmSync(probeFile, { force: true }); } catch { /* temp probe only */ } }
    if (!treeStopped) {
      console.error(`RESIDUE CHECK SKIPPED: child termination could not be confirmed; fixtures and provider intents prefixed ${FIXTURE_PREFIX} may remain (database marker ${identity.marker}).`);
    } else {
      try { await verifyNoResidue(client); console.log('CLEANUP VERIFIED: no suite fixture remains in the disposable database.'); }
      catch (error) { failed = true; console.error(`CLEANUP FAIL: ${error && error.label ? error.label : 'RESIDUE_CHECK_FAILED'}`); }
    }
    try { await client.end(); } catch { /* connection already closed */ }
  }
  if (failed) process.exitCode = 1;
  else console.log('REAL STRIPE TEST MODE SUITE PASS on a disposable PostgreSQL instance. The instance itself is destroyed by its provisioner.');
}

module.exports = { TEST_FILE, MIN_EXPECTED_TESTS, FIXTURE_PREFIX, expectedStripeAuthorization, validateStripeConfiguration, checkBuild,
  stageDefinitions, verifyLiveReport, verifyNoResidue };

if (require.main === module) main().catch(() => { console.error('FATAL: STRIPE_DISPOSABLE_RUNNER_FAILED'); process.exitCode = 1; });
