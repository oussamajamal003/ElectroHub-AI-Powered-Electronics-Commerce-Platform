'use strict';
// Offline tests for the migration-safety guards. No network, no database, no secrets.
//   node --test .github/scripts/*.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const plan = require('./migration-plan.cjs');
const policy = require('./check-workflow-policy.cjs');

const DEV = plan.DEV_REF;
const PROD = plan.PROD_REF;
const pooled = (ref, extra = '') => `postgresql://postgres.${ref}:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres${extra}`;
const direct = (ref) => `postgresql://postgres:pw@db.${ref}.supabase.co:5432/postgres`;
const sha = (n) => String(n).padStart(64, '0');

test('parseTarget recognises pooled and direct Supabase endpoints and rejects everything else', () => {
  assert.deepEqual(plan.parseTarget(pooled(DEV)), { ok: true, ref: DEV, kind: 'pooler', pgbouncer: false });
  assert.equal(plan.parseTarget(direct(PROD)).ref, PROD);
  assert.equal(plan.parseTarget(pooled(DEV, '?pgbouncer=true')).pgbouncer, true);
  for (const bad of ['not a url', 'mysql://u:p@db.' + DEV + '.supabase.co/x', 'postgresql://u:p@localhost:5432/x', 'postgresql://u:p@evil.example.com/x']) {
    assert.equal(plan.parseTarget(bad).ok, false, bad);
  }
});

test('assertTarget accepts DEV and refuses PROD, mismatches, localhost and pgbouncer DIRECT_URL', () => {
  assert.doesNotThrow(() => plan.assertTarget({ DATABASE_URL: pooled(DEV, '?pgbouncer=true'), DIRECT_URL: pooled(DEV) }, DEV));
  assert.doesNotThrow(() => plan.assertTarget({ DATABASE_URL: pooled(PROD), DIRECT_URL: direct(PROD) }, PROD, 'PROD'));
  assert.throws(() => plan.assertTarget({ DATABASE_URL: pooled(PROD), DIRECT_URL: pooled(PROD) }, DEV), /other protected project|different/);
  assert.throws(() => plan.assertTarget({ DATABASE_URL: pooled(DEV), DIRECT_URL: pooled(PROD) }, DEV), /other protected project/);
  assert.throws(() => plan.assertTarget({ DATABASE_URL: pooled(DEV), DIRECT_URL: 'postgresql://u:p@localhost/x' }, DEV), /recognised/);
  assert.throws(() => plan.assertTarget({ DATABASE_URL: pooled(DEV), DIRECT_URL: undefined }, DEV), /not set/);
  assert.throws(() => plan.assertTarget({ DATABASE_URL: pooled(DEV), DIRECT_URL: pooled(DEV, '?pgbouncer=true') }, DEV), /pgbouncer/);
  assert.throws(() => plan.assertTarget({ DATABASE_URL: pooled(PROD), DIRECT_URL: pooled(PROD) }, PROD), /approved DEV project/);
  assert.throws(() => plan.assertTarget({ DATABASE_URL: pooled(DEV), DIRECT_URL: pooled(DEV) }, DEV, 'PROD'), /approved PROD project/);
});

test('planMigrations detects pending, modified, missing, failed, rolled-back and out-of-order migrations', () => {
  const local = [{ name: '20260101000000_a', sha256: sha(1) }, { name: '20260102000000_b', sha256: sha(2) }, { name: '20260103000000_c', sha256: sha(3) }];
  const row = (name, checksum, over = {}) => ({ name, checksum, finished: true, rolledBack: false, ...over });

  assert.deepEqual(plan.planMigrations(local, [row(local[0].name, sha(1)), row(local[1].name, sha(2))]), { pending: ['20260103000000_c'], problems: [] });
  assert.match(plan.planMigrations(local, [row(local[0].name, sha(9))]).problems.join(), /checksum mismatch/);
  assert.match(plan.planMigrations(local, [row('20250101000000_gone', sha(1))]).problems.join(), /missing from this checkout/);
  assert.match(plan.planMigrations(local, [row(local[0].name, sha(1), { finished: false })]).problems.join(), /unfinished/);
  assert.match(plan.planMigrations(local, [row(local[0].name, sha(1), { rolledBack: true })]).problems.join(), /rolled back/);
  // b is applied, a is not: a would be applied out of order
  assert.match(plan.planMigrations(local, [row(local[1].name, sha(2))]).problems.join(), /sorts before already-applied/);
});

