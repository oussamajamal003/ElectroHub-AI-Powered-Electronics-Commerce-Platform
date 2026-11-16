'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { X509Certificate } = require('node:crypto');
const tls = require('node:tls');
const { verifyRoot } = require('./payment-pg-ca.cjs');
const blocks = fs.readFileSync(path.join(__dirname, '../prisma/supabase-ca.pem'), 'utf8')
  .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
const [leaf, intermediate, root] = blocks.map(pem => new X509Certificate(pem));
it('accepts only the expected current self-signed CA root, not leaf/intermediate/bundle', () => {
  assert.equal(verifyRoot(blocks[2]), root.fingerprint256);
  for (const pem of [blocks[0], blocks[1], blocks.join('\n'), 'invalid']) assert.throws(() => verifyRoot(pem));
});
it('validates retained chain signatures and exact endpoint hostname', () => {
  assert.ok(!tls.rootCertificates.some(pem => new X509Certificate(pem).fingerprint256 === root.fingerprint256),
    'Supabase private root is absent from Node bundled trust anchors');
  assert.equal(leaf.verify(intermediate.publicKey), true);
  assert.equal(intermediate.verify(root.publicKey), true);
  assert.equal(leaf.verify(root.publicKey), false);
  assert.equal(tls.checkServerIdentity('aws-0-ap-northeast-2.pooler.supabase.com', leaf.toLegacyObject()), undefined);
  assert.ok(tls.checkServerIdentity('wrong.example.com', leaf.toLegacyObject()));
});
