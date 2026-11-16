// Acceptance capability only; never changes or claims database work.
const assert = require('node:assert/strict');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function captureContract(config, work, intentId, ownerPid = process.pid) {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(ownerPid, process.pid);
  const until = work?.leaseUntil instanceof Date ? work.leaseUntil.getTime() : NaN;
  assert.ok(Number.isFinite(until) && until > Date.now(), 'Capture lease unavailable or expired');
  for (const value of [work?.id, work?.attemptId, work?.leaseToken]) assert.match(value, uuid);
  assert.equal(work.state, 'LEASED'); assert.equal(work.attemptId, config.attemptId);
  assert.equal(config.runId, config.approvedRunId);
  assert.equal(config.accountId, 'acct_1UEZW5KiVgdl63pN'); assert.match(intentId, /^pi_[A-Za-z0-9]+$/);
  return Object.freeze({ runId: config.runId, scenario: config.scenario, sourceFingerprint: config.sourceFingerprint,
    accountId: config.accountId, testMode: true, intentId, attemptId: config.attemptId, workId: work.id,
    ownerPid, parentPid: process.ppid, executable: process.execPath, fencingToken: work.leaseToken,
    leaseUntilMs: until, amountCents: config.amountCents,
    operationId: `${config.runId}:${config.attemptId}:capture`, idempotencyKey: `electrohub:03.6:${config.attemptId}:capture` });
}
function assertCaptureContract(contract, config, attempt, work, workId) {
  assert.ok(contract, 'Capture authorization contract missing');
  const expected = captureContract(config, work, attempt.providerIntentId);
  assert.equal(work.id, workId, 'Foreign PaymentWork');
  assert.equal(attempt.id, config.attemptId); assert.equal(attempt.userId, config.userId);
  assert.equal(attempt.stripeAccountId, config.accountId); assert.equal(attempt.amountCents, config.amountCents);
  assert.equal(attempt.state, 'CAPTURE_PENDING'); assert.equal(attempt.currency, 'USD');
  assert.deepEqual(contract, expected, 'Capture identity, owner or fencing contract mismatch');
}
module.exports = { captureContract, assertCaptureContract };
