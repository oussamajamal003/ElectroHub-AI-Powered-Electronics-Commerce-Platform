// Test-only transport boundaries. No SDK, credentials, database or process APIs.
const assert = require('node:assert/strict');
const doubles = new WeakSet();
const PRE_PROVIDER_CAPTURE_FAILURE = 'PRE_PROVIDER_CAPTURE_FAILURE';
const POST_PROVIDER_CAPTURE_RESPONSE_LOSS = 'POST_PROVIDER_CAPTURE_RESPONSE_LOSS';
function deterministicProvider(initial) {
  let state = { ...initial }; let effects = 0;
  const operations = new Map(); const trace = [];
  const provider = {
    trace,
    async retrieve(id) { assert.equal(id, state.id); trace.push('retrieve'); return { ...state }; },
    async capture(attempt) {
      assert.equal(attempt.providerIntentId, state.id);
      const key = `electrohub:03.6:${attempt.id}:capture`;
      if (operations.has(key)) { assert.equal(operations.get(key), attempt.amountCents); return { ...state }; }
      assert.equal(state.status, 'requires_capture'); assert.equal(attempt.amountCents, state.capturable);
      operations.set(key, attempt.amountCents); effects++;
      state = { ...state, status: 'succeeded', received: attempt.amountCents, capturable: 0 };
      trace.push('provider-captured'); return { ...state };
    },
    snapshot() { return { effects, keys: [...operations.keys()], state: { ...state } }; },
  };
  doubles.add(provider); return provider;
}
function captureFault({ mode, provider, runtime = process.env.NODE_ENV, afterCapture }) {
  assert.notEqual(process.env.NODE_ENV, 'production', 'Capture faults cannot activate in production');
  assert.equal(runtime, 'test', 'Capture faults require test runtime');
  assert.ok([PRE_PROVIDER_CAPTURE_FAILURE, POST_PROVIDER_CAPTURE_RESPONSE_LOSS].includes(mode), 'Explicit fault mode required');
  if (mode === POST_PROVIDER_CAPTURE_RESPONSE_LOSS) assert.ok(doubles.has(provider), 'Post-provider fault requires the offline deterministic double');
  let fired = false;
  return {
    async capture(attempt) {
      assert.equal(fired, false, 'Fault already fired; restore the provider explicitly before retry');
      fired = true;
      if (mode === POST_PROVIDER_CAPTURE_RESPONSE_LOSS) {
        await provider.capture(attempt); // Persist provider truth but never return it to application.
        if (afterCapture) await afterCapture(); // Deterministic interruption barrier, offline only.
      }
      const error = new Error('Controlled capture transport outcome unknown');
      error.code = 'PAYMENT_PROVIDER_UNKNOWN'; throw error;
    },
    assertFired() { assert.equal(fired, true, 'Capture fault was never reached'); },
  };
}
module.exports = { deterministicProvider, captureFault, PRE_PROVIDER_CAPTURE_FAILURE, POST_PROVIDER_CAPTURE_RESPONSE_LOSS };
