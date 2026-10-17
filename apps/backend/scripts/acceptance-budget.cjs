// Isolated test ledger: no SDK/database/process startup. Reservations are never released automatically.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const kinds = ['create', 'authorize', 'capture'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function writeOnce(file, value) {
  // Exclusive creation reserves before side effects. A crash/partial write fails closed on read.
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function read(file) {
  assert.equal(fs.lstatSync(file).isSymbolicLink(), false);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function validateConfig(c) {
  assert.deepEqual(Object.keys(c).sort(), ['accountId', 'amountCents', 'approvedRunId', 'attemptId', 'projectRef', 'runId', 'scenario', 'sourceFingerprint', 'userId'].sort(), 'Allowlisted ledger config only');
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(c.scenario, 'POST_PROVIDER_CAPTURE_RESPONSE_LOSS');
  assert.equal(c.projectRef, 'pzxekjybdiulzmssalfo');
  assert.equal(c.accountId, 'acct_1UEZW5KiVgdl63pN');
  assert.ok(uuid.test(c.runId) && uuid.test(c.attemptId) && uuid.test(c.userId));
  assert.equal(c.approvedRunId, c.runId);
  assert.ok(Number.isInteger(c.amountCents) && c.amountCents >= 50 && c.amountCents <= 1349);
  assert.match(c.sourceFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(c.sourceFingerprint, require('./stripe-gate-safety.cjs').sourceFingerprint(path.resolve(__dirname, '..')), 'Budget source is stale');
}
function openBudget({ directory, config, initialize = false, credential = process.env.STRIPE_SECRET_KEY }) {
  validateConfig(config);
  if (credential !== undefined) assert.match(credential, /^(sk|rk)_test_[A-Za-z0-9]+$/, 'Only Test Mode credentials permitted; never persisted');
  const root = path.resolve(directory);
  const base = path.resolve(__dirname, '../.cache/stripe-acceptance-budget');
  assert.equal(path.dirname(root), base, 'One canonical budget location per run');
  if (initialize) fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  assert.equal(fs.realpathSync(base), base, 'Budget parent must not be redirected');
  assert.equal(path.basename(root), config.runId, 'Ledger directory must name the immutable run');
  if (initialize) {
    fs.mkdirSync(root, { recursive: false, mode: 0o700 }); // Existing run must never reset.
    writeOnce(path.join(root, 'config.json'), config);
  }
  const verifiedRoot = fs.realpathSync(root);
  assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
  const configHash = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  function check() {
    validateConfig(config);
    assert.equal(fs.realpathSync(root), verifiedRoot);
    const saved = read(path.join(root, 'config.json'));
    assert.equal(createHash('sha256').update(JSON.stringify(saved)).digest('hex'), configHash, 'Ledger identity changed');
  }
  function summary() {
    check(); const operations = [];
    for (const kind of kinds) {
      const file = path.join(root, `${kind}.reservation.json`);
      if (!fs.existsSync(file)) {
        assert.equal(fs.existsSync(path.join(root, `${kind}.dispatch.json`)), false, 'Orphan dispatch accounting: STOP');
        assert.equal(fs.existsSync(path.join(root, `${kind}.result.json`)), false, 'Orphan effect accounting: STOP');
        continue;
      }
      const reservation = read(file);
      assert.equal(reservation.operationId, `${config.runId}:${config.attemptId}:${kind}`);
      assert.equal(reservation.kind, kind); assert.equal(reservation.configHash, configHash);
      const dispatch = path.join(root, `${kind}.dispatch.json`);
      if (fs.existsSync(dispatch)) assert.equal(read(dispatch).operationId, reservation.operationId);
      const result = path.join(root, `${kind}.result.json`);
      const outcome = fs.existsSync(result) ? read(result) : null;
      if (outcome) {
        assert.equal(outcome.operationId, reservation.operationId);
        assert.ok(['confirmed', 'definitive_failure'].includes(outcome.classification));
        validateTruth(kind, outcome.provider);
        const confirmed = kind === 'create' || kind === 'authorize' && outcome.provider.status === 'requires_capture' || kind === 'capture' && outcome.provider.status === 'succeeded';
        assert.equal(outcome.classification, confirmed ? 'confirmed' : 'definitive_failure');
      }
      operations.push({ kind, reserved: 1, dispatchAttempts: fs.existsSync(dispatch) ? 1 : 0,
        classification: outcome?.classification ?? 'unknown', provider: outcome?.provider ?? null });
    }
    return { operations, unknown: operations.some(o => o.classification === 'unknown') };
  }
  function expectedIntent() {
    const creation = summary().operations.find(o => o.kind === 'create');
    assert.equal(creation?.classification, 'confirmed', 'Creation must reconcile before another operation');
    return creation.provider.id;
  }
  function validateTruth(kind, value) {
    assert.equal(value.account, config.accountId); assert.equal(value.livemode, false);
    assert.equal(value.attemptId, config.attemptId); assert.equal(value.amount, config.amountCents);
    assert.equal(value.currency, 'usd'); assert.equal(value.captureMethod, 'manual');
    assert.match(value.id, /^pi_[A-Za-z0-9]+$/);
    if (kind !== 'create') {
      const creation = read(path.join(root, 'create.result.json'));
      assert.equal(value.id, creation.provider.id);
    }
    if (kind === 'capture' && value.status === 'succeeded') {
      assert.equal(value.received, config.amountCents); assert.equal(value.capturable, 0);
    } else if (kind === 'authorize' && value.status === 'requires_capture') {
      assert.equal(value.capturable, config.amountCents); assert.equal(value.received, 0);
    } else if (kind === 'create') {
      assert.equal(value.status, 'requires_payment_method'); assert.equal(value.received, 0); assert.equal(value.capturable, 0);
    } else {
      assert.ok(value.status === 'canceled' || (kind === 'authorize' && value.status === 'requires_payment_method' && value.declined === true), 'Provider truth not terminal for this operation');
      assert.equal(value.received, 0); assert.equal(value.capturable, 0);
    }
  }
  function persistTruth(kind, provider) {
    check(); validateTruth(kind, provider);
    const projection = Object.fromEntries(['id', 'account', 'livemode', 'attemptId', 'amount', 'currency', 'captureMethod', 'status', 'received', 'capturable', 'declined'].map(k => [k, provider[k]]));
    const classification = kind === 'create' || kind === 'authorize' && provider.status === 'requires_capture' || kind === 'capture' && provider.status === 'succeeded' ? 'confirmed' : 'definitive_failure';
    const operationId = `${config.runId}:${config.attemptId}:${kind}`;
    writeOnce(path.join(root, `${kind}.result.json`), { operationId, classification, provider: projection });
    return classification;
  }
  return {
    summary,
    async execute(kind, request, send) {
      check(); assert.ok(kinds.includes(kind), 'Refund/cancel/compensation not authorized');
      const state = summary(); assert.equal(state.unknown, false, 'Unknown outcome requires read-only reconciliation');
      assert.equal(request.attemptId, config.attemptId); assert.equal(request.userId, config.userId);
      assert.equal(request.amountCents, config.amountCents);
      const key = `electrohub:03.6:${config.attemptId}:${kind === 'authorize' ? 'authorization' : kind}`;
      assert.equal(request.idempotencyKey, key);
      if (kind !== 'create') assert.equal(request.intentId, expectedIntent());
      if (kind === 'capture') {
        assert.equal(state.operations.find(o => o.kind === 'authorize')?.classification, 'confirmed');
        assert.ok(uuid.test(request.orderId)); assert.equal(request.committedPurchaseVerified, true);
      }
      const operationId = `${config.runId}:${config.attemptId}:${kind}`;
      writeOnce(path.join(root, `${kind}.reservation.json`), { operationId, kind, configHash });
      // Persist dispatch intent before invoking provider. Crash in this boundary is conservatively unknown.
      writeOnce(path.join(root, `${kind}.dispatch.json`), { operationId });
      const provider = await send(); // No retry/catch/reset. Lost response leaves durable unknown reservation.
      persistTruth(kind, provider); return provider;
    },
    reconcile(kind, provider) {
      assert.ok(kinds.includes(kind)); check();
      assert.ok(fs.existsSync(path.join(root, `${kind}.reservation.json`)));
      return persistTruth(kind, provider); // Caller supplies verified GET projection; cannot send a mutation here.
    },
  };
}
module.exports = { openBudget };
