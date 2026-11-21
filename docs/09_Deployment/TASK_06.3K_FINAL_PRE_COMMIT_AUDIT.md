# Task 06.3K — Final Pre-Commit Audit

**Decision:** **NOT READY**
**Score:** **58/100**
**Production deployment:** **NO-GO**
**Audit mode:** Read-only source review and targeted local verification; the only intended repository files created were this report and its companion evidence report. Test imports may have used or generated ignored Python bytecode caches; the final ignored-path note in the evidence report records that limitation.

## Executive decision

Do not stage or commit the accumulated change set yet. The Linux bundle test suite exposed a failing assertion that also makes the newly added Ubuntu CI job fail. More seriously, the host deployment path treats a self-checksummed bundle as trusted, then executes Python verifier files from that bundle as root. The host does not authenticate the release manifest or prove that the source archive and image archive were produced by the approved workflow for the supplied SHA. This can bypass the AI release gate and turn control of the SSH-owned intake into root-level deployment execution.

Task 06.3J's descriptor-relative intake, bounded source archive parser, and rollback failure handling are materially improved. Its rollback failure-injection tests pass in Linux. Those improvements do not close the release authenticity gap, and the Linux test failure prevents the new policy job from passing as written.

## Score basis

| Area | Score |
|---|---:|
| Application authentication, origin and secret controls | 17/20 |
| Docker, Compose, Nginx and service boundaries | 15/20 |
| Privileged release trust and rollback | 8/20 |
| Local verification and regression evidence | 10/20 |
| Git/worktree preservation | 8/10 |
| **Total** | **58/100** |

The score reflects a strong set of local controls and focused tests, offset by a privileged release-provenance bypass and one failing Linux test. It is not a production-readiness score.

## Git state and preservation

| Item | At audit start |
|---|---|
| Branch | `feature/06.3-production-infrastructure` |
| HEAD | `053a271ba36ebcf436720bdc6aa87c7bb79cf149` |
| Local `develop` | `053a271ba36ebcf436720bdc6aa87c7bb79cf149` |
| Merge base with `develop` | `053a271ba36ebcf436720bdc6aa87c7bb79cf149` |
| Local `origin/develop` ref | `053a271ba36ebcf436720bdc6aa87c7bb79cf149` |
| Local upstream feature ref | `053a271ba36ebcf436720bdc6aa87c7bb79cf149` |
| Ahead/behind relative to local upstream ref | `0/0` |
| Tracked changed paths | 37 modified |
| Untracked files | 91 |
| Deleted/renamed paths | 0 |
| Staged paths | 0 |
| Total changed/untracked file paths | 128 |

The upstream values are local Git refs; no fetch or live remote reachability check was performed. The accumulated Task 06.3 source, configuration, migration, workflow and report paths were present. The initial inventory contains no implementation path beyond the previously accumulated work described by the Task 06.3 reports. Ownership of every untracked file cannot be inferred from Git; preserve ambiguous paths. This audit added only the two Task 06.3K reports. No existing file was edited by the audit.

The initial status listed 37 modified tracked paths and 91 untracked files. The final status check confirmed 37 modified tracked paths and 93 untracked files (the original 91 plus these two reports), with zero staged paths and zero deleted/renamed paths.

## A — Commit blockers

### A1 — Critical: the host accepts a self-authenticated bundle and runs its code as root

**Files:**

- `infrastructure/production/prepare-release-bundle.py`, especially `verify_release_bundle_files()` and `prepare_bundle()`.
- `infrastructure/production/deploy-release.sh`, lines 148–152, 156–166 and 186–187.
- `infrastructure/production/create-release-manifest.cjs` and `infrastructure/production/verify-release-manifest.cjs`.
- `.github/workflows/deploy-production.yml`, bundle creation, transfer and host invocation steps.

The fixed helper checks that `release-manifest.json` says the requested SHA and that the supplied archive bytes match the hashes inside that same manifest. Neither the host nor the root helper authenticates the manifest to a protected workflow identity, signed attestation, or independently verified source commit. The release SHA and all bundle checksums are therefore self-asserted by the party controlling the SSH-user-owned intake.