test('line-ending reconciliation accepts only the two exact, content-pinned legacy CRLF checksums', () => {
  const name = '20261012120000_payment_purchase_ownership';
  const legacy = plan.LEGACY_LINE_ENDING_CHECKSUMS[name];
  const row = (migrationName, checksum) => ({ name: migrationName, checksum, finished: true, rolledBack: false });
  const canonicalLf = {
    name,
    sha256: legacy.canonicalSha256,
    canonicalSha256: legacy.canonicalSha256,
    crlfSha256: legacy.crlfSha256,
    lineEnding: 'LF',
  };

  assert.deepEqual(plan.planMigrations([canonicalLf], [row(name, legacy.crlfSha256)]), { pending: [], problems: [] });
  assert.match(plan.planMigrations([{ ...canonicalLf, canonicalSha256: sha(9) }], [row(name, legacy.crlfSha256)]).problems.join(), /checksum mismatch/);
  assert.match(plan.planMigrations([canonicalLf], [row(name, sha(9))]).problems.join(), /checksum mismatch/);
  assert.match(plan.planMigrations([{ ...canonicalLf, name: '20260101000000_unrelated' }], [row('20260101000000_unrelated', legacy.crlfSha256)]).problems.join(), /checksum mismatch/);

  const foundation = {
    name: '20240101000000_database_foundation',
    sha256: 'a41f086f7f9dc2f67621622a77f3e716027285e015991db470e8ab7bed1314a8',
    canonicalSha256: 'cb2baf5e79d8127f31fa9873c5e2cfd28b159f7a375d8d4d2856dd8766b5fd17',
    crlfSha256: 'a41f086f7f9dc2f67621622a77f3e716027285e015991db470e8ab7bed1314a8',
    lineEnding: 'CRLF',
  };
  // Foundation: the PROD ledger value is the exact BOM+CRLF form of the Git blob and is accepted ONLY with that proof.
  const fnd = plan.LEGACY_LINE_ENDING_CHECKSUMS[foundation.name];
  const foundationLedger = '5de060a305af86bbc70d683ebe3bea1fe35c1c6454c048cbeed07d22fe347f96';
  assert.equal(fnd.ledgerSha256, foundationLedger);
  assert.deepEqual(plan.planMigrations([{ ...foundation, bomCrlfSha256: foundationLedger }], [row(foundation.name, foundationLedger)]), { pending: [], problems: [] });
  assert.match(plan.planMigrations([foundation], [row(foundation.name, foundationLedger)]).problems.join(), /checksum mismatch/);
  assert.match(plan.planMigrations([{ ...foundation, bomCrlfSha256: foundationLedger }], [row(foundation.name, sha(9))]).problems.join(), /checksum mismatch/);
  assert.match(plan.planMigrations([{ ...foundation, canonicalSha256: sha(9), bomCrlfSha256: foundationLedger }], [row(foundation.name, foundationLedger)]).problems.join(), /checksum mismatch/);
  // The real file's bytes reproduce the pinned ledger value (BOM + CRLF of the Git blob).
  const realFoundation = plan.localMigrations(path.resolve(__dirname, '../../apps/backend/prisma/migrations')).find((m) => m.name === foundation.name);
  assert.equal(realFoundation.canonicalSha256, fnd.canonicalSha256);
  assert.equal(realFoundation.bomCrlfSha256, foundationLedger);
});

