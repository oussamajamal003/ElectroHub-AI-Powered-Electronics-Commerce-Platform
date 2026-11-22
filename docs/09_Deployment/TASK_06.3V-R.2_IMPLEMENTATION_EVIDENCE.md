# Task 06.3V-R.2 — Attestation Verifier Review Remediation

## Scope and SHAs

- Starting review SHA: `2bf237f348b5ed5d9d79b821cd76fc3dd6c7c7d9`
- Implementation SHA: `2070d20bcb9a34bdb2d41b91466704ba0cda4d88`
- Evidence commit SHA: `9419a8c6`
- Final review SHA: PENDING FINAL SHA REFRESH
- Review branch: `review/06.3v-r-verifier-remediation`
- Fixture branch unchanged: `test/attestation-fixture` at `2a54d2e2361306738ec9fe3545135c97510175c0`
- Existing hosted fixture run: `44902259883`

## Changed Files

- `scratch/verify-attestation-fixture.cjs`
- `scratch/verify-attestation-fixture.test.cjs`
- `docs/09_Deployment/TASK_06.3V-R.2_IMPLEMENTATION_EVIDENCE.md`

## Payload Binding

`validateAttestationPolicy()` now requires non-empty payload bytes and always computes their SHA-256. A supplied expected digest must be a 64-character lowercase hexadecimal SHA-256 and must exactly equal the calculated payload digest. It cannot replace or override the calculated value.

The verifier statement subject and DSSE statement subject must also equal the actual payload digest. Missing payload bytes, malformed supplied digests, attestation/digest mismatches, tampered payload bytes, and statement or DSSE digest mismatches reject.

## Source Identity Boundary

Commit shape is validated as exactly 40 lowercase hexadecimal characters. Repository and ref identity are enforced by the authoritative `gh attestation verify` CLI flags:

- `--repo`
- `--cert-identity`
- `--source-digest`
- `--source-ref`
- `--cert-oidc-issuer`
- `--predicate-type`

No source repository/ref/commit JSON path was invented for the Node helper because no verified hosted bundle output was available to prove the format. The local helper validates certificate SAN and statement fields that the workflow has directly parsed; the CLI remains authoritative for cryptographic source constraints.

## Cryptographic Boundary

Synthetic signatures, certificates, timestamps, and transparency entries validate local policy logic only. They do not prove signature validity, certificate-chain trust, or Rekor inclusion.

`gh attestation verify` remains responsible for cryptographic verification and trust policy. The Node helper performs additional structural and identity assertions on verifier output and the supplied bundle.

## Exact-SHA Verification

- `node --test scratch/verify-attestation-fixture.test.cjs`: 13 passed, 0 failed.
- Workflow YAML parse and permission/action-pin check: passed.
- `git diff --check`: passed.
- Hosted cryptographic verification: NOT RUN.

## Branch and Security Status

No hosted fixture run was dispatched or triggered. The fixture branch remains unchanged. No account settings, production files, providers, secrets, trust roots, replay ledgers, databases, hosts, deployments, or resources changed.

Remaining external verification requires a separately authorized hosted run that retains a bundle and completes positive and negative cryptographic verification.

**Production status: STRICT NO-GO.**
