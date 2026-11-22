'use strict';

const crypto = require('node:crypto');

const OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const PREDICATE_TYPE = 'https://slsa.dev/provenance/v1';

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertExact(actual, expected, label) {
  if (typeof actual !== 'string' || actual !== expected) {
    throw new Error(`Unexpected ${label}: expected ${expected}, received ${String(actual)}`);
  }
}

function validateBundleStructure(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new Error('Attestation bundle must be a JSON object');
  }
  if (!bundle.dsseEnvelope || !bundle.verificationMaterial) {
    throw new Error('Attestation bundle missing DSSE envelope or verification material');
  }
  const envelope = bundle.dsseEnvelope;
  if (envelope.payloadType !== 'application/vnd.in-toto+json') {
    throw new Error('Unexpected DSSE payload type');
  }
  if (!Array.isArray(envelope.signatures) || envelope.signatures.length < 1 ||
      envelope.signatures.some((entry) => !entry || typeof entry.sig !== 'string' || entry.sig.length === 0)) {
    throw new Error('Attestation bundle has missing or malformed DSSE signatures');
  }
  if (!Array.isArray(bundle.verificationMaterial.tlogEntries) || bundle.verificationMaterial.tlogEntries.length < 1) {
    throw new Error('Attestation bundle missing transparency-log evidence');
  }
  const tlog = bundle.verificationMaterial.tlogEntries[0];
  if (!tlog || tlog.logIndex === undefined || tlog.integratedTime === undefined || tlog.logId === undefined) {
    throw new Error('Attestation bundle has malformed transparency-log evidence');
  }
}

function validateAttestationPolicy({ bundle, verifierOutput, payloadBytes, payloadSha256, repo, workflow, commit, ref }) {
  validateBundleStructure(bundle);

  if (!(payloadBytes instanceof Uint8Array) || payloadBytes.length === 0) {
    throw new Error('Payload bytes are missing or invalid');
  }
  if (typeof payloadSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(payloadSha256)) {
    throw new Error('Supplied expected payload SHA-256 is missing or malformed');
  }
  const actualPayloadSha = sha256Hex(Buffer.from(payloadBytes));
  if (payloadSha256 !== actualPayloadSha) {
    throw new Error(`Supplied expected payload SHA-256 differs from actual payload bytes: expected ${payloadSha256}, actual ${actualPayloadSha}`);
  }

  if (!Array.isArray(verifierOutput) || verifierOutput.length !== 1) {
    throw new Error('Verifier output must contain exactly one attestation result');
  }

  const result = verifierOutput[0];
  const certificate = result?.verificationResult?.signature?.certificate;
  const statement = result?.verificationResult?.statement;
  if (!certificate || typeof certificate !== 'object') {
    throw new Error('Verifier result missing certificate');
  }
  if (!statement || typeof statement !== 'object') {
    throw new Error('Verifier result missing in-toto statement');
  }

  assertExact(certificate.issuer, OIDC_ISSUER, 'certificate issuer');

  const expectedSan = `https://github.com/${repo}/${workflow}@${ref}`;
  assertExact(certificate.subjectAlternativeName, expectedSan, 'certificate SAN');
  assertExact(statement.predicateType, PREDICATE_TYPE, 'predicate type');

  if (!Array.isArray(statement.subject) || statement.subject.length !== 1) {
    throw new Error('In-toto statement must contain exactly one subject');
  }
  const expectedPayloadSha = actualPayloadSha;
  assertExact(statement.subject[0]?.digest?.sha256, expectedPayloadSha, 'verifier statement payload digest');

  let statementJson;
  try {
    statementJson = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
  } catch (error) {
    throw new Error(`Unable to decode DSSE in-toto statement: ${error.message}`);
  }
  if (!Array.isArray(statementJson.subject) || statementJson.subject.length !== 1) {
    throw new Error('Bundle in-toto statement must contain exactly one subject');
  }
  assertExact(statementJson.subject[0]?.digest?.sha256, expectedPayloadSha, 'bundle payload digest');
  assertExact(statementJson.predicateType, PREDICATE_TYPE, 'bundle predicate type');

  const commitPattern = /^[0-9a-f]{40}$/;
  if (!commitPattern.test(commit)) {
    throw new Error('Expected commit is not a full lowercase SHA');
  }

  // Source commit/ref/repository binding is enforced by gh attestation verify.
  // The verifier JSON exposes certificate/SAN and statement fields used here,
  // but this helper must not infer source identity from unverified predicate data.

  return true;
}

function buildVerifyArgs({ payload, bundle, repo, workflow, commit, ref }) {
  const san = `https://github.com/${repo}/${workflow}@${ref}`;
  const args = [
    'attestation', 'verify', payload,
    '--repo', repo,
    '--cert-identity', san,
    '--cert-oidc-issuer', OIDC_ISSUER,
    '--source-digest', commit,
    '--source-ref', ref,
    '--predicate-type', PREDICATE_TYPE,
  ];
  if (bundle) args.push('--bundle', bundle);
  return args.concat(['--format', 'json']);
}

module.exports = {
  OIDC_ISSUER,
  PREDICATE_TYPE,
  sha256Hex,
  validateBundleStructure,
  validateAttestationPolicy,
  buildVerifyArgs,
};

if (require.main === module) {
  const fs = require('node:fs');
  const [payloadPath, bundlePath, verifierJsonPath, repo, workflow, commit, ref, payloadSha256] = process.argv.slice(2);
  if (!payloadPath || !bundlePath || !verifierJsonPath || !repo || !workflow || !commit || !ref || !payloadSha256) {
    console.error('Usage: node scratch/verify-attestation-fixture.cjs <payload> <bundle> <verifier-json> <repo> <workflow> <commit> <ref> <payload-sha256>');
    process.exit(2);
  }
  try {
    const payloadBytes = fs.readFileSync(payloadPath);
    if (payloadBytes.length === 0) {
      throw new Error('Payload bytes are missing or empty');
    }
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
    const verifierOutput = JSON.parse(fs.readFileSync(verifierJsonPath, 'utf8'));
    validateAttestationPolicy({ bundle, verifierOutput, payloadBytes, payloadSha256, repo, workflow, commit, ref });
    console.log('PASS: exact fixture attestation policy validated');
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exit(1);
  }
}
