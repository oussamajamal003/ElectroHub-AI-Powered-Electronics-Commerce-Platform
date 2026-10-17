// Read-only evidence composition. No SDK, database, subprocess, reservation or approval writes.
const { DEV_PROJECT, DEV_STRIPE_ACCOUNT } = require('./stripe-gate-safety.cjs');
const id = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,180}$/.test(value);
const kinds = ['create', 'authorize', 'capture'];
function reconcileLedger({ operations = [], provider = [], complete = false } = {}) {
  const unique = new Map(); let invalid = false;
  for (const row of operations) {
    if (!id(row.operationId) || !/^pi_[A-Za-z0-9]+$/.test(row.intentId || '') || !kinds.includes(row.kind) ||
      !['confirmed', 'definitive_failure', 'unknown'].includes(row.outcome) || row.testMode !== true || row.accountId !== DEV_STRIPE_ACCOUNT) { invalid = true; continue; }
    const safe = { operationId: row.operationId, intentId: row.intentId, kind: row.kind, outcome: row.outcome };
    const old = unique.get(row.operationId);
    if (old && JSON.stringify(old) !== JSON.stringify(safe)) invalid = true;
    unique.set(row.operationId, safe);
  }
  const rows = [...unique.values()];
  // Stable intent IDs alone cannot identify/count authorization submissions or provider request retries.
  const truth = new Map();
  for (const p of provider) {
    if (truth.has(p.id) || p.accountId !== DEV_STRIPE_ACCOUNT || p.livemode !== false) invalid = true;
    truth.set(p.id, p);
  }
  for (const row of rows) {
    const p = truth.get(row.intentId);
    if (!p) { invalid = true; continue; }
    if (row.kind === 'capture' && row.outcome === 'confirmed' &&
      (p.status !== 'succeeded' || !Number.isInteger(p.received) || p.received <= 0)) invalid = true;
    // Authorization success needs its retained operation receipt; a later canceled intent is not proof of failure.
  }
  const attempted = Object.fromEntries(kinds.map(kind => [kind, rows.filter(r => r.kind === kind).length]));
  const confirmed = Object.fromEntries(kinds.map(kind => [kind, rows.filter(r => r.kind === kind && r.outcome === 'confirmed').length]));
  const unknown = rows.filter(r => r.outcome === 'unknown').length;
  const verified = complete === true && rows.length > 0 && !invalid && unknown === 0 && attempted.authorize <= 11 && confirmed.capture <= 5 && attempted.capture <= 5;
  return { status: verified ? 'VERIFIED' : 'BLOCKED', attempted, confirmed, unknown, operations: rows,
    remaining: verified ? { authorizations: 11 - attempted.authorize, captures: 5 - attempted.capture } : null,
    reason: verified ? 'Complete operation receipts correlated by stable provider identity' : 'Complete submission identities, outcomes and authoritative readbacks required; allowance not inferred' };
}
function capacityGate(metrics, demand, now = Date.now()) {
  const blocked = { status: 'BLOCKED', capacity: 'UNKNOWN', headroom: null };
  if (!metrics || !demand || metrics.projectRef !== DEV_PROJECT) return blocked;
  const age = now - Date.parse(metrics.measuredAt);
  const fields = ['activeClients', 'maximumClients', 'activeSessions', 'maximumSessions', 'waitingClients', 'queueDepth', 'peakClients', 'rejections', 'timeouts', 'headroomClients', 'headroomSessions', 'reserveClients', 'reserveSessions'];
  const demandFields = ['api', 'runner', 'diagnostics', 'otherNewClients'];
  if (!Number.isFinite(age) || age < 0 || age > 60000 || metrics.operatorReserveApproved !== true ||
    !fields.every(k => Number.isInteger(metrics[k]) && metrics[k] >= 0) || !demandFields.every(k => Number.isInteger(demand[k]) && demand[k] >= 0) ||
    metrics.headroomClients !== metrics.maximumClients - metrics.activeClients || metrics.headroomSessions !== metrics.maximumSessions - metrics.activeSessions ||
    metrics.peakClients < metrics.activeClients || metrics.waitingClients !== 0 || metrics.queueDepth !== 0) return blocked;
  // Existing clients are already in measured utilization; webhook uses the API pool, not a second pool.
  const proposedNewDemand = demandFields.reduce((n, key) => n + demand[key], 0);
  const sufficient = metrics.headroomClients >= proposedNewDemand + metrics.reserveClients && metrics.headroomSessions >= proposedNewDemand + metrics.reserveSessions;
  return { status: sufficient ? 'VERIFIED' : 'BLOCKED', capacity: 'VERIFIED', measuredAt: metrics.measuredAt,
    headroom: { clients: metrics.headroomClients, sessions: metrics.headroomSessions }, proposedNewDemand,
    rejections: metrics.rejections, timeouts: metrics.timeouts, semantics: 'Conservative new configured demand; not measured application utilization' };
}
function approvalManifest({ sourceFingerprint, identity, ledger, capacity, services, guard } = {}) {
  const field = (status, value) => ({ status, value });
  // This artifact records evidence only; it cannot grant authorization or unlock the live launcher.
  return { execution: 'BLOCKED', sourceFingerprint: /^[a-f0-9]{64}$/.test(sourceFingerprint || '') ? sourceFingerprint : null,
    fields: {
      A: field(identity?.projectRef === DEV_PROJECT && identity?.accountId === DEV_STRIPE_ACCOUNT && identity?.testMode === true ? 'VERIFIED' : 'BLOCKED', { projectRef: DEV_PROJECT, accountId: DEV_STRIPE_ACCOUNT, mode: 'TEST' }),
      B: field(ledger?.status === 'VERIFIED' ? 'VERIFIED' : 'BLOCKED', ledger?.remaining ?? null),
      C: field(capacity?.status === 'VERIFIED' ? 'VERIFIED' : 'BLOCKED', capacity?.headroom ?? null),
      D: field('BLOCKED', { servicesVerified: services?.verified === true, runtimeOwnedInstallationVerified: guard?.liveVerified === true }),
      E: field('PENDING', { customerRole: 'CUSTOMER', productPricesCents: [100, 50], quantities: [2, 3], stock: [10, 10], shippingCents: 999, totalCents: 1349, isTestFixture: false, storefrontVisible: false }),
      F: field('PENDING', { setup: 10, reuse: 5, intent: 3, transaction: 10, hostedReady: 5, payConfirmed: 30 }),
      G: field('PENDING', 1), H: field('PENDING', 1), I: field('PENDING', 1), J: field('PENDING', 1349),
      K: field('PENDING', 'POST_PROVIDER_CAPTURE_RESPONSE_LOSS'), L: field('BLOCKED', 'Exact future attempt/work/owner/fencing identities required'),
      M: field('PENDING', 'STOP mutations; preserve accounting; GET/SELECT reconciliation only; no automatic retry'),
      N: field('PENDING', 'No cleanup, cancellation, refund, compensation or budget reset authorization'),
    } };
}
module.exports = { reconcileLedger, capacityGate, approvalManifest };
