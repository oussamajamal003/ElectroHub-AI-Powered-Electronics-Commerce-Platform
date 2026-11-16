# Logging database incident — authorized read-only handoff

Date: 2026-10-14. Incident window: **2026-10-13T12:31:00Z–12:39:00Z**.

**Incident classification: INDETERMINATE for historical impact. No identifiable synthetic fixture residue was found in the current authorized DEV snapshot.** A contradiction in the earlier migration checksum evidence requires owner reconciliation; database reads stopped without repair or a broader investigation. No Architect score or verdict is assigned here.

## Authorization and verified access

The owner explicitly authorized this exact investigation in the current chat: shared DEV `electrohub-dev`, project `pzxekjybdiulzmssalfo`, ap-northeast-2, database `postgres`, schema `public`; identity, catalogs, bounded synthetic fixture counts, related metadata, migration ledger and narrowly scoped audit metadata only. Recovery/mutations and PROD access remain unauthorized.

Before SQL, the DEV connector API URL was `https://pzxekjybdiulzmssalfo.supabase.co`; independently fetched project metadata confirmed the same reference, name and region. SQL confirmed database `postgres`, effective/session role `supabase_read_only_user`, default and active `transaction_read_only=on`, and non-superuser status. The optional database `supabase.project_ref` setting was null, so project identity rests on the connector URL and independent project metadata, not that setting.

Relevant tables had SELECT permission. The role bypasses RLS, and `row_security_active` was false on the inspected tables, including OAuth/security events; zero counts are not explained by row filtering. Every SQL batch explicitly began READ ONLY, used a five-second statement timeout, and ended with ROLLBACK. No read/write transaction was enabled. No credentials, connection strings, token/OTP/password values or hashes, cookies, customer payloads or raw migration error logs were retrieved.

## Queries and current fixture counts

Seven PostgreSQL tool calls were made: identity; an initial catalog query with a UNION ORDER BY syntax error; its corrected catalog query; a four-SELECT counts/roles/ledger batch whose tool response exposed only the final ledger summary; separate single-result counts and ledger reads; and validated foreign keys. Six calls succeeded. The syntax error was corrected without mutation. The repeated counts/ledger reads obtained missing result sets rather than replaying tests. Three read-only audit queries obtained the incident-window source count, metadata key names and aggregate severity/SQLSTATE/command tags. Two management metadata calls verified project identity.

The counts used exact UUID-shaped synthetic email and Google-subject patterns from the test. Users matched email or pendingEmail; Google identities matched provider and subject. Each namespace selection was capped at 1,001 candidates, with cap detection; neither cap was reached. No actual candidate identifiers were returned. Creation timestamps separated before/within/after-window artifacts. Linked reads used only incident candidate user IDs; no general session/customer count was performed.

Observed count snapshot: **2026-10-14T14:51:42.486522Z**.

| Object class / scope | Count |
| --- | ---: |
| Synthetic users before / within / after window | 0 / 0 / 0 |
| Synthetic Google OAuth accounts before / within / after window | 0 / 0 / 0 |
| Incident-linked candidate user IDs | 0 |
| Related OAuth accounts | 0 |
| Related refresh tokens, revoked tokens, unrevoked/unexpired tokens | 0 / 0 / 0 |
| Related security events | 0 |
| Related OTP challenges | 0 |
| Related password reset tokens | 0 |
| Related carts / wishlists | 0 / 0 |
| Related email deliveries | 0 |
| Detached synthetic-recipient email deliveries created in window | 0 |
| Detached GOOGLE_CONNECTED security events created in window | 0 |

Confidence is high for absence of matching current records in these inspected namespaces. Related counts are joins to an empty candidate set; they do not prove every historically detached record was identified. Detached LOGIN_SUCCESS/LOGOUT or arbitrary null-user events cannot be safely attributed without the lost marker and were not broadly scanned. No incident fixture UUID was recovered. Do not interpret these counts as a historical transaction audit or proof that cleanup ran exactly as intended.

## Actual cleanup constraints and shared roles

All eight inspected user foreign keys are validated. Actual DEV behavior agrees with the fixture-cleanup assumptions:

- ON DELETE CASCADE: OAuth accounts, refresh tokens, OTP challenges, password reset tokens, carts and wishlists.
- ON DELETE SET NULL: security events and email deliveries.

The test deletes security events first, then users by the four exact emails, using separate operations. Cascades explain removal of linked rows when user deletion succeeds; SET NULL explains why detached metadata requires separate attribution. Current constraints do not prove the historical cleanup order or affected-row counts.

