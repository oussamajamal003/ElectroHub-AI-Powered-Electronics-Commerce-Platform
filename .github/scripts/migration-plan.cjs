'use strict';
/**
 * Guard for the DEV migration deployment workflow (.github/workflows/dev-migration.yml).
 *
 *   node .github/scripts/migration-plan.cjs pre    # before `prisma migrate deploy`: read-only, never writes
 *   node .github/scripts/migration-plan.cjs post   # after deploy: read-only
 *
 * `pre` fails closed unless ALL hold:
 *   1. every database URL targets the expected Supabase project ref (and never the production ref);
 *   2. the Prisma ledger has no failed / rolled-back / unfinished row;
 *   3. every applied migration exists in this checkout with an identical SHA-256 (Prisma's checksum);
 *   4. the set of pending migrations (local directory minus applied ledger rows) equals the approved list
 *      exactly, in order, and none sorts before an already-applied migration.
 * All queries run in a READ ONLY transaction. Output contains migration names, the project ref and the server
 * version only: never a URL, host, user or password.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEV_REF = 'pzxekjybdiulzmssalfo';
const PROD_REF = 'yepfgjehdstlxbpespun';
const MIGRATION_NAME = /^\d{14}_[a-z0-9_]+$/;
const PRISMA_SSL_PARAMS = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslaccept', 'pgbouncer', 'connect_timeout'];

/** Extracts the Supabase project ref from a pooled (user `postgres.<ref>`) or direct (`db.<ref>.supabase.co`) URL. */
function parseTarget(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'URL is not parseable' };
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) return { ok: false, reason: 'protocol is not postgres' };
  const user = decodeURIComponent(url.username);
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  const pooled = url.hostname.endsWith('.pooler.supabase.com') ? /^postgres\.([a-z0-9]{20})$/.exec(user) : null;
  const ref = (direct && direct[1]) || (pooled && pooled[1]) || null;
  if (!ref) return { ok: false, reason: 'host is not a recognised Supabase endpoint' };
  return { ok: true, ref, kind: direct ? 'direct' : 'pooler', pgbouncer: url.searchParams.get('pgbouncer') === 'true' };
}

/** Throws unless every URL targets exactly `expectedRef`, `expectedRef` is the DEV project, and PROD never appears. */
function assertTarget(urls, expectedRef) {
  if (expectedRef !== DEV_REF) throw new Error('This workflow is restricted to the DEV project; refusing a different expected ref.');
  for (const [name, value] of Object.entries(urls)) {
    if (!value) throw new Error(`${name} is not set.`);
    if (value.includes(PROD_REF)) throw new Error(`${name} references the production project.`);
    const parsed = parseTarget(value);
    if (!parsed.ok) throw new Error(`${name}: ${parsed.reason}.`);
    if (parsed.ref !== expectedRef) throw new Error(`${name} targets a different project than the approved one.`);
  }
  if (parseTarget(urls.DIRECT_URL).pgbouncer) throw new Error('DIRECT_URL must not be a transaction-pooled (pgbouncer) connection.');
}

/** Lists migration directories with the SHA-256 of their migration.sql bytes (what Prisma stores as checksum). */
function localMigrations(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'migration.sql')))
    .map((entry) => {
      if (!MIGRATION_NAME.test(entry.name)) throw new Error(`Unexpected migration directory name: ${entry.name}`);
      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, entry.name, 'migration.sql'))).digest('hex');
      return { name: entry.name, sha256 };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Compares the local directory with the Prisma ledger. `ledger` rows: {name, checksum, finished, rolledBack}. */
function planMigrations(local, ledger) {
  const problems = [];
  const localByName = new Map(local.map((migration) => [migration.name, migration]));
  const applied = ledger.filter((row) => row.finished && !row.rolledBack);

  for (const row of ledger) {
    if (!row.finished) problems.push(`ledger row ${row.name} is unfinished (failed or in progress)`);
    if (row.rolledBack) problems.push(`ledger row ${row.name} is marked rolled back`);
  }
  for (const row of applied) {
    const match = localByName.get(row.name);
    if (!match) problems.push(`applied migration ${row.name} is missing from this checkout`);
    else if (match.sha256 !== row.checksum) problems.push(`applied migration ${row.name} differs from this checkout (checksum mismatch)`);
  }

  const appliedNames = new Set(applied.map((row) => row.name));
  const pending = local.filter((migration) => !appliedNames.has(migration.name)).map((migration) => migration.name);
  const lastApplied = applied.map((row) => row.name).sort().pop();
  for (const name of pending) {
    if (lastApplied && name < lastApplied) problems.push(`pending migration ${name} sorts before already-applied ${lastApplied}`);
  }
  return { pending, problems };
}

