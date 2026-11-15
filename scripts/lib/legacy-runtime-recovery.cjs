'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const serviceForPort = new Map([[3000, 'frontend'], [5000, 'backend']]);
const workerMarkers = ['--payment-worker', '--commerce-email-worker', 'dev-payment-runtime'];

function normalized(value) { return String(value ?? '').replaceAll('/', '\\').toLowerCase(); }
function hasWorkspace(commandLine, root) { return normalized(commandLine).includes(normalized(path.resolve(root))); }

function isRoleProcess(process, role, root) {
  if (!process || String(process.name).toLowerCase() !== 'node.exe' || !hasWorkspace(process.commandLine, root)) return false;
  const command = normalized(process.commandLine);
  if (workerMarkers.some(marker => command.includes(marker))) return false;
  if (role === 'frontend') return command.includes('vite');
  return command.includes('bootstrap.ts');
}

function planLegacyRecovery({ root, listeners, processes, controlsPresent = false }) {
  if (controlsPresent) throw new Error('Active supervisor control exists; use its owner-aware stop command.');
  const processByPid = new Map(processes.map(process => [Number(process.pid), process]));
  if (processes.some(process => hasWorkspace(process.commandLine, root) && workerMarkers.some(marker => normalized(process.commandLine).includes(marker)))) {
    throw new Error('A payment or commerce worker/runtime is present; legacy recovery refused.');
  }

  const candidates = processes.filter(process => ['frontend', 'backend'].some(role => isRoleProcess(process, role, root)));
  const roots = new Map();
  for (const process of candidates) {
    const role = isRoleProcess(process, 'frontend', root) ? 'frontend' : 'backend';
    const servicePort = role === 'frontend' ? 3000 : 5000;
    const parent = processByPid.get(Number(process.parentPid));
    if (isRoleProcess(parent, role, root)) continue;
    if (role === 'backend' && (!normalized(process.commandLine).includes('tsx') || !normalized(process.commandLine).includes('watch'))) continue;
    const descendants = [];
    const pending = [Number(process.pid)];
    while (pending.length) {
      const parentPid = pending.pop();
      for (const child of processes.filter(row => Number(row.parentPid) === parentPid)) {
        if (Number(child.pid) === parentPid) continue;
        const childRole = isRoleProcess(child, role, root);
        const helper = String(child.name).toLowerCase() === 'esbuild.exe' && hasWorkspace(child.commandLine, root);
        if (!childRole && !helper) throw new Error(`Process tree for port ${servicePort} contains an unverified child; no process was stopped.`);
        descendants.push(child); pending.push(Number(child.pid));
      }
    }
    roots.set(Number(process.pid), { pid: Number(process.pid), created: process.created, role, port: servicePort, members: descendants.map(row => Number(row.pid)) });
  }
  for (const listener of listeners) {
    const port = Number(listener.port); const role = serviceForPort.get(port);
    if (!role) continue;
    const ownerRoot = [...roots.values()].find(candidate => candidate.role === role &&
      (candidate.pid === Number(listener.pid) || candidate.members.includes(Number(listener.pid))));
    if (!ownerRoot) throw new Error(`Port ${port} has a non-recoverable or foreign owner; no process was stopped.`);
  }
  return [...roots.values()];
}

function inspectWindows() {
  const script = [
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$ErrorActionPreference = 'Stop'",
    "$ports = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(3000,5000) } | ForEach-Object { @{ port=$_.LocalPort; pid=$_.OwningProcess } })",
    "$procs = @(Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object { @{ pid=$_.ProcessId; parentPid=$_.ParentProcessId; name=$_.Name; created=[string]$_.CreationDate; commandLine=$_.CommandLine } })",
    "@{ listeners=$ports; processes=$procs } | ConvertTo-Json -Compress -Depth 5",
  ].join('; ');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
  const snapshot = JSON.parse(output.trim() || '{}');
  return { listeners: snapshot.listeners ?? [], processes: snapshot.processes ?? [] };
}

function runTaskkill(pid) {
  execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true, stdio: 'ignore' });
}

async function recoverLegacy({ root, stackFile, paymentFile, platform = process.platform, inspect = inspectWindows, terminate = runTaskkill, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (platform !== 'win32') throw new Error('Legacy process recovery is supported only on Windows.');
  const fs = require('node:fs');
  if (fs.existsSync(stackFile) || fs.existsSync(paymentFile)) throw new Error('Supervisor control record exists; use documented owner-aware recovery.');
  const initial = inspect();
  const plan = planLegacyRecovery({ root, ...initial });
  if (!plan.length) return { stopped: [], message: 'No eligible abandoned ElectroHub development processes found.' };

  // Revalidate PID creation identity and command ownership immediately before any termination.
  const current = inspect();
  const freshPlan = planLegacyRecovery({ root, ...current });
  for (const target of plan) {
    const fresh = freshPlan.find(row => row.pid === target.pid && row.role === target.role && row.created === target.created);
    if (!fresh) throw new Error('Legacy process identity changed during recovery; no process was stopped.');
  }
  for (const target of plan) terminate(target.pid);
  const tracked = plan.flatMap(target => [target.pid, ...target.members].map(pid => ({
    pid,
    created: current.processes.find(process => Number(process.pid) === pid)?.created,
  })));
  const remaining = [...tracked];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const snapshot = inspect();
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const original = remaining[index];
      const stillSame = snapshot.processes.some(row => Number(row.pid) === original.pid && row.created === original.created);
      if (!stillSame) remaining.splice(index, 1);
    }
    if (!remaining.length && !snapshot.listeners.some(row => serviceForPort.has(Number(row.port)))) break;
    await wait(100);
  }
  if (remaining.length) throw new Error('A verified legacy process did not exit; inspect its owner before retrying.');
  const final = inspect();
  if (final.listeners.some(row => serviceForPort.has(Number(row.port)))) throw new Error('A project port remains occupied after recovery; no further process was stopped.');
  return { stopped: plan.map(({ pid, role, port }) => ({ pid, role, port })), message: 'Verified legacy ElectroHub development process trees stopped.' };
}

module.exports = { inspectWindows, planLegacyRecovery, recoverLegacy };
