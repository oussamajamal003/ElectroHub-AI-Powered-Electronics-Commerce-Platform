# Historical remove_users_phone checksum reconciliation

Date: 2026-10-14. Scope: `apps/backend/prisma/migrations/20260925020000_remove_users_phone/migration.sql` only. Branch `feature/Stripe`, HEAD `3d69b97fbea4dbcb536ca1a7ed7bcd7dfa54ace4`.

**Finding: the discrepancy is one carriage-return byte on the final line, not a SQL change.** The current index and every available historical version use LF throughout; the working copy matching the captured DEV checksum uses six LF line endings and one final CRLF. This is a separate release-source preservation blocker. Logging is approved under the Architect's decision and is not reopened. No database access or migration execution was performed here.

## Exact byte identities

Hashes below are SHA-256 over original buffers, before any transformation. The DEV value is reused from `LOGGING_DATABASE_INCIDENT_READ_ONLY_EVIDENCE.json`; it was not queried again.

| Source | Bytes / line endings | SHA-256 |
| --- | --- | --- |
| Captured DEV ledger | File bytes not stored in ledger; current working buffer matches checksum | `15de2423e054cfc803989515209340260b5786ce9a4b3b3879b05ede5b81334f` |
| Current working copy | 353; six LF + one CRLF; no BOM | `15de2423e054cfc803989515209340260b5786ce9a4b3b3879b05ede5b81334f` |
| Git index, stage 0 | 352; seven LF; no BOM | `227201e489fb0d6a4734037e10e0604a3d04505d400d5f47d59d168c2b5ef6e5` |
| HEAD committed blob | Same 352 bytes as index | `227201e489fb0d6a4734037e10e0604a3d04505d400d5f47d59d168c2b5ef6e5` |
| Introducing commit `a83a294b36ebf1aede0bcf8eea9b35ad681fb634` | Same 352 LF bytes | `227201e489fb0d6a4734037e10e0604a3d04505d400d5f47d59d168c2b5ef6e5` |

The first **351 bytes are identical**. At zero-based offset 351, the working copy inserts `0D` before the final `0A` (line 7). HEAD ends `3B 0A`; working copy ends `3B 0D 0A`. In-memory insertion of exactly that byte into HEAD reproduces the working buffer and the DEV checksum. This is authoritative byte comparison followed by a diagnostic reconstruction; no file was normalized or edited.

Earlier all-LF/all-CRLF/BOM trials failed because they did not test this mixed-ending layout. Their negative results were accurate for the uniform variants tested; they did not establish a content difference.

## Git history and origin

Index/HEAD Git blob: `ac0546fc23b9d7cda493016121e6ad2e4ce6248b`. Raw working-buffer Git object hash: `6f1031a98bf916520155b048e883614130a6544f`. `git hash-object --path=<target> <target>` applies the current clean conversion and returns the index/HEAD object, without writing an object or staging. `git ls-files --eol` reports `i/lf w/mixed`; target-specific working and cached attributes are absent, and `core.autocrlf=true`. The migration appears clean in ordinary Git status because its clean-filtered bytes equal the index.

`git log --all --follow` and `git rev-list --all -- <target>` identify one path-changing commit: `a83a294...`. Its parent has no entry for the path. That introducing commit is dated 2026-09-26T17:54:37Z; the captured DEV ledger completion is 2026-09-26T10:37:39.8617Z. The timing establishes order in these records, not how the author generated or staged the file. All locally available path history has the LF blob; no later committed SQL edit or later committed byte change was found. A local repository is not an exhaustive record of discarded/unavailable history.

**Verified mechanism:** the current Git clean conversion strips the sole final CR and reproduces the exact committed blob. The release Git source therefore does not retain the checksum-matching deployed format. **Unknown origin details:** the original editor/action that created mixed line endings, the exact configuration used during the September commit, and the commands underlying the prior verification report. A Git normalization/source-preservation explanation is supported; a specific person's post-application edit is not established.

## SQL semantics

Both versions contain identical comments and this one statement:

```sql
ALTER TABLE "users" DROP COLUMN IF EXISTS "phone";
```

No statements, constraint clauses or index definitions were added, removed or changed. Given the same initial schema, both have the same schema outcome (or the same dependency-related failure). No execution was used to verify that inference. Historical comments asserting zero non-null phone values are not new database verification.

The difference is nevertheless material to migration integrity: the two byte sequences have different recorded SHA-256 values. The current working copy is verified as the DEV-checksum-matching source artifact; formal approval to publish that exact artifact in the release is still an owner decision. Matching DEV is not proof of the current PROD checksum or blanket approval of release history changes.

## Correction to earlier evidence

The recorded AUTH reconciliation described **eight working-copy matches plus eight committed-LF matches**. Reproducing that source selection is consistent with the captured DEV ledger, including the mixed-ending phone file. It does not support the later statement that all 12 tracked historical committed blobs match.

The corrected result is **11 of 12 tracked historical HEAD blobs match captured DEV; remove_users_phone matches only the current raw working bytes**. The four later applied/untracked files retain their captured matching checksums. No captured DEV checksum is shown to be incorrectly recorded. The original verification commands cannot be reconstructed from the inspected reports, so an assertion about precisely what the earlier executor ran would be speculative. The available Git history does not support a committed-blob change after that verification.

