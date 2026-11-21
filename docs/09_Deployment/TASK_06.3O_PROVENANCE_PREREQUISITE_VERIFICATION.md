# Task 06.3O — Provenance Prerequisite Verification

**Decision: BLOCKED BY OWNER/ACCOUNT CONFIGURATION**
**Production release: NO-GO — both fail-closed holds remain active.**
**Scope: read-only repository/account prerequisite review and test planning.**

## Executive result

The repository source still blocks all production release attempts. The two workflow jobs stop before build or deployment side effects; the fixed host helper rejects before reading deployment configuration or opening the SSH-user intake. The fixed environment and AI validators are present in the local deployment candidate and are ordered before Compose validation and Docker image load, but the host's installed-file state cannot be checked locally.

No connected GitHub repository-inspection tool is available in this session. The tool inventory contained no GitHub/repository capability. Per task scope, no GitHub API, `gh api`, browser repository settings inspection, or write operation was used. Therefore current repository ID, visibility, default branch, rulesets, branch protections, Environment existence/reviewers, workflow file protections, and GitHub Actions account settings are **UNVERIFIED**. The owner-approved numeric repository ID `1329865493` remains recorded as an input, not independently confirmed here.

The current local Git origin is `https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform.git`; that proves only the checkout's configured remote URL, not current GitHub metadata. The earlier Task 06.3F report recorded public repository visibility, but this task could not refresh that external fact. Treat any future attestation metadata as potentially public until current visibility is verified.

No test workflow was added and no attestation, bundle, or test fixture was generated. GitHub's official `actions/attest` flow writes an attestation to GitHub's attestation service and the Sigstore transparency system; generating a harmless fixture would therefore still publish attestation metadata, which this task expressly forbids. A non-production fixture requires a separate explicit authorization after the signer and account policy are verified.

## Live local repository facts

Repository state at inspection:

- Branch: `feature/06.3-production-infrastructure`.
- HEAD and merge base with local `develop`: `053a271ba36ebcf436720bdc6aa87c7bb79cf149`.
- Local origin URL: `https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform.git`.
- Initial worktree: 37 modified tracked files, 99 untracked files, zero staged files; no user changes were modified by this audit.
- `.github/workflows/deploy-production.yml` is an untracked local worktree file, not part of HEAD. Its contents do not establish that the workflow is present on GitHub or on `develop`.
- Local workflow directory has no reusable production signer workflow and no `workflow_call` workflow.
- No `CODEOWNERS` file was found at repository root or under `.github`. This does not establish whether an account-level ruleset or branch rule exists.

## GitHub account/repository inspection matrix

| Item | Result | Evidence/limitation |
|---|---|---|
| Repository ID `1329865493` | **UNVERIFIED** | Approved by the owner in Task 06.3N; no connected read-only repository tool was available to confirm it. |
| Canonical repository name | **UNVERIFIED externally** | Local `origin` is configured to `oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform`; remote metadata was not queried. |
| Public/private visibility | **UNVERIFIED now** | Task 06.3F historical report says public. Assume public for release/attestation exposure planning until refreshed. |
| Default branch | **UNVERIFIED externally** | Local `develop` exists at the baseline SHA; local branch naming does not prove GitHub's default branch. |
| `develop` branch protection/ruleset | **UNVERIFIED** | Requires read-only GitHub account/repository policy inspection. |
| Production Environment `electrohub-production-deploy` exists and has reviewers | **UNVERIFIED** | The local candidate workflow declares this name only on its deploy job. YAML does not establish Environment existence, required reviewers, bypass policy, or protection settings. |
| Current candidate workflow path | **Local only** | `.github/workflows/deploy-production.yml` exists in the worktree but is untracked and is not in the current commit. |
| Effective local workflow permissions | **Read-only in YAML** | The candidate file grants workflow-level `contents: read`, `checks: read`, `actions: read`. It grants no `id-token: write`, `attestations: write`, or `artifact-metadata: write`; no attestation is generated. |
| Reusable signer workflow | **Not present locally** | No `.github/workflows/reusable-production-release.yml` or `workflow_call` definition was found. GitHub-side workflow state is unverified. |
| Preventing unreviewed signer-workflow changes | **UNVERIFIED / no local CODEOWNERS** | No CODEOWNERS file was found. Actual required reviews, rulesets, bypass actors and workflow permissions must be checked in GitHub account settings. |
| GitHub Actions attestation availability/plan | **UNVERIFIED** | No account/feature/billing view was available and no action was run. |

