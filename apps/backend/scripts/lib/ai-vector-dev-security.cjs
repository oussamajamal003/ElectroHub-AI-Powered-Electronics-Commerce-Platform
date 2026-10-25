'use strict';
const fs = require('node:fs');
const tls = require('node:tls');
const { DEV_REF, PROD_REF, assertTarget } = require('../../../../.github/scripts/migration-plan.cjs');

/** Authenticate the endpoint independently from the explicit operational approval. */
function devConnectionConfig(env, approval, readFile = file => fs.readFileSync(file, 'utf8')) {
  const raw = env.DIRECT_URL || env.DATABASE_URL;
  assertTarget({ DATABASE_URL: raw, DIRECT_URL: raw }, DEV_REF);
  const url = new URL(raw);
  if (url.hash || decodeURIComponent(url.pathname) !== '/postgres' ||
      !['5432', '6543', ''].includes(url.port)) throw new Error('DEV database endpoint is invalid.');
  if (approval !== DEV_REF) throw new Error('Explicit DEV project approval is required.');
  // node-postgres otherwise replaces an explicit ssl object when these URL options
  // exist. Keep TLS policy outside the URL; reject options that could reroute it.
  for (const key of url.searchParams.keys()) {
    if (!['sslmode', 'sslrootcert', 'pgbouncer', 'connect_timeout'].includes(key)) {
      throw new Error('Unsupported DEV connection option.');
    }
  }
  const caPath = env.DB_SSL_CA_CERT_PATH || url.searchParams.get('sslrootcert');
  const ssl = {
    rejectUnauthorized: true,
    servername: url.hostname,
    checkServerIdentity: tls.checkServerIdentity,
    ...(caPath ? { ca: readFile(caPath) } : {}),
  };
  url.search = '';
  return { connectionString: url.toString(), ssl, connectionTimeoutMillis: 10_000 };
}

function verifiedRoleDsn(admin, user, password, caPath) {
  const url = new URL(admin.toString());
  url.username = user;
  url.password = password;
  url.search = '?sslmode=verify-full';
  if (caPath) url.searchParams.set('sslrootcert', caPath);
  return url.toString();
}
module.exports = { DEV_REF, PROD_REF, devConnectionConfig, verifiedRoleDsn };
