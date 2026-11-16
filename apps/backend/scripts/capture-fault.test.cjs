const test = require('node:test');
const assert = require('node:assert/strict');
const { deterministicProvider, captureFault, PRE_PROVIDER_CAPTURE_FAILURE: PRE, POST_PROVIDER_CAPTURE_RESPONSE_LOSS: POST } = require('./capture-fault.cjs');
const initial = { id: 'pi_double', status: 'requires_capture', capturable: 1199, received: 0 };
const attempt = { id: 'attempt_double', providerIntentId: initial.id, amountCents: 1199 };
test('PRE never calls provider and requires explicit restoration', async () => {
  const p = deterministicProvider(initial), f = captureFault({ mode: PRE, provider: p, runtime: 'test' });
  await assert.rejects(f.capture(attempt), /unknown/); f.assertFired();
  assert.equal(p.snapshot().effects, 0); assert.equal((await p.retrieve(initial.id)).status, 'requires_capture');
  await assert.rejects(f.capture(attempt), /already fired/); assert.equal(p.snapshot().effects, 0);
});
test('POST stores capture truth and loses response; GET and repeated keyed operation preserve one effect', async () => {
  const p = deterministicProvider(initial), f = captureFault({ mode: POST, provider: p, runtime: 'test' });
  await assert.rejects(f.capture(attempt), /unknown/); f.assertFired();
  assert.equal((await p.retrieve(initial.id)).status, 'succeeded'); await p.capture(attempt);
  assert.deepEqual(p.snapshot().keys, ['electrohub:03.6:attempt_double:capture']); assert.equal(p.snapshot().effects, 1);
});
test('unreached injection fails evidence assertion', () => {
  assert.throws(() => captureFault({ mode: PRE, provider: {}, runtime: 'test' }).assertFired(), /never reached/);
});
test('production, unknown mode and real provider POST are rejected', () => {
  assert.throws(() => captureFault({ mode: PRE, provider: {}, runtime: 'production' }));
  assert.throws(() => captureFault({ mode: 'implicit', provider: {}, runtime: 'test' }));
  assert.throws(() => captureFault({ mode: POST, provider: { capture() { throw Error('must not call'); } }, runtime: 'test' }), /offline/);
});
test('idempotency cannot change amount or intent binding', async () => {
  const p = deterministicProvider(initial); await p.capture(attempt);
  await assert.rejects(p.capture({ ...attempt, amountCents: 1200 }));
  await assert.rejects(p.capture({ ...attempt, providerIntentId: 'different' })); assert.equal(p.snapshot().effects, 1);
});