## Fail-closed hold and fixed validators

### Production workflow

The local candidate `.github/workflows/deploy-production.yml` has a build-job hold before checkout, image build, bundle assembly or upload, and a deploy-job hold before checkout, artifact download, runner-side Docker image load, SSH setup/transfer or host invocation. Both hold messages require the approved whole-release provenance policy and implementation. No edit was made to the workflow.

### Host helper and deployment shell

`infrastructure/production/prepare-release-bundle.py` has `_require_approved_release_provenance()`, which unconditionally raises `IntakeError`. It is called by both `prepare_bundle()` and the root-only `_prepare_command()` before deployment limits are read or SSH intake is opened. The helper's current behavior remains rejection; there is no verifier or bypass path.

`infrastructure/production/deploy-release.sh` invokes the fixed host `prepare` command before Compose validation, Docker load, release directory installation, active pointer replacement, or Compose startup. With `set -e`, rejection terminates the shell; the existing exit cleanup handles task-owned staging if present. The fixed environment and AI checks follow preparation, then precede `docker compose config --quiet` and `docker load`. They are not reached while the global helper hold is active.

`infrastructure/production/install-deploy-command.sh` declares root-owned installation targets for the bundle helper, environment checker and AI artifact verifier. Its install commands use `install -o root -g root` with `0640` for Python helpers and `0750` for the deployment entrypoint, and it refuses an existing content/mode mismatch. The deployment script checks the helper files are regular non-symlink files, root-owned, and not group/world writable. These are source-level expectations only: no host was accessed, so actual ownership, modes and installed digests are **UNVERIFIED**.

Failure behavior is fail-closed by shell `set -e` plus the helper's exception return. The environment checker validates production env shape and target; the AI checker validates the host-pinned AI release identity and artifact/model compatibility. Neither proves application bundle provenance. No production credentials or model artifacts were read.

## Proposed exact signer identity contract — pending owner/account approval

This is the proposed identity for review; neither workflow exists as an approved GitHub workflow, and no certificate identity has been generated or observed.

| Field | Proposed value | Status |
|---|---|---|
| Repository ID | `1329865493` | Owner-approved input; live GitHub confirmation **UNVERIFIED**. |
| Canonical repository | `oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform` | Derived from local origin; live name/ownership **UNVERIFIED**. |
| OIDC issuer | `https://token.actions.githubusercontent.com` | Official GitHub Actions issuer; should be exact host verifier policy. |
| Caller path | `.github/workflows/deploy-production.yml` | Existing local candidate is untracked; must be reviewed and present on the approved protected branch before use. |
| Signer path | `.github/workflows/reusable-production-release.yml` | Recommended dedicated reusable trusted builder; **proposed only, does not exist locally**. |
| Signer relationship | Caller job invokes reusable signer with `uses: <owner>/<repo>/.github/workflows/reusable-production-release.yml@<reviewed-full-commit-SHA>`; signer job owns packaging and attestation | Pending implementation and review. The reusable revision must be a full SHA and host policy must allow only reviewed signer workflow revisions. |
| Proposed certificate identity string | `https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/.github/workflows/reusable-production-release.yml@refs/heads/develop` | Candidate only. Confirm this exact identity from an official generated attestation; the pinned reusable workflow revision/digest is a separate allowlist item. |
| Signer trigger | `workflow_call` only | No direct caller-selected predicate claims; source/ref/release identity must be derived and validated in trusted workflow context. |
| Source ref | `refs/heads/develop` | Matches current candidate YAML intent; protected status **UNVERIFIED** and owner confirmation required. |
| Signer Environment | Proposed `electrohub-production-release` | New proposed Environment; does not exist by evidence here. Owner must decide reviewer rules and approval-before-signing policy. |
| Deployment Environment | `electrohub-production-deploy` | Present in local candidate workflow only; GitHub Environment settings **UNVERIFIED**. |
| Identity claims to verify | repository ID/name; issuer; signer workflow path and digest; source ref and SHA; Environment; run ID and attempt; unique release ID; intended target; subject bundle SHA-256 | Each source must be classified as signed certificate claim, verified statement field, or root-controlled request. Workflow-controlled predicate values cannot by themselves prove signer identity. |

