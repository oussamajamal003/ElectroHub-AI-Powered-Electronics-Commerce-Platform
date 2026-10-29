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
