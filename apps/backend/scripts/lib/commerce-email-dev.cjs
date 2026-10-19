'use strict';
/*
 * Task 03.8 development runtime helpers shared by `payment:dev` (shared Supabase DEV) and `dev:isolated` (disposable local PostgreSQL).
 * Pure helpers plus one supervised child: the commerce email worker. Nothing here reads or prints secrets, recipients or snapshots.
 *
 *  - describeEmailRuntime(env): the same credential-free state the TypeScript processes log as `email_runtime`, with actionable warnings.
 *  - startEmailWorker(options): spawns the worker, restarts it after crashes (bounded), never restarts a configuration refusal (exit 78),
 *    refuses to start a second supervised worker, and stops it with its parent. Duplicate workers are still DB-safe (leases), this only
 *    avoids wasted load and confusing logs.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn: nodeSpawn } = require('node:child_process');

const EXIT_CONFIG_REFUSED = 78;
const SHOWN_EVENTS = new Set(['email_worker_permission', 'email_worker_ready', 'email_worker_unavailable', 'email_provider_accepted',
  'email_retry_scheduled', 'email_send_uncertain', 'email_delivery_failed', 'email_event_suppressed']);

const flag = value => String(value ?? '').trim().toLowerCase() === 'true';
const list = value => String(value ?? '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);

function describeEmailRuntime(env) {
  const producer = flag(env.COMMERCE_EMAIL_ENQUEUE_ENABLED);
  const dispatch = flag(env.COMMERCE_EMAIL_DISPATCH_ENABLED);
  const sendMode = ['disabled', 'capture', 'allowlist', 'live'].includes(env.COMMERCE_EMAIL_SEND_MODE) ? env.COMMERCE_EMAIL_SEND_MODE : 'disabled';
  const allowlistSize = list(env.COMMERCE_EMAIL_ALLOWED_RECIPIENTS).length;
  const origin = Boolean(env.COMMERCE_EMAIL_ORIGIN || env.FRONTEND_URL);
  const brevoKey = Boolean(env.BREVO_API_KEY);
  const sends = dispatch && sendMode !== 'disabled';
  const warnings = [];
  if (producer && !sends) warnings.push('Producer is ON but dispatch is off / send mode disabled: events will queue and nothing will send.');
  if (!producer && sends) warnings.push('Sending is configured but COMMERCE_EMAIL_ENQUEUE_ENABLED is not true: purchases create no email events.');
  if (!producer && !sends) warnings.push('Commerce emails are OFF (COMMERCE_EMAIL_ENQUEUE_ENABLED / COMMERCE_EMAIL_DISPATCH_ENABLED / COMMERCE_EMAIL_SEND_MODE).');
  if (sendMode === 'allowlist' && !allowlistSize) warnings.push('Allowlist mode with COMMERCE_EMAIL_ALLOWED_RECIPIENTS empty: nothing will be sent.');
  if (['allowlist', 'live'].includes(sendMode) && !brevoKey) warnings.push('Real sending needs BREVO_API_KEY (the worker would pause on a missing key).');
  if ((producer || sends) && !origin) warnings.push('Set COMMERCE_EMAIL_ORIGIN or FRONTEND_URL (emails link to the frontend).');
  return { producerEnabled: producer, dispatchEnabled: dispatch, sendMode, allowlistSize, originConfigured: origin, brevoKeyPresent: brevoKey,
    workerWillRun: sends && (sendMode !== 'allowlist' || allowlistSize > 0), warnings };
}

function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } }

/** Acquires `<backend>/.cache/commerce-email-worker.lock`; replaces a lock whose owner is gone, refuses a live one. */
function acquireWorkerLock(backend) {
  const file = path.join(backend, '.cache/commerce-email-worker.lock');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    let owner = null;
    try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* corrupt: treat as stale */ }
    if (owner && Number.isInteger(owner.supervisorPid) && alive(owner.supervisorPid) && owner.supervisorPid !== process.pid) return { held: false, ownerPid: owner.supervisorPid };
    fs.unlinkSync(file);
  }
  fs.writeFileSync(file, JSON.stringify({ supervisorPid: process.pid, createdAt: new Date().toISOString() }), { flag: 'wx' });
  return { held: true, release: () => { try { if (JSON.parse(fs.readFileSync(file, 'utf8')).supervisorPid === process.pid) fs.unlinkSync(file); } catch { /* already gone */ } } };
}

/**
 * The worker logs to the structured log file (not stdout) in development, so readiness is confirmed from that file: its own
 * `email_worker_ready` (or a refused `email_worker_permission`) for this child's pid. Reads a bounded tail; never prints fields beyond a few safe ones.
 */
