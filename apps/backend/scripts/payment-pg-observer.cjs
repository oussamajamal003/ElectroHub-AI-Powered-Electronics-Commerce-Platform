'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { verifyRoot } = require('./payment-pg-ca.cjs');
const { verifyClientTls } = require('./payment-pg-readiness.cjs');
const { capacityCheck } = require('./payment-pg-execution.cjs');

const PROJECT = 'pzxekjybdiulzmssalfo';
const HOST = 'aws-0-ap-northeast-2.pooler.supabase.com';
const ROLE = 'eh_payment_concurrency_runner';
const SCHEMA = 'electrohub_payment_concurrency_20261012';
const MARKER = `DEV:${PROJECT}:${SCHEMA}:${ROLE}:migrate-deploy+fixtures+scenarios-A-J+drop`;
const defaultFile = path.join(os.tmpdir(), 'electrohub-payment-pg-observer', 'monitor.json');
const repository = path.resolve(__dirname, '../../..');
const reasons = new Set(['OBSERVER_CONNECTION_REQUIRED', 'OBSERVER_TARGET_REJECTED', 'OBSERVER_CA_REQUIRED',
  'OBSERVER_IDENTITY_OR_PRIVILEGES_FAILED', 'OBSERVER_TLS_FAILED', 'OBSERVER_DATABASE_FAILED',
  'OBSERVER_CONNECT_TIMEOUT', 'OBSERVER_AUTHENTICATION_FAILED', 'OBSERVER_DNS_FAILED',
  'CONNECTION_HEALTH_SOURCE_UNAVAILABLE', 'CONNECTION_HEALTH_COVERAGE_GAP', 'CONNECTION_HEALTH_SOURCE_INVALID',
  'CONNECTION_ERRORS_OBSERVED', 'POSTGRES_SESSION_COUNTER_CHANGED', 'STATS_COUNTER_RESET', 'OBSERVER_SAMPLE_INVALID',
  'OBSERVER_STOPPED', 'OBSERVER_OWNER_INTERRUPTED', 'MONITOR_PUBLICATION_FAILED',
  'POSTGRES_CONNECTION_BUDGET_STOP', 'POOLER_CLIENT_BUDGET_STOP', 'POOLER_QUEUE_STOP',
  'DEV_HEALTH_OR_ISOLATION_STOP', 'MONITOR_STALE_OR_WRONG_TARGET', 'MONITOR_SCHEMA_ABSENT',
  'OBSERVER_ALREADY_RUNNING']);

function blocked(reason) { const error = new Error(reason); error.label = reason; return error; }
function safeReason(error) {
  if (reasons.has(error?.label)) return error.label;
  if (['ENOTFOUND','EAI_AGAIN'].includes(error?.code)) return 'OBSERVER_DNS_FAILED';
  if (['ETIMEDOUT','ECONNRESET','ECONNREFUSED'].includes(error?.code)) return 'OBSERVER_CONNECT_TIMEOUT';
  if (['28P01','28000'].includes(error?.code)) return 'OBSERVER_AUTHENTICATION_FAILED';
  if (typeof error?.code === 'string' && /CERT|TLS|SELF_SIGNED/.test(error.code)) return 'OBSERVER_TLS_FAILED';
  return 'OBSERVER_DATABASE_FAILED';
}

const identitySql = `SELECT current_database() AS database, current_user AS role, session_user AS login,
  current_setting('transaction_read_only') AS read_only, current_setting('track_activities') AS track_activities,
  current_schema() AS schema, current_schemas(false)::text[] AS schemas,
  (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,
  pg_has_role(current_user,'pg_read_all_stats','USAGE') AS full_stats`;

