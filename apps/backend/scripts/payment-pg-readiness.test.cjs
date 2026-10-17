'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { check, diagnostic, verifyClientTls } = require('./payment-pg-readiness.cjs');
const { verifyIsolatedTarget } = require('./payment-concurrency-integration-suite.cjs');
const role = 'eh_payment_concurrency_runner';
const schema = 'electrohub_payment_concurrency_20261012';
const project = 'pzxekjybdiulzmssalfo';
const scope = `DEV:${project}:${schema}:${role}:migrate-deploy+fixtures+scenarios-A-J+drop`;
const secret = 'never_emit_password_or_url';
describe('readiness sanitized diagnostics', () => {
  it('requires actual authorized client TLS and matching peer hostname', () => {
    const { X509Certificate } = require('node:crypto');
    const path = require('node:path');
    const certificate = new X509Certificate(fs.readFileSync(path.join(__dirname, '../prisma/supabase-ca.pem'))).toLegacyObject();
    const client = { connectionParameters: { ssl: { rejectUnauthorized: true } },
      connection: { stream: { encrypted: true, authorized: true, getPeerCertificate: () => certificate } } };
    assert.doesNotThrow(() => verifyClientTls(client, 'aws-0-ap-northeast-2.pooler.supabase.com'));
    assert.throws(() => verifyClientTls(client, 'wrong.example.com'));
    client.connection.stream.authorized = false;
    assert.throws(() => verifyClientTls(client, 'aws-0-ap-northeast-2.pooler.supabase.com'));
    client.connection.stream.authorized = true;
    client.connection.stream.encrypted = false;
    assert.throws(() => verifyClientTls(client, 'aws-0-ap-northeast-2.pooler.supabase.com'));
  });
  it('parses schema text arrays instead of unsupported PostgreSQL name arrays', () => {
    const types = require('pg').types;
    assert.equal(typeof types.getTypeParser(1003)(`{${schema}}`), 'string');
    assert.deepEqual(types.getTypeParser(1009)(`{${schema}}`), [schema]);
    const source = fs.readFileSync(require.resolve('./payment-concurrency-integration-suite.cjs'), 'utf8');
    assert.match(source, /current_schemas\(false\)::text\[\]/);
  });
  it('emits only boolean isolation comparisons and fixed connection labels', () => {
    const result = diagnostic('schema_search_path', { message: secret,
      safeChecks: { schema_matches: true, search_path_matches: false, explicit_schemas_matches: secret, injected: secret } });
    assert.deepEqual(result.checks, { schema_matches: true, search_path_matches: false });
    assert.doesNotMatch(JSON.stringify(result), /never_emit/);
    assert.equal(diagnostic('postgres_connect', { message: `timeout expired ${secret}` }).label, 'CONNECTION_TIMEOUT');
  });
  it('classifies failures without forwarding exception fields', () => {
    for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'SELF_SIGNED_CERT_IN_CHAIN', '28P01', '42501', '42809', '25P02', secret]) {
      const result = diagnostic('postgres_connect', { code, message: secret, stack: secret, detail: secret });
      assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
      assert.equal(result.stage, 'postgres_connect');
    }
    assert.equal(diagnostic('postgres_connect', { message: `Tenant or user not found ${secret}` }).label, 'POOLER_REJECTED');
    assert.equal(diagnostic(secret, {}).stage, 'unexpected_stage');
  });
  it('reports DNS stage, never echoes the authenticated target', async () => {
    const output = [];
    const ok = await check({ env: { PAYMENT_PG_TEST_DATABASE_URL: `postgresql://${role}.${project}:${secret}@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres` },
      emit: line => output.push(line), validate: () => null,
      lookup: async () => { throw Object.assign(new Error(secret), { code: 'ENOTFOUND' }); },
      factory: () => { throw new Error('must not connect'); } });
    assert.equal(ok, false);
    assert.match(output.join('\n'), /DNS_NOT_FOUND/);
    assert.doesNotMatch(output.join('\n'), /never_emit|postgresql:\/\//);
  });
  it('reports verifier stage and SQLSTATE without raw messages', async () => {
    const output = [];
    const env = { PAYMENT_PG_TEST_DATABASE_URL: `postgresql://${role}.${project}:${secret}@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres` };
    await check({ env, emit: line => output.push(line), validate: () => null, lookup: async () => {}, tcp: async () => {},
      factory: () => ({ connect: async () => {}, end: async () => {}, query: async () => ({ rows: [] }) }),
      verify: async (_client, options) => { options.onStage('public_sequence_permissions'); throw Object.assign(new Error(secret), { code: '42809' }); } });
    assert.match(output.join('\n'), /public_sequence_permissions.*SQL_OBJECT_TYPE_MISMATCH.*42809/);
    assert.doesNotMatch(output.join('\n'), /never_emit|postgresql:\/\//);
    assert.equal(env.PAYMENT_PG_TEST_APPROVED, undefined);
  });
  it('rolls back every expected denial to its savepoint before the next query', async () => {
    let aborted = false;
    let probes = 0;
    let rollbacks = 0;
    const client = { query: async sql => {
      if (sql === 'ROLLBACK TO SAVEPOINT denial_probe') { aborted = false; rollbacks++; return { rows: [] }; }
      if (aborted) throw Object.assign(new Error(), { code: '25P02' });
      if (sql.startsWith('SELECT * FROM public.')) { probes++; aborted = true; throw Object.assign(new Error(), { code: '42501' }); }
      if (sql.includes('current_database() AS db')) return { rows: [{ db: 'postgres', role, session_role: role, schema, search_path: schema, explicit_schemas: [schema], current_connections: 10, max_connections: 60 }] };
      if (sql.includes('FROM pg_roles r')) return { rows: [{ rolcanlogin: true, rolconnlimit: 4, membership_count: 0, out_of_scope_schema_create: 0 }] };
      if (sql.includes('AS selectable')) return { rows: [{ selectable: 0, writable: 0 }] };
      if (sql.includes('AS privileged')) return { rows: [{ privileged: 0 }] };
      if (sql.includes('AS executable')) return { rows: [{ executable: 0 }] };
      if (sql.includes('AS marker')) return { rows: [{ owner: role, marker: scope, relation_count: 0, function_count: 0, standalone_type_count: 0 }] };
      return { rows: [] };
    } };
    await verifyIsolatedTarget(client, { transactional: true });
    assert.equal(probes, 10); assert.equal(rollbacks, 10); assert.equal(aborted, false);
  });
});
