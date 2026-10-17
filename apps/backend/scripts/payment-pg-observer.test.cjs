'use strict';
const { it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { connectionConfiguration, verifyObserverIdentity, record, failureRecord, publisher,
  observe, verifyHealth, sampleSql, safeReason, signalControl } = require('./payment-pg-observer.cjs');
const { fileMonitor, capacityCheck, runChild } = require('./payment-pg-execution.cjs');

const project='pzxekjybdiulzmssalfo', schema='electrohub_payment_concurrency_20261012';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'eh-pg-observer-test-'));
after(()=>{
  assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith('eh-pg-observer-test-'));
  fs.rmSync(temp,{ recursive:true, force:true });
});
const root=fs.readFileSync(path.join(__dirname,'../prisma/supabase-ca.pem'),'utf8')
  .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)[2];
const ca=path.join(temp,'root.pem'); fs.writeFileSync(ca,root);
const env={ PAYMENT_PG_OBSERVER_DATABASE_URL:`postgresql://postgres.${project}:OFFLINE_ONLY@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require`,
  NODE_EXTRA_CA_CERTS:ca };
const identity=()=>({ database:'postgres',role:'postgres',login:'postgres',read_only:'on',track_activities:'on',
  superuser:false, full_stats:true, schema:'pg_catalog', schemas:['pg_catalog'] });
const row=(now=Date.now())=>({ timestamp_ms:now,ordinary_limit:57,client_backends:8,runner_backends:0,
  hidden_states:0,abnormal_lock_wait:false,fatal_counter:'0',abandoned_counter:'3155',killed_counter:'0',
  stats_epoch:'unchanged',schema_state:'present',role_secure:true,public_denied:true });
const health=(now=Date.now())=>({ project,source:'approved-dev-connection-error-feed',windowStartMs:now-10000,
  coveredThroughMs:now,timestampMs:now,connectionErrors:false,
  coverage:{ postgres:true,supavisor:true,application:true } });

function fixture(overrides={}) {
  let clock=Date.now(); const samples=[],messages=[],pauses=[],queries=[];
  const client=new EventEmitter(); client.connect=async()=>{}; client.end=async()=>{ client.closed=true; };
  client.query=async sql=>{ queries.push(sql); return { rows:[sql.includes('current_database() AS database')?identity():row(clock)] }; };
  const options={ env,output:{ write:s=>samples.push(JSON.parse(JSON.stringify(s))) },emit:m=>messages.push(m),
    factory:()=>client,tlsCheck:()=>{},health:()=>health(clock),now:()=>clock,
    pause:async ms=>{ pauses.push(ms); clock+=ms; },maxSamples:3,...overrides };
  return { options,client,samples,messages,pauses,queries };
}

