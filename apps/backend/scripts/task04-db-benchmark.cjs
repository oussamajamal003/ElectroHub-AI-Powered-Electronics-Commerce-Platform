'use strict';

// Task 04.0 bounded database probe. Only connects to the explicitly configured DIRECT_URL.
// It performs SELECT 1 only, uses one client, and never loads application workers/providers.
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const DEV_PROJECT = 'pzxekjybdiulzmssalfo';
const PROD_PROJECT = 'yepfgjehdstlxbpespun';
const MAX_SAMPLES = 30;
const DEFAULT_SAMPLES = 30;
const SAFE_DRIVER_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);

function blocked(code) { const error = new Error(code); error.code = code; return error; }

function describeTarget(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) throw blocked('DATABASE_TARGET_MISSING');
  let url;
  try { url = new URL(rawUrl); } catch { throw blocked('DATABASE_TARGET_INVALID'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash) {
    throw blocked('DATABASE_TARGET_INVALID');
  }
  const allowed = new Set(['sslmode', 'sslrootcert', 'schema', 'pgbouncer', 'connection_limit', 'pool_timeout', 'connect_timeout']);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw blocked('DATABASE_TARGET_OPTIONS_INVALID');
  }
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode && !['require', 'verify-ca', 'verify-full'].includes(sslmode)) throw blocked('DATABASE_TLS_REQUIRED');
  if (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public') throw blocked('DATABASE_SCHEMA_UNAPPROVED');
  const port = Number(url.port || 5432);
  const database = decodeURIComponent(url.pathname.slice(1));
  const devDirect = url.hostname === `db.${DEV_PROJECT}.supabase.co` && port === 5432 && decodeURIComponent(url.username) === 'postgres';
  const devPooler = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
    decodeURIComponent(url.username) === `postgres.${DEV_PROJECT}` && [5432, 6543].includes(port);
  if ((url.hostname === `db.${PROD_PROJECT}.supabase.co`) || decodeURIComponent(url.username).includes(PROD_PROJECT)) {
    throw blocked('DATABASE_PRODUCTION_FORBIDDEN');
  }
  if (database === 'postgres' && (devDirect || devPooler)) {
    return { category: 'dev', identity: `supabase:${DEV_PROJECT}/postgres`, transport: devDirect ? 'direct' : port === 6543 ? 'transaction-pooler' : 'session-pooler' };
  }
  const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  if (loopback.has(url.hostname) && /^electrohub_(?:disposable|ci)[a-z0-9_]*$/.test(database)) {
    return { category: 'disposable', identity: `loopback:${port}/${database}`, transport: 'local' };
  }
  throw blocked('DATABASE_TARGET_UNAPPROVED');
}

function preflight(environment, options = {}) {
  if (environment.NODE_ENV === 'production') throw blocked('DATABASE_PRODUCTION_FORBIDDEN');
  if (environment.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw blocked('DATABASE_TLS_REQUIRED');
  const source = options.source ?? 'direct';
  if (!['database', 'direct'].includes(source)) throw blocked('DATABASE_RUNTIME_SOURCE_INVALID');
  const databaseTarget = describeTarget(environment.DATABASE_URL);
  const directTarget = describeTarget(environment.DIRECT_URL);
  if (databaseTarget.identity !== directTarget.identity) throw blocked('DATABASE_TARGET_MISMATCH');
  if (databaseTarget.category === 'production' || directTarget.category === 'production') throw blocked('DATABASE_PRODUCTION_FORBIDDEN');
  const configuredUrl = source === 'direct' ? environment.DIRECT_URL : environment.DATABASE_URL;
  const target = describeTarget(configuredUrl);
  if (target.transport === 'transaction-pooler') throw blocked('DATABASE_SESSION_CONNECTION_REQUIRED');
  if (target.category === 'dev' && environment.NODE_ENV === 'test') throw blocked('DATABASE_TEST_TARGET_FORBIDDEN');
  const caPath = environment.DB_SSL_CA_CERT_PATH;
  if (!caPath) throw blocked('DATABASE_CA_REQUIRED');
  const resolvedCaPath = path.resolve(options.backendDir ?? path.resolve(__dirname, '..'), caPath);
  if (!(options.exists ?? fs.existsSync)(resolvedCaPath)) throw blocked('DATABASE_CA_UNAVAILABLE');
  const runtimeUrl = new URL(configuredUrl);
  for (const parameter of ['sslmode', 'sslrootcert', 'pgbouncer']) runtimeUrl.searchParams.delete(parameter);
  const connectionString = runtimeUrl.toString();
  const samples = options.samples ?? DEFAULT_SAMPLES;
  if (!Number.isInteger(samples) || samples < 1 || samples > MAX_SAMPLES) throw blocked('SAMPLE_COUNT_OUT_OF_RANGE');
  return { connectionString, caPath: resolvedCaPath, samples, target, source };
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return Number(sorted[Math.ceil(quantile * sorted.length) - 1].toFixed(2));
}

function summarize(values) {
  return { count: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95) };
}

function safeFailureCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (SAFE_DRIVER_CODES.has(code)) return code;
  if (/^[0-9A-Z]{5}$/.test(code)) return code;
  return 'UNCLASSIFIED';
}

async function runBenchmark({ Pool, connectionString, ca, samples, target }) {
  const connectionOptions = { connectionString, max: 1, min: 0, connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 1000, ssl: { ca, rejectUnauthorized: true } };
  const failures = Object.create(null);
  const recordFailure = error => { const code = safeFailureCode(error); failures[code] = (failures[code] ?? 0) + 1; };
  const coldPool = new Pool(connectionOptions);
  let coldConnectMs = null;
  let coldSelectMs = null;
  try {
    const started = performance.now();
    const client = await coldPool.connect();
    coldConnectMs = Number((performance.now() - started).toFixed(2));
    try {
      const queryStarted = performance.now();
      await client.query('SELECT 1');
      coldSelectMs = Number((performance.now() - queryStarted).toFixed(2));
    } finally { client.release(); }
  } catch (error) {
    recordFailure(error);
    await coldPool.end();
    throw blocked(`BENCHMARK_COLD_CONNECT_FAILED_${safeFailureCode(error)}`);
  }
  await coldPool.end();

  const pool = new Pool(connectionOptions);
  const acquisitionMs = [];
  const warmSelectMs = [];
  let acquisitions = 0;
  let acquisitionErrors = 0;
  let queryErrors = 0;
  let transactionReadOnly = false;
  try {
    for (let index = 0; index < samples; index += 1) {
      let client;
      const acquisitionStarted = performance.now();
      try {
        client = await pool.connect();
        acquisitions += 1;
        acquisitionMs.push(performance.now() - acquisitionStarted);
      } catch (error) {
        acquisitionErrors += 1;
        recordFailure(error);
        continue;
      }
      try {
        const queryStarted = performance.now();
        await client.query('SELECT 1');
        warmSelectMs.push(performance.now() - queryStarted);
      } catch (error) {
        queryErrors += 1;
        recordFailure(error);
      } finally { client.release(); }
    }
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN READ ONLY');
      await client.query('SELECT 1');
      await client.query('ROLLBACK');
      transactionReadOnly = true;
    } catch (error) {
      recordFailure(error);
      if (client) { try { await client.query('ROLLBACK'); } catch (rollbackError) { recordFailure(rollbackError); } }
    } finally { client?.release(); }
  } finally { await pool.end(); }

  return {
    status: Object.keys(failures).length ? 'PARTIAL' : 'PASS',
    target: { category: target.category, transport: target.transport },
    runtimeSource: target.source,
    driver: 'pg', poolMax: 1, warmSampleLimit: MAX_SAMPLES,
    cold: { connectMs: coldConnectMs, select1Ms: coldSelectMs },
    warm: { select1: summarize(warmSelectMs), poolAcquisition: summarize(acquisitionMs) },
    acquisitionCounts: { attempted: samples, acquired: acquisitions, errors: acquisitionErrors },
    queryErrors, readOnlyTransaction: transactionReadOnly,
    errorCounts: failures,
  };
}

function parseArgs(argv) {
  const args = { samples: DEFAULT_SAMPLES, source: 'direct' };
  let sourceSeen = false;
  for (const argument of argv) {
    if (argument === '--help') return { help: true };
    const match = /^--samples=(\d+)$/.exec(argument);
    const sourceMatch = /^--source=(database|direct)$/.exec(argument);
    if (match && !args.explicitSamples) {
      args.samples = Number(match[1]);
      args.explicitSamples = true;
    } else if (sourceMatch && !sourceSeen) {
      args.source = sourceMatch[1];
      sourceSeen = true;
    } else throw blocked('INVALID_ARGUMENTS');
  }
  delete args.explicitSamples;
  if (args.samples < 1 || args.samples > MAX_SAMPLES) throw blocked('SAMPLE_COUNT_OUT_OF_RANGE');
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('Usage: node scripts/task04-db-benchmark.cjs [--source=direct|database] [--samples=1..30]');
    return 0;
  }
  let config;
  try {
    // Reuse the built application's authoritative dotenv precedence and validation.
    config = require('../dist/config/env.js').env;
  } catch {
    throw blocked('BACKEND_BUILD_OR_ENVIRONMENT_INVALID');
  }
  const checked = preflight({ ...process.env, ...config }, { samples: args.samples, source: args.source, backendDir: path.resolve(__dirname, '..') });
  const { Pool } = require('pg');
  const ca = fs.readFileSync(checked.caPath, 'utf8');
  const result = await runBenchmark({ Pool, connectionString: checked.connectionString, ca, samples: checked.samples,
    target: { ...checked.target, source: checked.source } });
  console.log(JSON.stringify({ ...result, node: process.version }, null, 2));
  return result.status === 'PASS' ? 0 : 1;
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(`Database benchmark refused or failed: ${error.code ?? 'BENCHMARK_FAILED'}`);
    process.exitCode = 1;
  });
}

module.exports = { describeTarget, preflight, percentile, summarize, safeFailureCode, runBenchmark, parseArgs, main, MAX_SAMPLES };
