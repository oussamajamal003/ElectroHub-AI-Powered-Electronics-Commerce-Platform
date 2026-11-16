# Pre-Push Integration Readiness (2026-10-14)

**Dated checksum correction (2026-10-14):** the original claim below that all 12 historical committed blobs match DEV is false for `remove_users_phone`. See the appended correction and [focused reconciliation](REMOVE_USERS_PHONE_CHECKSUM_RECONCILIATION.md). Original statements remain visible as historical evidence; no source approval or push authorization is changed.

**Standing owner decision: NO commit, push, merge or remote workflow execution until Task 03.6 is formally closed and the applicable release authorizations are granted.** This document prepares and transfers; it authorizes nothing. Each of these is a separate authorization and none implies another: CI administrator changes; Task 03.6 closure; a safe integration push; DEV migration; PROD read-only; PROD migration.

Recorded architect decisions: AUTH source 93/100 approved; DEV read-only reconciliation 96/100 approved; CI local preparation 94/100 approved. Not reopened. Task 03.6 files and evidence were not touched.

## Status table

| # | Item | Status | Detail / owner action |
|---|---|---|---|
| 1 | Local tree | **COMPLETE** (observed) | HEAD `3d69b97` on `feature/Stripe`; 0 staged; ~282 working-tree entries. Largest areas: backend src, frontend src, backend scripts (payment/checkout, other workstreams), docs. Nothing staged or committed by this workstream. |
| 2 | AUTH + CI + database docs (this workstream) | **COMPLETE** | AUTH source files and review patch; `.github/{workflows,actions,scripts}` and CI patch; `docs/06_Database/{REFRESH_TOKEN_LINEAGE,REFRESH_TOKEN_MIGRATION_CI_HANDOFF,AUTH_MIGRATION_RELEASE_PLAN,CI_MIGRATION_SAFETY_ADMIN_CHECKLIST,PRE_PUSH_INTEGRATION_READINESS}.md`. |
| 3 | Task 03.6 dependency | **PENDING OWNER (Principal Architect)** | Its payment/checkout files (scripts, `PAYMENTS.md`, payment migrations, frontend) are present and untouched here. Four of its migrations are untracked and already in DEV. No push may carry them until the Architect closes 03.6. |
| 4 | Migration inventory | **COMPLETE** as inventory; inclusion **PENDING OWNER** | Table below. |
| 5 | Account-deletion fixture | **PENDING OWNER** | Task `task_199c5a4e` was raised but not started: `familyId` count in the file is 0; `isTestFixture: true` is present and untouched. Required: add `familyId: crypto.randomUUID()` in place, run only the affected test against an isolated disposable PostgreSQL with all 17 migrations, report the result. This workstream does not edit the file. |
| 6 | `.gitattributes` | **PENDING OWNER** | Current file pins only `checkout_core` and `stripe_orchestration` to `eol=lf`. **Correction of an earlier suggestion:** do not pin to `eol=lf`. See "Line endings". Exact rule below. |
| 7 | GitHub administrator readiness | **BLOCKED BY AUTHORIZATION** | Nothing changed. Concise steps below; full detail in `CI_MIGRATION_SAFETY_ADMIN_CHECKLIST.md`. |
| 8 | Disposable CI acceptance run | **BLOCKED BY AUTHORIZATION** | Not run (no Actions authorization; no local Docker). Definition below. |
| 9 | Migrations | **BLOCKED BY AUTHORIZATION** | AUTH migration unapplied and unauthorized; no `_prisma_migrations` edit; no `migrate deploy/resolve` or `db push`; Supabase MCP used earlier for read-only `SELECT`s only and not used now. |

## Migration inventory and checksums

DEV ledger checksums were observed read-only on 2026-10-14 (PROD not read). Local values recomputed now from the working copy bytes.

| Migration | In DEV ledger | Git | Working-copy SHA-256 (12) | Ledger (12) | Bytes |
|---|---|---|---|---|---|
| `20261007000000_stripe_orchestration` | yes | untracked | `8efc55f8e823` | `8efc55f8e823` | LF (pinned `eol=lf`) |
| `20261009000000_product_test_fixture_visibility` | yes | untracked | `007b9167866b` | `007b9167866b` | LF |
| `20261012000000_storefront_product_visibility` | yes | untracked | `21ae532f49eb` | `21ae532f49eb` | LF |
| `20261012120000_payment_purchase_ownership` | yes | untracked | `0cf4bc6b88a2` | `0cf4bc6b88a2` | **CRLF (10 CR bytes)**; LF-normalized would be `a45372e2e258` |
| `20261013000000_refresh_token_rotation_lineage` (AUTH) | **no (unapplied)** | untracked | `51495598e0e1…2e991` (full: `51495598e0e1a7e8d74b2d19f8e596fcae32a0e1afb2e626120fad7c06b2e991`) | n/a | LF, 0 CR bytes |

