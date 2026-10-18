'use strict';
/*
 * Task 03.8 scoped migration gate for 20261018000000_commerce_email_outbox. Never rewrites historical migrations or ledger rows,
 * never prints credentials, and never applies anything but the exact reviewed pending set.
 *
 *   node scripts/commerce-email-migration.cjs preflight DEV|PROD     read-only: identity, ledger, checksums, pending set, OTP fingerprint
 *   node scripts/commerce-email-migration.cjs deploy DEV|PROD --confirm=<project-ref>
 *                                                                  preflight again, then `prisma migrate deploy`, then verify
 *   node scripts/commerce-email-migration.cjs verify DEV|PROD       read-only physical/ledger readback
 *
 * Evidence (credential-free JSON) is written to apps/backend/.cache/commerce-email-migration/<target>-<mode>-<time>.json.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const [mode, target] = process.argv.slice(2);
if (!['preflight', 'deploy', 'verify'].includes(mode) || !['DEV', 'PROD'].includes(target)) throw new Error('Usage: preflight|deploy|verify DEV|PROD');
const backend = path.resolve(__dirname, '..');
const MIGRATION = '20261018000000_commerce_email_outbox';
const refs = { DEV: 'pzxekjybdiulzmssalfo', PROD: 'yepfgjehdstlxbpespun' };
const regions = { DEV: 'ap-northeast-2', PROD: 'ap-northeast-1' };
const expected = refs[target]; const other = refs[target === 'DEV' ? 'PROD' : 'DEV'];
const variables = { ...dotenv.parse(fs.readFileSync(path.join(backend, '.env'))),
  ...dotenv.parse(fs.readFileSync(path.join(backend, target === 'DEV' ? '.env.local' : '.env.production.local'))) };
for (const key of ['DIRECT_URL', 'DATABASE_URL']) {
  const value = variables[key] ?? '';
  if (!value.includes(expected) || value.includes(other) || !value.includes(regions[target])) throw new Error(`Database target mismatch (${key}).`);
}
const direct = new URL(variables.DIRECT_URL);
for (const parameter of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'pgbouncer']) direct.searchParams.delete(parameter);
const identity = `${direct.hostname}:${direct.port || 5432}/${direct.pathname.slice(1)} ref=${expected}`;
const pool = new Pool({ connectionString: direct.toString(), max: 1, ssl: { rejectUnauthorized: true,
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
  const clientTls = Boolean(stream && stream.encrypted === true && stream.authorized === true);
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
  let physical = null;
  if (tables.length) {
    const constraints = (await pool.query(`SELECT conname FROM pg_constraint WHERE conrelid IN ('commerce_email_outbox'::regclass, 'commerce_email_attempts'::regclass) ORDER BY 1`)).rows.map(row => row.conname);
    const indexes = (await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename IN ('commerce_email_outbox', 'commerce_email_attempts') ORDER BY 1`)).rows.map(row => row.indexname);
    const triggers = (await pool.query(`SELECT tgname FROM pg_trigger WHERE tgrelid IN ('commerce_email_outbox'::regclass, 'commerce_email_attempts'::regclass) AND NOT tgisinternal ORDER BY 1`)).rows.map(row => row.tgname);
    const enums = (await pool.query(`SELECT t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS labels FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname LIKE 'CommerceEmail%' GROUP BY 1 ORDER BY 1`)).rows;
    const roles = (await pool.query(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`)).rows.map(row => row.rolname);
    const exposure = [];
    for (const role of roles) for (const table of ['commerce_email_outbox', 'commerce_email_attempts']) {
      exposure.push({ role, table, privileges: (await pool.query(`SELECT has_table_privilege($1, $2, 'SELECT') OR has_table_privilege($1, $2, 'INSERT') OR
        has_table_privilege($1, $2, 'UPDATE') OR has_table_privilege($1, $2, 'DELETE') AS any`, [role, table])).rows[0].any });
    }
    const rows = (await pool.query(`SELECT count(*)::int AS outbox, (SELECT count(*)::int FROM commerce_email_attempts) AS attempts FROM commerce_email_outbox`)).rows[0];
    physical = { tables, constraints, indexes, triggers, enums, exposure, rows };
  }
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
function gate(state) {
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
  return failures;
}

(async () => {
  try {
    const before = await snapshot();
    const failures = gate(before);
    if (mode !== 'deploy') {
      const file = record(mode, before);
      console.log(JSON.stringify({ mode, identity, failures, pending: before.pending, ledgerRows: before.ledgerRows, newChecksum,
        applied: before.ours.map(row => ({ finished: Boolean(row.finished_at), rolledBack: Boolean(row.rolled_back_at), checksumMatches: row.checksum === newChecksum })),
        otp: before.otp, counts: before.counts, physical: before.physical && { ...before.physical, constraints: before.physical.constraints.length, indexes: before.physical.indexes.length },
        drift: { statements: before.nonCommerceDrift.statementCount, commerce: before.nonCommerceDrift.commerceStatements }, evidence: file }, null, 2));
      process.exitCode = failures.length ? 2 : 0;
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
    if (!after.physical || after.physical.tables.length !== 2 || !after.physical.tables.every(table => table.rls)) verification.push('tables-or-rls-missing');
    if (after.physical?.exposure.some(entry => entry.privileges)) verification.push('browser-role-exposure');
    if ((after.physical?.constraints.length ?? 0) < 14 || (after.physical?.triggers.length ?? 0) !== 2) verification.push('constraints-or-triggers-missing');
    if (after.nonCommerceDrift.commerceStatements) verification.push('commerce-schema-drift-after-deploy');
    const file = record('deploy-verify', { cliExit: result.status, cliOutput: cliOutput.slice(-2000), before: preflightFile, after, verification });
    console.log(JSON.stringify({ mode, identity, cliExit: result.status, verification, ledgerRows: after.ledgerRows, newChecksum,
      historyFingerprintUnchanged: after.historyFingerprint === before.historyFingerprint, otp: { before: before.otp, after: after.otp },
      physical: after.physical && { tables: after.physical.tables, constraints: after.physical.constraints.length, indexes: after.physical.indexes.length,
        triggers: after.physical.triggers, enums: after.physical.enums.map(e => e.typname), exposure: after.physical.exposure, rows: after.physical.rows },
      drift: { statements: after.nonCommerceDrift.statementCount, commerce: after.nonCommerceDrift.commerceStatements }, evidence: file }, null, 2));
    process.exitCode = result.status === 0 && !verification.length ? 0 : 3;
  } catch (error) {
    console.error(safe(error instanceof Error ? error.message : error)); process.exitCode = 1;
  } finally { await pool.end(); }
})();
