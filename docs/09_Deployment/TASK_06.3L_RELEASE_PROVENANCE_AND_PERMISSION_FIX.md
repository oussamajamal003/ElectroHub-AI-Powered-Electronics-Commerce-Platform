# Task 06.3L — Release Provenance and Permission Fix

**Decision:** **BLOCKED BY TRUST-OWNER DECISION**
**Production deployment:** **NO-GO**
**Scope:** Repository-only remediation and local verification. No release was created or deployed.

## Executive result

The Linux extraction permission defect is corrected and verified. Regular archive files are installed as owner-readable (`0400`), with owner execute (`0100`) added only when the validated archive mode marks the file executable. Group and other permission bits are never copied from archive metadata. Extracted directories remain owner-only (`0700`).

Whole-release provenance is not implemented because the approved repository record still leaves the trust owner and trust-root enrollment unresolved. Instead, this change keeps release intake disabled at both workflow and host entrypoints. No signature, attestation verifier, signing identity, key, trust pin, or valid release fixture was created. This is a fail-closed hold, not a solution to provenance authentication.

## A1 — Whole-release provenance

### Existing trust contract

The Task 06.3E architecture report recommended a separately versioned release with a keyless Sigstore identity, exact signer/issuer constraints at the host, and immutable digest verification. It marked that direction conditional: no exact approved workflow identity, trust owner, host trust material, or source/rights decision was established. Task 06.3K explicitly required that ownership decision before implementing a key or trust policy. No later repository decision resolving it was found.

The existing release manifest and SHA-256 file list establish internal byte consistency only. They do not authenticate the manifest author or bind the complete bundle to a trusted workflow. The AI production metadata pin is a separate control and cannot authenticate the application bundle or verifier code.

### Fail-closed behavior applied

- The production workflow exits in both build and deploy jobs pending approval and implementation of a whole-release provenance policy. The build job stops before checkout/build/bundle upload. The deploy job stops before runner-side Docker image loading, SSH setup, transfer, or host invocation.
- The fixed host helper rejects the `prepare` operation before reading trusted intake settings or examining/copying incoming files. Its lower-level `prepare_bundle()` entrypoint also fails closed.
- `deploy-release.sh` no longer executes `verify-production-env.py` or `verify-model-artifact.py` from the extracted source archive as root. The fixed root-installed helper is the only Python program selected for host intake, and its current prepare command rejects every candidate.
- The archived host environment and AI artifact checks have not yet been replaced by equivalent fixed host-owned checks. The root-managed AI manifest hash-pin remains in the Compose environment contract and is still shape-validated by the preflight utility, but the deployment shell does not currently reach a fixed host verifier for it. Because all workflow and host intake paths fail closed, this is not an active release bypass; it is a mandatory follow-on implementation item before any release gate can be removed.
- The host shell invokes preparation before any bundle Compose validation, Docker image load, release directory/pointer replacement, or Compose startup. Under `set -e`, rejection terminates the deployment path. The helper CLI test confirms no intake, verification, extraction, subprocess call, or pointer change occurs. Static policy tests confirm workflow and shell ordering.
- Existing workflow AI production approval metadata checks remain in the workflow after the new early hold, and the candidate manifest is excluded. Existing AI verifier tests still exercise the separate host-pinned AI approval contract. That downstream AI gate is not reached by a deployment while the global provenance hold is active. The configured AI hash-pin template is unchanged. No claim is made that host runtime AI verification has occurred.

### Trust-owner decision still required

Before the fail-closed hold can be replaced, the responsible owner must approve and document:

