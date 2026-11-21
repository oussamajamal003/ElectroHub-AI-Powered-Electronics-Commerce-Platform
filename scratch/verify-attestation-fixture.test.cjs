'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OIDC_ISSUER,
  PREDICATE_TYPE,
  validateAttestationPolicy,
  buildVerifyArgs,
} = require('./verify-attestation-fixture.cjs');

const digest = '6cb395598f97d26d2bb2eb458463e14eaabbcc68888484483594d5b77b26e8e5';
const commit = '2a54d2e2361306738ec9fe3545135c97510175c0';
const repo = 'oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform';
const workflow = '.github/workflows/test-attestation-fixture.yml';
const ref = 'refs/heads/test/attestation-fixture';

function fixture(overrides = {}) {
  const san = `https://github.com/${repo}/${workflow}@${ref}`;
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: 'disposable-payload.txt', digest: { sha256: digest } }],
    predicateType: PREDICATE_TYPE,
    predicate: { fixture: true },
  };
  const bundle = {
    dsseEnvelope: {
      payloadType: 'application/vnd.in-toto+json',
      payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
      signatures: [{ sig: 'aabbcc' }],
    },
    verificationMaterial: {
      tlogEntries: [{ logIndex: 1, integratedTime: 1770000000, logId: '0123456789abcdef' }],
    },
  };
  const verifierOutput = [{
    attestation: {},
    verificationResult: {
      statement,
      signature: {
        certificate: {
          issuer: OIDC_ISSUER,
          subjectAlternativeName: san,
        },
      },
      verifiedTimestamps: [{ type: 'TlogTimestamp', timestamp: '2026-11-21T12:06:38Z' }],
    },
  }];
  return { bundle, verifierOutput, ...overrides };
}

function expectRejection(overrides, pattern) {
  const value = fixture(overrides);
  assert.throws(() => validateAttestationPolicy({
    bundle: value.bundle,
    verifierOutput: value.verifierOutput,
    payloadBytes: Buffer.from('fixture'),
    payloadSha256: digest,
    repo,
    workflow,
    commit,
    ref,
  }), pattern);
}

test('valid expected identity and bundle structure passes', () => {
  const value = fixture();
  assert.equal(validateAttestationPolicy({
    bundle: value.bundle,
    verifierOutput: value.verifierOutput,
    payloadBytes: Buffer.from('fixture'),
    payloadSha256: digest,
    repo,
    workflow,
    commit,
    ref,
  }), true);
});

test('wrong repository is rejected', () => {
  const value = fixture();
  value.verifierOutput[0].verificationResult.signature.certificate.subjectAlternativeName =
    `https://github.com/github/docs/${workflow}@${ref}`;
  assert.throws(() => validateAttestationPolicy({ bundle: value.bundle, verifierOutput: value.verifierOutput, payloadSha256: digest, repo, workflow, commit, ref }), /certificate SAN/);
});

test('wrong workflow path is rejected', () => {
  const value = fixture();
  value.verifierOutput[0].verificationResult.signature.certificate.subjectAlternativeName =
    `https://github.com/${repo}/.github/workflows/ci.yml@${ref}`;
  assert.throws(() => validateAttestationPolicy({ bundle: value.bundle, verifierOutput: value.verifierOutput, payloadSha256: digest, repo, workflow, commit, ref }), /certificate SAN/);
});

test('wrong workflow ref or commit is rejected', () => {
  const value = fixture();
  value.verifierOutput[0].verificationResult.signature.certificate.subjectAlternativeName =
    `https://github.com/${repo}/${workflow}@refs/heads/main`;
  assert.throws(() => validateAttestationPolicy({ bundle: value.bundle, verifierOutput: value.verifierOutput, payloadSha256: digest, repo, workflow, commit, ref }), /certificate SAN/);

  const goodRefValue = fixture();
  const args = buildVerifyArgs({ payload: 'fixture', bundle: 'bundle.json', repo, workflow, commit: '0123456789abcdef0123456789abcdef01234567', ref });
  assert.ok(args.includes('0123456789abcdef0123456789abcdef01234567'));
  assert.throws(() => validateAttestationPolicy({ bundle: goodRefValue.bundle, verifierOutput: goodRefValue.verifierOutput, payloadSha256: digest, repo, workflow, commit: 'bad', ref }), /full lowercase SHA/);
});

test('wrong certificate issuer is rejected', () => {
  const value = fixture();
  value.verifierOutput[0].verificationResult.signature.certificate.issuer = 'https://evil.example';
  assert.throws(() => validateAttestationPolicy({ bundle: value.bundle, verifierOutput: value.verifierOutput, payloadSha256: digest, repo, workflow, commit, ref }), /certificate issuer/);
});

test('wrong certificate SAN identity is rejected', () => {
  const value = fixture();
  value.verifierOutput[0].verificationResult.signature.certificate.subjectAlternativeName =
    `https://github.com/${repo}/${workflow}.attacker.yml@${ref}`;
  assert.throws(() => validateAttestationPolicy({ bundle: value.bundle, verifierOutput: value.verifierOutput, payloadSha256: digest, repo, workflow, commit, ref }), /certificate SAN/);
});

test('payload digest mismatch is rejected', () => {
  const value = fixture();
  assert.throws(() => validateAttestationPolicy({ bundle: value.bundle, verifierOutput: value.verifierOutput, payloadSha256: '0'.repeat(64), repo, workflow, commit, ref }), /payload digest|bundle payload digest/);
});

test('payload tampering is distinguished by mismatch', () => {
  const value = fixture();
  assert.throws(() => validateAttestationPolicy({ bundle: value.bundle, verifierOutput: value.verifierOutput, payloadSha256: '1'.repeat(64), repo, workflow, commit, ref }), /payload digest|bundle payload digest/);
});

test('missing or malformed bundle is rejected', () => {
  assert.throws(() => validateAttestationPolicy({ bundle: null, verifierOutput: [], payloadSha256: digest, repo, workflow, commit, ref }), /bundle|DSSE|verifier/i);
  const value = fixture();
  value.bundle.dsseEnvelope.signatures = [];
  assert.throws(() => validateAttestationPolicy({ bundle: value.bundle, verifierOutput: value.verifierOutput, payloadSha256: digest, repo, workflow, commit, ref }), /DSSE signatures/);
});

test('missing transparency-log evidence is rejected', () => {
  const value = fixture();
  value.bundle.verificationMaterial.tlogEntries = [];
  assert.throws(() => validateAttestationPolicy({ bundle: value.bundle, verifierOutput: value.verifierOutput, payloadSha256: digest, repo, workflow, commit, ref }), /transparency-log/);
});

test('verify arguments preserve exact trust constraints', () => {
  const args = buildVerifyArgs({ payload: 'payload.txt', bundle: 'bundle.json', repo, workflow, commit, ref });
  assert.ok(args.includes('--cert-identity'));
  assert.ok(args.includes(`https://github.com/${repo}/${workflow}@${ref}`));
  assert.ok(args.includes('--cert-oidc-issuer'));
  assert.ok(args.includes(OIDC_ISSUER));
  assert.ok(args.includes('--source-digest'));
  assert.ok(args.includes(commit));
  assert.ok(args.includes('--source-ref'));
  assert.ok(args.includes(ref));
  assert.ok(args.includes('--predicate-type'));
  assert.ok(args.includes(PREDICATE_TYPE));
});
