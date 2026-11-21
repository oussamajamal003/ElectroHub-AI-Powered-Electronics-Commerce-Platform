# Task 06.3G — Consolidated Pre-Commit Readiness Report

**Audit date:** 2026-11-19
**Scope:** Read-only repository audit and targeted local checks. No source or existing report was edited.
**Commit decision:** **NOT READY TO COMMIT**
**Commit-readiness score:** **56/100**
**Deployment decision:** **NO-GO**

## Executive decision

The accumulated Task 06.3 implementation contains useful fail-closed preparation and several local checks pass. It is not safe to commit the complete candidate yet. Three concrete security/release blockers remain: the production deployment path can start the D3 artifact still designated local-only and not production-approved; the production OTP secret example is accepted as a real secret; and production workflows use mutable GitHub Action tags while handling deployment or database credentials. A security runbook statement about WebSocket Origin enforcement is also stale.

This is a repository commit decision only. It does not approve any migration, model distribution, host, certificate, provider configuration or deployment. Production remains NO-GO for the separate reasons recorded in the earlier Task 06.3 reports.

### Score basis

| Area | Score |
|---|---:|
| Application/session/security implementation | 14/20 |
| Compose, Nginx, TLS and service boundaries | 13/20 |
| Release workflow, AI boundary and rollback | 7/20 |
| Relevant local verification | 13/20 |
| Worktree control and documentation evidence | 9/10 |
| **Total** | **56/100** |

## A. Commit blockers

### A1 — BLOCKER: a local-only, unapproved AI candidate can be started as production

**Files:** `.github/workflows/deploy-production.yml` (bundle assembly and transfer); `infrastructure/production/deploy-release.sh` (manifest verification and service startup); `infrastructure/production/compose.yaml` (AI artifact mounts); `apps/ai-service/verify-model-artifact.py`.

The release workflow copies `AI_MODEL_ARTIFACT_CANDIDATE.json` into the production bundle. The host deploy script verifies those bytes against that candidate manifest and then starts `api`, `ai-service` and `edge`. Compose mounts the host model and relevance directories into the AI service. The verifier intentionally accepts `LOCAL_ARTIFACT_CANDIDATE_NOT_PRODUCTION_RELEASE`; it proves byte agreement with that manifest, not release approval, provenance, redistribution rights, D3 quality acceptance or vector-index activation approval.

Task 06.3F records D3 at 6.8% stocked-image rejection against the existing maximum of 5%, no production-quality approval, no canonical source and unresolved distribution rights. If an operator has matching candidate bytes at the configured host paths, the current deployment path can nevertheless start that candidate in the production AI service. This contradicts the local-only boundary and the Task 06.3E/F decision.

**Minimal safe correction:** make the production path require a distinct approved production-release identity and owner authorization, with verified provenance/rights/quality gates. Until then, make the deployment candidate fail closed before switching the release pointer or starting AI with the candidate. Do not relabel or remove files from the candidate manifest to obtain a pass.

**Focused verification:** policy tests proving the local-only manifest is rejected by production release; tests proving the host pointer is unchanged and no service starts on a rejected, missing or untrusted production release; then a disposable-host installation/rollback exercise after the owner gates are resolved.

### A2 — HIGH: the documented OTP placeholder passes production secret validation

**Files:** `apps/backend/.env.production.example`, `apps/backend/src/config/env.ts`, `infrastructure/production/verify-production-env.py`.

The production example sets `OTP_HASH_SECRET=REPLACE_WITH_UNIQUE_RANDOM_VALUE`. Backend production validation checks only that this value is present and at least 16 characters. Unlike `JWT_SECRET`, it does not reject placeholder text or check that the value has adequate entropy. The deployment preflight does not validate this secret. Copying the template value can therefore leave a known OTP HMAC key accepted by application startup and deployment preflight.

**Minimal safe correction:** reject unresolved/known placeholder patterns and require a production-grade secret contract for `OTP_HASH_SECRET`; make the offline preflight reject the same placeholder; add negative and positive tests using disposable values. Review the same policy for all mandatory runtime secrets.

**Focused verification:** environment validation and deployment-preflight tests must reject the exact example placeholder and weak/reused values while accepting a sufficiently strong random fixture. No live secret should be used in tests.

### A3 — HIGH: privileged workflows reference movable Action tags

**Files:** `.github/workflows/deploy-production.yml`; `.github/workflows/prod-migration.yml`.

