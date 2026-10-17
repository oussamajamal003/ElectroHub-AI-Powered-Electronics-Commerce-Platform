const test = require('node:test');
const assert = require('node:assert/strict');
const { finishLifecycle, withOwnedCleanup } = require('./acceptance-lifecycle.cjs');
test('primary financial failure survives cleanup failure without replacement', () => {
  const primary = new Error('primary'); assert.throws(() => finishLifecycle(primary, [new Error('cleanup secret')]), error => error === primary);
  assert.equal(primary.cleanupFailureCount, 1);
});
test('cleanup-only failure reports sanitized failure; successful cleanup remains successful', () => {
  assert.throws(() => finishLifecycle(null, [new Error('secret')]), /Owned cleanup failed/);
  assert.doesNotThrow(() => finishLifecycle(null, []));
});

test('early successful scenario return cannot bypass failed cleanup', async () => {
  let cleaned = 0;
  await assert.rejects(withOwnedCleanup(async () => { return 'early success'; }, async () => { cleaned++; throw Error('cleanup private'); }), /Owned cleanup failed/);
  assert.equal(cleaned, 1);
  const primary = new Error('unknown financial outcome');
  await assert.rejects(withOwnedCleanup(async () => { throw primary; }, async () => { throw Error('cleanup private'); }), error => error === primary);
  assert.equal(primary.cleanupFailureCount, 1);
  assert.equal(await withOwnedCleanup(async () => 42, async () => {}), 42);
});
