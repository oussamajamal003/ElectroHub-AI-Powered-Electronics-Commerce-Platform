# CI Migration Safety: GitHub Administrator Checklist and Release Gates

**Dated checksum correction (2026-10-14):** the historical section 2 row asserting that all 12 committed LF blobs match DEV is superseded by the appended correction. See [focused reconciliation](REMOVE_USERS_PHONE_CHECKSUM_RECONCILIATION.md). The CI guard and its approval remain unchanged.

Status: **BLOCKED BY GITHUB ADMINISTRATOR.** Nothing here has been done. The Project Owner has not authorized any GitHub administrative change, GitHub Actions run, commit or push. This list contains no secret values and none must be copied into it.

Code in the working tree (uncommitted): `.github/workflows/{ci,dev-migration,verify-migration}.yml`, `.github/actions/disposable-postgres/action.yml`, `.github/scripts/{migration-plan,check-workflow-policy}.cjs`, `.github/scripts/ci-safety.test.cjs`. Review patch: `docs/tasks/Phase-03/CI_MIGRATION_SAFETY_REVIEW.patch`.

## 1. Administrator steps (repository admin; the `gh` forms are references, not executed)

Do them in this order. Steps 1-3 must be complete before the first push of this branch.

| # | Action | How to confirm (no secret values involved) |
|---|---|---|
| 1 | Create Environment `electrohub-dev-database` (Settings > Environments, or `gh api -X PUT repos/{owner}/{repo}/environments/electrohub-dev-database`). | Environment listed. |
| 2 | On it: **Required reviewers** = DATABASE owner + Principal Architect; enable **Prevent self-review**; **Deployment branches** = selected branches only (the approved release branch(es)); no admin bypass if the plan allows it. | Settings page shows the reviewers and branch rule. |
| 3 | Add `ELECTROHUB_DEV_DATABASE_URL` and `ELECTROHUB_DEV_DIRECT_URL` as secrets **of that Environment**. Values come from the existing secret store; never paste them into chat, an issue or a log. `DIRECT_URL` must be the non-pooler / session connection (not `pgbouncer=true`). | Environment secrets list shows both names. |
| 4 | **Delete the repository-level copies** of both secrets (Settings > Secrets and variables > Actions > Repository secrets). | `gh api repos/{owner}/{repo}/actions/secrets --jq '.secrets[].name'` must **not** list `ELECTROHUB_DEV_*`. Also check organization-level secrets shared to this repository (`gh api orgs/{org}/actions/secrets`), since those are also readable by every workflow. |
| 5 | Add CODEOWNERS for `.github/**` (and `apps/backend/prisma/**`) naming the CI owner and DATABASE owner, and enable "Require review from Code Owners". There is no CODEOWNERS file today. | Branch protection shows the rule. |
| 6 | Branch protection on `develop` and `main`: require PR, require status checks **`Workflow / Migration Safety Policy`** and **`Backend / Test`**, dismiss stale approvals, restrict force-pushes. | Rule visible; a test PR cannot merge without those checks. |
| 7 | Settings > Actions > General: workflow permissions "Read repository contents" default; do not allow Actions to approve PRs. | Settings page. |
| 8 | Confirm no other workflow, composite action or reusable workflow (including from other repositories) can obtain the DEV credentials: after step 4 only the Environment holds them, and only `dev-migration.yml` names the Environment. | Section 3 below. |

Until step 4 is done, any workflow in the repository (including one added in a later PR) can read the DEV credentials; the `workflow-policy` job detects such an edit but is not a substitute for credential scoping.

## 2. Release inventory gates (before the first push that contains the AUTH migration)

