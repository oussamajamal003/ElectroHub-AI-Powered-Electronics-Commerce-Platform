// Scoped operational gate. Never rewrites historical migrations or ledger rows.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const target = process.argv[3];
const mode = process.argv[2];
if (!['DEV', 'PROD'].includes(target) || !['preflight', 'deploy', 'verify'].includes(mode)) throw new Error('Specify preflight/deploy/verify and DEV/PROD.');
const expected = target === 'DEV' ? 'pzxekjybdiulzmssalfo' : 'yepfgjehdstlxbpespun';
const variables = { ...dotenv.parse(fs.readFileSync('.env')), ...dotenv.parse(fs.readFileSync(target === 'DEV' ? '.env.local' : '.env.production.local')) };
for (const key of ['DIRECT_URL', 'DATABASE_URL']) if (!variables[key]?.includes(expected) || variables[key]?.includes(target === 'DEV' ? 'yepfgjehdstlxbpespun' : 'pzxekjybdiulzmssalfo')) throw new Error('Database target mismatch.');
const url = new URL(variables.DIRECT_URL);
for (const parameter of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'pgbouncer']) url.searchParams.delete(parameter);
const pool = new Pool({ connectionString: url.toString(), max: 1, ssl: { rejectUnauthorized: true,
  ...(variables.DB_SSL_CA_CERT_PATH ? { ca: fs.readFileSync(variables.DB_SSL_CA_CERT_PATH, 'utf8') } : {}) } });
