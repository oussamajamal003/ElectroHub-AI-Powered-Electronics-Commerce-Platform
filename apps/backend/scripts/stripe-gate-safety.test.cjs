const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const safety = require('./stripe-gate-safety.cjs');
const { main, runnerStartPhase, captureFailureScreenshot, markHostedInputsInteractive } = require('./stripe-browser-gate.cjs');
const { main: checkout } = require('./checkout-browser-gate.cjs');
const { main: cleanup } = require('./stripe-fixture-cleanup.cjs');
const { main: webhook } = require('./stripe-webhook-verifier.cjs');

const runId = '11111111-1111-4111-8111-111111111111';
const userId = '44444444-4444-4444-8444-444444444444';
const productIds = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const fingerprint = 'a'.repeat(64);

test('read-only preflight resolves a relative CA against the backend, independent of caller cwd', () => {
  const inspected = [];
  const result = safety.preflight({ options: { manifestPath: null }, values: { DB_SSL_CA_CERT_PATH: 'certs/dev.pem' },
    backendDir: path.resolve('/owned/backend'), fingerprint, exists: file => { inspected.push(file); return true; } });
  assert.ok(inspected.includes(path.resolve('/owned/backend/certs/dev.pem')));
  assert.ok(!result.blocked.includes('Verified database CA file is unavailable.'));
});
const manifest = { runId, productIds, projectRef: safety.DEV_PROJECT, sourceFingerprint: fingerprint,
  isolatedDev: true, approvedRunner: 'approved-seoul-dev', postgresReliabilityVerified: true, connectionBudgetVerified: true };
const values = { DATABASE_URL: `postgresql://postgres.${safety.DEV_PROJECT}:example@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`,
  DIRECT_URL: `postgresql://postgres.${safety.DEV_PROJECT}:example@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`,
  STRIPE_SECRET_KEY: 'sk_test_' + 'example', DB_SSL_CA_CERT_PATH: 'approved-ca.pem', NODE_ENV: 'test',
  STRIPE_GATE_RUN_AUTHORIZED: runId, STRIPE_GATE_APPROVED_RUNNER: manifest.approvedRunner };
const deps = { values, fingerprint, exists: () => true, readJson: () => manifest, output: () => {} };
const options = safety.parseArguments(['--fixture-manifest=owned.json']);
const preflight = changes => safety.preflight({ options, values, backendDir: '.', fingerprint, exists: () => true, readJson: () => manifest, ...changes });

