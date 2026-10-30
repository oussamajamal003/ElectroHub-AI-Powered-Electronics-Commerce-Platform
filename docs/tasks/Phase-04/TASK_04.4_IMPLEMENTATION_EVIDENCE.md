# Task 04.4 — Implementation Evidence

Branch `feature/04.4-ml-powered-recommendations` (base `5f7aede`). Nothing committed, pushed, merged or deployed.
Design and behaviour: [`05_Features/RECOMMENDATIONS.md`](../../05_Features/RECOMMENDATIONS.md),
[`07_AI/RECOMMENDER.md`](../../07_AI/RECOMMENDER.md), tables in [`06_Database/TABLES.md`](../../06_Database/TABLES.md).

## Environments

| Environment | What ran | Result |
|---|---|---|
| Disposable QA cluster (`dev-isolated.cjs`, pgvector, D3 vectors) | Migration replay + second no-op run; QA FastAPI (:8200, D3 artifact, read-only vector role); QA Express (:5200); Vite (:3210) | Verified |
| DEV `pzxekjybdiulzmssalfo` | `recommendations-migrate.cjs pre` → `deploy` (Prisma `migrate deploy` + `status`) → post check; read-only verification via Supabase MCP | Applied 2026-10-28 |
| PROD `yepfgjehdstlxbpespun` | Read-only ledger query only | 25 migrations, last `20261028020000_product_media_worker_health`, no recommendation tables. Not applied (release step on a committed SHA through `prod-migration.yml`) |

## DEV migration verification (read-only, after deploy)

- Ledger 26 rows, no pending; post check passed.
- All four tables: RLS enabled, `anon` SELECT false, `authenticated` SELECT/INSERT false.
- CHECK constraints: `product_interactions` 3, `recently_viewed_products` 1, `recommendation_events` 5.
- `ai.active_index.embedding_version` unchanged: `siglip2-b16-p256-d1-b3900dd9fad5`.
- Supabase security advisor: only `rls_enabled_no_policy` (INFO) for the new tables, the same server-only pattern as
  existing tables such as `stripe_events` and `payment_attempts`.

## Real QA stack results

| Check | Result |
|---|---|
| `GET /api/products/tp-link-archer-ax55/recommendations?limit=4` | SIMILAR `EMBEDDING_SIMILARITY`: Archer AX23, AX10, AXE75, AX73; YMAL `HYBRID_EMBEDDING`: Archer C6, Archer T3U, Tapo C320WS, Tapo C310; FBT `NO_DATA` (`INSUFFICIENT_SUPPORT`); ~120–175 ms |
| Popular on QA (no activity) | `FALLBACK_NEW_ARRIVALS` / `NO_MEASURED_DEMAND`; hidden on Home |
| Browser, product detail 1440×900 | Similar + You May Also Like rails, 4 columns of store ProductCards; FBT absent |
| Browser, 390×844 | Single column, no horizontal overflow |
| Impressions | After ≥ 1 s at ≥ 50 % visibility: `POST /api/recommendations/events` → 202; QA rows: 4 IMPRESSION, ranks 1–4, no user column |
| Two-customer API run (task-owned throwaway customers, removed afterwards) | Default consent off; VIEW without consent → 200 `PERSONALIZATION_OFF`, 0 rows; with consent 201 per view; duplicate idempotency key → 200; recently viewed isolated per customer; anonymous `/api/me/recommendations` → 401; `/me` responses `private, no-store`; opt-out deletes A's rows (0/0) and leaves B's (3/3); clear recently viewed → 204 and 0 VIEW rows; cleanup 0 users/interactions/preferences/recently-viewed left |

Defect found by that run and fixed: the profile evidence threshold compared decayed scores, so 3 fresh views
(3 × 0.9999…) never reached weight 3 and personal rails fell back to `INSUFFICIENT_HISTORY`. The threshold now uses
undecayed weight; decay only ranks (unit test added). The run was not repeated after the fix; covered by unit tests only.

## Offline evaluation

See the table in `07_AI/RECOMMENDER.md`. D3 centroid vs category baseline on 206 anchors: NDCG@10 0.982 vs 0.936,
Recall@1 1.000 vs 0.879, coverage@10 1.000 vs 0.612. Popularity baseline not evaluated (no measured demand). Result
file: `apps/ai-service/training/recommendations/results/eval-siglip2-b16-p256-d1-b3900dd9fad5.json`.

**Training GO/NO-GO: NO-GO** (no consented interaction history; 6 co-purchase pairs; no consent basis for export).

## Automated checks (local)

| Area | Command | Result |
|---|---|---|
| AI service | `ruff check .`, `ruff format --check .`, `mypy app tests`, `pytest` | Pass |
| Evaluation | `mypy training/recommendations`, `pytest training/tests/test_recommendation_metrics.py` | Pass (30) |
| Backend | `tsc --noEmit`; vitest for AI integration + recommendation services/routes | Pass (8 files / 190 tests before the threshold fix; recommendation files re-run after it) |
| Backend full suite | `test:ci` set | Not green. Pre-existing failures outside these files: payment-disabled env, DB target required, TLS to live DB |
| Frontend | `typecheck`, `lint`, `vitest run` | typecheck/lint pass. Full suite final run 990/991 (117 files); the one failure (`CheckoutPage.test.tsx`) passes alone (checkout 273/273). Under heavy machine load (QA servers + Playwright running) 13–21 checkout/search/routing tests time out, also with the new tests excluded: load-dependent flakiness, not a regression |
| Storybook | `build-storybook` | Pass |
| Playwright (mocked) | `playwright.recommendations.config.ts` at 390/768/1440/1920 | 28 passed |
| Playwright catalog/wishlist (mocked) | `playwright.catalog.config.ts` | 42 passed / 13 failed. "08 … More in" passes. Failures (out-of-stock copy, rating string, a 100 ms timing budget, auth-bootstrap count, cold first navigation) are outside this task's diff; no HEAD baseline was run, so "pre-existing" is not proven |
| CI policy | `check-workflow-policy.cjs`, `node --test ci-safety.test.cjs` | Pass (21) |

## Not verified

- Figma: no recommendation frames were inspected; rails reuse existing ProductCard and section patterns.
- Visual comparison against Figma/screenshots: NOT VERIFIED (screenshots captured only).
- Real DEV application run (DEV FastAPI + Express + browser): NOT VERIFIED; only the DEV migration was applied.
- Remote GitHub Actions: NOT VERIFIED (nothing pushed).

## Task 04.4 — final architect closure attempt (2026-10-29)

The preceding historical statements about an unpushed branch are superseded: reviewed HEAD is
`8edff82e4c678857b1e84d4e09e1a89df5257b22`, merge base `5f7aede9845ad1f739304ddf40ba71fc537df9ae`.
The corrections below are uncommitted; hosted CI for that HEAD does not cover them.

- **F-01:** A blinded **agent-judged, not human** set was frozen before scoring: 3 anchors, 24 pairs,
  19 products. Its fixed-pool D3 Recall@5 was 1.000 versus 0.933 for category-first; NDCG@5 was 0.979 versus
  0.940. This small convenience sample does not establish general consumer relevance. The manifest, evaluator and
  results are in `apps/ai-service/training/recommendations/judgments/`.
- **F-02:** Recall now uses all relevant items as denominator; 30 metric tests passed. Old published recall values
  are explicitly invalidated. A separate current isolated QA snapshot of 206 products gives taxonomy-derived D3
  Recall@1 0.129 and Recall@10 0.591 (category baseline 0.081 and 0.558); see
  `training/recommendations/judgments/taxonomy_evaluation_206.json`. Its catalog digest differs from the historical
  input, so this is a new run rather than a bit-for-bit reproduction of the original snapshot.
- **F-03:** On isolated TLS QA `electrohub_disposable`, real Express/FastAPI/D3 returned `BEHAVIOR_EMBEDDING`
  after three consented views; consent-off returned a nonpersonal fallback. Two-customer history isolation and
  opt-out erasure were verified, temporary customer removed, and 21/21 vector-role checks passed. A separate
  internal FastAPI test with contrasting synthetic profiles produced different scored top-five lists. A single
  authenticated end-to-end before/after behavior-change comparison and browser account-switch test remain unverified.
- **F-04:** An immediate and hourly retrying runner executes bounded, concurrency-safe expiration batches with
  aggregate success/failure logging. Real isolated PostgreSQL verified expiration, cutoff preservation, coalesced
  callers, no-op and fixture cleanup; the first attempt exposed a SQL quoting error which was corrected before the
  successful rerun. Forward-only `20261029010000_recommendation_retention_index` was applied to disposable QA only;
  it remains a DEV/PROD release dependency. Existing migration bytes were not changed.
- **F-05/F-06:** Local view deduplication is scoped by customer and rejects stale retries following identity/consent
  changes; recommendation payloads carrying attribution tokens use `private, no-store`. Focused backend tests
  passed 65/65 and recommendation frontend tests passed 50/50. A separate impression fix restarts dwell after a
  hidden-tab interval. Two real browser clients submitting persisted independent impressions remain unverified.
- **Verification:** frontend full suite 996/996; backend/frontend typecheck, lint and builds passed; AI Ruff and
  mypy passed; workflow policy and 21 migration safety tests passed; Prisma schema validated. Backend full suite
  could not complete under sandbox temporary-file/local-network restrictions; affected backend tests passed separately.
  AI full and broader targeted pytest runs were interrupted during slow startup; only the 30 metric tests are
  independently confirmed here. Focused mocked Playwright passed 28/28 across four widths; captured 390px and
  1440px mocked product-detail screenshots were inspected;
  real signed-in browser smoke and visual comparison are not verified. Existing hosted CI applies only to HEAD.
- **Review scope:** FastAPI, core backend, and frontend feature files received bounded independent reviews, but a
  complete full-file ledger for every changed path and all T44 criteria has not been completed. No new model was
  activated. No additional commit, push, merge, deployment, DEV write or PROD write occurred in this closure attempt.

**READY FOR FINAL ARCHITECT REVIEW: NO** — complete the outstanding evidence and full changed-file review above;
the independent judgment set is a small agent assessment rather than a representative human study.

## TASK 04.4 — FINAL ACCEPTANCE CLOSURE (2026-10-29)

This closure supersedes the stale branch and verification statements above. No commit, push, merge, deployment,
PROD write, or model/index change was made.

**Branch/base/HEAD:** `feature/04.4-ml-powered-recommendations` / `5f7aede9845ad1f739304ddf40ba71fc537df9ae` /
`8edff82e4c678857b1e84d4e09e1a89df5257b22`. **Local diff:** 86 tracked paths versus `origin/develop` plus 14
untracked files (100 changed paths total; all assigned in the review ledger below).

### Six findings and real D3 evidence

- **F-01/F-02 — evaluation and recall:** Correct standard Recall@K divides by the complete relevant set; the focused
  metric suite passed 31/31 and the result JSON was regenerated. The 206-product taxonomy snapshot reports D3 vs
  category Recall@1 `.129/.081`, Recall@5 `.426/.340`, Recall@10 `.591/.558`, NDCG@5 `.979/.904`, NDCG@10
  `.982/.936`, coverage@10 `1.000/.612`, and local scoring mean `.069 ms` (p95 `.078 ms`). Historic capped-recall
  values remain labeled invalid. The separate frozen set is **agent-judged, not human**: 3 anchors, 24 pairs,
  19 products; D3 vs category Recall@5 `1.000/.933`, NDCG@5 `.979/.940`. It is a small convenience sample, not
  consumer validation or statistical evidence. No measured popularity baseline exists; training remains NO-GO.
- **F-03 — authenticated personalization:** On TLS-verified disposable QA
  `electrohub_disposable:55434`, active D3 was `siglip2-b16-p256-d1-b3900dd9fad5`. Real Express → behavior-profile
  → FastAPI/pgvector → Express calls returned `BEHAVIOR_EMBEDDING`, `isPersonalized=true`: three consented views
  became four after a contrasting smartphone-family view, the profile watermark advanced, 13 D3 candidate scores
  changed, and Express ranking admitted three iPhone variants. Fresh CUSTOMER A/B fixtures defaulted consent OFF;
  the earlier API run verified B isolation and A opt-out erasure. The browser run below demonstrated B’s empty
  off-state and same-product view, but its tightened stale-request ownership assertion did not run.
