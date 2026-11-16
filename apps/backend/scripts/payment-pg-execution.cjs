'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { verifyRoot } = require('./payment-pg-ca.cjs');

const PROJECT = 'pzxekjybdiulzmssalfo';
const SCHEMA = 'electrohub_payment_concurrency_20261012';
const HOST = 'aws-0-ap-northeast-2.pooler.supabase.com';
const ROLE = 'eh_payment_concurrency_runner';
const backendRoot = path.resolve(__dirname, '..');
const testFile = 'src/services/__tests__/payment.concurrency.postgres.integration.test.ts';
const configFile = 'vitest.config.mts';

function failure(label, treeStopped = true) {
  const error = new Error(label);
  error.label = label;
  error.treeStopped = treeStopped;
  return error;
}

function migrationUrl(original, caPath, read = fs.readFileSync) {
  const url = new URL(original);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw failure('MIGRATION_TARGET_REJECTED');
  if (url.hostname !== HOST || url.port !== '5432' || url.pathname !== '/postgres' ||
      decodeURIComponent(url.username) !== `${ROLE}.${PROJECT}` || url.searchParams.get('schema') !== SCHEMA ||
      url.searchParams.get('options') !== `-csearch_path=${SCHEMA}` || url.searchParams.get('sslmode') !== 'require') {
    throw failure('MIGRATION_TARGET_REJECTED');
  }
  const allowed = new Set(['sslmode', 'connection_limit', 'schema', 'options']);
  const seen = new Set();
  for (const [key] of url.searchParams) {
    if (!allowed.has(key) || seen.has(key)) throw failure('MIGRATION_OPTIONS_REJECTED');
    seen.add(key);
  }
  if (!caPath || !path.isAbsolute(caPath)) throw failure('MIGRATION_CA_REQUIRED');
  verifyRoot(read(caPath, 'utf8'));
  // Prisma 6.12 native connector reads sslcert as a trusted root; sslrootcert is
  // not parsed by that pinned engine. Neither URL nor CA path is emitted.
  url.searchParams.set('sslcert', caPath);
  url.searchParams.set('sslaccept', 'strict');
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('connect_timeout', '5');
  url.searchParams.set('pool_timeout', '5');
  url.searchParams.set('socket_timeout', '30');
  url.searchParams.set('options', `-csearch_path=${SCHEMA} -cstatement_timeout=30000 -clock_timeout=5000`);
  return url.toString();
}

