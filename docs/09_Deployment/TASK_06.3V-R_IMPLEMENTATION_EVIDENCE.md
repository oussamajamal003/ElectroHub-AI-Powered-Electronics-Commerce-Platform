# Task 06.3V-R — Fixture Verifier Diagnosis and Remediation

## Starting and Final State

- Starting feature SHA: `3906346ecaa0825934bee8208d3e24686269bdf3`
- Branch: `feature/06.3-production-infrastructure`
- Evidence commit SHA: `47dc5beadc542c22ab91e836cc8eabe696e2f91f`
- Final evidence refresh SHA: `0a9df0866624ffa6004ee73b9afac9ba60bbf2bb`
- Fixture branch remote SHA: `2a54d2e2361306738ec9fe3545135c97510175c0`
- Existing fixture run: `44902259883`
- Existing fixture job: `136840423906`
- Attestation ID: `70516746`
- Worktree: clean for feature implementation work

## Root Cause

The existing hosted fixture was successful through attestation generation but failed the positive local-bundle verifier. The runner-local bundle was not retained and no bundle artifact was published. Direct public bundle lookup returned 404, so the cryptographic bundle and its lower-level trust result could not be replayed locally.

The evidence-backed runnable defect is verifier/policy misuse:

- The workflow used a relative `--signer-workflow` value instead of the exact repository/workflow/ref identity.
- It did not pass `--cert-identity` with the exact certificate SAN URI.
- It did not explicitly pass `--cert-oidc-issuer https://token.actions.githubusercontent.com`.
- It did not explicitly constrain source digest, source ref, or predicate type.
- The expected certificate SAN is `https://github.com/<repo>/<workflow>@<ref>` and must be exact.
- The existing run stopped at `gh attestation verify` with `verifying with issuer "sigstore.dev"` before the suite's SAN, DSSE, source, negative, or Rekor checks ran.

This diagnosis is precise about the command/policy defect but cannot claim the exact lower-level Sigstore trust-root/bundle incompatibility without the missing runner bundle. It is therefore recorded as a command and identity-constraint defect with an external hosted-verification gate remaining.

## Remediation

The isolated fixture worktree was updated without changing production behavior.

Local fixture commit `701df8e9`:

- Added exact `--signer-workflow ${REPO}/${EXPECTED_WORKFLOW}@${EXPECTED_REF}`.
- Added exact `--cert-identity` SAN validation.
- Added exact OIDC issuer validation.
- Added exact source digest and source ref validation.
- Added explicit SLSA provenance predicate validation.
- Added exact `gh` 2.104.0 runtime validation.
- Applied the same constraints to API verification and all negative tests.

Local fixture commit `2bf237f3`:

- Added `scratch/verify-attestation-fixture.cjs`.
- Added strict DSSE envelope, signature, payload, predicate, certificate issuer/SAN, verifier output, commit, and transparency-log checks.
- Added `scratch/verify-attestation-fixture.test.cjs` with synthetic positive and negative policy tests.

## Before and After

Before remediation:

- Relative workflow path only.
- No exact certificate SAN flag.
- OIDC issuer relied on defaults.
- No explicit source digest/ref/predicate constraints.
- Verifier suite failed immediately with no negative test completion.

After remediation:

- Exact repository/workflow/ref SAN is required.
- OIDC issuer is explicitly pinned to `https://token.actions.githubusercontent.com`.
- Source commit, source ref, and payload subject digest are explicitly constrained.
- Predicate type is explicitly `https://slsa.dev/provenance/v1`.
- Missing or malformed bundle, missing signer evidence, missing Rekor entries, tampering, and wrong identities fail closed.
- The fixture still does not have positive end-to-end hosted verification because no second run was allowed.

## Tests and Results

Commands executed:

- `node --test scratch/verify-attestation-fixture.test.cjs`
  - 11 tests passed, 0 failed.
- Workflow YAML parse in the isolated fixture worktree:
  - PASS.
- `node .github/scripts/check-workflow-policy.cjs`:
  - PASS: `Workflow migration-safety policy: OK`.
- `git diff --check`:
  - PASS before local fixture commits.

Focused synthetic test coverage:

- Valid identity and bundle structure: PASS.
- Wrong repository: PASS as rejection.
- Wrong workflow path: PASS as rejection.
- Wrong workflow ref: PASS as rejection.
- Wrong commit: PASS as rejection.
- Wrong certificate issuer: PASS as rejection.
- Wrong certificate SAN/lookalike: PASS as rejection.
- Payload digest mismatch: PASS as rejection.
- Payload tampering: PASS as mismatch rejection.
- Missing/malformed bundle: PASS as rejection.
- Missing transparency-log evidence: PASS as rejection.
- Exact verifier argument construction: PASS.

Not executed: hosted cryptographic positive/negative verification. The existing bundle was not retained and public lookup returned 404. No local test claims that external verification passed.

## Fixture Security Review

- Workflow remains isolated to `test/attestation-fixture`.
- Workflow-level permissions remain `permissions: {}`.
- Job permissions remain limited to `contents: read`, `id-token: write`, and `attestations: write`.
- `actions/checkout` remains pinned to `11bd71901bbe5b1630ceea73d27597364c9af683`.
- `actions/attest` remains pinned to `1e69f48acb82d1966a394da916b4c1698aa569d6`.
- Payload remains disposable and non-sensitive.
- No production Environment, secret, database, host, payment, email, storage, or provider access is configured.
- No production workflow or provenance policy was modified.

## Hosted Run Boundary

No second fixture run was dispatched or trigger-created.

The local fixture commits were not pushed because pushing to `test/attestation-fixture` would trigger the push-only workflow and consume the prior one-run authorization. The fixture branch on GitHub remains at `2a54d2e2361306738ec9fe3545135c97510175c0`.

## Changed Files

Feature branch:

- `docs/09_Deployment/TASK_06.3V-R_IMPLEMENTATION_EVIDENCE.md`

Isolated fixture local branch `fixture-verifier-remediation`:

- `.github/workflows/test-attestation-fixture.yml`
- `scratch/verify-attestation-fixture.cjs`
- `scratch/verify-attestation-fixture.test.cjs`

No account settings, production files, or provider configuration changed.

## Remaining External Verification

- A new explicit owner authorization is required for one future hosted fixture run.
- The future run must retain or return a downloadable bundle for independent inspection.
- The exact certificate issuer/SAN, source ref/digest, DSSE subject, and Rekor evidence must pass.
- Wrong repository, workflow, ref, commit, digest, issuer, SAN, tamper, and missing-transparency cases must complete successfully.
- Hosted result must be reviewed from the exact future run SHA and job ID.

## Security and Deployment Status

- No second attestation or Sigstore/Rekor metadata was created.
- No production secret, trust root, replay ledger, host, database, or provider action occurred.
- No deployment or resource creation occurred.
- Production status: **STRICT NO-GO**.

This task repairs local fixture verification policy only. It does not establish production signer trust, host trust-root custody, replay protection, branch governance, or deployment authorization.