function readinessOf(logFile, pid) {
  let text = '';
  try {
    const fd = fs.openSync(logFile, 'r');
    try { const { size } = fs.fstatSync(fd); const length = Math.min(size, 262144); const buffer = Buffer.alloc(length); fs.readSync(fd, buffer, 0, length, size - length); text = buffer.toString('utf8'); }
    finally { fs.closeSync(fd); }
  } catch { return null; }
  let verdict = null;
  for (const line of text.split('\n')) {
    if (!line.includes('"email_worker_')) continue;
    let record; try { record = JSON.parse(line); } catch { continue; }
    if (record.pid !== pid) continue;
    if (record.event === 'email_worker_ready') verdict = { ready: true, sendMode: record.sendMode };
    else if (record.event === 'email_worker_permission' && record.allowed === false) verdict = { ready: false, reason: record.reason };
    else if (record.event === 'email_worker_unavailable') verdict = { ready: false, reason: record.reason };
  }
  return verdict;
}

/**
 * options: { backend, entry: { command, args }, env, log, spawn?, now?, maxRestarts?, windowMs?, backoffMs? }
 * Resolves { started: boolean, reason?, stop() }.
 */
function startEmailWorker(options) {
  const log = options.log ?? (line => console.log(line));
  const spawnProcess = options.spawn ?? nodeSpawn;
  const now = options.now ?? Date.now;
  const maxRestarts = options.maxRestarts ?? 5; const windowMs = options.windowMs ?? 5 * 60_000; const backoff = options.backoffMs ?? [2000, 4000, 8000, 16000, 30000];
  const runtime = describeEmailRuntime(options.env);
  if (!runtime.workerWillRun) return { started: false, reason: 'not-configured', runtime, stop: async () => {} };
  const lock = acquireWorkerLock(options.backend);
  if (!lock.held) return { started: false, reason: `already-running (supervisor pid ${lock.ownerPid})`, runtime, stop: async () => {} };

  let child = null; let stopping = false; const restarts = [];
  const show = chunk => {
    for (const line of String(chunk).split('\n')) {
      let record; try { record = JSON.parse(line); } catch { continue; }
      if (record && SHOWN_EVENTS.has(record.event)) {
        const detail = ['sendMode', 'reason', 'allowed', 'errorCode', 'type', 'attemptNumber'].filter(key => record[key] !== undefined).map(key => `${key}=${record[key]}`).join(' ');
        log(`[email-worker] ${record.event} ${detail}`.trim());
      }
    }
  };
  const launch = () => {
    child = spawnProcess(options.entry.command, options.entry.args, { cwd: options.backend, env: options.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', show); child.stderr.on('data', show);
    child.once('exit', code => {
      if (stopping) return;
      if (code === EXIT_CONFIG_REFUSED) { log('[email-worker] STOPPED: configuration or schema refused (not restarted). Fix it and restart the dev runtime.'); lock.release(); return; }
      const at = now();
      while (restarts.length && at - restarts[0] > windowMs) restarts.shift();
      if (restarts.length >= maxRestarts) { log(`[email-worker] GAVE UP after ${maxRestarts} restarts in ${Math.round(windowMs / 60000)} min (last exit code ${code}). Purchases still succeed; queued emails wait for the next healthy worker.`); lock.release(); return; }
      restarts.push(at);
      const delay = backoff[Math.min(restarts.length - 1, backoff.length - 1)];
      log(`[email-worker] exited (code ${code}); restarting in ${delay / 1000}s (${restarts.length}/${maxRestarts})`);
      setTimeout(() => { if (!stopping) launch(); }, delay).unref?.();
    });
    child.once('error', () => log('[email-worker] failed to start'));
    watchReadiness(child);
  };
  const logFile = path.join(options.env.ELECTROHUB_LOG_DIR || path.join(options.backend, 'logs'), 'app.log');
  const watchReadiness = target => {
    if (options.readiness === false || !target.pid) return;
    const startedAt = now(); const pid = target.pid;
    const timer = setInterval(() => {
      if (stopping || target !== child) return clearInterval(timer);
      const verdict = readinessOf(logFile, pid);
      if (verdict?.ready) { log(`[email-worker] READY (pid ${pid}, send mode ${verdict.sendMode})`); clearInterval(timer); }
      else if (verdict && verdict.ready === false) { log(`[email-worker] NOT SENDING: ${verdict.reason}`); clearInterval(timer); }
      else if (now() - startedAt > (options.readyTimeoutMs ?? 40_000)) { log(`[email-worker] NOT READY after ${Math.round((options.readyTimeoutMs ?? 40_000) / 1000)}s: look for email_worker_* events in ${path.relative(options.backend, logFile)}`); clearInterval(timer); }
    }, options.readyPollMs ?? 1000);
    timer.unref?.();
  };
  launch();
  return { started: true, runtime, stop: async () => { stopping = true; try { child?.kill(); } catch { /* already exited */ } lock.release(); } };
}

module.exports = { describeEmailRuntime, acquireWorkerLock, startEmailWorker, readinessOf, EXIT_CONFIG_REFUSED };
