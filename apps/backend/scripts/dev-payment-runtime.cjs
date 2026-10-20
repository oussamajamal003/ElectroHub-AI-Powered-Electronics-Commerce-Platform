// Explicit foreground DEV supervisor. No migrations, fixtures, or payments are
// submitted by this script. Shared-target mutation requires the supervised IPC
// handshake; never run it automatically from API startup.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn, fork, execFileSync } = require('node:child_process');
const safety = require('./stripe-gate-safety.cjs');
const verifier = require('./stripe-webhook-verifier.cjs');
const emailDev = require('./lib/commerce-email-dev.cjs');
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
  const lockId = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(descriptor, JSON.stringify({ supervisorPid: process.pid, lockId, createdAt: new Date().toISOString() }));
  fs.closeSync(descriptor);
  const readOwned = () => {
    try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return value.supervisorPid === process.pid && value.lockId === lockId; }
    catch { return false; }
  };
  return { record: pids => {
    if (!readOwned()) throw new Error('Supervisor lock ownership changed; lock retained.');
    fs.writeFileSync(file, JSON.stringify({ supervisorPid: process.pid, lockId, ownedPids: pids, createdAt: new Date().toISOString() }));
  }, release: () => {
    if (!readOwned()) return false;
    fs.unlinkSync(file); return true;
  } };
}

function migrationNames(migrationDir = path.join(backend, 'prisma/migrations'), list = fs.readdirSync) {
  return list(migrationDir, { withFileTypes: true }).filter(item => item.isDirectory() &&
    fs.existsSync(path.join(migrationDir, item.name, 'migration.sql'))).map(item => item.name).sort();
}

function migrationChecksumCandidates(name, contents) {
  const text = Buffer.isBuffer(contents) ? contents.toString('utf8') : String(contents);
  const noBom = text.replace(/^\uFEFF/, '');
  const candidates = new Set([text, noBom, noBom.replace(/\r\n/g, '\n')]);
  // These two historical ledger formatting variants are explicitly documented in MIGRATIONS.md.
  if (name === '20240101000000_database_foundation') candidates.add(`\uFEFF${noBom.replace(/\r?\n/g, '\r\n')}`);
  if (name === '20240103000000_email_otp_foundation') candidates.add(noBom.replace(/\r?\n/g, '\r\n'));
  return new Set([...candidates].map(value => crypto.createHash('sha256').update(value, 'utf8').digest('hex')));
}

function verifyMigrationLedger(rows, options = {}) {
  const directory = options.migrationDir || path.join(backend, 'prisma/migrations');
  const names = options.names || migrationNames(directory, options.list || fs.readdirSync);
  const read = options.read || (file => fs.readFileSync(file));
  const byName = new Map();
  for (const row of rows) {
    if (!names.includes(row.migration_name)) throw new Error('Migration ledger contains an unknown migration.');
    const bucket = byName.get(row.migration_name) || [];
    bucket.push(row); byName.set(row.migration_name, bucket);
    if (!row.started_at || !row.finished_at || row.rolled_back_at || row.logs !== null) throw new Error('Migration ledger contains a pending, failed, or rolled-back migration.');
  }
  if (rows.length !== names.length || names.some(name => byName.get(name)?.length !== 1)) {
    throw new Error('Migration ledger does not contain exactly one completed row for every local migration.');
  }
  for (const name of names) {
    const sql = read(path.join(directory, name, 'migration.sql'));
    if (!migrationChecksumCandidates(name, sql).has(byName.get(name)[0].checksum)) {
      throw new Error('Migration ledger checksum does not match the reviewed local migration set.');
    }
  }
  return names.length;
}

function assertNoPaymentBacklog(workCount, unresolvedAttemptCount) {
  if (workCount !== 0 || unresolvedAttemptCount !== 0) {
    throw new Error('Shared DEV recovery backlog or unresolved payment incident exists; runner startup is blocked.');
  }
}

/**
 * Governed MAIN DEV sends approved customers' success emails by default: a non-empty COMMERCE_EMAIL_ALLOWED_RECIPIENTS is the approval,
 * so the email worker starts in allowlist mode (never live/unrestricted). With no allowlist it starts without email and says so.
 */
function applyGovernedEmailDefault(options, environment) {
  if (options.mode !== 'governed' || options.noEmail) return { ...options, emailDefault: options.noEmail ? 'opted-out' : 'not-governed' };
  if (!allowlistedRecipients(environment).length) return { ...options, allowEmailAllowlist: false, emailDefault: 'allowlist-empty' };
  environment.COMMERCE_EMAIL_DISPATCH_ENABLED = 'true';
  environment.COMMERCE_EMAIL_SEND_MODE = 'allowlist';
  environment.COMMERCE_EMAIL_LIVE_APPROVED_TARGET = '';
  return { ...options, allowEmailAllowlist: true, emailDefault: 'allowlist' };
}

