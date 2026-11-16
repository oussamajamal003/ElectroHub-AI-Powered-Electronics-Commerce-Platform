# CI Handoff: Workflows That Can Apply the Refresh-Token Migration to Shared DEV

Audience: CI/deployment owner (`AGENT_COORDINATION.md`: "CI, secrets, deployment" requires **Architect + Owner** explicit operational approval).
Status: **proposal only. No workflow file was modified. Nothing was pushed or triggered.** The migration `20261013000000_refresh_token_rotation_lineage` is local, uncommitted and unapplied.

## Why this matters

The migration revokes every existing refresh-token session (users must sign in again) and must run only inside the cutover in `REFRESH_TOKEN_LINEAGE.md` (old instances stopped first, written owner authorization). Any workflow that runs `prisma migrate deploy` against the shared DEV database applies it as soon as it is in the pushed tree, with none of that control.

## Evidence (local workflow files, current working tree)

| Workflow / job | Trigger | Applies migrations to DEV? |
| --- | --- | --- |
| `.github/workflows/ci.yml` > `backend-test` ("Prisma Migrate Deploy" step, `DATABASE_URL`/`DIRECT_URL` = `secrets.ELECTROHUB_DEV_*`) | `push` to `develop`, `main`, `feature/**`, `fix/**`, `chore/**`, `task/**`; `pull_request` to `develop`, `main` | **Yes, on every qualifying push and PR.** The branch is `feature/Stripe`, which matches `feature/**`. The step has no path filter and no `if:` condition. |
| `.github/workflows/dev-migration.yml` > `migrate` ("Deploy Prisma Migration to Dev") | `push` to `develop` with paths `apps/backend/prisma/schema.prisma`, `apps/backend/prisma/migrations/**`, the workflow itself; **and** `workflow_dispatch` | **Yes.** |
| `.github/workflows/verify-migration.yml` > `verify-migration` | `workflow_dispatch` only | Yes, but manual, against DEV secrets. |
| `.github/workflows/security.yml` | same push/PR events as `ci.yml` | No `migrate` step found. |

The remote repository was reported (by the Principal Architect) to match. This local inspection **confirms the same behavior**; the remote default-branch contents were not re-fetched here.

Also note: `backend-test` additionally runs the backend test suite against the same DEV database, so ordinary CI already mutates shared DEV.

## Required safety contract

1. Ordinary pushes, pull requests and test runs **must not** apply pending migrations to a shared database.
2. Migration deployment is a separately triggered, explicitly authorized action tied to the target environment and to the cutover procedure; source approval and migration execution are separate decisions.
3. A branch-name filter alone is not a sufficient boundary (any branch pattern can be matched by accident, and `workflow_dispatch` is open to anyone with write access unless gated).

## Recommended change (owner chooses the exact mechanism)

- `ci.yml`: remove "Prisma Migrate Deploy" from `backend-test`. Keep `prisma generate`, `prisma validate` and unit/mocked tests. If integration tests need a migrated database, run them against a disposable PostgreSQL service container created and migrated inside the job, never against `ELECTROHUB_DEV_*`.
- `dev-migration.yml`: drop the `push` trigger; keep only `workflow_dispatch`, bound to a protected GitHub **Environment** (required reviewers = the DATABASE owner and Architect) that holds the DEV secrets, with a required input naming the migration and the confirmed cutover ticket.
- `verify-migration.yml`: bind to the same protected environment (or point it at a disposable database).
- Move `ELECTROHUB_DEV_*` secrets from repository scope to the protected environment so jobs without approval cannot read them.

## Verification criteria for the corrected workflows

Static, no remote CI run needed to check these before merge:

1. `grep -rn "migrate deploy" .github/workflows` matches only workflow files whose triggers are `workflow_dispatch` and which declare an `environment:` with required reviewers.
2. No `push` or `pull_request` trigger is present in any workflow that references `ELECTROHUB_DEV_DATABASE_URL`/`ELECTROHUB_DEV_DIRECT_URL`, or the references are limited to jobs that do not run `prisma migrate` or tests that write.
3. `ci.yml` `backend-test` contains no `prisma migrate` command.
4. After the change merges, a throwaway pull request containing only a no-op migration directory, run against a disposable repository fork or dry-run branch protection, shows no job connecting to shared DEV. (Owner-run; not done here.)

