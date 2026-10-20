'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { describeTarget, preflight, percentile, summarize, safeFailureCode, runBenchmark, parseArgs, MAX_SAMPLES } = require('./task04-db-benchmark.cjs');

const devProject = 'pzxekjybdiulzmssalfo';
const devUrl = `postgresql://postgres.${devProject}:secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require`;
const transactionUrl = `postgresql://postgres.${devProject}:secret@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require`;
const localUrl = 'postgresql://postgres:secret@127.0.0.1:55434/electrohub_disposable';
const env = (patch = {}) => ({ NODE_ENV: 'development', DATABASE_URL: transactionUrl, DIRECT_URL: devUrl,
  DB_SSL_CA_CERT_PATH: 'certs/dev-ca.crt', ...patch });

test('accepts only exact DEV or loopback disposable identities and refuses production', () => {
  assert.deepEqual(describeTarget(devUrl), { category: 'dev', identity: `supabase:${devProject}/postgres`, transport: 'session-pooler' });
  assert.deepEqual(describeTarget(localUrl), { category: 'disposable', identity: 'loopback:55434/electrohub_disposable', transport: 'local' });
  assert.throws(() => describeTarget(devUrl.replace(devProject, 'yepfgjybdiulzmssalfo')), /DATABASE_PRODUCTION_FORBIDDEN|DATABASE_TARGET_UNAPPROVED/);
  assert.throws(() => describeTarget('postgresql://user:pw@db.attacker.example/postgres'), /DATABASE_TARGET_UNAPPROVED/);
  assert.throws(() => describeTarget(`${devUrl}&schema=private`), /DATABASE_SCHEMA_UNAPPROVED/);
  assert.doesNotThrow(() => describeTarget(`${devUrl}&schema=public`));
});

test('requires DIRECT_URL and verified CA, rejects production, disabled TLS and test-mode DEV', () => {
  const options = { backendDir: 'C:/backend', exists: file => file.endsWith('certs/dev-ca.crt') || file.endsWith('certs\\dev-ca.crt') };
  const checked = preflight(env(), options);
  assert.equal(new URL(checked.connectionString).searchParams.has('sslmode'), false);
  assert.equal(checked.target.transport, 'session-pooler');
  assert.throws(() => preflight(env({ DIRECT_URL: undefined, DATABASE_URL: localUrl }), options), /DATABASE_TARGET_MISSING/);
  assert.throws(() => preflight(env({ DATABASE_URL: localUrl }), options), /DATABASE_TARGET_MISMATCH/);
  assert.throws(() => preflight(env({ DIRECT_URL: `${devUrl}&sslkey=secret` }), options), /DATABASE_TARGET_OPTIONS_INVALID/);
  assert.throws(() => preflight(env({ NODE_ENV: 'production' }), options), /DATABASE_PRODUCTION_FORBIDDEN/);
  assert.throws(() => preflight(env({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }), options), /DATABASE_TLS_REQUIRED/);
  assert.throws(() => preflight(env({ NODE_ENV: 'test' }), options), /DATABASE_TEST_TARGET_FORBIDDEN/);
  assert.throws(() => preflight(env(), { ...options, exists: () => false }), /DATABASE_CA_UNAVAILABLE/);
  assert.throws(() => preflight(env(), { ...options, source: 'database' }), /DATABASE_SESSION_CONNECTION_REQUIRED/);
});

test('bounds sample count and reports nearest-rank p50/p95', () => {
  assert.equal(parseArgs(['--samples=30']).samples, MAX_SAMPLES);
  assert.deepEqual(parseArgs(['--source=database', '--samples=2']), { samples: 2, source: 'database' });
  assert.throws(() => parseArgs(['--samples=31']), /SAMPLE_COUNT_OUT_OF_RANGE/);
  assert.throws(() => parseArgs(['--samples=3', '--samples=4']), /INVALID_ARGUMENTS/);
  assert.equal(percentile([4, 1, 3, 2], 0.5), 2);
  assert.deepEqual(summarize([1, 2, 3, 4]), { count: 4, p50Ms: 2, p95Ms: 4 });
  assert.equal(safeFailureCode(new Error('password or host must not be printed')), 'UNCLASSIFIED');
});

test('stops after one cold connection failure without retrying the target', async () => {
  let poolCount = 0;
  class FailingPool {
    constructor() { poolCount += 1; }
    async connect() { const error = new Error('secret host/password hidden'); error.code = 'ENOTFOUND'; throw error; }
    async end() {}
  }
  await assert.rejects(runBenchmark({ Pool: FailingPool, connectionString: devUrl, ca: 'test CA', samples: 30,
    target: { category: 'dev', transport: 'session-pooler', source: 'direct' } }), /BENCHMARK_COLD_CONNECT_FAILED_ENOTFOUND/);
  assert.equal(poolCount, 1);
});

test('uses one connection, measures cold/warm SELECT 1 and a read-only transaction', async () => {
  const poolConfigs = [];
  const statements = [];
  class FakePool {
    constructor(config) { poolConfigs.push(config); }
    async connect() {
      return { query: async sql => { statements.push(sql); return { rows: [{ '?column?': 1 }] }; }, release() {} };
    }
    async end() {}
  }
  const result = await runBenchmark({ Pool: FakePool, connectionString: devUrl, ca: 'test CA', samples: 3,
    target: { category: 'dev', transport: 'session-pooler', source: 'direct' } });
  assert.equal(result.status, 'PASS');
  assert.equal(result.runtimeSource, 'direct');
  assert.equal(result.acquisitionCounts.acquired, 3);
  assert.equal(result.warm.select1.count, 3);
  assert.equal(result.readOnlyTransaction, true);
  assert.ok(poolConfigs.every(config => config.max === 1 && config.ssl.rejectUnauthorized === true));
  assert.ok(statements.every(sql => ['SELECT 1', 'BEGIN READ ONLY', 'ROLLBACK'].includes(sql)));
  assert.equal(statements.filter(sql => sql === 'BEGIN READ ONLY').length, 1);
});
