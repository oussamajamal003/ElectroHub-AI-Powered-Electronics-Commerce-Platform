'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const tls = require('node:tls');
const { DEV_REF, PROD_REF, devConnectionConfig, verifiedRoleDsn } = require('./lib/ai-vector-dev-security.cjs');
const url = ref => `postgresql://postgres.${ref}:fixture-password@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require`;

test('DEV helper requires the canonical project, approved operation and recognized endpoint', () => {
  const env = { DIRECT_URL: url(DEV_REF) };
  assert.throws(() => devConnectionConfig(env), /approval/);
  assert.throws(() => devConnectionConfig(env, PROD_REF), /approval/);
  assert.throws(() => devConnectionConfig({ DIRECT_URL: url(PROD_REF) }, DEV_REF), /production/);
  assert.throws(() => devConnectionConfig({ DIRECT_URL: url('aaaaaaaaaaaaaaaaaaaa') }, DEV_REF), /different project/);
  assert.throws(() => devConnectionConfig({ DIRECT_URL: url(DEV_REF).replace('aws-0-ap-northeast-2.pooler.supabase.com', 'untrusted.example') }, DEV_REF), /recognised/);
  assert.throws(() => devConnectionConfig({ DIRECT_URL: `${url(DEV_REF)}&host=untrusted.example` }, DEV_REF), /Unsupported/);
});

test('TLS configuration cannot be replaced by connection string SSL flags', () => {
  const config = devConnectionConfig({ DIRECT_URL: url(DEV_REF), DB_SSL_CA_CERT_PATH: 'approved-ca.pem' }, DEV_REF, () => 'approved-ca');
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.ca, 'approved-ca');
  assert.equal(config.ssl.servername, 'aws-0-ap-northeast-2.pooler.supabase.com');
  assert.equal(config.ssl.checkServerIdentity, tls.checkServerIdentity);
  assert.equal(new URL(config.connectionString).search, '');
});

test('hostname verification rejects an otherwise trusted certificate for another host', () => {
  const config = devConnectionConfig({ DIRECT_URL: url(DEV_REF) }, DEV_REF);
  const otherCertificate = { subject: { CN: 'other.example' }, subjectaltname: 'DNS:other.example' };
  assert.equal(config.ssl.checkServerIdentity(config.ssl.servername, otherCertificate).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
});

test('all delegated libpq role connections require full verification', () => {
  const result = new URL(verifiedRoleDsn(new URL(url(DEV_REF)), `ai_vector_reader.${DEV_REF}`, 'fixture-password', 'approved-ca.pem'));
  assert.equal(result.searchParams.get('sslmode'), 'verify-full');
  assert.equal(result.searchParams.get('sslrootcert'), 'approved-ca.pem');
});
