/* Offline-only tests for the fail-closed PostgreSQL acceptance gate. */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const scriptPath = path.resolve(__dirname, 'payment-concurrency-integration-suite.cjs');
const project = 'pzxekjybdiulzmssalfo';
const schema = 'electrohub_payment_concurrency_20261012';
const role = 'eh_payment_concurrency_runner';
const scope = `DEV:${project}:${schema}:${role}:migrate-deploy+fixtures+scenarios-A-J+drop`;
const { cleanupSchema, createClient } = require('./payment-concurrency-integration-suite.cjs');
const scopedUrl = `postgresql://${role}.${project}:not-a-secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require&schema=${schema}&options=-csearch_path%3D${schema}`;

function invoke(overrides, ...args) {
  const env = {
    ...process.env,
    PAYMENT_PG_TEST_DATABASE_URL: scopedUrl,
    PAYMENT_PG_TEST_APPROVED: 'true',
    PAYMENT_PG_TEST_TARGET: 'dev-isolated-schema',
    PAYMENT_PG_TEST_PROJECT_REF: project,
    PAYMENT_PG_TEST_SCHEMA: schema,
    PAYMENT_PG_TEST_ROLE: role,
    PAYMENT_PG_TEST_SCOPE_AUTHORIZATION: scope,
    DATABASE_URL: '',
    DIRECT_URL: '',
    STRIPE_SECRET_KEY: '',
    ...overrides,
  };
  return spawnSync(process.execPath, [scriptPath, ...args], { env, encoding: 'utf8' });
}

describe('payment-concurrency-integration-suite offline gates', () => {
  it('blocks without explicit approval and a scoped DEV target', () => {
    const result = invoke({ PAYMENT_PG_TEST_APPROVED: '', PAYMENT_PG_TEST_DATABASE_URL: '' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /PAYMENT_PG_TEST_APPROVED=true is required/);
  });

  it('rejects PROD and wrong-region pooler identities before any connection', () => {
    for (const url of [
      scopedUrl.replace(project, 'yepfgjehdstlxbpespun').replace('ap-northeast-2', 'ap-northeast-1'),
      scopedUrl.replace('ap-northeast-2', 'ap-northeast-1'),
    ]) {
      const result = invoke({ PAYMENT_PG_TEST_DATABASE_URL: url });
      assert.equal(result.status, 2);
      assert.match(result.stderr, /PROD connection identity is prohibited|Only the DEV ap-northeast-2 session pooler/);
    }
  });

  it('rejects public-schema and unscoped URLs', () => {
    const publicUrl = scopedUrl.replace(schema, 'public');
    const publicResult = invoke({ PAYMENT_PG_TEST_DATABASE_URL: publicUrl, PAYMENT_PG_TEST_SCHEMA: 'public' });
    assert.equal(publicResult.status, 2);
    assert.match(publicResult.stderr, /exact disposable schema/);

    const unscopedResult = invoke({ PAYMENT_PG_TEST_DATABASE_URL: scopedUrl.split('?')[0] });
    assert.equal(unscopedResult.status, 2);
    assert.match(unscopedResult.stderr, /pin both Prisma schema and PostgreSQL search_path/);
  });

  it('validates the exact scope offline without opening a database connection', () => {
    const result = invoke({}, '--check-config');
    if (/Live Stripe configuration is present/.test(result.stderr)) {
      assert.equal(result.status, 2, 'a live key must fail closed');
      return;
    }
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no database connection or mutation performed/);
  });

  it('rejects live Stripe secret and publishable keys without echoing them', () => {
    for (const override of [
      { STRIPE_SECRET_KEY: 'sk_live_neverprint123' },
      { VITE_STRIPE_PUBLISHABLE_KEY: 'pk_live_neverprint456' },
    ]) {
      const result = invoke(override, '--check-config');
      assert.equal(result.status, 2);
      assert.match(result.stderr, /Live Stripe configuration is present/);
      assert.doesNotMatch(result.stderr, /neverprint/);
    }
  });
});

