'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { applicationEnvironment, testStripeKeyError, childEnvironment, disposableUrlIssue, databaseUrlsIssue, runVerifiedMigration, isolatedBackendPort } = require('./dev-isolated.cjs');

test('reserved ports cannot be selected through numeric aliases', () => {
  for (const value of ['5000', '05000', '3000', '03000', '3200', '03200', '0', '65536', '52e2']) {
    assert.throws(() => isolatedBackendPort(value), /isolated backend port/);
  }
  assert.equal(isolatedBackendPort(), '5200');
  assert.equal(isolatedBackendPort('05200'), '5200');
});

const pass = 'fixture-password-0123456789';
const dbUrl = `postgresql://postgres:${pass}@localhost:55434/electrohub_disposable`;
const env = { DATABASE_URL: dbUrl, DIRECT_URL: dbUrl };

test('isolated launcher uses application dotenv precedence without printing or exposing values', () => {
  const files = { '.env': { STRIPE_SECRET_KEY: 'base', PAYMENT_SHARED_MUTATIONS_APPROVED: 'base-approval', BASE_ONLY: 'yes' },
    '.env.local': { STRIPE_SECRET_KEY: 'local', PAYMENT_SHARED_MUTATIONS_APPROVED: 'local-approval', LOCAL_ONLY: 'yes' } };
  const resolved = applicationEnvironment({ STRIPE_SECRET_KEY: 'process', PROCESS_ONLY: 'yes' }, name => files[name]);
  assert.equal(resolved.STRIPE_SECRET_KEY, 'process');
  assert.equal(resolved.PAYMENT_SHARED_MUTATIONS_APPROVED, 'local-approval');
  assert.deepEqual([resolved.BASE_ONLY, resolved.LOCAL_ONLY, resolved.PROCESS_ONLY], ['yes', 'yes', 'yes']);
});

test('isolated backend accepts only absent or syntactically valid Stripe Test Mode keys', () => {
  assert.equal(testStripeKeyError({}), null);
  assert.equal(testStripeKeyError({ STRIPE_SECRET_KEY: 'sk_test_abc123' }), null);
  assert.equal(testStripeKeyError({ STRIPE_SECRET_KEY: 'rk_test_abc123' }), null);
  for (const key of ['sk_live_abc123', 'rk_live_abc123', 'pk_test_public', 'sk_test_', 'garbage']) {
    assert.match(testStripeKeyError({ STRIPE_SECRET_KEY: key }), /Stripe Test Mode/);
  }
});

test('isolated child clears inherited and dotenv-loaded payment approvals and supervisor state', () => {
  const source = { PATH: 'kept', PAYMENT_SHARED_MUTATIONS_APPROVED: 'shared-target', PAYMENT_SUPERVISOR_ATTESTATION: 'stale',
    ELECTROHUB_PAYMENT_SUPERVISOR_TOKEN: 'stale', PAYMENT_DEV_SUPERVISED: '1', PAYMENT_PG_TEST_APPROVED: 'true', PAYMENT_CONFIRMATION_SIGNAL: 'false' };
  const built = childEnvironment(env, { COMMERCE_EMAIL_SEND_MODE: 'capture' }, { NODE_ENV: 'development' }, source);
  assert.equal(built.PATH, 'kept');
  assert.equal(built.PAYMENT_SHARED_MUTATIONS_APPROVED, '');
  assert.equal(built.PAYMENT_SUPERVISOR_ATTESTATION, '');
  assert.equal(built.PAYMENT_DEV_SUPERVISED, '');
  assert.equal(built.ELECTROHUB_PAYMENT_SUPERVISOR_TOKEN, '');
  assert.equal(built.PAYMENT_PG_TEST_APPROVED, '');
  assert.equal(built.PAYMENT_CONFIRMATION_SIGNAL, 'false');
  assert.equal(built.COMMERCE_EMAIL_SEND_MODE, 'capture');
});

test('database target must be this exact loopback PostgreSQL cluster and credential', () => {
  assert.equal(disposableUrlIssue(dbUrl, pass), null);
  for (const candidate of [
    `postgresql://postgres:${pass}@localhost:55433/electrohub_disposable`,
    `postgresql://postgres:${pass}@localhost:55434/electrohub_ci`,
    `postgresql://postgres:${pass}@localhost:55434/electrohub_disposable_other`,
    `postgresql://postgres:${pass}@localhost:55434/electrohub_disposable?sslmode=disable`,
    `postgresql://postgres:${pass}@localhost:55434/electrohub_disposable?sslmode=require`,
    `${dbUrl}?host=db.example.com`, `${dbUrl}?port=5432`, `${dbUrl}?user=other`, `${dbUrl}?ssl=false`,
    `${dbUrl}?sslmode=verify-full&sslmode=disable`, `${dbUrl}#ignored`,
    `postgresql://other:${pass}@localhost:55434/electrohub_disposable`,
    `postgresql://postgres:wrong@localhost:55434/electrohub_disposable`,
    `postgresql://postgres:${pass}@example.invalid:55434/electrohub_disposable`,
    'not a URL',
  ]) assert.ok(disposableUrlIssue(candidate, pass));
  assert.equal(disposableUrlIssue(`${dbUrl}?sslmode=verify-full`, pass), null);
});

test('DATABASE_URL and DIRECT_URL must resolve to the same pinned cluster', () => {
  assert.equal(databaseUrlsIssue(env, pass), null);
  assert.match(databaseUrlsIssue({ ...env, DIRECT_URL: `postgresql://postgres:${pass}@127.0.0.1:55434/electrohub_disposable` }, pass), /DIRECT_URL/);
  assert.match(databaseUrlsIssue({ ...env, DIRECT_URL: 'postgresql://postgres:wrong@localhost:55434/electrohub_disposable' }, pass), /DIRECT_URL/);
});

test('standalone migration starts and verifies the isolated target before applying', () => {
  const calls = [];
  runVerifiedMigration(env, { startDatabase: () => calls.push('start'), verify: target => { assert.equal(target, env); calls.push('verify'); },
    apply: target => { assert.equal(target, env); calls.push('migrate'); } });
  assert.deepEqual(calls, ['start', 'verify', 'migrate']);
  const blocked = [];
  assert.throws(() => runVerifiedMigration(env, { startDatabase: () => blocked.push('start'),
    verify: () => { blocked.push('verify'); throw new Error('identity mismatch'); }, apply: () => blocked.push('migrate') }), /identity mismatch/);
  assert.deepEqual(blocked, ['start', 'verify']);
});
