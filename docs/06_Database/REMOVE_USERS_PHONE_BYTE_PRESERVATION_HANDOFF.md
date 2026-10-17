# Controlled historical migration byte preservation

Date: 2026-10-14. Scope: the approved exact-path `.gitattributes` edit for `20260925020000_remove_users_phone` only. Reconciliation approval is an Architect decision; this report assigns no score or release approval.

## Owner authorization and actual edit

The human owner explicitly approved adding:

```gitattributes
apps/backend/prisma/migrations/20260925020000_remove_users_phone/migration.sql -text
```

The approval required preserving existing rules and migration bytes, with no staging, commits, database access or migration execution. The line was appended after both existing forward-commerce LF rules. A prefix hash comparison proves all pre-existing `.gitattributes` bytes were retained exactly. No broad rule was introduced. Effective attribute inspection confirms no higher-precedence rule overrides the target's `text: unset`; `eol`, `filter` and `working-tree-encoding` are unspecified for it.

## Verified byte identities

| View | Bytes | SHA-256 |
| --- | ---: | --- |
| Existing working file, unchanged | 353 | `15de2423e054cfc803989515209340260b5786ce9a4b3b3879b05ede5b81334f` |
| Current index and HEAD, unchanged | 352 | `227201e489fb0d6a4734037e10e0604a3d04505d400d5f47d59d168c2b5ef6e5` |

The working file has six LF endings and one final CRLF, with no BOM. No write, normalization or touch operation was performed on it. Both `git hash-object --path=<target> <target>` (clean-filtered) and `git hash-object --no-filters <target>` return `6f1031a98bf916520155b048e883614130a6544f`. Independently hashing `blob 353\0` plus the raw buffer produces that same Git object ID. The clean-converted view therefore preserves the intended raw buffer. None of these commands used `-w` or created a Git object.

Index/HEAD remain blob `ac0546fc23b9d7cda493016121e6ad2e4ce6248b`; no staged paths were present before or after. The physical index file SHA-256 was identical before/after the attributes edit and verification. Read-only Git verification disabled optional locks to avoid index refresh writes.

Git status currently reports only `.gitattributes` modified for these two paths. The migration's status does not substitute for the direct byte evidence: raw working bytes differ from index bytes, and current attributes preserve the raw bytes. No attempt was made to alter file timestamps, normalize it or force status changes. Future integration must inspect the staged blob explicitly.

## Preservation and guard evidence

All **17 migration SQL files** had identical raw SHA-256 and sizes before/after. This includes the four previously DEV-applied untracked files, the CRLF payment-ownership migration and pending AUTH file. The existing strict guard `.github/scripts/migration-plan.cjs` retained SHA-256 `2e13bc3793f312d6ee918e6ff89018441668ec722015e4e7717032a8d97c35c1`. Existing attributes content and unrelated source were not overwritten. Only the approved line and this task's new documentation/evidence were written.

The earlier offline guard evidence is reused: a complete 17-file in-memory candidate with this deployed-format source matches the captured 16-row DEV ledger and leaves AUTH as the only pending migration. No guard code, checksum exception, workflow or migration was changed here; no database-connected guard entry point or Prisma command was invoked.

Verification used exact Buffer SHA-256, migration-wide before/after byte inventory, effective/cached `git check-attr`, `git hash-object` without writes, `git show` for index/HEAD, `git ls-files`, and `git diff/status` with optional locks disabled. The verification shell commands exited 0. One orchestration attempt referenced an unavailable JavaScript Buffer helper after the successful shell snapshot; the stored snapshot was checked on the next call. No filesystem or Git mutation resulted from that orchestration error. Documentation JSON and whitespace checks were performed separately.

## Future source integration — requires separate authorization

The following are **instructions only**. None of these staging/commit/release steps was executed.

1. Obtain separate owner authorization identifying the exact staging/commit scope and eventual release candidate. Coordinate with the `.gitattributes` owner: that file also contains pre-existing workstream changes. Do not stage its entire working diff unless those owners approve all included hunks. The newly appended rule alone must be included, with effective `-text` in the staged/release attributes.
2. Reconfirm the current target buffer is exactly 353 bytes, six LF plus final CRLF, no BOM, and SHA-256 `15de2423...b81334f`. Do not rewrite it. Verify staged attributes will not impose an EOL/filter/encoding conversion.
3. After staging is independently authorized, use a path-scoped add/reapplication of attributes for this target only. A targeted `git add --renormalize -- apps/backend/prisma/migrations/20260925020000_remove_users_phone/migration.sql` can force reevaluation under the approved `-text` rule if cached status does not notice the byte difference. Despite that option's name, `-text` must prevent conversion; it must not rewrite the working file. Do not use a repository-wide renormalization or mass-stage historical Windows copies. This command is not authorized now.
4. Read the staged migration buffer using a binary-safe `git show :apps/backend/prisma/migrations/20260925020000_remove_users_phone/migration.sql`. Compute SHA-256 over that returned buffer; require exactly 353 bytes and the required hash. Expect Git blob `6f1031a98bf916520155b048e883614130a6544f`. Inspect staged `.gitattributes`, the complete staged path list and its effective attribute. Stop if any unapproved hunk or other migration's bytes changed. Do not use shell text redirection to construct the buffer.
5. Only after separate commit authorization, verify `git show <approved-release-commit>:<target>` returns the same exact 353 bytes/hash and that the release commit contains the scoped attributes rule. A fresh checkout on the actual release platform must reproduce those exact bytes. A source-preservation commit is not permission to push, deploy or run a database migration.
6. Preserve the complete expected 17-migration inventory: captured DEV has 16 completed, AUTH remains pending, four already-applied untracked SQL files require byte-exact inclusion, and the CRLF payment migration must not be normalized. Preserve other historical canonical bytes rather than mass-staging checkout transforms. Use the unchanged pure guard functions with the captured DEV ledger to verify the candidate has no checksum mismatch and only AUTH pending. Any live ledger pre-check or migration execution requires its own environment-specific approval.

No database ledger edit, historical SQL rewrite or guard exception is part of this plan. If staged/release/fresh-checkout hashes fail, stop and fix the source-preservation process within its approved scope; do not normalize the file to match HEAD or weaken the guard.

## Remaining release boundaries

- The mechanism is prepared and verified locally; index/HEAD and any remote release remain unchanged.
- Separate staging and commit authorizations are missing. Existing concurrent attributes work must be released by its owner before inclusion.
- PROD checksum for this migration remains **UNKNOWN**. A separately authorized read-only PROD history reconciliation is required before a PROD release decision; DEV matching does not establish PROD compatibility. Historical foundation BOM/CRLF and OTP CRLF exceptions remain independent. No new PROD allowance is authorized.
- Task 03.6 formal closure and the release safeguards still control the project-wide **NO PUSH** decision. No staging, commit, push, CI execution, database operation, Stripe operation, business change or deployment occurred here.

Artifacts: this handoff and `REMOVE_USERS_PHONE_BYTE_PRESERVATION_EVIDENCE.json`. The earlier reconciliation remains historical evidence of the pre-rule state.