- **F-04 — retention/operations:** Bounded, idempotent, concurrency-safe retention runs independently at startup
  and hourly with retry and aggregate success/failure/count logging. Isolated PostgreSQL checks covered expired
  interactions, attribution and recently-viewed rows, boundary/unexpired preservation, concurrency, retry and
  no-op. No user event or vector is logged.
- **F-05/F-06 — tracking and attribution:** View deduplication is scoped to the authenticated identity and stale
  retries are rejected after identity/consent change; focused frontend tracking and backend event tests passed.
  Token-bearing product, popular, personal and cart responses are `private, no-store`. In the earlier real two-browser
  run, both responses were D3-backed with distinct signed batches, 9 owned rows persisted independently with no
  user/session field, replay accepted `0`, and forged product/token requests returned `400`. Those rows and the
  temporary A/B accounts were deleted and TLS-read-back as absent.

### Browser and changed-file review

The initial real isolated browser spec passed 3/3; a focused account-switch rerun passed 1/1. At 390px and 1440px,
the inspected PDP had no horizontal clipping; desktop showed four cards across and mobile stacked cards. ProductCard
navigation, guest cart/wishlist actions and keyboard focus-visible passed. Some just-captured below-fold You May Also
Like image slots still showed lazy placeholders; earlier interaction screenshots showed those photos loaded. The
dwell check used a DOM visibility-property/event shim (450 ms visible, 1300 ms hidden, then 950 ms visible before
the first event); headless Chromium did not provide a native background-tab transition.

Independent review then found missing assertions in that new spec. The spec was tightened to fail closed to loopback
QA and the exact fixture path, compare A/B bearer identity and verify A’s post-delay history, and count client event
POSTs across a guest-cart rerender. Its focused ESLint passed after removing an unused helper. **The final Playwright
rerun did not reach the spec:** the authenticated `/api/internal/development-runtime` preflight returned `404`
`text/plain` from both direct Express and the Vite proxy, including with the `.isolated-docker` token file path.
Health endpoints were `200`, QA database identity remained verified, and no pending QA migrations were reported;
the diagnostic refused before its runtime identity/TLS response. The guard was not bypassed. No test users, helper
or events remain. The tightened A-owner and post-rerender request-count assertions are reviewed but unexecuted.

Changed-path ledger: 28 AI-service paths reviewed by the AI reviewer; 26 backend paths and 4 `.github`/attributes
paths reviewed by backend/policy reviewers; 37 frontend paths reviewed by the frontend reviewer; and 5 docs/task
paths reviewed by the docs/traceability reviewer. The isolated spec received a separate full read-only review after
the lead’s correction. Every changed path is assigned; no actionable source defect remains beyond the blocked final
browser assertion run.

### Migration, tests and traceability

The additive `20261029020000_recommendation_consent_consistency` check closes a schema/service invariant gap in the
already-applied base migration; no applied migration was edited. Retention index `20261029010000` and the new
`20261029020000` migration both replayed on disposable QA, and a clean 28-migration replay plus second no-op passed.
The exact ordered PROD allowlist and guarded DEV entrypoint recognize `20261029000000`, `20261029010000`, and
`20261029020000`; all three SQL files are LF-pinned. Read-only DEV preflight found `0100` and `0200` pending (the
base `0000` is applied); no DEV write occurred in this closure. Read-only PROD ledger ends at
`20261028020000_product_media_worker_health`; no Task 04.4 migration is applied there. Release remains through the
guarded DEV procedure and existing `develop`-triggered PROD workflow after approval; neither was run here.

Focused evidence reused or run: frontend suite 996/996; backend recommendation tests 65/65; metric tests 31/31;
workflow safety 22/22 plus policy check; Prisma validation; mocked Playwright 28/28; Storybook/build/lint/typecheck
passed. Backend full-suite and AI full-pytest runs remain incomplete/environment-limited; hosted CI success applies
only to the pushed baseline SHA, not this uncommitted source. `git diff --check` passed.

T44 traceability: **PASS** 01–18, 20–22, 25–26, 28–37, 40–41, 43–44, 49–54, 57, 59–60; **PARTIAL** 19, 23–24,
38–39, 42, 45–47, 58; **NOT VERIFIED** 27 and 48; **N/A** 55–56 (conditional trained-ranker work, evidence-based
NO-GO). The agent-judged relevance holdout is independent of taxonomy and model rankings, but is not human validation.

**Material blocker:** the final isolated runtime preflight refused authentication with 404, so the strengthened
browser assertions for stale A-request ownership and duplicate client impression emission were not executed.
Native background-tab visibility and RTL/200%-zoom coverage also remain unverified. **READY FOR FINAL ARCHITECT
REVIEW: NO** until the isolated runtime diagnostic succeeds and those focused assertions run. PROD release remains
separate and unapplied.

### Runtime parity closure (2026-10-29)

This update supersedes the prior runtime-preflight blocker above. HEAD remains
`8edff82e4c678857b1e84d4e09e1a89df5257b22`; all existing remediation remains uncommitted. No DEV migration, PROD
write, commit, push, merge, deployment, or model/index change was made.

- **Normal DEV:** `localhost:3000`, `127.0.0.1:5000`, and `127.0.0.1:8000` returned HTTP 200. Guarded read-only
  preflight verified both DB URLs target Supabase project `pzxekjybdiulzmssalfo`; ledger is 26 rows / 28 local
  migrations, with `0000` applied and `0100` + `0200` pending. DEV FastAPI capabilities report environment
  `development`, recommendations `READY`, and active D3 `siglip2-b16-p256-d1-b3900dd9fad5`. The live product API
  returned four D3 Similar Products and four D3 You May Also Like items; measured Popular returned three items;
  FBT correctly returned `NO_DATA/INSUFFICIENT_SUPPORT`. An intervening You May Also Like request returned no data,
  then the equivalent request succeeded; no persistent failure reproduced. The recommendation timeout default is
  now bounded at 8 seconds (existing 10-second maximum); config tests passed 36/36. A real DEV storefront smoke
  returned HTTP 200 at 390px and 1440px, rendered both four-card D3 rails with the expected version, had no page
  errors or horizontal overflow, and its screenshots were visually inspected. No DEV customer test account/session
  was available under the current authorization, so signed-in preferences and Recently Viewed were not exercised.
- **Isolated QA:** frontend `127.0.0.1:3200`, Express `:5200`, and FastAPI `:8200` returned HTTP 200. The Docker-mode
  token was explicitly read from `.isolated-docker/runtime-token.txt`; authenticated direct and Vite-proxied
  diagnostics returned 200 with the same instance ID, `ISOLATED_QA`, `databaseReady=true`, and `tlsVerified=true`.
  FastAPI capabilities report environment `qa`, recommendations `READY`, and the same exact active D3 version.
  Express returned real D3 Similar Products and You May Also Like. The strengthened isolated Playwright spec passed
  **3/3** after the service recovery: stale A response stayed owned by A while B recorded its same-product view;
  two browsers received independent attribution, replay/forgery checks passed, and post-rerender impressions were
  not duplicated. Hidden-tab dwell used the documented visibility-event shim, not a native background-tab change.
  QA retains its disposable PostgreSQL/pgvector database; all three Task 04.4 migrations were previously replayed
  there and the QA launcher reported no pending migrations.

**DEV READY: NO** — the actual DEV runtime and anonymous D3 storefront are operational, but `0100` and `0200` remain
pending and the authenticated DEV customer settings/history gate is unverified. The active task context contains no
owner authorization to write shared DEV migrations or customer history. **QA READY: YES** for manual QA at
`http://127.0.0.1:3200`. DEV remains at `http://localhost:3000`. QA and DEV AI credentials, environments, and indexes
were kept separate. PROD migrations remain unapplied; no model promotion occurred.

### Guarded DEV migration update (2026-10-29)

Owner authorization was supplied for the two reviewed additive DEV migrations. Supabase identified
`pzxekjybdiulzmssalfo` as `electrohub-dev`; the guard verified both URLs and applied-history checksums.
Before deployment, the new consent constraint had zero violating preference rows, and Recently Viewed had zero
rows. The previously recorded disposable replay covered both migrations. Prisma schema validation passed.

The guarded `recommendations-migrate.cjs deploy` applied `20261029010000_recommendation_retention_index` and
`20261029020000_recommendation_consent_consistency`; Prisma status and the guard's post-check reported 28 applied
migrations and none pending. Independent Supabase queries confirmed all three Task 04.4 ledger entries finished,
the consent CHECK and global `lastViewedAt` index exist, and all four recommendation tables have RLS enabled and
deny direct anon/authenticated SELECT. The active D3 version remains `siglip2-b16-p256-d1-b3900dd9fad5`.

Prisma generate failed with Windows `EPERM` while replacing the client engine; generation is not verified. The
authenticated DEV two-customer browser and before/after personalization gate, retention runtime check, and final
DEV/QA parity recheck remain outstanding. Supabase's performance advisor also reports an unindexed
`recently_viewed_products.productId` foreign key; its impact has not been assessed. DEV and QA readiness and final
Architect readiness are therefore **NOT VERIFIED** for this update. No PROD write, model activation, commit, push,
merge, or deployment occurred.

### Normal DEV authenticated D3 check

Using the owner-designated existing customer credential from the backend environment, Chromium opened DEV
`localhost:3000`, signed in through Express `:5000` (HTTP 200, CUSTOMER), and `/api/auth/me` returned HTTP 200
with the same user identity. Preferences were enabled. The real authenticated personal recommendation endpoint
returned HTTP 200, `BEHAVIOR_EMBEDDING`, `isPersonalized=true`, 28 profile signals and embedding version
`siglip2-b16-p256-d1-b3900dd9fad5`. The real DEV product page rendered four Similar Products using
`EMBEDDING_SIMILARITY` and four You May Also Like items using `HYBRID_EMBEDDING`, both with that version; FBT
reported `NO_DATA/INSUFFICIENT_SUPPORT`. Authenticated FastAPI capabilities on `127.0.0.1:8000` reported
environment `development`, recommendations `READY`, and the same D3 version. Browser interaction and impression
POSTs were blocked for this check, and no product or preference was created or changed. Login created an ordinary
customer session. This check does not establish a fresh before/after preference change or two-user isolation on DEV;
the other outstanding checks above remain open.

### Final Prisma and DEV retention gates (2026-10-29)

- **Prisma generate: PASS using separate output.** The current schema generated a full Prisma Client 6.12.0 in a
  temporary output directory. Its declarations matched the installed client after normalizing the expected runtime
  import path. Backend `npm run typecheck` and `npm run build` both passed. Normal output remains locked by the
  running project-owned DEV and QA backends and a commerce-email runner; its Windows rename returns `EPERM` while
  those processes hold the engine. The separate generation avoided disrupting either runtime.
- **DEV retention registration and startup: PASS.** The current DEV Express process logged runner startup and an
  immediate successful sweep, followed by another successful sweep approximately one hour later. The runner is
  registered once at server startup, independently of interactions. Source inspection confirms 90-day retention,
  a maximum of four batches of 500 rows per table, in-process coalescing, and `FOR UPDATE SKIP LOCKED` for concurrent
  instances. Failure retries use bounded backoff.
- **Retention observability: PASS.** The observed DEV success logs contained aggregate deletion counts; the focused
  runner tests passed 3/3, including sanitized failure reporting and retry after failure. No shared DEV expiry test
  records were inserted. Failure handling was tested; a real DEV failure was not induced.
- **Database and D3:** Read-only Supabase inspection reports 28 finished migrations and no unfinished migrations;
  the guarded post-check previously confirmed no pending local migrations. Active D3 remains
  `siglip2-b16-p256-d1-b3900dd9fad5`. Authenticated DEV recommendations and isolated QA E2E are the previously
  verified results above. The previously reported unindexed Recently Viewed product foreign key remains an
  unassessed performance advisory.

These two requested gates pass with the separate Prisma output described above. The ordinary in-place generation
remains unavailable while the engine is locked. No new commit, push, merge, deployment, PROD write, model activation,
or customer activity was performed for these gates. Ready for independent Architect review; no self-approval claimed.

### Real-browser recommendation remediation (2026-10-29)

- HEAD remains `8edff82e4c678857b1e84d4e09e1a89df5257b22`; the previous remediation and this update are uncommitted.
  DEV Supabase project `pzxekjybdiulzmssalfo` reports 28 completed migrations and zero unfinished. DEV health and
  read-only runtime attestation passed; the product endpoint returned four Similar and four You May Also Like items
  using `siglip2-b16-p256-d1-b3900dd9fad5`, with FBT `NO_DATA/INSUFFICIENT_SUPPORT`.
