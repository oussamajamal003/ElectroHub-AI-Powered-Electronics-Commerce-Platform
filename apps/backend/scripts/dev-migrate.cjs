'use strict';
// Shared DEV-only guarded migration deploy used by the task entrypoints (product-media-migrate.cjs,
// recommendations-migrate.cjs). Each entrypoint pins its own exact ordered allowlist; PROD deployment is handled
// only by the exact reviewed migration workflow.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const dotenv = require('dotenv');
const backend = path.resolve(__dirname, '..');
const root = path.resolve(backend, '../..');
const { assertTarget } = require(path.join(root, '.github/scripts/migration-plan.cjs'));

module.exports = function devMigrate(mode, { approvedMigrations, entrypoint }) {
if (!['pre', 'deploy', 'post'].includes(mode)) throw new Error(`Usage: ${entrypoint} pre|deploy|post (DEV only)`);
if (!/^\d{14}_[a-z0-9_]+(,\d{14}_[a-z0-9_]+)*$/.test(approvedMigrations)) throw new Error('approvedMigrations must be an exact ordered list.');
const values = ['.env', '.env.local'].reduce((all, name) => {
  const file = path.join(backend, name); return fs.existsSync(file) ? { ...all, ...dotenv.parse(fs.readFileSync(file)) } : all;
}, {});
assertTarget({ DATABASE_URL: values.DATABASE_URL, DIRECT_URL: values.DIRECT_URL }, 'pzxekjybdiulzmssalfo', 'DEV');
// Windows checkout conversion must not rewrite applied migration bytes. Build an immutable deployment snapshot
// from actual Git blobs for historical files, proving normalized SQL agrees with this checkout before using it.
const migrationRoot = path.join(backend, 'prisma/migrations');
const prepared = fs.readdirSync(migrationRoot).filter(name => /^\d{14}_/.test(name)).sort().map(name => {
  const relative = `apps/backend/prisma/migrations/${name}/migration.sql`;
  const working = fs.readFileSync(path.join(root, relative));
  let historical = null;
  try { historical = execFileSync('git', ['show', `HEAD:${relative}`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* New task migration. */ }
  if (historical && historical.toString('utf8').replace(/\r\n/g, '\n') !== working.toString('utf8').replace(/\r\n/g, '\n')) {
    throw new Error('Historical migration SQL differs from Git; deployment refused.');
  }
  return { name, bytes: historical || working };
});
const digest = crypto.createHash('sha256'); for (const item of prepared) digest.update(item.name).update(item.bytes);
const snapshot = path.join(backend, '.product-media/migration-snapshots', digest.digest('hex'));
fs.mkdirSync(path.join(snapshot, 'migrations'), { recursive: true });
for (const item of prepared) {
  const dir = path.join(snapshot, 'migrations', item.name); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'migration.sql');
  if (fs.existsSync(file) && !fs.readFileSync(file).equals(item.bytes)) throw new Error('Migration snapshot changed; refused.');
  if (!fs.existsSync(file)) fs.writeFileSync(file, item.bytes, { flag: 'wx' });
}
fs.copyFileSync(path.join(migrationRoot, 'migration_lock.toml'), path.join(snapshot, 'migrations/migration_lock.toml'));
fs.copyFileSync(path.join(backend, 'prisma/schema.prisma'), path.join(snapshot, 'schema.prisma'));
const environment = { ...process.env, ...values, DB_SSL_CA_CERT_PATH: path.resolve(backend, values.DB_SSL_CA_CERT_PATH || 'prisma/supabase-ca.pem'),
  MIGRATION_TARGET: 'DEV', EXPECTED_PROJECT_REF: 'pzxekjybdiulzmssalfo',
  APPROVED_MIGRATIONS: approvedMigrations,
  MIGRATIONS_DIR: path.join(snapshot, 'migrations') };
function run(args, cwd = root) {
  const result = spawnSync(process.execPath, args, { cwd, env: environment, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
run(['.github/scripts/migration-plan.cjs', mode === 'post' ? 'post' : 'pre']);
if (mode === 'deploy') {
  run(['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', path.join(snapshot, 'schema.prisma')], backend);
  run(['node_modules/prisma/build/index.js', 'migrate', 'status', '--schema', path.join(snapshot, 'schema.prisma')], backend);
  run(['.github/scripts/migration-plan.cjs', 'post']);
}
};