Dated corrections were appended to `AUTH_MIGRATION_RELEASE_PLAN.md`, `PRE_PUSH_INTEGRATION_READINESS.md` and `CI_MIGRATION_SAFETY_ADMIN_CHECKLIST.md`; their original findings remain readable as historical reports. Incident/logging reports were not rewritten. The current Architect decision closes logging and keeps this release blocker separate.

## Replay and deployment impact

**Disposable 17-migration replay:** this one-byte difference does not change SQL semantics. Either format would record its own checksum on a fresh database. A successful fresh replay would not reconcile that fresh ledger with the pre-existing DEV ledger. No replay, Prisma command or CI job was executed here. The working tree has 17 migration files; HEAD alone contains only the historical 12, so a future candidate must include the five owner-approved untracked files as well.

**DEV deployment:** the strict `.github/scripts/migration-plan.cjs` correctly fails when the phone file is the committed LF buffer. An offline candidate assembled in memory from 12 HEAD hashes plus the five existing untracked migration hashes reproduced exactly one checksum failure. Substituting only the phone file's deployed-format hash in memory removed that failure and left `20261013000000_refresh_token_rotation_lineage` as the sole pending migration. This verifies the guard calculation against captured evidence, not current database state or authorization to deploy. The hypothetical candidate assumes the four previously applied untracked files are included with their exact bytes.

**Future PROD deployment:** PROD was not accessed or reconciled. Its phone migration checksum is UNKNOWN. The historical foundation BOM+CRLF and OTP CRLF exceptions remain separately documented; they must not be expanded to cover this migration without exact PROD evidence and explicit owner approval. The DEV-only guard cannot be reused as PROD authorization. No prediction of a successful PROD migration run is made.

## Smallest proposed release correction — not executed

Preferred approach: preserve the already-deployed bytes in release source rather than weakening the strict guard.

1. DATABASE owner and Principal Architect approve publishing the existing **353-byte**, DEV-matching source artifact, explicitly acknowledging the final-line-only CRLF difference. This task authorizes no migration-file edit, staging or commit.
2. The Git attributes owner approves disabling text conversion for this exact path, for example:

   ```gitattributes
   apps/backend/prisma/migrations/20260925020000_remove_users_phone/migration.sql -text
   ```

   This can be covered by the separately proposed migration-wide `-text` rule, but attributes alone do not rewrite the existing 352-byte index/HEAD blob. The future approved release must actually contain the 353-byte blob. Do not mass-stage Windows historical files: eight other current working copies have checkout CRLF differences, and their known-correct committed LF blobs must remain unchanged.
3. Under separate source-integration authorization, the integrator records that existing exact buffer in the future release, alongside the approved attributes. Verify the released Git object has SHA-256 `15de2423...b81334f`, 353 bytes, six LF endings and one final CRLF; verify checkout on the release platform preserves those bytes. No SQL statement or database ledger correction is needed for this proposed DEV source-preservation fix.
4. Keep all 17 approved migration identities: captured DEV has 16 completed and AUTH pending. Preserve byte-exact inclusion of the four already-applied untracked files and the AUTH migration. The CRLF `payment_purchase_ownership` file must not be normalized. Record the exact pending AUTH checksum and all release hashes before any separately authorized deployment.
5. Before a PROD decision, obtain separate owner-authorized PROD ledger evidence. If environments differ, the owners must choose an explicit environment-scoped historical policy based on exact observed checksums; do not invent a normalization allowance or silently accept multiple hashes.

**CI guard change:** none is needed for the preferred DEV correction; the current guard's rejection is the intended safety behavior. No `.github` source, workflow or `.gitattributes` edit was made here. No checksum exception was added. Retaining the 352-byte source while accepting the different DEV hash would instead require a separately approved exact environment-scoped exception and new guard verification; it is not the proposed default and was not implemented.

Do not update `_prisma_migrations`, resolve/replay this migration, run `db push`/reset, or use a new migration to try to change the old checksum. Those actions do not preserve the historical byte identity and are unauthorized.

## Verification and handoff

Offline reads used `git show HEAD:<target>`, `git show :<target>`, `git show a83a294...:<target>`, `git ls-files --stage/--eol`, `git check-attr` (working/cached), `git config --show-origin --get core.autocrlf`, `git hash-object` with/without clean conversion (no `-w`), `git log --all --follow`, `git rev-list --all -- <target>` and exact Buffer SHA-256. Guard functions were required as a library; the database-connected CLI entry point was never invoked.

Eight offline assertions passed, exit 0: exact working hash, exact HEAD hash, index=HEAD, sole-byte reconstruction, 17-file inventory, expected guard failure, hypothetical zero guard failures, and exact pending AUTH set. These are local assertions, not a database or CI test. No broad suite, migration replay, typecheck/build or accepted logging tests were repeated.

**Readiness recommendation:** the contradiction is explained and prior evidence corrected; release migration integrity remains **not ready** until owners authorize and verify the exact deployed-byte source preservation. No Architect score or self-approval is assigned. AUTH, Task 03.6, relationJoins and CI source approvals remain unchanged; all environment execution approvals remain separate. **NO PUSH until Task 03.6 formally closes and release safeguards are satisfied.**

Owned changes: this handoff, its JSON evidence, and dated checksum-only corrections in the three database release documents. Historical migration SQL, index/HEAD, attributes, CI source and unrelated application files remain untouched.
