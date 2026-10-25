'use strict';
/**
 * Guard for the protected DEV and PROD migration deployment workflows.
 *
 *   node .github/scripts/migration-plan.cjs pre    # before `prisma migrate deploy`: read-only, never writes
 *   node .github/scripts/migration-plan.cjs post   # after deploy: read-only
 *
 * `pre` fails closed unless ALL hold:
 *   1. every database URL targets the single explicitly selected Supabase project ref;
 *   2. the Prisma ledger has no failed / rolled-back / unfinished row;
 *   3. every applied migration matches the raw checkout SHA-256 or one of two content-pinned LF/CRLF records;
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
const PROJECT_REFS = Object.freeze({ DEV: DEV_REF, PROD: PROD_REF });
const MIGRATION_NAME = /^\d{14}_[a-z0-9_]+$/;
const PRISMA_SSL_PARAMS = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslaccept', 'pgbouncer', 'connect_timeout'];
// These exact CRLF digests were observed in successful live ledgers and reproduced by
// transforming the canonical Git blobs below. No other historical checksum mismatch is accepted.
const LEGACY_LINE_ENDING_CHECKSUMS = Object.freeze({
  '20240103000000_email_otp_foundation': Object.freeze({
    canonicalSha256: 'e1a2b518c6d52b04211d2b078412794d2754b27016432028e87f7450f915b241',
    crlfSha256: 'ba99562ff2a870230d15990e107b59610f0aabc08678c342bc5509d9e45ad524',
  }),
  '20261012120000_payment_purchase_ownership': Object.freeze({
    canonicalSha256: 'a45372e2e25895345b7499e6d7d82b852e75a1a5e29b03b8b1fcf53a0f8cc310',
    crlfSha256: '0cf4bc6b88a2222b47e691100364b0e961b5bb20b61149dfb759b651ef177ff8',
  }),
});
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** Calculate only deterministic LF/CRLF representations; SQL content is never rewritten. */
function migrationChecksumMetadata(raw) {
  const text = raw.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(raw)) throw new Error('Migration SQL is not valid UTF-8.');
  if (text.replace(/\r\n/g, '').includes('\r')) throw new Error('Migration SQL contains a bare carriage return.');
  const lfBytes = Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8');
  const crlfBytes = Buffer.from(lfBytes.toString('utf8').replace(/\n/g, '\r\n'), 'utf8');
  return {
    sha256: sha256(raw),
    canonicalSha256: sha256(lfBytes),
    crlfSha256: sha256(crlfBytes),
    lineEnding: raw.equals(lfBytes) ? 'LF' : raw.equals(crlfBytes) ? 'CRLF' : 'MIXED',
  };
}

function hasVerifiedLegacyLineEndingChecksum(migration, ledgerChecksum) {
  const expected = LEGACY_LINE_ENDING_CHECKSUMS[migration.name];
  return Boolean(expected
    && ledgerChecksum === expected.crlfSha256
    && migration.canonicalSha256 === expected.canonicalSha256
    && migration.crlfSha256 === expected.crlfSha256
    && (migration.lineEnding === 'LF' || migration.lineEnding === 'CRLF'));
}

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

/** Throws unless the explicitly selected environment and every URL resolve to its fixed project ref. */
function assertTarget(urls, expectedRef, target = 'DEV') {
  if (!Object.hasOwn(PROJECT_REFS, target) || expectedRef !== PROJECT_REFS[target]) {
    throw new Error(`This workflow is restricted to its approved ${target} project; refusing a different expected ref.`);
  }
  for (const [name, value] of Object.entries(urls)) {
    if (!value) throw new Error(`${name} is not set.`);
    const forbiddenRef = target === 'DEV' ? PROD_REF : DEV_REF;
    if (value.includes(forbiddenRef)) throw new Error(`${name} references the other protected project.`);
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
      const metadata = migrationChecksumMetadata(fs.readFileSync(path.join(dir, entry.name, 'migration.sql')));
      return { name: entry.name, ...metadata };
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
    else if (match.sha256 !== row.checksum && !hasVerifiedLegacyLineEndingChecksum(match, row.checksum)) {
      problems.push(`applied migration ${row.name} differs from canonical SQL content (checksum mismatch)`);
    }
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
  const target = process.env.MIGRATION_TARGET || 'DEV';
  const expectedRef = PROJECT_REFS[target];
  if (process.env.EXPECTED_PROJECT_REF && process.env.EXPECTED_PROJECT_REF !== expectedRef) {
    throw new Error('Configured project ref does not match the selected protected environment.');
  }
  const urls = { DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL };
  const approved = parseApproved(process.env.APPROVED_MIGRATIONS);

  assertTarget(urls, expectedRef, target);
  console.log(`Target verified: approved ${target} project ${expectedRef} (both URLs).`);

  const local = localMigrations(process.env.MIGRATIONS_DIR || path.join(root, 'apps/backend/prisma/migrations'));
  const { version, ledger } = await readLedger(root, urls.DIRECT_URL);
  const { pending, problems } = planMigrations(local, ledger);
  console.log(`PostgreSQL ${version}; ledger rows: ${ledger.length}; local migrations: ${local.length}; pending: ${pending.join(', ') || 'none'}`);
  const reconciled = ledger.filter((row) => {
    if (!row.finished || row.rolledBack) return false;
    const migration = local.find((item) => item.name === row.name);
    return migration && migration.sha256 !== row.checksum && hasVerifiedLegacyLineEndingChecksum(migration, row.checksum);
  }).map((row) => row.name);
  if (reconciled.length) console.log(`Verified line-ending-only legacy checksums: ${reconciled.join(', ')}`);

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

module.exports = {
  DEV_REF, PROD_REF, PROJECT_REFS, LEGACY_LINE_ENDING_CHECKSUMS, parseTarget, assertTarget,
  migrationChecksumMetadata, hasVerifiedLegacyLineEndingChecksum, localMigrations, planMigrations,
  compareApproved, parseApproved,
};

if (require.main === module) {
  main(process.argv[2]).catch((error) => {
    // Messages above are static strings; never print driver errors, which can echo connection details.
    console.error(`BLOCKED: ${error instanceof Error && /^(Target|This workflow|DATABASE_URL|DIRECT_URL|Unexpected|Usage)/.test(error.message) ? error.message : 'verification failed (details withheld)'}`);
    process.exitCode = 1;
  });
}