All four applied migrations match the ledger; none was modified. The 12 tracked historical migrations match the ledger from their committed LF blobs (checked earlier). Their source files must be part of the future integration patch, unchanged: **PENDING OWNER** (Task 03.6 / storefront owners; nothing is staged).

## Line endings: exact `.gitattributes` instruction

Proven in a throwaway repository (not the project repo) with `core.autocrlf=true`: with no rule or with `eol=lf`, `payment_purchase_ownership` is stored as `a45372e2e258` (does not match DEV, so `migration-plan.cjs pre` would block and Prisma would see an edited migration); with `-text` it stays `0cf4bc6b88a2`; the AUTH migration is `51495598e0e1` under every rule.

Add one line (owner of `.gitattributes`), placed before the two existing `eol=lf` lines:

```
apps/backend/prisma/migrations/*/migration.sql -text
```

`-text` stores and checks out bytes exactly as committed on every OS, so every migration keeps its applied checksum. It does not rewrite any existing blob.

## GitHub administrator hand-off (concise; no secret values)

1. Create Environment `electrohub-dev-database`; required reviewers DATABASE owner + Principal Architect; prevent self-review; deployment branches limited to approved release branches.
2. Add `ELECTROHUB_DEV_DATABASE_URL` / `ELECTROHUB_DEV_DIRECT_URL` as secrets of that Environment (direct/session connection, not `pgbouncer`).
3. Delete the repository-level (and any shared organization-level) copies; confirm with `gh api repos/{owner}/{repo}/actions/secrets --jq '.secrets[].name'` that no `ELECTROHUB_DEV_*` name is listed.
4. CODEOWNERS for `.github/**` and `apps/backend/prisma/**` with required code-owner review.
5. Branch protection on `develop`/`main`: require `Workflow / Migration Safety Policy` and `Backend / Test`.
6. Confirm only `dev-migration.yml` names the Environment, it is `workflow_dispatch`-only, and it cannot run without reviewer approval (the policy job enforces the file side; Environment reviewers enforce the approval side).

## Future disposable CI acceptance check (single check; disposable resources only)

On the first authorized push or manual dispatch of `verify-migration.yml` (never `dev-migration.yml`): PostgreSQL 17 container starts and answers `pg_isready`; TLS verification succeeds against the per-run CA (a certificate error fails the run); `prisma generate` and `validate` exit 0; `migrate deploy` replays all 17 migrations on the disposable database and `migrate status` is up to date; the backend tests execute with no shared-DEV host in any step; the container and per-run password/CA are discarded with the runner. If it fails, fix the demonstrated CI defect; never substitute shared DEV. Tests that assumed rows from shared DEV are fixture fixes, not DEV access.

## Prerequisites before any future push (all must hold)

1. Task 03.6 formally closed by the Principal Architect.
2. Safe-integration-push authorization from the owner.
3. GitHub administrator steps 1-6 complete.
4. `.gitattributes` rule applied; the four applied migrations plus the AUTH migration present with the checksums above.
5. Fixture task done and verified on a disposable database.
6. No staged or committed content from other workstreams unless their owners release it.

## Smallest next owner action

The Principal Architect decides Task 03.6 closure. In parallel and independent of it, the `.gitattributes` owner can apply the one-line `-text` rule, and the owner who starts `task_199c5a4e` can make the one-line fixture change on an isolated database.

## Dated checksum correction — 2026-10-14 (offline evidence only)

Replace the earlier **conclusion**, not the historical record, with: **11 of 12 tracked historical HEAD blobs match the captured DEV ledger.** `20260925020000_remove_users_phone` is the exception: DEV and the raw working copy match SHA-256 `15de2423e054cfc803989515209340260b5786ce9a4b3b3879b05ede5b81334f` (353 bytes; only the final line is CRLF), while index/HEAD match `227201e489fb0d6a4734037e10e0604a3d04505d400d5f47d59d168c2b5ef6e5` (352 bytes; LF throughout). The SQL and comments are identical. Current Git clean conversion explains why ordinary status shows this migration as unchanged.

The prior AUTH reconciliation used eight raw working-copy hashes and eight committed-LF hashes; it did not support the universal all-HEAD claim. The four already-applied untracked migration checksum claims remain unchanged. A migration-wide `-text` rule preserves chosen bytes but does not replace the existing 352-byte phone blob; publishing the existing DEV-matching 353-byte buffer requires a separate owner-approved source-preservation decision. Do not mass-stage other historical Windows CRLF working copies or normalize the CRLF payment migration. The strict DEV guard needs no relaxation.

This separate release blocker remains pending DATABASE/Architect/attributes-owner approval and exact release-blob verification. No migration SQL, attributes, CI source, index or database state was changed in this reconciliation. Logging is approved and not reopened. See [the focused handoff](REMOVE_USERS_PHONE_CHECKSUM_RECONCILIATION.md) for the exact byte proof and limits; the project-wide NO PUSH decision remains in force.
