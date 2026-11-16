/*
 * Task 03.6 real PostgreSQL payment ownership acceptance runner.
 *
 * This runner is intentionally restricted to one pre-provisioned, disposable
 * schema and one dedicated login role in the authorized DEV project. It never
 * creates a role/schema, never connects with the application .env URL, never
 * runs a global worker, and never calls Stripe. The PostgreSQL work begins only
 * after every explicit scope gate and read-only isolation probe passes.
 *
 * Scenarios A-J execute through the actual PaymentService, CartService,
 * OrderService, webhook route, and Prisma Serializable transactions in
 * src/services/__tests__/payment.concurrency.postgres.integration.test.ts.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { stageDefinitions, fileMonitor, runChild, executeStages, signalControl } = require('./payment-pg-execution.cjs');

const PROJECT_REF = 'pzxekjybdiulzmssalfo';
const REGION = 'ap-northeast-2';
const DATABASE = 'postgres';
const SCHEMA = 'electrohub_payment_concurrency_20261012';
const ROLE = 'eh_payment_concurrency_runner';
const TARGET = 'dev-isolated-schema';
const SCOPE_AUTHORIZATION = `DEV:${PROJECT_REF}:${SCHEMA}:${ROLE}:migrate-deploy+fixtures+scenarios-A-J+drop`;
const TABLES_TO_PROBE = ['users', 'carts', 'cart_items', 'payment_attempts', 'payment_attempt_items',
  'payment_work', 'orders', 'payments', 'order_items', 'stripe_events'];
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const backendRoot = path.resolve(__dirname, '..');

function block(message) {
  console.error(`BLOCKED: ${message}`);
  process.exitCode = 2;
}

function unquoteEnvValue(raw) {
  const match = raw.trim().match(/^(?:"([^"]*)"|'([^']*)'|([^#\s]*))/);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function configuredStripeValues() {
  const configured = Object.entries(process.env).filter(([name]) => /stripe/i.test(name));
  const envNames = ['.env', '.env.local', '.env.test.local', '.env.production.local', '.env.development.local'];
  const roots = [backendRoot, path.resolve(backendRoot, '..', 'frontend')];
  for (const root of roots) for (const file of envNames) {
    const fullPath = path.join(root, file);
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*STRIPE[A-Za-z0-9_]*)\s*=/i);
        if (match) configured.push([match[1], unquoteEnvValue(line.slice(line.indexOf('=') + 1))]);
      }
    } catch { /* Missing env files are normal; values are never emitted. */ }
  }
  return configured;
}

