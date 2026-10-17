'use strict';
const { it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { migrationUrl, stageDefinitions, verifyTestReport, capacityCheck, fileMonitor,
  runChild, executeStages, signalControl } = require('./payment-pg-execution.cjs');
const project = 'pzxekjybdiulzmssalfo', schema = 'electrohub_payment_concurrency_20261012';
const original = `postgresql://eh_payment_concurrency_runner.${project}:OFFLINE_ONLY@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require&connection_limit=4&schema=${schema}&options=-csearch_path%3D${schema}`;
const root = fs.readFileSync(path.join(__dirname, '../prisma/supabase-ca.pem'), 'utf8')
  .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)[2];
const caPath = path.resolve(os.tmpdir(), 'offline-only-ca.pem');
const read = (file, encoding) => file === caPath ? root : fs.readFileSync(file, encoding);
const env = { NODE_EXTRA_CA_CERTS: caPath, PAYMENT_PG_TEST_DATABASE_URL: original,
  DATABASE_URL: 'application-sentinel', DIRECT_URL: 'application-sentinel' };
const sample = () => ({ status:'PASS', project, timestampMs: Date.now(), ordinaryLimit: 57, clientBackendScope: 'cluster', clientBackends: 34,
  runnerBackends: 0, devConnectionErrors: false, abnormalLockWait: false,
  tlsIsolationPass: true, schemaState: 'present', poolerClients: 173, queueDurationMs: 0 });
const report = () => ({ numTotalTestSuites: 1, numTotalTests: 10, numPassedTests: 10,
  numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, success: true,
  testResults: [{ name: path.resolve(__dirname, '../src/services/__tests__/payment.concurrency.postgres.integration.test.ts'),
    assertionResults: [...'ABCDEFGHIJ'].map(title => ({ title: `${title} — fixture`, status: 'passed' })) }] });

