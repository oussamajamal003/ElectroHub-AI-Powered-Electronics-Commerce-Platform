'use strict';
const dns = require('node:dns/promises');
const net = require('node:net');
const tls = require('node:tls');
const { createClient, verifyIsolatedTarget, validateConfiguration } = require('./payment-concurrency-integration-suite.cjs');
const project = 'pzxekjybdiulzmssalfo';
const schema = 'electrohub_payment_concurrency_20261012';
const role = 'eh_payment_concurrency_runner';
const stages = new Set(['configuration', 'dns_resolution', 'tcp_connectivity', 'postgres_connect',
  'begin_read_only', 'role_identity', 'schema_search_path', 'database_reserve', 'role_permissions',
  'public_relation_permissions', 'public_sequence_permissions', 'security_definer_permissions',
  'schema_marker_emptiness', 'tls_evidence', 'commit', 'disconnect',
  ...['users', 'carts', 'cart_items', 'payment_attempts', 'payment_attempt_items', 'payment_work',
    'orders', 'payments', 'order_items', 'stripe_events'].map(name => `denial_${name}`)]);
function diagnostic(stage, error) {
  const code = error?.code;
  const labels = {
    ENOTFOUND: 'DNS_NOT_FOUND', EAI_AGAIN: 'DNS_TEMPORARY_FAILURE',
    ECONNREFUSED: 'TCP_REFUSED', ETIMEDOUT: 'CONNECTION_TIMEOUT', ECONNRESET: 'CONNECTION_RESET',
    CERT_HAS_EXPIRED: 'TLS_CERTIFICATE_EXPIRED', ERR_TLS_CERT_ALTNAME_INVALID: 'TLS_HOSTNAME_MISMATCH',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS_UNTRUSTED_CERTIFICATE', SELF_SIGNED_CERT_IN_CHAIN: 'TLS_UNTRUSTED_CHAIN',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS_CHAIN_UNVERIFIED', UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'TLS_ISSUER_UNTRUSTED',
    '28P01': 'POSTGRES_AUTHENTICATION_REJECTED', '28000': 'POSTGRES_AUTHORIZATION_REJECTED',
    '53300': 'POOL_OR_DATABASE_CONNECTION_LIMIT', '57P03': 'DATABASE_UNAVAILABLE',
    '42501': 'SQL_PERMISSION_DENIED', '42809': 'SQL_OBJECT_TYPE_MISMATCH',
    '25P02': 'SQL_TRANSACTION_ABORTED', '42704': 'SQL_OBJECT_MISSING', '42P01': 'SQL_RELATION_MISSING',
    '42601': 'SQL_SYNTAX_ERROR', '42703': 'SQL_COLUMN_MISSING', '57014': 'SQL_QUERY_CANCELED',
  };
  let label = labels[code] ?? 'UNEXPECTED_VERIFIER_EXCEPTION';
  if (stage === 'postgres_connect' && !labels[code] && /timeout|timed out/i.test(String(error?.message ?? ''))) label = 'CONNECTION_TIMEOUT';
  if (stage === 'postgres_connect' && !labels[code] && /connection terminated|connection closed/i.test(String(error?.message ?? ''))) label = 'CONNECTION_TERMINATED';
  // Inspect only for a known pooler response; never forward its message.
  if (!labels[code] && /tenant or user not found|supavisor|pooler/i.test(String(error?.message ?? ''))) label = 'POOLER_REJECTED';
  if (stage === 'configuration' && !labels[code]) label = 'CONFIGURATION_REJECTED';
  if (label === 'UNEXPECTED_VERIFIER_EXCEPTION') {
    const stageLabels = { role_identity: 'ROLE_IDENTITY_VERIFICATION_FAILED',
      schema_search_path: 'SCHEMA_SEARCH_PATH_VERIFICATION_FAILED',
      database_reserve: 'DATABASE_RESERVE_VERIFICATION_FAILED', role_permissions: 'ROLE_PERMISSIONS_VERIFICATION_FAILED',
      public_relation_permissions: 'PUBLIC_RELATION_VERIFICATION_FAILED',
      public_sequence_permissions: 'PUBLIC_SEQUENCE_VERIFICATION_FAILED',
      security_definer_permissions: 'SECURITY_DEFINER_VERIFICATION_FAILED',
      schema_marker_emptiness: 'SCHEMA_MARKER_EMPTINESS_VERIFICATION_FAILED', tls_evidence: 'TLS_EVIDENCE_MISSING' };
    label = stageLabels[stage] ?? label;
    if (stages.has(stage) && stage.startsWith('denial_')) label = 'PUBLIC_ACCESS_DENIAL_VERIFICATION_FAILED';
  }
  const sqlStates = new Set(['28P01', '28000', '53300', '57P03', '42501', '42809', '25P02', '42704', '42P01', '42601', '42703', '57014']);
  const result = { status: 'BLOCKED', stage: stages.has(stage) ? stage : 'unexpected_stage',
    label, sqlstate: sqlStates.has(code) ? code : null, database_mutations: 'NONE' };
  if (stage === 'schema_search_path' && error?.safeChecks) {
    result.checks = {};
    for (const key of ['schema_matches', 'search_path_matches', 'explicit_schemas_is_array', 'explicit_schemas_matches']) {
      if (typeof error.safeChecks[key] === 'boolean') result.checks[key] = error.safeChecks[key];
    }
  }
  return result;
}
async function tcpCheck(host) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: 5432 });
    socket.setTimeout(5000);
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('error', error => { socket.destroy(); reject(error); });
    socket.once('timeout', () => { socket.destroy(); const error = new Error(); error.code = 'ETIMEDOUT'; reject(error); });
  });
}
async function check({ emit = console.log, lookup = dns.lookup, tcp = tcpCheck, factory = createClient,
  validate = validateConfiguration, verify = verifyIsolatedTarget, env = process.env } = {}) {
  let stage = 'configuration';
  let client;
  let failed;
  Object.assign(env, { PAYMENT_PG_TEST_TARGET: 'dev-isolated-schema', PAYMENT_PG_TEST_PROJECT_REF: project,
    PAYMENT_PG_TEST_SCHEMA: schema, PAYMENT_PG_TEST_ROLE: role,
    PAYMENT_PG_TEST_SCOPE_AUTHORIZATION: `DEV:${project}:${schema}:${role}:migrate-deploy+fixtures+scenarios-A-J+drop` });
  emit(`TEST_SECRET_PRESENT=${Boolean(env.PAYMENT_PG_TEST_DATABASE_URL)}`);
  try {
    if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error();
    if (validate(false)) throw new Error();
    const url = new URL(env.PAYMENT_PG_TEST_DATABASE_URL);
    if (url.hostname !== 'aws-0-ap-northeast-2.pooler.supabase.com') throw new Error();
    stage = 'dns_resolution'; await lookup(url.hostname);
    stage = 'tcp_connectivity'; await tcp(url.hostname);
    stage = 'postgres_connect'; client = factory(url.toString()); await client.connect();
    stage = 'begin_read_only'; await client.query('BEGIN READ ONLY');
    await verify(client, { transactional: true, onStage: next => { stage = next; } });
    stage = 'tls_evidence';
    verifyClientTls(client, url.hostname);
    stage = 'commit'; await client.query('COMMIT');
  } catch (error) { failed = diagnostic(stage, error); }
  finally {
    if (client) try { await client.end(); } catch (error) { failed ??= diagnostic('disconnect', error); }
  }
  if (failed) { emit(JSON.stringify(failed)); return false; }
  emit('READ-ONLY PASS: restricted identity/schema, marker/emptiness, ten 42501 probes and public ACL checks.');
  emit('TLS PASS: Node-to-pooler socket encrypted, certificate authorized and exact hostname verified. Pooler-to-database TLS not assessed; Supavisor capacity UNKNOWN.');
  return true;
}
function verifyClientTls(client, hostname) {
  const socket = client.connection?.stream;
  if (!socket?.encrypted || socket.authorized !== true || socket.authorizationError ||
      client.connectionParameters?.ssl?.rejectUnauthorized !== true ||
      typeof socket.getPeerCertificate !== 'function') throw new Error('Client TLS evidence missing.');
  const certificate = socket.getPeerCertificate();
  if (!certificate?.raw || tls.checkServerIdentity(hostname, certificate)) throw new Error('Client hostname evidence missing.');
}
module.exports = { check, diagnostic, verifyClientTls };
if (require.main === module) check().then(ok => { if (!ok) process.exitCode = 1; }).catch(() => {
  console.error(JSON.stringify(diagnostic('configuration', {}))); process.exitCode = 1;
});
