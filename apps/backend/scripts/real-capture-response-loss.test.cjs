const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const safety = require('./stripe-gate-safety.cjs');
const { responseLossHook, SCENARIO } = require('./real-capture-response-loss.cjs');
const id = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const context = { runtime: 'test', scenario: SCENARIO, projectRef: safety.DEV_PROJECT, accountId: 'acct_1UEZW5KiVgdl63pN',
    runId: id, attemptId: id, userId: id, intentId: 'pi_double', amountCents: 1349, isolatedDev: true,
    connectionBudgetVerified: true, workerScopeAttemptId: id, committedPurchaseVerified: true, orderId: id,
    ownerProcessId: process.pid, backendOrigin: 'http://127.0.0.1:5000',
    sourceFingerprint: safety.sourceFingerprint(path.resolve(__dirname, '..')),
    authorization: { runId: id, scenario: SCENARIO, maxCaptureCalls: 1, maxAmountCents: 1349, backendOrigin: 'http://127.0.0.1:5000' } };
  const attempt = { id, userId: id, providerIntentId: 'pi_double', stripeAccountId: context.accountId,
    amountCents: 1349, currency: 'USD', state: 'CAPTURE_PENDING', orderId: id };
  let effects = 0; let state = { id: 'pi_double', attemptId: id, account: context.accountId, livemode: false,
    amount: 1349, currency: 'usd', captureMethod: 'manual', status: 'requires_capture', received: 0, capturable: 1349 };
  const keys = [];
  const provider = { account: async () => context.accountId, retrieve: async () => ({ ...state }),
    capture: async a => { keys.push(`electrohub:03.6:${a.id}:capture`); effects++;
      state = { ...state, status: 'succeeded', received: 1349, capturable: 0 }; return { ...state }; } };
  return { context, attempt, provider, keys, effects: () => effects };
}
test.beforeEach(() => { process.env.NODE_ENV = 'test'; });
test('owned instance receives capture success, suppresses response, GET preserves truth and key', async () => {
  const f = fixture(), original = f.provider.capture;
  const hook = responseLossHook(f);
  await assert.rejects(hook.capture(f.attempt), /response loss/); hook.assertFired();
  assert.equal((await f.provider.retrieve()).status, 'succeeded');
  assert.equal(f.effects(), 1); assert.deepEqual(f.keys, [`electrohub:03.6:${id}:capture`]);
  assert.equal(f.provider.capture, original); // No mutation of provider or SDK global.
  await assert.rejects(hook.capture(f.attempt), /exhausted/); assert.equal(f.effects(), 1);
});
test('production and absent/incorrect approval, scope, readiness or fingerprint fail closed', () => {
  const f = fixture(); process.env.NODE_ENV = 'production'; assert.throws(() => responseLossHook(f)); process.env.NODE_ENV = 'test';
  for (const changes of [{ scenario: 'implicit' }, { isolatedDev: false }, { connectionBudgetVerified: false },
    { workerScopeAttemptId: 'other' }, { projectRef: 'production' }, { accountId: 'wrong' },
    { sourceFingerprint: 'stale' }, { authorization: null }, { amountCents: 1350 }, { committedPurchaseVerified: false },
    { ownerProcessId: process.pid + 1 }, { backendOrigin: 'http://127.0.0.1:9999' }]) {
    assert.throws(() => responseLossHook({ ...f, context: { ...f.context, ...changes } }));
  }
  assert.equal(f.effects(), 0);
});
test('wrong attempt or missing committed Order cannot call provider', async () => {
  const f = fixture(), hook = responseLossHook(f);
  await assert.rejects(hook.capture({ ...f.attempt, id: 'other' }));
  await assert.rejects(hook.capture({ ...f.attempt, orderId: null })); assert.equal(f.effects(), 0);
  assert.throws(() => hook.assertFired());
});
test('provider failure is not misreported as post-capture response loss and cannot be retried', async () => {
  const f = fixture(); f.provider.capture = async () => { throw Error('transport'); };
  const hook = responseLossHook(f); await assert.rejects(hook.capture(f.attempt), /transport/);
  assert.throws(() => hook.assertFired()); await assert.rejects(hook.capture(f.attempt), /exhausted/);
});
test('live or mismatched captured response fails evidence rather than faking the injection', async () => {
  const f = fixture(), original = f.provider.capture;
  f.provider.capture = async a => ({ ...await original(a), livemode: true });
  const hook = responseLossHook(f); await assert.rejects(hook.capture(f.attempt)); assert.throws(() => hook.assertFired());
  assert.equal(f.effects(), 1); assert.equal(hook.receipt().responseLossCount, 0);
});
test('concurrent submissions consume only one capture capability', async () => {
  const f = fixture(), hook = responseLossHook(f);
  const outcomes = await Promise.allSettled([hook.capture(f.attempt), hook.capture(f.attempt)]);
  assert.equal(outcomes.filter(r => r.status === 'rejected').length, 2);
  assert.equal(f.effects(), 1); hook.assertFired();
});
