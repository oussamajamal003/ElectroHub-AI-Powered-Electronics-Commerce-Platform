# Task 06.1 — Implementation Evidence & Risk Register

Spec and coverage matrix: [TASK_06.1_AUTOMATED_TESTING_E2E_CROSS_BROWSER.md](TASK_06.1_AUTOMATED_TESTING_E2E_CROSS_BROWSER.md).
All runs below are **local** (Windows 11, Node 22.19, Playwright 1.63, disposable PostgreSQL 17 + pgvector 0.8.0 in WSL Docker) unless
marked CI. Nothing here was run against a shared DEV or PROD database, Stripe live mode, Brevo or a deployed environment.

## 1. Baseline

- Branch created from `develop` @ `095cea4a7a38b25b0d2a11181485dd45eb996b04`; working tree clean at start.
- `develop` CI run 42640714931: success. The remote feature branch already existed at the same SHA (run 42674028783 marked failure
  although every listed job succeeded; Frontend / Typecheck absent from its job list) — recorded, not investigated further.

## 2. Unit, integration and service suites

| Suite | Command | Result |
|---|---|---|
| Frontend Vitest (full, after the R-1 fix) | `npx vitest run` (apps/frontend) | **1410 passed** of 1410 (171 files) |
| Frontend Vitest (full, before the R-1 fix) | `npx vitest run` (apps/frontend) | **1407 passed, 1 failed** of 1408 (170 files). The failure, `AdminProductFormPage` "asks before browser Back discards edits…", also failed before any Task 06.1 change, passes **3/3** when run alone and passes in CI: load-sensitive timing, not a regression. |
| Changed-area tests | `vitest run` on ProductDetailPage, cart, wishlist, ProductCard, WishlistButton | 79 passed |
| Backend env loading | `vitest run tests/env.test.ts` | 9 passed (includes the new `ELECTROHUB_ENV_FILES=none` test) |
| Backend full `test:ci` (disposable DB) | earlier in this task | 2107 passed, 9 failed, 238 skipped. All 9 failures environmental on this workstation (EADDRINUSE :5001 held by a running dev server, timeouts, Windows temp `ENOTEMPTY`); the same SHA passes **Backend / Test** in CI. |
| AI service | `pytest` (apps/ai-service venv) | **446 tests, 0 failures, 0 errors, 1 skipped** (JUnit report) |
| Typecheck | `tsc -p tsconfig.app.json --noEmit` (frontend), `tsc --noEmit` (backend) | clean |
| Lint | `eslint .` (frontend), eslint on changed backend files | 0 errors; 3 pre-existing `react-refresh` warnings in files not touched by this task |
| Workflow policy | `node .github/scripts/check-workflow-policy.cjs`, `node --test .github/scripts/*.test.cjs` | OK; 26/26 self-tests |

### 2.1 Gated PostgreSQL integration suites (follow-up run)

Each launcher provisions its own throwaway local PostgreSQL cluster on a random loopback port and never reads `.env`.

| Suite | Command (apps/backend) | Result |
|---|---|---|
| Admin security (Task 05.x) | `npm run test:admin-security:pg` | **103/103 passed** (8 files) |
| Delivery HTTP, service and real-time (Tasks 04.5–04.7) | `node scripts/delivery-pg.cjs` | First run **10 failed / 23 passed**. Cause: stale fixtures. Since Task 05.2 an ADMIN token is honoured only with a live, MFA-assured admin session, and these suites minted bare admin JWTs (`ADMIN_SESSION_INVALID`). Fixed in the test helper: `delivery-fixtures.ts` now creates the refresh family and `AdminSession` as `AuthService.createSession` does, and the suites pass its `sessionId`. No product code changed. After the fix: **33/33** in 1 of 3 runs; the other 2 runs had **1 intermittent failure** (R-5). After the R-5 publisher fix: **33/33 in 4 of 4 consecutive runs**. |
| Commerce email outbox | `commerce-email-pg.cjs` suite (`vitest.commerce-email-pg.config.mts`) on a fresh database in the pinned `pgvector/pgvector:0.8.0-pg17` disposable container (every migration incl. pgvector, database `timezone = 'Asia/Seoul'`, Supabase-like `anon`/`authenticated` roles, as the launcher sets up) | **39/39**. The local launcher itself stays blocked (workstation PostgreSQL has no `vector`). First run: setup assertion `expected 38 to be 20`: the suite froze the migration count at Task 03.8. Fixed to compare with the number of repository migrations (same intent: every migration applied). |
| Payment (disposable) | `payment-pg-disposable.cjs --run`, scopes A–S and A–J, on a separate throwaway container that mirrors `.github/actions/disposable-postgres` (PG 17.6, per-run `CN=electrohub-ci-ca`) | **BLOCKED (R-7)**. Target proof and TLS probe passed; `migrate deploy` into the per-run schema fails at `20261024000000_ai_vector_search`, which hard-codes `public.products` / `public.product_images`. The harness has been unrunnable since Task 04.2 on any database. Run schema dropped and container removed. |
| Inventory | `inventory.postgres.test.ts` with `INVENTORY_TEST_DATABASE_URL` → fresh database in the disposable container (dropped after) | **2/2** |
| FBT recommendations | `node scripts/recommendation-fbt-pg.cjs` | **5/5** |

