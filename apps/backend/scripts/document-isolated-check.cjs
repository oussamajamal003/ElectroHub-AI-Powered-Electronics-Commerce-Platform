/**
 * Task 03.9 REAL POSTGRES document gate — disposable isolated database ONLY (apps/backend/.isolated, localhost:55434).
 *   PG_BIN=<postgres 17 bin> node scripts/document-isolated-check.cjs [pdf-output-dir]
 *   node scripts/document-isolated-check.cjs --seed-ui   adds labelled synthetic orders to the isolated fixture customer for browser QA
 * Loads the disposable connection settings, refuses any other target, then runs document-isolated-check.ts: seeds labelled
 * synthetic customers A/B/C and orders (fixture writes, reported separately), exercises the real Express routes with real
 * Prisma/auth/worker rendering, and compares row hashes before/after the document reads. Never touches shared DEV or PROD.
 */
const fs = require('node:fs');
const path = require('node:path');

const env = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.isolated', 'env.json'), 'utf8'));
for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  const url = new URL(env[key]);
  if (url.hostname !== 'localhost' || url.port !== '55434' || url.pathname !== '/electrohub_disposable') {
    console.error(`Refusing: ${key} is not the disposable isolated database.`);
    process.exit(1);
  }
}
Object.assign(process.env, env, { NODE_ENV: 'test', DOCUMENTS_ENABLED: 'true' });
require('tsx/cjs');
if (process.argv[2] === '--seed-ui') require('./document-isolated-seed-ui.ts');
else if (process.argv[2] === '--customer-b') require('./document-isolated-customer-b.ts');
else require('./document-isolated-check.ts');
