// Safe, evidence-based Stripe CLI webhook verifier (Task 03.6).
// This verifies signed webhook ingestion and persistence only. A generic
// `stripe trigger` event is not evidence of a customer-owned purchase.
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const backendDir = path.resolve(__dirname, '..');
function resolveStripeExecutable({ configuredPath = process.env.STRIPE_CLI_PATH, platform = process.platform,
  appData = process.env.APPDATA, exists = fs.existsSync } = {}) {
  if (configuredPath) return configuredPath;
  if (platform === 'win32' && appData) {
    const npmInstalled = path.join(appData, 'npm', 'node_modules', '@stripe', 'cli', 'node_modules',
      '@stripe', 'cli-win32-x64', 'bin', 'stripe.exe');
    if (exists(npmInstalled)) return npmInstalled;
  }
  return 'stripe';
}
const stripeExe = resolveStripeExecutable();
const expectedTypes = new Set([
  'payment_intent.amount_capturable_updated', 'payment_intent.succeeded',
  'payment_intent.payment_failed', 'payment_intent.processing',
  'payment_intent.canceled', 'refund.created', 'refund.updated',
  'refund.failed', 'charge.refunded',
]);

function safeLog(message) {
  console.log(String(message).replace(/(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+/g, '[REDACTED]'));
}

function normalizePath(value) {
  return path.resolve(value).replace(/\\/g, '/').toLowerCase();
}

function isExpectedBackend(commandLine, entrypoint) {
  const normalizedCommand = typeof commandLine === 'string' ? commandLine.replace(/\\/g, '/').toLowerCase() : '';
  return normalizedCommand.includes(normalizePath(entrypoint));
}

async function waitForCondition(read, predicate, { timeoutMs = 20000, intervalMs = 250, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const deadline = now() + timeoutMs;
  let lastValue;
  while (now() <= deadline) {
    lastValue = await read();
    if (predicate(lastValue)) return lastValue;
    if (now() >= deadline) break;
    await pause(Math.min(intervalMs, deadline - now()));
  }
  throw new Error('Timed out waiting for the required condition.');
}

async function waitForPersistedEvent(eventId, expectedType, database, options) {
  if (!/^evt_[A-Za-z0-9]+$/.test(eventId)) throw new Error('Invalid Stripe event identity.');
  const event = await waitForCondition(
    () => database.stripeEvent.findUnique({ where: { id: eventId } }),
    row => row !== null,
    options,
  );
  if (event.type !== expectedType) throw new Error('Persisted Stripe event type did not match the delivered event.');
  if (event.attemptId) {
    const work = await waitForCondition(
      () => database.paymentWork.findUnique({ where: { attemptId: event.attemptId } }),
      row => row !== null,
      options,
    );
    return { event, work, bound: true };
  }
  if (event.disposition !== 'IGNORED') throw new Error('Unbound Stripe event has an unexpected disposition.');
  return { event, work: null, bound: false };
}

async function verifyDuplicateDelivery({ replay, countEvents, eventId, readWork, attemptId, priorWork }) {
  const before = await countEvents(eventId);
  const response = await replay();
  const after = await countEvents(eventId);
  if (response.status !== 200 || before !== 1 || after !== 1) throw new Error('Signed duplicate delivery did not preserve one persisted StripeEvent.');
  if (attemptId) {
    const current = await readWork(attemptId);
    if (!priorWork || !current || current.state !== priorWork.state || current.updatedAt.getTime() !== priorWork.updatedAt.getTime() ||
      current.retryCount !== priorWork.retryCount || current.leaseToken !== priorWork.leaseToken) {
      throw new Error('Duplicate delivery changed durable work state.');
    }
  }
  return true;
}

function runPowerShellJson(script) {
  const result = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true });
  const value = result.trim();
  return value ? JSON.parse(value) : null;
}

function findProcessOnPort(port) {
  const safePort = Number(port);
  if (!Number.isInteger(safePort) || safePort < 1 || safePort > 65535) throw new Error('Invalid backend port.');
  const script = `$rows = @(Get-NetTCPConnection -State Listen -LocalPort ${safePort} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); ConvertTo-Json -InputObject $rows -Compress`;
  const value = runPowerShellJson(script);
  const pids = Array.isArray(value) ? value : value === null ? [] : [value];
  return [...new Set(pids.map(Number).filter(pid => Number.isInteger(pid) && pid > 0))];
}