The 1-hour expiry in the first fixture attempt was read as already expired. Raw SQL in `findActiveAdminSession` compares the
`timestamp` column with `now()` in the cluster's local time zone (+02:00 here). The fixture now uses a 7-day family, as real
sessions do; see R-6.

### 2.2 AI similarity end to end (follow-up run)

Local only, on the disposable release database:
- Five release products got catalog photos. `app.ingest stage` indexed them with the local SigLIP2 model `siglip2-b16-p256-d1` (5/5 succeeded), and `activate` made the index active.
- The FastAPI service ran on loopback with the read-only `ai_vector_reader` role. A second hermetic backend (:5207) was wired to it.

| Check | Result |
|---|---|
| API: unseen photos `headphones-01.jpg` and `jblheadphones-01.jpg` → `/api/search/image` | 200; ranked Aurora Studio Headphones, then Pulse Mini Earbuds; no laptops or dock |
| API: unseen photos `laptop-generic-01.jpg` and `laptops-01.jpg` | 200; Nimbus 14 Ultrabook only |
| API: `/api/products/<aurora>/recommendations` | `EMBEDDING_SIMILARITY` section ranks Pulse Mini Earbuds first, then both laptops; `CO_PURCHASE` section has the dock (from the seeded order) |
| Browser: `image-search-ai.release.spec.ts` (`RELEASE_E2E_AI=1`) on chromium, firefox and webkit desktop | **6/6 passed**: results region, expected products shown, excluded products absent, best match ranked first |

Finding during setup: with the fixture categories `release-audio` / `release-laptops`, every hit was correctly dropped by the
backend's category-hint filter (200, empty list). The products had to be in taxonomy categories. That is designed behaviour, but
fixtures for AI runs must use real category slugs. Afterwards the database was reseeded, the images and categories removed and both
AI roles set back to `NOLOGIN`; the inactive index rows remain in the disposable database. Procedure: `docs/08_Quality/E2E.md`.

## 3. Release E2E runs (Playwright, real stack)

Suite size: 7 spec files, 30 tests (9 tagged `@responsive`) → **117 test runs** per full run: 30 × 3 desktop engines + 9 × 3 responsive
projects (390 / 768 / 1920).

| Run | Scope | Result | Notes |
|---|---|---|---|
| R1 | chromium-desktop, per spec while building | all specs green after fixes | found D-1, the revision-0 seed mistake, harness rate-limit coupling |
| R2 | all projects (image-search not yet written), 3 workers | 99 passed, 5 failed, 4 not run | D-3 (real, fixed); Firefox console tour > 90 s under load ×2 (`test.slow()` added); 2 wide-firefox failures were `ENOENT` on trace files deleted by a concurrent probe run of mine — harness interference, not product |
| R3 | `image-search` on all six projects | **9/9 passed** | annotation records whether the build had image search switched off or the gateway answered unavailable |
| R4 | all projects, 3 workers | 89 passed, 11 failed, 17 not run | **disk at 593 MB free** during the run: logins, lazy chunks and searches stalled across engines |
| R4b | `--last-failed`, 1 worker | 18 passed, 2 failed | every customer failure from R4 passed; the 2 admin failures exposed a harness gap (TOTP secret saved only after the full enrollment), fixed by the resumable `signInAdmin` |
| R5 | `admin` on chromium-desktop + firefox-desktop, 1 worker, fresh seed | **10/10 passed** | |
| R6 | all projects, 2 workers (CI setting), fresh seed | **117/117 passed** | see §3.1 |

### 3.1 Final local run (R6)

`npx playwright test -c playwright.release.config.ts --workers=2` after a fresh seed, 2026-11-10 03:35 UTC, 19.0 min.
Playwright JSON stats: `expected: 117, unexpected: 0, flaky: 0, skipped: 0` (local `retries: 0`, so no test passed on a retry).

| Project | Tests | Result |
|---|---|---|
| chromium-desktop, firefox-desktop, webkit-desktop | 30 each | all passed |
| mobile-webkit-390, tablet-chromium-768, wide-firefox-1920 | 9 each | all passed |

Image search: this local build has image search **enabled**, so the valid-photo test exercised the gateway path (one upload, answered
unavailable — no AI service). CI builds have no frontend env file, so there the same test takes the switched-off path (no upload).

### 3.2 Specific evidence

- **Journey C live update**: the customer tracking page changed to the new status without reload within 20 s; the backend's realtime
  counters moved `published: 0 → 2`, `publish_failed: 0`, `subscribe_ok` incremented (log event `delivery.realtime.metrics`).