test('live DEV payment migration bytes reproduce the exact approved LF and CRLF hashes', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const migrationPath = 'apps/backend/prisma/migrations/20261012120000_payment_purchase_ownership/migration.sql';
  const migrations = plan.localMigrations(path.join(repoRoot, 'apps/backend/prisma/migrations'));
  const payment = migrations.find((migration) => migration.name === '20261012120000_payment_purchase_ownership');
  const expected = plan.LEGACY_LINE_ENDING_CHECKSUMS['20261012120000_payment_purchase_ownership'];
  const canonicalGitBytes = execFileSync('git', ['cat-file', 'blob', `HEAD:${migrationPath}`], { cwd: repoRoot });
  const canonicalGit = plan.migrationChecksumMetadata(canonicalGitBytes);
  const workingTreeBytes = fs.readFileSync(path.join(repoRoot, migrationPath));

  assert.ok(payment);
  assert.equal(canonicalGit.sha256, expected.canonicalSha256);
  assert.equal(canonicalGit.crlfSha256, expected.crlfSha256);
  assert.equal(payment.canonicalSha256, canonicalGit.sha256);
  assert.equal(payment.canonicalSha256, expected.canonicalSha256);
  assert.equal(payment.crlfSha256, expected.crlfSha256);
  // Checkout line endings vary by platform (Windows autocrlf = CRLF, Linux CI = LF); either must hash to a pinned value.
  assert.ok(['LF', 'CRLF'].includes(payment.lineEnding));
  assert.equal(payment.sha256, payment.lineEnding === 'LF' ? expected.canonicalSha256 : expected.crlfSha256);
  assert.deepEqual(
    Buffer.from(workingTreeBytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8'),
    canonicalGitBytes,
  );
});

test('compareApproved requires the exact ordered pending set', () => {
  const a = '20261013000000_refresh_token_rotation_lineage';
  const b = '20261014000000_other';
  assert.deepEqual(plan.compareApproved([a], [a]), []);
  assert.match(plan.compareApproved([a, b], [a]).join(), /pending but NOT approved: 20261014000000_other/);
  assert.match(plan.compareApproved([a], [a, b]).join(), /approved but not pending/);
  assert.match(plan.compareApproved([a, b], [b, a]).join(), /order differs/);
  assert.match(plan.compareApproved([a], []).join(), /empty/);
  assert.match(plan.compareApproved([a], ['DROP TABLE users']).join(), /not a migration name/);
  assert.match(plan.compareApproved([a, a], [a, a]).join(), /duplicates/);
  assert.deepEqual(plan.parseApproved(' a , b ,, '), ['a', 'b']);
});

test('the real migration directory is well-formed, chronological, and orders AUTH before the later payment migrations', () => {
  const local = plan.localMigrations(path.resolve(__dirname, '../../apps/backend/prisma/migrations'));
  const names = local.map((migration) => migration.name);
  assert.ok(local.length >= 17);
  assert.ok(local.every((migration) => /^[0-9a-f]{64}$/.test(migration.sha256)));
  // Chronological and unique: Prisma applies in name order, so a name that sorts before an applied one would be a history rewrite.
  assert.deepEqual(names, [...names].sort());
  assert.equal(new Set(names).size, names.length);
  // AUTH is no longer required to be the LAST folder. Its position relative to its predecessor and to the later payment migrations is pinned instead.
  const index = (name) => names.indexOf(name);
  const order = ['20261012120000_payment_purchase_ownership', '20261013000000_refresh_token_rotation_lineage',
    '20261015000000_payment_attempt_dismissed_at', '20261016000000_payment_attempt_confirmation_started'];
  for (const name of order) assert.ok(index(name) >= 0, `${name} must exist`);
  for (let i = 1; i < order.length; i++) assert.ok(index(order[i - 1]) < index(order[i]), `${order[i - 1]} must precede ${order[i]}`);
  // Anything after AUTH is a later, separately authorized migration. Deployment authorization is unchanged: migration-plan pre still requires
  // the pending set to equal the approved list exactly, so later migrations cannot ship with the AUTH release unless the plan approves them.
  const afterAuth = names.slice(index('20261013000000_refresh_token_rotation_lineage') + 1);
  assert.ok(afterAuth.every((name) => name > '20261013000000_refresh_token_rotation_lineage'));
});

// --- workflow policy -------------------------------------------------------------------------------------