test('synthetic purchase suite rejects deceptive DEV references before fixture writes', () => {
  assert.doesNotThrow(() => safety.assertSyntheticDevEnvironment(values));
  for (const overrides of [
    { NODE_ENV: 'production' }, { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { DIRECT_URL: `postgresql://postgres:${safety.DEV_PROJECT}@evil.example:5432/postgres` },
    { DATABASE_URL: `postgresql://postgres:example@db.${safety.DEV_PROJECT}.supabase.co.evil.example/postgres` },
    { DIRECT_URL: `postgresql://postgres.${safety.DEV_PROJECT}:example@aws-0-ap-northeast-2.pooler.supabase.com:5432/other` },
  ]) assert.throws(() => safety.assertSyntheticDevEnvironment({ ...values, ...overrides }));
});

test('real gate requires the canonical DEV Stripe account rather than any Test Mode account', () => {
  assert.doesNotThrow(() => safety.assertCanonicalStripeAccount('acct_1UEZW5KiVgdl63pN'));
  for (const account of ['acct_1UEZV83TuYNdQJpp', '', undefined]) {
    assert.throws(() => safety.assertCanonicalStripeAccount(account), /canonical ElectroHub DEV/);
  }
});

test('synthetic suite cleanup preserves evidence after setup failure, failed/skipped tests or unknown outcome', () => {
  assert.equal(safety.syntheticCleanupAllowed(true, ['pass', 'pass']), true);
  assert.equal(safety.syntheticCleanupAllowed(false, ['pass']), false);
  for (const states of [[], ['pass', 'fail'], ['pass', 'skip'], ['pass', undefined], ['run']]) {
    assert.equal(safety.syntheticCleanupAllowed(true, states), false);
  }
});

test('failure screenshots mask hosted frames instead of recording entered card or challenge data', async () => {
  const frames = {}; let captured;
  const page = { locator: selector => { assert.equal(selector, 'iframe'); return frames; },
    screenshot: async options => { captured = options; } };
  await captureFailureScreenshot(page, 'ignored-failure.png');
  assert.deepEqual(captured, { path: 'ignored-failure.png', fullPage: true, mask: [frames] });
});

test('hosted interactivity is recorded after focus verification, independently of onReady and typing', async () => {
  const stages = [];
  const page = { evaluate: async () => { stages.push('mark'); } };
  const field = { focus: async () => { stages.push('focus'); }, evaluate: async check => {
    stages.push('verify'); const input = { ownerDocument: {} }; input.ownerDocument.activeElement = input;
    return check(input);
  } };
  await markHostedInputsInteractive(page, field);
  assert.deepEqual(stages, ['focus', 'verify', 'mark']);
});

test('an unfocusable hosted field cannot produce interactive timing evidence', async () => {
  let marked = false;
  await assert.rejects(markHostedInputsInteractive({ evaluate: async () => { marked = true; } },
    { focus: async () => {}, evaluate: async () => false }), /accept focus/);
  assert.equal(marked, false);
});

test('default and explicit dry-run cannot execute providers or fixtures', async () => {
  let executions = 0;
  for (const argv of [['--fixture-manifest=owned.json'], ['--dry-run', '--fixture-manifest=owned.json']]) assert.equal(await main(argv, { ...deps, execute: async () => { executions++; } }), 0);
  assert.equal(executions, 0);
});
test('missing authorization returns blocked exit code and never executes', async () => {
  let executed = false;
  assert.equal(await main(['--execute', '--fixture-manifest=owned.json'], { ...deps, values: { ...values, STRIPE_GATE_RUN_AUTHORIZED: '' }, execute: async () => { executed = true; } }), 2);
  assert.equal(executed, false);
});
test('even an approved live manifest cannot bypass missing indirect guard installation', async () => {
  let selected;
  assert.equal(await main(['--execute', '--success', '--buy-now', '--fixture-manifest=owned.json'], { ...deps, execute: async (config, flags) => { selected = { config, flags }; } }), 2);
  assert.equal(selected, undefined);
});
test('legacy checkout entrypoint uses PaymentAttempt success scenario', async () => {
  let scenario;
  assert.equal(await checkout(['--execute', '--fixture-manifest=owned.json'], { ...deps, execute: async (_config, flags) => { scenario = flags.scenario; } }), 2);
  assert.equal(scenario, undefined);
});
test('capture recovery starts its worker only after durable capture-pending commit', () => {
  assert.equal(runnerStartPhase('capture-recovery'), 'after-capture-pending');
  for (const scenario of ['success', 'decline-retry', 'sca', 'sca-cancel', 'sca-fail', 'sca-refresh']) {
    assert.equal(runnerStartPhase(scenario), 'before-payment');
  }
  assert.equal(runnerStartPhase('unsupported-scenario'), 'none');
});
test('invalid arguments and ports fail before effects', () => {
  for (const argv of [['--unknown'], ['--execute', '--dry-run'], ['--success', '--decline'], ['--slow', '--slow'], ['--backend-port=0'], ['--backend-port=3136']]) assert.throws(() => safety.parseArguments(argv));
});
test('configurable ports are reflected in options', () => {
  const parsed = safety.parseArguments(['--backend-port=5107', '--frontend-port=3107']);
  assert.equal(parsed.backendPort, 5107); assert.equal(parsed.frontendPort, 3107);
});
test('invalid CLI returns failed-precondition exit code', async () => { assert.equal(await main(['--unknown'], deps), 3); });
test('runtime callback cannot bypass blocked financial execution', async () => {
  let executions = 0;
  assert.equal(await main(['--execute', '--fixture-manifest=owned.json'], { ...deps, execute: async () => { executions++; } }), 2);
  assert.equal(executions, 0);
});
test('production, wrong project, deceptive hostname and disabled TLS are rejected', () => {
  for (const overrides of [{ NODE_ENV: 'production' }, { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { DIRECT_URL: 'postgresql://postgres:example@db.yepfgjehdstlxbpespun.supabase.co/postgres' },
    { DIRECT_URL: `postgresql://postgres.${safety.DEV_PROJECT}:example@evil.example/postgres` }]) assert.equal(preflight({ values: { ...values, ...overrides } }).status, 'FAILED_PRECONDITION');
});
test('live provider configuration is rejected without showing key', () => {
  for (const key of ['sk_live_' + 'example', 'not-a-test-key']) {
    const result = preflight({ values: { ...values, STRIPE_SECRET_KEY: key } });
    assert.equal(result.status, 'FAILED_PRECONDITION'); assert.ok(!JSON.stringify(result).includes(key));
  }
});
test('missing built runtime, CA or manifest reports blocked', () => {
  assert.equal(preflight({ exists: () => false }).status, 'BLOCKED_BY_ENVIRONMENT');
  assert.equal(preflight({ options: safety.parseArguments([]) }).status, 'BLOCKED_BY_ENVIRONMENT');
});
test('unapproved, stale and secret-bearing manifests fail', () => {
  for (const change of [{ isolatedDev: false }, { sourceFingerprint: 'b'.repeat(64) }, { connectionBudgetVerified: false }, { token: 'forbidden' }, { productIds: [productIds[0], productIds[0]] }]) assert.throws(() => safety.validateManifest({ ...manifest, ...change }, fingerprint));
});
test('listener reuse cannot accept a stale signing secret', () => { assert.equal(preflight({ values: { ...values, STRIPE_GATE_REUSE_WEBHOOK_LISTENER: 'true' } }).status, 'FAILED_PRECONDITION'); });
test('env loading follows test runtime with protected inherited fields', () => {
  const read = file => path.basename(file) === '.env' ? { DATABASE_URL: 'base', STRIPE_SECRET_KEY: 'base-key' } : { DATABASE_URL: 'test-local', STRIPE_SECRET_KEY: 'test-key', PORT: '5001', STRIPE_WEBHOOK_SECRET: 'stale' };
  const result = safety.loadTestEnvironment('.', { DATABASE_URL: 'inherited', PORT: '5136', STRIPE_WEBHOOK_SECRET: 'active' }, read);
  assert.equal(result.DATABASE_URL, 'test-local'); assert.equal(result.STRIPE_SECRET_KEY, 'test-key');
  assert.equal(result.PORT, '5136'); assert.equal(result.STRIPE_WEBHOOK_SECRET, 'active');
  assert.throws(() => safety.loadTestEnvironment('.', { NODE_ENV: 'production' }, read));
});
test('database classification separates session, transaction and direct endpoints', () => {
  assert.equal(safety.describeDatabase(values.DIRECT_URL).kind, 'SESSION_POOLER'); assert.equal(safety.describeDatabase(values.DATABASE_URL).kind, 'TRANSACTION_POOLER');
  assert.equal(safety.describeDatabase(`postgresql://postgres:example@db.${safety.DEV_PROJECT}.supabase.co/postgres`).kind, 'DIRECT');
});
test('fixture approval rejects hidden fixtures and curated Products', () => {
  const approved = safety.validateManifest(manifest, fingerprint);
  const products = productIds.map((id, index) => ({ id, sku: `${approved.label}-${index}`, category: { name: approved.label, isActive: true }, isTestFixture: false, storefrontVisible: false, status: 'ACTIVE', price: { toFixed: () => index === 0 ? '1.00' : '0.50' }, inventory: { quantity: 10 } }));
  assert.doesNotThrow(() => safety.assertFixtureProducts(products, approved));
  for (const change of [{ isTestFixture: true }, { storefrontVisible: true }, { sku: 'curated' }, { inventory: { quantity: 9 } }, { status: 'INACTIVE' }]) assert.throws(() => safety.assertFixtureProducts([{ ...products[0], ...change }, products[1]], approved));
});
test('unknown occupied port fails without killing owner', async () => {
  const server = new EventEmitter(); server.listen = () => queueMicrotask(() => server.emit('error', new Error('occupied')));
  let killed = false; server.kill = () => { killed = true; };
  await assert.rejects(safety.assertPortAvailable(5107, () => server), /no existing process was replaced/); assert.equal(killed, false);
});
test('registry stops only tracked live children without duplicate kill', () => {
  const registry = new safety.OwnedProcesses();
  const make = pid => Object.assign(new EventEmitter(), { pid, exitCode: null, killed: false, kill() { this.killed = true; return true; } });
  const owned = make(123); const foreign = make(456);
  registry.track(owned); assert.equal(registry.stop(foreign), false); assert.equal(foreign.killed, false);
  registry.stopAll(); assert.equal(owned.killed, true); assert.equal(registry.stop(owned), false); assert.throws(() => registry.track({ pid: undefined }));
});
test('exited children cannot later be killed by cleanup', () => {
  const registry = new safety.OwnedProcesses(); const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, killed: false, kill() { throw new Error('must not kill'); } });
  registry.track(child); child.emit('exit', 0); registry.stopAll();
});
test('cleanup preserves captured, uncertain, declined and cross-user state', () => {
  const approved = safety.validateManifest(manifest, fingerprint); const user = { id: userId, email: `${approved.label}@example.invalid` };
  const base = { manifest: approved, user, attempts: [], orders: [], payments: [], providerIntents: [] };
  assert.equal(safety.cleanupEligibility(base).allowed, true);
  for (const state of ['PAID', 'CAPTURE_PENDING', 'DECLINED', 'AUTHORIZING', 'INCIDENT']) assert.equal(safety.cleanupEligibility({ ...base, attempts: [{ id: runId, userId, state }] }).allowed, false);
  assert.equal(safety.cleanupEligibility({ ...base, orders: [{}] }).allowed, false);
  assert.equal(safety.cleanupEligibility({ ...base, attempts: [{ id: runId, userId: productIds[0], state: 'CANCELED' }] }).allowed, false);
  assert.throws(() => safety.cleanupEligibility({ ...base, user: { ...user, email: 'customer@example.invalid' } }));
});
test('canceled cleanup requires provider cancellation and completed work', () => {
  const approved = safety.validateManifest(manifest, fingerprint); const user = { id: userId, email: `${approved.label}@example.invalid` };
  const attempt = { id: runId, userId, state: 'CANCELED', providerIntentId: 'pi_example', stripeAccountId: 'acct_example', amountCents: 50, currency: 'USD', work: { state: 'DONE' } };
  const intent = { id: 'pi_example', attemptId: runId, account: 'acct_example', amount: 50, currency: 'usd', captureMethod: 'manual', livemode: false, received: 0, capturable: 0, status: 'canceled' };
  const base = { manifest: approved, user, attempts: [attempt], orders: [], payments: [], providerIntents: [intent] };
  assert.equal(safety.cleanupEligibility(base).allowed, true);
  assert.equal(safety.cleanupEligibility({ ...base, providerIntents: [] }).allowed, false);
  assert.equal(safety.cleanupEligibility({ ...base, attempts: [{ ...attempt, work: { state: 'LEASED' } }] }).allowed, false);
});
test('secret-safe output redacts keys, URLs, client secrets and passwords', () => {
  const secrets = ['sk_test_' + 'private', 'whsec_' + 'private', 'pi_example_secret_' + 'private', values.DIRECT_URL, 'Bearer private-token', 'password=private-password'];
  const output = safety.sanitize(secrets.join('\n')); for (const secret of secrets) assert.ok(!output.includes(secret));
});
test('split secret chunks remain redacted', () => {
  let text = ''; const stream = { write(chunk) { text += chunk; return true; } }; const restore = safety.installSanitizedOutput(stream);
  stream.write('sk_te'); stream.write('st_private\n'); restore(); assert.equal(text, '[REDACTED]\n');
});
test('dry-run report is never financial acceptance', async () => {
  const reports = []; await main(['--dry-run', '--fixture-manifest=owned.json'], { ...deps, output: value => reports.push(value) });
  assert.equal(reports[0].financialAcceptance, 'NOT_VERIFIED'); assert.equal(reports[0].manifest, undefined);
});
test('cleanup dry-run cannot delete records even when all static prerequisites exist', async () => {
  let executed = false;
  assert.equal(await cleanup(['--dry-run', '--ownership-manifest=owned.json'], { ...deps, readOwnership: () => ({ manifest, userId }), execute: async () => { executed = true; } }), 0);
  assert.equal(executed, false);
});
test('cleanup execution requires separate run-scoped authorization', async () => {
  let executed = false;
  assert.equal(await cleanup(['--execute', '--ownership-manifest=owned.json'], { ...deps, readOwnership: () => ({ manifest, userId }), execute: async () => { executed = true; } }), 2);
  assert.equal(executed, false);
});
test('cleanup accepts only explicit ownership manifest arguments', async () => {
  assert.equal(await cleanup([userId], deps), 3);
});
test('webhook verifier defaults to preflight without starting a listener', async () => {
  let executed = false;
  assert.equal(await webhook(['--dry-run', '--fixture-manifest=owned.json'], { ...deps, execute: async () => { executed = true; } }), 0);
  assert.equal(executed, false);
});