## Until this is resolved

Do not commit/push the migration directory or `schema.prisma` changes from this workstream to any branch, and do not open a pull request containing them. Keep them local. Do not dispatch the DEV migration or verification workflows.

---

## Implementation status (2026-10-14): implemented locally, NOT committed, NOT pushed, NOT run

Authorization used: the CI/Integration task that explicitly covered `ci.yml`, `dev-migration.yml` and `verify-migration.yml`. The other workstream's existing `ci.yml` change (random `JWT_SECRET` for the test environment file) was preserved.

| Path | Change |
| --- | --- |
| `.github/workflows/ci.yml` | `backend-test` no longer references any shared-database secret. It starts a disposable TLS PostgreSQL 17, asserts the target is that loopback instance, then runs `prisma generate`, `validate`, `migrate deploy`, `migrate status` and `test:ci` against it only. New secret-free `workflow-policy` job. |
| `.github/workflows/dev-migration.yml` | `workflow_dispatch` only (push trigger removed). Job runs in Environment `electrohub-dev-database`, concurrency group `db-migration-electrohub-dev` (never cancels a running migration). Requires `approved_commit` (must equal the run's commit; checkout pinned to it), `approved_migrations` and `authorization_reference`. Read-only pre-check before the deploy and post-check after it. The old "Safe Diagnostics" step (which printed URL length and hostname) is removed. |
| `.github/workflows/verify-migration.yml` | No shared-database secret. Replays the whole migration history on a fresh disposable PostgreSQL; also runs on pull requests that touch `apps/backend/prisma/**` (safe, nothing shared is reachable). |
| `.github/actions/disposable-postgres/action.yml` (new) | Loopback-only container, per-run random password (masked) and per-run CA. Exports `DATABASE_URL`, `DIRECT_URL`, `DB_SSL_CA_CERT_PATH` (the backend runtime requires verified TLS). |
| `.github/scripts/migration-plan.cjs` (new) | `pre`/`post` guard: target URLs must be the approved DEV project and never production; no failed/rolled-back/unfinished ledger row; applied migrations byte-identical to the checkout; pending set equals the approved list exactly and in order. Read-only transaction; never prints URLs. |
| `.github/scripts/check-workflow-policy.cjs` (new) | Static policy run by the `workflow-policy` CI job: only `dev-migration.yml` may read shared-database secrets or run `migrate deploy` with them; it must be manual-only, environment-gated, non-cancelling, with pre-check before deploy and post-check after; no `pull_request_target`; no `resolve`/`reset`/`dev`/`db push` anywhere outside the disposable `migrate deploy`. |
| `.github/scripts/ci-safety.test.cjs` (new) | 11 offline tests for both scripts (including fixtures of the original unsafe workflows). |

### Required GitHub-side administration (cannot be done from the repository)

These are outside what a code change can enforce. **Until they are done, the policy job is the only guard against a later workflow edit regaining DEV access.**

1. Create the Environment `electrohub-dev-database` with required reviewers (DATABASE owner + Architect), "prevent self-review", and a deployment-branch rule limited to the approved release branches.
2. Define `ELECTROHUB_DEV_DATABASE_URL` and `ELECTROHUB_DEV_DIRECT_URL` as secrets **of that Environment**, then **delete the repository-level copies**. While repository-level copies exist, any workflow in the repository can read them.
3. Make the check `Workflow / Migration Safety Policy` and `Backend / Test` required in branch protection for `develop` and `main`.
4. Require code-owner review for `.github/**` (there is no CODEOWNERS file today).
5. A separate gated workflow and Environment must be created for PROD before any PROD migration; none exists and none was added.

### Not verified here

- The workflows have **not run** on GitHub (no remote CI was triggered). Only static validation was done locally: YAML parse of all workflows and the action, the policy script (clean on the new files, 9 violations on the originals), and 11 offline tests.
- First run of `backend-test` on an empty disposable database may expose tests that implicitly relied on rows already present in shared DEV. The tests inspected create their own marker-named fixtures, and the seed script refuses non-DEV targets by design (not weakened), so any such test needs a fixture fix, not DEV access.
- `docker run` + `sudo chown` on `ubuntu-latest` and the TLS handshake of the self-signed CA are untested until a runner executes them.
