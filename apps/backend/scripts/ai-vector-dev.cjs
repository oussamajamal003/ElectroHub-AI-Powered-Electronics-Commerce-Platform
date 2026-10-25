#!/usr/bin/env node
/**
 * Task 04.2 operator helper for the SHARED DEV Supabase project. Runs only when AI_VECTOR_DEV_APPROVED equals the project ref
 * found in apps/backend/.env DATABASE_URL, and always refuses the PROD project. Never prints passwords or connection strings.
 *
 *   AI_VECTOR_DEV_APPROVED=pzxekjybdiulzmssalfo node scripts/ai-vector-dev.cjs check     read-only: extension, objects, grants
 *   AI_VECTOR_DEV_APPROVED=pzxekjybdiulzmssalfo node scripts/ai-vector-dev.cjs roles     enable LOGIN for the two AI roles with
 *                                                                                     generated passwords (git-ignored .ai-vector/dev.json)
 *   AI_VECTOR_DEV_APPROVED=pzxekjybdiulzmssalfo node scripts/ai-vector-dev.cjs ai-service | backend-readonly
 *                                                                                     DEV smoke runners: FastAPI :8100 (read-only role) and
 *                                                                                     read-only Express :5300 (no payments/email) wired to it
 *   AI_VECTOR_DEV_APPROVED=pzxekjybdiulzmssalfo node scripts/ai-vector-dev.cjs exec -- <command...>
 *                                                                                     run a command with AI_VECTOR_*_DATABASE_URL set
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const { Client } = require('pg');

const PROD_REF = 'yepfgjehdstlxbpespun';
const backend = path.resolve(__dirname, '..');
const stateFile = path.join(backend, '.ai-vector', 'dev.json');
const fail = message => { console.error(`ai-vector-dev: ${message}`); process.exit(1); };

const env = { ...dotenv.parse(fs.readFileSync(path.join(backend, '.env'))),
  ...(fs.existsSync(path.join(backend, '.env.local')) ? dotenv.parse(fs.readFileSync(path.join(backend, '.env.local'))) : {}) };
const admin = new URL(env.DIRECT_URL || env.DATABASE_URL);
const ref = decodeURIComponent(admin.username).split('.')[1];
if (!ref || ref === PROD_REF) fail('refusing: target is not an identifiable non-production Supabase project.');
if (process.env.AI_VECTOR_DEV_APPROVED !== ref) fail(`refusing: set AI_VECTOR_DEV_APPROVED to the approved DEV project ref.`);

const tls = { rejectUnauthorized: false }; // Supabase pooler certificate; the URL itself is the identity-checked target
async function withClient(run) {
  const client = new Client({ connectionString: admin.toString(), ssl: tls });
  await client.connect();
  try { return await run(client); } finally { await client.end(); }
}
const withTls = url => { const copy = new URL(url.toString()); copy.search = '?sslmode=require'; return copy.toString(); };
const roleDsn = (role, password) => {
  const url = new URL(admin.toString());
  url.username = `${role}.${ref}`;
  url.password = password;
  url.search = '?sslmode=require';
  return url.toString();
};

async function check() {
  await withClient(async client => {
    await client.query('BEGIN READ ONLY');
    const rows = {
      vector: (await client.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'")).rows[0]?.extversion ?? 'missing',
      tables: (await client.query("SELECT string_agg(table_name, ',' ORDER BY table_name) v FROM information_schema.tables WHERE table_schema = 'ai'")).rows[0].v,
      roles: (await client.query("SELECT string_agg(rolname || ':' || rolcanlogin, ',' ORDER BY rolname) v FROM pg_roles WHERE rolname LIKE 'ai_vector%'")).rows[0].v,
      anonOnAi: (await client.query("SELECT has_schema_privilege('anon', 'ai', 'USAGE') v")).rows[0].v,
      authenticatedOnAi: (await client.query("SELECT has_schema_privilege('authenticated', 'ai', 'USAGE') v")).rows[0].v,
      readerOnUsers: (await client.query("SELECT has_table_privilege('ai_vector_reader', 'public.users', 'SELECT') v")).rows[0].v,
      ingestOnProducts: (await client.query("SELECT has_table_privilege('ai_vector_ingest', 'public.products', 'UPDATE') v")).rows[0].v,
      eligibleImages: (await client.query('SELECT count(*)::int v FROM ai.catalog_images')).rows[0].v,
      active: (await client.query('SELECT embedding_version v FROM ai.active_index')).rows[0]?.v ?? null,
    };
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ project: ref, ...rows }, null, 1));
  });
}

async function roles() {
  const saved = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
  await withClient(async client => {
    for (const role of ['ai_vector_reader', 'ai_vector_ingest']) {
      saved[role] ??= crypto.randomBytes(24).toString('hex');
      await client.query(`ALTER ROLE ${role} LOGIN PASSWORD '${saved[role]}' CONNECTION LIMIT 8`); // hex-only literal
    }
  });
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(saved, null, 2), { mode: 0o600 });
  console.log(`ai-vector-dev: LOGIN enabled for ai_vector_reader and ai_vector_ingest on ${ref}; passwords saved in ${path.relative(backend, stateFile)}.`);
}

function exec(argv) {
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const result = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env,
    AI_VECTOR_DATABASE_URL: roleDsn('ai_vector_reader', saved.ai_vector_reader),
    AI_VECTOR_INGEST_DATABASE_URL: roleDsn('ai_vector_ingest', saved.ai_vector_ingest),
    AI_VECTOR_ADMIN_DATABASE_URL: withTls(admin) } });
  process.exit(result.status ?? 1);
}

/** A DEV smoke key shared by the two read-only runners below (never the developer's own .env key). */
function smokeKey() {
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (!saved.smokeKey) {
    saved.smokeKey = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(stateFile, JSON.stringify(saved, null, 2), { mode: 0o600 });
  }
  return saved.smokeKey;
}
const SMOKE_AI_PORT = 8100;

