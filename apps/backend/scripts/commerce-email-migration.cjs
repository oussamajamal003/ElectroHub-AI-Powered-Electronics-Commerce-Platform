'use strict';
/*
 * Task 03.8 scoped migration gate for 20261018000000_commerce_email_outbox. Never rewrites historical migrations or ledger rows,
 * never prints credentials, and never applies anything but the exact reviewed pending set.
 *
 *   node scripts/commerce-email-migration.cjs preflight DEV|PROD     read-only: identity, ledger, checksums, pending set, OTP fingerprint
 *   node scripts/commerce-email-migration.cjs deploy DEV|PROD --confirm=<project-ref>
 *                                                                  preflight again, then `prisma migrate deploy`, then verify
 *   node scripts/commerce-email-migration.cjs verify DEV|PROD       read-only: FAILS (exit 2) unless the migration is applied, finished, checksum-exact
 *                                                                  and the physical schema (see scripts/lib/commerce-email-schema.cjs) is correct
 *   node scripts/commerce-email-migration.cjs verify LOCAL          verify/preflight only, against a loopback disposable database named by
 *                                                                  COMMERCE_EMAIL_VERIFY_LOCAL_URL (used by the disposable PostgreSQL tests; never deploys)
 *
 * Evidence (credential-free JSON) is written to apps/backend/.cache/commerce-email-migration/<target>-<mode>-<time>.json.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const { readPhysical, physicalFailures, verifyFailures } = require('./lib/commerce-email-schema.cjs');

const [mode, target] = process.argv.slice(2);
if (!['preflight', 'deploy', 'verify'].includes(mode) || !['DEV', 'PROD', 'LOCAL'].includes(target)) throw new Error('Usage: preflight|deploy|verify DEV|PROD');
if (target === 'LOCAL' && mode === 'deploy') throw new Error('LOCAL is read-only: deploy is not available.');
const backend = path.resolve(__dirname, '..');
const MIGRATION = '20261018000000_commerce_email_outbox';
const refs = { DEV: 'pzxekjybdiulzmssalfo', PROD: 'yepfgjehdstlxbpespun', LOCAL: 'local-disposable' };
const regions = { DEV: 'ap-northeast-2', PROD: 'ap-northeast-1' };
const local = target === 'LOCAL';
const expected = refs[target]; const other = refs[target === 'DEV' ? 'PROD' : 'DEV'];
let variables;
if (local) {
  // Disposable-only escape hatch: a loopback URL supplied by the test harness. It can never name a hosted database.
  const supplied = process.env.COMMERCE_EMAIL_VERIFY_LOCAL_URL ?? '';
  let host = '';
  try { host = new URL(supplied).hostname; } catch { /* rejected below */ }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw new Error('LOCAL requires COMMERCE_EMAIL_VERIFY_LOCAL_URL on a loopback host.');
  variables = { DIRECT_URL: supplied, DATABASE_URL: supplied };
} else {
  variables = { ...dotenv.parse(fs.readFileSync(path.join(backend, '.env'))),
    ...dotenv.parse(fs.readFileSync(path.join(backend, target === 'DEV' ? '.env.local' : '.env.production.local'))) };
  for (const key of ['DIRECT_URL', 'DATABASE_URL']) {
    const value = variables[key] ?? '';
    if (!value.includes(expected) || value.includes(other) || !value.includes(regions[target])) throw new Error(`Database target mismatch (${key}).`);
  }
}
const direct = new URL(variables.DIRECT_URL);
for (const parameter of ['sslmode', 'sslaccept', 'sslrootcert', 'sslcert', 'sslkey', 'pgbouncer']) direct.searchParams.delete(parameter);
const identity = local ? `${direct.hostname}:${direct.port || 5432}/${direct.pathname.slice(1)} (disposable)` : `${direct.hostname}:${direct.port || 5432}/${direct.pathname.slice(1)} ref=${expected}`;
const pool = new Pool({ connectionString: direct.toString(), max: 1, ssl: local ? { rejectUnauthorized: false } : { rejectUnauthorized: true,
  ...(variables.DB_SSL_CA_CERT_PATH ? { ca: fs.readFileSync(variables.DB_SSL_CA_CERT_PATH, 'utf8') } : {}) } });
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const safe = output => String(output ?? '').replace(/postgres(?:ql)?:\/\/\S+/gi, '[DATABASE URL REDACTED]');
const migrationsDir = path.join(backend, 'prisma/migrations');
const directories = fs.readdirSync(migrationsDir).filter(name => fs.existsSync(path.join(migrationsDir, name, 'migration.sql'))).sort();
const newChecksum = sha(fs.readFileSync(path.join(migrationsDir, MIGRATION, 'migration.sql')));
const evidenceDir = path.join(backend, '.cache/commerce-email-migration');

