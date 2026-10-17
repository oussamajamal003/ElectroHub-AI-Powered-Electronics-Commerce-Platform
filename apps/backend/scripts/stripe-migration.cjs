// Exact 03.6 operational gate. Historical SQL/ledger rows are read-only.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const [mode, target] = process.argv.slice(2);
if (!['preflight', 'deploy', 'verify'].includes(mode) || !['DEV', 'PROD'].includes(target)) throw new Error('Specify preflight/deploy/verify and DEV/PROD.');
const migration = '20261007000000_stripe_orchestration';
const baseline = '3d69b97fbea4dbcb536ca1a7ed7bcd7dfa54ace4';
const expected = target === 'DEV' ? 'pzxekjybdiulzmssalfo' : 'yepfgjehdstlxbpespun';
const variables = { ...dotenv.parse(fs.readFileSync('.env')), ...dotenv.parse(fs.readFileSync(target === 'DEV' ? '.env.local' : '.env.production.local')) };
for (const key of ['DIRECT_URL', 'DATABASE_URL']) if (!variables[key]?.includes(expected) || variables[key]?.includes(target === 'DEV' ? 'yepfgjehdstlxbpespun' : 'pzxekjybdiulzmssalfo')) throw new Error('Database target mismatch.');
const url = new URL(variables.DIRECT_URL);
for (const parameter of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'pgbouncer']) url.searchParams.delete(parameter);
const pool = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 30000,
  ssl: { rejectUnauthorized: true, ...(variables.DB_SSL_CA_CERT_PATH ? { ca: fs.readFileSync(variables.DB_SSL_CA_CERT_PATH, 'utf8') } : {}) } });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const safe = output => String(output ?? '').replace(/postgres(?:ql)?:\/\/\S+/gi, '[DATABASE URL REDACTED]');
const runPrisma = args => {
  const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), ...args],
    { encoding: 'utf8', env: { ...process.env, ...variables }, timeout: 180000 });
  if (result.status !== 0) throw new Error(`Prisma gate failed: ${safe(result.stderr)}`);
  return safe(result.stdout);
};
const stripDefaults = text => text.replace(/ALTER TABLE "(?:email_deliveries|otp_challenges)" ALTER COLUMN "id" DROP DEFAULT,\s*ALTER COLUMN "updatedAt" DROP DEFAULT;/g, '')
  .replace(/ALTER TABLE "(?:password_reset_tokens|refresh_tokens|security_events)" ALTER COLUMN "id" DROP DEFAULT;/g, '').replace(/^--.*$/gm, '').trim();
