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
const { randomBytes } = require('node:crypto');

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

/**
 * Acquires `<backend>/.cache/<name>.lock`; replaces a lock whose owner is gone, refuses a live one. One worker per environment:
 * MAIN DEV and isolated QA dispatch from different databases, so each has its own lock and neither blocks the other.
 */
const LOCK_NAME = /^commerce-email-worker(?:\.[a-z]+)?$/;
function acquireWorkerLock(backend, name = 'commerce-email-worker') {
  if (!LOCK_NAME.test(name)) throw new Error('Invalid email worker lock name.');
  const file = path.join(backend, `.cache/${name}.lock`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    let owner = null;
    try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('Email worker lock is unreadable; inspect ownership before removing it.'); }
    if (!owner || !Number.isInteger(owner.supervisorPid) || owner.supervisorPid < 1) throw new Error('Email worker lock identity is invalid; no worker started.');
    if (owner && Number.isInteger(owner.supervisorPid) && alive(owner.supervisorPid)) return { held: false, ownerPid: owner.supervisorPid };
    fs.unlinkSync(file);
  }
  const lockId = randomBytes(16).toString('hex');
  fs.writeFileSync(file, JSON.stringify({ supervisorPid: process.pid, lockId, createdAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  return { held: true, release: () => { try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value.supervisorPid === process.pid && value.lockId === lockId) fs.unlinkSync(file);
  } catch { /* already gone or changed: retain */ } } };
}

/**
 * The worker logs to the structured log file (not stdout) in development, so readiness is confirmed from that file: its own
 * `email_worker_ready` (or a refused `email_worker_permission`) for this child's pid. Reads a bounded tail; never prints fields beyond a few safe ones.
 */
function readinessOf(logFile, pid, since = 0) {
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
    const at = Date.parse(record.timestamp);
    if (since && (!Number.isFinite(at) || at < since)) continue;
    if (record.event === 'email_worker_ready') verdict = { ready: true, sendMode: record.sendMode };
    else if (record.event === 'email_worker_permission' && record.allowed === false) verdict = { ready: false, reason: record.reason };
    else if (record.event === 'email_worker_unavailable') verdict = { ready: false, reason: record.reason };
    else if (record.event === 'email_worker_heartbeat') verdict = { ready: !record.paused && !record.attention,
      reason: record.paused || record.attention ? 'QUEUE_NEEDS_ATTENTION' : undefined, sendMode: record.sendMode };
    if (verdict && Number.isFinite(at)) verdict.observedAt = at;
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
  const lock = acquireWorkerLock(options.backend, options.lockName);
  if (!lock.held) return { started: false, reason: `already-running (supervisor pid ${lock.ownerPid})`, runtime, stop: async () => {} };

  let child = null; let stopping = false; const restarts = [];
  let restartTimer = null; let readinessTimer = null; let launchedAt = 0;
  let current = { started: true, ready: false, reason: 'starting' }; let stopPromise;
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
    launchedAt = now(); current = { started: true, ready: false, reason: 'starting' };
    child = spawnProcess(options.entry.command, options.entry.args, { cwd: options.backend, env: options.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.on('data', show); child.stderr.on('data', show);
    let handled = false;
    const onExit = code => {
      if (handled) return; handled = true;
      clearInterval(readinessTimer);
      current = { started: false, ready: false, reason: 'exited' };
      if (stopping) return;
      if (code === EXIT_CONFIG_REFUSED) { log('[email-worker] STOPPED: configuration or schema refused (not restarted). Fix it and restart the dev runtime.'); lock.release(); return; }
      const at = now();
      while (restarts.length && at - restarts[0] > windowMs) restarts.shift();
      if (restarts.length >= maxRestarts) { log(`[email-worker] GAVE UP after ${maxRestarts} restarts in ${Math.round(windowMs / 60000)} min (last exit code ${code}). Purchases still succeed; queued emails wait for the next healthy worker.`); lock.release(); return; }
      restarts.push(at);
      const delay = backoff[Math.min(restarts.length - 1, backoff.length - 1)];
      log(`[email-worker] exited (code ${code}); restarting in ${delay / 1000}s (${restarts.length}/${maxRestarts})`);
      current.reason = 'restart-backoff';
      restartTimer = setTimeout(() => { if (!stopping) launch(); }, delay); restartTimer.unref?.();
    };
    child.once('exit', onExit);
    child.once('error', () => { log('[email-worker] failed to start'); onExit(-1); });
    watchReadiness(child);
  };
  const logFile = path.join(options.env.ELECTROHUB_LOG_DIR || path.join(options.backend, 'logs'), 'app.log');
  const watchReadiness = target => {
    if (options.readiness === false || !target.pid) return;
    const startedAt = now(); const pid = target.pid;
    let shown = null;
    const timer = readinessTimer = setInterval(() => {
      if (stopping || target !== child) return clearInterval(timer);
      const verdict = readinessOf(logFile, pid, launchedAt);
      if (verdict?.observedAt && now() - verdict.observedAt > 150000) { verdict.ready = false; verdict.reason = 'HEARTBEAT_STALE'; }
      if (verdict) current = { started: true, ready: verdict.ready, reason: verdict.ready ? 'worker-readiness-observed' : 'worker-unavailable' };
      if (verdict?.ready && shown !== true) { log(`[email-worker] READY (pid ${pid}, send mode ${verdict.sendMode})`); shown = true; }
      else if (verdict && !verdict.ready && shown !== false) { log('[email-worker] NOT SENDING: inspect email_worker_* events.'); shown = false; }
      else if (!verdict && now() - startedAt > (options.readyTimeoutMs ?? 40_000) && shown !== false) {
        current.reason = 'readiness-timeout'; shown = false;
        log('[email-worker] NOT READY: inspect email_worker_* events in the backend log.');
      }
    }, options.readyPollMs ?? 1000);
    timer.unref?.();
  };
  launch();
  return { started: true, runtime, status: () => ({ ...current, pid: child?.pid, sendMode: runtime.sendMode,
    producerEnabled: runtime.producerEnabled }), stop: () => {
    if (stopPromise) return stopPromise;
    stopping = true; current.ready = false; current.reason = 'stopping';
    clearTimeout(restartTimer); clearInterval(readinessTimer);
    stopPromise = (async () => {
      const target = child;
      if (target && Number.isInteger(target.pid) && target.exitCode === null && !target.signalCode) {
        const wait = ms => new Promise(resolve => {
          const done = () => { clearTimeout(timer); target.removeListener('exit', done); resolve(true); };
          const timer = setTimeout(() => { target.removeListener('exit', done); resolve(false); }, ms);
          target.once('exit', done);
        });
        const drained = wait(options.shutdownGraceMs ?? 35000);
        try { if (target.connected) target.disconnect(); else target.kill('SIGTERM'); } catch { /* drain deadline */ }
        if (!await drained) {
          log('[email-worker] drain deadline exceeded; durable leases retained for recovery.');
          const forced = wait(2000); try { target.kill('SIGKILL'); } catch { /* retain lock below */ }
          if (!await forced) throw new Error('Email worker did not stop; ownership lock retained.');
        }
      } else { try { target?.kill(); } catch { /* already gone */ } }
      current.started = false; current.reason = 'stopped'; lock.release();
    })();
    return stopPromise;
  } };
}

module.exports = { describeEmailRuntime, acquireWorkerLock, startEmailWorker, readinessOf, EXIT_CONFIG_REFUSED };