GitHub's OIDC reference documents `iss`, repository ID, workflow refs/revisions, Environment, run ID and attempt claims. The exact certificate/CLI output for the proposed reusable workflow must be confirmed from an official generated non-production attestation before the host parser is accepted. [OIDC claims](https://docs.github.com/en/actions/reference/security/oidc), [GitHub CLI attestation output and identity flags](https://cli.github.com/manual/gh_attestation_verify).

## Non-production fixture plan — not executed

After owner approval of workflow identity, account protections, and publication scope:

1. Add a dedicated manual-only test workflow, separate from the production deploy workflow, on the protected test ref. Give it no production Environment secrets, SSH/deployment credentials, database credentials, Docker host access, or deployment job.
2. Create a harmless temporary text payload with a unique run/attempt-derived name. Compute its SHA-256 in the trusted workflow. Do not use source archives, images, model weights, secrets, customer data, or production release metadata.
3. Use the officially supported, full-SHA-pinned `actions/attest` action on that one payload. The action's documented workflow permissions include `id-token: write`, `attestations: write`, and `artifact-metadata: write`; grant them only to the signer job. Use no custom predicate for identity proof; derive necessary claims in the trusted builder and verify signed certificate fields separately.
4. Within the disposable runner, verify the exact payload digest and attestation with a patched, digest-pinned GitHub CLI and a separately obtained official trusted root. Record repository ID, actual signer/certificate identity, issuer, source SHA/ref, run/attempt and Environment only after inspecting verifier output. Remove/modify the payload and confirm verification fails.
5. Do not transfer or retain a production artifact. Use only a test-only fixture and test trust policy. Do not accept the test workflow as production signer.
6. If an offline host verifier is implemented later, pass the real test bundle and test root to isolated Linux unit/integration fixtures; test exact identity, wrong claims, digest tampering, expiry/stale root and fail-before-side-effects.

No step was run. GitHub's attestation action creates/persists an attestation and transparency-log entry. Since this task prohibits publishing attestations, fixture generation itself requires a separate explicit authorization. Repository visibility and account feature availability also need read-only confirmation first. [Official `actions/attest` documentation](https://github.com/actions/attest), [offline verification](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline).

## Host trust-root and verifier prerequisites

Before accepting any release, the host design must establish all of the following without using any bundle-controlled file:

- **Verifier:** fixed root-owned GitHub CLI or another GitHub-supported verifier, installed independently, version/digest pinned, regular non-symlink binary, and checked before each use. Current local GitHub CLI is **2.96.0** and was not used for attestation verification. The official signer-workflow advisory affects versions through 2.101.0; require at least a patched release and verify its published checksum before selecting a host pin. [GHSA-wjmr-j3rp-mh2g](https://github.com/cli/cli/security/advisories/GHSA-wjmr-j3rp-mh2g).
- **Exact identity:** invoke the supported offline verifier with the root-controlled expected repository and exact certificate identity, enforce the trusted issuer, expected predicate type, source SHA/ref and expected bundle digest; then independently check repository ID and all required certificate claims. Do not accept a signer-workflow prefix match or workflow-controlled predicate as proof of identity.
- **Trust root:** use the official Sigstore `trusted_root.jsonl` format obtained by the official updater/verifier's trust mechanism, not a root supplied in the incoming bundle. Install a versioned root and its SHA-256, fetch/validation time, source, verifier version and validity metadata atomically as root-owned files through an owner-approved independent channel.
- **Freshness:** the proposed 30-day freshness target remains provisional. A missing, malformed, stale, mismatched or unvalidated root must reject deployment. GitHub documents that the offline root format has no built-in expiration and stale snapshots do not reveal later revocation; a freshness policy bounds this exposure but cannot eliminate it.
- **Rotation/revocation/recovery:** name a policy owner and trust custodian; approve overlap, revocation publication, emergency disable, refresh outage behavior, prior-root recovery and ledger-safe host restore. Do not silently fall back to a stale prior root. For compromise, stop release acceptance, update independent host policy/root through the approved out-of-band channel, revoke pending authorizations, and re-enroll only after a documented owner review.
- **Availability:** offline host verification avoids a GitHub API dependency during deploy but relies on a current root and valid transparency proof in the bundle. If online fetching is selected instead, GitHub/Sigstore network outage becomes a hard deployment failure. No network fallback may skip verification.

The 30-day target is not implemented or treated as approved. No verifier or trust-root material was installed here.

## Durable replay and authorization design

Recommended host-side design, still requiring owner approval:

1. Require a root-managed, one-time operator authorization record distinct from provenance. The current workflow's `authorization_reference` is only a string and is not proof of authorization. The authorization must bind release ID, complete bundle digest, source SHA, repository ID, signer/workflow/run/attempt, intended environment, approval reference, issue time, expiry and one-time ID.
2. Store authorization and consumption in a root-owned durable SQLite database (directory and DB not group/world writable; restrictive file mode), with `BEGIN IMMEDIATE`, unique constraints on authorization ID, release ID, and `(repository_id, run_id, attempt, environment)`. Do not rely on an in-memory cache.
3. Verify provenance and all external metadata first. In one transaction, confirm the exact authorization binding, current time/expiry and unused state, then consume/record the release/run/attempt/digest/environment before Docker load. A replay or duplicate concurrent deployment must fail before side effects.
4. Reject missing, corrupt, locked/unavailable, rolled-back or unrecognized DB schema. Never recreate an empty ledger automatically. Lock the deployment process as it is today and additionally rely on the DB transaction/uniqueness constraints.
5. Keep consumed identities after failed pre-activation work. A retry requires a new workflow attempt or a new owner-approved one-time authorization; rollback may only restore a previously accepted immutable release and must not re-authorize the rejected candidate.
6. Define backup and restore carefully: restoring an older ledger can make a consumed authorization appear unused. Recovery must invalidate/reissue pending authorization IDs and use a monotonic epoch/owner-controlled recovery marker before intake resumes.

The proposed 24-hour authorization window remains provisional. The owner must decide the independent approving role/channel, who can create authorization records, expiry/skew, consumption point, rollback/redeploy rules, backup cadence, retention, and recovery authority. No database or production authorization was created.

## Linux test execution path

The current local `.github/workflows/ci.yml` defines an Ubuntu `ubuntu-latest` workflow-policy job and includes the Python bundle intake test command, as well as production environment and AI release policy tests. This is repository configuration only; the file is modified in the current worktree and no remote Actions run or account-level runner authorization was inspected. The connected GitHub capability was unavailable, so it is **not verified that an approved runner is currently enabled or that a run can be dispatched**.

If the owner permits it, prefer running the existing test command on the existing Ubuntu CI job after the appropriate repository changes are reviewed and available there. Add an isolated attestation test job only if necessary; scope it to harmless test payloads and no production secrets or deployment permissions. Do not trigger a run until the owner separately approves the fact that artifact attestation metadata will be published. No Linux verification is claimed for this task.

## Owner decisions required

1. Provide an authorized read-only GitHub repository inspection path or review evidence for repository ID/visibility/default branch, branch rulesets, Environment reviewers/bypass, Actions availability and workflow protections.
2. Approve the dedicated signer workflow path and caller/signer relationship; confirm whether the proposed `electrohub-production-release` Environment should exist, its reviewers and bypass policy, and whether approval precedes attestation signing.
3. Confirm the exact signer workflow claim shape from a test attestation and approve allowed signer workflow revision rotation.
4. Explicitly authorize one non-production attestation generation knowing the attestation metadata will be persisted to GitHub/Sigstore. Until then, fixture generation is prohibited.
5. Assign release provenance policy ownership, host trust-root custody, revocation authority and emergency recovery role; approve verifier and root distribution sources and root freshness/rotation policy.
6. Approve one-time release authorization format/owner, the provisional expiry policy, replay-ledger restore semantics and failure handling.
7. Keep AI approval independent: model source, redistribution rights and D3 quality authorization remain unresolved and cannot be inferred from an application attestation.

## Decision

**BLOCKED BY OWNER/ACCOUNT CONFIGURATION.** Local source confirms the fail-closed behavior and a repository-declared Ubuntu test path. It does not confirm GitHub account protections, public/private visibility, remote repository identity, a protected signer workflow, a valid non-production attestation, a host verifier/root, or durable replay state. No production protection was weakened and no attestation was published.

Official reference access date: **2026-11-19**.