const temporary = path.join(os.tmpdir(), `electrohub-stripe-baseline-${crypto.randomUUID()}.prisma`);
(async () => {
  try {
    const ledger = (await pool.query('SELECT * FROM "_prisma_migrations" ORDER BY migration_name')).rows;
    const dirs = fs.readdirSync('prisma/migrations').filter(name => fs.existsSync(path.join('prisma/migrations', name, 'migration.sql'))).sort();
    const history = ledger.filter(row => row.migration_name !== migration);
    if (history.length !== 12 || dirs.filter(name => name !== migration).length !== 12) throw new Error('Unexpected historical migration set.');
    const formatExceptions = [];
    for (const row of history) {
      if (!row.finished_at || row.rolled_back_at || !dirs.includes(row.migration_name)) throw new Error('Unexplained migration state.');
      const raw = fs.readFileSync(path.join('prisma/migrations', row.migration_name, 'migration.sql'));
      const originalMigration = spawnSync('git', ['show', `${baseline}:apps/backend/prisma/migrations/${row.migration_name}/migration.sql`]);
      if (originalMigration.status !== 0) throw new Error('Historical source unavailable.');
      const normalize = bytes => bytes.toString('utf8').replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
      if (normalize(raw) !== normalize(originalMigration.stdout)) throw new Error(`Historical SQL changed: ${row.migration_name}`);
      // Windows checkout CRLF is separate from a DEV/PROD ledger discrepancy. Verify the immutable Git bytes too.
      if (hash(raw) === row.checksum || hash(originalMigration.stdout) === row.checksum) continue;
      if (!['20240101000000_database_foundation', '20240103000000_email_otp_foundation'].includes(row.migration_name)) throw new Error(`Unexplained checksum: ${row.migration_name}`);
      const lf = raw.toString('utf8').replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
      if (![Buffer.from(lf), Buffer.from(lf.replaceAll('\n', '\r\n')), Buffer.from('\uFEFF' + lf.replaceAll('\n', '\r\n'))].some(bytes => hash(bytes) === row.checksum)) throw new Error(`Non-formatting historical discrepancy: ${row.migration_name}`);
      formatExceptions.push(row.migration_name);
    }
    const historyHash = hash(JSON.stringify(history));
    const newHash = hash(fs.readFileSync(path.join('prisma/migrations', migration, 'migration.sql')));
    const applied = ledger.find(row => row.migration_name === migration);
    if (applied && (!applied.finished_at || applied.rolled_back_at || applied.checksum !== newHash)) throw new Error('03.6 ledger mismatch.');
    const defaults = (await pool.query(`SELECT table_name,column_name,column_default FROM information_schema.columns WHERE table_schema='public' AND ((table_name IN ('email_deliveries','otp_challenges','password_reset_tokens','refresh_tokens','security_events') AND column_name='id') OR (table_name IN ('email_deliveries','otp_challenges') AND column_name='updatedAt'))`)).rows;
    if (defaults.length !== 7 || defaults.some(row => row.column_default !== (row.column_name === 'id' ? 'gen_random_uuid()' : 'CURRENT_TIMESTAMP'))) throw new Error('Unexplained historical defaults.');
    const original = spawnSync('git', ['show', `${baseline}:apps/backend/prisma/schema.prisma`], { encoding: 'utf8' });
    if (original.status !== 0) throw new Error('Cannot verify immutable baseline schema.');
    fs.writeFileSync(temporary, original.stdout, 'utf8');
    const schema = applied ? 'prisma/schema.prisma' : temporary;
    const drift = stripDefaults(runPrisma(['migrate', 'diff', '--from-url', variables.DIRECT_URL, '--to-schema-datamodel', schema, '--script']));
    if (drift) throw new Error(`Unexplained physical schema drift: ${drift}`);
    const paymentViolations = Number((await pool.query('SELECT count(*) FROM payments WHERE amount < 0')).rows[0].count);
    if (paymentViolations) throw new Error('Existing financial data violates reviewed CHECK.');
    const counts = (await pool.query('SELECT (SELECT count(*) FROM orders)::int AS orders,(SELECT count(*) FROM payments)::int AS payments')).rows[0];
    console.log(JSON.stringify({ target, project: expected, mode, baseline, historyCount: history.length, historyHash,
      formattingOnly: formatExceptions, defaultsPreserved: defaults.length, counts, schema: 'MATCH', applied: Boolean(applied), checksum: newHash }));
    if (mode === 'deploy') {
      if (target === 'PROD' && process.env.STRIPE_DEV_GATE_PASSED !== newHash) throw new Error('PROD requires all mandatory DEV gates for this exact migration checksum.');
      console.log(runPrisma(['migrate', 'deploy']));
      const after = (await pool.query('SELECT * FROM "_prisma_migrations" WHERE migration_name <> $1 ORDER BY migration_name', [migration])).rows;
      if (hash(JSON.stringify(after)) !== historyHash) throw new Error('Historical ledger changed.');
      console.log('Historical ledger unchanged. Run verify for physical readback.');
    }
    if (mode === 'verify') {
      if (!applied) throw new Error('03.6 migration is not applied.');
      const tables = ['payment_attempts', 'payment_attempt_items', 'payment_work', 'stripe_events'];
      const constraints = (await pool.query('SELECT conname,contype,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN (\'payment_attempts\'::regclass,\'payment_attempt_items\'::regclass,\'payment_work\'::regclass,\'stripe_events\'::regclass,\'payments\'::regclass) ORDER BY conname')).rows;
      for (const name of ['payment_attempts_money_check', 'payment_attempts_identity_check', 'payment_attempt_items_money_quantity_check', 'payment_work_lease_check', 'payments_amount_card_check']) {
        if (!constraints.some(row => row.conname === name && row.contype === 'c' && row.convalidated)) throw new Error(`Missing physical CHECK: ${name}`);
      }
      const security = (await pool.query('SELECT relname,relrowsecurity FROM pg_class WHERE relname=ANY($1)', [tables])).rows;
      if (security.length !== 4 || security.some(row => !row.relrowsecurity)) throw new Error('Internal financial table RLS mismatch.');
      const grants = (await pool.query("SELECT grantee,table_name,privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name=ANY($1) AND grantee IN ('anon','authenticated','PUBLIC')", [tables])).rows;
      if (grants.length) throw new Error('Unexpected browser financial grants.');
      console.log(JSON.stringify({ constraints, internalTableRls: security, browserGrants: 0, ledger: 'MATCH', schema: 'MATCH' }));
    }
  } finally { await pool.end(); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
})().catch(error => { console.error(safe(error.message)); process.exitCode = 1; });
