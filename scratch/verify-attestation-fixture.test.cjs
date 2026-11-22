'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OIDC_ISSUER,
  PREDICATE_TYPE,
  sha256Hex,
  validateAttestationPolicy,
  buildVerifyArgs,
} = require('./verify-attestation-fixture.cjs');

const payloadBytes = Buffer.from('ElectroHub synthetic fixture payload\n');
const digest = sha256Hex(payloadBytes);
const commit = '2a54d2e2361306738ec9fe3545135c97510175c0';
const repo = 'oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform';
const workflow = '.github/workflows/test-attestation-fixture.yml';
const ref = 'refs/heads/test/attestation-fixture';

function fixture() {
  const san = `https://github.com/${repo}/${workflow}@${ref}`;
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: 'disposable-payload.txt', digest: { sha256: digest } }],
    predicateType: PREDICATE_TYPE,
    predicate: { fixture: true },
  };
  return {
    bundle: {
      dsseEnvelope: {
        payloadType: 'application/vnd.in-toto+json',
        payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
        signatures: [{ sig: 'synthetic-signature-not-cryptographically-valid' }],
      },
      verificationMaterial: {
        tlogEntries: [{ logIndex: 1, integratedTime: 1770000000, logId: { keyId: '0'.repeat(64) } }],
      },
    },
    verifierOutput: [{
      attestation: {},
      verificationResult: {
        statement,
        signature: { certificate: { issuer: OIDC_ISSUER, subjectAlternativeName: san } },
        verifiedTimestamps: [{ type: 'SyntheticTimestamp', timestamp: '2026-11-21T12:06:38Z' }],
      },
    }],
  };
}

function policyArgs(overrides = {}) {
  const value = fixture();
  return {
    bundle: value.bundle,
    verifierOutput: value.verifierOutput,
    payloadBytes,
    payloadSha256: digest,
    repo,
    workflow,
    commit,
    ref,
    ...overrides,
  };
}

// Synthetic policy tests only. gh attestation verify owns signature, certificate, trust-root, and Rekor verification.
test('actual payload bytes and matching supplied digest pass', () => {
  assert.equal(validateAttestationPolicy(policyArgs()), true);
});

test('missing payload bytes are rejected', () => {
  assert.throws(() => validateAttestationPolicy(policyArgs({ payloadBytes: null })), /Payload bytes/);
  assert.throws(() => validateAttestationPolicy(policyArgs({ payloadBytes: Buffer.alloc(0) })), /Payload bytes/);
});

test('malformed supplied payload digest is rejected', () => {
  assert.throws(() => validateAttestationPolicy(policyArgs({ payloadSha256: 'not-a-digest' })), /malformed/);
});

test('supplied digest matching the attestation but differing from actual payload bytes is rejected', () => {
  const value = fixture();
  assert.throws(() => validateAttestationPolicy({
    ...policyArgs(),
    payloadBytes: Buffer.from('tampered payload bytes'),
    payloadSha256: digest,
  }), /differs from actual payload bytes/);
  assert.equal(value.bundle.dsseEnvelope.payload.length > 0, true);
});

test('verifier statement subject digest differing from actual payload is rejected', () => {
  const value = fixture();
  value.verifierOutput[0].verificationResult.statement.subject[0].digest.sha256 = '0'.repeat(64);
  assert.throws(() => validateAttestationPolicy({ bundle: value.bundle, verifierOutput: value.verifierOutput, payloadBytes, payloadSha256: digest, repo, workflow, commit, ref }), /verifier statement payload digest/);
});