- Added authenticated, user-scoped single-item history deletion, VIEW-signal removal and serialized clear/delete,
  frontend cache updates and error handling, purchase-oriented stock filtering, and Account presentation updates.
  Recently Viewed retains unavailable products. Product recommendation logs now provide aggregate stage timings.
- Positive FBT was verified in disposable QA with two temporary qualifying orders for existing AX23/AX55 products:
  SQL support was two distinct orders and the live API returned AX55 with `CO_PURCHASE`. Owned orders were removed
  and verified absent. During the five-minute cache window, the real QA product page rendered the FBT card; its
  screenshot was inspected. After expiry, the endpoint returned `NO_DATA/INSUFFICIENT_SUPPORT` again. This fixture is
  not evidence of genuine customer demand.
- Fresh DEV screenshots at 390 and 1440px were inspected with recommendation images loaded. This read-only smoke
  blocked interaction POSTs; it is not proof of a fresh authenticated history mutation or Account visual acceptance.
  Five DEV product recommendation requests took 5964, 8293, 10019, 7748 and 8574 ms; no measured speedup is claimed.
- In isolated QA, an owned customer removed an existing history item with HTTP 204 and the empty list persisted after
  refresh. A first Account screenshot exposed a narrow single-item card; the rail layout was corrected and fresh 390px
  and 1440px screenshots were inspected. A second view/removal check passed; focused rail and panel tests passed 21/21.
- The rounded preference switch updates the section optimistically, shows no saving label, guards duplicate requests,
  and rolls back with an accessible error on failure. A controlled QA browser check confirmed the pending and simulated
  failure states. Initial section loading separately disables the control until loading completes; focused component
  tests cover this condition, but a follow-up browser script failed with a `ReferenceError` before completing its check.
  Its disposable QA browser session could not be logged out normally; attempted task-owned session cleanup could not be
  verified, so its eventual expiry or explicit scoped cleanup remains outstanding.
- Restored the existing disposable QA database through its guarded launcher. Direct and proxied QA runtime attestation
  subsequently passed with matching instance identity, database and TLS readiness. The current real QA browser suite
  failed 3/3: account-switch timed out, the attribution test received category fallback instead of D3, and the dwell
  test could not find a Similar card. A subsequent read-only QA request recovered four D3 Similar and four hybrid
  items; the cause of the temporary fallback remains unconfirmed. A rerun passed attribution and the visibility-event
  shim/deduplication scenarios. The account-switch test was corrected to query state without assuming a cached or
  consent-disabled request would be emitted; its targeted rerun passed with the original isolation assertions. A
  failed test cleanup exposed a short-lived QA access token in its diagnostic; the fixture's refresh session was logged
  out, and the stateless access token expires naturally. No DEV or PROD credential was involved.
- Focused backend tests passed 58/58 and frontend tests passed 33/33; backend/frontend builds and lint passed.
  `git diff --check` passed. The frontend build retains its existing chunk-size and mixed-import warnings.
- **Not accepted:** owner-reported disappearance is not reproduced and verified, the full FBT browser and stock,
  history, responsive and accessibility browser matrix remain unverified, and the Account visual redesign has not
  received complete browser acceptance. Performance root cause and before/after improvement remain unverified.
  **READY FOR PRINCIPAL ARCHITECT REVIEW: NO.** No product, PROD write, commit, push, merge or deployment was made.

### Second browser acceptance — partial follow-up (2026-10-29)

HEAD remains `8edff82e4c678857b1e84d4e09e1a89df5257b22`; remediation remains uncommitted. The isolated direct and
proxied private diagnostics both returned `ISOLATED_QA`, the same instance, database ready and TLS verified. The DEV
and QA service ports were listening; this alone is not a new end-to-end DEV readiness assessment.

The consent-off history query is disabled but React Query can still report it as pending. The Account switch therefore
incorrectly remained disabled for a fresh opt-out. The switch now treats history as loading only while consent is on.
The component regression passed (15/15). A real isolated Chromium scenario began with consent off, enabled it, delayed
the history request on reload, observed the switch disabled during that request and enabled when it completed. The
1440px loading screenshot was inspected. The complete isolated recommendation spec passed 4/4, including account
switching, two-browser attribution and a visibility-event shim; the account-switch test passed again after adding
best-effort logout in cleanup. The shim is not native background-tab evidence.

Focused frontend lint, typecheck and build passed; the build retained its existing mixed-import and chunk-size
warnings. `git diff --check` passed with line-ending warnings. Browser assertions now compare authentication and
attribution secrets as booleans so an assertion failure does not print their values; traces remain disabled. A scan
of current isolated text test results found no JWT-shaped strings. This does not prove all older diagnostics or
outstanding task-owned refresh sessions were cleaned up; the earlier session-cleanup limitation remains open.

The owner-observed disappearing rail, the 6–10 second DEV latency root cause and improvement, complete FBT/stock and
history matrices, the broader responsive/accessibility checks and full B01–B74 acceptance matrix remain incomplete.
No performance improvement or complete visual acceptance is claimed. The previous browser, D3 and migration evidence
retains only its stated scope. **READY FOR PRINCIPAL ARCHITECT REVIEW: NO.** No commit, push, merge, deployment,
PROD write, product creation or model activation was performed in this follow-up.

### Remaining-gates investigation (2026-10-29)

The live DEV product endpoint returned `FALLBACK_CATEGORY/AI_UNAVAILABLE` in 7,780 ms; the current DEV backend log
classified the corresponding failure as `AI_INFERENCE_TIMEOUT`. A separate, read-only service probe guarded both
database targets as the exact DEV project and used the current compiled recommendation service and DEV FastAPI.
Five sequential samples returned real D3 Similar and You May Also Like: 12,482 ms cold, then 6,880, 7,644, 7,644,
and 7,170 ms warm. All-sample p50/p95 (nearest-rank p95) were 7,644/12,482 ms; warm p50/p95 were 7,407/7,644 ms
(four samples). The warm second AI request took 2,271–3,125 ms; the second catalog hydration took 1,377–2,182 ms.
The timings demonstrate multiple sequential contributors; they do not establish a database/network root cause or
prove a safe optimization. There is no after-fix performance sample. The DEV checkout supervisor discards child
stdout, and its currently running process predates the stage-timing change; the separately guarded probe did not
restart it.

In a real normal-DEV Chromium session using the owner-designated credential, login and `/api/auth/me` returned success;
all non-authentication API mutations were blocked. The Recommended for You heading was not visible 15 seconds after
login or 15 seconds after refresh, but was visible after Home → product → Home. The later real response was
`BEHAVIOR_EMBEDDING`, personalized, four products, with D3 version `siglip2-b16-p256-d1-b3900dd9fad5` and no
fallback. No page exception was observed. This limited observation does not identify why the rail was absent or
prove the owner's intermittent disappearance fixed.

For security cleanup, a TLS-verified connection guarded to the disposable QA database and the exact two task-owned
customer identities revoked 13 unrevoked, unexpired refresh sessions and verified zero remained for those identities.
The known exposed access JWT is stateless; source specifies a 15-minute lifetime, but its actual expiry or rejection
was not independently confirmed. The current isolated text results contained no JWT-shaped strings; an additional
scan found one JWT-shaped test artifact in an unrelated transformed cache without an expiry claim, which was not
classified as the exposed QA credential. Older task-owned diagnostics have not been comprehensively proven clean.

The latency fix, disappearing-rail diagnosis, full B01–B74 browser matrix and comprehensive credential-artifact
cleanup remain incomplete. No before/after improvement, full UI acceptance or final readiness is claimed.
**READY FOR PRINCIPAL ARCHITECT REVIEW: NO.** No commit, push, merge, deployment, PROD write, new product or model
activation occurred.

### Live latency experiment follow-up (2026-10-30)

The running DEV product endpoint was measured on `tp-link-archer-ax55` with limit 4 after an experimental change
overlapping Similar hydration with a speculative You May Also Like request, conditional on exact authoritative
exclusions. The served process logged that the speculative exclusions matched. The first request took 11,589 ms;
the subsequent ten took 8,601, 9,338, 7,264, 9,594, 10,463, 9,683, 10,044, 5,866, 8,310 and 9,576 ms
(warm p50 9,457 ms; nearest-rank p95 10,463 ms). Seven of the ten warm requests had an AI-unavailable fallback;
three produced both D3 Similar and hybrid You May Also Like. The active returned D3 descriptor matched the expected
version. These measurements are not equivalent to the earlier four successful warm samples (p50 7,407 ms), because
the latter had a different failure profile and runtime conditions. No improvement is established.

The experiment was removed: its focused tests passed, but live results did not justify retaining added speculative
load. The final, restored recommendation-service test file passed 40/40 and `git diff --check` passed with existing
line-ending warnings. Backend typecheck, focused lint and build passed during the experiment; the backend build was
rerun after removal. FastAPI reports `AI_INFERENCE_TIMEOUT` from its bounded retrieval/scoring operation, but the
individual contributions of pool wait, remote PostgreSQL and ranking remain unmeasured. This follow-up did not run
the outstanding B01–B74 browser cases. The existing prior evidence remains limited to its stated scope. Latency and
the complete browser acceptance remain open; **READY FOR PRINCIPAL ARCHITECT REVIEW: NO**. No PROD write, model
activation, commit, push, merge, deployment or new product was performed.

### Root-cause remediation follow-up (2026-10-30)

The earlier browser probe measured the Home heading while the browser was actually on `/account`: the Account login
modal intentionally navigates there. A fresh DEV trace confirmed `/account` after login and refresh, and `/` after the
subsequent navigation. It also exposed a separate session-restoration race: Home issued private requests using a cached
identity before session verification, competing refreshes returned repeated 409s and eventually 401s, and the rail
remained absent. `HomePage` now gates private recommendation and preference queries on `isSessionVerified`, as the
existing cart and wishlist providers do. A second run observed a genuine `AI_UNAVAILABLE` fallback on initial Home,
then a real D3 result after refresh. `usePersonalRecommendations` now retries that initial AI fallback at most once;
existing same-user personalized results are retained during a background outage, and the latest consent value is
checked after the response. No fallback is relabeled as personalized.

After the fixes, a fresh real DEV Chromium run navigated to Home after login and observed Recommended for You on
Home, after Home refresh, and after product navigation. All three successful responses were `BEHAVIOR_EMBEDDING`
with four products; login and `/api/auth/me` identities matched and there were no page exceptions. Analytics and
commerce writes were blocked in this run. A separate isolated Chromium test injected one transient AI fallback and
verified the next real QA D3 response rendered the rail; this is not a real DEV outage simulation. The existing QA
account-switch, attribution, visibility-shim and switch suite passed 4/4, and the outage case passed 1/1. Focused
Home/query tests passed 18/18; frontend build/typecheck and focused lint passed. Existing build warnings remain.

The current served DEV path returned product recommendation times of 11,534, 6,855 and 9,744 ms during concurrent
browser activity, including one `NO_DATA` AI fallback. Its actual structured stages included warm similar AI
1,429–3,443 ms, similar hydration 549–1,854 ms, You May Also Like AI 2,031–2,692 ms, and its hydration 780–2,524 ms;
a separate AI attempt took 6,168 ms and failed. These small, contended samples are not comparable after-optimization
measurements. No server-side latency optimization or improvement is claimed. The original four warm samples had
p50/p95 7,407/7,644 ms. The 6–12 second performance issue remains unresolved.

The isolated database briefly became unreachable because its WSL container session ended; after the guarded launcher
and an attached WSL session were restored, the disposable database verified as port 55434 with TLS and the private
browser preflight succeeded. Both task-owned QA customers were opted out and signed out through the application;
one remaining active refresh session was revoked by a separate identity-guarded disposable-DB check, with zero
remaining. The previously exposed QA access token from the prior day's run has exceeded the source-defined 15-minute
lifetime. No JWT-shaped string was found in current isolated text test artifacts; historical artifact coverage is
not comprehensive. The full B01–B74 matrix, complete FBT/stock/responsive review and independent Architect gate
remain incomplete. **READY FOR PRINCIPAL ARCHITECT REVIEW: NO.** No commit, push, merge, deployment, PROD write,
model activation or new product occurred.

### FastAPI timeout tracing and compact transfer (2026-10-30)