The workflows reference `actions/checkout@v4`, `actions/github-script@v7`, `actions/upload-artifact@v4` and `actions/download-artifact@v4` by tags rather than full reviewed commit SHAs. The deployment job consumes the SSH private key/known-host settings and the migration job is a privileged production workflow. A moved or compromised Action tag could execute code in a job that later receives sensitive credentials.

**Minimal safe correction:** pin third-party Actions used by privileged workflows to reviewed full commit SHAs and retain a human-readable version comment. Keep permissions minimal. Do not infer that a major-version tag is an immutable pin.

**Focused verification:** extend workflow policy tests to reject non-SHA Action references in production release/deployment and production migration workflows; rerun those policy tests and inspect the resolved upstream commit identities during the remediation task.

### A4 — MEDIUM: security documentation contradicts the current Socket.IO code

**File:** `docs/10_Operations/SECURITY.md`.

The Task 06.3 paragraph says explicit Engine.IO WebSocket Origin rejection is not implemented. `apps/backend/src/sockets/delivery.gateway.ts` now supplies `allowRequest` to reject missing or untrusted WebSocket Origin values; polling relies on the exact CORS allowlist. The runbook is now inaccurate about the deployed code contract. The corresponding socket integration test did not complete in this environment, so documentation should describe implementation and evidence status precisely.

**Minimal safe correction:** update the security runbook to distinguish WebSocket `allowRequest` checks from polling CORS behavior and state that runtime/browser verification remains outstanding.

**Focused verification:** review the updated wording against the code and pass the local Socket.IO Origin, polling, upgrade and reconnect tests in an environment where loopback test sockets are permitted.

## B. Required before Prompt 2 / deployment work

These are not additional commit blockers unless they expose an implementation defect; they are gates before host/prod work proceeds:

1. Obtain and record the approved hostname strategy, DNS ownership, Google OAuth redirect eligibility and provider consent-screen status. No hostname or OAuth provider setting was changed or tested.
2. Complete a real local Docker/Compose build and runtime smoke test, Nginx syntax/runtime check, unknown-Host test, SPA deep-link test, API routing test, and Engine.IO polling/WebSocket upgrade/reconnect test. Docker and Nginx are unavailable on this workstation.
3. Complete the supported-browser customer/admin login, refresh rotation/reuse, logout, protected-route, CSRF/Origin and socket matrix over the final canonical HTTPS host.
4. Prove TLS first boot, staging issuance, renewal schedule, expiry alert, atomic install, Nginx validation/reload, failure rollback and recovery on an authorized isolated host. No public certificate was issued.
5. Measure the complete approved service set on a host of adequate size. The $6/1 GiB Droplet remains rejected; current Compose limits are intentionally unset. No host measurement exists.
6. Exercise exact-SHA build, bundle transfer, readiness, rollback and retention on a disposable host. Confirm protected GitHub Environment reviewers, branch restrictions, SSH identity/host-key setup and secret access from repository settings; YAML alone does not prove those controls.
7. Verify PROD backup/PITR evidence and a restore rehearsal under separate authorization. Keep migrations independent from app startup and application deployment.
8. Resolve the existing AI source, rights, quality, store and production-index gates before any production AI release. Task 06.3F's unresolved decisions remain open.
9. Complete provider-specific Test Mode/payment/webhook and server-side email verification only under their separate provider authorization. Worker dispatch remains disabled by default.

## C. Owner decisions required

- **ML/model owner and Principal Architect:** provide a canonical immutable artifact source and provenance; decide whether D3 is acceptable only with a newly qualifying evaluation under the existing threshold or whether another approved candidate is required. The existing DEV exception is not production approval.
- **Rights owner:** decide whether derived model artifacts may be redistributed, to which audience, under which notices and license obligations. Public GitHub Release assets must be treated as public; no public permission is recorded.
- **Infrastructure/release owner:** select an approved private artifact store (if needed), budget, access, retention and recovery policy. No store or paid service is approved.
- **Product/infrastructure operator:** select a hostname/domain strategy and cost boundary; confirm Google OAuth eligibility and the exact release feature requirements.
- **GitHub/repository owner:** verify protected Environment reviewers, branch restrictions and required checks in account settings.
- **DBA/operations owner:** supply independently reviewed backup/restore and host recovery evidence before production changes.

## D. Optional improvements