test('DSSE subject digest differing from actual payload is rejected', () => {
  const value = fixture();
  const statement = JSON.parse(Buffer.from(value.bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
  statement.subject[0].digest.sha256 = '1'.repeat(64);
  value.bundle.dsseEnvelope.payload = Buffer.from(JSON.stringify(statement)).toString('base64');
  assert.throws(() => validateAttestationPolicy({ bundle: value.bundle, verifierOutput: value.verifierOutput, payloadBytes, payloadSha256: digest, repo, workflow, commit, ref }), /bundle payload digest/);
});

test('wrong repository is rejected by SAN policy and authoritative CLI repository constraint', () => {
  const value = fixture();
  value.verifierOutput[0].verificationResult.signature.certificate.subjectAlternativeName = `https://github.com/github/docs/${workflow}@${ref}`;
  assert.throws(() => validateAttestationPolicy({ bundle: value.bundle, verifierOutput: value.verifierOutput, payloadBytes, payloadSha256: digest, repo, workflow, commit, ref }), /certificate SAN/);
  const args = buildVerifyArgs({ payload: 'payload.txt', bundle: 'bundle.json', repo: 'github/docs', workflow, commit, ref });
  assert.ok(args.includes('--repo') && args.includes('github/docs'));
});

test('wrong workflow path and lookalike workflow are rejected', () => {
  for (const wrongWorkflow of ['.github/workflows/ci.yml', '.github/workflows/test-attestation-fixture.yml.attacker.yml']) {
    const value = fixture();
    value.verifierOutput[0].verificationResult.signature.certificate.subjectAlternativeName = `https://github.com/${repo}/${wrongWorkflow}@${ref}`;
    assert.throws(() => validateAttestationPolicy({ bundle: value.bundle, verifierOutput: value.verifierOutput, payloadBytes, payloadSha256: digest, repo, workflow, commit, ref }), /certificate SAN/);
  }
});

test('wrong ref is rejected by SAN policy and authoritative CLI source-ref constraint', () => {
  const value = fixture();
  value.verifierOutput[0].verificationResult.signature.certificate.subjectAlternativeName = `https://github.com/${repo}/${workflow}@refs/heads/main`;
  assert.throws(() => validateAttestationPolicy({ bundle: value.bundle, verifierOutput: value.verifierOutput, payloadBytes, payloadSha256: digest, repo, workflow, commit, ref }), /certificate SAN/);
  const args = buildVerifyArgs({ payload: 'payload.txt', bundle: 'bundle.json', repo, workflow, commit, ref: 'refs/heads/main' });
  assert.ok(args.includes('--source-ref') && args.includes('refs/heads/main'));
});

test('valid-looking wrong commit is rejected by authoritative CLI source-digest constraint', () => {
  const wrongCommit = '0123456789abcdef0123456789abcdef01234567';
  const args = buildVerifyArgs({ payload: 'payload.txt', bundle: 'bundle.json', repo, workflow, commit: wrongCommit, ref });
  assert.ok(args.includes('--source-digest') && args.includes(wrongCommit));
  assert.throws(() => validateAttestationPolicy(policyArgs({ commit: 'bad' })), /full lowercase SHA/);
});

test('wrong certificate issuer and SAN are rejected', () => {
  const issuerValue = fixture();
  issuerValue.verifierOutput[0].verificationResult.signature.certificate.issuer = 'https://evil.example';
  assert.throws(() => validateAttestationPolicy({ bundle: issuerValue.bundle, verifierOutput: issuerValue.verifierOutput, payloadBytes, payloadSha256: digest, repo, workflow, commit, ref }), /certificate issuer/);

  const sanValue = fixture();
  sanValue.verifierOutput[0].verificationResult.signature.certificate.subjectAlternativeName = `https://github.com/${repo}/${workflow}.attacker.yml@${ref}`;
  assert.throws(() => validateAttestationPolicy({ bundle: sanValue.bundle, verifierOutput: sanValue.verifierOutput, payloadBytes, payloadSha256: digest, repo, workflow, commit, ref }), /certificate SAN/);
});

test('missing or malformed bundle and transparency evidence are rejected', () => {
  assert.throws(() => validateAttestationPolicy({ bundle: null, verifierOutput: [], payloadBytes, payloadSha256: digest, repo, workflow, commit, ref }), /Attestation bundle/);
  const value = fixture();
  value.bundle.dsseEnvelope.signatures = [];
  assert.throws(() => validateAttestationPolicy({ bundle: value.bundle, verifierOutput: value.verifierOutput, payloadBytes, payloadSha256: digest, repo, workflow, commit, ref }), /DSSE signatures/);
  value.bundle = fixture().bundle;
  value.bundle.verificationMaterial.tlogEntries = [];
  assert.throws(() => validateAttestationPolicy({ bundle: value.bundle, verifierOutput: value.verifierOutput, payloadBytes, payloadSha256: digest, repo, workflow, commit, ref }), /transparency-log/);
});

test('verify arguments preserve exact trust constraints', () => {
  const args = buildVerifyArgs({ payload: 'payload.txt', bundle: 'bundle.json', repo, workflow, commit, ref });
  assert.ok(args.includes('--cert-identity'));
  assert.ok(args.includes(`https://github.com/${repo}/${workflow}@${ref}`));
  assert.ok(args.includes('--cert-oidc-issuer') && args.includes(OIDC_ISSUER));
  assert.ok(args.includes('--source-digest') && args.includes(commit));
  assert.ok(args.includes('--source-ref') && args.includes(ref));
  assert.ok(args.includes('--predicate-type') && args.includes(PREDICATE_TYPE));
});