const migration = '20261006000000_checkout_core';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const safe = output => String(output ?? '').replace(/postgres(?:ql)?:\/\/\S+/gi, '[DATABASE URL REDACTED]');
const runPrisma = args => {
  const cli = require.resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, ...variables }, timeout: 180000 });
  if (result.status !== 0) throw new Error(`Prisma command failed: ${safe(result.stderr)}`);
  return safe(result.stdout);
};
(async () => {
  try {
    const ledger = (await pool.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name')).rows;
    const directories = fs.readdirSync('prisma/migrations').filter(name => fs.existsSync(path.join('prisma/migrations', name, 'migration.sql'))).sort();
    const historical = ledger.filter(row => row.migration_name !== migration);
    const historyBefore = (await pool.query('SELECT * FROM "_prisma_migrations" WHERE migration_name <> $1 ORDER BY migration_name', [migration])).rows;
    const historyFingerprint = hash(JSON.stringify(historyBefore));
    if (historical.length !== directories.filter(name => name !== migration).length) throw new Error('Unexpected historical migration count.');
    for (const row of historical) {
      if (!row.finished_at || row.rolled_back_at || !directories.includes(row.migration_name)) throw new Error('Unexpected migration ledger state.');
      const raw = fs.readFileSync(path.join('prisma/migrations', row.migration_name, 'migration.sql'));
      const lf = raw.toString('utf8').replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
      const variants = [raw, Buffer.from(lf), Buffer.from(lf.replaceAll('\n', '\r\n')), Buffer.from('\uFEFF' + lf.replaceAll('\n', '\r\n'))];
      if (!variants.some(bytes => hash(bytes) === row.checksum)) throw new Error(`Unexplained checksum mismatch: ${row.migration_name}`);
    }
    const newHash = hash(fs.readFileSync(path.join('prisma/migrations', migration, 'migration.sql')));
    const applied = ledger.find(row => row.migration_name === migration);
    if (applied && (applied.checksum !== newHash || !applied.finished_at || applied.rolled_back_at)) throw new Error('Checkout migration ledger/checksum mismatch.');
    const count = Number((await pool.query('SELECT count(*) FROM orders')).rows[0].count);
    if (!applied && count !== 0) throw new Error('Existing Orders require explicit backfill review.');
    const difference = runPrisma(['migrate', 'diff', '--from-url', variables.DIRECT_URL, '--to-schema-datamodel', 'prisma/schema.prisma', '--script']);
    // These seven defaults are explicitly present in the immutable historical
    // migration SQL. Prisma uuid()/updatedAt models use client-side generation.
    // Verify and preserve the database defaults; never apply the generated diff.
    const defaults = (await pool.query(`SELECT table_name,column_name,column_default FROM information_schema.columns WHERE table_schema='public' AND ((table_name IN ('email_deliveries','otp_challenges','password_reset_tokens','refresh_tokens','security_events') AND column_name='id') OR (table_name IN ('email_deliveries','otp_challenges') AND column_name='updatedAt'))`)).rows;
    if (defaults.length !== 7 || defaults.some(row => row.column_default !== (row.column_name === 'id' ? 'gen_random_uuid()' : 'CURRENT_TIMESTAMP'))) throw new Error('Unexplained historical default drift.');
    let scopedDifference = difference.replace(/ALTER TABLE "(?:email_deliveries|otp_challenges)" ALTER COLUMN "id" DROP DEFAULT,\s*ALTER COLUMN "updatedAt" DROP DEFAULT;/g, '')
      .replace(/ALTER TABLE "(?:password_reset_tokens|refresh_tokens|security_events)" ALTER COLUMN "id" DROP DEFAULT;/g, '');
    scopedDifference = scopedDifference.replace(/^--.*$/gm, '').trim();
    if (applied && scopedDifference) throw new Error(`Physical schema drift:\n${difference}`);
    if (!applied && /(?:ALTER TABLE|CREATE TABLE|DROP TABLE|CREATE INDEX|DROP INDEX) "(?!orders"|order_items")/.test(scopedDifference)) throw new Error(`Unrelated physical schema drift:\n${difference}`);
    console.log(JSON.stringify({ target, project: expected, mode, historicalLedger: historical.length, historyPreserved: true, historicalMigrationDefaultsPreserved: defaults.length, orders: count, checkoutApplied: Boolean(applied), checkoutChecksum: newHash }));
    if (!applied) console.log(difference);
    if (mode === 'deploy') {
      if (target === 'PROD' && process.env.CHECKOUT_DEV_GATE_PASSED !== newHash) throw new Error('PROD deployment requires the verified DEV gate checksum.');
      console.log(runPrisma(['migrate', 'deploy']));
      const historyAfter = (await pool.query('SELECT * FROM "_prisma_migrations" WHERE migration_name <> $1 ORDER BY migration_name', [migration])).rows;
      if (hash(JSON.stringify(historyAfter)) !== historyFingerprint) throw new Error('Historical ledger changed unexpectedly.');
      console.log('Historical ledger fingerprint unchanged: ' + historyFingerprint);
    }
    if (mode === 'verify' && !applied) throw new Error('Checkout migration not applied.');
    if (mode === 'verify') {
      const constraints = (await pool.query(`SELECT conname,contype,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('orders'::regclass,'order_items'::regclass) ORDER BY conname`)).rows;
      const expectedChecks = {
        orders_money_nonnegative: ['subtotal >= (0)::numeric', '"shippingCost" >= (0)::numeric', 'total >= (0)::numeric'],
        orders_delivery_window_valid: ['"estimatedDeliveryEnd" >= "estimatedDeliveryStart"'],
        order_items_quantity_positive: ['quantity > 0'],
        order_items_money_nonnegative: ['"unitPrice" >= (0)::numeric', '"lineTotal" >= (0)::numeric'],
      };
      for (const [name, clauses] of Object.entries(expectedChecks)) {
        const check = constraints.find(row => row.conname === name);
        if (!check || check.contype !== 'c' || !check.convalidated || clauses.some(clause => !check.definition.includes(clause))) throw new Error(`Checkout CHECK constraint mismatch: ${name}`);
      }
      console.log(JSON.stringify(constraints));
    }
  } finally { await pool.end(); }
})().catch(error => { console.error(safe(error.message)); process.exitCode = 1; });
