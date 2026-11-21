# Task 06.3H — Commit Blocker Remediation

**Status:** Repository remediation complete; ready for another pre-commit review.
**Deployment status:** NO-GO.
**Branch / HEAD:** `feature/06.3-production-infrastructure` / `053a271ba36ebcf436720bdc6aa87c7bb79cf149` (no commit created).

## Executive result

The four actionable Task 06.3G commit blockers were addressed in repository code and documentation. The production release path now requires separate, host-pinned production AI approval metadata and rejects the current local-only candidate before image loading, pointer replacement or service startup. Production OTP and related mandatory service-key checks reject unresolved or weak values. Both privileged production workflows use reviewed full Action SHAs. The security runbook now distinguishes WebSocket Origin checks from polling CORS and does not imply runtime verification.

No approved production AI bundle or host trust pin exists. There is deliberately no AI-unavailable deployment mode: a release without the approved AI release is rejected as a whole. The current D3 candidate is not relabeled, its weights/checksums were not changed, and no model or index was activated. The production deploy shell script could not be syntax-checked in this Windows environment, and host/Docker/browser behavior remains unverified. These limits are recorded below and in the implementation evidence.

## Findings and corrections

### A1 — Local-only AI candidate could enter production

**Severity:** BLOCKER — corrected in repository policy; actual production release remains blocked.

The prior workflow bundled `AI_MODEL_ARTIFACT_CANDIDATE.json`, and the host verified its checksums without proving a separate production approval identity. That allowed byte integrity to be mistaken for production approval.

The workflow and host now require two distinct metadata files: `AI_PRODUCTION_RELEASE.json` and `AI_MODEL_ARTIFACT_PRODUCTION.json`. Both must identify `APPROVED_PRODUCTION_RELEASE`; the release envelope is checked against a SHA-256 trust pin supplied by the root-managed host environment; the envelope binds the separate artifact manifest, model/embedding/preprocessing/dimension/relevance/index-compatibility identity, and quality/source/rights approval references. The artifact verifier then checks the exact source paths, loader source identity, artifact paths, sizes, hashes and index compatibility. The explicit local-candidate status is rejected.

The host performs environment, AI-identity and release-bundle pre-load checks before `docker load`, `mv` of the active pointer, and Compose startup. The workflow rejects absent or non-approved production metadata before building images, and it never packages the local candidate manifest. A failed preflight leaves the active release pointer unchanged and does not start the candidate AI service. Tests cover local-candidate rejection, missing/tampered/mismatched metadata, an invalid trust pin, pre-load bundle validation, pointer-marker preservation, and static ordering of the gate before image loading, pointer switching and AI startup.

There is no operator-visible AI-unavailable deploy path. Compose startup still includes the AI service and readiness gates on the full application set, so a release lacking approved AI metadata is rejected before switching. This avoids silently degrading the required feature. Model artifact installation, model activation and vector-index activation remain separate gates.

**Trust limitation:** the host-pinned SHA-256 is an out-of-band integrity/approval anchor, not a cryptographic signature or complete supply-chain attestation. The host file is required to be root-owned and not group/world-writable. No pin, signature, key, production manifest, or release artifact was created. Signing and trust-key ownership remain subject to the Task 06.3E/F owner decisions.

### A2 — Weak OTP and placeholder secrets

**Severity:** BLOCKER — corrected in backend and deployment preflight.

Production `OTP_HASH_SECRET` now requires at least 32 UTF-8 bytes, no surrounding whitespace, at least 12 distinct characters, and no recognized template, sequence, repeated or predictable value. It must differ from both `JWT_SECRET` and a configured `JWT_REFRESH_SECRET`. Validation errors name the variable but do not include its value. Development and test behavior remains compatible with the existing production-only validation convention.