describe('isolated cleanup offline safety', () => {
  function fakeClient(failurePattern, overrides = {}) {
    const statements = [];
    return { statements, connect: async () => {}, end: async () => {},
      query: async sql => {
        statements.push(sql);
        if (failurePattern?.test(sql)) throw new Error('simulated dependency failure');
        if (sql.includes('current_user AS role')) return { rows: [{ role, login: role, db: 'postgres' }] };
        if (sql.includes('FROM pg_stat_activity')) return { rows: [{ count: overrides.otherSessions ?? 0 }] };
        if (sql.includes('n.nspowner')) return { rows: [{ oid: 123, owner: role, marker: scope, ...overrides }] };
        if (sql.includes('regnamespace::oid')) return { rows: [{ oid: 123 }] };
        if (sql.includes('external_dependencies')) return { rows: [{ external_dependencies: overrides.externalDependencies ?? 0 }] };
        if (sql.includes('c.relname AS name')) return { rows: [{ name: '_prisma_migrations', kind: 'r', owner: role }, { name: 'orders', kind: 'r', owner: role }] };
        if (sql.includes('t.typname AS name')) return { rows: [{ name: 'OrderStatus', kind: 'e', owner: role }] };
        if (sql.includes('p.pronamespace =')) return { rows: overrides.routines ?? [] };
        if (sql.includes('to_regnamespace')) return { rows: [{ schema: null }] };
        return { rows: [] };
      } };
  }
  it('drops schema-qualified tables together, then enums and schema with RESTRICT in one transaction', async () => {
    const client = fakeClient();
    await cleanupSchema(scopedUrl, () => client);
    const drops = client.statements.filter(sql => sql.startsWith('DROP'));
    assert.equal(drops.length, 3);
    assert.match(drops[0], /DROP TABLE.*_prisma_migrations.*orders.*RESTRICT/);
    assert.match(drops[1], /DROP TYPE.*OrderStatus.*RESTRICT/);
    assert.match(drops[2], /DROP SCHEMA.*RESTRICT/);
    assert.ok(drops.every(sql => sql.includes(`"${schema}"`) && !/CASCADE|public\./.test(sql)));
    assert.ok(client.statements.includes('COMMIT'));
  });
  it('rolls back and reports a dependency failure without committing partial cleanup', async () => {
    const client = fakeClient(/^DROP TYPE/);
    await assert.rejects(cleanupSchema(scopedUrl, () => client), /dependency failure/);
    assert.ok(client.statements.includes('ROLLBACK'));
    assert.ok(!client.statements.includes('COMMIT'));
    assert.ok(!client.statements.some(sql => sql.startsWith('DROP SCHEMA')));
  });
  it('refuses mismatched ownership before any DROP', async () => {
    const client = fakeClient(null, { owner: 'postgres' });
    await assert.rejects(cleanupSchema(scopedUrl, () => client), /ownership marker/);
    assert.ok(!client.statements.some(sql => sql.startsWith('DROP')));
  });
  it('keeps certificate validation enabled despite sslmode=require', () => {
    const client = createClient(scopedUrl);
    assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
  });
  it('blocks other role sessions, external dependencies and mismatched markers before any DROP', async () => {
    for (const override of [{ otherSessions: 1 }, { externalDependencies: 1 }, { marker: 'wrong-marker' }]) {
      const client = fakeClient(null, override);
      await assert.rejects(cleanupSchema(scopedUrl, () => client));
      assert.ok(!client.statements.some(sql => sql.startsWith('DROP')));
      assert.ok(client.statements.includes('ROLLBACK'));
    }
  });
  it('removes only the owned F trigger function after tables; refuses unexpected routines', async () => {
    const routine = { owner: role, name: 'pgtest_raise_after_transfer', kind: 'f', definer: false,
      argument_count: 0, is_trigger: true, language: 'plpgsql' };
    const client = fakeClient(null, { routines: [routine] });
    await cleanupSchema(scopedUrl, () => client);
    const drops = client.statements.filter(sql => sql.startsWith('DROP'));
    assert.match(drops[1], /DROP FUNCTION.*"pgtest_raise_after_transfer"\(\) RESTRICT$/);
    for (const extra of [{ owner: 'postgres' }, { name: 'unexpected' }, { definer: true }, { argument_count: 1 }]) {
      const bad = fakeClient(null, { routines: [{ ...routine, ...extra }] });
      await assert.rejects(cleanupSchema(scopedUrl, () => bad));
      assert.ok(!bad.statements.some(sql => sql.startsWith('DROP')));
    }
  });
});
