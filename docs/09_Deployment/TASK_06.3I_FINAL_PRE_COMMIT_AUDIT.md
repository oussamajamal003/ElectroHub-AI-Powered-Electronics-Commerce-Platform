# Task 06.3I — Final Consolidated Pre-Commit Audit

**Decision:** **READY AFTER SPECIFIC FIXES**

**Score:** **68/100**

**Deployment:** **NO-GO**
**Audit mode:** Read-only review; only the two requested audit reports were created.

## Executive decision

Task 06.3H's four blockers are corrected at the source and policy level. Current production workflow policy, secret validation, same-origin security documentation, Docker/Nginx isolation and the explicit AI release boundary are consistent with the reviewed implementation. The H test results are credible for their stated scope; the host deployment script still has no Bash/runtime evidence.

This audit found two additional, concrete defects in the privileged host deployment failure boundary. The script copies and extracts an SSH-user-controlled bundle as root without rejecting symlink/non-regular inputs or bounding archive expansion. Its rollback handler suppresses errors while replacing the current pointer, then builds the recovery Compose command from that pointer; if pointer restoration fails, it can attempt to start the failed candidate again. These are **commit blockers** because they affect the safety of the root deployment command itself, not merely production runtime evidence.

Do not stage or commit the accumulated change set yet. Remediate these host deployment defects in one narrowly scoped follow-up, add failure-path tests, then repeat a focused pre-commit review. Do not reopen A1–A4 absent new evidence.

## Score basis

| Area | Score |
|---|---:|
| Backend, frontend and session security | 18/20 |
| Docker, Nginx and service boundaries | 16/20 |
| Release, host ingestion and rollback | 8/20 |
| Local QA and evidence | 17/20 |
| Git/worktree preservation | 9/10 |
| **Total** | **68/100** |

## A. Commit blockers

### A1 — HIGH: privileged host deployment ingests untrusted and unbounded files

**File:** infrastructure/production/deploy-release.sh, especially lines 54–105.
**Classification:** **A — Commit blocker.**

The workflow creates the incoming release directory as the SSH deploy user, uploads files there, then invokes the fixed deployment command through sudo. The root script checks readability of several paths, but does not verify that the incoming directory and each bundle file are non-symlink regular files. It then runs root install on these user-controlled paths (lines 83–88). The archive path checks reject traversal and link members, but do not cap compressed size, member count, per-file size or aggregate uncompressed size before tarfile.extractall runs as root (lines 89–105). Bundle self-checks happen only after that extraction.

This makes the privileged path vulnerable to resource exhaustion through a special-file input or a decompression-bomb source archive. The root-owned release filesystem can be consumed before manifest verification. The current static host policy test does not exercise symlinks, special files or oversized archives.

**Minimal safe correction:** establish a root-controlled handoff for incoming bundles; open/copy only verified regular files without following symlinks; reject special files; enforce measured compressed and total expanded size/member limits before extraction; validate bundle metadata before extraction. Add disposable tests proving malicious inputs fail before pointer change, Docker load or Compose startup.

### A2 — HIGH: rollback can restart the rejected candidate after pointer-restore failure

**File:** infrastructure/production/deploy-release.sh, lines 173–184.
**Classification:** **A — Commit blocker.**

The ERR handler switches to set +e, then runs ln -s and mv -Tf to restore the previous current pointer without checking either result. It next constructs the previous Compose command using current. If link creation or replacement fails, current can still target the failed candidate, so the handler can run up for that candidate again. The handler does not first confirm that the resolved current pointer equals the previous release, and the existing tests do not simulate either failure.

**Minimal safe correction:** check both pointer operations, verify the resolved pointer before invoking Compose, and invoke the previous release using its explicit immutable path. If pointer recovery cannot be established, do not issue another up through current; log a critical failure and require operator intervention. Add a disposable failure-injection test for failed symlink creation/replacement and prove that the candidate is never restarted.

## B. Task 06.3H regression assessment