After this self-consistency check and extraction, the privileged shell executes `verify-production-env.py` and `verify-model-artifact.py` from the extracted bundle as root. A party able to replace intake contents can create a matching archive and manifest for the supplied SHA, replace those verifier scripts, and provide arbitrary tagged image bytes and a corresponding self-declared image config digest. The host can then run attacker-controlled verifier code as root, bypass the intended AI release check, load the supplied images, switch `current`, and start the supplied Compose definition. The AI release metadata pin does not protect this path because the code enforcing that pin is itself selected from the unauthenticated source archive.

This is a gap in the repository-enforced trust boundary, even though workflow-level GitHub Environment protection and SSH credential handling are intended controls. Those external controls are not host-verifiable provenance, and a checksum manifest alone proves integrity only relative to its own contents. The Task 06.3E distribution report makes this distinction explicitly.

**Required correction:** before any bundle-controlled code, Docker load, pointer mutation or Compose operation, authenticate the complete release identity using a separately trusted mechanism bound to the protected workflow and exact source SHA (for example, a reviewed signed provenance/attestation contract with a host-pinned trust policy). Keep privileged preflight logic in fixed host-owned code; do not execute verifier scripts from the received archive as root. Bind image identities and the Compose/source content to the authenticated release. Add a disposable test that tampers with the source archive and self-generated checksums while retaining the requested SHA, then proves rejection before any bundle script, Docker load, pointer replacement or Compose call. Do not implement a signature/key design without resolving its trust-owner decision.

### A2 — High: the Linux extraction-mode test fails and the CI job is red

**File/symbol:** `infrastructure/production/prepare-release-bundle.py`, `extract_validated_source()` (`safe_mode`); `infrastructure/production/prepare-release-bundle.test.py`, `test_extracts_safe_archive_with_private_openat_creation()`.

On Ubuntu WSL2, extraction of an executable member produces mode `0o511` (decimal 329), while the test requires `0o500`. The helper currently preserves all executable bits from the untrusted tar mode with `(expected.mode & 0o111) | 0o400`; this leaves group/world execute bits on the file. The parent directory is private, but the helper does not meet its own restrictive-mode test contract. `.github/workflows/ci.yml` runs this test suite on Ubuntu, so the observed failure will fail that CI step.

**Required correction:** retain only owner read and, when needed, owner execute bits; update or retain the assertion to prove the intended restrictive mode. Rerun the complete Linux suite and the focused CI policy job.

### A1 test coverage note

The archive parser and input-unit tests prove rejection cases and prevent writes outside their temporary extraction directory. Static host policy tests assert operation ordering. The Linux rollback failure-injection tests directly prove zero Compose calls for link creation failure, pointer replacement failure and pointer verification mismatch. There is not yet an integrated mocked host-entrypoint test proving a tampered/rejected bundle causes zero bundle-code execution, Docker load, pointer replacement and Compose start. Add that coverage with the provenance correction above.

## H remediation regression review

| H item | Current review |
|---|---|
| A1 — AI release approval | The verifier function remains fail-closed in isolation and the 6 focused AI release tests pass. **Host-path enforcement is not effective against an unauthenticated bundle verifier**, as described in A1. |
| A2 — OTP/service secret validation | Current backend and deployment preflight checks reject the example placeholder and weak values without logging the secret. Current Python preflight tests pass; H's backend environment/typecheck/lint evidence is reused because Task J/K did not change those backend source files. |
| A3 — privileged GitHub Action pins | Workflow policy passes and production workflow Action references are full SHAs with version comments. Account-level Environment reviewers and branch protections remain unverified. |
| A4 — Socket.IO Origin controls | Source matches the runbook: upgrade requests are checked by `allowRequest`, polling uses the configured credentialed CORS allowlist, and the namespace keeps auth/ownership checks. Browser and production runtime behavior remain unverified. |

## Source and architecture review

Reviewed actual implementation in the affected application, infrastructure and CI paths, including:

- Backend environment validation, refresh/logout route Origin checks, refresh-cookie options, Google OAuth callback origin/path validation, delivery Socket.IO gateway and focused tests.
- Frontend API transport and delivery socket client; API paths and Socket.IO transport use same-origin URLs, send credentials, and reconnect through the existing refresh flow.
- Production Compose, Dockerfiles, Nginx/ACME templates, edge entrypoint and static Nginx/Compose policy tests. Only the edge publishes application ports; API/AI remain private. Worker and ACME services are opt-in profiles and are not in the normal app startup command.
- Manual exact-SHA deployment workflow, migration workflows, workflow policy script/tests, release-manifest creator/verifiers, host installer, deployment shell and Python helper.
- AI candidate manifest and production verifier, admin bootstrap CLI/service and additive migration, worker runners/health checks, environment templates, and the Task 06.3J–F evidence/release-policy documents.
- Security, deployment, Docker, Nginx, TLS, backup and environment runbooks relevant to this release.

The candidate manifest still identifies itself as local-only; no production approval artifact, approved model source, rights approval or model-quality approval is present. No workflow uploads local candidate weights. No tracked AI weights were found; `apps/ai-service/models/` is ignored.

## B — Deployment-readiness blockers

These are not additional commit blockers, but deployment remains **NO-GO** until resolved:

- No Docker Compose/Nginx runtime or browser matrix was exercised. Windows has no Docker/Podman command; the existing WSL Docker client was not connected to a daemon or used to start containers.
- Hostname/OAuth eligibility, public TLS issuance/renewal and recovery, and account-level GitHub Environment protection remain unverified.
- No approved host was provisioned or measured; 1 GiB remains rejected. The example allows an 8 GiB image archive, while the helper hard ceiling is 16 GiB. Retaining up to five image archives can consume up to 40 GiB before Docker's unpacked image store, active containers, logs, extracted source and temporary headroom. Actual image archive size and host disk capacity are unknown.
- `create-release-manifest.cjs` hashes files with `fs.readFileSync`, buffering a whole archive. Its memory behavior has not been measured against actual images; the configured archive ceiling is not evidence that the runner or host can support the maximum.
- Host SSH/sudo restrictions, production backup/restore, actual production environment, and service readiness/rollback have not been verified.

## C — Owner decisions

- Canonical AI artifact source, redistribution rights/audience and model-quality approval remain unresolved. D3 remains not approved for production under its recorded acceptance threshold.
- The trusted release-provenance identity and key/trust ownership for whole application bundles must be approved before implementation. A checksum alone is insufficient.
- Host budget/plan and capacity remain unselected. No purchase or provisioning is authorized by this audit.

## D — Optional improvement

After the release trust contract is chosen, stream manifest hashing rather than reading large image archives wholly into memory. This is a resource-use improvement unless measured bundle size shows it prevents the currently approved build path.

## QA assessment

Newly run checks are recorded with exact outcomes in `TASK_06.3K_IMPLEMENTATION_EVIDENCE.md`. The essential result is **22 passed, 1 failed** in the Linux suite; all 3 rollback failure-injection cases passed. Bash syntax and Python compilation passed in the existing Ubuntu WSL2 distribution. Relevant infrastructure/workflow, AI release and Python production-environment suites passed on the workstation. No remote GitHub CI was queried.

Previously accepted Task 06.3H backend typecheck/lint and broader backend environment evidence were reused for unchanged backend files; no unrelated full application suite was rerun. Task 06.3J's earlier Windows test skips were superseded by the Linux execution in this audit, which ran all 23 tests and exposed the failure.

## Final recommendation

**NOT READY TO COMMIT — 58/100.** Address A1 and A2 in one narrowly scoped follow-up, including an authenticated whole-release provenance contract and integrated pre-activation rejection tests. Then rerun Linux bundle tests and the relevant workflow policy CI. Do not stage any paths from this audit; no staging allowlist is approved.

Production deployment remains **NO-GO** independently of commit readiness. This audit did not authorize or perform staging, commit, push, merge, deployment, provider access, production mutation, migration, spending, artifact publication or secret creation.
