// Explicit foreground DEV supervisor. No migrations, fixtures, or payments are
// submitted by this script. --start --allow-dev-recovery authorizes the runner
// to reconcile existing DEV work; never run it automatically from API startup.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const safety = require('./stripe-gate-safety.cjs');
const verifier = require('./stripe-webhook-verifier.cjs');
const backend = path.resolve(__dirname, '..');

function existingPaymentProcesses() {
  if (process.platform === 'win32') {
    // tsx/npm watchers often name the repository's node_modules executable
    // and a relative src/server.ts, rather than the absolute backend folder.
    const quotedRepository = path.resolve(backend, '../..').replace(/'/g, "''");
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | ForEach-Object { ` +
      `$taskCommand=[string]$_.CommandLine; if ($taskCommand -match 'payment-runner\\.(js|ts)') { ` +
      `[pscustomobject]@{pid=$_.ProcessId;kind='runner'} } elseif (` +
      `$taskCommand.IndexOf('${quotedRepository}',[StringComparison]::OrdinalIgnoreCase) -ge 0 -and ` +
      `$taskCommand -match '(src|dist)[/\\\\]+server\\.(ts|js)') { ` +
      `[pscustomobject]@{pid=$_.ProcessId;kind='backend'} } }) | ConvertTo-Json -Compress`],
    { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const parsed = raw.trim() ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  return execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8', timeout: 5000 }).split('\n')
    .flatMap(line => {
      const kind = /payment-runner\.(js|ts)/.test(line) ? 'runner' :
        line.includes(path.resolve(backend, '../..')) && /(?:src|dist)[/\\]+server\.(ts|js)/.test(line) ? 'backend' : null;
      return kind ? [{ pid: Number(line.trim().split(/\s+/)[0]), kind }] : [];
    });
}

function acquireLock() {
  const file = path.join(backend, '.cache/dev-payment-runtime.lock');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Never remove/reuse another supervisor's lock automatically. A developer
  // must confirm its recorded processes are stopped before removing stale data.
  const descriptor = fs.openSync(file, 'wx');
  fs.writeFileSync(descriptor, JSON.stringify({ supervisorPid: process.pid, createdAt: new Date().toISOString() }));
  fs.closeSync(descriptor);
  return { record: pids => fs.writeFileSync(file, JSON.stringify({ supervisorPid: process.pid, ownedPids: pids })),
    release: () => { const owner = JSON.parse(fs.readFileSync(file)); if (owner.supervisorPid === process.pid) fs.unlinkSync(file); } };
}

function argumentsFor(argv) {
  if (argv.some(arg => !['--preflight', '--start', '--allow-dev-recovery'].includes(arg)) || new Set(argv).size !== argv.length ||
    argv.includes('--start') && argv.includes('--preflight')) throw new Error('Use --preflight or --start --allow-dev-recovery.');
  const start = argv.includes('--start');
  if (start && !argv.includes('--allow-dev-recovery')) throw new Error('Starting a DEV runner requires explicit --allow-dev-recovery.');
  return { start };
}

async function preflight(deps = {}) {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Production/insecure TLS forbidden.');
  process.chdir(backend); process.env.NODE_ENV = 'development';
  const existing = (deps.inspectProcesses || existingPaymentProcesses)();
  if (existing.length) {
    const kinds = [...new Set(existing.map(child => child.kind))].join('/');
    throw new Error(`Existing ${kinds} process detected, including dormant watchers. Confirm ownership and stop it yourself; no process was terminated.`);
  }
  const { env } = require('../dist/config/env.js');
  if (!safety.describeDatabase(env.DIRECT_URL || env.DATABASE_URL).dev || !/^sk_test_/.test(env.STRIPE_SECRET_KEY || '')) throw new Error('Exact DEV and Stripe Test Mode required.');
  if (!env.DB_SSL_CA_CERT_PATH || !fs.existsSync(env.DB_SSL_CA_CERT_PATH)) throw new Error('Verified TLS CA is required.');
  const { prisma } = require('../dist/lib/prisma.js');
  try {
    const at = Date.now(); await prisma.$queryRaw`SELECT 1`;
    const databaseMs = Date.now() - at;
    const rows = await prisma.$queryRaw`SELECT count(*)::int AS others FROM pg_stat_activity WHERE usename=current_user AND datname=current_database() AND pid<>pg_backend_pid()`;
    if (rows[0].others + 10 > 15) throw new Error('Existing sessions plus API/runner reserve exceed confirmed DEV limit 15.');
    const migrations = await prisma.$queryRaw`SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    for (const name of ['20261007000000_stripe_orchestration', '20261009000000_product_test_fixture_visibility']) {
      const checksum = crypto.createHash('sha256').update(fs.readFileSync(path.join(backend, 'prisma/migrations', name, 'migration.sql'))).digest('hex');
      if (migrations.find(row => row.migration_name === name)?.checksum !== checksum) throw new Error('Required migration/checksum unavailable; do not migrate automatically.');
    }
    await require('../dist/services/stripe.provider.js').stripeProvider.account();
    await safety.assertPortAvailable(env.PORT);
    return { port: env.PORT, databaseMs, otherSessions: rows[0].others, reserve: 10, limit: 15 };
  } finally { await prisma.$disconnect(); }
}

