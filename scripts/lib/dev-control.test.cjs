'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openControl, controlRequest } = require('./dev-control.cjs');

test('live owner is authenticated, origin requests refused, stop is owner-mediated, credentials never returned', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'electrohub-control-'));
  const file = path.join(folder, 'control.json'); let stops = 0;
  const control = await openControl(file, 'test-repository', () => ({ phase: 'ready' }), () => { stops++; });
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    const url = `http://127.0.0.1:${record.port}/status`;
    assert.equal((await fetch(url)).status, 404);
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${record.token}`, Origin: 'http://evil.example' } })).status, 404);
    const result = await controlRequest(file, 'test-repository');
    assert.equal(result.pid, process.pid); assert.equal(result.phase, 'ready');
    assert.equal(JSON.stringify(result).includes(record.token), false);
    await assert.rejects(controlRequest(file, 'different-repository'), /identity invalid/);
    assert.equal(stops, 0);
    assert.equal(await controlRequest(file, 'test-repository', 'stop'), true);
    await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(stops, 1);
    await assert.rejects(openControl(file, 'test-repository', () => ({}), () => {}), /EEXIST/);
  } finally { await control.close(); fs.rmSync(folder, { recursive: true }); }
});
test('stale/malformed ownership records fail closed and are retained without PID signalling', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'electrohub-stale-control-'));
  const file = path.join(folder, 'control.json');
  try {
    assert.equal(await controlRequest(file, 'test'), null);
    fs.writeFileSync(file, JSON.stringify({ identity: 'test', pid: process.pid, port: 0, token: 'a'.repeat(64) }));
    await assert.rejects(controlRequest(file, 'test', 'stop'), /identity invalid/);
    assert.equal(fs.existsSync(file), true);
    fs.writeFileSync(file, '{invalid');
    await assert.rejects(controlRequest(file, 'test'), /record invalid/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{invalid');
  } finally { fs.rmSync(folder, { recursive: true }); }
});