// Fixed catalog-only SQL. No application rows, query text, secrets or provider IDs.
// Each autocommit SELECT gets a fresh statistics snapshot across ALL databases.
const sampleSql = `SELECT floor(extract(epoch FROM clock_timestamp())*1000)::float8 AS timestamp_ms,
  current_setting('max_connections')::int-current_setting('superuser_reserved_connections')::int-
    current_setting('reserved_connections')::int AS ordinary_limit,
  (SELECT count(*)::int FROM pg_stat_activity WHERE backend_type='client backend') AS client_backends,
  (SELECT count(*)::int FROM pg_stat_activity WHERE backend_type='client backend' AND usename='${ROLE}') AS runner_backends,
  (SELECT count(*)::int FROM pg_stat_activity WHERE backend_type='client backend' AND state IS NULL) AS hidden_states,
  EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.backend_type='client backend' AND (
    (a.wait_event_type='Lock' AND clock_timestamp()-a.query_start>interval '5 seconds') OR
    (a.usename='${ROLE}' AND cardinality(pg_blocking_pids(a.pid))>0) OR
    (a.usename IS DISTINCT FROM '${ROLE}' AND EXISTS (SELECT 1 FROM pg_stat_activity b
      WHERE b.usename='${ROLE}' AND b.pid=ANY(pg_blocking_pids(a.pid)))))) AS abnormal_lock_wait,
  (SELECT sum(sessions_fatal)::text FROM pg_stat_database) AS fatal_counter,
  (SELECT sum(sessions_abandoned)::text FROM pg_stat_database) AS abandoned_counter,
  (SELECT sum(sessions_killed)::text FROM pg_stat_database) AS killed_counter,
  (SELECT COALESCE(string_agg(datid::text||':'||COALESCE(stats_reset::text,'none'),',' ORDER BY datid),'')
    FROM pg_stat_database) AS stats_epoch,
  CASE WHEN n.oid IS NULL THEN 'absent' WHEN n.nspowner=r.oid AND
    obj_description(n.oid,'pg_namespace')='${MARKER}' THEN 'present' ELSE 'invalid' END AS schema_state,
  COALESCE(r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
    AND NOT r.rolinherit AND NOT r.rolreplication AND NOT r.rolbypassrls AND r.rolconnlimit=4
    AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid),false) AS role_secure,
  NOT has_database_privilege('${ROLE}',current_database(),'CREATE') AND
    NOT has_schema_privilege('${ROLE}','public','CREATE') AND
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public'
      AND CASE WHEN c.relkind='S' THEN has_sequence_privilege('${ROLE}',c.oid,'USAGE') OR
          has_sequence_privilege('${ROLE}',c.oid,'SELECT') OR has_sequence_privilege('${ROLE}',c.oid,'UPDATE')
        WHEN c.relkind IN ('r','p','v','m','f') THEN has_table_privilege('${ROLE}',c.oid,'SELECT') OR
          has_table_privilege('${ROLE}',c.oid,'INSERT') OR has_table_privilege('${ROLE}',c.oid,'UPDATE') OR
          has_table_privilege('${ROLE}',c.oid,'DELETE') OR has_table_privilege('${ROLE}',c.oid,'TRUNCATE') OR
          has_table_privilege('${ROLE}',c.oid,'REFERENCES') OR has_table_privilege('${ROLE}',c.oid,'TRIGGER') OR
          has_table_privilege('${ROLE}',c.oid,'MAINTAIN')
          OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
            AND (has_column_privilege('${ROLE}',c.oid,a.attnum,'SELECT') OR
              has_column_privilege('${ROLE}',c.oid,a.attnum,'INSERT') OR
              has_column_privilege('${ROLE}',c.oid,a.attnum,'UPDATE') OR
              has_column_privilege('${ROLE}',c.oid,a.attnum,'REFERENCES'))) ELSE false END)
    AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
      WHERE ns.nspname='public' AND p.prosecdef AND has_function_privilege('${ROLE}',p.oid,'EXECUTE')) AS public_denied
  FROM (SELECT 1) AS singleton LEFT JOIN pg_roles r ON r.rolname='${ROLE}'
    LEFT JOIN pg_namespace n ON n.nspname='${SCHEMA}'`;