const UNSAFE_CI = `
name: ci
on:
  push:
    branches: [develop, 'feature/**']
  pull_request:
    branches: [develop]
jobs:
  backend-test:
    steps:
      - name: Prisma Migrate Deploy
        env:
          DATABASE_URL: "\${{ secrets.ELECTROHUB_DEV_DATABASE_URL }}"
          DIRECT_URL: "\${{ secrets.ELECTROHUB_DEV_DIRECT_URL }}"
        run: npm exec --workspace=@electrohub/backend -- prisma migrate deploy
`;

test('policy flags the original unsafe ci.yml (push/PR + shared DEV secrets + migrate deploy)', () => {
  const problems = policy.checkWorkflow('ci.yml', UNSAFE_CI).join('\n');
  assert.match(problems, /shared-database secret/);
  assert.match(problems, /mutating Prisma command/);
  assert.match(problems, /push\/PR\/scheduled workflow references a shared database URL/);
});

test('policy flags the original dev-migration.yml triggers and missing approval controls', () => {
  const unsafe = `
name: dev
on:
  workflow_dispatch:
  push:
    branches: [develop]
concurrency:
  group: migration-\${{ github.ref }}
  cancel-in-progress: false
jobs:
  migrate:
    steps:
      - run: npm exec -- prisma migrate deploy
        env:
          DATABASE_URL: \${{ secrets.ELECTROHUB_DEV_DATABASE_URL }}
`;
  const problems = policy.checkWorkflow('dev-migration.yml', unsafe).join('\n');
  assert.match(problems, /workflow_dispatch only/);
  assert.match(problems, /protected GitHub Environment/);
  assert.match(problems, /pre-check/);
});

test('policy rejects pull_request_target, migrate resolve outside the gate, and PRs that run Prisma before the disposable DB', () => {
  assert.match(policy.checkWorkflow('x.yml', 'on:\n  pull_request_target:\njobs: {}\n').join(), /pull_request_target/);
  assert.match(policy.checkWorkflow('x.yml', 'on:\n  workflow_dispatch:\njobs:\n  a:\n    steps:\n      - run: npx prisma migrate resolve --rolled-back x\n').join(), /mutating Prisma command/);
  const early = 'on:\n  pull_request:\njobs:\n  a:\n    steps:\n      - run: npx prisma migrate deploy\n      - uses: ./.github/actions/disposable-postgres\n';
  assert.match(policy.checkWorkflow('x.yml', early).join(), /before the disposable database is started/);
  const noAction = 'on:\n  pull_request:\njobs:\n  a:\n    steps:\n      - run: npx prisma migrate deploy\n';
  assert.match(policy.checkWorkflow('x.yml', noAction).join(), /mutating Prisma command/);
});

test('policy allows a pull-request workflow that only migrates the disposable database', () => {
  const ok = 'on:\n  pull_request:\njobs:\n  a:\n    steps:\n      - uses: ./.github/actions/disposable-postgres\n      - run: npx prisma migrate deploy\n';
  assert.deepEqual(policy.checkWorkflow('x.yml', ok), []);
});

test('every real workflow in this repository satisfies the policy', () => {
  const files = policy.loadWorkflows(path.resolve(__dirname, '../workflows'));
  assert.ok(files.some((file) => file.name === 'dev-migration.yml'));
  assert.deepEqual(policy.checkWorkflows(files), []);
});

test('the real DEV and PROD migration workflows are manual-only and own their scoped secrets', () => {
  const files = policy.loadWorkflows(path.resolve(__dirname, '../workflows'));
  const dev = files.find((file) => file.name === 'dev-migration.yml');
  const prod = files.find((file) => file.name === 'prod-migration.yml');
  assert.ok(dev);
  assert.ok(prod);
  assert.deepEqual(policy.triggers(dev.text), ['workflow_dispatch']);
  assert.deepEqual(policy.triggers(prod.text), ['workflow_dispatch']);
  const holders = files.filter((file) => /secrets\.ELECTROHUB_/.test(file.text)).map((file) => file.name);
  assert.deepEqual(holders, ['dev-migration.yml', 'prod-migration.yml']);
  assert.match(prod.text, /20261024000000_ai_vector_search,20261025000000_ai_vector_staging_guard/);
  assert.match(prod.text, /BACKUP_EVIDENCE_REFERENCE/);
  assert.match(prod.text, /RESTORE_EVIDENCE_REFERENCE/);
});