function getProcessCommandLine(pid) {
  if (!Number.isInteger(pid) || pid < 1) return null;
  const script = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($null -eq $p) { 'null' } else { ConvertTo-Json -InputObject $p.CommandLine -Compress }`;
  return runPowerShellJson(script);
}

async function backendHealth(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.data?.status === 'healthy' && body?.data?.service === 'electrohub-backend';
  } catch {
    return false;
  }
}

async function ensureBackend({ port, signingSecret, spawnProcess = spawn, findOwner = findProcessOnPort, processCommandLine = getProcessCommandLine, health = backendHealth, entrypoint = path.join(backendDir, 'dist', 'server.js') }) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const discovered = await findOwner(port);
  const ownerPids = Array.isArray(discovered) ? discovered : discovered === null ? [] : [discovered];
  if (ownerPids.length > 0) {
    for (const ownerPid of ownerPids) {
      const commandLine = await processCommandLine(ownerPid);
      if (!isExpectedBackend(commandLine, entrypoint)) {
        throw new Error(`Port ${port} is occupied by an unknown or unhealthy process. Stop the verifier; no process was terminated.`);
      }
    }
    throw new Error(`Port ${port} already has a backend; its signing secret cannot be bound to the new listener. No existing process was terminated.`);
  }

  const child = spawnProcess(process.execPath, [entrypoint], {
    cwd: backendDir,
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), STRIPE_WEBHOOK_SECRET: signingSecret },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.resume();
  child.stderr?.resume();
  let exitError;
  child.once('exit', code => { exitError = new Error(`Verifier-owned backend exited with code ${code}.`); });
  try {
    await waitForCondition(async () => {
      if (exitError) throw exitError;
      return health(baseUrl);
    }, isHealthy => isHealthy, { timeoutMs: 20000, intervalMs: 250 });
  } catch (error) {
    child.kill();
    throw error;
  }
  return { process: child, owned: true, baseUrl };
}

function startListener({ executable = stripeExe, apiKey, forwardUrl, onEventId = () => {}, onReceipt = () => {}, spawnProcess = spawn, readinessTimeoutMs = 25000 }) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(executable, [
      'listen', '--forward-to', forwardUrl, '--events', [...expectedTypes].join(','), '--skip-update',
    ], { env: { ...process.env, STRIPE_API_KEY: apiKey }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let resolved = false;
    let buffer = '';
    const partial = { stdout: '', stderr: '' };
    let sequence = 0;
    const observedTypes = new Map();
    const observe = line => {
      const clean = line.replace(/\x1b\[[0-9;]*m/g, '');
      const incoming = clean.match(/--?>\s*([a-z][a-z0-9_.]+)\s+\[(evt_[A-Za-z0-9]+)\]/);
      const result = clean.match(/\[(\d{3})\].*\[(evt_[A-Za-z0-9]+)\]/);
      if (!incoming && !result) return;
      if (incoming) {
        observedTypes.set(incoming[2], incoming[1]);
        if (observedTypes.size > 100) observedTypes.delete(observedTypes.keys().next().value);
      }
      const receipt = { timestampUtc: new Date().toISOString(), listenerPid: child.pid,
        sequence: ++sequence, eventId: incoming?.[2] || result[2],
        eventType: incoming?.[1] || observedTypes.get(result[2]), status: result ? Number(result[1]) : undefined,
        forwardingDestination: /^https?:\/\/(localhost|127\.0\.0\.1):\d+\/api\/webhooks\/stripe$/.test(forwardUrl) ? forwardUrl : undefined,
        phase: result ? 'forward_result' : 'event_received' };
      try { onReceipt(receipt); } catch { safeLog('Stripe receipt persistence failed.'); }
      if (incoming) { try { onEventId(incoming[2], incoming[1]); } catch { safeLog('Stripe event observation failed.'); } }
    };
    const failBeforeReady = error => {
      if (resolved) return;
      resolved = true;
      clearTimeout(readinessTimeout);
      if (!child.killed) child.kill();
      reject(error);
    };
    const readinessTimeout = setTimeout(() => {
      failBeforeReady(new Error('Timed out waiting for Stripe CLI listener readiness.'));
    }, readinessTimeoutMs);
    const handle = (chunk, stream) => {
      const text = chunk.toString();
      buffer = (buffer + text).slice(-12000);
      partial[stream] += text;
      const lines = partial[stream].split(/\r?\n/); partial[stream] = lines.pop().slice(-12000);
      for (const line of lines) observe(line);
      const secret = buffer.match(/whsec_[A-Za-z0-9]+/);
      if (secret && !resolved) {
        resolved = true;
        clearTimeout(readinessTimeout);
        resolve({ process: child, secret: secret[0] });
      }
      if (resolved && /\[\d{3}\]/.test(text)) safeLog(`Stripe CLI forwarding response observed: ${text.match(/\[\d{3}\]/)?.[0]}`);
    };
    child.stdout.on('data', chunk => handle(chunk, 'stdout'));
    child.stderr.on('data', chunk => handle(chunk, 'stderr'));
    child.once('error', failBeforeReady);
    child.once('exit', code => {
      for (const stream of ['stdout', 'stderr']) if (partial[stream]) observe(partial[stream]);
      if (!resolved) {
        resolved = true;
        clearTimeout(readinessTimeout);
        reject(new Error(`Stripe CLI exited before readiness (code ${code}).`));
      }
    });
  });
}

function stopOwnedProcess(resource, stop = child => child.kill()) {
  if (resource?.owned && resource.process) return stop(resource.process);
  return false;
}

function createForwardProxy(targetUrl, capture) {
  const target = new URL(targetUrl);
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const eventId = body.toString('utf8').match(/"id"\s*:\s*"(evt_[A-Za-z0-9]+)"/)?.[1];
      const eventType = body.toString('utf8').match(/"type"\s*:\s*"([a-z][a-z0-9_.]+)"/)?.[1];
      const deliveredEvent = eventId && eventType
        ? { eventId, eventType, body, signature: req.headers['stripe-signature'], statusCode: null }
        : null;
      if (deliveredEvent) capture(deliveredEvent);
      const forward = http.request({ hostname: target.hostname, port: target.port, path: target.pathname, method: req.method, headers: { ...req.headers, host: target.host } }, upstream => {
        if (deliveredEvent) deliveredEvent.statusCode = upstream.statusCode || null;
        res.writeHead(upstream.statusCode || 502, upstream.headers);
        upstream.pipe(res);
      });
      forward.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      forward.end(body);
    });
  });
  return server;
}

async function listenOnEphemeralPort(server) {
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

function triggerStripeFixture(apiKey) {
  const result = spawnSync(stripeExe, ['trigger', 'payment_intent.succeeded'], {
    env: { ...process.env, STRIPE_API_KEY: apiKey }, encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  if (result.error) throw new Error(`Stripe CLI trigger failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Stripe CLI trigger failed with exit code ${result.status}.`);
  safeLog('Stripe CLI trigger completed; awaiting signed delivery and database readback.');
}

async function executeVerifier(configuration, options) {
  process.env.NODE_ENV = 'test';
  const values = configuration.values;
  const port = options.backendPort;
  const entrypoint = path.join(backendDir, 'dist', 'server.js');
  if (!fs.existsSync(entrypoint)) throw new Error('Built backend is missing; build it before running this verifier.');

  const results = { listener: 'FAIL', processSafety: 'FAIL', signatureAndPersistence: 'FAIL', boundWork: 'NOT APPLICABLE', duplicate: 'NOT RUN' };
  let listener;
  let backend;
  let proxy;
  let database;
  const delivered = [];
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    proxy = createForwardProxy(`${baseUrl}/api/webhooks/stripe`, item => delivered.push(item));
    const proxyPort = await listenOnEphemeralPort(proxy);
    listener = await startListener({ apiKey: values.STRIPE_SECRET_KEY, forwardUrl: `http://127.0.0.1:${proxyPort}/api/webhooks/stripe`, onEventId: () => {} });
    process.env.STRIPE_WEBHOOK_SECRET = listener.secret;
    results.listener = 'PASS';
    backend = await ensureBackend({ port, signingSecret: listener.secret, entrypoint });
    results.processSafety = backend.owned ? 'PASS (verifier-owned child)' : 'PASS (verified ElectroHub backend reused)';

    const healthResponse = await fetch(`${baseUrl}/api/health`);
    const healthBody = await healthResponse.json();
    if (healthResponse.status !== 200 || healthBody?.data?.service !== 'electrohub-backend') {
      throw new Error('ElectroHub health check did not return the expected service identity.');
    }

    const invalid = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST', body: JSON.stringify({ id: 'evt_invalid' }),
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1234567,v1=invalid_signature_hex' },
    });
    const invalidBody = await invalid.json();
    if (invalid.status !== 400 || invalidBody?.error?.code !== 'WEBHOOK_INVALID_SIGNATURE') {
      throw new Error('Backend did not reject the deliberately invalid Stripe signature.');
    }

    triggerStripeFixture(values.STRIPE_SECRET_KEY);
    const eventDelivery = await waitForCondition(
      () => delivered.find(item => item.eventType === 'payment_intent.succeeded' && item.statusCode !== null),
      item => Boolean(item && item.statusCode === 200),
      { timeoutMs: 30000, intervalMs: 100 },
    );
    if (!eventDelivery.signature) throw new Error('Stripe CLI did not forward a signature header.');

    const prismaModule = require(path.join(backendDir, 'dist', 'lib', 'prisma.js'));
    database = prismaModule.prisma;
    const persisted = await waitForPersistedEvent(eventDelivery.eventId, eventDelivery.eventType, database, { timeoutMs: 30000, intervalMs: 250 });
    results.signatureAndPersistence = `PASS (${persisted.event.id}, ${persisted.event.disposition})`;
    results.boundWork = persisted.bound ? `PASS (${persisted.work.state})` : 'NOT APPLICABLE (generic Stripe CLI fixture has no app-owned attempt)';

    await verifyDuplicateDelivery({
      replay: () => fetch(`${baseUrl}/api/webhooks/stripe`, {
        method: 'POST', body: eventDelivery.body,
        headers: { 'Content-Type': 'application/json', 'Stripe-Signature': eventDelivery.signature },
      }),
      countEvents: id => database.stripeEvent.count({ where: { id } }),
      eventId: eventDelivery.eventId,
      readWork: attemptId => database.paymentWork.findUnique({ where: { attemptId } }),
      attemptId: persisted.event.attemptId,
      priorWork: persisted.work,
    });
    results.duplicate = 'PASS (same signed event replay; one persisted event)';
  } finally {
    if (listener?.process && !listener.process.killed) listener.process.kill();
    if (proxy) await new Promise(resolve => proxy.close(resolve));
    stopOwnedProcess(backend, child => child.killed ? false : child.kill());
    if (database) await database.$disconnect();
    safeLog(`Process ownership: ${results.processSafety}`);
    safeLog(`Stripe CLI listener: ${results.listener}`);
    safeLog(`Signed event persisted: ${results.signatureAndPersistence}`);
    safeLog(`Bound durable work: ${results.boundWork}`);
    safeLog(`Duplicate delivery: ${results.duplicate}`);
  }
}

function main(argv = process.argv.slice(2), dependencies = {}) {
  return require('./stripe-browser-gate.cjs').main(argv, { ...dependencies, execute: dependencies.execute || executeVerifier, verificationKind: 'SIGNED_GENERIC_WEBHOOK_ONLY' });
}

if (require.main === module) main().then(code => { process.exitCode = code; });

module.exports = {
  backendHealth,
  main,
  createForwardProxy,
  ensureBackend,
  findProcessOnPort,
  isExpectedBackend,
  startListener,
  resolveStripeExecutable,
  stopOwnedProcess,
  waitForCondition,
  waitForPersistedEvent,
  verifyDuplicateDelivery,
};