function validateConfiguration(requireApproval = true) {
  const urlValue = process.env.PAYMENT_PG_TEST_DATABASE_URL;
  if (requireApproval && process.env.PAYMENT_PG_TEST_APPROVED !== 'true') return 'PAYMENT_PG_TEST_APPROVED=true is required.';
  if (process.env.PAYMENT_PG_TEST_TARGET !== TARGET) return `PAYMENT_PG_TEST_TARGET=${TARGET} is required.`;
  if (process.env.PAYMENT_PG_TEST_PROJECT_REF !== PROJECT_REF) return `PAYMENT_PG_TEST_PROJECT_REF must identify DEV project ${PROJECT_REF}.`;
  if (process.env.PAYMENT_PG_TEST_SCHEMA !== SCHEMA || !IDENTIFIER.test(process.env.PAYMENT_PG_TEST_SCHEMA ?? '')) {
    return `PAYMENT_PG_TEST_SCHEMA must be the exact disposable schema ${SCHEMA}.`;
  }
  if (process.env.PAYMENT_PG_TEST_ROLE !== ROLE || !IDENTIFIER.test(process.env.PAYMENT_PG_TEST_ROLE ?? '')) {
    return `PAYMENT_PG_TEST_ROLE must be the dedicated restricted role ${ROLE}.`;
  }
  if (process.env.PAYMENT_PG_TEST_SCOPE_AUTHORIZATION !== SCOPE_AUTHORIZATION) {
    return 'PAYMENT_PG_TEST_SCOPE_AUTHORIZATION does not match the exact DEV schema, role, migration, fixture, scenario, and cleanup scope.';
  }
  if (!urlValue) return 'PAYMENT_PG_TEST_DATABASE_URL is required; generic DATABASE_URL/DIRECT_URL are never used as the test target.';

  let parsed;
  try { parsed = new URL(urlValue); } catch { return 'PAYMENT_PG_TEST_DATABASE_URL is not a valid PostgreSQL URL.'; }
  const lowerTarget = `${parsed.hostname} ${parsed.username} ${parsed.pathname}`.toLowerCase();
  if (lowerTarget.includes('yepfgjehdstlxbpespun') || lowerTarget.includes('ap-northeast-1')) return 'PROD connection identity is prohibited.';
  if (parsed.hostname !== `aws-0-${REGION}.pooler.supabase.com` || parsed.port !== '5432') {
    return 'Only the DEV ap-northeast-2 session pooler on port 5432 is accepted.';
  }
  if (decodeURIComponent(parsed.username) !== `${ROLE}.${PROJECT_REF}` || parsed.pathname !== `/${DATABASE}`) {
    return 'Connection URL must authenticate directly as the restricted DEV test role against the postgres database.';
  }
  if (parsed.searchParams.get('schema') !== SCHEMA || parsed.searchParams.get('options') !== `-csearch_path=${SCHEMA}`) {
    return 'Connection URL must pin both Prisma schema and PostgreSQL search_path to the exact disposable schema.';
  }
  if (parsed.searchParams.get('sslmode') !== 'require' || parsed.searchParams.get('pgbouncer') === 'true') {
    return 'Use TLS and the DEV session pooler; transaction-pooler URLs are prohibited.';
  }
  const allowedOptions = new Set(['sslmode', 'connection_limit', 'schema', 'options']);
  const seenOptions = new Set();
  for (const [name] of parsed.searchParams) {
    if (!allowedOptions.has(name) || seenOptions.has(name)) return 'Unexpected or duplicate URL options are prohibited.';
    seenOptions.add(name);
  }
  if (parsed.searchParams.has('connection_limit') && parsed.searchParams.get('connection_limit') !== '4') {
    return 'The isolated integration connection cap must be four.';
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') return 'Unsafe TLS override is prohibited.';
  if ((process.env.DATABASE_URL && process.env.DATABASE_URL !== urlValue) ||
      (process.env.DIRECT_URL && process.env.DIRECT_URL !== urlValue)) {
    return 'Existing DATABASE_URL or DIRECT_URL is not identically schema-scoped; refusing ambiguous Prisma CLI configuration.';
  }

  const stripeConfig = configuredStripeValues();
  if (stripeConfig.some(([name, value]) => /(?:sk|rk|pk)_live_[A-Za-z0-9]+/i.test(value) ||
      /stripe.*mode/i.test(name) && /^live$/i.test(value.trim()))) {
    return 'Live Stripe configuration is present; the PostgreSQL suite refuses to start.';
  }
  return null;
}

function createClient(connectionString) {
  const parsed = new URL(connectionString);
  // pg parses URL SSL settings after the explicit config; prevent sslmode=require
  // from replacing certificate validation with rejectUnauthorized=false.
  for (const name of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) parsed.searchParams.delete(name);
  return new Client({ connectionString: parsed.toString(), connectionTimeoutMillis: 5000,
    query_timeout: 15000, statement_timeout: 15000, lock_timeout: 5000,
    ssl: { rejectUnauthorized: true } });
}

async function verifyIsolatedTarget(client, { onStage = () => {}, transactional = false } = {}) {
  onStage('role_identity');
  const identity = (await client.query(`SELECT current_database() AS db, current_user AS role,
      session_user AS session_role, current_schema() AS schema,
      current_schemas(false)::text[] AS explicit_schemas,
      current_setting('search_path') AS search_path,
      current_setting('max_connections')::int AS max_connections,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS current_connections`)).rows[0];
  if (!identity || identity.db !== DATABASE || identity.role !== ROLE || identity.session_role !== ROLE) {
    throw new Error('Restricted identity mismatch.');
  }
  onStage('schema_search_path');
  if (identity.schema !== SCHEMA || identity.search_path !== SCHEMA ||
      JSON.stringify(identity.explicit_schemas) !== JSON.stringify([SCHEMA])) {
    const error = new Error('Schema isolation verification failed.');
    error.safeChecks = { schema_matches: identity.schema === SCHEMA,
      search_path_matches: identity.search_path === SCHEMA,
      explicit_schemas_is_array: Array.isArray(identity.explicit_schemas),
      explicit_schemas_matches: JSON.stringify(identity.explicit_schemas) === JSON.stringify([SCHEMA]) };
    throw error;
  }
  onStage('database_reserve');
  if (identity.current_connections + 4 >= identity.max_connections) {
    throw new Error('PostgreSQL max_connections reserve is too low for the bounded four-connection test pool.');
  }

  onStage('role_permissions');
  const roleState = (await client.query(`SELECT r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls, r.rolcanlogin,
      r.rolinherit, r.rolreplication, r.rolconnlimit,
      (SELECT count(*)::int FROM pg_roles parent WHERE parent.oid <> r.oid AND pg_has_role(r.oid, parent.oid, 'MEMBER')) AS membership_count,
      pg_has_role(current_user, 'anon', 'MEMBER') AS member_anon,
      pg_has_role(current_user, 'authenticated', 'MEMBER') AS member_authenticated,
      pg_has_role(current_user, 'service_role', 'MEMBER') AS member_service_role,
      has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_schema,
      has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public,
      (SELECT count(*)::int FROM pg_namespace n WHERE n.nspname <> current_schema()
        AND has_schema_privilege(current_user, n.oid, 'CREATE')) AS out_of_scope_schema_create
    FROM pg_roles r WHERE r.rolname = current_user`)).rows[0];
  if (!roleState || roleState.rolsuper || roleState.rolcreaterole || roleState.rolcreatedb || roleState.rolbypassrls ||
      !roleState.rolcanlogin || roleState.rolinherit || roleState.rolreplication || roleState.rolconnlimit !== 4 ||
      roleState.membership_count !== 0 || roleState.member_anon || roleState.member_authenticated || roleState.member_service_role ||
      roleState.can_create_schema || roleState.can_create_public || roleState.out_of_scope_schema_create !== 0) {
    throw new Error('The test role has elevated privileges, role memberships, unexpected inheritance/replication flags, or an unbounded connection limit; isolation cannot be demonstrated.');
  }

  onStage('public_relation_permissions');
  const publicPrivileges = (await client.query(`SELECT
      count(*) FILTER (WHERE has_table_privilege(current_user, c.oid, 'SELECT') OR EXISTS (
        SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          AND has_column_privilege(current_user, c.oid, a.attnum, 'SELECT')))::int AS selectable,
      count(*) FILTER (WHERE has_table_privilege(current_user, c.oid, 'INSERT') OR
        has_table_privilege(current_user, c.oid, 'UPDATE') OR has_table_privilege(current_user, c.oid, 'DELETE') OR
        has_table_privilege(current_user, c.oid, 'TRUNCATE') OR has_table_privilege(current_user, c.oid, 'REFERENCES') OR
        has_table_privilege(current_user, c.oid, 'TRIGGER') OR has_table_privilege(current_user, c.oid, 'MAINTAIN') OR EXISTS (
          SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            AND (has_column_privilege(current_user, c.oid, a.attnum, 'INSERT') OR
              has_column_privilege(current_user, c.oid, a.attnum, 'UPDATE') OR
              has_column_privilege(current_user, c.oid, a.attnum, 'REFERENCES'))))::int AS writable
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')`)).rows[0];
  onStage('public_sequence_permissions');
  const publicSequences = (await client.query(`SELECT count(*)::int AS privileged
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND CASE WHEN c.relkind = 'S' THEN
      (has_sequence_privilege(current_user, c.oid, 'USAGE') OR has_sequence_privilege(current_user, c.oid, 'SELECT') OR
        has_sequence_privilege(current_user, c.oid, 'UPDATE')) ELSE false END`)).rows[0];
  onStage('security_definer_permissions');
  const publicDefinerFunctions = (await client.query(`SELECT count(*)::int AS executable
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege(current_user, p.oid, 'EXECUTE')`)).rows[0];
  if (publicPrivileges.selectable !== 0 || publicPrivileges.writable !== 0 || publicSequences.privileged !== 0 ||
      publicDefinerFunctions.executable !== 0) {
    throw new Error('Restricted test role can access public relations/sequences or execute a public SECURITY DEFINER function.');
  }

  // LIMIT 0 is a privilege probe only: it cannot return existing financial rows.
  for (const table of TABLES_TO_PROBE) {
    onStage(`denial_${table}`);
    if (transactional) await client.query('SAVEPOINT denial_probe');
    try {
      await client.query(`SELECT * FROM public.${quoteIdentifier(table)} LIMIT 0`);
      throw new Error(`Public-schema access probe unexpectedly succeeded for ${table}.`);
    } catch (error) {
      if (error?.code !== '42501') throw error;
      if (transactional) await client.query('ROLLBACK TO SAVEPOINT denial_probe');
    }
    if (transactional) await client.query('RELEASE SAVEPOINT denial_probe');
  }

  onStage('schema_marker_emptiness');
  const schema = (await client.query(`SELECT n.oid, n.nspowner::regrole::text AS owner,
      obj_description(n.oid, 'pg_namespace') AS marker,
      (SELECT count(*)::int FROM pg_class c WHERE c.relnamespace = n.oid) AS relation_count,
      (SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = n.oid) AS function_count,
      (SELECT count(*)::int FROM pg_type t WHERE t.typnamespace = n.oid AND t.typrelid = 0 AND
        t.typtype <> 'p' AND t.typelem = 0) AS standalone_type_count
    FROM pg_namespace n WHERE n.nspname = $1`, [SCHEMA])).rows[0];
  if (!schema || schema.owner !== ROLE || schema.marker !== SCOPE_AUTHORIZATION ||
      schema.relation_count !== 0 || schema.function_count !== 0 || schema.standalone_type_count !== 0) {
    throw new Error('The exact test schema is missing, not owned/marked by the restricted role, or not empty.');
  }
  return { identity, currentConnections: identity.current_connections, maxConnections: identity.max_connections };
}

function quoteIdentifier(value) { return `"${value.replaceAll('"', '""')}"`; }

async function checkExternalDependencies(client) {
  const row = (await client.query(`WITH objects(classid, objid, namespace_oid) AS (
      SELECT 'pg_class'::regclass, c.oid, c.relnamespace FROM pg_class c
      UNION ALL SELECT 'pg_type'::regclass, t.oid, t.typnamespace FROM pg_type t
      UNION ALL SELECT 'pg_proc'::regclass, p.oid, p.pronamespace FROM pg_proc p
      UNION ALL SELECT 'pg_constraint'::regclass, c.oid, c.connamespace FROM pg_constraint c
      UNION ALL SELECT 'pg_rewrite'::regclass, r.oid, c.relnamespace FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class
    )
    SELECT count(*)::int AS external_dependencies
    FROM pg_depend d JOIN objects ref ON ref.classid = d.refclassid AND ref.objid = d.refobjid
      JOIN objects dep ON dep.classid = d.classid AND dep.objid = d.objid
    WHERE ref.namespace_oid = $1::oid AND dep.namespace_oid <> $1::oid`,
  [(await client.query('SELECT $1::regnamespace::oid AS oid', [SCHEMA])).rows[0].oid])).rows[0];
  if (!row || row.external_dependencies !== 0) {
    throw new Error(`Refusing schema cleanup: found ${row?.external_dependencies ?? 'unknown'} external dependency/dependencies.`);
  }
}

async function cleanupSchema(connectionString, clientFactory = createClient) {
  const client = clientFactory(connectionString);
  let failure = null;
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const identity = (await client.query('SELECT current_user AS role, session_user AS login, current_database() AS db')).rows[0];
    if (identity?.role !== ROLE || identity.login !== ROLE || identity.db !== DATABASE) {
      throw new Error('Refusing cleanup: restricted session identity does not match.');
    }
    const otherSessions = (await client.query(`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE usename = current_user AND pid <> pg_backend_pid()`)).rows[0];
    if (otherSessions?.count !== 0) throw new Error('Refusing cleanup: other runner-role sessions still exist.');
    const schema = (await client.query(`SELECT n.oid, n.nspowner::regrole::text AS owner,
        obj_description(n.oid, 'pg_namespace') AS marker
      FROM pg_namespace n WHERE n.nspname = $1`, [SCHEMA])).rows[0];
    if (schema && (schema.owner !== ROLE || schema.marker !== SCOPE_AUTHORIZATION)) {
      throw new Error('Refusing cleanup: schema ownership marker no longer matches the exact authorized scope.');
    }
    if (schema) {
      await checkExternalDependencies(client);
      const relations = (await client.query(`SELECT c.relname AS name, c.relkind AS kind,
          c.relowner::regrole::text AS owner FROM pg_class c
        WHERE c.relnamespace = $1::oid ORDER BY c.relname`, [schema.oid])).rows;
      const types = (await client.query(`SELECT t.typname AS name, t.typtype AS kind,
          t.typowner::regrole::text AS owner FROM pg_type t
        WHERE t.typnamespace = $1::oid AND t.typrelid = 0 AND t.typelem = 0`, [schema.oid])).rows;
      const routines = (await client.query(`SELECT p.proname AS name, p.proowner::regrole::text AS owner,
          p.prokind AS kind, p.prosecdef AS definer, p.pronargs AS argument_count,
          p.prorettype = 'trigger'::regtype AS is_trigger, l.lanname AS language
        FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.pronamespace = $1::oid`, [schema.oid])).rows;
      const allowedRoutine = r => r.owner === ROLE && r.name === 'pgtest_raise_after_transfer' &&
        r.kind === 'f' && !r.definer && r.argument_count === 0 && r.is_trigger && r.language === 'plpgsql';
      if (routines.some(r => !allowedRoutine(r)) || relations.some(r => r.owner !== ROLE || !['r', 'i', 'S'].includes(r.kind)) ||
          types.some(t => t.owner !== ROLE || t.kind !== 'e')) {
        throw new Error('Refusing cleanup: unsupported or externally owned schema objects.');
      }
      const qualified = name => `${quoteIdentifier(SCHEMA)}.${quoteIdentifier(name)}`;
      // One table drop handles mutual internal FKs. Indexes, constraints, triggers,
      // row types and owned sequences follow their tables; external dependents block RESTRICT.
      const tables = relations.filter(r => r.kind === 'r');
      if (tables.length) await client.query(`DROP TABLE ${tables.map(r => qualified(r.name)).join(', ')} RESTRICT`);
      for (const routine of routines) await client.query(`DROP FUNCTION ${qualified(routine.name)}() RESTRICT`);
      const sequences = (await client.query("SELECT relname AS name FROM pg_class WHERE relnamespace = $1::oid AND relkind = 'S'", [schema.oid])).rows;
      if (sequences.length) await client.query(`DROP SEQUENCE ${sequences.map(r => qualified(r.name)).join(', ')} RESTRICT`);
      if (types.length) await client.query(`DROP TYPE ${types.map(t => qualified(t.name)).join(', ')} RESTRICT`);
      await client.query(`DROP SCHEMA ${quoteIdentifier(SCHEMA)} RESTRICT`);
    }
    const verify = (await client.query('SELECT to_regnamespace($1)::text AS schema', [SCHEMA])).rows[0];
    if (verify?.schema !== null) throw new Error('Schema cleanup verification failed; the approved schema still exists.');
    await client.query('COMMIT');
  } catch (error) {
    failure = error;
    try { await client.query('ROLLBACK'); } catch (rollbackError) {
      failure = new AggregateError([error, rollbackError], 'Cleanup failed and rollback could not be confirmed.');
    }
  }
  try { await client.end(); } catch (error) { failure ??= error; }
  if (failure) throw failure;
}

