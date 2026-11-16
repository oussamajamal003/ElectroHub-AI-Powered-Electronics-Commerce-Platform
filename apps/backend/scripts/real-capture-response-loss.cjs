// Explicit DEV acceptance capability only. Importing this module performs no I/O or provider calls.
// Wrap the owned provider instance, never Stripe SDK globals or production payment code.
const assert = require('node:assert/strict');
const path = require('node:path');
const safety = require('./stripe-gate-safety.cjs');
const SCENARIO = 'POST_PROVIDER_CAPTURE_RESPONSE_LOSS';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function responseLossHook({ provider, context, beforeCapture }) {
  assert.notEqual(process.env.NODE_ENV, 'production', 'Production interception forbidden');
  assert.equal(context.runtime, 'test');
  assert.equal(process.env.NODE_ENV, 'test', 'Actual process must be an isolated test runtime');
  assert.equal(context.scenario, SCENARIO);
  assert.equal(context.projectRef, safety.DEV_PROJECT);
  safety.assertCanonicalStripeAccount(context.accountId);
  assert.ok(uuid.test(context.runId) && uuid.test(context.attemptId) && uuid.test(context.userId));
  assert.equal(context.authorization?.runId, context.runId);
  assert.equal(context.authorization?.scenario, SCENARIO);
  assert.equal(context.authorization?.maxCaptureCalls, 1);
  assert.equal(context.authorization?.maxAmountCents, context.amountCents);
  assert.ok(Number.isInteger(context.amountCents) && context.amountCents >= 50 && context.amountCents <= 1349);
  assert.equal(context.isolatedDev, true);
  assert.equal(context.connectionBudgetVerified, true);
  assert.equal(context.workerScopeAttemptId, context.attemptId);
  assert.equal(context.ownerProcessId, process.pid, 'Interception requires the exact owned process');
  assert.equal(context.authorization.backendOrigin, context.backendOrigin);
  const origin = new URL(context.backendOrigin);
  assert.ok(['127.0.0.1', 'localhost'].includes(origin.hostname));
  assert.equal(origin.protocol, 'http:'); assert.ok(origin.port);
  assert.equal(origin.pathname, '/'); assert.equal(origin.search, ''); assert.equal(origin.hash, '');
  assert.equal(context.committedPurchaseVerified, true);
  assert.ok(uuid.test(context.orderId), 'Verified committed Order identity required');
  assert.equal(context.sourceFingerprint, safety.sourceFingerprint(path.resolve(__dirname, '..')), 'Stale acceptance source');
  assert.ok(typeof context.intentId === 'string' && /^pi_[A-Za-z0-9]+$/.test(context.intentId));
  const scope = Object.freeze({ ...context, authorization: Object.freeze({ ...context.authorization }) });
  const originalCapture = provider.capture.bind(provider);
  let attempted = false; let fired = 0; let calls = 0;
  return {
    async capture(attempt) {
      assert.equal(process.env.NODE_ENV, 'test');
      assert.equal(attempted, false, 'One capture call exhausted; reconcile by retrieval');
      assert.equal(attempt.id, scope.attemptId); assert.equal(attempt.userId, scope.userId);
      assert.equal(attempt.providerIntentId, scope.intentId); assert.equal(attempt.stripeAccountId, scope.accountId);
      assert.equal(attempt.amountCents, scope.amountCents); assert.equal(attempt.currency, 'USD');
      assert.equal(attempt.state, 'CAPTURE_PENDING'); assert.equal(attempt.orderId, scope.orderId, 'Committed purchase required');
      attempted = true; // Reserve synchronously: concurrent callers and transport errors cannot retry.
      safety.assertCanonicalStripeAccount(await provider.account());
      if (beforeCapture) await beforeCapture();
      calls++;
      const captured = await originalCapture(attempt); // Adapter retains its existing idempotency key.
      assert.equal(captured.livemode, false); assert.equal(captured.account, scope.accountId);
      assert.equal(captured.id, scope.intentId); assert.equal(captured.attemptId, scope.attemptId);
      assert.equal(captured.amount, scope.amountCents); assert.equal(captured.currency, 'usd');
      assert.equal(captured.captureMethod, 'manual'); assert.equal(captured.status, 'succeeded');
      assert.equal(captured.received, scope.amountCents); assert.equal(captured.capturable, 0);
      fired++;
      // Never expose the successful response to PaymentService. It must GET provider truth.
      const error = new Error('Controlled post-capture response loss; provider outcome requires reconciliation');
      error.code = 'PAYMENT_PROVIDER_UNKNOWN'; throw error;
    },
    assertFired() { assert.equal(fired, 1, 'Post-capture loss boundary did not fire exactly once'); },
    receipt() { return { scenario: SCENARIO, runId: scope.runId, attemptId: scope.attemptId,
      captureCalls: calls, responseLossCount: fired }; },
  };
}
module.exports = { responseLossHook, SCENARIO };
