'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { planLegacyRecovery, recoverLegacy } = require('./legacy-runtime-recovery.cjs');

const root = 'C:\\workspace\\ElectroHub — AI-Powered Electronics Commerce Platform';
function fixture() {
  const processes = [
    { pid: 100, parentPid: 1, name: 'node.exe', created: 'api-root', commandLine: `${root}\\node_modules\\tsx\\dist\\cli.mjs watch src\\bootstrap.ts` },
    { pid: 101, parentPid: 100, name: 'node.exe', created: 'api-server', commandLine: `${root}\\apps\\backend\\src\\bootstrap.ts` },
    { pid: 102, parentPid: 101, name: 'esbuild.exe', created: 'api-esbuild', commandLine: `${root}\\apps\\backend\\node_modules\\esbuild\\bin\\esbuild` },
    { pid: 200, parentPid: 1, name: 'node.exe', created: 'vite-root', commandLine: `${root}\\node_modules\\vite\\bin\\vite.js` },
    { pid: 201, parentPid: 200, name: 'esbuild.exe', created: 'vite-esbuild', commandLine: `${root}\\apps\\frontend\\node_modules\\esbuild\\bin\\esbuild` },
  ];
  return { listeners: [{ port: 5000, pid: 101 }, { port: 3000, pid: 200 }], processes };
}

test('recovery plan contains only verified workspace API and Vite trees', () => {
  const plan = planLegacyRecovery({ root, ...fixture() });
  assert.deepEqual(plan.map(({ pid, role, port, members }) => ({ pid, role, port, members })), [
    { pid: 100, role: 'backend', port: 5000, members: [101, 102] },
    { pid: 200, role: 'frontend', port: 3000, members: [201] },
  ]);
});

test('recovery can find abandoned workspace dev trees even after their listeners have disappeared', () => {
  const plan = planLegacyRecovery({ root, listeners: [], processes: fixture().processes });
  assert.deepEqual(plan.map(({ pid, role }) => ({ pid, role })), [
    { pid: 100, role: 'backend' }, { pid: 200, role: 'frontend' },
  ]);
});

test('recovery refuses foreign ports, controls, payment workers, and unverified descendants', () => {
  const data = fixture();
  assert.throws(() => planLegacyRecovery({ root, ...data, controlsPresent: true }), /control exists/);
  assert.throws(() => planLegacyRecovery({ root, ...data, listeners: [{ port: 5000, pid: 999 }] }), /foreign owner/);
  assert.throws(() => planLegacyRecovery({ root, ...data, processes: [...data.processes, { pid: 300, parentPid: 1, name: 'node.exe', commandLine: `${root}\\apps\\backend\\scripts\\dev-payment-runtime.cjs` }] }), /payment or commerce worker/);
  assert.throws(() => planLegacyRecovery({ root, ...data, processes: [...data.processes, { pid: 103, parentPid: 100, name: 'python.exe', commandLine: 'unrelated process' }] }), /unverified child/);
});

test('recovery revalidates process identity, terminates only verified roots, and confirms ports are released', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'electrohub-legacy-recovery-'));
  const calls = []; let count = 0;
  const inspect = () => {
    count += 1;
    return count < 3 ? fixture() : { listeners: [], processes: [] };
  };
  try {
    const result = await recoverLegacy({ root, stackFile: path.join(directory, 'stack-control.json'), paymentFile: path.join(directory, 'payment-control.json'),
      platform: 'win32', inspect, terminate: pid => calls.push(pid), wait: async () => {} });
    assert.deepEqual(calls, [100, 200]);
    assert.deepEqual(result.stopped.map(item => item.pid), [100, 200]);
    assert.equal(count, 4);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('recovery refuses when process identity changes before termination', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'electrohub-legacy-race-'));
  let count = 0; let terminated = false;
  const inspect = () => {
    count += 1; const value = fixture();
    if (count === 2) value.processes[0].created = 'reused-pid';
    return value;
  };
  try {
    await assert.rejects(recoverLegacy({ root, stackFile: path.join(directory, 'stack-control.json'), paymentFile: path.join(directory, 'payment-control.json'),
      platform: 'win32', inspect, terminate: () => { terminated = true; } }), /identity changed/);
    assert.equal(terminated, false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('recovery is unavailable outside Windows', async () => {
  await assert.rejects(recoverLegacy({ root, stackFile: 'missing-stack', paymentFile: 'missing-payment', platform: 'linux' }), /only on Windows/);
});