function stageDefinitions(env = process.env, read = fs.readFileSync) {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw failure('TLS_OVERRIDE_REJECTED');
  for (const pkg of ['prisma', '@prisma/engines']) {
    const version = JSON.parse(read(path.join(backendRoot, 'node_modules', pkg, 'package.json'), 'utf8')).version;
    if (version !== '6.12.0') throw failure('PRISMA_VERSION_REVIEW_REQUIRED');
  }
  if (!fs.existsSync(path.join(backendRoot, configFile)) || !fs.existsSync(path.join(backendRoot, testFile))) {
    throw failure('TEST_SELECTION_MISSING');
  }
  const original = env.PAYMENT_PG_TEST_DATABASE_URL;
  const strictUrl = migrationUrl(original, env.NODE_EXTRA_CA_CERTS, read);
  const common = { ...env, NODE_ENV: 'test', STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: 'whsec_local_signature_fixture_only', ELECTROHUB_SQL_DIAGNOSTICS: '0' };
  return [
    { name: 'migration_tls', args: [path.join(backendRoot, 'node_modules/prisma/build/index.js'),
      'db', 'execute', '--schema', 'prisma/schema.prisma', '--file', 'scripts/payment-pg-engine-probe.sql'],
    env: { ...common, DATABASE_URL: strictUrl, DIRECT_URL: strictUrl }, timeoutMs: 30_000 },
    { name: 'migration', args: [path.join(backendRoot, 'node_modules/prisma/build/index.js'),
      'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
    env: { ...common, DATABASE_URL: strictUrl, DIRECT_URL: strictUrl }, timeoutMs: 120_000 },
    { name: 'tests', args: [path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs'),
      'run', '--pool=forks', '--maxWorkers=1', '--no-file-parallelism', testFile,
      '--config', configFile, '--reporter=json', '--testTimeout=30000', '--hookTimeout=30000'],
    env: { ...common, DATABASE_URL: original, DIRECT_URL: original, PAYMENT_PG_TEST_INTERNAL_RUN: '1' }, timeoutMs: 120_000 },
  ];
}

function verifyTestReport(stdout) {
  const start = stdout.search(/\{\s*"numTotalTestSuites"\s*:/);
  let report;
  try { report = JSON.parse(stdout.slice(start)); } catch { throw failure('TEST_REPORT_INVALID'); }
  const files = report.testResults;
  if (start < 0 || report.success !== true || report.numTotalTests !== 10 || report.numPassedTests !== 10 ||
      report.numFailedTests !== 0 || report.numPendingTests !== 0 || report.numTodoTests !== 0 ||
      !Array.isArray(files) || files.length !== 1 ||
      path.resolve(files[0].name) !== path.resolve(backendRoot, testFile) ||
      files[0].assertionResults?.length !== 10 || files[0].assertionResults.some(t => t.status !== 'passed')) {
    throw failure('TESTS_FAILED_SKIPPED_OR_WRONG_SELECTION');
  }
  const scenarios = new Set(files[0].assertionResults.map(t => t.title?.match(/^([A-J]) — /)?.[1]));
  if (scenarios.size !== 10 || scenarios.has(undefined)) throw failure('TEST_SCENARIOS_MISSING');
  return { passed: 10, failed: 0, skipped: 0 };
}

function signalControl(owner = process) {
  const controller = new AbortController();
  const cleanupController = new AbortController();
  const cancel = () => {
    if (controller.signal.aborted) cleanupController.abort();
    else controller.abort();
  };
  owner.on('SIGINT', cancel); owner.on('SIGTERM', cancel);
  return { controller, cleanupController, dispose() {
    owner.removeListener('SIGINT', cancel); owner.removeListener('SIGTERM', cancel);
  } };
}

function capacityCheck(sample, { admission = false, riskAccepted = false, now = Date.now() } = {}) {
  if (sample?.status !== 'PASS') throw failure('MONITOR_OBSERVER_BLOCKED');
  if (!sample || sample.project !== PROJECT || !Number.isFinite(sample.timestampMs) ||
      now - sample.timestampMs > 10_000 || sample.timestampMs > now + 1000) throw failure('MONITOR_STALE_OR_WRONG_TARGET');
  const integer = v => Number.isInteger(v) && v >= 0;
  if (!integer(sample.clientBackends) || !integer(sample.runnerBackends) ||
      sample.ordinaryLimit !== 57 || sample.clientBackendScope !== 'cluster' || sample.devConnectionErrors !== false ||
      sample.abnormalLockWait !== false || sample.tlsIsolationPass !== true) throw failure('DEV_HEALTH_OR_ISOLATION_STOP');
  // The marked schema must exist for every monitor sample, including the
  // pre-cleanup sample. Cleanup itself verifies absence after its DROP RESTRICT.
  if (sample.schemaState !== 'present') throw failure('MONITOR_SCHEMA_ABSENT');
  // All 19 proposed reserves (16 normal + 2 contingency + 1 observer) remain
  // unavailable to the test. 57 - 19 = 38; admission reserves another 4 slots.
  if (sample.clientBackends > (admission ? 34 : 38) || sample.runnerBackends > (admission ? 0 : 4)) {
    throw failure('POSTGRES_CONNECTION_BUDGET_STOP');
  }
  if (sample.poolerClients === null || sample.queueDurationMs === null) {
    if (!riskAccepted) throw failure('POOLER_VISIBILITY_APPROVAL_REQUIRED');
  }
  if (sample.poolerClients !== null && (!integer(sample.poolerClients) || sample.poolerClients > (admission ? 173 : 177))) {
    throw failure('POOLER_CLIENT_BUDGET_STOP');
  }
  if (sample.queueDurationMs !== null && (!integer(sample.queueDurationMs) ||
      sample.queueDurationMs > (admission ? 0 : 5000))) throw failure('POOLER_QUEUE_STOP');
}

function fileMonitor(file, riskAccepted) {
  if (!file || !path.isAbsolute(file)) throw failure('MONITOR_FILE_REQUIRED');
  return (admission) => {
    let sample;
    try {
      if (fs.statSync(file).size > 4096) throw failure('MONITOR_INVALID');
      sample = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { throw failure('MONITOR_UNAVAILABLE'); }
    capacityCheck(sample, { admission, riskAccepted });
  };
}

function runChild(stage, { signal, monitor = () => {}, spawnChild = spawn,
  platform = process.platform, timeoutMs = stage.timeoutMs, cancellationGraceMs = 5000 } = {}) {
  // The Windows guardian creates the target suspended, assigns a Job Object,
  // then resumes it. Kill-on-job-close also covers grandchildren and parent loss.
  // Other platforms fail closed until an equivalent containment is verified.
  if (platform !== 'win32') return Promise.reject(failure('WINDOWS_CONTAINMENT_REQUIRED'));
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(failure('OWNER_CANCELED')); return; }
    let child, reason, stdout = '', stderr = '', bytes = 0, timer, watchdog, terminationTimer;
    const decoder = new StringDecoder('utf8');
    const cancel = label => {
      if (reason) return;
      reason = label;
      if (child) child.kill(); // Only the owned guardian; kernel closes its job.
      terminationTimer = setTimeout(() => {
        dispose();
        child.stdout.destroy(); child.stderr.destroy(); child.unref();
        reject(failure('CHILD_TERMINATION_UNCONFIRMED', false));
      }, cancellationGraceMs);
    };
    const abort = () => cancel('OWNER_CANCELED');
    try {
      monitor(false, stage.name);
      const payload = Buffer.from(JSON.stringify({ exe: process.execPath, args: stage.args })).toString('base64');
      child = spawnChild('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(__dirname, 'payment-pg-child-guard.ps1'), '-Payload', payload,
        '-OwnerPid', String(process.pid), '-TimeoutMs', String(timeoutMs)],
      { cwd: backendRoot, env: stage.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { reject(failure('CHILD_START_FAILED')); return; }
    signal?.addEventListener('abort', abort, { once: true });
    const consume = (chunk, collect) => {
      bytes += chunk.length;
      if (bytes > 4 * 1024 * 1024) cancel('CHILD_OUTPUT_LIMIT');
      else if (collect) stdout += decoder.write(chunk);
      else stderr += chunk.toString();
    };
    child.stdout.on('data', chunk => consume(chunk, true));
    child.stderr.on('data', chunk => consume(chunk, false)); // Never forward raw child errors.
    watchdog = setInterval(() => { try { monitor(false, stage.name); } catch (error) { cancel(error.label ?? 'MONITOR_STOP'); } }, 1000);
    timer = setTimeout(() => cancel('CHILD_TIMEOUT'), timeoutMs + 5000);
    const dispose = () => { clearInterval(watchdog); clearTimeout(timer); clearTimeout(terminationTimer);
      signal?.removeEventListener('abort', abort); };
    child.once('error', () => { dispose(); reject(failure('CHILD_START_FAILED')); });
    child.once('close', (code, exitSignal) => {
      dispose();
      stdout += decoder.end();
      // Native guard confirms Job ActiveProcesses=0 before success/nonzero exit.
      // A forcibly killed guard closes the sole job handle; KILL_ON_JOB_CLOSE
      // terminates its entire assigned process tree before cleanup is allowed.
      if (reason) { reject(failure(reason)); return; }
      if (exitSignal || code === 125) { reject(failure('CHILD_CONTAINMENT_UNCONFIRMED', false)); return; }
      if (code === 124) { reject(failure('CHILD_TIMEOUT')); return; }
      if (code !== 0) {
        const safeCode = (stdout + stderr).match(/\b(53300|57P03|57014|P2024|P2028|P1011)\b/)?.[1];
        const error = failure(safeCode ? `CHILD_DATABASE_ERROR_${safeCode}` : 'CHILD_NONZERO_EXIT');
        error.exitCode = code; reject(error); return;
      }
      resolve({ stdout });
    });
  });
}

async function executeStages(stages, { run = runChild, cleanup, monitor, signal, emit = console.log }) {
  let started = false, stopped = true, failed = false;
  try {
    monitor(true);
    for (const stage of stages) {
      if (signal?.aborted) throw failure('OWNER_CANCELED');
      monitor(false, stage.name);
      if (stage.name === 'migration') started = true;
      const result = await run(stage, { signal, monitor });
      if (stage.name === 'tests') verifyTestReport(result.stdout);
      emit(`${stage.name.toUpperCase()} PASS`);
    }
  } catch (error) {
    failed = true; stopped = error.treeStopped !== false;
    emit(`SUITE FAIL: ${error.label ?? 'EXECUTION_FAILED'}${Number.isInteger(error.exitCode) ? ` exit=${error.exitCode}` : ''}`);
  } finally {
    if (started && stopped) {
      // Admission failures never trigger a DROP. Health failures never silently
      // bypass the monitor to clean up; retain isolated objects if unsafe.
      try { monitor(false, 'cleanup'); await cleanup(); emit('CLEANUP PASS: marked schema absence verified.'); }
      catch { failed = true; emit('CLEANUP FAIL: cleanup blocked or failed; isolated schema may remain.'); }
    } else if (started) { failed = true; emit('CLEANUP BLOCKED: child termination unconfirmed.'); }
  }
  return !failed;
}

module.exports = { migrationUrl, stageDefinitions, verifyTestReport, capacityCheck, fileMonitor, runChild, executeStages, signalControl };