/** DEV FastAPI on 127.0.0.1:8100 with the trained artifact and the READ-ONLY vector role; nothing from apps/ai-service/.env. */
function aiService() {
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const service = path.resolve(backend, '../ai-service');
  const clean = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(AI_|KAGGLE_|DATABASE_URL|DIRECT_URL|STRIPE_|BREVO_|JWT_)/.test(name)));
  const result = spawnSync(path.join(service, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), ['-m', 'app'], {
    cwd: service, stdio: 'inherit',
    env: { ...clean, AI_ENV_FILE: path.join(path.dirname(stateFile), 'no-ai-env-file'), AI_ENVIRONMENT: 'development',
      AI_SERVICE_API_KEY: smokeKey(), AI_BIND_HOST: '127.0.0.1', AI_PORT: String(SMOKE_AI_PORT),
      AI_MODEL_ARTIFACT_DIR: path.join(service, 'models', 'effb0-commons-v2'),
      AI_VECTOR_DATABASE_URL: roleDsn('ai_vector_reader', saved.ai_vector_reader) } });
  process.exit(result.status ?? 1);
}

/** Read-only DEV Express on :5300 (payment recovery off, Stripe/Brevo blank, email dispatch off) wired to that AI service. */
function backendReadOnly() {
  const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'src/bootstrap.ts'], { cwd: backend, stdio: 'inherit',
    shell: process.platform === 'win32', env: { ...process.env, PORT: '5300', NODE_ENV: 'development', PAYMENT_INPROCESS_RECOVERY: 'false',
      STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', BREVO_API_KEY: '', COMMERCE_EMAIL_DISPATCH_ENABLED: 'false',
      AI_SERVICE_URL: `http://127.0.0.1:${SMOKE_AI_PORT}`, AI_SERVICE_API_KEY: smokeKey(), AI_SERVICE_ENVIRONMENT: 'development' } });
  process.exit(result.status ?? 1);
}

const command = process.argv[2];
if (command === 'ai-service') aiService();
else if (command === 'backend-readonly') backendReadOnly();
else if (command === 'check') check().catch(error => fail(error.code || 'check failed'));
else if (command === 'roles') roles().catch(error => fail(error.code || 'roles failed'));
else if (command === 'exec' && process.argv[3] === '--') exec(process.argv.slice(4));
else fail('usage: check | roles | exec -- <command...> | ai-service | backend-readonly');
