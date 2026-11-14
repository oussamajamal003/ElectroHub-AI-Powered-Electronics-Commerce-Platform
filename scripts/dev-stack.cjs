'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { fork, spawn } = require('node:child_process');
const { openControl, controlRequest } = require('./lib/dev-control.cjs');
const safety = require('../apps/backend/scripts/stripe-gate-safety.cjs');
const verifier = require('../apps/backend/scripts/stripe-webhook-verifier.cjs');
const root = path.resolve(__dirname, '..');
const backend = path.join(root, 'apps/backend');
const stackFile = path.join(root, '.cache/dev-stack-control.json');
const paymentFile = path.join(backend, '.cache/dev-payment-control.json');
const identity = `electrohub-stack:${root}`;
const paymentIdentity = `electrohub-payment:${backend}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function diskReadiness(directory = root, statfs = fs.statfsSync) {
  try {
    const stats = statfs(directory);
    const freeMiB = Math.floor(Number(stats.bavail) * Number(stats.bsize) / 1048576);
    if (!Number.isFinite(freeMiB) || freeMiB < 0) throw new Error('Unknown capacity');
    return { status: freeMiB < 256 ? 'BLOCKED' : freeMiB < 2048 ? 'DEGRADED' : 'READY', freeMiB };
  } catch { return { status: 'NOT VERIFIED' }; }
}

async function probe(url, token) {
  try {
    const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(4000), redirect: 'manual' });
    const text = await response.text();
    let data; try { data = JSON.parse(text).data; } catch { /* HTML or Engine.IO */ }
    return { ok: response.ok, status: response.status, data, text };
  } catch { return { ok: false }; }
}
function diagnosticToken() {
  try { const token = fs.readFileSync(path.join(backend, '.cache/dev-runtime-token.txt'), 'utf8').trim(); return /^[a-f0-9]{64}$/.test(token) ? token : undefined; }
  catch { return undefined; }
}
async function paymentOwner() { return controlRequest(paymentFile, paymentIdentity); }
async function verifiedPayment(owner) {
  if (!owner || owner.phase !== 'ready' || owner.mode !== 'checkout' || owner.backendPort !== 5000 || !owner.listenerAlive) return false;
  const token = diagnosticToken();
  if (!token) return false;
  const { ok, data } = await probe('http://127.0.0.1:5000/api/internal/development-runtime', token);
  return ok && data?.mode === 'MAIN_DEV' && data.databaseReady && data.tlsVerified && data.supervisorActive &&
    data.pid === owner.apiPid && data.supervisorPid === owner.pid;
}
function publicDependencyStatuses(store, photoRoute, contactConfigured) {
  return [
    { service: 'Customer photo API route', status: photoRoute.status === 401 ? 'READY' : 'UNAVAILABLE', evidence: photoRoute.status === 404
      ? 'Route missing from running backend. Load the current compiled backend through a controlled supervisor restart; retrying the browser cannot install routes.'
      : `HTTP ${photoRoute.status ?? 'unreachable'}; expected protected-route 401 without credentials. Private photo/storage success remains NOT VERIFIED.` },
    { service: 'Contact recipient configuration', status: contactConfigured === true ? 'READY' : contactConfigured === false ? 'BLOCKED' :
      store.ok && !store.data?.supportEmail && photoRoute.status === 404 ? 'BLOCKED' : 'NOT VERIFIED',
      evidence: contactConfigured === true ? 'Eligible verified MFA administrators found; actual provider acceptance remains NOT VERIFIED.' : contactConfigured === false
        ? 'No active, verified administrator has completed MFA with an active factor. No unapproved fallback recipient is used.'
        : 'Legacy/unverified contact recipient policy. The old backend requires Support Email; load the current compiled backend to use the approved verified-MFA-admin policy.' },
  ];
}
/** Says what a queued order, welcome or delivery email will do in this runtime, and the supported command that changes it. */
function emailEvidence(owner) {
  if (!owner) return 'No supervised runtime: nothing drains queued mail. Start with npm run dev:stack:supervised:email';
  if (owner.email?.ready && owner.email?.producerEnabled) return 'Worker is draining allowlisted recipients. READY is not provider acceptance or inbox delivery';
  if (owner.email?.started || owner.email?.requested) return `${owner.email?.reason ?? 'Worker requested but not ready'}. Check with npm run notifications:doctor`;
  return `${owner.email?.reason ?? 'disabled-by-default'}: events are still queued but NOT sent. Restart with npm run dev:stack:restart:email (approved allowlist only); inspect the queue with npm run notifications:doctor`;
}
async function report() {
  let owner = null; let ownership = 'No authenticated checkout supervisor.';
  try { owner = await paymentOwner(); } catch (error) { ownership = error.message; }
  const token = diagnosticToken();
  const [front, live, ready, diagnostic, socket, swagger, products, store, photoRoute] = await Promise.all([
    probe('http://localhost:3000/@vite/client'), probe('http://127.0.0.1:5000/api/health'),
    probe('http://127.0.0.1:5000/api/health/ready'), token ? probe('http://127.0.0.1:5000/api/internal/development-runtime', token) : {},
    probe('http://127.0.0.1:5000/socket.io/?EIO=4&transport=polling'), probe('http://127.0.0.1:5000/api/docs/'),
    probe('http://127.0.0.1:5000/api/products'),
    probe('http://127.0.0.1:5000/api/store/profile'),
    probe('http://127.0.0.1:5000/api/account/profile-photo'),
  ]);
  const rows = [];
  const add = (service, status, evidence) => rows.push({ service, status, evidence });
  const disk = diskReadiness();
  add('Workspace disk', disk.status, disk.freeMiB === undefined ? 'Capacity unavailable' : `${disk.freeMiB} MiB free; full disks prevent logs, builds and browser artifacts. Allow at least 2 GiB for broad QA.`);
  add('Frontend :3000', front.ok && front.text?.includes('vite') ? 'READY' : 'UNAVAILABLE', 'Vite client HTTP probe');
  add('Backend :5000', live.data?.service === 'electrohub-backend' ? 'READY' : 'UNAVAILABLE', 'ElectroHub liveness; not database readiness');
  add('Database', ready.data?.database === 'connected' ? 'READY' : 'UNAVAILABLE', 'Live SELECT 1 through backend pool');
  const owned = owner?.phase === 'ready' && diagnostic.data?.supervisorActive && diagnostic.data?.pid === owner.apiPid && diagnostic.data?.supervisorPid === owner.pid;
  add('Payment supervisor', owned ? 'READY' : owner ? 'BLOCKED' : 'NOT VERIFIED', owned ? 'Authenticated owner + private API process/parent binding' : ownership);
  add('Stripe Test Mode / listener', owned && owner.listenerAlive ? 'READY' : owner ? 'BLOCKED' : 'NOT VERIFIED', 'Supervisor startup account/listener validation and private live payment authority; customer capability endpoint/payment completion NOT VERIFIED');
  add('Commerce email worker', !owner ? 'NOT VERIFIED' : owner.email?.ready && owner.email?.producerEnabled ? 'READY' : owner.email?.started || owner.email?.requested ? 'DEGRADED' : 'DISABLED BY APPROVED POLICY',
    emailEvidence(owner));
  add('Socket.IO', socket.ok && socket.text?.startsWith('0{') ? 'READY' : 'UNAVAILABLE', 'Engine.IO handshake; authenticated delivery NOT VERIFIED');
  add('Swagger', swagger.ok ? 'READY' : 'UNAVAILABLE', 'HTTP docs probe');
  add('Public products', products.ok ? 'READY' : 'UNAVAILABLE', `HTTP ${products.status ?? 'unreachable'}; authenticated cart/orders NOT VERIFIED`);
  add('Public store settings', store.ok ? 'READY' : 'UNAVAILABLE', `HTTP ${store.status ?? 'unreachable'}`);
  rows.push(...publicDependencyStatuses(store, photoRoute, diagnostic.data?.contactRecipientsConfigured));
  for (const service of ['Customer authentication/API', 'Admin authentication/MFA/API', 'Profile storage', 'Web Push delivery', 'Contact email provider'])
    add(service, 'NOT VERIFIED', 'Requires authorized identity/provider acceptance; configuration or listening port is insufficient');
  const output = { checkedAt: new Date().toISOString(), services: rows };
  console.log(JSON.stringify(output, null, 2)); return output;
}
async function assertFree(port) {
  if (process.platform === 'win32') {
    const owners = verifier.findProcessOnPort(port);
    if (owners.length) throw new Error(`Port ${port} is owned by PID(s) ${owners.join(', ')}. Use its owning terminal/control to stop it; no process was terminated.`);
  }
  // Some Windows/WSL forwarded or IPv6 loopback listeners are absent from the
  // host's owner inventory and can coexist with a wildcard bind. Probe both
  // loopback families too; an unknown accepting owner is still a conflict.
  const accepting = await Promise.all(['127.0.0.1', '::1'].map(host => new Promise(resolve => {
    const socket = net.connect({ port, host });
    const done = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.setTimeout(500, () => done(false));
  })));
  if (accepting.some(Boolean)) throw new Error(`Port ${port} is occupied on loopback; its owner is not safely reusable. Inspect the owning terminal/OS port inventory; no process was terminated.`);
  // Wildcard dual-stack bind prevents IPv4-only checks missing a listener.
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Port ${port} is occupied; inspect its owner. No process was terminated or port changed.`)));
    server.listen({ port, host: '::', ipv6Only: false }, () => server.close(resolve));
  });
}
async function until(read, timeoutMs = 90000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await read()) return; await delay(500); }
  throw new Error('Readiness deadline exceeded; inspect sanitized supervisor output and backend logs.');
}
async function build() {
  // Direct Node invocation avoids shell/npm process trees on Windows.
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args,
      { cwd: root, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Backend build failed; no payment runtime started.')));
  });
  await run([path.join(backend, 'scripts/ensure-prisma-client.cjs')]);
  await run([require.resolve('typescript/bin/tsc'), '-p', path.join(backend, 'tsconfig.json')]);
}
async function start(options = {}, deps = {}) {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error('The local development profile refuses production invocation or disabled TLS verification.');
  }
  const requestControl = deps.controlRequest || controlRequest;
  const getOwner = deps.paymentOwner || paymentOwner;
  const verifyOwner = deps.verifiedPayment || verifiedPayment;
  const free = deps.assertFree || assertFree;
  const compile = deps.build || build;
  const inspectDisk = deps.diskReadiness || diskReadiness;
  const forkChild = deps.fork || fork;
  const read = deps.probe || probe;
  const diagnose = deps.report || report;
  const existing = await requestControl(stackFile, identity);
  if (existing) {
    if (existing.phase !== 'ready' || !await verifyOwner(await getOwner())) throw new Error('Owned stack exists but is not ready. Run doctor; do not launch a duplicate.');
    const front = await read('http://localhost:3000/@vite/client');
    if (!front.ok) throw new Error('Owned frontend is unavailable; run doctor before restarting.');
    await diagnose(); return;
  }
  let phase = 'starting'; let stopping = false; let ownedPayment = null; let frontend = null; let failure = null; let monitor;
  let finish; const lifetime = new Promise(resolve => { finish = resolve; });
  let control;
  const children = [];
  const exited = child => child.exitCode !== null || Boolean(child.signalCode);
  const stop = async () => {
    if (stopping) return lifetime;
    stopping = true; phase = 'stopping';
    clearInterval(monitor);
    // Only the supervisor we launched is stopped; a reused runtime remains owned by its original session.
    if (ownedPayment && !exited(ownedPayment) && ownedPayment.connected) ownedPayment.send({ type: 'dev-stack.stop' }, () => {});
    if (frontend && !exited(frontend) && frontend.connected) frontend.disconnect();
    const end = Date.now() + 50000;
    while (children.some(child => !exited(child)) && Date.now() < end) await delay(100);
    // Never force-kill a financial supervisor: it retains its locks if it cannot drain.
    if (frontend && !exited(frontend)) frontend.kill();
    if (children.some(child => !exited(child))) { failure ||= new Error('An owned process did not drain; control record retained for inspection.'); finish(); return; }
    await control?.close(); finish();
  };
  control = await (deps.openControl || openControl)(stackFile, identity, () => ({ phase, frontendPid: frontend?.pid, ownsPayment: Boolean(ownedPayment) }), stop);
  const watch = child => {
    children.push(child);
    child.once('error', () => { failure ||= new Error('Owned child failed to start.'); void stop(); });
    child.once('exit', () => { if (!stopping) { failure ||= new Error('Owned child exited; automatic payment restart is forbidden. Run doctor and restart after preflight.'); void stop(); } });
    return child;
  };
  const onSignal = () => { void stop(); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  try {
    await free(3000);
    const owner = await getOwner();
    if (owner) {
      if (!await verifyOwner(owner)) throw new Error('Existing supervisor/API ownership or readiness failed. No replacement started.');
      if (options.email && !owner.email?.started) throw new Error('Existing runtime has email disabled; stop its owning session and start with approved allowlist configuration.');
    } else {
      await free(5000);
      if (inspectDisk().status === 'BLOCKED') throw new Error('Workspace disk has less than 256 MiB free; free space before building/starting another runtime. No payment supervisor started.');
      await compile();
      if (stopping) return;
      const args = ['--start', '--allow-dev-checkout', '--recovery-mode=checkout', ...(options.email ? ['--allow-email-allowlist'] : [])];
      ownedPayment = watch(forkChild(path.join(backend, 'scripts/dev-payment-runtime.cjs'), args,
        { cwd: backend, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, PORT: '5000', NODE_ENV: 'development' } }));
      await until(async () => { if (failure || stopping) throw failure || new Error('Startup stopped.'); return verifyOwner(await getOwner()); });
    }
    if (stopping) return;
    let frontendReady = false;
    frontend = watch(forkChild(path.join(__dirname, 'dev-stack-vite.cjs'), [], { cwd: root, windowsHide: true,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, E2E_FRONTEND_PORT: '3000', E2E_API_PROXY_TARGET: 'http://localhost:5000' } }));
    frontend.on('message', message => { if (message?.event === 'dev-stack.vite-ready' && message.port === 3000) frontendReady = true; });
    await until(async () => {
      if (failure || stopping) throw failure || new Error('Startup stopped.');
      if (!frontendReady) return false;
      const token = diagnosticToken();
      const direct = await read('http://127.0.0.1:5000/api/internal/development-runtime', token);
      const proxied = await read('http://localhost:3000/api/internal/development-runtime', token);
      return direct.ok && proxied.ok && direct.data?.instanceId === proxied.data?.instanceId;
    }, 30000);
    phase = 'ready'; await diagnose();
    let checking = false;
    monitor = setInterval(async () => {
      if (stopping || checking) return;
      checking = true;
      let healthy = false;
      try { healthy = await verifyOwner(await getOwner()); } catch { /* no authority inferred from an unavailable owner */ }
      if (!stopping) {
        const next = healthy ? 'ready' : 'degraded';
        if (phase !== next) console.log(`Runtime ${next}: ${healthy ? 'ownership/readiness recovered' : 'payment/backend readiness unavailable; run dev:stack:doctor; no automatic financial restart'}.`);
        phase = next;
      }
      checking = false;
    }, 10000); monitor.unref();
    console.log('ElectroHub session active. Ctrl+C / npm run dev:stack:stop drains owned services. Reused payment runtimes remain with their original owner.');
    await lifetime;
    if (failure) throw failure;
  } finally { await stop(); process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal); }
}
async function main(argv = process.argv.slice(2)) {
  const [command = 'status', ...flags] = argv;
  if (flags.some(flag => flag !== '--allow-email-allowlist') || !['start', 'status', 'doctor', 'stop', 'restart'].includes(command) ||
      flags.length > 1 || flags.length && !['start', 'restart'].includes(command)) throw new Error('Use start/status/doctor/stop/restart; start/restart optionally accept --allow-email-allowlist.');
  if (command === 'status' || command === 'doctor') {
    const result = await report();
    if (result.services.some(row => ['Frontend :3000', 'Backend :5000', 'Database', 'Payment supervisor'].includes(row.service) && row.status !== 'READY' || row.service === 'Workspace disk' && row.status === 'BLOCKED')) process.exitCode = 1;
    return result;
  }
  if (command === 'stop' || command === 'restart') {
    const stopped = await controlRequest(stackFile, identity, 'stop');
    if (!stopped) console.log('No owned stack control found. No process stopped.');
    if (stopped) await until(() => !fs.existsSync(stackFile), 55000);
    if (command === 'stop') return;
  }
  return start({ email: flags.includes('--allow-email-allowlist') });
}
if (require.main === module) {
  const restoreOut = safety.installSanitizedOutput(process.stdout); const restoreErr = safety.installSanitizedOutput(process.stderr);
  main().catch(error => { console.error(safety.sanitize(error.message)); process.exitCode = 1; }).finally(() => { restoreOut(); restoreErr(); });
}
module.exports = { emailEvidence, probe, report, assertFree, verifiedPayment, diskReadiness, publicDependencyStatuses, start, main };