- Pin base container images by digest in addition to using version tags, then record the resolved digest in release provenance. The current image manifest records built image content IDs and declared base tags.
- Split any later commits into path-scoped logical groups (application/session controls, infrastructure/release, database/admin bootstrap, documentation/evidence). Do not stage the current entire worktree as a single bulk operation.
- Review the frontend build's existing bundle-size and Sass/Vite warnings separately; the build succeeds and these warnings do not explain the commit blockers above.

## Security review findings

- **Positive static evidence:** only the edge service publishes host ports; API and FastAPI have no host-published ports. FastAPI is on internal Compose networks and the AI service mount is read-only. API, AI and edge containers use read-only roots and resource/PID limits are required-but-unset. The edge runs as UID 101 with all capabilities dropped. Worker services are profile-gated, use separate env files, do not start by default, and dispatch controls in the candidate templates are false.
- **Positive static evidence:** backend refresh/logout Origin checks are exact-origin; current refresh cookies remain host-only, HttpOnly, Secure in production and SameSite=Lax. Nginx fixes the canonical Host and forwarded headers, rejects unknown Hosts, keeps `/api/` and `/socket.io/` separate from SPA fallback, and handles WebSocket upgrades. No auth/cookie/CORS/CSRF setting was changed by this audit.
- **Secret scan:** a targeted token-shaped pattern scan of changed paths found no matches for common live Stripe, private-key, Google API-key or GitHub token forms. This is not a comprehensive secret scanner. No tracked model files were found; both model directories remain ignored by the root `.gitignore`.
- **Risks:** the AI candidate production activation path and OTP placeholder validation are commit blockers. Production Actions are not SHA-pinned. Host-level network, process, file-permission, TLS and browser behavior remain unverified.

## Test and QA assessment

| Check | Result |
|---|---|
| Infrastructure policy tests (`node --test .github/scripts/*.test.cjs infrastructure/production/*.test.cjs infrastructure/production/tls/*.test.cjs`) | **PASS — 45 tests** |
| Production env preflight (`python infrastructure/production/verify-production-env.test.py`) | **PASS — 4 tests** |
| Focused backend unit tests for Origin middleware, worker heartbeat, env validation and admin-team service | **PASS — 41 tests across 4 files** |
| Repository typecheck (`npm run typecheck`) | **PASS** — frontend and backend typechecks completed |
| Repository lint (`npm run lint`) | **PASS**, with 5 existing frontend Fast Refresh warnings; backend lint completed without reported errors |
| Frontend production build (`npm run build --workspace=apps/frontend`) | **PASS**, with Vite/Sass/dynamic-import and >500 kB chunk warnings |
| YAML parsing of deploy, PROD migration, CI and production Compose files | **PASS** — parse only, not Compose semantic/runtime validation |
| `git diff --check` | **PASS** — no whitespace errors; Git printed existing LF-to-CRLF working-copy warnings for two files |
| Full frontend suite accidentally invoked by the root `npm test -- ...` wrapper | **PASS — 1,659 tests in 192 files** |
| Broader selected backend run from that same wrapper | **NOT VERIFIED — 34 tests failed while the sandbox denied loopback binds (`EACCES 127.0.0.1`); Google integration setup refused to run without `DATABASE_TEST_TARGET_REQUIRED`. 44 tests passed in that invocation. No shared DB was accessed.** |
| System-Python AI pytest attempt | **BLOCKED** — the system interpreter lacks FastAPI. The prior Task 06.3D report records 49 focused tests and the offline verifier passing at the same repository HEAD; Task 06.3E/F changed documentation only, so that historical result was reviewed and not redundantly rerun. It remains local candidate evidence, not production approval. |
| Docker/Compose, Nginx, shell syntax, browser, provider and host runtime | **NOT VERIFIED** — Docker/Nginx executables are absent and Windows denied execution of the available Bash executable. No host/browser/provider runtime was started. |

## Recommended staging scope

**Do not stage the current set.** The initial worktree had 37 modified tracked files and 48 untracked paths, with no historical clean snapshot that can prove every path was introduced only for Task 06.3. After A1–A4 are remediated and reviewed, stage only the explicitly approved Task 06.3 paths in logical, path-scoped groups. Keep unrelated pre-existing user work out. Review the migration/admin-bootstrap change separately because it changes schema and has not been applied or tested against any shared database.

## Final recommendation

**NOT READY TO COMMIT — 56/100.** Complete the four specific remediation items in a separately scoped task, then repeat the targeted policy, environment, security-documentation and relevant backend tests. Reassess staging scope from the resulting explicit path list. Production deployment remains **NO-GO** independently of the eventual commit decision.
