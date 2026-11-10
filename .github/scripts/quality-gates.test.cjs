'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ci = fs.readFileSync(path.join(__dirname, '../workflows/ci.yml'), 'utf8');

test('quality gate waits for every validation and fails on non-success including skipped jobs', () => {
  const gate = ci.slice(ci.indexOf('  quality-gate:'));
  assert.match(gate, /if:.*always\(\)/);
  for (const job of ['frontend-test', 'backend-test', 'release-e2e', 'payment-postgres', 'application-docker', 'ai-docker', 'workflow-policy']) {
    assert.match(gate, new RegExp(`needs:.*${job}`));
  }
  assert.match(gate, /job\.result!=='success'/);
  assert.match(gate, /if\(bad\.length\)process\.exit\(1\)/);
});

test('quality checks cannot silently become optional or publish/deploy images', () => {
  assert.doesNotMatch(ci, /--if-present|continue-on-error:\s*true|docker\s+push|pull_request_target/);
  assert.match(ci, /npm run test:quality/);
  assert.match(ci, /frontend-budget\.mjs/);
  assert.match(ci, /payment-pg-disposable\.cjs --run/);
  assert.match(ci, /quality_extra: '--project=mobile-chromium-320'/);
  assert.match(ci, /quality_extra: '--project=tablet-firefox-1024'/);
});