/** Same normalization as the email config (comma list, trimmed, lowercased); empty when unset. */
function allowlistedRecipients(environment) {
  return String(environment.COMMERCE_EMAIL_ALLOWED_RECIPIENTS ?? '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
}

function assertNoEmailBacklog(count) {
  if (count !== 0) throw new Error('Sendable commerce email backlog exists; allowlist dispatch is blocked.');
}

function waitForChildExit(child, timeoutMs = 10000) {
  if (child.exitCode !== null || child.signalCode) return Promise.resolve(true);
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); child.removeListener('exit', onExit); resolve(value); };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(child.exitCode !== null || Boolean(child.signalCode)), timeoutMs);
    child.once('exit', onExit);
  });
}

async function readOnlySnapshot(prisma, read) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return read(tx);
  }, { maxWait: 5000, timeout: 30000 });
}

// DEV recovery policies. incident-scoped: the reviewed attempt plus the Task04 fixture attempt (acceptance run).
// exact-attempt: only the explicitly reviewed attempt(s) (one, or at most two), no fixture involvement; for resolving
// individually approved purchases. Governed steady-state recovery of future DEV purchases is a separate owner decision and
// fails closed until that policy is reviewed and authorized.
// governed: normal authorized DEV recovery without per-purchase IDs. The worker may touch only attempts CREATED at/after an explicit
// --governed-since boundary (owner-approved, at most 30 days old); everything older (incl. the isolated incident) is out of scope by
// construction and must be DONE or the one accepted-isolated row before start.
// checkout: normal MAIN DEV Test Mode checkout. Supervised payment-enabled API + signed webhook listener, NO recovery worker
// (no attempt is ever claimed or scanned) and in-process recovery off. Stalled attempts are resolved later only by an exact-attempt run.
const RECOVERY_MODES = new Set(['--recovery-mode=incident-scoped', '--recovery-mode=exact-attempt', '--recovery-mode=checkout', '--recovery-mode=governed']);
const MAX_EXACT_ATTEMPTS = 2;
const GOVERNED_SINCE = /^--governed-since=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)$/;
const MAX_GOVERNED_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
function governedSince(value, now = Date.now()) {
  const since = new Date(value); const at = since.getTime();
  if (!Number.isFinite(at) || at > now || now - at > MAX_GOVERNED_LOOKBACK_MS) throw new Error('--governed-since must be a past ISO instant within 30 days.');
  return since.toISOString();
}
function argumentsFor(argv) {
  const sinceArgs = argv.filter(arg => GOVERNED_SINCE.test(arg));
  if (sinceArgs.length > 1) throw new Error('Pass --governed-since once.');
  argv = argv.filter(arg => !GOVERNED_SINCE.test(arg));
  const noEmail = argv.includes('--no-email');
  argv = argv.filter(arg => arg !== '--no-email');
  const modes = argv.filter(arg => RECOVERY_MODES.has(arg));
  if (modes.length > 1) throw new Error('Choose one recovery mode.');
  const mode = modes[0] === '--recovery-mode=exact-attempt' ? 'exact-attempt' : modes[0] === '--recovery-mode=checkout' ? 'checkout'
    : modes[0] === '--recovery-mode=governed' ? 'governed' : 'incident-scoped';
  if ((mode === 'governed') !== Boolean(sinceArgs.length)) throw new Error('--recovery-mode=governed requires exactly one --governed-since=<ISO>, and only that mode accepts it.');
  argv = argv.filter(arg => !RECOVERY_MODES.has(arg));
  const reviewed = argv.filter(arg => /^--reviewed-recovery-attempt=[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(arg));
  const accepted = argv.filter(arg => /^--accepted-backlog-attempt=[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(arg));
  if (accepted.length > 1) throw new Error('At most one owner-accepted backlog attempt may be isolated.');
  if (reviewed.length > (mode === 'exact-attempt' ? MAX_EXACT_ATTEMPTS : mode === 'checkout' || mode === 'governed' ? 0 : 1) || argv.some(arg => !['--preflight', '--start', '--allow-dev-recovery', '--allow-dev-checkout', '--allow-email-allowlist'].includes(arg) && !reviewed.includes(arg) && !accepted.includes(arg)) || new Set(argv).size !== argv.length ||
    argv.includes('--start') && argv.includes('--preflight')) throw new Error('Use --preflight or --start --allow-dev-recovery.');
  const start = argv.includes('--start');
  if (mode === 'checkout') {
    // Checkout mode never recovers anything, so it takes its own explicit opt-in and refuses the recovery flag.
    if (argv.includes('--allow-dev-recovery')) throw new Error('Checkout mode starts no recovery; do not pass --allow-dev-recovery.');
    if (start && !argv.includes('--allow-dev-checkout')) throw new Error('Starting DEV checkout requires explicit --allow-dev-checkout.');
  } else {
    if (argv.includes('--allow-dev-checkout')) throw new Error('--allow-dev-checkout is only valid with --recovery-mode=checkout.');
    if (start && !argv.includes('--allow-dev-recovery')) throw new Error('Starting a DEV runner requires explicit --allow-dev-recovery.');
    if (start && !reviewed.length && mode !== 'governed') throw new Error('Starting supervised DEV requires an exact reviewed recovery attempt.');
  }
  const reviewedIds = reviewed.map(arg => arg.split('=')[1].toLowerCase());
  if (noEmail && argv.includes('--allow-email-allowlist')) throw new Error('Choose --allow-email-allowlist or --no-email, not both.');
  return { start, mode, allowEmailAllowlist: argv.includes('--allow-email-allowlist'), ...(noEmail ? { noEmail: true } : {}),
    ...(sinceArgs.length ? { governedSince: governedSince(GOVERNED_SINCE.exec(sinceArgs[0])[1]) } : {}),
    ...(reviewed.length ? { reviewedRecoveryAttempt: reviewedIds[0], reviewedRecoveryAttempts: reviewedIds } : {}),
    ...(accepted.length ? { acceptedBacklogAttempt: accepted[0].split('=')[1].toLowerCase() } : {}) };
}

/**
 * Owner-accepted isolation (2026-10-20) of exactly one out-of-scope incident attempt. It is excluded only from the startup
 * backlog COUNT, and only while it still matches the frozen incident facts: DECLINED / PAYMENT_DECLINED, provider
 * requires_payment_method, submitted, no order, not cancel-requested, unfinished work, no signed event. Any drift fails
 * closed. The row is never modified and never joins the worker scope (normalizeWorkerAttemptIds holds only reviewed+fixture).
 */
function assertAcceptedBacklog(attempt, id, signedEvents, workerAttemptIds) {
  if (!attempt || attempt.id !== id || workerAttemptIds.includes(id) || attempt.state !== 'DECLINED' ||
    attempt.failureCode !== 'PAYMENT_DECLINED' || attempt.providerStatus !== 'requires_payment_method' || !attempt.submittedAt ||
    attempt.orderId || attempt.cancelRequested || !attempt.work || attempt.work.state === 'DONE' || signedEvents !== 0) {
    throw new Error('Accepted backlog attempt no longer matches its isolated incident record; inspect it before startup.');
  }
}

function readTask04Fixture(deps = {}) {
  let fixture;
  try {
    fixture = deps.task04Fixture || JSON.parse(fs.readFileSync(path.join(backend, '.cache/task04-acceptance/fixture.json'), 'utf8'));
  } catch { throw new Error('Task04 synthetic fixture ownership is unavailable; no worker was started.'); }
  if (!fixture || typeof fixture.userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(fixture.userId) ||
    typeof fixture.email !== 'string' || !/^task04-[a-f0-9-]+@electrohub\.invalid$/.test(fixture.email)) {
    throw new Error('Task04 synthetic fixture ownership is invalid; no worker was started.');
  }
  return { userId: fixture.userId, email: fixture.email };
}

function assertTask04FixtureAttempt(attempt, userId) {
  if (!attempt || attempt.userId !== userId || typeof attempt.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(attempt.id) ||
    attempt.state !== 'AWAITING_INPUT' || attempt.orderId || !attempt.providerIntentId || attempt.submittedAt || attempt.work?.state !== 'READY') {
    throw new Error('Task04 synthetic attempt is not uniquely owned by the local fixture; inspect it before startup.');
  }
}

function normalizeWorkerAttemptIds(value, mode = 'incident-scoped') {
  const sizeOk = Array.isArray(value) && (mode === 'exact-attempt' ? value.length >= 1 && value.length <= MAX_EXACT_ATTEMPTS : value.length === 2);
  if (!sizeOk || value.some(id => typeof id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) || new Set(value).size !== value.length) {
    throw new Error('Supervised DEV requires exactly two distinct canonical attempt IDs.');
  }
  return Object.freeze([...value]);
}

// Explicit operator approval may cover one reviewed card-entry attempt; never widen it to unrelated backlog.
function assertReviewedRecovery(attempt, id) {
  if (!attempt || attempt.id !== id || attempt.state !== 'AWAITING_INPUT' || attempt.orderId ||
    !attempt.providerIntentId || attempt.work?.state !== 'READY') throw new Error('Reviewed recovery attempt changed; inspect it again before startup.');
}

async function preflight(deps = {}, options = {}) {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Production/insecure TLS forbidden.');
  process.chdir(backend); process.env.NODE_ENV = 'development';
  const existing = (deps.inspectProcesses || existingPaymentProcesses)();
  if (existing.length) {
    const kinds = [...new Set(existing.map(child => child.kind))].join('/');
    throw new Error(`Existing ${kinds} process detected, including dormant watchers. Confirm ownership and stop it yourself; no process was terminated.`);
  }
  const env = deps.env || require('../dist/config/env.js').env;
  const runtimeUrlSource = env.DB_RUNTIME_URL_SOURCE || 'database';
  const resolved = (deps.resolveTargets || require('../dist/lib/database-target.js').resolveDatabaseTargets)({
    ...process.env, ...env, NODE_ENV: 'development', DB_RUNTIME_URL_SOURCE: runtimeUrlSource,
  });
  if (resolved.runtime.category !== 'dev' || resolved.migration.category !== 'dev' ||
    resolved.runtime.identity !== 'supabase:pzxekjybdiulzmssalfo/postgres' || resolved.migration.identity !== resolved.runtime.identity) {
    throw new Error('Exact shared DEV database identity required.');
  }
  if (!/^(?:sk|rk)_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY || '')) throw new Error('Stripe Test Mode credentials required.');
  if (!env.DB_SSL_CA_CERT_PATH || !(deps.exists || fs.existsSync)(env.DB_SSL_CA_CERT_PATH)) throw new Error('Verified TLS CA is required.');
  await (deps.assertPortAvailable || (async port => {
    // Windows may allow an IPv4 probe beside an existing dual-stack listener. Inspect both families too.
    if (process.platform === 'win32' && verifier.findProcessOnPort(port).length) {
      throw new Error('DEV backend port has an existing owner; no process was replaced.');
    }
    await safety.assertPortAvailable(port);
  }))(env.PORT);
  const { prisma } = deps.prisma ? { prisma: deps.prisma } : require('../dist/lib/prisma.js');
  try {
    const snapshot = await readOnlySnapshot(prisma, async tx => {
      const at = Date.now(); await tx.$queryRaw`SELECT 1`;
      const databaseMs = Date.now() - at;
      const rows = await tx.$queryRaw`SELECT count(*)::int AS others FROM pg_stat_activity WHERE usename=current_user AND datname=current_database() AND pid<>pg_backend_pid() AND backend_type = 'client backend'`;
      // Only client connections consume pooler capacity; background workers (e.g. pg_net) are not sessions this runtime competes with.
      const reserve = options.allowEmailAllowlist ? 15 : 10;
      if (rows[0].others + reserve > 15) throw new Error('Existing sessions plus API/runner/email reserve exceed conservative DEV limit 15.');
      const migrations = await tx.$queryRaw`SELECT migration_name,checksum,started_at,finished_at,rolled_back_at,logs FROM "_prisma_migrations"`;
      const migrationCount = verifyMigrationLedger(migrations);
      const [unfinishedWork, historicalIncidents] = await Promise.all([
        tx.paymentWork.count({ where: { state: { not: 'DONE' } } }),
        tx.paymentAttempt.count({ where: { state: 'INCIDENT', work: { is: { state: 'DONE' } } } }),
      ]);
      let reviewedAttempt = null;
      const reviewedAttempts = [];
      for (const id of options.reviewedRecoveryAttempts ?? (options.reviewedRecoveryAttempt ? [options.reviewedRecoveryAttempt] : [])) {
        const attempt = await tx.paymentAttempt.findUnique({ where: { id }, include: { work: true } });
        assertReviewedRecovery(attempt, id);
        reviewedAttempts.push(attempt);
      }
      reviewedAttempt = reviewedAttempts[0] ?? null;
      const exact = options.mode === 'exact-attempt';
      const checkout = options.mode === 'checkout';
      const governed = options.mode === 'governed';
      if (governed && !options.governedSince) throw new Error('Governed DEV recovery requires --governed-since.');
      let taskFixtureAttempt = null;
      // Preflight with a reviewed attempt evaluates the exact scope --start would use (same gates, read-only).
      // exact-attempt mode never involves the Task04 fixture.
      if (!exact && !checkout && !governed && (options.start || options.reviewedRecoveryAttempt)) {
        if (!reviewedAttempt) throw new Error('Starting supervised DEV requires one reviewed recovery attempt.');
        const fixture = readTask04Fixture(deps);
        const owner = await tx.user.findFirst({ where: { id: fixture.userId, email: fixture.email, role: { name: 'CUSTOMER' } }, select: { id: true } });
        if (!owner) throw new Error('Task04 synthetic fixture owner changed; inspect it before startup.');
        const fixtureAttempts = await tx.paymentAttempt.findMany({ where: { userId: fixture.userId }, include: { work: true } });
        if (fixtureAttempts.length !== 1) throw new Error('Task04 fixture must have exactly one attempt before scoped startup.');
        taskFixtureAttempt = fixtureAttempts[0];
        assertTask04FixtureAttempt(taskFixtureAttempt, fixture.userId);
      }
      const workerAttemptIds = exact ? (reviewedAttempts.length ? normalizeWorkerAttemptIds(reviewedAttempts.map(attempt => attempt.id), 'exact-attempt') : [])
        : taskFixtureAttempt ? normalizeWorkerAttemptIds([reviewedAttempt.id, taskFixtureAttempt.id]) : [];
      // Governed: open work for attempts created at/after the boundary is the worker's to resolve; only older work counts as backlog.
      const governedScopedWork = governed ? await tx.paymentWork.count({ where: { state: { not: 'DONE' },
        attempt: { createdAt: { gte: new Date(options.governedSince) } } } }) : 0;
      const scopedWorkCount = governedScopedWork + [...reviewedAttempts, taskFixtureAttempt]
        .filter(attempt => attempt?.work && attempt.work.state !== 'DONE').length;
      const unresolvedAttempts = await tx.paymentAttempt.count({ where: {
        state: { in: ['PREPARING', 'AWAITING_INPUT', 'ACTION_REQUIRED', 'PROCESSING', 'AUTHORIZED',
          'CAPTURE_PENDING', 'CANCEL_PENDING', 'COMPENSATION_PENDING', 'REFUND_PENDING', 'INCIDENT'] }, work: null,
        ...(workerAttemptIds.length ? { id: { notIn: workerAttemptIds } } : {}),
        ...(governed ? { createdAt: { lt: new Date(options.governedSince) } } : {}),
      } });
      let acceptedBacklogCount = 0;
      if (options.acceptedBacklogAttempt) {
        const accepted = await tx.paymentAttempt.findUnique({ where: { id: options.acceptedBacklogAttempt }, include: { work: true } });
        const signedEvents = accepted ? await tx.stripeEvent.count({ where: { attemptId: accepted.id } }) : -1;
        assertAcceptedBacklog(accepted, options.acceptedBacklogAttempt, signedEvents, [reviewedAttempt?.id, taskFixtureAttempt?.id].filter(Boolean));
        acceptedBacklogCount = 1;
      }
      assertNoPaymentBacklog(unfinishedWork - scopedWorkCount - acceptedBacklogCount, unresolvedAttempts);
      let emailBacklog = 0;
      if (options.allowEmailAllowlist) {
        const emailRuntime = (deps.describeEmail || emailDev.describeEmailRuntime)(process.env);
        if (!emailRuntime.dispatchEnabled || emailRuntime.sendMode !== 'allowlist' || !emailRuntime.allowlistSize) {
          throw new Error('Email opt-in requires enabled allowlist mode and at least one configured recipient.');
        }
        // Allowlist mode can only ever claim allowlisted recipients' rows, so only THEIR old sendable rows would be (re)sent at start.
        // Those must be zero; other recipients' queued history is untouchable by this worker and is preserved, not counted.
        emailBacklog = await tx.commerceEmailOutbox.count({ where: { dispatchState: { in: ['READY', 'LEASED', 'RETRY_WAIT'] },
          recipient: { in: allowlistedRecipients(process.env) } } });
        assertNoEmailBacklog(emailBacklog);
      }
      return { databaseMs, otherSessions: rows[0].others, migrationCount, unfinishedWork, unresolvedAttempts, historicalIncidents,
        emailBacklog, reviewedAttempts, taskFixtureAttempt, workerAttemptIds, governedScopedWork };
    });
    const stripeAccount = deps.stripeAccount ? await deps.stripeAccount() : await require('../dist/services/stripe.provider.js').stripeProvider.account();
    safety.assertCanonicalStripeAccount(stripeAccount);
    const { reviewedAttempts, taskFixtureAttempt, workerAttemptIds, governedScopedWork, ...safeSnapshot } = snapshot;
    // Each reviewed attempt must still be an unpaid Test Mode card-entry intent bound to it: nothing received or capturable.
    for (const reviewedAttempt of reviewedAttempts) {
      const intent = await (deps.retrieveIntent || (id => require('../dist/services/stripe.provider.js').stripeProvider.retrieve(id)))(reviewedAttempt.providerIntentId);
      (deps.verifyBinding || require('../dist/services/payment.domain.js').verifyBinding)(reviewedAttempt, intent);
      if (intent.livemode !== false || intent.status !== 'requires_payment_method' || intent.received !== 0 || (intent.capturable ?? 0) !== 0) {
        throw new Error('Reviewed recovery provider state changed; inspect it again before startup.');
      }
    }
    if (taskFixtureAttempt) {
      const intent = await (deps.retrieveIntent || (id => require('../dist/services/stripe.provider.js').stripeProvider.retrieve(id)))(taskFixtureAttempt.providerIntentId);
      (deps.verifyBinding || require('../dist/services/payment.domain.js').verifyBinding)(taskFixtureAttempt, intent);
      if (intent.livemode !== false || intent.status !== 'requires_payment_method' || intent.received !== 0) {
        throw new Error('Task04 synthetic provider state changed; inspect it before startup.');
      }
    }
    return { port: env.PORT, ...safeSnapshot, recoveryMode: options.mode ?? 'incident-scoped', reviewedRecoveryCount: reviewedAttempts.length, reserve: options.allowEmailAllowlist ? 15 : 10, limit: 15,
      targetIdentity: resolved.runtime.identity, paymentBacklog: { unfinishedWork: snapshot.unfinishedWork,
        unresolvedAttempts: snapshot.unresolvedAttempts, historicalIncidentAttempts: snapshot.historicalIncidents },
      stripeAccountVerified: true, runtimeUrlSource,
      emailAllowlist: options.allowEmailAllowlist ? { enabled: true, pendingBacklog: snapshot.emailBacklog } : { enabled: false },
      ...(options.mode === 'governed' ? { governedSince: options.governedSince, governedOpenWork: governedScopedWork } : {}),
      ...(options.start ? { workerAttemptIds, ...(options.mode === 'governed' ? { workerScope: { createdSince: options.governedSince } } : {}) } : {}) };
  } finally { await prisma.$disconnect?.(); }
}

async function supervise(config, options = {}, deps = {}) {
  if (typeof options.acquireLock === 'function' || typeof options.fork === 'function') { deps = options; options = {}; }
  const checkoutMode = options.mode === 'checkout';
  if (checkoutMode && (options.start !== true || (config.workerAttemptIds ?? []).length || options.reviewedRecoveryAttempt)) {
    throw new Error('Checkout mode starts no recovery worker and accepts no attempt scope.');
  }
  const governedMode = options.mode === 'governed';
  if (governedMode && (options.start !== true || options.reviewedRecoveryAttempt || (config.workerAttemptIds ?? []).length ||
    config.workerScope?.createdSince !== options.governedSince || !options.governedSince)) {
    throw new Error('Governed scope must match the exact --governed-since from DEV preflight and carry no attempt IDs.');
  }
  const workerAttemptIds = checkoutMode || governedMode ? [] : normalizeWorkerAttemptIds(config.workerAttemptIds, options.mode);
  const exactMatches = options.mode !== 'exact-attempt' || (Array.isArray(options.reviewedRecoveryAttempts) &&
    options.reviewedRecoveryAttempts.length === workerAttemptIds.length && options.reviewedRecoveryAttempts.every((id, index) => workerAttemptIds[index] === id));
  if (!checkoutMode && !governedMode && (options.start !== true || options.reviewedRecoveryAttempt !== workerAttemptIds[0] || !exactMatches)) {
    throw new Error('Supervisor scope must match the exact reviewed attempt from DEV preflight.');
  }
  const lock = (deps.acquireLock || acquireLock)();
  const records = new Set(); const forkProcess = deps.fork || fork; const spawnProcess = deps.spawn || spawn;
  let stopping = false; let shutdownPromise = null; let primaryFailure = null; let resolveShutdownFinished;
  const shutdownFinished = new Promise(resolve => { resolveShutdownFinished = resolve; });
  let email = { started: false, reason: 'disabled-by-default', runtime: null, stop: async () => {} };
  const track = (child, role, ipc = false) => {
    if (!child || !Number.isInteger(child.pid) || child.pid < 1) throw new Error('Owned process identity unavailable.');
    const record = { child, role, ipc, exited: child.exitCode !== null || Boolean(child.signalCode) };
    records.add(record); child.once('exit', () => { record.exited = true; });
    lock.record([...records].map(item => item.child.pid));
    return record;
  };
  const startShutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    stopping = true;
    shutdownPromise = (async () => {
      for (const record of records) {
        const child = record.child;
        if (record.ipc && child.connected) {
          try { child.send({ type: 'payment-supervisor.revoke', nonce: record.nonce }, () => { try { child.disconnect(); } catch { /* channel already closed */ } }); }
          catch { try { child.disconnect(); } catch { /* channel already closed */ } }
        }
        // IPC disconnect invokes the child's existing graceful shutdown. On Windows kill(SIGTERM)
        // terminates immediately, so allow that shutdown to drain leases before the bounded fallback.
        if (!record.ipc && !record.exited) { try { child.kill('SIGTERM'); } catch { /* checked below */ } }
      }
      try { await email.stop(); } catch { /* the helper reports its own failure */ }
      const clean = await Promise.all([...records].map(record => waitForChildExit(record.child, deps.shutdownGraceMs ?? 10000)));
      if (clean.some(value => !value)) {
        for (const record of records) if (!record.exited && record.child.exitCode === null) { try { record.child.kill('SIGKILL'); } catch { /* lock retained below */ } }
        const forced = await Promise.all([...records].map(record => waitForChildExit(record.child, deps.forcedShutdownWaitMs ?? 2000)));
        if (forced.some(value => !value)) primaryFailure ||= new Error('Owned process did not stop; supervisor lock retained.');
      }
      return [...records].every(record => record.exited || record.child.exitCode !== null || Boolean(record.child.signalCode));
    })();
    shutdownPromise.finally(resolveShutdownFinished);
    return shutdownPromise;
  };
  const signalHandler = () => { void startShutdown(); };
  process.once('SIGINT', signalHandler); process.once('SIGTERM', signalHandler);
  let failRuntime;
  const failed = new Promise((_, reject) => { failRuntime = reject; });
  failed.catch(() => {});
  const unexpectedExit = record => {
    if (stopping) return;
    primaryFailure ||= new Error(`Owned ${record.role} process exited unexpectedly; sibling shutdown started.`);
    failRuntime(primaryFailure);
    void startShutdown();
  };
  try {
    const listener = await (deps.startListener || verifier.startListener)({
      executable: verifier.resolveStripeExecutable(), apiKey: process.env.STRIPE_SECRET_KEY,
      forwardUrl: `http://127.0.0.1:${config.port}/api/webhooks/stripe`, spawnProcess: (...args) => {
        const child = spawnProcess(...args); track(child, 'stripe-cli'); return child;
      },
    });
    if (stopping) throw new Error('DEV runtime startup interrupted.');
    const listenerRecord = [...records].find(record => record.child === listener.process) || track(listener.process, 'stripe-cli');
    listenerRecord.child.on('error', () => unexpectedExit(listenerRecord));
    listenerRecord.child.once('exit', () => unexpectedExit(listenerRecord));
    const nonce = crypto.randomBytes(32).toString('hex');
    const diagnosticToken = crypto.randomBytes(32).toString('hex');
    (deps.writeDiagnosticToken || (token => {
      fs.mkdirSync(path.join(backend, '.cache'), { recursive: true });
      fs.writeFileSync(path.join(backend, '.cache/dev-runtime-token.txt'), token, { mode: 0o600 });
    }))(diagnosticToken);
    const inheritedEnv = { ...process.env };
    delete inheritedEnv.PAYMENT_DEV_ATTEMPT_IDS;
    delete inheritedEnv.PAYMENT_DEV_SUPERVISED;
    delete inheritedEnv.PAYMENT_INPROCESS_RECOVERY;
    const childEnv = { ...inheritedEnv, NODE_ENV: 'development', PAYMENT_DEV_SUPERVISED: '1', PAYMENT_INPROCESS_RECOVERY: 'false',
      DB_RUNTIME_URL_SOURCE: config.runtimeUrlSource, STRIPE_WEBHOOK_SECRET: listener.secret,
      ELECTROHUB_DEV_DIAGNOSTIC_TOKEN: diagnosticToken,
      COMMERCE_EMAIL_DISPATCH_ENABLED: options.allowEmailAllowlist ? process.env.COMMERCE_EMAIL_DISPATCH_ENABLED : 'false',
      COMMERCE_EMAIL_SEND_MODE: options.allowEmailAllowlist ? 'allowlist' : 'disabled', PAYMENT_SHARED_MUTATIONS_APPROVED: '' };
    const spawnRuntime = (role, args) => {
      const child = forkProcess(path.join(backend, 'dist/bootstrap.js'), args, { cwd: backend,
        env: { ...childEnv, ...(role === 'api' ? { PORT: String(config.port) } : {}) },
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'json' });
      const record = track(child, role, true); record.nonce = nonce;
      child.on('error', () => unexpectedExit(record)); child.once('exit', () => unexpectedExit(record));
      return record;
    };
    const api = spawnRuntime('api', []); const worker = checkoutMode ? null : spawnRuntime('worker', ['--payment-worker']);
    const status = { prepared: new Set(), activated: new Set(), apiReady: false, workerDatabaseReady: false, workerReady: false, degraded: false };
    const watch = record => {
      const child = record.child;
      child.on('message', message => {
        if (!message || message.role !== record.role) return;
        if (message.event === 'payment.supervisor.awaiting') {
          child.send({ type: 'payment-supervisor.prepare', identity: config.targetIdentity, nonce, parentPid: process.pid,
            ...(record.role === 'worker' ? governedMode ? { createdSince: options.governedSince } : { attemptIds: workerAttemptIds } : {}) });
        } else if (message.event === 'payment.supervisor.prepared' && message.nonce === nonce) status.prepared.add(record.role);
        else if (message.event === 'payment.supervisor.worker-ready' && message.role === 'worker' && message.nonce === nonce) status.workerDatabaseReady = true;
        else if (message.event === 'payment.supervisor.api-ready' && message.role === 'api' && message.nonce === nonce) status.apiReady = true;
        else if (message.event === 'payment.supervisor.runner-ready' && message.role === 'worker' && message.nonce === nonce) status.workerReady = true;
        else if (message.event === 'payment.supervisor.activated' && message.nonce === nonce) status.activated.add(record.role);
        else if (message.event === 'payment.supervisor.degraded' && message.nonce === nonce) {
          status.degraded = true; primaryFailure ||= new Error(`Owned ${record.role} runtime reported degraded readiness.`);
          failRuntime(primaryFailure); void startShutdown();
        }
      });
      child.stdout?.on('data', () => {});
      child.stderr?.on('data', () => {});
    };
    watch(api); if (worker) watch(worker);
    const log = deps.emailLog || console.log;
    const emailEnv = { ...inheritedEnv, NODE_ENV: 'development', COMMERCE_EMAIL_DISPATCH_ENABLED: 'false', COMMERCE_EMAIL_SEND_MODE: 'disabled' };
    if (options.allowEmailAllowlist) {
      emailEnv.COMMERCE_EMAIL_DISPATCH_ENABLED = process.env.COMMERCE_EMAIL_DISPATCH_ENABLED;
      emailEnv.COMMERCE_EMAIL_SEND_MODE = process.env.COMMERCE_EMAIL_SEND_MODE;
      const report = (deps.describeEmail || emailDev.describeEmailRuntime)(emailEnv);
      const runner = path.join(backend, 'dist/commerce-email-runner.js');
      if (report.sendMode !== 'allowlist' || !report.workerWillRun || !(deps.exists || fs.existsSync)(runner)) throw new Error('Approved allowlist email worker is not ready to start.');
      email = (deps.startEmailWorker || emailDev.startEmailWorker)({ backend, entry: { command: process.execPath, args: [runner] }, env: emailEnv, log });
    }
    const waitFor = deps.waitForCondition || verifier.waitForCondition;
    await Promise.race([waitFor(() => status.prepared.size === (worker ? 2 : 1), Boolean, { timeoutMs: 7000, intervalMs: 50 }), failed]);
    await Promise.race([waitFor(async () => (!worker || status.workerDatabaseReady) && status.apiReady &&
      await (deps.health || verifier.backendHealth)(`http://127.0.0.1:${config.port}`), Boolean, { timeoutMs: 25000, intervalMs: 100 }), failed]);
    if (worker) {
      worker.child.send({ type: 'payment-supervisor.activate', nonce });
      await Promise.race([waitFor(() => status.activated.has('worker'), Boolean, { timeoutMs: 5000, intervalMs: 50 }), failed]);
      await Promise.race([waitFor(() => status.workerReady, Boolean, { timeoutMs: 10000, intervalMs: 100 }), failed]);
    }
    api.child.send({ type: 'payment-supervisor.activate', nonce });
    await Promise.race([waitFor(() => status.activated.has('api'), Boolean, { timeoutMs: 5000, intervalMs: 50 }), failed]);
    if (primaryFailure || stopping) throw primaryFailure || new Error('DEV runtime startup interrupted.');
    (deps.log || console.log)(JSON.stringify({ readiness: 'PASS', backendPort: config.port, targetIdentity: config.targetIdentity,
      migrationCount: config.migrationCount, paymentBacklog: config.paymentBacklog, stripeAccountVerified: config.stripeAccountVerified,
      listenerBoundInMemory: true, apiDatabaseReady: status.apiReady, recoveryMode: options.mode ?? 'incident-scoped',
      ...(worker ? { workerDatabaseReady: status.workerDatabaseReady, workerReady: status.workerReady } : { recoveryWorker: 'not-started' }),
      supervisorIPC: 'prepared-and-activated', financialAcceptance: 'NOT_VERIFIED', shutdown: 'Ctrl+C stops only owned processes',
      emailAllowlist: { enabled: Boolean(options.allowEmailAllowlist), workerStarted: Boolean(email.started), sendMode: options.allowEmailAllowlist ? 'allowlist' : 'disabled',
        ...(options.emailDefault ? { reason: options.emailDefault } : {}) } }));
    const lifetime = new Promise((resolve, reject) => {
      for (const record of records) record.child.once('exit', () => {
        if (!stopping) { unexpectedExit(record); reject(primaryFailure); }
        else if ([...records].every(item => item.exited || item.child.exitCode !== null || Boolean(item.child.signalCode))) resolve();
      });
      if ([...records].every(item => item.exited || item.child.exitCode !== null || Boolean(item.child.signalCode))) resolve();
      if (primaryFailure) reject(primaryFailure);
    });
    await Promise.race([lifetime, shutdownFinished]);
    if (primaryFailure) throw primaryFailure;
  } catch (error) {
    primaryFailure ||= error;
    throw primaryFailure;
  } finally {
    await startShutdown();
    const stopped = [...records].every(record => record.exited || record.child.exitCode !== null || Boolean(record.child.signalCode));
    if (stopped) lock.release();
    process.removeListener('SIGINT', signalHandler); process.removeListener('SIGTERM', signalHandler);
  }
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const restoreOut = safety.installSanitizedOutput(process.stdout); const restoreError = safety.installSanitizedOutput(process.stderr);
  try {
    const options = applyGovernedEmailDefault(argumentsFor(argv), process.env);
    const config = deps.preflight ? await deps.preflight(options) : await preflight({}, options);
    const publicConfig = { ...config };
    delete publicConfig.workerAttemptIds;
    console.log(JSON.stringify({ preflight: 'PASS', ...publicConfig, financialAcceptance: 'NOT_VERIFIED' }));
    if (options.start) await (deps.supervise || supervise)(config, options, deps.supervisorDeps || {});
    return 0;
  } catch (error) { console.log(JSON.stringify({ status: 'BLOCKED', error: safety.sanitize(error.message) })); return 1; }
  finally { restoreOut(); restoreError(); }
}
if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { argumentsFor, applyGovernedEmailDefault, assertAcceptedBacklog, allowlistedRecipients, migrationNames, migrationChecksumCandidates, verifyMigrationLedger, assertNoPaymentBacklog, assertNoEmailBacklog,
  assertReviewedRecovery, readTask04Fixture, assertTask04FixtureAttempt, normalizeWorkerAttemptIds, waitForChildExit, preflight, supervise, main };