async function supervise(config, deps = {}) {
  const lock = (deps.acquireLock || acquireLock)();
  const owned = new safety.OwnedProcesses();
  const spawnProcess = (...args) => owned.track((deps.spawn || spawn)(...args));
  let stopping = false;
  const shutdown = () => { stopping = true; owned.stopAll(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  try {
    const listener = await (deps.startListener || verifier.startListener)({
      executable: verifier.resolveStripeExecutable(), apiKey: process.env.STRIPE_SECRET_KEY,
      forwardUrl: `http://127.0.0.1:${config.port}/api/webhooks/stripe`, spawnProcess,
    });
    if (stopping) throw new Error('DEV runtime startup interrupted.');
    const api = spawnProcess(process.execPath, [path.join(backend, 'dist/server.js')], { cwd: backend,
      env: { ...process.env, NODE_ENV: 'development', PORT: String(config.port), STRIPE_WEBHOOK_SECRET: listener.secret },
      windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    const worker = spawnProcess(process.execPath, [path.join(backend, 'dist/payment-runner.js')], { cwd: backend,
      env: { ...process.env, NODE_ENV: 'development', STRIPE_WEBHOOK_SECRET: listener.secret },
      windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    lock.record([listener.process.pid, api.pid, worker.pid]);
    let runnerReady = false; let buffer = '';
    worker.stdout.on('data', chunk => { buffer = (buffer + chunk.toString()).slice(-4096); if (buffer.includes('payment.runner.ready')) runnerReady = true; });
    const exited = new Promise((resolve, reject) => {
      for (const child of [listener.process, api, worker]) {
        child.once('error', () => reject(new Error('Owned DEV payment process failed; all owned siblings stopped.')));
        child.once('exit', () => stopping ? resolve() : reject(new Error('Owned DEV payment process exited; all owned siblings stopped.')));
      }
    });
    // Also attach a handler while startup readiness is pending.
    exited.catch(shutdown);
    await Promise.race([exited, (deps.waitForCondition || verifier.waitForCondition)(async () =>
      runnerReady && await (deps.health || verifier.backendHealth)(`http://127.0.0.1:${config.port}`), Boolean, { timeoutMs: 25000, intervalMs: 250 })]);
    if (!stopping) {
      (deps.log || console.log)(JSON.stringify({ readiness: 'PASS', backendPort: config.port, runnerDatabaseReady: true,
        listenerBoundInMemory: true, financialAcceptance: 'NOT_VERIFIED', shutdown: 'Ctrl+C stops only owned processes' }));
      await exited;
    }
  } finally { shutdown(); lock.release(); process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown); }
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const restoreOut = safety.installSanitizedOutput(process.stdout); const restoreError = safety.installSanitizedOutput(process.stderr);
  try {
    const options = argumentsFor(argv);
    const config = await (deps.preflight || preflight)();
    console.log(JSON.stringify({ preflight: 'PASS', ...config, financialAcceptance: 'NOT_VERIFIED' }));
    if (options.start) await (deps.supervise || supervise)(config);
    return 0;
  } catch (error) { console.log(JSON.stringify({ status: 'BLOCKED', error: safety.sanitize(error.message) })); return 1; }
  finally { restoreOut(); restoreError(); }
}
if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { argumentsFor, preflight, supervise, main };