The Python deployment preflight enforces the same OTP contract. Directly relevant mandatory service credentials were also checked: production `BREVO_API_KEY` rejects unresolved templates, and the private AI service key preflight now matches the existing Express AI-key contract for minimum length, printable ASCII, placeholder/repeated-value rejection and character diversity. No credential was generated or added. The production example explicitly instructs operators to replace each placeholder with a unique cryptographically random value.

Disposable test fixtures prove rejection of the exact example placeholder, empty/short values, repeated and predictable values, and reuse of either JWT signing key; a strong disposable fixture passes. Tests also assert that errors do not echo supplied values.

### A3 — Privileged production Actions were tag-pinned

**Severity:** HIGH — corrected and checked against official upstream release/commit pages on 2026-11-19.

| Action | Intended release | Full commit SHA |
|---|---|---|
| `actions/checkout` | v4.2.2 | `11bd71901bbe5b1630ceea73d27597364c9af683` |
| `actions/github-script` | v7.1.0 | `f28e40c7f34bde8b3046d885e986cb6290c5673b` |
| `actions/upload-artifact` | v4.6.2 | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
| `actions/download-artifact` | v4.3.0 | `d3f86a106a0bac45b974a628896c90dbdf5c8093` |
| `actions/setup-node` | v4.4.0 | `49933ea5288caeca8642d1e84afbd3f7d6820020` |