`CUSTOMER` was created/last updated 2026-09-24T13:38:11.300; `ADMIN` 2026-09-24T17:24:12.350. Both predate the incident. Current role metadata provides no evidence of incident-time role creation or update. Google creation's conditional CUSTOMER upsert remains a known source path, but it was not executed in this investigation.

## Migration ledger and evidence contradiction

The actual ledger has **16 completed rows, zero incomplete rows, zero rolled-back rows, and zero started/finished/rollback timestamps in the incident window**. AUTH migration `20261013000000_refresh_token_rotation_lineage` is absent, matching the approved pending status; it was not applied, resolved or otherwise touched.

Names/count/status and the four later migration checksum prefixes agree with the previously approved DEV evidence in `docs/06_Database/AUTH_MIGRATION_RELEASE_PLAN.md` and `PRE_PUSH_INTEGRATION_READINESS.md`. A local byte comparison found 15 matches using the documented comparison method: historical committed blobs and four existing untracked working-copy files. One exception conflicts with the previous statement that all 12 historical committed blobs match:

| `20260925020000_remove_users_phone` | SHA-256 |
| --- | --- |
| Actual DEV ledger and existing working copy | `15de2423e054cfc803989515209340260b5786ce9a4b3b3879b05ede5b81334f` |
| Current HEAD committed blob | `227201e489fb0d6a4734037e10e0604a3d04505d400d5f47d59d168c2b5ef6e5` |

Simple LF/CRLF/BOM variants of the committed text did not reproduce the ledger checksum. No file was normalized or modified. The ledger row started/completed on **2026-09-26T10:37:39.8617Z**, well before the logging incident. Therefore the discrepancy is **not established as incident-caused**, and it is not evidence that this investigation changed the database. The inspected prior documents do not expose that row's full prior checksum, so they cannot independently establish when/why the difference arose. This is an evidence-reconciliation boundary, not a reopened AUTH/CI source review or authorization to repair migrations.

## Bounded audit metadata and existing-data effects

The DEV audit stream retained five PostgreSQL entries in the exact incident window:

| Metadata command class | Count | UTC range |
| --- | ---: | --- |
| INSERT waiting, LOG / SQLSTATE 00000 | 2 | 12:33:27.370–12:33:36.791 |
| INSERT, LOG / SQLSTATE 00000 | 1 | 12:33:36.794 |
| No command tag, LOG / SQLSTATE 00000 | 2 | 12:35:38.192–12:35:40.740 |

No raw SQL, connection addresses, customer details or message bodies were returned. This is sparse metadata, not complete statement/row auditing. It neither identifies fixture rows nor proves all transactions rolled back. Combined with the preserved four local commit/two delete events, it supports historical activity but cannot establish every durable row effect or later owner cleanup.

No concrete existing-data impact was identified by these narrowly scoped reads. It is UNKNOWN whether any temporarily committed data was subsequently removed, or whether indistinguishable detached events remain. The historical effective database target is still configuration-based: the present connector confirms this DEV project, but there is no captured historical inherited-environment/connection identity or preincident row snapshot. Those limits prevent an absolute historical absence claim.

## Recovery, preserved acceptance and closure boundary

No attributable current residue was identified, so no cleanup proposal or recovery operation is warranted from this evidence. No recovery authorization exists. If a later owner audit identifies confirmed residue, a separate owner-reviewed plan must identify markers, object classes/counts, dependency order and backup/restore needs before any mutation, followed by independent read-only verification.

The accepted logging source was not edited. All 18 reviewed source fingerprints still match the established evidence. The 174 prior tests, 29 focused tests, six selector-guard tests and successful typecheck/lint/build were reused; no suite was rerun. No AUTH/Task 03.6/relationJoins/CI source review was reopened. No application/worker, Stripe/payment operation, PROD access, migration, staging, commit, push or deployment occurred.

New incident-review artifacts only: this handoff and `LOGGING_DATABASE_INCIDENT_READ_ONLY_EVIDENCE.json`, plus a dated pointer in the earlier handoff. The earlier reports/evidence remain historical snapshots. The machine-readable artifact records exact successful SQL, aggregate results, all ledger checksums/timestamps, access metadata and the stop reason.

**Smallest next owner action:** provide the previously approved full DEV checksum readback for `20260925020000_remove_users_phone`, or have the Database/CI evidence owner reconcile the documented committed-byte claim with the observed ledger/working-copy match. No further database access or repair is implied. The Principal Architect can then decide whether the scoped no-residue evidence and stated historical limits are sufficient for logging incident closure. Until that reconciliation, the overall incident remains INDETERMINATE; current absence of identifiable residue is verified within scope.

The project-wide **NO PUSH UNTIL TASK 03.6 IS FORMALLY CLOSED AND RELEASE SAFEGUARDS ARE SATISFIED** remains unchanged.
