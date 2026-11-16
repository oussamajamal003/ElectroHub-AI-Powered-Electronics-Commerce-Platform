'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { testArguments } = require('./logging-safe-tests.cjs');

test('allows only the fixed logging selection and optional test-name filtering', () => {
  assert.deepEqual(testArguments([]), []);
  assert.deepEqual(testArguments(['-t', 'final acceptance']), ['-t', 'final acceptance']);
});
for (const input of [
  ['tests/google.integration.test.ts'], ['--config', 'vitest.config.mts'], ['--include', '**/*.test.ts'],
  ['-t', 'logging', 'tests/google.integration.test.ts'], ['--project', 'database'],
]) {
  test(`rejects unsafe test selection ${JSON.stringify(input)} before starting Vitest`, () => {
    const child = spawnSync(process.execPath, [path.join(__dirname, 'logging-safe-tests.cjs'), ...input], { encoding: 'utf8' });
    assert.equal(child.status, 2);
    assert.match(child.stderr, /file paths and configuration overrides are forbidden/);
    assert.doesNotMatch(child.stdout, /RUN|Test Files/);
  });
}