| Item | Audit result |
|---|---|
| A1 — local-only D3 candidate release | **Corrected.** Separate production metadata and the host trust pin are required. Workflow rejects absent/unapproved metadata before build; host verification precedes image load, pointer switch and service start. Current candidate stays local-only. Targeted current host policy test passed (2/2). |
| A2 — OTP/service secret validation | **Corrected in source.** OTP checks are production-only, enforce length/diversity/placeholders and separation from JWT signing secrets. Brevo and AI service-key preflight checks reject placeholders/weak values. H reports 9 Python preflight and 58 backend env/AI tests passed. |
| A3 — privileged Action pins | **Corrected.** Both production workflows show full reviewed SHAs and version comments. H reports policy tests and workflow YAML parsing passed; upstream identities were linked in the H report. Account-level Environment configuration remains unverified. |
| A4 — Socket.IO runbook | **Corrected.** WebSocket upgrades use allowRequest; polling uses the exact credentialed CORS allowlist. H's loopback suite was 3 passed / 16 blocked by sandbox EACCES; no runtime/browser pass is claimed. |

The two existing AI release gate tests establish static ordering and verifier metadata behavior, but they do not execute the privileged shell. The new findings are outside A1–A4 and require new host-script failure-path coverage.

## Security, configuration and repository review

- **Origin/auth:** frontend API and Socket.IO clients use same-origin paths. Production refresh cookies remain host-only, HttpOnly, Secure, SameSite=Lax with scoped paths. Refresh/logout require the configured frontend Origin. No weakening was found in the reviewed changes. Browser/session behavior on a production hostname remains unverified.
- **Nginx/Compose:** only the edge publishes ports; API and FastAPI have no host-published ports. FastAPI is private; API/AI share the intended private service network. SPA fallback does not swallow API or Socket.IO routes; fixed canonical Host, unknown-host rejection, WebSocket upgrade and polling proxy paths are present. Docker/Nginx runtime was not available.
- **Workers/admin:** worker services are profile-gated and not included in the deployment command; the reviewed templates keep dispatch off. Admin bootstrap is an interactive operator-only CLI pinned to the PROD project identity, with an initial-admin check, a one-time invitation and no public registration route. Migration remains separate from application deploy and was not run.
- **AI:** the candidate manifest still carries LOCAL_ARTIFACT_CANDIDATE_NOT_PRODUCTION_RELEASE; there is no production release manifest or host pin. No AI-unavailable bypass or model bytes in Git were found. git ls-files apps/ai-service/models returned no tracked weights; candidate model paths are ignored. No workflow packages the local candidate manifest or uploads model weights.
- **Secrets/hygiene:** a targeted pattern scan over changed paths found no private-key header, GitHub token, AWS access-key, live Stripe key, Google API key or Brevo key pattern. Production .env files and private certificates/keys were absent from the change set; templates use placeholders. The scan is targeted, not a general secret-scanner guarantee.
- **CI/dependencies:** production Actions are full-SHA pinned. Backend package dependencies match the root lockfile. GitHub Environment approvals, reviewers, branch protection and required checks are account-level settings and were not inspected.
- **Documentation:** H accurately describes the corrected source controls and their evidence limits. Task 06.3F still records no canonical AI source, D3 quality approval or redistribution-rights decision. Historical reports were not edited.

## B. Prompt 2 blockers (not commit blockers)

- No Bash parser or shell runtime was available; H's bash -n attempt was blocked by Bash/E_ACCESSDENIED. Docker, Compose and Nginx runtime, local browser matrix, and host deployment/rollback remain unverified.
- Public hostname/OAuth eligibility and public HTTPS/TLS renewal/recovery lifecycle are not proven.
- Production browser tests for customer/admin login, refresh/reuse, logout, CSRF/Origin and Socket.IO remain outstanding.
- Backup/restore rehearsal and actual host memory/CPU/disk measurements remain outstanding. The 1 GiB VPS remains rejected for the complete stack.
- Account-level GitHub Environment protection and host SSH/sudo policy remain unverified.

## C. Owner decisions

- Canonical AI artifact source and reproducible provenance.
- D3 quality decision under the existing failed <=5% acceptance gate; no production approval exists.
- Redistribution rights and permitted artifact audience; no store or distribution audience is authorized.
- Any paid host/domain/artifact store and the resulting budget.

## D. Optional improvements

- Consider immutable base-image digests and signed/attested whole-release provenance once the release trust model and owner decisions are approved. These do not replace the two required host-script corrections.

## Decision and next task

**READY AFTER SPECIFIC FIXES — 68/100.** No staging paths are approved by this audit. Keep the worktree unstaged. Create one narrowly scoped follow-up: **Task 06.3J — Harden Privileged Bundle Intake and Rollback Failure Handling**. It should address A1 and A2 above, add local fixture/failure-injection tests, and provide a safe parser result if a permitted Bash parser becomes available. Production remains **NO-GO** independently.