function connectionConfiguration(env, read = fs.readFileSync) {
  if (!env.PAYMENT_PG_OBSERVER_DATABASE_URL) throw blocked('OBSERVER_CONNECTION_REQUIRED');
  let url;
  try { url = new URL(env.PAYMENT_PG_OBSERVER_DATABASE_URL); } catch { throw blocked('OBSERVER_TARGET_REJECTED'); }
  if (!['postgresql:','postgres:'].includes(url.protocol) || url.hostname !== HOST || url.port !== '5432' ||
      url.pathname !== '/postgres' || decodeURIComponent(url.username) !== `postgres.${PROJECT}` ||
      !url.password || url.hash || env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw blocked('OBSERVER_TARGET_REJECTED');
  const allowed = new Set(['sslmode','connection_limit']); const seen = new Set();
  for (const [key,value] of url.searchParams) {
    if (!allowed.has(key) || seen.has(key) || (key==='sslmode' && !['require','verify-full'].includes(value)) ||
        (key==='connection_limit' && value!=='1')) throw blocked('OBSERVER_TARGET_REJECTED');
    seen.add(key);
  }
  if (!env.NODE_EXTRA_CA_CERTS || !path.isAbsolute(env.NODE_EXTRA_CA_CERTS)) throw blocked('OBSERVER_CA_REQUIRED');
  let ca;
  try { ca=read(env.NODE_EXTRA_CA_CERTS,'utf8'); verifyRoot(ca); } catch { throw blocked('OBSERVER_CA_REQUIRED'); }
  url.search='';
  return { connectionString:url.toString(), connectionTimeoutMillis:2000, query_timeout:1500,
    statement_timeout:1500, lock_timeout:500, application_name:'electrohub-pg-readonly-observer',
    options:'-cdefault_transaction_read_only=on -csearch_path=pg_catalog',
    ssl:{ ca, rejectUnauthorized:true } };
}

function verifyObserverIdentity(row) {
  if (!row || row.database!=='postgres' || row.role!=='postgres' || row.login!=='postgres' || row.read_only!=='on' ||
      row.track_activities!=='on' || row.superuser!==false || row.full_stats!==true || row.schema!=='pg_catalog' ||
      JSON.stringify(row.schemas)!==JSON.stringify(['pg_catalog'])) throw blocked('OBSERVER_IDENTITY_OR_PRIVILEGES_FAILED');
}

function readHealth(file) {
  try {
    if (!file || !path.isAbsolute(file) || fs.statSync(file).size>4096) throw blocked('CONNECTION_HEALTH_SOURCE_UNAVAILABLE');
    return JSON.parse(fs.readFileSync(file,'utf8'));
  } catch { throw blocked('CONNECTION_HEALTH_SOURCE_UNAVAILABLE'); }
}

function verifyHealth(health, timestamp, previousThrough) {
  if (!health) throw blocked('CONNECTION_HEALTH_SOURCE_UNAVAILABLE');
  if (health.project!==PROJECT || health.source!=='approved-dev-connection-error-feed' ||
      !Number.isFinite(health.windowStartMs) || !Number.isFinite(health.coveredThroughMs) ||
      !Number.isFinite(health.timestampMs) || typeof health.connectionErrors!=='boolean' ||
      health.coverage?.postgres!==true || health.coverage?.supavisor!==true || health.coverage?.application!==true ||
      health.windowStartMs>health.coveredThroughMs || health.coveredThroughMs>health.timestampMs ||
      health.timestampMs>timestamp+1000) throw blocked('CONNECTION_HEALTH_SOURCE_INVALID');
  if (timestamp-health.timestampMs>5000 || timestamp-health.coveredThroughMs>5000 ||
      health.windowStartMs>(previousThrough ?? timestamp-5000)) throw blocked('CONNECTION_HEALTH_COVERAGE_GAP');
  return health.coveredThroughMs;
}

function record(row, health, state, now=Date.now()) {
  if (!row || !Number.isFinite(row.timestamp_ms) || now-row.timestamp_ms>5000 || row.timestamp_ms>now+1000 ||
      !Number.isInteger(row.client_backends) || !Number.isInteger(row.runner_backends) ||
      row.client_backends<0 || row.runner_backends<0 || row.hidden_states!==0 ||
      row.ordinary_limit!==57 || typeof row.abnormal_lock_wait!=='boolean' ||
      typeof row.role_secure!=='boolean' || typeof row.public_denied!=='boolean' || typeof row.stats_epoch!=='string' ||
      !['present','absent','invalid'].includes(row.schema_state)) throw blocked('OBSERVER_SAMPLE_INVALID');
  const counters = [row.fatal_counter,row.abandoned_counter,row.killed_counter];
  if (counters.some(c=>typeof c!=='string' || !/^\d+$/.test(c))) throw blocked('OBSERVER_SAMPLE_INVALID');
  if (state.counters && (state.epoch!==row.stats_epoch || counters.some((c,i)=>BigInt(c)<BigInt(state.counters[i])))) {
    throw blocked('STATS_COUNTER_RESET');
  }
  const counterChanged = state.counters && counters.some((c,i)=>BigInt(c)>BigInt(state.counters[i]));
  const sample = { status:'PASS', project:PROJECT, timestampMs:row.timestamp_ms,
    observedAtUtc:new Date(row.timestamp_ms).toISOString(), ordinaryLimit:row.ordinary_limit,
    clientBackendScope:'cluster', clientBackends:row.client_backends, runnerBackends:row.runner_backends,
    devConnectionErrors:null, abnormalLockWait:row.abnormal_lock_wait,
    tlsIsolationPass:row.role_secure===true && row.public_denied===true && row.schema_state==='present',
    schemaState:row.schema_state, poolerClients:null, queueDurationMs:null,
    observer:{ role:'postgres', fullStats:true, readOnly:true, tlsVerified:true } };
  if (row.schema_state==='absent') {
    const error=blocked('MONITOR_SCHEMA_ABSENT'); error.sample=sample; throw error;
  }
  let through;
  try { through=verifyHealth(health,row.timestamp_ms,state.coveredThrough); }
  catch (error) { error.sample=sample; throw error; }
  sample.devConnectionErrors=health.connectionErrors;
  sample.observer.healthCoveredThroughMs=through;
  // The observer measures unknown Supavisor metrics as null. This internal check
  // does NOT set or replace the runner's separate owner risk-acceptance flag.
  try {
    if (sample.devConnectionErrors) throw blocked('CONNECTION_ERRORS_OBSERVED');
    if (counterChanged) throw blocked('POSTGRES_SESSION_COUNTER_CHANGED');
    capacityCheck(sample,{ riskAccepted:true, now });
  } catch (error) { error.sample=sample; throw error; }
  state.counters=counters; state.epoch=row.stats_epoch; state.coveredThrough=through;
  return sample;
}

function failureRecord(reason, now=Date.now()) {
  return { status:'BLOCKED', reason:reasons.has(reason)?reason:'OBSERVER_DATABASE_FAILED', project:PROJECT,
    timestampMs:now, ordinaryLimit:null, clientBackendScope:'cluster', clientBackends:null, runnerBackends:null,
    devConnectionErrors:null, abnormalLockWait:null, tlsIsolationPass:null, schemaState:null,
    poolerClients:null, queueDurationMs:null };
}

function publisher(file=defaultFile) {
  if (!path.isAbsolute(file)) throw blocked('MONITOR_PUBLICATION_FAILED');
  const requested=path.resolve(file), directory=path.dirname(requested);
  let temporaryRoot;
  try { temporaryRoot=fs.realpathSync(os.tmpdir()); } catch { throw blocked('MONITOR_PUBLICATION_FAILED'); }
  const lexicalRelative=path.relative(temporaryRoot,directory);
  if (path.basename(requested)!=='monitor.json' || !lexicalRelative || lexicalRelative==='..' ||
      lexicalRelative.startsWith('..'+path.sep) || path.isAbsolute(lexicalRelative)) throw blocked('MONITOR_PUBLICATION_FAILED');
  try { fs.mkdirSync(directory,{ recursive:true, mode:0o700 }); } catch { throw blocked('MONITOR_PUBLICATION_FAILED'); }
  let real;
  try { real=fs.realpathSync(directory); } catch { throw blocked('MONITOR_PUBLICATION_FAILED'); }
  const relative=path.relative(temporaryRoot,real), repositoryRelative=path.relative(repository,real);
  if (path.resolve(real)!==path.resolve(directory) || !relative || relative==='..' || relative.startsWith('..'+path.sep) ||
      path.isAbsolute(relative) || !repositoryRelative ||
      (!repositoryRelative.startsWith('..'+path.sep) && !path.isAbsolute(repositoryRelative))) {
    throw blocked('MONITOR_PUBLICATION_FAILED');
  }
  try { if (fs.lstatSync(requested).isSymbolicLink()) throw blocked('MONITOR_PUBLICATION_FAILED'); }
  catch (error) { if (error.code!=='ENOENT') throw blocked('MONITOR_PUBLICATION_FAILED'); }
  file=requested;
  const lock=file+'.observer.lock', token=randomUUID();
  let handle;
  try {
    handle=fs.openSync(lock,'wx',0o600);
    fs.writeFileSync(handle,JSON.stringify({ token, pid:process.pid, project:PROJECT, createdAtUtc:new Date().toISOString() }));
    fs.closeSync(handle); handle=undefined;
  } catch (error) {
    if (handle!==undefined) { fs.closeSync(handle); fs.unlinkSync(lock); }
    throw blocked(error.code==='EEXIST'?'OBSERVER_ALREADY_RUNNING':'MONITOR_PUBLICATION_FAILED');
  }
  return { file,
    write(sample) {
      const temporary=path.join(directory,`.monitor-${token}-${randomUUID()}.tmp`);
      try {
        const fd=fs.openSync(temporary,'wx',0o600);
        try { fs.writeFileSync(fd,JSON.stringify(sample)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(temporary,file); // Same-directory atomic replacement; no partial record exposed.
      } catch {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        throw blocked('MONITOR_PUBLICATION_FAILED');
      }
    },
    close() { if (JSON.parse(fs.readFileSync(lock,'utf8')).token!==token) throw blocked('MONITOR_PUBLICATION_FAILED'); fs.unlinkSync(lock); }
  };
}

function wait(ms,signal) {
  return new Promise(resolve=>{
    if (signal?.aborted) { resolve(); return; }
    const end=()=>{ clearTimeout(timer); signal?.removeEventListener('abort',end); resolve(); };
    const timer=setTimeout(end,ms); signal?.addEventListener('abort',end,{ once:true });
  });
}

async function observe({ env=process.env, output, signal, once=false, maxSamples=Infinity,
  factory=config=>new Client(config), health=()=>readHealth(env.PAYMENT_PG_OBSERVER_HEALTH_FILE),
  pause=wait, now=Date.now, emit=console.log, tlsCheck=verifyClientTls }={}) {
  let client, failed=false, samples=0, asynchronousError;
  const state={};
  try {
    const config=connectionConfiguration(env);
    if (signal?.aborted) throw blocked('OBSERVER_OWNER_INTERRUPTED');
    client=factory(config);
    client.on('error',error=>{ asynchronousError=error; });
    await client.connect();
    try { tlsCheck(client,HOST); } catch { throw blocked('OBSERVER_TLS_FAILED'); }
    verifyObserverIdentity((await client.query(identitySql)).rows[0]);
    while (!signal?.aborted && samples<maxSamples) {
      if (asynchronousError) throw asynchronousError;
      const started=now();
      const row=(await client.query(sampleSql)).rows[0];
      if (signal?.aborted) throw blocked('OBSERVER_OWNER_INTERRUPTED');
      if (asynchronousError) throw asynchronousError;
      let observedHealth;
      try { observedHealth=health(); } catch { observedHealth=null; }
      const sample=record(row,observedHealth,state,now());
      output.write(sample); samples++;
      emit(JSON.stringify({ status:'OBSERVING', samples, timestampMs:sample.timestampMs,
        poolerMetrics:'UNKNOWN', database_mutations:'NONE' }));
      if (once) break;
      await pause(Math.max(0,2000-(now()-started)),signal);
    }
    if (signal?.aborted) throw blocked('OBSERVER_OWNER_INTERRUPTED');
  } catch (error) {
    failed=true; const reason=safeReason(error);
    try { output.write(error.sample ? { ...error.sample, status:'BLOCKED', reason } : failureRecord(reason,now())); }
    catch { emit('MONITOR_PUBLICATION_FAILED'); }
    emit(JSON.stringify({ status:'BLOCKED', reason, database_mutations:'NONE' }));
  } finally {
    if (client) {
      try { await client.end(); } catch {
        failed=true;
        try { output.write(failureRecord('OBSERVER_DATABASE_FAILED',now())); } catch { emit('MONITOR_PUBLICATION_FAILED'); }
        emit('OBSERVER_DISCONNECT_FAILED');
      }
    }
    if (!failed) output.write(failureRecord('OBSERVER_STOPPED',now()));
  }
  return { ok:!failed, samples };
}

function signalControl(owner=process) {
  const controller=new AbortController();
  const interrupt=()=>controller.abort();
  owner.on('SIGINT',interrupt); owner.on('SIGTERM',interrupt);
  return { signal:controller.signal, dispose() {
    owner.removeListener('SIGINT',interrupt); owner.removeListener('SIGTERM',interrupt);
  } };
}

async function main() {
  const output=publisher(process.env.PAYMENT_PG_TEST_MONITOR_FILE || defaultFile);
  const controls=signalControl(process);
  try {
    console.log(`MONITOR_FILE=${output.file}`); // A non-secret local path only.
    const result=await observe({ output, signal:controls.signal, once:process.argv.includes('--once') });
    if (!result.ok) process.exitCode=2;
  } finally {
    controls.dispose();
    output.close();
  }
}

module.exports={ identitySql, sampleSql, connectionConfiguration, verifyObserverIdentity, verifyHealth,
  record, failureRecord, publisher, observe, signalControl, safeReason };
if (require.main===module) main().catch(()=>{ console.error('OBSERVER_BLOCKED: sanitized startup/publication failure.'); process.exitCode=2; });
