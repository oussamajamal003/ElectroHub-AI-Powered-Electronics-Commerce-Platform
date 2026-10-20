/** Configuration classification is necessary, but never substitutes for authenticated TLS/database preflight. */
export const DEV_PROJECT = 'pzxekjybdiulzmssalfo';
export const PROD_PROJECT = 'yepfgjehdstlxbpespun';
export type DatabaseTarget = {
  category: 'disposable' | 'dev' | 'production';
  identity: string;
  transport: 'local' | 'direct' | 'session-pooler' | 'transaction-pooler';
};

const loopback = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function describeDatabaseTarget(value: string | undefined): DatabaseTarget {
  if (!value) throw new Error('DATABASE_TARGET_MISSING');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('DATABASE_TARGET_INVALID'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash) throw new Error('DATABASE_TARGET_INVALID');
  // pg connection-string options must never override the endpoint or TLS policy validated here.
  // sslrootcert is supported by migration tooling; the runtime strips it and uses DB_SSL_CA_CERT_PATH exclusively.
  const allowedParameters = new Set(['sslmode', 'sslrootcert', 'schema', 'pgbouncer', 'connection_limit', 'pool_timeout', 'connect_timeout']);
  for (const name of url.searchParams.keys()) {
    if (!allowedParameters.has(name) || url.searchParams.getAll(name).length !== 1) throw new Error('DATABASE_TARGET_OPTIONS_INVALID');
  }
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode && !['require', 'verify-ca', 'verify-full'].includes(sslmode)) throw new Error('DATABASE_TLS_REQUIRED');
  // ElectroHub's Prisma models and migrations use public; an alternate search path is a different dataset.
  if (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public') throw new Error('DATABASE_SCHEMA_UNAPPROVED');
  let database: string;
  let username: string;
  try { database = decodeURIComponent(url.pathname.slice(1)); username = decodeURIComponent(url.username); }
  catch { throw new Error('DATABASE_TARGET_INVALID'); }
  const port = Number(url.port || 5432);
  if (loopback.has(url.hostname) && /^electrohub_(?:disposable|ci)[a-z0-9_]*$/.test(database)) {
    return { category: 'disposable', identity: `loopback:${port}/${database}`, transport: 'local' };
  }
  if (database !== 'postgres') throw new Error('DATABASE_TARGET_UNAPPROVED');
  const direct = /^db\.([a-z]{20})\.supabase\.co$/.exec(url.hostname);
  const pooler = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname);
  const project = direct?.[1] ?? (pooler ? /^postgres\.([a-z]{20})$/.exec(username)?.[1] : undefined);
  if (!project || ![DEV_PROJECT, PROD_PROJECT].includes(project) ||
    (direct && (port !== 5432 || username !== 'postgres')) || (pooler && ![5432, 6543].includes(port))) {
    throw new Error('DATABASE_TARGET_UNAPPROVED');
  }
  return { category: project === DEV_PROJECT ? 'dev' : 'production', identity: `supabase:${project}/postgres`,
    transport: direct ? 'direct' : port === 5432 ? 'session-pooler' : 'transaction-pooler' };
}

export function resolveDatabaseTargets(environment: NodeJS.ProcessEnv): {
  runtime: DatabaseTarget; migration: DatabaseTarget; runtimeUrl: string;
} {
  if (environment.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('DATABASE_TLS_REQUIRED');
  const application = describeDatabaseTarget(environment.DATABASE_URL);
  const migration = describeDatabaseTarget(environment.DIRECT_URL);
  if (application.identity !== migration.identity) throw new Error('DATABASE_TARGET_MISMATCH');
  if (environment.NODE_ENV !== 'production' && application.category === 'production') throw new Error('DATABASE_PRODUCTION_FORBIDDEN');
  if (environment.NODE_ENV === 'production' && application.category !== 'production') throw new Error('DATABASE_PRODUCTION_TARGET_REQUIRED');
  if (environment.NODE_ENV === 'test' && application.category !== 'disposable') throw new Error('DATABASE_TEST_TARGET_REQUIRED');
  // Preserve the deployed production connection semantics until an explicit reviewed setting changes them.
  const source = environment.DB_RUNTIME_URL_SOURCE ?? (environment.NODE_ENV === 'production' ? 'direct' : 'database');
  if (!['database', 'direct'].includes(source)) throw new Error('DATABASE_RUNTIME_SOURCE_INVALID');
  const runtime = source === 'direct' ? migration : application;
  if (runtime.transport === 'transaction-pooler') throw new Error('DATABASE_SESSION_CONNECTION_REQUIRED');
  return { runtime, migration, runtimeUrl: (source === 'direct' ? environment.DIRECT_URL : environment.DATABASE_URL)! };
}