async function main() {
  const configError = validateConfiguration();
  if (configError) return block(configError);
  const connectionString = process.env.PAYMENT_PG_TEST_DATABASE_URL;
  if (process.argv.includes('--check-config')) {
    console.log('CONFIG PASS: exact DEV scope and schema-scoped URL shape; no database connection or mutation performed.');
    return;
  }
  if (!process.argv.includes('--run')) return block('pass --run for the explicitly approved database suite, or --check-config for offline gate validation.');

  // Check local execution prerequisites before any database connection or mutation.
  const monitor = fileMonitor(process.env.PAYMENT_PG_TEST_MONITOR_FILE,
    process.env.PAYMENT_PG_TEST_POOLER_RISK_ACCEPTED === 'true');
  if (process.argv.includes('--cleanup-owned')) {
    if (process.env.PAYMENT_PG_TEST_INTERNAL_RUN !== 'cleanup') return block('Cleanup requires the owned runner child.');
    monitor(false);
    await cleanupSchema(connectionString);
    console.log('OWNED_CLEANUP_VERIFIED');
    return;
  }
  const stages = stageDefinitions();
  monitor(true);
  const controls = signalControl();
  const { controller, cleanupController } = controls;

  let preflight;
  let preflightError = null;
  const client = createClient(connectionString);
  try {
    await client.connect();
    preflight = await verifyIsolatedTarget(client);
  } catch (error) {
    preflightError = error;
  } finally {
    try { await client.end(); } catch (error) { preflightError ??= error; }
  }
  if (preflightError) {
    controls.dispose();
    return block('read-only DEV isolation preflight failed; raw error suppressed.');
  }
  try {
    console.log(`ISOLATED DEV TARGET VERIFIED: ${PROJECT_REF}/${SCHEMA}; database session snapshot ${preflight.currentConnections}/${preflight.maxConnections}.`);
    const ok = await executeStages(stages, { monitor, signal: controller.signal,
      cleanup: async () => {
        const result = await runChild({ name: 'cleanup', args: [__filename, '--run', '--cleanup-owned'],
          env: { ...process.env, PAYMENT_PG_TEST_INTERNAL_RUN: 'cleanup' }, timeoutMs: 60_000 },
        { monitor, signal: cleanupController.signal });
        if (result.stdout.trim() !== 'OWNED_CLEANUP_VERIFIED') throw new Error('Cleanup evidence missing.');
      } });
    if (!ok) process.exitCode = 1;
    else console.log('POSTGRESQL CONCURRENCY SUITE PASS: ten A-J tests passed and owned cleanup verified.');
  } finally {
    controls.dispose();
  }
}

module.exports = { cleanupSchema, createClient, verifyIsolatedTarget, validateConfiguration };
if (require.main === module) main().catch(error => {
  console.error(`FATAL: ${error.label ?? 'RUNNER_FAILED'}`);
  process.exitCode = 1;
});