/** Exact, ordered equality between the pending set and the approved list. */
function compareApproved(pending, approved) {
  const problems = [];
  if (approved.length === 0) problems.push('the approved migration list is empty');
  for (const name of approved) if (!MIGRATION_NAME.test(name)) problems.push(`approved entry is not a migration name: ${name}`);
  if (new Set(approved).size !== approved.length) problems.push('the approved migration list contains duplicates');
  const extra = pending.filter((name) => !approved.includes(name));
  const missing = approved.filter((name) => !pending.includes(name));
  if (extra.length) problems.push(`pending but NOT approved: ${extra.join(', ')}`);
  if (missing.length) problems.push(`approved but not pending: ${missing.join(', ')}`);
  if (!extra.length && !missing.length && pending.join() !== approved.join()) problems.push('approved order differs from the order Prisma will apply');
  return problems;
}

function parseApproved(raw) {
  return String(raw ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

function loadPg(root) {
  const resolved = require.resolve('pg', { paths: [path.join(root, 'apps/backend'), root] });
  return require(resolved);
}

async function readLedger(root, rawUrl) {
  const { Client } = loadPg(root);
  const url = new URL(rawUrl);
  for (const parameter of PRISMA_SSL_PARAMS) url.searchParams.delete(parameter);
  const caPath = process.env.DB_SSL_CA_CERT_PATH || path.join(root, 'apps/backend/prisma/supabase-ca.pem');
  const client = new Client({
    connectionString: url.toString(),
    ssl: { ca: fs.readFileSync(caPath, 'utf8'), rejectUnauthorized: true },
    connectionTimeoutMillis: 30000,
    statement_timeout: 30000,
  });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const version = (await client.query("SELECT current_setting('server_version') AS v")).rows[0].v;
    const rows = (await client.query(
      'SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY started_at, migration_name'
    )).rows;
    await client.query('ROLLBACK');
    return {
      version,
      ledger: rows.map((row) => ({ name: row.migration_name, checksum: row.checksum, finished: row.finished, rolledBack: row.rolled_back })),
    };
  } finally {
    await client.end();
  }
}

async function main(mode) {
  const root = path.resolve(__dirname, '../..');
  const expectedRef = process.env.EXPECTED_PROJECT_REF;
  const urls = { DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL };
  const approved = parseApproved(process.env.APPROVED_MIGRATIONS);

  assertTarget(urls, expectedRef);
  console.log(`Target verified: approved DEV project ${expectedRef} (both URLs).`);

  const local = localMigrations(process.env.MIGRATIONS_DIR || path.join(root, 'apps/backend/prisma/migrations'));
  const { version, ledger } = await readLedger(root, urls.DIRECT_URL);
  const { pending, problems } = planMigrations(local, ledger);
  console.log(`PostgreSQL ${version}; ledger rows: ${ledger.length}; local migrations: ${local.length}; pending: ${pending.join(', ') || 'none'}`);

  if (mode === 'pre') {
    problems.push(...compareApproved(pending, approved));
  } else if (mode === 'post') {
    if (pending.length) problems.push(`migrations still pending after deploy: ${pending.join(', ')}`);
    for (const name of approved) {
      const row = ledger.find((entry) => entry.name === name);
      if (!row || !row.finished || row.rolledBack) problems.push(`approved migration ${name} is not recorded as finished`);
    }
  } else {
    throw new Error('Usage: migration-plan.cjs pre|post');
  }

  if (problems.length) {
    for (const problem of problems) console.error(`BLOCKED: ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${mode.toUpperCase()} CHECK PASSED.`);
}

module.exports = { DEV_REF, PROD_REF, parseTarget, assertTarget, localMigrations, planMigrations, compareApproved, parseApproved };

if (require.main === module) {
  main(process.argv[2]).catch((error) => {
    // Messages above are static strings; never print driver errors, which can echo connection details.
    console.error(`BLOCKED: ${error instanceof Error && /^(Target|This workflow|DATABASE_URL|DIRECT_URL|Unexpected|Usage)/.test(error.message) ? error.message : 'verification failed (details withheld)'}`);
    process.exitCode = 1;
  });
}