it('selects the existing config and only A-J; child environment changes do not overwrite application URLs', () => {
  const before = { ...env };
  const stages = stageDefinitions(env, read);
  assert.deepEqual(env, before);
  assert.deepEqual(stages.map(s => s.name), ['migration_tls', 'migration', 'tests']);
  const tests = stages[2];
  assert.equal(tests.args[tests.args.indexOf('--config') + 1], 'vitest.config.mts');
  assert.equal(tests.args.filter(a => a.endsWith('.test.ts')).length, 1);
  assert.equal(tests.env.PAYMENT_PG_TEST_INTERNAL_RUN, '1');
  assert.equal(tests.env.PAYMENT_PG_TEST_APPROVED, undefined);
  assert.equal(tests.env.STRIPE_SECRET_KEY, '');
  assert.equal(tests.env.DATABASE_URL, original);
  assert.equal(stages[0].env.DATABASE_URL, stages[1].env.DATABASE_URL);
  assert.equal(stages[1].env.DATABASE_URL, stages[1].env.DIRECT_URL);
});
it('requires the verified root and strict native TLS with bounded migration connection/query options', () => {
  const url = new URL(migrationUrl(original, caPath, read));
  assert.equal(url.searchParams.get('sslaccept'), 'strict');
  assert.equal(url.searchParams.get('sslmode'), 'require');
  assert.equal(url.searchParams.get('sslcert'), caPath);
  assert.equal(url.searchParams.get('connection_limit'), '1');
  assert.equal(url.searchParams.get('connect_timeout'), '5');
  assert.equal(url.searchParams.get('socket_timeout'), '30');
  assert.match(url.searchParams.get('options'), /statement_timeout=30000 -clock_timeout=5000$/);
  for (const bad of [original.replace(project, 'yepfgjehdstlxbpespun'), original+'&sslaccept=accept_invalid_certs',
    original+'&host=elsewhere', original+'&sslmode=disable']) assert.throws(() => migrationUrl(bad, caPath, read));
  assert.throws(() => migrationUrl(original, caPath, () => 'invalid'));
  assert.throws(() => stageDefinitions({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }, read));
  assert.throws(() => stageDefinitions(env, (file, encoding) => file.endsWith('package.json') ? '{"version":"6.13.0"}' : read(file, encoding)));
});
it('rejects skipped, failed, missing scenarios and unintended selections without exposing raw reports', () => {
  assert.deepEqual(verifyTestReport(JSON.stringify(report())), { passed: 10, failed: 0, skipped: 0 });
  for (const mutate of [r => { r.numPendingTests=10; }, r => { r.success=false; },
    r => { r.testResults.push(r.testResults[0]); }, r => { r.testResults[0].assertionResults[0].status='skipped'; },
    r => { r.testResults[0].assertionResults[0].title='B — duplicate'; }]) {
    const r = report(); mutate(r); assert.throws(() => verifyTestReport(JSON.stringify(r)));
  }
  assert.throws(() => verifyTestReport('postgresql://SECRET_VALUE'), error => !error.message.includes('SECRET_VALUE'));
});
it('preserves all nineteen reserves and enforces explicit unknown-pooler risk acceptance', () => {
  capacityCheck(sample(), { admission: true });
  assert.throws(() => capacityCheck({ ...sample(), clientBackends: 35 }, { admission: true }));
  capacityCheck({ ...sample(), clientBackends: 38, runnerBackends: 4, poolerClients: 177 });
  for (const extra of [{ clientBackends: 39 }, { runnerBackends: 5 }, { poolerClients: 178 },
    { queueDurationMs: 5001 }, { abnormalLockWait: true }, { devConnectionErrors: true },
    { tlsIsolationPass: false }, { timestampMs: Date.now()-11000 }, { poolerClients: undefined }]) {
    assert.throws(() => capacityCheck({ ...sample(), ...extra }));
  }
  const unknown = { ...sample(), poolerClients: null, queueDurationMs: null };
  assert.throws(() => capacityCheck(unknown));
  capacityCheck(unknown, { riskAccepted: true });
});
it('handles SIGINT and SIGTERM and releases only its own signal listeners', () => {
  const owner = new EventEmitter(); const controls = signalControl(owner);
  owner.emit('SIGINT'); assert.equal(controls.controller.signal.aborted, true);
  owner.emit('SIGTERM'); assert.equal(controls.cleanupController.signal.aborted, true);
  controls.dispose(); assert.equal(owner.listenerCount('SIGINT'), 0);
});
it('stops subsequent stages after failure and reports cleanup failure without raw exception text', async () => {
  const visited = [], output = [];
  const ok = await executeStages([{ name: 'migration' }, { name: 'tests' }], {
    monitor() {}, run: async stage => { visited.push(stage.name); throw new Error('PASSWORD_SECRET'); },
    cleanup: async () => { visited.push('cleanup'); throw new Error('PASSWORD_SECRET'); }, emit: line => output.push(line) });
  assert.equal(ok, false); assert.deepEqual(visited, ['migration', 'cleanup']);
  assert.match(output.join('\n'), /CLEANUP FAIL/); assert.doesNotMatch(output.join('\n'), /PASSWORD_SECRET/);
});
it('never cleans up after admission or TLS probe failure; refuses cleanup after unconfirmed termination', async () => {
  let drops = 0;
  for (const stages of [[{ name: 'migration_tls' }], [{ name: 'migration' }]]) {
    await executeStages(stages, { monitor() {}, run: async () => { const e=new Error(); e.treeStopped=false; throw e; },
      cleanup: async () => { drops++; }, emit() {} });
  }
  await executeStages([{ name: 'migration' }], { monitor() { throw new Error(); }, run: async () => { throw new Error(); },
    cleanup: async () => { drops++; }, emit() {} });
  assert.equal(drops, 0);
});

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-pg-child-test-'));
after(() => {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith('eh-pg-child-test-'));
  fs.rmSync(temp, { recursive: true, force: true }); // Verified exact local fixture directory.
});
const fixture = path.join(temp, 'child.cjs');
fs.writeFileSync(fixture, `const {spawn}=require('node:child_process');
const grand=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
console.log('ROOT='+process.pid+' GRAND='+grand.pid);
if(process.argv[2]==='orphan') process.exit(0);
if(process.argv[2]==='fail') process.exit(7);
setInterval(()=>{},1000);`);
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function gone(pid) {
  const end = Date.now()+6000;
  while(alive(pid) && Date.now()<end) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(alive(pid), false, 'only the fixture-owned grandchild must be gone');
}
function spy(onPid, onRoot = () => {}) {
  return (exe,args,options) => {
    const child=spawn(exe,args,options);
    child.stdout.on('data', chunk => {
      const match=chunk.toString().match(/GRAND=(\d+)/); if(match) onPid(Number(match[1]));
      const root=chunk.toString().match(/ROOT=(\d+)/); if(root) onRoot(Number(root[1]));
    });
    return child;
  };
}
it('contains and reaps an orphaned grandchild after normal exit, and propagates nonzero exit', async () => {
  assert.equal(process.platform, 'win32', 'this acceptance fixture requires the supported Windows host');
  for(const mode of ['orphan','fail']) {
    let pid;
    const stage={ args:[fixture,mode], env:{ ...process.env, PAYMENT_PG_TEST_DATABASE_URL:'', NODE_EXTRA_CA_CERTS:'' }, timeoutMs:5000 };
    const execution=runChild(stage,{ spawnChild:spy(value => { pid=value; }) });
    if(mode==='orphan') await execution; else await assert.rejects(execution,/CHILD_NONZERO_EXIT/);
    assert.ok(pid); await gone(pid);
  }
});
it('timeout and explicit cancellation terminate the entire owned child tree', async () => {
  for(const mode of ['timeout','abort','monitor']) {
    let pid, rootPid, fault=false; const controller=new AbortController();
    const execution=runChild({ args:[fixture,'hang'], env:{ ...process.env, PAYMENT_PG_TEST_DATABASE_URL:'', NODE_EXTRA_CA_CERTS:'' },
      timeoutMs: mode==='timeout' ? 1000 : 5000 }, { signal:controller.signal,
      monitor:() => { if(fault) throw new Error(); }, spawnChild:spy(value => {
        pid=value; if(mode==='abort') controller.abort(); if(mode==='monitor') fault=true;
      }, value => { rootPid=value; }) });
    await assert.rejects(execution, /CHILD_TIMEOUT|OWNER_CANCELED|MONITOR_STOP/);
    assert.ok(pid); assert.ok(rootPid); await gone(pid); await gone(rootPid);
  }
});
it('owner process termination closes the Job and reaps its target and grandchild', async () => {
  const ownerFile=path.join(temp,'owner.cjs');
  fs.writeFileSync(ownerFile, `const {runChild}=require(${JSON.stringify(path.join(__dirname,'payment-pg-execution.cjs'))});
const {spawn}=require('node:child_process');
runChild({args:[${JSON.stringify(fixture)},'hang'],env:process.env,timeoutMs:5000},
{spawnChild:(exe,args,options)=>{ const child=spawn(exe,args,options);
child.stdout.on('data',chunk=>process.stdout.write(chunk)); return child; }}).catch(()=>{});`);
  const owner=spawn(process.execPath,[ownerFile], { env:{ ...process.env, PAYMENT_PG_TEST_DATABASE_URL:'', NODE_EXTRA_CA_CERTS:'' },
    windowsHide:true, stdio:['ignore','pipe','pipe'] });
  let grandPid;
  try {
    grandPid=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('mock owner did not start')),10000);
      owner.stdout.on('data',chunk=>{ const match=chunk.toString().match(/GRAND=(\d+)/);
        if(match) { clearTimeout(timer); resolve(Number(match[1])); } });
      owner.once('error',reject);
    });
    owner.kill(); await gone(grandPid);
  } finally { owner.kill(); }
});
it('a missing or stale external observer blocks execution', () => {
  assert.throws(() => fileMonitor('', false));
  const file=path.join(temp,'monitor.json'); fs.writeFileSync(file,JSON.stringify(sample()));
  fileMonitor(file,false)(true);
  fs.writeFileSync(file,JSON.stringify({ ...sample(), timestampMs:Date.now()-11000 }));
  assert.throws(() => fileMonitor(file,false)(false));
});
it('refuses to declare an unresponsive guardian stopped and bounds cancellation waiting', async () => {
  const controller = new AbortController();
  const child = new EventEmitter(); child.stdout=new EventEmitter(); child.stderr=new EventEmitter();
  child.stdout.destroy=()=>{}; child.stderr.destroy=()=>{}; child.kill=()=>false; child.unref=()=>{};
  const promise = runChild({ args:[], env:{}, timeoutMs:1000 }, { signal:controller.signal,
    spawnChild:()=>child, cancellationGraceMs:20 });
  controller.abort();
  await assert.rejects(promise, error => error.label==='CHILD_TERMINATION_UNCONFIRMED' && error.treeStopped===false);
});
