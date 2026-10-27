#!/usr/bin/env node
/**
 * Task 04.2 operator helper for the DISPOSABLE pgvector QA cluster only (ISOLATED_PG_DOCKER=1 state in apps/backend/.isolated-docker).
 *
 *   node scripts/ai-vector-qa.cjs roles    enable LOGIN for ai_vector_reader / ai_vector_ingest with generated passwords (saved, 0600,
 *                                          in .isolated-docker/ai-vector-roles.json) and print the DSN *variable names* to use
 *   node scripts/ai-vector-qa.cjs verify   least-privilege checks: every forbidden statement must fail and every allowed one succeed
 *   node scripts/ai-vector-qa.cjs ai-service <artifact-dir> [relevance-dir]
 *                                          run a QA FastAPI on 127.0.0.1:8200 (environment `qa`, its own generated key, the READ-ONLY
 *                                          vector role, no inherited apps/ai-service/.env)
 *   node scripts/ai-vector-qa.cjs backend  run `dev-isolated.cjs backend` (:5200) wired to that QA AI service
 *
 * Passwords and DSNs are never printed. Refuses any target other than the launcher-verified disposable cluster.
 */
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { disposableUrlIssue } = require('./dev-isolated.cjs');

const backend = path.resolve(__dirname, '..');
const home = path.join(backend, '.isolated-docker');
const rolesFile = path.join(home, 'ai-vector-roles.json');
const fail = message => { console.error(`ai-vector-qa: ${message}`); process.exit(1); };
if (process.env.ISOLATED_PG_DOCKER !== '1') fail('set ISOLATED_PG_DOCKER=1 (pgvector QA cluster only).');
if (!process.env.PG_BIN) fail('set PG_BIN to the PostgreSQL 17 client directory.');
const env = JSON.parse(fs.readFileSync(path.join(home, 'env.json'), 'utf8'));
const adminPassword = fs.readFileSync(path.join(home, 'password.txt'), 'utf8').trim();
const issue = disposableUrlIssue(env.DATABASE_URL, adminPassword);
if (issue) fail(issue);
const target = new URL(env.DATABASE_URL);

function psql(user, password, sql) {
  const file = path.join(process.env.PG_BIN, process.platform === 'win32' ? 'psql.exe' : 'psql');
  return execFileSync(file, ['-h', 'localhost', '-p', target.port, '-U', user, '-d', 'electrohub_disposable', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
    { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, PGPASSWORD: password, PGSSLMODE: 'verify-full', PGSSLROOTCERT: env.DB_SSL_CA_CERT_PATH } }).trim();
}
// libpq on Windows cannot open file paths with non-ASCII characters (the repository path has an em dash), so the launcher's
// CA certificate is copied to an ASCII-only per-user location for the Python/psycopg clients.
function asciiCaPath() {
  const dir = path.join(os.homedir(), '.electrohub-isolated');
  fs.mkdirSync(dir, { recursive: true });
  const copy = path.join(dir, 'ca.crt');
  fs.copyFileSync(env.DB_SSL_CA_CERT_PATH, copy);
  if (!/^[\x20-\x7e]+$/.test(copy)) fail('the per-user certificate path is not ASCII.');
  return copy.replace(/\\/g, '/');
}
const dsn = (user, password) => `postgresql://${user}:${password}@localhost:${target.port}/electrohub_disposable?sslmode=verify-full&sslrootcert=${encodeURIComponent(asciiCaPath())}`;

function roles() {
  const saved = fs.existsSync(rolesFile) ? JSON.parse(fs.readFileSync(rolesFile, 'utf8')) : {};
  for (const role of ['ai_vector_reader', 'ai_vector_ingest']) {
    saved[role] ??= crypto.randomBytes(24).toString('hex');
    // Hex-only passwords cannot break out of the literal.
    psql('postgres', adminPassword, `ALTER ROLE ${role} LOGIN PASSWORD '${saved[role]}' CONNECTION LIMIT 8`);
  }
  saved.dsn = { AI_VECTOR_DATABASE_URL: dsn('ai_vector_reader', saved.ai_vector_reader),
    AI_VECTOR_INGEST_DATABASE_URL: dsn('ai_vector_ingest', saved.ai_vector_ingest),
    AI_VECTOR_ADMIN_DATABASE_URL: dsn('postgres', adminPassword) };
  fs.writeFileSync(rolesFile, JSON.stringify(saved, null, 2), { mode: 0o600 });
  console.log(`ai-vector-qa: LOGIN enabled for ai_vector_reader and ai_vector_ingest; DSNs saved in ${path.relative(backend, rolesFile)} ` +
    '(keys AI_VECTOR_DATABASE_URL, AI_VECTOR_INGEST_DATABASE_URL, AI_VECTOR_ADMIN_DATABASE_URL).');
}

