const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileLedger, capacityGate, approvalManifest } = require('./operational-acceptance-preflight.cjs');
const { DEV_PROJECT, DEV_STRIPE_ACCOUNT } = require('./stripe-gate-safety.cjs');
const op = { operationId: 'owned:authorization:1', intentId: 'pi_owned', kind: 'authorize', outcome: 'confirmed', testMode: true, accountId: DEV_STRIPE_ACCOUNT };
const provider = [{ id: 'pi_owned', accountId: DEV_STRIPE_ACCOUNT, livemode: false, status: 'succeeded', received: 1349 }];
test('incomplete historical identities block allowance even with successful provider truth', () => {
  assert.equal(reconcileLedger({ operations: [op], provider }).remaining, null);
  assert.equal(reconcileLedger({ operations: [{ ...op, operationId: null }], provider, complete: true }).status, 'BLOCKED');
});
test('duplicates count once, but conflicting identities and unknown outcomes block', () => {
  const r = reconcileLedger({ operations: [op, op], provider, complete: true });
  assert.equal(r.attempted.authorize, 1); assert.equal(r.status, 'VERIFIED');
  for (const row of [{ ...op, intentId: 'pi_foreign' }, { ...op, outcome: 'unknown' }])
    assert.equal(reconcileLedger({ operations: [op, row], provider, complete: true }).status, 'BLOCKED');
});
test('wrong account/live readbacks and mismatched capture truth fail closed', () => {
  for (const p of [{ ...provider[0], livemode: true }, { ...provider[0], accountId: 'acct_other' }, { ...provider[0], received: 0 }])
    assert.equal(reconcileLedger({ operations: [{ ...op, kind: 'capture' }], provider: [p], complete: true }).status, 'BLOCKED');
});
test('unknown capacity cannot be replaced by configured demand', () => {
  assert.deepEqual(capacityGate(null, { api: 5, runner: 5, diagnostics: 1, otherNewClients: 0 }), { status: 'BLOCKED', capacity: 'UNKNOWN', headroom: null });
});
const now = Date.now(), metrics = { projectRef: DEV_PROJECT, measuredAt: new Date(now).toISOString(), activeClients: 1, maximumClients: 200,
  activeSessions: 1, maximumSessions: 15, waitingClients: 0, queueDepth: 0, peakClients: 2, rejections: 0, timeouts: 0,
  headroomClients: 199, headroomSessions: 14, reserveClients: 1, reserveSessions: 1, operatorReserveApproved: true };
const demand = { api: 5, runner: 5, diagnostics: 1, otherNewClients: 0 };
test('capacity requires fresh genuine fields and approved reserve; webhook is not double-counted', () => {
  const r = capacityGate(metrics, demand, now); assert.equal(r.status, 'VERIFIED'); assert.equal(r.proposedNewDemand, 11);
  for (const change of [{ operatorReserveApproved: false }, { measuredAt: new Date(now - 61000).toISOString() }, { waitingClients: 1 }, { headroomSessions: 15 }, { projectRef: 'prod' }])
    assert.equal(capacityGate({ ...metrics, ...change }, demand, now).status, 'BLOCKED');
});
test('verified tenant metrics with insufficient reserve block admission', () => {
  assert.equal(capacityGate({ ...metrics, activeSessions: 5, headroomSessions: 10 }, demand, now).status, 'BLOCKED');
});
test('manifest never grants approval, opens execution, or leaks arbitrary input', () => {
  const r = approvalManifest({ sourceFingerprint: 'a'.repeat(64), identity: { projectRef: DEV_PROJECT, accountId: DEV_STRIPE_ACCOUNT, testMode: true, secret: 'private' },
    ledger: { status: 'VERIFIED', remaining: { authorizations: 1, captures: 1 } }, capacity: capacityGate(metrics, demand, now), services: { verified: true }, guard: { liveVerified: true } });
  assert.equal(r.execution, 'BLOCKED'); assert.equal(r.fields.D.status, 'BLOCKED');
  assert.ok(Object.values(r.fields).every(f => ['VERIFIED', 'PENDING', 'BLOCKED'].includes(f.status)));
  assert.ok(!JSON.stringify(r).includes('private')); assert.equal(r.fields.J.value, 1349);
});