- **D-3**: measured `document.scrollWidth − innerWidth` on `/admin/deliveries` at 390 px: **110 px before → 1 px after the min-width rule
  → 0 px after `position: relative`**; 0 px at 768 and 1440 and on the delivery detail page.
- **Payment**: the hermetic stack shows "Payment actions are switched off on this server…"; Review Order stays disabled; no order or
  payment attempt was created (order references compared before/after).

## 4. CI

New job **Release E2E / Chromium, Firefox, WebKit** in `.github/workflows/ci.yml`. Remote result: _recorded after push_.

## 5. Visual QA

Viewports 390×664 (WebKit/iPhone 13), 768×1024 (Chromium touch), 1440×900, 1920×1080. Verified by automated horizontal-overflow and
visibility assertions on every `@responsive` page, not by pixel comparison. **Figma comparison: NOT VERIFIED** in this task (06.2).

## 6. Risk register

| Id | Risk / finding | Severity | Status |
|---|---|---|---|
| D-1 | Add to Cart / Buy Now refused with a misleading message during post-reload session check | Medium | **Fixed** + regression test |
| D-2 | Wishlist heart clicks silently dropped during the same window | Medium | **Fixed** on the product page + test |
| D-3 | Admin Delivery list overflowed phones by 110 px | Low | **Fixed**, guarded by `@responsive` admin test |
| R-1 | Product **cards** (Home, Search, Wishlist page) still call `addItem` during the session check and show "Could not add item. Please try again."; card hearts likewise are not disabled | Low | **Fixed** in the follow-up. The shared `ProductCard` disables Add to Cart and the heart (`aria-busy`) until the session has a verdict (`useCustomerSessionPending`). Unit test `ProductCard.session.test.tsx`. E2E "product cards wait for the post-reload session check…" passes on chromium, firefox and webkit, and fails as expected with the fix reverted. |
| R-2 | Stripe Test Mode success / decline / webhook paths are not exercised by the release suite (no Stripe key on the hermetic stack) | Medium | Covered elsewhere (backend Stripe/webhook suites, isolated real-Stripe harness); **NOT VERIFIED in this task** |
| R-3 | AI similarity ranking not exercised end to end (no AI service on the stack) | Medium | **Verified locally** (§2.2): API plus browser 6/6 on three engines. Not in CI (no AI service there); personalised (account-history) recommendations still not exercised. |
| R-4 | Gated PG integration suites not re-run | Low | **Closed except payment** (§2.1): admin security 103/103, delivery 33/33 (4/4 runs after R-5), commerce email 39/39, inventory 2/2, FBT 5/5. Payment: see R-7 |
| R-5 | Delivery real-time: the customer socket occasionally received revisions out of order (`[1,2,4,3,…]`); the stored events were correct. | Low | **Fixed**. Cause: callers fire `DeliveryPublisher.afterCommit` without awaiting it, and each publish reads the projection asynchronously, so two close commits (a simulation tick and the stop) emitted in read-completion order. Publishes are now serialized per order (`src/sockets/delivery.publisher.ts`); other orders are unaffected and a failed publish does not stall the queue. Unit test `delivery.publisher.test.ts` (fails without the fix); delivery PG suite 33/33 in 4 of 4 runs. |
| R-6 | `findActiveAdminSession` compares a `timestamp` (no time zone) column with `now()`; on a non-UTC database session, expiry shifts by the UTC offset | Info | Harmless on UTC hosts (Supabase); recorded, not changed |
| R-7 | The disposable payment harness (`payment-pg-disposable.cjs`, Task 03.6) migrates into a per-run schema, but Task 04.2's `ai_vector_search` migration references `public.*` tables, so the A–S / A–J payment PostgreSQL suites cannot run anywhere. | Medium | **Open**: needs a separately approved harness change (e.g. migrate a fresh instance's `public` schema and prove it empty) or migration change; editing an applied migration is not acceptable. Payment logic stays covered by unit/route suites and the release E2E payment-isolation tests. |
| H-1 | Harness observation: on a cold stack a reused keep-alive socket was intermittently reset between two back-to-back API requests ("socket hang up"; the second request never reached the server log). Not reproduced outside the suite; harness contexts send `Connection: close`. Browser traffic unaffected. | Low | Mitigated in harness; not claimed as a product defect |
| H-2 | Local runs are sensitive to workstation resources (3 engines in parallel; disk nearly full during R4). CI runners are the authoritative cross-browser environment. | Info | Documented |
| H-3 | Each Journey C run advances its project's seeded order one step; after three runs on one stack start the order is Delivered and the test stops with a clear "restart the release stack" message. CI always starts fresh. | Info | By design |
| O-1 | A 30-minute stall early in the task was the workstation sleeping (every log, including the metrics heartbeat, stopped), not the application | Info | Resolved (keep-awake) |