it('requires a separate exact DEV observer URL, strict CA/hostname trust and read-only session options',()=>{
  const before={ ...env }, config=connectionConfiguration(env);
  assert.deepEqual(env,before);
  assert.equal(config.ssl.rejectUnauthorized,true); assert.equal(config.ssl.ca,root);
  assert.equal(config.connectionTimeoutMillis,2000);
  assert.match(config.options,/default_transaction_read_only=on -csearch_path=pg_catalog/);
  assert.equal(config.application_name,'electrohub-pg-readonly-observer');
  assert.equal(config.connectionString.includes('sslmode='),false);
  assert.throws(()=>connectionConfiguration({}),/OBSERVER_CONNECTION_REQUIRED/);
  for(const url of [env.PAYMENT_PG_OBSERVER_DATABASE_URL.replace(project,'yepfgjehdstlxbpespun'),
    env.PAYMENT_PG_OBSERVER_DATABASE_URL.replace('postgres.','eh_payment_concurrency_runner.'),
    env.PAYMENT_PG_OBSERVER_DATABASE_URL+'&options=-csearch_path=public',
    env.PAYMENT_PG_OBSERVER_DATABASE_URL+'&sslmode=disable']) {
    assert.throws(()=>connectionConfiguration({ ...env,PAYMENT_PG_OBSERVER_DATABASE_URL:url }));
  }
  assert.throws(()=>connectionConfiguration({ ...env,NODE_TLS_REJECT_UNAUTHORIZED:'0' }));
});
it('requires accurate full-stats visibility, read-only mode and exact observer identity',()=>{
  verifyObserverIdentity(identity());
  for(const change of [{ full_stats:false },{ superuser:true },{ role:'other' },{ read_only:'off' },{ track_activities:'off' },{ schemas:['public'] }]) {
    assert.throws(()=>verifyObserverIdentity({ ...identity(),...change }));
  }
  assert.match(sampleSql,/WHERE backend_type='client backend'\) AS client_backends/);
  assert.ok(sampleSql.includes(schema));
  assert.doesNotMatch(sampleSql,/SELECT \*|FROM public\.|\.query\b|\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|GRANT)\s/i);
  assert.match(sampleSql,/pg_blocking_pids/);
  assert.match(sampleSql,/a\.usename='eh_payment_concurrency_runner' AND cardinality\(pg_blocking_pids\(a\.pid\)\)>0/);
  assert.match(sampleSql,/CASE WHEN c.relkind='S' THEN has_sequence_privilege\('[^']+',[^,]+,'USAGE'\)/);
  assert.doesNotMatch(sampleSql,/has_sequence_privilege\([^)]*'USAGE,SELECT,UPDATE'/);
});
it('rejects missing, stale, malformed or incomplete health coverage instead of fabricating healthy values',()=>{
  const now=Date.now();
  assert.throws(()=>verifyHealth(null,now),/SOURCE_UNAVAILABLE/);
  for(const change of [{ coverage:{ postgres:true } },{ timestampMs:now-6000 },
    { coveredThroughMs:now-6000 },{ windowStartMs:now-1000 },{ connectionErrors:null }]) {
    assert.throws(()=>verifyHealth({ ...health(now),...change },now));
  }
  assert.throws(()=>verifyHealth({ ...health(now),windowStartMs:now-1000 },now,now-2000),/COVERAGE_GAP/);
});
it('measures counters without treating historical errors as new errors; detects reset and increments',()=>{
  const now=Date.now(), state={}; record(row(now),health(now),state,now);
  assert.throws(()=>record({ ...row(now+1000),fatal_counter:'1' },health(now+1000),state,now+1000),/POSTGRES_SESSION_COUNTER_CHANGED/);
  assert.throws(()=>record({ ...row(now+1000),stats_epoch:'reset' },health(now+1000),state,now+1000),/STATS_COUNTER_RESET/);
  assert.throws(()=>record({ ...row(now),hidden_states:1 },health(now),{},now));
});
it('enforces admission, runtime cap, role cap, abnormal locks and marked-schema presence',()=>{
  const now=Date.now(); const sample=record(row(now),health(now),{},now);
  capacityCheck(sample,{ admission:true,riskAccepted:true,now });
  for(const change of [{ clientBackends:35 },{ runnerBackends:1 }]) {
    assert.throws(()=>capacityCheck({ ...sample,...change },{ admission:true,riskAccepted:true,now }));
  }
  capacityCheck({ ...sample,clientBackends:38,runnerBackends:4 },{ riskAccepted:true,now });
  for(const change of [{ clientBackends:39 },{ runnerBackends:5 },{ abnormalLockWait:true }]) {
    assert.throws(()=>capacityCheck({ ...sample,...change },{ riskAccepted:true,now }));
  }
  assert.throws(()=>capacityCheck({ ...sample,schemaState:'absent' },{ riskAccepted:true,now }),/MONITOR_SCHEMA_ABSENT/);
  assert.throws(()=>capacityCheck(sample,{ riskAccepted:true,now:now+10001 }));
  assert.throws(()=>capacityCheck(sample,{ riskAccepted:false,now }),/POOLER_VISIBILITY/);
});
it('publishes atomic parseable records, excludes repository paths and prevents concurrent writers',()=>{
  const file=path.join(temp,'atomic','monitor.json'), writer=publisher(file);
  try {
    const now=Date.now(); writer.write(record(row(now),health(now),{},now));
    fileMonitor(file,true)(true);
    assert.throws(()=>publisher(file),/ALREADY_RUNNING/);
    writer.write(failureRecord('OBSERVER_STOPPED'));
    assert.throws(()=>fileMonitor(file,true)(false),/MONITOR_OBSERVER_BLOCKED/);
    assert.equal(fs.readdirSync(path.dirname(file)).some(name=>name.endsWith('.tmp')),false);
  } finally { writer.close(); }
  assert.throws(()=>publisher(path.join(__dirname,'monitor.json')),/MONITOR_PUBLICATION_FAILED/);
  assert.throws(()=>publisher(path.join(temp,'not-monitor.json')),/MONITOR_PUBLICATION_FAILED/);
});
it('startup failure publishes unknown values and sanitized reason without connecting or setting approval',async()=>{
  const f=fixture({ env:{},factory:()=>{ throw new Error('must not connect'); } });
  const result=await observe(f.options);
  assert.equal(result.ok,false); assert.equal(f.samples[0].reason,'OBSERVER_CONNECTION_REQUIRED');
  assert.equal(f.samples[0].devConnectionErrors,null); assert.equal(f.samples[0].clientBackends,null);
  assert.equal(process.env.PAYMENT_PG_TEST_APPROVED==='true',false);
});
it('normal sampling refreshes every two seconds and stopping invalidates the last healthy record',async()=>{
  const f=fixture(); const result=await observe(f.options);
  assert.deepEqual(result,{ ok:true,samples:3 });
  assert.deepEqual(f.pauses,[2000,2000,2000]); assert.equal(f.samples.length,4);
  assert.deepEqual(f.samples.slice(0,3).map(s=>s.clientBackends),[8,8,8]);
  assert.equal(f.samples[3].reason,'OBSERVER_STOPPED'); assert.equal(f.client.closed,true);
});
it('unknown connection-health source preserves real counts but blocks immediately',async()=>{
  const f=fixture({ health:()=>null }); const result=await observe(f.options);
  assert.equal(result.ok,false); assert.equal(f.samples[0].status,'BLOCKED');
  assert.equal(f.samples[0].clientBackends,8); assert.equal(f.samples[0].devConnectionErrors,null);
  assert.equal(f.samples[0].reason,'CONNECTION_HEALTH_SOURCE_UNAVAILABLE');
});
it('cancellation invalidates monitoring and closes the independent observer connection',async()=>{
  const controller=new AbortController(); const f=fixture({ signal:controller.signal,pause:async()=>controller.abort() });
  const result=await observe(f.options);
  assert.equal(result.ok,false); assert.equal(f.client.closed,true);
  assert.equal(f.samples.at(-1).reason,'OBSERVER_OWNER_INTERRUPTED');
});
it('owner SIGINT/SIGTERM interrupts the observer and removes only its own handlers',()=>{
  const owner=new EventEmitter(), controls=signalControl(owner);
  owner.emit('SIGTERM'); assert.equal(controls.signal.aborted,true);
  controls.dispose(); assert.equal(owner.listenerCount('SIGINT'),0); assert.equal(owner.listenerCount('SIGTERM'),0);
});
it('database, TLS, publication and asynchronous socket failures never emit raw secret exceptions',async()=>{
  for(const mode of ['query','tls','publication','socket']) {
    const f=fixture();
    if(mode==='query') f.client.query=async()=>{ throw new Error('postgresql://RAW_SECRET'); };
    if(mode==='tls') f.options.tlsCheck=()=>{ throw new Error('postgresql://RAW_SECRET'); };
    if(mode==='publication') f.options.output.write=()=>{ throw new Error('postgresql://RAW_SECRET'); };
    if(mode==='socket') f.options.pause=async()=>f.client.emit('error',new Error('postgresql://RAW_SECRET'));
    assert.equal((await observe(f.options)).ok,false);
    assert.doesNotMatch(JSON.stringify(f.messages)+JSON.stringify(f.samples),/RAW_SECRET|postgresql:\/\//);
  }
  assert.equal(safeReason({ code:'28P01',message:'secret' }),'OBSERVER_AUTHENTICATION_FAILED');
});
it('malformed and missing monitor records cannot pass the runner gate',()=>{
  const file=path.join(temp,'bad.json');
  fs.writeFileSync(file,'not json'); assert.throws(()=>fileMonitor(file,true)(false));
  fs.unlinkSync(file); assert.throws(()=>fileMonitor(file,true)(false));
});
it('mock observer remains outside the canceled test child Job',async()=>{
  const controller=new AbortController(), file=path.join(temp,'independent','monitor.json'), writer=publisher(file);
  let refreshes=0;
  const f=fixture({ signal:controller.signal,maxSamples:Infinity,pause:ms=>new Promise(resolve=>setTimeout(resolve,Math.min(ms,50))),
    output:{ write:s=>{ writer.write(s); if(s.status==='PASS') refreshes++; } },
    now:Date.now,health:()=>health() });
  f.client.query=async sql=>({ rows:[sql.includes('current_database() AS database')?identity():row()] });
  const observing=observe(f.options);
  try {
    await new Promise(resolve=>setTimeout(resolve,100));
    await assert.rejects(runChild({ args:['-e','setInterval(()=>{},1000)'],env:{ ...process.env,
      PAYMENT_PG_TEST_DATABASE_URL:'',NODE_EXTRA_CA_CERTS:'' },timeoutMs:500 }),/CHILD_TIMEOUT/);
    const afterCancel=refreshes;
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.ok(refreshes>afterCancel); assert.equal(f.client.closed,undefined);
  } finally { controller.abort(); await observing; writer.close(); }
});