Added request-correlated, scalar-only timing for pool acquisition, combined active-index/eligible-candidate SQL,
result fetch and scoring, including the outstanding phase on cancellation. A guarded diagnostic FastAPI process
used the DEV project-bound, certificate-verifying TLS connection and reported the expected active D3 index and
412/412 eligible images covered. Six direct baseline requests had one `AI_INFERENCE_TIMEOUT`: acquisition was
effectively immediate, scoring took 0–15 ms, and the combined SQL call was still outstanding when the timeout
cancelled it at about six seconds. Successful SQL calls took 1.7–3.3 seconds end-to-end. `execute` includes server
execution and remote response transfer, so this instrumentation cannot separate those two costs by itself. A
read-only EXPLAIN ANALYZE of an equivalent anchor-centroid query ran in approximately 19 ms on DEV PostgreSQL; it is
not the exact parameterized statement. The exact cause of the long remote call remains unproven.

DEV measurements showed a mean pgvector text size of 2,915 bytes versus 1,028 bytes for its native binary form.
The candidate query now sends base64-encoded pgvector binary and validates the dimension, reserved header and finite
float32 values before the existing scoring; active-index and current-source checks remain in the same statement.
In alternating guarded diagnostic requests using the same anchor, both formats returned identical ranking hashes
and 10/10 successful D3 responses each. Original-format direct-AI p50/p95 were 3,122/4,827 ms; compact-format
p50/p95 were 2,949/4,620 ms. This modest 10-pair comparison does not establish a material improvement, eliminate the
previously observed timeout, or measure the normal :8000 process, which was not restarted. No timeouts occurred in
either comparison group. The earlier end-to-end warm median was 9,457 ms with seven fallbacks out of ten; its
conditions differ. Cold behavior and final Express/browser latency were not measured after this change.

Focused gateway tests passed with one opt-in integration test skipped; Ruff and mypy passed. The isolated QA browser
spec passed 5/5 using its authenticated Docker runtime preflight, including account-switch isolation, transient-AI
recovery, independent attribution and the visibility-event shim (not native hidden-tab validation). The 390px
product and 1440px Account screenshots were inspected. Attribution-token assertions were changed to compare booleans
so a failure does not print the signed values; the affected two-browser scenario passed again. Both task-owned QA customers were subsequently opted out,
their histories verified empty and their current sessions logged out via the guarded isolated API; older sessions and
all historical artifacts were not re-audited. The two diagnostic FastAPI processes and temporary scripts were stopped
or removed. Full B01–B74, FBT/stock and responsive/accessibility coverage remain incomplete. Normal DEV has not been
verified running the new source. **D3 RELIABILITY: NOT VERIFIED; LATENCY: NOT ACCEPTED; BROWSER MATRIX: INCOMPLETE;
READY FOR ARCHITECT REVIEW: NO.** No PROD write, model activation, commit, push, merge or deployment occurred.

### Final engineering acceptance follow-up (2026-10-30)

Normal DEV FastAPI on :8000 was restarted after identifying the owned listener and its launcher; startup reported the expected D3 version with 412/412 eligible images. The configured DEV project identity and verify-full TLS were checked. The current source emitted the new request-correlated timing events.

For the exact current parameterized vector statement, read-only EXPLAIN ANALYZE reported 10.963 ms execution and 4.778 ms planning in DEV PostgreSQL. Three requests over the project-bound TLS connection took 3,610/5,173/3,721 ms in execute, with 0–1 ms subsequent fetch and 72 candidates carrying 100,080 base64 bytes. Execute includes server work and network response transfer, so the latter cannot be independently timed here. Acquisition was effectively immediate in the live FastAPI logs and local scoring was milliseconds. The timeout can occur during this combined call; its precise network component remains unisolated.

Actual :5000 product endpoint: first post-restart sample 5,742 ms; ten subsequent samples 4,013/4,932/4,591/4,781/5,265/4,637/5,491/5,318/4,324/9,707 ms. Warm median 4,856.5 ms and nearest-rank p95 9,707 ms. All 11 returned genuine D3 Similar and hybrid You May Also Like; no AI timeout/fallback in that sample, while FBT truthfully reported insufficient support. Four direct :8000 requests were 4,980/1,264/4,325/3,374 ms, all successful. Across the 11 Express requests, median Similar AI/hydration and YMAL AI/hydration were 1,280/538 and 1,357/1,005 ms. The previous four successful warm requests had median 7,407 ms, but conditions and sample sizes differ; this comparison does not isolate the compact transfer as the cause. The later previous 9,457-ms median had seven fallbacks, also not equivalent.

A fresh authorized DEV browser confirmed matching /auth/me identity, BEHAVIOR_EMBEDDING with four products on Home after login, refresh and in-app return, real D3 product rails, and private rail removal after logout. An initial unauthenticated refresh returned 401 and one later refresh returned 409 but recovered. A separate rapid sequence of full-document navigations produced 409, 409, 401 and failed to show the rail after returning Home; the precise cause remains unconfirmed. Product browsing was read-only. DEV AX55 screenshots at 390 and 1440 were inspected after 19 images loaded; neither viewport had horizontal overflow.

A new guarded isolated browser test recorded three distinct views in newest-first order, simulated a failed removal and observed rollback, removed the middle item, verified persistence after reload, cleared all, and verified the empty state after reload. It passed. Both task-owned QA customers were opted out, their histories confirmed empty, and the current cleanup sessions logged out. This is not proof that every historical task-owned session or artifact was examined. Existing 5/5 QA browser evidence, FBT product-detail positive proof, binary ranking-hash comparison and original task evidence remain valid only at their stated scope. Focused AI gateway tests passed with one opt-in integration test skipped; Ruff, mypy, frontend targeted lint, frontend typecheck and git diff --check passed (line-ending warnings).

The original acceptance matrix follows. UNVERIFIED means the specific assertion was not completed; it is not labelled BLOCKED without a demonstrated external blocker.

| ID | Original gate | Result / evidence |
|---|---|---|
| B01 | Real DEV frontend :3000 | PASS — DEV browser and 3000 storefront |
| B02 | Real DEV Express :5000 | PASS — DEV endpoint, 11 samples |
| B03 | Real DEV FastAPI :8000 | PASS — restarted current source, active D3 readiness |
| B04 | Verified DEV Supabase identity | PASS — DEV project and certificate verification guard |
| B05 | Existing customer credential used securely | PASS — approved backend credential, values not recorded |
| B06 | Real browser login and `/auth/me` | PASS — real browser login and matching /auth/me |
| B07 | Genuine D3 Similar Products | PASS — live DEV endpoint and inspected 390/1440 screenshots |
| B08 | Genuine D3 You May Also Like | PASS — live DEV endpoint and inspected 390/1440 screenshots |
| B09 | No current-product recommendation | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B10 | No unintended duplicate cards | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B11 | Correct image/name/price/stock | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B12 | Product navigation | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B13 | Wishlist and Add to Cart | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B14 | Honest category fallback | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B15 | Guest Homepage | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B16 | Authenticated Homepage | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B17 | Real Recommended for You | PASS — live browser BEHAVIOR_EMBEDDING and expected descriptor |
| B18 | No unexpected disappearing rail | FAIL — rapid full-document navigation reproduced refresh 409/401 cascade |
| B19 | Stable background refetch | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B20 | Correct profile update | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B21 | Consent default OFF for new QA account | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B22 | Enable consent persists | PASS — isolated browser history test and API |
| B23 | Rounded switch optimistic UI | PASS — previous isolated browser switch evidence |
| B24 | Switch remains enabled during save | PASS — previous controlled QA browser evidence |
| B25 | Switch failure rollback | PASS — previous controlled QA failure evidence |
| B26 | Switch disabled on initial loading — actual browser | PASS — isolated switch-loading browser scenario |
| B27 | Three distinct product views | PASS — new isolated three-view history browser scenario |
| B28 | Contrasting product changes profile | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B29 | Customer A/B account isolation | PASS — isolated account-switch browser scenario |
| B30 | Stale A-request ownership | PASS — isolated delayed-request ownership browser scenario |
| B31 | No cross-account history | PASS — isolated account-switch browser scenario |
| B32 | Opt-out erasure | PASS — guarded QA opt-out and empty history |
| B33 | Recently Viewed correct order | PASS — new isolated history browser scenario |
| B34 | Remove one history item | PASS — new isolated history browser scenario |
| B35 | Remove middle/last item | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B36 | Clear All | PASS — new isolated history browser scenario |
| B37 | Immediate UI update | PASS — new isolated history browser scenario |
| B38 | Persistence after refresh | PASS — new isolated history browser scenario |
| B39 | Failed mutation rollback | PASS — new isolated simulated 503 browser rollback |
| B40 | No stale history reappearance | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B41 | Correct profile invalidation | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B42 | Cart/wishlist/orders preserved | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B43 | Purchase-oriented stock filtering | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B44 | Recently Viewed out-of-stock history | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B45 | FBT zero/one-order suppression | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B46 | FBT minimum qualifying support | PASS — prior isolated two-order support and live API evidence |
| B47 | FBT paid/unpaid/refunded/cancelled correctness | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B48 | FBT ranking/determinism | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B49 | FBT positive Product Detail browser | PASS — prior isolated positive product-detail browser evidence |
| B50 | FBT positive Cart browser | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B51 | No FBT duplicate/cart item | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B52 | No automatic cart mutation | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B53 | Correct cart totals | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B54 | AI failure fallback | PASS — isolated injected transient failure |
| B55 | AI recovery | PASS — isolated real D3 recovery scenario |
| B56 | Attribution separation | PASS — isolated two-browser attribution |
| B57 | Replay/forgery protection | PASS — isolated replay and forgery scenario |
| B58 | Impression dwell/deduplication | PASS — isolated visibility-event shim and rerender check; not native hidden-tab evidence |
| B59 | QA token/session cleanup | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B60 | DEV performance root cause | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B61 | Measured before/after latency | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B62 | No loading flicker or request storm | FAIL — rapid full-document transition triggered refresh 409/401 cascade |
| B63 | Premium Account visual acceptance | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B64 | 390px | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B65 | 768px | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B66 | 1440px | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B67 | 1920px | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B68 | 200% zoom | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B69 | Keyboard accessibility | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B70 | Image lazy-loading completion | PASS — DEV AX55 at 390/1440, 19 images loaded per viewport |
| B71 | Existing commerce regression checks | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B72 | Targeted tests, lint, typecheck and builds | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B73 | Final changed-source review | UNVERIFIED — no sufficient case-specific evidence in this follow-up |
| B74 | Clean task-owned QA fixture/session cleanup | UNVERIFIED — no sufficient case-specific evidence in this follow-up |

DEV READY: NO (rapid-navigation refresh failure remains). QA READY: YES for the guarded scenarios executed. D3 RELIABILITY: NOT ACCEPTED beyond the bounded sample. LATENCY: NOT ACCEPTED pending comparable repeat and residual-tail assessment. PERSONALIZATION: FAIL on the rapid-navigation case. FBT, STOCK, HISTORY and ACCOUNT UI: PARTIALLY VERIFIED. B01–B74: INCOMPLETE. SECURITY CLEANUP: INCOMPLETE. At least one material issue was observed; a complete defect count is not established. READY FOR INDEPENDENT ARCHITECT REVIEW: NO. No commit, push, merge, deployment, PROD write or model activation.

## Final defect closure — INTERIM (2026-10-30, Gate A in progress; handoff NOT final)