1. The provenance mechanism and trust owner (recommended for evaluation: GitHub OIDC/Sigstore artifact attestation, subject to the project's account and policy controls).
2. The exact repository identity and protected workflow identity, including workflow path, protected ref/environment, issuer, and allowed builder identity.
3. The authenticated statement fields: exact source commit SHA, complete release bundle digest, unique intended release identity, workflow run/attempt identity, and repository identity.
4. Who enrolls and maintains the verifier trust material on the host, how it is delivered independently of the bundle, and how it is rotated, revoked, and recovered.
5. Whether verification requires network access/transparency-log lookup, how expiry and replay are checked, and the fail-closed response when verification is unavailable.
6. A fixed, root-owned host verification/preflight implementation and an approved test-vector set. It must authenticate the exact bundle before extraction, bundle code, Docker load, pointer mutation, or Compose operations; then re-establish production environment validation and the separate host-pinned AI approval/content checks without executing bundle code. Bundle-supplied manifests, Compose files, and verifier programs must not override host policy.

Until these choices are approved and implemented, the release workflow and host intake remain disabled. Missing, malformed, mismatched, expired, replayed, or untrusted attestations are not individually parsed by a selected verifier because no format or trust policy has been approved. The current invariant is stronger but less functional: all candidate intakes are rejected.

### Provenance test status

The new disposable test invokes the fixed host helper CLI and proves that the current global hold rejects before reading limits or reaching bundle preparation, checksum verification, extraction, subprocess calls, or a pointer marker. A companion static policy test checks early workflow and host ordering and confirms that bundle-provided verifier code is not invoked.

Positive-signature tests and per-claim negative tests (tampered envelope, repository/workflow/source/release mismatch, untrusted issuer, invalid signature, expiry, replay, and valid provenance) are **BLOCKED / NOT RUN** until an owner-approved verifier contract exists. There is no valid provenance release to test. The helper CLI test is not a live Bash deployment test; no real host or Docker boundary was invoked.

## A2 — Extraction permissions

The extractor now masks archive mode to the owner-only policy:

```text
regular non-executable file: 0400
regular executable file:     0500
directory:                   0700
```

For files, owner read is always granted. Owner execute is granted only if the archive's validated mode has at least one execute bit. No group/other bits are retained, including for archive modes `0777`, `0755`, `0511`, `0111`, and `0666`. The Linux suite passed the explicit mode assertions and the existing safe extraction/intake tests.

## Local verification

Ubuntu WSL2 local verification passed:

- `PYTHONDONTWRITEBYTECODE=1 python3 infrastructure/production/prepare-release-bundle.test.py -v` — **25 passed**, including all POSIX intake/extraction, provenance fail-closed, and rollback failure-injection tests.
- `bash -n infrastructure/production/deploy-release.sh infrastructure/production/install-deploy-command.sh` — **passed**.
- `PYTHONDONTWRITEBYTECODE=1 python3 infrastructure/production/production-ai-release.test.py -v` — **6 passed**.
- `PYTHONDONTWRITEBYTECODE=1 python3 infrastructure/production/verify-production-env.test.py -v` — **9 passed**.
- `PYTHONPYCACHEPREFIX=/tmp/electrohub-task063l-pycache python3 -m py_compile infrastructure/production/prepare-release-bundle.py infrastructure/production/prepare-release-bundle.test.py` — **passed**.

Repository-local checks:

- `node --test --test-reporter=dot infrastructure/production/*.test.cjs infrastructure/production/tls/*.test.cjs` — **18 passed**.
- `node .github/scripts/check-workflow-policy.cjs` — **passed**.
- `node -e "const fs=require('node:fs'); const YAML=require('yaml'); YAML.parse(fs.readFileSync('.github/workflows/deploy-production.yml','utf8')); console.log('Workflow YAML parse: OK')"` — **passed**.
- `git diff --check` — **passed**; Git emitted pre-existing LF-to-CRLF working-copy warnings for `.dockerignore` and `docs/09_Deployment/NGINX.md`.

These are local repository results, not GitHub Actions, browser, Docker, host, provider, or production evidence.

## Remaining decision and next step

**A2 is complete locally. A1 remains blocked by the trust-owner decision.** The next task should record the approved provenance owner/identity/trust lifecycle, then implement a host-pinned verifier in fixed root-owned code and the workflow's matching attestation production. It must include positive and tamper/identity failure tests before the global hold is considered for removal. A separate final pre-commit audit is required after that work. No staging or commit is authorized by this report.