function verify() {
  const saved = JSON.parse(fs.readFileSync(rolesFile, 'utf8'));
  const checks = [
    // [role, statement, expected]
    ['ai_vector_reader', 'SELECT count(*) FROM ai.product_image_embeddings', 'allow'],
    ['ai_vector_reader', 'SELECT embedding_version FROM ai.active_index', 'allow'],
    ['ai_vector_reader', 'SELECT count(*) FROM public.users', 'deny'],
    ['ai_vector_reader', 'SELECT count(*) FROM public.orders', 'deny'],
    ['ai_vector_reader', 'SELECT count(*) FROM public.payment_attempts', 'deny'],
    ['ai_vector_reader', 'SELECT count(*) FROM public.products', 'deny'],
    ['ai_vector_reader', 'SELECT count(*) FROM ai.catalog_images', 'deny'],
    ['ai_vector_reader', "DELETE FROM ai.product_image_embeddings WHERE false", 'deny'],
    ['ai_vector_reader', "UPDATE ai.active_index SET embedding_version = embedding_version", 'deny'],
    ['ai_vector_reader', 'CREATE TABLE ai.reader_probe (id int)', 'deny'],
    ['ai_vector_reader', 'CREATE TABLE public.reader_probe (id int)', 'deny'],
    ['ai_vector_ingest', 'SELECT count(*) FROM ai.catalog_images', 'allow'],
    ['ai_vector_ingest', 'SELECT count(*) FROM public.products', 'deny'],
    ['ai_vector_ingest', 'SELECT count(*) FROM public.users', 'deny'],
    ['ai_vector_ingest', "UPDATE public.products SET name = name WHERE false", 'deny'],
    ['ai_vector_ingest', "UPDATE ai.model_versions SET status = 'ACTIVE' WHERE false", 'deny'],
    ['ai_vector_ingest', 'UPDATE ai.product_image_embeddings SET image_sha256 = image_sha256 WHERE embedding_version = (SELECT embedding_version FROM ai.active_index)', 'deny'],
    ['ai_vector_ingest', 'DELETE FROM ai.product_image_embeddings WHERE embedding_version = (SELECT embedding_version FROM ai.active_index)', 'deny'],
    ['ai_vector_ingest', "INSERT INTO ai.active_index (embedding_version) VALUES ('x')", 'deny'],
    ['ai_vector_ingest', 'CREATE TABLE ai.ingest_probe (id int)', 'deny'],
    ['ai_vector_ingest', 'DROP TABLE ai.product_image_embeddings', 'deny'],
  ];
  let failures = 0;
  for (const [role, sql, expected] of checks) {
    let outcome;
    // Every probe is rolled back even if a forbidden operation unexpectedly succeeds.
    try { psql(role, saved[role], `BEGIN; ${sql}; ROLLBACK;`); outcome = 'allow'; } catch { outcome = 'deny'; }
    const ok = outcome === expected;
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${role.padEnd(17)} expected ${expected.padEnd(5)} got ${outcome.padEnd(5)} ${sql}`);
  }
  console.log(`ai-vector-qa: ${checks.length - failures}/${checks.length} privilege checks passed`);
  if (failures) process.exit(1);
}

const AI_PORT = 8200;
function qaAiKey() {
  const file = path.join(home, 'ai-service.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ key: crypto.randomBytes(32).toString('hex') }), { flag: 'wx', mode: 0o600 });
  return JSON.parse(fs.readFileSync(file, 'utf8')).key;
}

function aiService() {
  const artifact = path.resolve(process.argv[3] ?? '');
  if (!fs.existsSync(path.join(artifact, 'descriptor.json'))) fail('usage: ai-service <artifact-dir containing descriptor.json and model.safetensors>');
  const relevance = process.argv[4] ? path.resolve(process.argv[4]) : '';
  if (relevance && !fs.existsSync(path.join(relevance, 'relevance.json'))) fail('relevance-dir must contain relevance.json and head.safetensors');
  const saved = JSON.parse(fs.readFileSync(rolesFile, 'utf8'));
  const service = path.resolve(backend, '../ai-service');
  // Only what the QA instance needs: no inherited AI_*, KAGGLE_* or commerce values, and no developer .env file.
  const clean = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(AI_|KAGGLE_|DATABASE_URL|DIRECT_URL|STRIPE_|BREVO_|JWT_)/.test(name)));
  const child = require('node:child_process').spawn(path.join(service, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), ['-m', 'app'], {
    cwd: service, stdio: 'inherit',
    env: { ...clean, AI_ENV_FILE: path.join(home, 'no-ai-env-file'), AI_ENVIRONMENT: 'qa', AI_SERVICE_API_KEY: qaAiKey(),
      AI_BIND_HOST: '127.0.0.1', AI_PORT: String(AI_PORT), AI_MODEL_ARTIFACT_DIR: artifact, AI_RELEVANCE_ARTIFACT_DIR: relevance,
      AI_VECTOR_DATABASE_URL: saved.dsn.AI_VECTOR_DATABASE_URL, AI_LOG_LEVEL: 'INFO' },
  });
  child.on('exit', code => process.exit(code ?? 0));
}

function backendWithAi() {
  const child = require('node:child_process').spawn(process.execPath, [path.join(__dirname, 'dev-isolated.cjs'), 'backend', ...process.argv.slice(3)], {
    cwd: backend, stdio: 'inherit',
    env: { ...process.env, ISOLATED_AI_SERVICE_URL: `http://127.0.0.1:${AI_PORT}`, ISOLATED_AI_SERVICE_API_KEY: qaAiKey() },
  });
  child.on('exit', code => process.exit(code ?? 0));
}

({ roles, verify, 'ai-service': aiService, backend: backendWithAi }[process.argv[2]] ?? (() => fail('usage: roles | verify | ai-service <dir> | backend')))();