- Change: `apps/frontend/src/lib/api.ts` serializes `/api/auth/refresh` across documents with an origin-wide Web Lock (bounded 8 s wait, unlocked fallback). Server reuse detection and the 10 s rotation window are unchanged. 2 new tests in `api.test.ts`; 75 frontend auth/API tests and 72 backend refresh/replay tests pass; typecheck and lint clean.
- Measured on DEV (real Chromium context, sanitized, one session, logged out afterwards): login 10.1 s; four sequential `POST /api/auth/refresh` each took 7.8-9.4 s and returned 200. An earlier rapid-navigation run returned one `500 INTERNAL_SERVER_ERROR` on refresh and 500 on a follow-up refresh.
- Working diagnosis (supported, not yet proven): refresh latency (~8 s) is close to the 10 s server rotation window, so navigation during a refresh aborts it after rotation but before the new cookie is stored; the next document replays the stale cookie (409 while inside the window, REFRESH_TOKEN_REUSED 401 after). A real-browser reproduction of 409/409/401 with server-side error codes and the fixed build is still outstanding. Root cause of the slow refresh (DEV DB round-trips) is not yet characterized.
- Not done: Gates B-E, B01-B74 closure, integrated pass, final declaration. All remain UNVERIFIED; B62 stays FAIL.
- Refresh latency profile (DEV, read-only): five `GET /api/health/ready` (a single `SELECT 1`) took 0.53-0.66 s with one 1.6 s outlier, i.e. about 0.55 s per database round trip to the remote DEV database. `refreshSession` issues about 13 sequential statements (token lookup, user+role lookup, then a transaction: begin, advisory lock, token find, update, create, commit), which matches the measured 7.8-9.4 s. The cost is per-round-trip network latency, not query execution or code defects. No code change was made: the only safe saving (merging the token and user lookups) removes about one of 13 trips, and collapsing the rotation transaction would change replay-security semantics. Residual risk: on DEV a refresh lasts about as long as the 10 s rotation window, so navigation during a refresh can strand the session; on a co-located database (millisecond round trips) the exposure is negligible. The window was deliberately not extended.
- Gate A reproduction and fix (real Chromium, DEV, one customer session, logged out afterwards; sanitized timeline in ms): login, load Home (refresh starts at ~1.0 s, takes ~8 s), navigate to /products at ~3.7 s. BEFORE: refresh 409 REFRESH_ROTATION_IN_PROGRESS (10.6 s) -> 409 (13.9 s) -> 401 (19.6 s, no code in body; past the 10 s window on a rotated token, i.e. the reuse path), refresh cookie cleared, session family revoked. That is the reported 409/409/401. Root cause: the navigation cancels the in-flight refresh after the server has rotated; the Set-Cookie with the successor is lost; the next document replays the superseded cookie. AFTER (`keepalive: true` on refresh, plus the cross-document Web Lock): 409 (10.3 s) -> 200 (15.7 s) -> `/api/auth/me` 200, cookie present. Server reuse detection, rotation window and token issuance are unchanged; backend refresh/replay suites pass (72/72). Frontend auth/API: 76/76; typecheck and eslint clean.
- Gate A status: PASS for the single reproduced sequence. Not yet run: multi-reload storm, two-tab, delayed-response and full A/B isolation rerun in the fixed build; a rotated cookie whose response is truly lost (browser crash, network drop) still requires clean re-authentication by design.
- Gate A extended run (fixed build, real Chromium, DEV): login, three rounds of rapid Home/Products/Account/Cart navigation (150-400 ms apart), four back-to-back reloads, then a second tab opened while tab 1 reloaded. Browser-originated auth calls: 3 refresh (all 200) and 3 `/api/auth/me` (all 200); zero 409, zero 401; session remained valid. One `409 REFRESH_ROTATION_IN_PROGRESS` was returned to the test script's own out-of-page refresh call, issued while tab 1's reload refresh was still in flight (the script bypasses the page lock), which is the documented concurrent-rotation behavior and did not revoke the session. Replay protection unchanged (backend 72/72). Not run: delayed-response injection and A/B customer isolation in this build.
- Still open: Gate B correction/remeasure, Gate C (B01-B74 UNVERIFIED cases), Gate D cleanup beyond logging out test sessions, Gate E integrated pass, final declaration. Declaration: RAPID-NAVIGATION AUTH: PASS (scoped as above); everything else NOT DECLARED; READY FOR INDEPENDENT ARCHITECT REVIEW: NO.
- Gate C progress — FBT SQL on a real database (disposable Docker pgvector Postgres `localhost:55434`, verified identity, never shared DEV/PROD; throwaway script outside the repo; fixtures created and removed in the same run, final residual count 0). `coPurchases` was previously only mocked in unit tests. 14/14 scenarios PASS: no orders -> empty; one qualifying order suppressed; two qualifying orders -> support 2; CONFIRMED/PREPARING/OUT_FOR_DELIVERY/DELIVERED qualify; PENDING/PROCESSING/FAILED/REFUNDED, refundedAt-set, CANCELLED and AWAITING_CAPTURE orders excluded; duplicate lines and quantity 9 count once per order; hidden, test-fixture and inactive candidates never returned even at support 3; anchors never self-recommended (single and multi-anchor); ranking by support desc ([3,2,2]); repeated queries identical; equal-support candidates both present with stable order. Ledger effect: B45, B47, B48 -> PASS (SQL level); B51 -> PASS for self/anchor exclusion at SQL level only (already-in-cart exclusion at the service level, and B50, B52, B53 cart browser/totals, remain UNVERIFIED). The strict productId tie-break is not asserted because equal-support candidates also differ in `productOrders`.
- Gate C still open: stock eligibility (B43/B44), history opt-out/profile invalidation/A-B (B40-B42), Account UI and responsive/accessibility (B63-B69, B71), cleanup (B59, B74), B60/B61 (documented above: remote DB round trip ~0.55 s), B72/B73 final checks.
- Gate C progress — stock, cart FBT, history and consent on the disposable database (real `RecommendationService`, `SearchService`, `CartService` against `localhost:55434`; AI disabled; throwaway script outside the repo; fixtures incl. a second disposable customer removed, residual 0). 25/26 checks PASS after correcting one script mistake (cart FBT items are `{rank, product}`):
  - Stock: in-stock purchasable; out-of-stock and missing-inventory products are returned as not purchasable; hidden, inactive and test-fixture products are absent from the public projection; a stock change is reflected on the next read; Add to Cart rejects out-of-stock, missing-inventory, inactive and test-fixture products and accepts in-stock.
  - Cart FBT: with two qualifying orders the purchasable candidate is returned (strategy CO_PURCHASE); the out-of-stock candidate and the in-cart anchor are not; the cart (items, quantity, subtotal) is unchanged by the call.
  - History/consent: view while opted out not persisted; views listed newest first; Recently Viewed still lists an out-of-stock historical item but not as purchasable; remove middle/newest/oldest; profile signals drop by exactly the removed view; Clear All empties history and VIEW signals without touching cart or orders; no resurrection on re-read; opt-out erases history and all signals; later views not recorded; customer B unaffected throughout (isolation).
  - FINDING (Low, pre-existing, owner decision needed): `CartService.add` accepts an ACTIVE, in-stock product whose `storefrontVisible` is false (its availability rule checks status, fixture flag, category and inventory but not `storefrontVisible`). Recommendations never surface such products; it is reachable only by direct product id. Not changed: altering cart eligibility is outside Task 04.4 and could affect existing carts.
  - Ledger effect (service/database level, NOT browser): B40, B41, B42, B43, B44 -> PASS at service level; B52 -> PASS at service level; B53 totals unchanged at service level. Browser-level B50, B53, B63-B71 remain UNVERIFIED.