async function snapshot() {
  // Supavisor terminates TLS: pg_stat_ssl describes the pooler-to-database hop, not this client. Gate on our own socket instead.
  const client = await pool.connect();
  const stream = client.connection && client.connection.stream;
  const clientTls = local || Boolean(stream && stream.encrypted === true && stream.authorized === true);
  client.release();
  const server = (await pool.query(`SELECT current_database() AS db, current_user AS "user", split_part(version(), ' ', 2) AS version,
    (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl,
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') AS "supabaseAuthSchema",
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AS "anonRole"`)).rows[0];
  const ledger = (await pool.query(`SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count, logs IS NOT NULL AS "hasLogs"
    FROM "_prisma_migrations" ORDER BY migration_name, started_at`)).rows;
  const historical = ledger.filter(row => row.migration_name !== MIGRATION);
  const problems = [];
  for (const row of historical) {
    if (!row.finished_at || row.rolled_back_at) problems.push(`unfinished-or-rolled-back:${row.migration_name}`);
    if (!directories.includes(row.migration_name)) { problems.push(`unknown-applied:${row.migration_name}`); continue; }
    const raw = fs.readFileSync(path.join(migrationsDir, row.migration_name, 'migration.sql'));
    const lf = raw.toString('utf8').replace(/^﻿/, '').replaceAll('\r\n', '\n');
    const variants = [raw, Buffer.from(lf), Buffer.from(lf.replaceAll('\n', '\r\n')), Buffer.from('﻿' + lf.replaceAll('\n', '\r\n'))];
    if (!variants.some(bytes => sha(bytes) === row.checksum)) problems.push(`unexplained-checksum:${row.migration_name}`);
  }
  const appliedNames = new Set(ledger.filter(row => row.finished_at && !row.rolled_back_at).map(row => row.migration_name));
  const pending = directories.filter(name => !appliedNames.has(name));
  const ours = ledger.filter(row => row.migration_name === MIGRATION);
  const historyFingerprint = sha(JSON.stringify(historical.map(row => [row.migration_name, row.checksum, row.finished_at?.toISOString(), row.rolled_back_at])));
  const otp = (await pool.query(`SELECT count(*)::int AS rows, md5(coalesce(string_agg(id::text || status::text || coalesce("providerMessageId", ''), ',' ORDER BY id), '')) AS fingerprint
    FROM email_deliveries`)).rows[0];
  const counts = (await pool.query(`SELECT (SELECT count(*)::int FROM orders) AS orders, (SELECT count(*)::int FROM payments) AS payments,
    (SELECT count(*)::int FROM users) AS users`)).rows[0];
  const tables = (await pool.query(`SELECT c.relname AS name, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('commerce_email_outbox', 'commerce_email_attempts') ORDER BY 1`)).rows;
  const physical = await readPhysical(async (sql, params) => (await pool.query(sql, params)).rows);
  const nonCommerceDrift = (() => {
    const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-url', variables.DIRECT_URL,
      '--to-schema-datamodel', 'prisma/schema.prisma', '--script'], { cwd: backend, encoding: 'utf8', env: { ...process.env, ...variables }, timeout: 180000 });
    if (result.status !== 0) return { error: safe(result.stderr).slice(0, 400) };
    const statements = safe(result.stdout).split(/;\s*\n/).map(text => text.replace(/--[^\n]*\n/g, '').trim()).filter(Boolean);
    return { statementCount: statements.length, commerceStatements: statements.filter(text => /commerce_email|CommerceEmail/.test(text)).length,
      statements: statements.map(text => text.replace(/\s+/g, ' ').slice(0, 160)) };
  })();
  server.clientTlsVerified = clientTls;
  return { target, identity, server, migration: MIGRATION, newChecksum, ledgerRows: ledger.length, historicalRows: historical.length,
    repositoryMigrations: directories.length, problems, pending, ours, historyFingerprint, otp, counts, physical, nonCommerceDrift };
}
function record(name, value) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const file = path.join(evidenceDir, `${target}-${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
  return path.relative(backend, file);
}
function gate(state, strict) {
  const failures = [...state.problems];
  if (state.historicalRows !== state.repositoryMigrations - 1) failures.push(`historical-count:${state.historicalRows}/${state.repositoryMigrations - 1}`);
  if (state.ours.length > 1) failures.push('duplicate-ledger-rows-for-new-migration');
  if (state.ours[0] && state.ours[0].checksum !== newChecksum) failures.push('new-migration-checksum-mismatch');
  if (state.pending.some(name => name !== MIGRATION)) failures.push(`unexpected-pending:${state.pending.filter(name => name !== MIGRATION).join(',')}`);
  if (state.server.clientTlsVerified !== true) failures.push('client-tls-not-verified');
  // Exactly the seven documented historical defaults (docs/06_Database/MIGRATIONS.md) may differ outside the commerce tables.
  const allowed = [/^ALTER TABLE "email_deliveries" ALTER COLUMN "id" DROP DEFAULT, ALTER COLUMN "updatedAt" DROP DEFAULT$/,
    /^ALTER TABLE "otp_challenges" ALTER COLUMN "id" DROP DEFAULT, ALTER COLUMN "updatedAt" DROP DEFAULT$/,
    /^ALTER TABLE "(password_reset_tokens|refresh_tokens|security_events)" ALTER COLUMN "id" DROP DEFAULT$/];
  const unexplained = (state.nonCommerceDrift.statements ?? ['drift-unavailable'])
    .filter(text => !/commerce_email|CommerceEmail/.test(text) && !allowed.some(pattern => pattern.test(text)));
  if (unexplained.length) failures.push(`unexplained-drift:${unexplained.length}`);
  if (strict) failures.push(...verifyFailures(state, MIGRATION, newChecksum));
  return failures;
}

(async () => {
  try {
    const before = await snapshot();
    const failures = gate(before, mode === 'verify');
    if (mode !== 'deploy') {
      const file = record(mode, before);
      console.log(JSON.stringify({ mode, identity, failures, pending: before.pending, ledgerRows: before.ledgerRows, newChecksum,
        applied: before.ours.map(row => ({ finished: Boolean(row.finished_at), rolledBack: Boolean(row.rolled_back_at), checksumMatches: row.checksum === newChecksum })),
        otp: before.otp, counts: before.counts, physical: before.physical && { tables: before.physical.tables, constraints: before.physical.constraints.length, indexes: before.physical.indexes.length,
          triggers: before.physical.triggers.map(row => row.name), enums: before.physical.enums.map(row => row.name), exposure: before.physical.exposure, rows: before.physical.rows },
        drift: { statements: before.nonCommerceDrift.statementCount, commerce: before.nonCommerceDrift.commerceStatements }, evidence: file }, null, 2));
      process.exitCode = failures.length ? 2 : 0;
      // Actionable, credential-free reason on stderr as well as in the JSON result.
      if (failures.length) console.error(`${mode.toUpperCase()} FAILED (${failures.length}): ${failures.join('; ')}`);
      return;
    }
    const confirm = process.argv.find(arg => arg.startsWith('--confirm='))?.slice('--confirm='.length);
    if (confirm !== expected) throw new Error(`Deploy requires --confirm=${target === 'DEV' ? '<dev ref>' : '<prod ref>'} matching the resolved target.`);
    if (failures.length) throw new Error(`Preflight failed: ${failures.join('; ')}`);
    if (before.pending.length !== 1 || before.pending[0] !== MIGRATION) throw new Error(`Nothing to deploy or unexpected pending set: ${before.pending.join(',') || 'none'}`);
    const preflightFile = record('deploy-preflight', before);
    const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], { cwd: backend, encoding: 'utf8',
      env: { ...process.env, ...variables, DATABASE_URL: variables.DIRECT_URL }, timeout: 300000 });
    const cliOutput = safe(result.stdout + result.stderr);
    const after = await snapshot();
    const verification = [];
    const row = after.ours[0];
    if (!row || !row.finished_at || row.rolled_back_at || row.checksum !== newChecksum || after.ours.length !== 1) verification.push('new-ledger-row-invalid');
    if (after.pending.length) verification.push(`still-pending:${after.pending.join(',')}`);
    if (after.historyFingerprint !== before.historyFingerprint) verification.push('historical-ledger-changed');
    if (after.otp.rows !== before.otp.rows || after.otp.fingerprint !== before.otp.fingerprint) verification.push('otp-data-changed');
    if (JSON.stringify(after.counts) !== JSON.stringify(before.counts)) verification.push('business-row-counts-changed');
    verification.push(...physicalFailures(after.physical));
    if (after.nonCommerceDrift.commerceStatements) verification.push('commerce-schema-drift-after-deploy');
    const file = record('deploy-verify', { cliExit: result.status, cliOutput: cliOutput.slice(-2000), before: preflightFile, after, verification });
    console.log(JSON.stringify({ mode, identity, cliExit: result.status, verification, ledgerRows: after.ledgerRows, newChecksum,
      historyFingerprintUnchanged: after.historyFingerprint === before.historyFingerprint, otp: { before: before.otp, after: after.otp },
      physical: after.physical && { tables: after.physical.tables, constraints: after.physical.constraints.length, indexes: after.physical.indexes.length,
        triggers: after.physical.triggers.map(row => row.name), enums: after.physical.enums.map(e => e.name), exposure: after.physical.exposure, rows: after.physical.rows },
      drift: { statements: after.nonCommerceDrift.statementCount, commerce: after.nonCommerceDrift.commerceStatements }, evidence: file }, null, 2));
    process.exitCode = result.status === 0 && !verification.length ? 0 : 3;
  } catch (error) {
    console.error(safe(error instanceof Error ? error.message : error)); process.exitCode = 1;
  } finally { await pool.end(); }
})();