| Gate | Owner | State today |
|---|---|---|
| All 4 migrations already applied to DEV but untracked locally (`20261007000000_stripe_orchestration`, `20261009000000_product_test_fixture_visibility`, `20261012000000_storefront_product_visibility`, `20261012120000_payment_purchase_ownership`) are in the release branch with **unchanged bytes** (their SHA-256 prefixes match the DEV ledger: `8efc55f8e823`, `007b9167866b`, `21ae532f49eb`, `0cf4bc6b88a2`). | Payment / storefront workstream owners | OBSERVED untracked. **Open.** |
| The 12 tracked historical migrations stay unmodified; their ledger checksums match the committed LF blobs. | DATABASE | OBSERVED, matches. |
| AUTH migration `20261013000000_refresh_token_rotation_lineage` is committed as LF; SHA-256 `51495598e0e1a7e8d74b2d19f8e596fcae32a0e1afb2e626120fad7c06b2e991`; no CR bytes. | AUTH + DATABASE | OBSERVED: 0 CR bytes, checksum as stated. |
| **`.gitattributes` rule (corrected 2026-10-14).** Do NOT pin the four untracked applied migrations to `eol=lf`: `20261012120000_payment_purchase_ownership` is a **CRLF file** (10 CR bytes) and its DEV ledger checksum (`0cf4bc6b88a2`) is the CRLF hash. With `core.autocrlf=true` (this machine) a plain `git add`, or `eol=lf`, stores it as LF (`a45372e2e258`), which fails the ledger comparison. Proven in a throwaway repository: no rule and `eol=lf` give `a45372e2e258`; `-text` gives `0cf4bc6b88a2`. Recommended single rule, placed before the two existing `eol=lf` lines (those two files are LF, so they stay valid): `apps/backend/prisma/migrations/*/migration.sql -text`. It stores bytes exactly as committed, so every migration keeps its applied checksum on any OS. | `.gitattributes` owner (file is modified by another workstream; **not edited here**) | **PENDING OWNER.** |
| `migration-plan.cjs pre` compares applied migrations byte-for-byte on a Linux (LF) checkout, so a missing pin surfaces as a blocked run rather than silent drift. | CI | Implemented. |

## 3. Verification that unapproved jobs cannot receive shared-DEV credentials

Static (done locally, current tree): `node .github/scripts/check-workflow-policy.cjs` passes; only `dev-migration.yml` contains `secrets.ELECTROHUB_*`; it is `workflow_dispatch`-only, declares `environment: electrohub-dev-database`, has a non-cancelling per-target concurrency group, and runs `migration-plan.cjs pre` before and `post` after `prisma migrate deploy`. No `pull_request_target` anywhere. No PROD workflow, PROD secret name or PROD project ref is referenced by any workflow (the ref appears only in the guard script that refuses it).

Runtime (pending, needs the steps above and Actions authorization): see section 4.

## 4. One controlled disposable-CI acceptance run (pending: Actions NOT authorized)

Run only after section 1 steps 1-4 are complete and the owner authorizes pushing the branch or dispatching `verify-migration.yml`. If anything fails, **fix the CI defect; never point the job at shared DEV**.

Pass criteria, read from the job logs of the `Backend / Test` job and a manual `verify-migration.yml` run:

1. `docker run postgres:17` starts and `pg_isready` succeeds.
2. "Database target: disposable loopback PostgreSQL." is printed; no step references a hosted database host.
3. The backend tests connect over verified TLS (a connection error mentioning certificate verification fails the run).
4. `prisma generate` and `prisma validate` exit 0.
5. `prisma migrate deploy` applies all migrations (17 including the AUTH one) to the disposable database and nothing else; `prisma migrate status` reports the schema up to date.
6. The backend test step executes the database-backed tests; list any that fail because they assumed rows already present in shared DEV. Fix those fixtures; the seed script's DEV-only guard must not be loosened.
7. The runner is discarded afterwards (the container lives only for the job). No `ELECTROHUB_DEV_*` secret appears in the run's "Secrets" section for `Backend / Test` or `verify-migration`.
8. `dev-migration.yml` must **not** be dispatched as part of this acceptance run.

## 5. Not covered by this task

DEV migration execution, PROD read access, PROD migration and a PROD workflow each need their own written authorization (`AUTH_MIGRATION_RELEASE_PLAN.md` section 7).

## Dated checksum correction — 2026-10-14 (offline evidence only)

The original section 2 conclusion "The 12 tracked historical migrations ... match the committed LF blobs" is incorrect for `20260925020000_remove_users_phone`. **11/12** committed historical blobs match captured DEV; this migration's DEV/working-copy checksum is `15de2423e054cfc803989515209340260b5786ce9a4b3b3879b05ede5b81334f`, versus committed/index `227201e489fb0d6a4734037e10e0604a3d04505d400d5f47d59d168c2b5ef6e5`. Only one final CR byte differs; no SQL semantic change was found.

`migration-plan.cjs` correctly blocks that committed-byte mismatch. The preferred owner-reviewed correction is exact deployed-byte source preservation (353-byte mixed-ending buffer) with text conversion disabled for that path, not a guard bypass or ledger edit. Adding `-text` alone cannot replace an existing blob. Retain the four byte-exact untracked applied migrations, the CRLF payment file, 17-file expected inventory, pending AUTH status and separately documented PROD exceptions. No new environment/hash exception is approved. PROD remains unreconciled. The original table remains a historical snapshot; [the focused handoff](REMOVE_USERS_PHONE_CHECKSUM_RECONCILIATION.md) defines the separate owner decision and verification required before release.