The policy test now requires a full 40-character lowercase SHA and same-line version comment for every third-party Action in both privileged production workflows. Existing least-privilege permissions remain. Exact-release identity sources: [checkout v4.2.2](https://github.com/actions/checkout/releases/tag/v4.2.2) and [commit](https://github.com/actions/checkout/commit/11bd71901bbe5b1630ceea73d27597364c9af683); [github-script v7.1.0](https://github.com/actions/github-script/releases/tag/v7.1.0) and [commit](https://github.com/actions/github-script/commit/f28e40c7f34bde8b3046d885e986cb6290c5673b); [upload-artifact v4.6.2](https://github.com/actions/upload-artifact/releases/tag/v4.6.2) and [commit](https://github.com/actions/upload-artifact/commit/ea165f8d65b6e75b540449e92b4886f43607fa02); [download-artifact v4.3.0](https://github.com/actions/download-artifact/releases/tag/v4.3.0) and [commit](https://github.com/actions/download-artifact/commit/d3f86a106a0bac45b974a628896c90dbdf5c8093); [setup-node v4.4.0](https://github.com/actions/setup-node/releases/tag/v4.4.0) and [commit](https://github.com/actions/setup-node/commit/49933ea5288caeca8642d1e84afbd3f7d6820020).

Workflow YAML and policy tests passed locally; GitHub-hosted workflow execution and account-level Environment reviewer configuration were not verified.

### A4 — Socket security runbook did not match the gateway

**Severity:** MEDIUM — documentation corrected; runtime/browser test unavailable.

`docs/10_Operations/SECURITY.md` now states that Engine.IO WebSocket upgrade Origin is checked through the gateway's `allowRequest`, with missing or untrusted Origin rejected. Polling requests rely on the configured credentialed Socket.IO CORS allowlist. These are source-level controls, not evidence of successful production browser/runtime behavior.

The loopback gateway test attempt was blocked by sandbox `EACCES` while connecting to `127.0.0.1:53540`; 3 tests passed and 16 failed under that restriction. No browser compatibility claim is made.

## Focused verification

| Check | Outcome |
|---|---|
| `node --test .github/scripts/ci-safety.test.cjs infrastructure/production/release-manifest.test.cjs infrastructure/production/host-command-policy.test.cjs` | PASS — 37 tests |
| `node .github/scripts/check-workflow-policy.cjs` | PASS |
| `python infrastructure/production/verify-production-env.test.py` | PASS — 9 tests |
| `python infrastructure/production/production-ai-release.test.py` | PASS — 6 tests |
| `npm test -- tests/env.test.ts src/integrations/ai/__tests__/ai.config.test.ts` from `apps/backend` | PASS — 58 tests |
| `npm run typecheck` from `apps/backend` | PASS |
| `npm run lint` from `apps/backend` | PASS |
| `ruff check --config apps/ai-service/pyproject.toml apps/ai-service/verify-model-artifact.py infrastructure/production/production-ai-release.test.py` | PASS |
| `python -m py_compile` on the changed AI verifier, production env preflight/tests and bundle verifier | PASS |
| Node `yaml.parse` on `deploy-production.yml`, `prod-migration.yml` and `ci.yml` | PASS — parse only, not GitHub Actions execution |
| `git diff --check` | PASS; Git emitted existing LF-to-CRLF working-copy warnings for `.dockerignore` and `NGINX.md` |
| Delivery gateway loopback tests | PARTIALLY VERIFIED — 3 passed; 16 blocked by sandbox `EACCES` on loopback sockets |
| `bash -n infrastructure/production/deploy-release.sh` | BLOCKED — Windows Bash/WSL launcher returned `Bash/E_ACCESSDENIED` |
| Docker, Compose, Nginx runtime and browser matrix | NOT VERIFIED — Docker and Nginx tools unavailable; no host/browser was started |

The shell deploy path is covered by source-policy ordering checks but has not had a shell parser or real host execution. No database, provider, external worker, public hostname or cloud operation occurred.

## Files changed for Task 06.3H

- `.github/scripts/check-workflow-policy.cjs`
- `.github/scripts/ci-safety.test.cjs`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-production.yml`
- `.github/workflows/prod-migration.yml`
- `apps/ai-service/verify-model-artifact.py`
- `apps/backend/.env.production.example`
- `apps/backend/src/config/env.ts`
- `apps/backend/tests/env.test.ts`
- `docs/09_Deployment/AI_RELEASE_MANIFEST.md`
- `docs/09_Deployment/RELEASE_MANIFEST.schema.json`
- `docs/10_Operations/SECURITY.md`
- `infrastructure/production/compose.env.example`
- `infrastructure/production/create-release-manifest.cjs`
- `infrastructure/production/deploy-release.sh`
- `infrastructure/production/host-command-policy.test.cjs`
- `infrastructure/production/production-ai-release.test.py`
- `infrastructure/production/release-manifest.test.cjs`
- `infrastructure/production/verify-production-env.py`
- `infrastructure/production/verify-production-env.test.py`
- `infrastructure/production/verify-release-bundle.py`
- `infrastructure/production/verify-release-manifest.cjs`
- `docs/09_Deployment/TASK_06.3H_COMMIT_BLOCKER_REMEDIATION.md`
- `docs/09_Deployment/TASK_06.3H_IMPLEMENTATION_EVIDENCE.md`

These paths overlap the pre-existing uncommitted Task 06.3 implementation; this list identifies paths updated for H and does not claim they were newly created by H. Other user changes were preserved.

## Remaining gates

- **BLOCKER — AI approval:** source provenance, redistribution rights and D3 quality approval remain unresolved under Task 06.3F. No production AI manifests or trusted host pin exist; production AI release is NO-GO.
- **HIGH — Host execution:** Bash parser/runtime verification, Docker Compose build and Nginx/API/Socket.IO integration remain outstanding.
- **HIGH — release controls:** confirm protected GitHub Environment reviewers, branch restrictions and required checks in repository settings; workflow YAML cannot prove those account controls.
- **HIGH — production readiness:** hostname/OAuth, public HTTPS/TLS lifecycle, browser matrix, backup/restore, production verification and measured host capacity remain outstanding.
- **MEDIUM — Socket runtime:** rerun the gateway test suite in an environment that permits loopback sockets and perform the authorized browser matrix later.

## Recommendation

**Ready for another pre-commit audit; not a commit or deployment approval.** Review the mixed existing worktree and stage only an explicitly approved path set during a separately authorized commit operation. Production deployment remains **NO-GO**.
