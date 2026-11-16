const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
function runnerPlan(config) {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(config.scenario, 'POST_PROVIDER_CAPTURE_RESPONSE_LOSS');
  assert.equal(config.runId, config.approvedRunId);
  assert.match(config.runId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(config.ownerProcessId, process.pid, 'Only the positively identified caller may plan a runner');
  assert.equal(config.budgetVerified, true);
  assert.match(config.attemptId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const scope = config.attemptId;
  return Object.freeze({ args: Object.freeze(['--once', `--attempt=${scope}`]),
    assertClaim(attemptId) { assert.equal(attemptId, scope, 'Unexpected attempt: STOP without processing'); } });
}
function fixtureContract(runId) {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.match(runId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const products = [100, 50].map((priceCents, index) => Object.freeze({ id: randomUUID(),
    sku: `stripe-acceptance-${runId}-${index}`, priceCents, quantity: index === 0 ? 2 : 3,
    initialStock: 10, finalStock: index === 0 ? 8 : 7, isTestFixture: false, storefrontVisible: false }));
  return Object.freeze({ runId, customerId: randomUUID(), customerRole: 'CUSTOMER', cartId: randomUUID(),
    products: Object.freeze(products), delivery: 'EXPRESS', shippingCents: 999, totalCents: 1349,
    creationApproved: false, temporaryCatalogVisibilityApproved: false });
}
module.exports = { runnerPlan, fixtureContract };