- Gate C browser QA (real Chromium vs `localhost:3000`, DEV, reduced-motion, fresh login per viewport; screenshots in the session scratchpad, not committed). Viewports 390, 768, 1440, 1920 and 200% zoom (720 px at DPR 2) on Home, Product Detail, Account and Cart: horizontal overflow 0 px on all 20 page/viewport combinations; 0 broken images after scrolling (a few lazy images still pending at 390 Home and 1440 Cart at capture time, none broken); 0 clipped buttons; 0 unnamed buttons/links/switches by aria-label/text/alt; keyboard: 12 of 12 sampled Tab stops showed a visible outline or ring on every page (12-stop sample, not a full tab-order audit). The Account switch was found (checked, rounded visual not inspected) at 1920 and 200% zoom; at 390/768/1440 the Account/Cart content had not finished loading within the 14 s wait (DEV latency, see below), so the Account UI (B63), Recently Viewed controls in the browser and Cart FBT browser (B50) are NOT VERIFIED. The switch exposes no aria-label/text through my probe (it may be named by an associated label): not confirmed either way.
- Normal-sequence auth timeline (390 px, Home -> Account -> Cart, 16 s each): 3 refresh (7.9-9.5 s each, 200), 3 `/api/auth/me` (1.5-4.3 s, 200), zero 409/401. In the viewport sweep, console showed one 401 and/or one 409 at 390, 1440, 1920 and 200% zoom; the cause was not isolated (not reproduced in the timeline run), so B62 stays UNVERIFIED rather than PASS.
- DEV latency effect on UX: Account content appeared ~32 s and Cart ~48 s after navigation start in the timeline run (refresh ~9 s + `/api/auth/me` ~4 s + data calls, each remote round trip ~0.55 s and up to 4 s under contention). This is a DEV-network limitation but is customer-visible and unacceptable as a performance result for B60/B61: PERFORMANCE: FAIL (not accepted).
- BLOCKER for the rest of Gate C/E: after repeated scripted logins, a valid-credential `POST /api/auth/login` against DEV now hangs (>60 s, three attempts) while `/api/health/ready`, empty-body login (400) and `/api/recommendations/popular` respond normally. I stopped logging in to avoid hammering the owner-authorized customer account. A QA run that timed out mid-way did not log out, so one or more test-owned sessions may still be active (B59/B74 cleanup NOT done; revoking them needs a DB write to the customer's refresh tokens or a successful logout, which I have not done).
- Gate C browser QA, follow-up after login recovered (the hang was transient; login 9.9 s, refresh 4.6-5.2 s that time): Account at 390 and 1440 loaded fully (about 16 s): zero horizontal overflow, 5 images loaded and none broken, personalization switch present with accessible name "Personalized recommendations" and checked state exposed (`aria-checked=true`, rounded switch seen in the 1440 screenshot above the fold; the lower part of the page, Recently Viewed cards and balance of the cards, was not visually reviewed), Recently Viewed remove buttons and "Clear recently viewed" present with accessible names, 12/12 sampled Tab stops with visible focus. Two remove buttons exist for the same product name (Apple Watch Series 9) at both viewports: not investigated, possible duplicate render or two layouts: OPEN. Cart at both viewports: 6 lines with price/stock labels and named remove buttons, no overflow. One transient 503 console error at both viewports in the sweep; a repeat run of Account then Cart recorded no 4xx/5xx at all, so it is unattributed.
- Customer-state note: the shared DEV customer currently has personalization ON and recent history that includes a product-page view produced by my scripted run (or pre-existing). I did not change the preference or clear history; owner decision needed on whether to clear history/opt out. My logouts completed on every run that finished; the one run that timed out mid-way did not log out, so its session persists until it expires or is revoked.
- Ledger effect: B63 PARTIAL (switch, controls and consistency seen; lower page not reviewed), B64/B66 PASS for overflow/images/focus/names on Account/Cart/Home/Product at 390 and 1440, B65/B67/B68 PASS for the same checks on Home/Product/Account/Cart (768, 1920, 200% zoom) from the first sweep except Account/Cart content that had not loaded, B69 PARTIAL (12-stop sample, no Enter/Space or Shift+Tab test), B62 UNVERIFIED, B59/B74 NOT DONE.

## Final remaining-gates execution (2026-10-30) — NOT APPROVED

**Changes in this pass** (all uncommitted): `auth.service.ts` and `auth.controller.ts` — a successful refresh now also returns the `/api/auth/me`-shaped identity, read AFTER the rotation commits, sequentially and best-effort (any failure omits it; it can never fail the refresh or lose the successor cookie); `sessionRestore.ts` and `auth/api/auth.ts` — restore uses that identity and skips `/api/auth/me`, falling back to `/me` when absent or malformed. Tests: backend auth service/controller 89/89 (new: identity returned, identity-read failure still rotates), frontend `api.test.ts` + `features/auth` 77/77 (new: no-`/me` path and fallback), backend and frontend typecheck, backend lint, frontend lint on auth/lib, both builds, `git diff --check`: clean. Server rotation, reuse detection, family revocation and window are unchanged.

**Gate A — PASS** (fix from the previous pass retained; no regression in the re-run journey: rapid navigation restored the Account page and Cart loaded).

**Gate B — FAIL (latency not accepted).** Measured on DEV (single customer, real Chromium, full-document loads): `/api/auth/me` after refresh removed (it cost 1.5-4.3 s serially before). Refresh itself 5.8 s, 6.1 s and 12.4 s in three later runs (earlier 7.8-9.5 s): per-statement round trip to the remote DEV database (about 0.55 s, spikes to 4 s), about 11 statements; no safe reduction without restructuring the rotation transaction, which I did not do. Account content complete about 16 s after navigation in two runs; Cart complete about 16 s in one run and still showing skeletons at 16 s in another (refresh 12.4 s). Ordinary in-app link navigation does not refresh: Account->Cart 526 ms and Cart->Account 402 ms with 0 refresh and 0 `/me`. So the slow path is a full page load or reload while logged in, and it is bounded by remote DB latency. D3 product recommendations were not re-measured in this pass (earlier: warm median 4.86 s, p95 9.71 s).

**Hidden-product Add to Cart — RESOLVED (documented exception, no code change).** `STOREFRONT_FIXTURE_VISIBILITY.md` and `08_Quality/STOREFRONT_VISIBILITY_FIXTURE_PROPOSAL.md` state that `storefrontVisible` is discovery-only, that Stripe acceptance fixtures are deliberately hidden yet purchasable through Cart/Checkout, and that `cart.service.test.ts` pins this contract. Recommendations stay stricter (SQL and projection require visible, ACTIVE, non-fixture, in stock; verified at database level earlier). Closing the cart path would break the acceptance harness.

**Duplicate Recently Viewed remove buttons — NOT A DEFECT.** In real Chromium at 390 and 1440 the Account page has exactly one "Remove ... from recently viewed" button (a `LI` item control) and one separate "Remove ... from wishlist" button on the wishlist card for the same product; the earlier probe matched both and truncated the labels. Same product id/href, different lists, distinct labels.

**Gate C — INCOMPLETE.** New this pass: positive Cart FBT in the browser on the isolated stack (disposable DB, two synthetic paid orders, fixtures removed, residual 0): at 390 and 1440 the "Frequently Bought Together" rail showed the in-stock candidate, did not show the out-of-stock candidate, cart lines 1->1, totals unchanged, no cart-mutating request while viewing, 0 px overflow (B50, B52, B53 browser-level PASS). Reused: 14/14 FBT SQL, 25/26 service scenarios (the 26th is the documented hidden-product exception), isolated history/attribution browser suites, viewport sweeps. Still NOT re-run in the browser: Account lower-page visual review, 768 px Cart FBT, Shift+Tab/Enter/Space keyboard audit, 200% zoom for Account/Cart content after load, AI fallback/recovery re-run on the changed build, full commerce regression. Ledger B01-B74 is therefore not complete.

**Browser errors explained.** From the journey and viewport runs with URLs and codes: (1) `POST /api/auth/refresh 401` for a guest with no session cookie (guest home and product page): expected, treated as "guest". (2) `POST /api/checkout/payment-attempts/:id/read 503 PAYMENT_MUTATIONS_DISABLED`: the shared-DEV payment-write guard rejecting the Account/Home payment-notice acknowledgement; expected, swallowed by the client, not task-related. (3) `POST /api/auth/refresh 500` and `GET /api/categories 500` within 30 ms of each other (backend log: two `DATABASE_ERROR` pg-pool "operation failed" entries, no Prisma code): transient DEV database connection failure, not reproduced in later runs; the page recovered via the existing bounded restore retry (Account step took 41 s that run). Unresolved root cause on the network/DB side: counted as a medium risk. (4) The earlier 401/409 pairs in the viewport sweep were not reproduced in five later runs; most likely harness behavior (logout issued while pages were still open) but not proven.

**Home personalized rail on shared DEV — NOT DEMONSTRATED.** `/api/me/recommendations` returned 200 but the rail did not render for the shared customer (consent on, but only one recorded view). "Recommended for You" appears only with a real profile; building one would change the customer's history, which I was told to preserve. The personal rail remains covered by the earlier isolated browser suites. The guest Product Detail Similar/You May Also Like step also failed in my journey script ("document is not defined", a script bug); the product recommendations call itself returned 200 earlier in the run. Gate E: INCOMPLETE.

**Gate D — FAIL (open item).** Done: disposable fixtures removed (residual `qa044` fixtures 0), isolated servers stopped, no token or credential printed or stored in repo files (scripts read credentials at run time; outputs sanitized; scripts and screenshots live in the session scratchpad, not the repo), headless contexts discarded so no persistent cookie remains. Open: read-only DB check shows two active refresh-token families for the DEV customer created 2026-10-30 15:23-15:24 UTC (4 generations) and 15:27-15:29 UTC (6 generations) that match the interrupted scripted runs by timing only. Ownership is not verified (the table holds no user-agent or client marker), so I did not revoke them; their cookies were never persisted and they expire in seven days. Older families (27-29 Oct) belong to earlier sessions and were not touched.

**Defect counts:** critical 0, high 0, medium 2 (full-page-load latency on DEV; transient DEV database 500s on refresh/categories), low 1 (documented hidden-product cart exception, not a defect). **Accepted risks:** remote-database latency; unrevoked possibly task-owned session families until expiry; replayed lost-response cookies still require clean sign-in by design. **READY FOR ARCHITECT REVIEW: NO.**

## Final bounded acceptance pass (2026-10-30)

**Harness correction (supersedes parts of the previous section).** In this session I had started FastAPI with plain `uvicorn` and without the D3 artifact settings. On Windows that uses an event loop psycopg cannot use, and the recommender model was not loaded, so the AI service answered 503 (`AI_INDEX_NOT_READY`, later `AI_MODEL_NOT_READY`) and the backend served fallbacks. This was my harness error, not an application defect. It explains the earlier guest-product fallback (`FALLBACK_CATEGORY`, empty You May Also Like) and the absent Home personalized rail on the shared customer in the previous pass. Restarted with `python -m app` plus `AI_MODEL_ARTIFACT_DIR=models/siglip2-b16-p256-d1` and `AI_RELEVANCE_ARTIFACT_DIR=models/relevance-siglip2-d3` (inferred from the model folders; the exact historical launch line was not recorded): `ai.ready modelReady=true`. The image-search relevance model of that process is not needed for recommendations.

**Results (real Chromium, normal DEV, changed build):**
- Guest Product Detail (script bug fixed): AMD Ryzen 9 7900 rendered "Similar Products" (4 cards, `EMBEDDING_SIMILARITY`) and "You May Also Like" (4 cards, `HYBRID_EMBEDDING`), 0 broken images. A six-product API sample returned the same strategies with 4 items each. For Apple Watch Series 9 41mm the same endpoint returned Similar `EMBEDDING_SIMILARITY` (4), You May Also Like `NO_DATA` (0) and FBT `CO_PURCHASE` (1): a per-product no-data result, not investigated further.
- Integrated journey (guest Home -> Product -> login -> Account -> Home -> refresh -> rapid navigation -> Cart -> logout): every step passed. Personalized rail "Recommended for You" rendered on Home and again after a refresh for the shared customer (its history was not modified; one product-page view from the keyboard Enter test may have bumped an existing history entry's timestamp). Only non-2xx response: `POST /api/auth/refresh 401` for the guest with no session cookie (expected). Timings that run: login 4.0 s, Account 7.7 s, Cart 7.7 s.
- Account lower page (screenshot reviewed): Recently Viewed card shows image, category, name, price/discount, stock state "Out of Stock" with a disabled "Out of stock" button for the unavailable historical item, "Remove from history" and "Clear recently viewed"; 0 broken images, 0 px overflow. A red toast "Payment update acknowledgement could not be saved" appeared: the shared-DEV payment-write guard (`PAYMENT_MUTATIONS_DISABLED`), unrelated to Task 04.4.
- 200% zoom (720 px at DPR 2): Account and Cart both loaded (about 11 s each), 0 px overflow, 0 broken images, 0 clipped buttons.
- Keyboard, non-destructive on DEV: Tab reached the personalization switch (visible focus, `aria-checked`), Shift+Tab moved back, Enter on a Recently Viewed product link navigated.
- Keyboard, destructive on the isolated stack (disposable DB, fixtures removed, residual 0): Shift+Tab/Tab round trip with visible focus on the remove button; Enter removed an item (3 -> 2) with the announcement "Product removed from recently viewed."; Space removed another (2 -> 1); Enter on "Clear recently viewed" emptied the list and showed the empty state; the list stayed empty after reload; Space toggled the switch true -> false and Enter false -> true; accessible name "Personalized recommendations".
- Cart FBT and unchanged totals: reused the isolated browser evidence (390 and 1440 px; candidate shown, out-of-stock candidate hidden, lines and totals unchanged, no cart-mutating request).

**Regression:** backend auth service/controller and recommendation service 129/129; frontend `lib`, `features/auth`, `features/recommendations` 169/169; backend and frontend typecheck, lint on the changed files, both builds (earlier in this pass) and `git diff --check`: clean. Diff review of the auth changes found one cosmetic spacing slip (fixed); no logic defect. Changed source: `apps/backend/src/{services,controllers}/auth.*` and their tests, `apps/frontend/src/lib/api.ts`, `api.test.ts`, `features/auth/{sessionRestore,api/auth}.ts`, `sessionRestore.test.ts`, plus this evidence file; Task 04.4 feature work from earlier passes is also uncommitted in the tree.

**Accepted residual risks (not fixed, not verified clean):** (1) Remote DEV database latency (about 0.55 s per round trip; refresh 4-12 s on a full page load, in-app navigation about 0.5 s) and occasional transient DEV connection failures; the refresh-rotation protocol was deliberately not changed. (2) Two possibly task-owned refresh-token families (created 2026-10-30 15:23-15:24 and 15:27-15:29 UTC) were left untouched and will expire normally. (3) A rotated cookie whose response is truly lost still requires a clean sign-in by design.

**Final declaration:** Functional acceptance: COMPLETE. Gate A PASS. Gate B: latency recorded as accepted residual risk. Gate C: accepted evidence plus the checks above. Gate D: fixtures removed, residual session families accepted. Gate E: PASS. Hidden-product cart policy: RESOLVED (documented exception). Duplicate Account controls: NOT A DEFECT. Known critical 0, high 0, medium 0 application defects (infrastructure risks listed above). **READY FOR INDEPENDENT ARCHITECT REVIEW: YES.** This is not an approval.

## Recommendation loading-state fix (2026-10-30)

**Root cause.** Product Detail drew its pending skeleton under a hard-coded "Similar Products" heading, but one response decides the real sections: AI similarity keeps "Similar Products", a category fallback becomes "More in [Category]", and no-data sections disappear. The page therefore showed a wrong heading that changed (or vanished) on arrival. Home (Recommended for You, Popular Products) and Cart (Frequently Bought Together) had the same shape: a titled skeleton for sections that exist only when the server says so. Requests were already not viewport-gated (they start with the page; Product Detail starts them once the product has loaded), and the rail already returned `null` for confirmed-empty results and kept products during background refetch.

**Change (frontend only; no ranking, model, schema or server change).** `RecommendationRail.tsx`: `title` is optional; with no title and `loading`, it renders a headingless skeleton (`aria-label="Loading recommendations"`, `aria-busy`) using the existing ProductCard skeleton grid; the empty/confirmed-empty path still removes the whole section. `RecommendationSectionRail.tsx`: loading without a `loadingTitle` is neutral; the error state keeps a neutral "Recommendations" title. `ProductDetailPage.tsx`, `HomePage.tsx`, `CartPage.tsx`: loading rails no longer pass a guessed heading (Recently Viewed on Account keeps its fixed heading and its empty state, since that section always exists once consented). New tests: `RecommendationRail.test.tsx` (+3), new `RecommendationSectionRail.test.tsx` (4).

**Verification.** Component and page tests 232/232 (`pages`, `features/recommendations`, `features/cart`); typecheck, lint on the touched files, build and `git diff --check`: clean. Real Chromium on DEV with the recommendation response delayed by 3.5 s and reshaped, at 390 and 1440 px, reduced motion on, no scrolling before measuring: Product Detail, five scenarios (real response, category fallback, empty, one product, NO_DATA sections): during the load one headingless skeleton region with 4 cards was present in every case; after it, real/one product showed "Similar Products" (or "More in [Category]" when the live response was a fallback, as happened once at 1440 px), the fallback showed "More in Processors", empty and NO_DATA removed the section and the skeleton entirely; the only headings ever observed were the final ones (no wrong-heading flash); exactly 1 recommendation request per page load; no horizontal overflow; page layout-shift score 0.01 (390) and 0.05 (1440). Home (guest, delayed popular, real and empty): neutral skeleton during load, no heading, removed after (this DEV returns no measured-popularity section). Cart (signed in, delayed FBT): neutral skeleton with 4 cards and no misleading heading, removed when the cart has no co-purchase data; Account: Recently Viewed present, no leftover skeletons; no overflow at either width. Skeleton animation already honors `prefers-reduced-motion` (Skeleton and ProductCard styles).

**Not covered / notes.** A Product Detail page still waits for the product before the recommendation request starts (pre-existing; not changed to keep the fix small). A positive Home "Recommended for You" appearance was not re-run in this pass (its code path only lost the guessed heading). During verification the local dev backend's connection pool wedged (login/refresh 500, Prisma P2028) while the DEV database itself was idle; restarting the local backend cleared it (local environment issue, not caused by this change).

## Home "Recommended for You" absent after hard refresh (2026-10-30)

**Root cause.** On a hard refresh Home renders from the cached customer identity while `/api/auth/refresh` verifies the session (4–19 s on DEV). The personal queries are keyed on `isSessionVerified`, so until it flipped the personal rail was neither loading nor eligible and was simply absent while Popular, Deals and the rest appeared.

**Fix (frontend only).** `HomePage.tsx`: `sessionRestoring = !isSessionVerified && !sessionUnavailable && isAuthenticated && role === 'CUSTOMER'` keeps the neutral (headingless, no data) skeleton during restoration. A 401 clears the cached user and removes it; guests have no cached identity. `HomePage.test.tsx` asserts the skeleton while restoring and its removal on a signed-out verdict (cart-context mock keeps `CartContext`).

**Checks.** `src/pages` + `src/features/recommendations` 188/188, `tsc --noEmit`, eslint on touched files and `npm run build` clean.

**Chromium (390 and 1440, 4 s delayed response, reduced motion; S = skeleton, H = heading+cards, - = absent):**

| Case | Sequence |
|---|---|
| Authenticated, 4 products | S>H, 4 cards, no blank gap |
| 1 product | S>H, 1 card |
| Empty | S>-, section and skeleton removed |
| Consent OFF | S>-, no cards |
| API failure (500) | S>-, no permanent skeleton, Home usable |
| Guest | - throughout, 0 personal requests |
| Home > Product > Home | rail present |

CLS 0.006–0.009, overflow 0, one personal request per load.

**Console errors.** Guest 401: `/api/auth/refresh` without a cookie (normal sign-in probe), unrelated. Failure case 500: the injected personal-request failure, expected. Authenticated 503 x3: `GET /api/checkout/payment-attempts/<id>/read` for this customer's saved payment attempts, returned by the DEV payment-mutation guard; issued by the checkout/payment-resume code (untouched by this change) and unrelated to recommendations. No corrective action.

**Residual risk.** Skeleton on a cached customer shows until the DEV refresh completes (a customer whose consent is OFF sees it briefly before it clears). No authentication, backend or schema change.

**Declaration: skeleton fix COMPLETE, READY FOR ARCHITECT REVIEW.** Nothing committed.

## Recommended for You load time (2026-10-30)

**Waterfall (DEV Chromium 1440, 4 hard refreshes, ms from navigation):** skeleton visible 0.8–1.0 s; `/api/auth/refresh` 0.6 → 6.0–7.5 s (5.3–6.9 s); `/api/me/recommendation-preferences` and `/api/me/recommendations` start together 0.15–0.3 s after refresh ends (no extra sequencing, no `/auth/me`, 1 refresh and 1 recommendation request per load); preferences 1.0–1.8 s; recommendations 3.7–4.6 s; cards at 9.9–12.2 s (p50 11.6 s, p95 12.2 s). Cause: ~50% remote-DB session rotation (unchangeable by the approved protocol: rotation, 10 s grace, Web Lock, keepalive), ~35% server-side personal recommendation chain (consent read, profile read, AI call, hydration, each several 0.55 s DEV round trips), remainder client hand-off. The personal request cannot start before a verified access token.

**Change.** `queries.ts`: a recorded product view now invalidates the customer's personal query instead of removing it, so Home after a product visit keeps its cards and refreshes in the background. Consent-OFF, history clear/remove still discard (privacy unchanged). A backend change running consent and profile reads in parallel was tried and reverted: the service contract (and test) forbids reading history when personalization is off.

**Warm navigation (Home > Product > Home, 3 runs):** no skeleton, 0 recommendation requests, 0 auth requests. No before/after improvement is claimed for hard refresh: the remaining 10–12 s is dominated by DEV remote-database latency and is not fixed.

**Checks:** frontend recommendations+pages 192/192, backend recommendation service/routes 40/40 service, tsc (both), eslint, build clean. Not run: logout/customer-switch, consent-OFF and AI-fallback re-measurement (covered by earlier cache-key/clear tests and the prior pass).

## Cache correctness and DEV database latency assessment (2026-10-30, read-only)

**Cache (real Chromium, 1440, customer A).** Before: 4 personalized items, profile signals 38. A distinct product was opened: `POST /api/product-interactions` returned 201 and one new recently-viewed entry appeared; the profile watermark advanced (19:28:37Z to 19:46:05Z). While on the product page (Home unmounted) no recommendation request ran: an invalidated inactive query is only marked stale. Returning Home, the cards rendered at once (no skeleton) and a background `GET /api/me/recommendations?limit=4` ran on mount; the new response carried the updated watermark. The top four products did not change (not required). The test view was removed afterwards (204). Dispatching the session-expired event removed the personal rail immediately. Two identical requests are issued 0-3 ms apart on return (not on hard refresh); the app runs under React `StrictMode`, whose mount/unmount/mount cancels and restarts the signal-bound fetch, so this is most likely a dev-only artifact (not confirmed against a production build). Not exercised live: consent OFF and customer switch on the shared DEV customer (opt-out erases history); covered by the existing queries/tracking unit tests (192/192 frontend).

**Database latency (read-only, through the app's Prisma client, TLS unchanged).** DB is the Supabase transaction pooler (port 6543, pgbouncer) in ap-northeast-2 (Seoul). Query execution is negligible against the network wait: `count(products)` executes in 0.1-0.5 ms server-side but takes 1.7-5.6 s wall. `select 1` round trip: min 1.6-2.4 s, p50 2.3-3.5 s, p95 3.3-7.7 s (earlier in the session about 0.55 s); connect 5.2-5.6 s; an interactive transaction of 5 statements 5.5 s. During the session personalization briefly fell back with AI_UNAVAILABLE and recommendation calls took 17-25 s, then recovered to 4.5-5.5 s with no code change. The refresh critical path (several sequential round trips plus a transaction) and the personal chain (consent, profile, AI which itself queries pgvector, hydration) are therefore multiples of RTT. Developer-machine location was not determined.

**Options (none applied).** (1) Run backend and AI service in or near the database region (or point DEV at a database near the developers): expected to cut each stage roughly in proportion to RTT; needs owner approval for placement/region change. (2) Direct/session connection for long-lived services instead of the transaction pooler, and warm pool sizing: needs owner approval (pool settings are out of scope here). (3) Backend round-trip trims, only if independently safe: consent and history reads must stay sequential (privacy contract); nothing else was identified. Measured improvement from this assessment: NONE.

## Real-browser personalization, privacy and Recently Viewed verification (2026-10-30)

New evidence, separate from the sections above. Environment: disposable QA pgvector cluster with the real D3 artifact (`siglip2-b16-p256-d1`, index `siglip2-b16-p256-d1-b3900dd9fad5`, 412/412 eligible indexed), QA backend :5200, Vite :3210, Chromium. Three task-owned throwaway customers (A, B, C) logged in through the real login UI; all removed afterwards (0 remaining). The DEV Customer A/B credentials were not used (reading the backend environment file was not permitted); DEV was read only.

**Owner report ("same products after visiting other categories"), DEV read-only.** The owner's profile holds 62 qualifying purchase lines over 33 products (weight 4 each), 4 wishlist, 3 cart, 5 recommendation clicks and 6 views on 4 products (decayed total about 130; Tablets 37, Smartwatches 28, Laptops 17). One new view adds weight 1 (<1 %), so a stable top four is the designed outcome of profile-v1, not reuse of old state. No weights or thresholds were changed.

**Contrasting-category test (customer A, real views, no injection).**

| Step | Profile signals | Watermark advanced | API = rendered cards |
|---|---|---|---|
| 3 networking views | 3 | yes | axe75, ax73, c6, t3u |
| +1 iPhone | 4 | yes | axe75, c6, ax73, t3u |
| +2 iPhones | 5 | yes | axe75, c6, ax73, iphone-green-256 |
| +3 iPhones | 6 | yes | iphone-green-256, axe75, c6, iphone-blue-256 |
| +4 iPhones | 7 | yes | four iPhone 15 variants |

Every response: `RECOMMENDED_FOR_YOU`, `BEHAVIOR_EMBEDDING`, `isPersonalized=true`, D3 embedding version. Customer B (speakers) received JBL products, A networking/iPhones. A fresh-cache "leave the product before the VIEW response" race (1.5 s injected client delay) still refetched with the new profile (signals 10): not reproducible as a stale-cache defect.

**Defect fixed: revisit inside the 30-minute dedupe window did not refresh Recently Viewed order.** Root cause: the client skipped the request entirely and the server's duplicate-key path never touched history. Fix: the server moves the existing `recently_viewed_products` row to the top on a duplicate VIEW (UPDATE only, no new interaction, no profile weight, removed/evicted rows never restored) and returns `historyUpdated`; the client re-sends a genuine revisit (new mount or navigation back) with the same key, but not on re-render or session-restore flicker, and refreshes only Recently Viewed. Browser retest: `200 {recorded:false, reason:DUPLICATE, historyUpdated:true}`, ax23 moved from 2nd to 1st. Tests: backend 60/60 (2 new), frontend recommendations 81/81 (1 new).

**Verified in Chromium.** Default consent OFF for a new customer; keyboard Space toggles it, one PATCH for a double click, persists across hard refresh. Remove middle item: immediate removal, DELETE 204, matching VIEW rows deleted (10 to 9), others unchanged. Clear all via keyboard: list empty, status announced, focus moved to the "Recently Viewed" heading, VIEW rows 0, section position unchanged (823 px to 823 px; the pane did not scroll programmatically, so scroll stability is only partially verified). Opt-out: status announced, history erased (B: 0 views), product visits send no request and store nothing, OFF survives refresh. A to B in one browser context with A's private requests delayed 8 s (injected) across sign-out: no A-only product rendered in any private rail during B's session, B's consent not inherited, B's views stored only for B, hard refresh at 390 px showed only B's history, no horizontal overflow. Consent turned off while a delayed personal request was in flight: response delivered after opt-out, no private rail rendered. AI stopped: server returned `FALLBACK_NEW_ARRIVALS`, `isPersonalized=false`, `AI_UNAVAILABLE`; the client kept the same consenting customer's last personalized cards with the "temporarily unavailable" note (documented contract); after restart the note cleared.

**Not verified.** Two tabs for one customer; remove/clear while a stale history response is pending; DEV services end to end (the browser run used the QA stack); Figma comparison. The QA run also included concurrent, uncommitted edits from the separate performance task (Vite hot-reloaded HomePage, ProductDetailPage, PersonalizationPanel and RecommendationSectionRail during the run).

## Frequently Bought Together closure (2026-10-30)

**Identity label.** Evidence in this file that refers to the shared DEV customer is the owner-designated existing DEV
account. Its identity is **not confirmed** and it is **not Customer A**. The FBT evidence below uses the five-order DEV
account only as a read-only source of purchase data. Task-owned QA customers are named separately.

**Defect fixed: candidate starvation in the co-purchase SQL.** `coPurchases` ranked and limited candidates before
hydration, so storefront-hidden or out-of-stock products could take the only `LIMIT` slots and then be dropped by the
public projection. `recommendation.sql.ts` now joins `inventory` with `quantity > 0` inside the `pairs` CTE, after the
existing visible-product join, so only candidates that can be shown compete for the limit (same rule as `purchasable`).

**Checks run in this closure (all passed):**

| Check | Command | Result |
|---|---|---|
| SQL text unit tests | `npx vitest run src/services/recommendation.sql.test.ts` (backend) | 3/3 |
| Disposable PostgreSQL behavioural suite | `node scripts/recommendation-fbt-pg.cjs` (backend; disposable loopback cluster, 4 pgvector/media migrations skipped and logged) | 5/5 |
| Cart suggestion component tests | `npx vitest run src/pages/customer/CartSuggestions.test.tsx` (frontend) | 4/4 |
| Diff hygiene | `git diff --check` | clean (line-ending warnings only) |

The pg suite covers: limit 1 returns the in-stock candidate rather than the higher-support out-of-stock one; distinct
qualifying orders only (refunded and cancelled excluded; repeated lines counted once); confidence 2/5; minimum support
3 returns none; out-of-stock anchor still used as context; `RecommendationService.forCart` returns the in-stock
candidate and never a candidate already in the cart. Fixtures are created with a random suffix and deleted in
`afterAll`. Before the SQL fix, the limit-1 starvation case failed; the fix is the difference.

**Defect fixed: stale cart cards after a cart change.** `CartSuggestions` kept a previous anchor set's cards while the
new cart's request was in flight. It now renders only the current response's section. Trade-off: Frequently Bought
Together is absent during a changed-cart fetch (no skeleton), which can look like a brief flicker. Component test:
"never shows the previous anchor set after the cart changes, until the new cart is confirmed".

**Browser evidence.** The positive Cart FBT browser run (390 and 1440 px, candidate shown, out-of-stock candidate
hidden, lines and totals unchanged, no cart-mutating request) was executed on the isolated stack **before** the
inventory join was added to the SQL. It is therefore not evidence for the changed SQL. It remains as prior evidence
only.

**Browser checks on the changed SQL and component (isolated QA: Chromium via Playwright, `localhost:3200` -> Express
`:5200` -> disposable PostgreSQL `55434`, verified identity, TLS-verified runtime preflight).** The disposable database
was restarted once during this pass (pgvector container), after which the QA backend was restarted with the isolated
launcher. Temporary paid orders were seeded for the fixture customer: A+B twice and C+D twice (`A`/`C` anchors). Spec:
`apps/frontend/tests/isolated/fbt-cart.isolated.spec.ts`. Result: **4/4 PASS** (1440 and 390 px).

- Positive: with cart [A], the FBT rail showed B only once; A, C not shown; zero cart-mutating requests while viewing;
  no horizontal overflow; Add to Cart on B removed B from the rail and increased cart lines. API cross-check: `[A]` ->
  `FREQUENTLY_BOUGHT_TOGETHER`, `CO_PURCHASE`, B, the changed SQL in effect.
- Stale anchor: the cart's changed-cart response (contains C) was held in Chromium. While held, B (the previous
  [A] card) was not shown; after release the rail showed D and not C, with the new response.
- Cleanup: the four temporary orders were removed (residual 0), the fixture cart was reset, and the seed state file was
  deleted. The browser artifacts are in `apps/frontend/test-results/isolated/` (not committed).

**Still not verified:**

- Full B01–B74 matrix, Figma comparison, and previously accepted viewport coverage: not rerun, per the closure scope.
- Hosted CI for the uncommitted change: NOT VERIFIED (nothing pushed).
- Cart FBT at 768 px, 200% zoom (720 CSS px at DPR 2) and a failed delayed changed-cart request: run and passed
  12/12 in the same spec (four viewport groups, each with positive, stale-anchor and delayed-failure cases; the failure
  case returns HTTP 500 after 2 s and shows no previous cards while the cart stays usable). Screenshots are in
  `apps/frontend/test-results/isolated/`, not committed.
- Keyboard (1440 px): the rail's Add to Cart is reached by focus, shows a non-`none` outline when focused, and Enter
  adds the item (cart POST accepted; the rail then drops it). 1/1 PASS.
- Reduced motion (1440 px, `prefers-reduced-motion: reduce`): the media query matches and no running CSS animation is
  present inside the loaded rail. This is a computed-style check, not a visual review. 1/1 PASS.
- Not run: Shift+Tab sweep across the whole cart page, full tab-order audit, and screen-reader announcements.
- Self-contained: the spec (`apps/frontend/tests/isolated/fbt-cart.isolated.spec.ts`) seeds and removes its own
  temporary orders through `apps/backend/scripts/fbt-cart-qa-seed.cjs` (disposable loopback target only). It needs only
  the disposable stack running and `ISOLATED_RUNTIME_TOKEN_FILE` pointing at `apps/backend/.isolated-docker/runtime-token.txt`.
  A rerun after this change passed 4/4 and removed its state file.

**FBT status: CONDITIONS MET ON ISOLATED QA, CLOSURE NOT DECLARED.** The focused conditions (correct candidate, no
in-cart product, no duplicate, correct Add to Cart, no automatic mutation, stale-anchor behavior) pass on isolated QA with
the changed SQL and component. The identity claim is corrected (five-order DEV account, not Customer A). **READY FOR
INDEPENDENT ARCHITECT REVIEW: NO** until the uncommitted change is reviewed and the still-unverified items above are
either run or accepted by the owner.

**Payment runtime.** Left running as the owner decided ("keep it running"). No Stripe, payment or order mutation was
made in this closure. No commit, push, merge or deployment was made.

## Duplicate recommendation request and effective database route (2026-10-30, no code change)

**Duplicate request: DEVELOPMENT-ONLY.** Real Chromium, Home to Product to Home, query stale (waited past the 30 s private staleTime) and also with the VIEW response marked recorded (invalidated); the VIEW POST was answered locally so the shared customer's history was not touched. Vite dev server (:3000): two `GET /api/me/recommendations?limit=4` 4-8 ms apart, #1 `net::ERR_ABORTED` about 50-60 ms later, #2 completed (200, one x-request-id) in both modes. Production build via `vite preview` (:3300, same proxy): exactly one request, 200, in both modes. Cause: React `StrictMode` (`src/render.tsx`) mounts, unmounts and remounts the observer in development; the query function consumes the abort signal, so unsubscribing cancels the first fetch and the remount starts the second. Query keys, invalidation and consumers are not duplicating (one request in production). Whether the aborted dev request reached Express was not measured (the backend writes no per-request log); in production it never exists. No change made.

**Effective database route (config only, no credentials).** `apps/backend/.env.local` sets `DB_RUNTIME_URL_SOURCE=direct`, which overrides the unset value in `.env` (default for non-production would otherwise be the transaction pooler, which `database-target.ts` refuses). Express therefore uses `DIRECT_URL`: Supabase Supavisor **session pooler**, port 5432, region ap-northeast-2, `pg` adapter with verified TLS and CA bundle, pool max 5 (10 in production). `DATABASE_URL` (transaction pooler, 6543) is used only by Prisma tooling. This matches the runbook. The earlier plain-`PrismaClient` round-trip numbers in this file therefore measured the 6543 transaction pooler, not Express's route, and should be read as indicative of the same region/host only; a probe over the session route with verified TLS was not completed (the automated permission check refused it). FastAPI: `psycopg` `AsyncConnectionPool` (min 1, max 4, connect timeout 15 s, statement timeout 2 s, read-only session) on `AI_VECTOR_DATABASE_URL`, which must be a remote TLS URL (`sslmode` require/verify-*); its host, port and region could not be read (its `.env` is protected), so its pooler mode is NOT VERIFIED. The gateway source itself records 5-9 s TLS connects from a Windows dev machine to the DEV region.

**Latency diagnosis.** Unchanged: browser waterfall over the real route shows refresh 5.3-6.9 s and personal API 3.7-4.6 s with query execution measured in sub-millisecond to milliseconds, i.e. round-trip count times cross-region RTT. No hard-refresh improvement is claimed.

**Recommendation (one option): A, colocate the DEV backend and AI service in the database's region (ap-northeast-2)**, or equivalently run DEV against a database near the developers. Expected benefit (estimate, unmeasured): each sequential round trip drops from seconds to tens of milliseconds, taking the refresh and the personal chain from seconds to well under one second each. Risks: new hosting, secrets handling, CORS/cookie origin changes, cost. Rollback: point DEV back to the local processes. Needs owner authorization for new infrastructure. Measurement plan before approval: run the same read-only `select 1` x12 and the refresh and personal-API request sequence from a short-lived host in that region, using the existing verified-TLS session route, and compare p50/p95 with the local figures. Options B (move database: migration, downtime, data integrity), C (connection routing: already the intended session mode; transaction mode is refused by design) and D (backend round trips: consent must precede the history read, no independently safe trim found) are not recommended now.

## Recommended for You: recent interests versus purchase history (2026-10-30)

**Root cause.** Recommended for You was ranked from a single profile vector: a normalised weighted sum of every profile
product's D3 centroid. A purchase-heavy history (Customer A's DEV profile, read-only: about 130 decayed units, mostly
tablets, smartwatches and laptops) fixes that vector's direction. New views move it slightly, and its nearest neighbours
stay in the dominant cluster.

**Offline comparison.** The disposable QA cluster has real D3 vectors (`siglip2-b16-p256-d1-b3900dd9fad5`, 206 products),
and the same synthetic profiles were ranked with production eligibility. Results:
- The current weighting, a recent-share blend (α ≤ 0.5), and square-root caps all left the established customer's top 4 at
  4/4 tablets after 1, 3 and 5 phone views. Reweighting one vector changes scores but not rankings.
- The two-horizon profile gave:
  - 1 view: 0 slots;
  - 3 phones: 1 phone at position 2;
  - 5 phones: 2 phones;
  - phones followed by routers: 2 routers;
  - a return to tablets: 4/4 tablets.
- A new customer, a consistent customer and a single accidental view are unchanged.
- A mixed 5-category customer still collapses to laptops (limitation; not addressed).

**Real browser, QA.** Customer A had a synthetic QA long-term profile (16 wishlist items, 3 cart items, consent on) and
viewed product pages in Chromium:
- baseline: 4 iPads;
- +1 phone: unchanged;
- +3 phones: iPhone 16 at position 2;
- +5 phones: iPhones at positions 2 and 4, iPads at 1 and 3;
- +4 routers viewed minutes later: still iPhones at 2 and 4. All 9 recent views weigh about the same, and phones are the
  majority of the recent profile (limitation).

All QA fixtures were deleted afterwards (0 remaining).

**Changed files.**
- `apps/backend/src/services/recommendation.sql.ts`: `recent` column; ranked union so recent rows are never truncated;
  still one statement.
- `apps/backend/src/services/recommendation.service.ts`: `recentInterestSlots`, `recentInterest`,
  `interleaveRecentInterest`, and two concurrent AI rankings.
- `apps/backend/src/services/recommendation.service.test.ts`: 5 new tests.

The AI service, model, weights, thresholds and API contract are unchanged.

### Closure checks (2026-10-30)

**Full backend suite: 272 failures, 42 files, all environmental.** No failing file imports recommendation code.
- **26 files (whole suite): `DATABASE_TEST_TARGET_REQUIRED`.** The live/Postgres integration suites refuse to run without
  an approved test database target, by design. This includes `recommendation.coPurchases.postgres.integration.test.ts`.
- **10 files: `PAYMENT_MUTATIONS_DISABLED`.** These failures come from the payment-isolation guard ("Payments are
  unavailable in this environment", 503) in `payment.service.ts`, `stripe.provider.ts` and `stripe-webhook.routes.ts`:
  - `payment.service` (104 tests)
  - `payment.retry` (38)
  - `payment.purchase-ownership` (37)
  - `payment.dismiss` (24)
  - `stripe-webhook.routes` (21)
  - `payment.routes` (19)
  - `payment.session-isolation` (12)
  - `payment.lock-order` (6)
  - `buynow.concurrency-scope` (5)
  - `stripe.provider` (4)
- **1 file: `db-request-metrics.test.ts`.** One live Prisma query fails without a database. The file is unmodified.

The affected recommendation suites pass: service and routes, 81/81.

**Earlier fixes still present.**
- The FBT inventory filter in `coPurchases` (visible product + `inventory.quantity > 0` before the LIMIT) and server-side
  `purchasableOnly` are present.
- The Recently Viewed revisit fix is present: the duplicate VIEW recency bump with `historyUpdated` on the server, and
  `lastSent` re-send plus targeted invalidation in the client. Its tests pass.
- `CartSuggestions` was changed by a later concurrent edit (22:03). It no longer keeps the previous cart's cards while
  refetching; it renders nothing until the current cart's response arrives. Its 4 updated tests pass. This is a stricter
  no-stale policy, not a regression of the inventory fix. It was left as is.

**Boundaries.**
- New table-driven test for limits 2 and 6:
  - exact length, unique ids and ranks 1…n;
  - out-of-stock recent picks excluded;
  - a long-term product keeps position 1.
- Short-term failure falls back to the long-term rail; covered by an existing test.

**AI overhead.**
- Both rankings are sent concurrently.
- Defect found: `Promise.all` made valid long-term results wait for a hung short-term request, up to the 8 s AI timeout.
- Fix: after the long-term ranking returns, the recent ranking gets at most `RECENT_INTEREST_GRACE_MS` (300 ms). After
  that its slots are dropped and the timer is cleared.
- Regression test with fake timers: a never-resolving recent request still yields the personalized long-term rail.
- With no recent interest, there is exactly one AI call; covered by a test.

Checks: backend tsc, eslint, build and `git diff --check` are clean.

**Status: READY FOR ARCHITECT APPROVAL.**
