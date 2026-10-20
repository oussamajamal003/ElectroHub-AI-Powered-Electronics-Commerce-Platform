const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertAcceptanceTarget } = require('./task04-dev-acceptance.cjs');
const runtime = { category: 'dev', identity: 'supabase:pzxekjybdiulzmssalfo/postgres' };
const targets = { runtime, migration: runtime };
test('synthetic acceptance refuses production, isolated, shared test bypass, live keys and mismatched migration targets before writes', () => {
  const env = { NODE_ENV: 'development', STRIPE_SECRET_KEY: 'sk_test_fixture' };
  assert.doesNotThrow(() => assertAcceptanceTarget(env, targets));
  for (const patch of [{ NODE_ENV: 'production' }, { NODE_ENV: 'test' }, { STRIPE_SECRET_KEY: 'sk_live_fixture' }, { STRIPE_SECRET_KEY: '' }]) {
    assert.throws(() => assertAcceptanceTarget({ ...env, ...patch }, targets));
  }
  assert.throws(() => assertAcceptanceTarget(env, { ...targets, runtime: { category: 'disposable', identity: 'loopback' } }));
  assert.throws(() => assertAcceptanceTarget(env, { ...targets, migration: { identity: 'other' } }));
});
