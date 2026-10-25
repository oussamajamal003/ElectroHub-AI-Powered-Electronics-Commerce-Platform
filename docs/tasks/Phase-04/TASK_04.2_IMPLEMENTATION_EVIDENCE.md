# Task 04.2 — Implementation Evidence

**Branch** `feature/04.2-Real-Vision-Search-Integration`. Base: `255cb9d` (= `origin/develop`, PRs #35 and #36 merged). Everything is uncommitted: **no commit, push, merge or deploy.**

**Worktrees:**
- The main checkout (this task).
- `.claude/worktrees/discovery-console`: clean, already merged.
- `serene-edison`, `electrohub-release`: untouched.

**Prepared** 2026-10-25. Every result below comes from a command or run that was actually executed. Items not verified are marked as such.

## A. "Owner cannot see the Discovery Console": root cause

The owner's tab had been loaded while the main checkout was still on the catalog branch; the console then existed only in the discovery worktree. With the checkout on `develop`, `:3000/search` serves the console, and Ctrl+K opens it with live suggestions (browser-verified). No code change was needed, only a hard reload.

## B. What was built

| Area | Change |
|---|---|
| Dataset (Commons only) | `training/data/{catalog_snapshot,commons_collect,review_sheets,build_dataset}.py`. Uses the MediaWiki API (POST, ≤ 1 request/s), records per-file licence and provenance, auto-rejects bad candidates, then manual visual review. Photos are grouped into capture groups by SHA-256/pHash and same creator-day sessions, with creator-disjoint splits and a leakage audit. Dataset, photos and attributions are git-ignored. |
| Training | `training/src/{data,losses,metrics,train,export}.py`. Supervised-contrastive loss with a P×K sampler; frozen baseline first; validation-only selection; weight-delta logging; safetensors export with a parity check. `build_kaggle.py` packages a PRIVATE dataset plus a kernel; `kaggle_cli.py` passes only `KAGGLE_*` values. |
| Shared network | `app/models/embedding_network.py`: EfficientNet-B0 + Linear(1280→256) + L2 norm, and `preprocess_image` (`effb0-rgb-r256-c224-imagenet-v1`). Training, ingestion and serving all use it, so preprocessing cannot drift. |
| pgvector | Migration `20261024000000_ai_vector_search` (additive `ai` schema, 2 NOLOGIN roles). `app/ingest` CLI with stage/activate/rollback/status. Docs: `docs/06_Database/AI_VECTOR_INDEX.md`. |
| FastAPI (Haiku subagent W4, lead-fixed and reviewed) | Safetensors loader that checks SHA-256 before load; magic-byte decoder with bomb, frame and side limits; read-only pgvector gateway with an exact cosine search grouped by product; single-part multipart route; 8 MiB limit on that route only; readiness re-checked on each probe; index self-heal on the search path (throttled to 5 s); selector event loop on Windows; `AI_ENV_FILE`. |
| Express (Haiku subagent W5, lead-reviewed) | `POST /api/search/image`: multer memory storage (1 file, 0 fields, 8 MiB), magic-byte check, 20 requests per 5 minutes per IP, `AiServiceClient.imageSearch` (8 s route timeout, aborted on client disconnect), one catalog query that reuses the storefront visibility predicate and `ProductSummary` mapper, and a stable error mapping. |
| Frontend | 8 MB budget end to end; 504 mapped to the timeout state; "colour and storage versions can look identical" note on results; honest offline copy ("It wasn't saved" rather than "not sent"); **a11y fix**: the icon-only image toggle now has a name on narrow screens; **layout fix**: preview actions no longer clip at 390 px; the stale Playwright block for the old tabs was replaced; new real-stack spec `tests/isolated/discovery-image.isolated.spec.ts`. |
| QA infrastructure | `dev-isolated.cjs` gains `ISOLATED_PG_DOCKER=1`: pinned `pgvector/pgvector:0.8.0-pg17` in WSL Docker, the same TLS and identity checks, a WSL keep-alive, and separate state in `.isolated-docker`. Runtime diagnostic: the Docker bridge address is accepted only in that declared mode (tested). Helpers: `ai-vector-qa.cjs` (roles, verify, ai-service, backend) and `ai-vector-dev.cjs` (gated by DEV ref, refuses PROD). |
| Docs | `docs/07_AI/{FASTAPI,IMAGE_SEARCH,MODEL_FLOW}.md` (Task 04.2 sections), `docs/05_Features/SEARCH.md`, and the new `docs/06_Database/AI_VECTOR_INDEX.md`. |

## C. Dataset (owner decision: Wikimedia Commons only)

**Catalog and candidates:**
- Catalog (DEV API, read-only): 206 visible products, 16 categories, 102 appearance families.
- Commons: 4,276 candidates found; 921 passed the licence and model-name checks; 201 accepted after visual review of every contact sheet (47 families decided, with reasons recorded in `review.json`).
- Licences: 22 PD/CC0, 65 CC BY, 94 CC BY-SA. Each file has its page, author, licence URL and SHA-256 recorded; EXIF is stripped from stored copies.

**Rejections from visual review** included:
- "990 PRO" results that were beyerdynamic headphones, and "T5 EVO" and "T9" results that were cars and buses.
- PS5 Slim, iPhone/Galaxy Pro and Ultra models, a Watch6 Classic and an iPad Air 13".
- Retail boxes, die shots, benchmark charts and photos taken *with* a camera rather than of it.

**Grouping and splits:**
- 63 creator families and 108 capture groups. Sessions are grouped per family; hashes are grouped globally.
- AM5 Ryzen chips form one visual family.
- Split audit **PASSED**: no capture-group, creator, query/gallery or unseen/train leakage.
- Known-product protocol: 15 families (57 SKUs) — 127 train, 20 validation, 16 frozen test queries.
- Unseen-product protocol: 8 families (35 SKUs) — 12 queries.
- 110 SKUs (TP-Link, Tapo, Brother, MacBook Air, most JBL, and others) have no usable Commons photos and are index-only.

The 166 AI storefront illustrations are excluded from training and testing. They are only the catalog index gallery, which creates a domain gap (see section E).

## D. Training (Kaggle, PRIVATE)

**Environment:** dataset `oussamajamal003/electrohub-commons-vision-v1` (private), kernel `oussamajamal003/electrohub-vision-train` (private), Tesla T4 (2 allocated, 1 used), CUDA 12.8, torch 2.11, Python 3.13.15.

**Runs:**
- **Run 1:** warm-up 2 epochs, 3 stages unfrozen, backbone learning rate 1e-4.
- **Run 2:** one bounded correction after run 1's validation fell once the backbone was unfrozen. Warm-up 3, 2 stages, learning rate 2e-5, ImageNet BatchNorm statistics frozen, patience counted after unfreezing.
- **Selection:** in both runs validation selected a projection-only checkpoint. Run 2 selected epoch 3, with 420 optimizer steps and **2 of 311 tensors changed** (the projection). Fine-tuning the backbone did update its weights, but never beat that checkpoint on validation.

| Held-out, photo → photo | R@1 | R@5 | R@10 | mAP | MRR |
|---|---|---|---|---|---|
| Known, frozen ImageNet baseline | 0.500 | 0.938 | 1.000 | 0.445 | 0.657 |
| **Known, run 2 (deployed)** | **0.625** | 0.875 | 1.000 | **0.672** | 0.749 |
| Unseen, baseline | 0.583 | 0.833 | 0.917 | 0.591 | 0.672 |
| Unseen, run 2 | 0.583 | 0.917 | 1.000 | 0.523 | 0.698 |

**Artifact:** `effb0-commons-v2`, embedding version `effb0-commons-v2-3224d2cc9e57`, SHA-256 `3224d2cc9e57fe00212e453e761ddf169d17ba7b20341bbeb4fa57b9a9e4d744`, safetensors, export parity 0.0.

**Serving parity:** serving under CPU torch 2.13 matches the torch 2.8 index vectors to ≤ 1.3×10⁻⁷ (cosine ≥ 0.9999999 over 40 images).

The artifact lives in `apps/ai-service/models/effb0-commons-v2/` (git-ignored).

## E. Real end-to-end retrieval (no mocks)

All 28 frozen queries went through Express → FastAPI → pgvector → Prisma, against the 206-product index whose gallery is the storefront illustrations. Every request returned 200. **QA and DEV give identical results.**

| | n | R@1 | R@5 | R@10 | p50 (QA / DEV) |
|---|---|---|---|---|---|
| Known products | 16 | 0.375 | 0.812 | 1.000 | 1.5 s / 3.6 s |
| Unseen products | 12 | 0.000 | 0.333 | 0.333 | 2.1 s / 3.6 s |

**CPU benchmark** (QA FastAPI, warm, real model + pgvector, local Core i7):

| Mode | Result |
|---|---|
| Sequential (30 requests) | p50 278 ms, p95 324 ms |
| Concurrency 2 | p50 397 ms, 0 rejected |
| Concurrency 4 | 4 served; 20 rejected immediately with 429 (the two-slot cap) |
| Private memory | 780 MiB idle, 828 MiB after load |

**Version safety:**
- Activating `effb0-commons-v1-4fc2273974ac` while the service ran v2 made readiness NOT_READY/INDEX_NOT_READY and the public search return 503.
- `rollback` restored READY and 200.
- An idempotent re-stage skipped all 412 images.
- Activation with no earlier version, or with an incomplete index, is refused.

**AI outage (QA, FastAPI stopped):**
- Photo search shows "unavailable right now".
- Text suggestions, the category page and `/api/health` keep working (Playwright).
- Recovery after restarting the service was verified.

## F. Database

| Environment | Action | Evidence |
|---|---|---|
| Disposable QA (pgvector container, `localhost:55434/electrohub_disposable`) | Clean migrate (21 migrations), base seed, catalog expansion, roles, ingest, activate, rollback | `migrate status` up to date; `prisma migrate diff` shows nothing for `ai`/`vector` (only older auth-table default differences); **19/19 role checks pass** |
| DEV `pzxekjybdiulzmssalfo` (**owner-approved in chat**) | `migrate deploy` (this migration only), role LOGIN with generated passwords (git-ignored `.ai-vector/dev.json`), ingest 412/412, activate | Read-only before and after: pgvector 0.8.2; `anon` and `authenticated` have no `ai` usage; the reader has no `users` access; the ingester has no `products` UPDATE |
| PROD `yepfgjehdstlxbpespun` | **Read-only only** (owner-approved scope) | Only `20261024000000_ai_vector_search` is pending; pgvector 0.8.2 is available but not installed; no `ai` schema. **Nothing applied** |

## G. Verification commands (executed)

**AI service**, in short-path venv `C:\Users\ouss0\.venvs\electrohub-ai`, torch 2.13:
- `pytest`: 220 passed, 1 skipped (the DB integration test needs `AI_TEST_VECTOR_DATABASE_URL`).
- Training tests: 7 passed.
- `ruff`: clean. `mypy --strict`: 38 files clean. `pip check`: clean.
- `pip-audit`: no known vulnerabilities for the runtime set, plus torch 2.13.0 and torchvision 0.28.0 audited under their PyPI names. Torch was upgraded from 2.8.0, which had PYSEC advisories.

**Backend:**
- Typecheck, lint and build: pass.
- Image-search and AI suites: 181/181.
- Development-runtime route: 11/11.
- Full suite against pgvector QA: 1,613 passed and 9 failed, none in Task 04.2 code:
  - Admin-login tests expect the CI seed password; the isolated seed uses random passwords.
  - `db-request-metrics` builds a client that doesn't trust the QA CA.
  - Logging and catalog-expansion timeouts happened under load, and pass when rerun alone.

**Frontend:**
- Typecheck, lint and build: pass.
- Unit tests: **895/895**.
- Real-stack Playwright `discovery-image`: header and Ctrl+K on Home, Products and a product page; held-out photo returns real products at 1440 and 390 px; AI outage. All pass.
- `catalog-storefront`: 6/6, including the regression check of the refactored product-search SQL.

**Docker:** built and smoke-tested in WSL. See section J.

**Visual review** (screenshots opened and inspected): results at 1440 and 390 px (two defects found and fixed), AI-down at 1440, and the console at 1440 on QA and on DEV (`:3300`, live suggestions).

## H. Acceptance matrix

**Repository, scope and catalog**

| ID | Status | Evidence |
|---|---|---|
| T42-01 | PASS | A, git status |
| T42-02 | PASS | 04.1 tests kept passing; auth-before-body and error envelope unchanged |
| T42-03 | PASS | C: 206 visible products (DEV and QA) |
| T42-04 | PASS | 16 categories from the API; fixtures excluded by the visibility predicate |
| T42-05 | PASS | C: illustrations are never in training or test |

**Dataset**

| ID | Status | Evidence |
|---|---|---|
| T42-06 | PASS | Per-file licence and provenance ledger; owner approved the Kaggle upload in chat |
| T42-07 | PASS | Manual review, with variant and appearance families |
| T42-08 | PASS | Decode, EXIF orientation, SHA-256 |
| T42-09 | PASS | pHash, SHA and session groups |
| T42-10 | PASS | `split_audit.json` passed |
| T42-11 | PASS | Unseen-product split (8 families) |
| T42-12 | PASS | `dataset_report.json` protocol per family |
| T42-13 | PASS | Packager refuses secret-like names; private dataset |

**Training and evaluation**

| ID | Status | Evidence |
|---|---|---|
| T42-14 | PASS | Kaggle T4 run 1 and run 2, `environment.json` |
| T42-15 | PASS | `environment.json`, `requirements-training.txt` |
| T42-16 | PASS | `baseline.json` |
| T42-17 | PASS | SupCon loss and P×K sampler, with tests |
| T42-18 | **PARTIAL** | Projection weights changed in the selected checkpoint; backbone fine-tuning ran but was not selected (see D) |
| T42-19 | PASS | Validation-only selection |
| T42-20 | PASS | D, E |
| T42-21 | PASS | D (family relevance) |
| T42-22 | PASS | Per-category, failure lists, known vs unseen |
| T42-23 | PASS | Regressions reported (unseen mAP, R@5) |
| T42-24 | PASS | Safetensors, SHA-256 |
| T42-25 | PASS | Descriptor plus shared `preprocess_image` |
| T42-26 | PASS | E benchmark |

**Database**

| ID | Status | Evidence |
|---|---|---|
| T42-27 | PASS | Additive migration; no duplicate catalog models |
| T42-28 | PASS | Clean QA migrate, pgvector 0.8.0 |
| T42-29 | PASS | Dimension check, norm CHECK, SHA, finite checks in the gateway |
| T42-30 | PASS | 19/19 role checks |
| T42-31 | PASS | Same |
| T42-32 | PASS | Re-stage skipped 412; per-batch commit |
| T42-33 | PASS | 412/412 images, 206/206 products |
| T42-34 | PASS | Mismatch demo |
| T42-35 | PASS | Activation and rollback demo |
| T42-36 | PASS | Exact search grouped by product; no HNSW (justified) |
| T42-37 | PASS | DEV after explicit approval |
| T42-38 | PASS | PROD read-only only |

**FastAPI and Express**

| ID | Status | Evidence |
|---|---|---|
| T42-39 | PASS | Loader tests; loaded once in lifespan |
| T42-40 | PASS | Decoder tests |
| T42-41 | PASS | 401/403 tests before the body is read |
| T42-42 | PASS | E |
| T42-43 | PASS | Readiness and capabilities with versions |
| T42-44 | PASS | Concurrency and timeout tests plus benchmark |
| T42-45 | PASS | Upload and rate-limit tests |
| T42-46 | PASS | Client tests: no cookies or JWT forwarded |
| T42-47 | PASS | Resolution tests |
| T42-48 | PASS | Playwright checks product detail prices equal the result prices |
| T42-49 | PASS | AI-down Playwright |

**Frontend**

| ID | Status | Evidence |
|---|---|---|
| T42-50 | PASS | A plus screenshots |
| T42-51 | PASS | Playwright |
| T42-52 | PASS | `catalog-storefront` 6/6 |
| T42-53 | PASS | Unit tests (select, preview, replace, remove, cancel; paste/drop handlers) and Playwright upload |
| T42-54 | **PARTIAL** | Camera denial, track cleanup and the video-only request are unit-tested; real-device capture was not exercised (no camera in this environment) |
| T42-55 | PASS | Real-model results and outage, Playwright and screenshots |
| T42-56 | **PARTIAL** | 1440/390 inspected, a11y name fixed, reduced motion used in specs; 320/768/1024/1920, 200% zoom and screen-reader runs not separately captured for the image flow in this pass |
| T42-57 | PASS | Memory storage only; no bytes in logs (telemetry tests); keys never printed |

**Quality gates and handoff**

| ID | Status | Evidence |
|---|---|---|
| T42-58 | PASS | All gates pass; Docker build and model smoke (J) |
| T42-59 | PASS | G |
| T42-60 | PASS | This file |

## I. Material limitations (actionable)

1. **Exact-product accuracy is modest.** Live photo→catalog Recall@1 is 0.375 for known products and 0.0 for unseen ones, because the catalog images are AI illustrations and Commons covers only 96 of 206 SKUs. The highest-value next step is real product photography for catalog images, which belongs with Task 04.3 image management.
2. **The backbone isn't fine-tuned in the deployed checkpoint.** It needs more independent real photos per family than Commons provides. This was reported rather than forced.
3. **DEV latency** (p50 3.6 s) is dominated by Supabase round-trips over this connection. It's within the 8 s timeout, and PROD latency is not measured.
4. **Windows MAX_PATH.** The torch 2.13 wheel can't install inside this repository's long path, so local runs use `C:\Users\ouss0\.venvs\electrohub-ai` (`AI_SERVICE_PYTHON`). Docker and CI on Linux are unaffected.
5. **Your own DEV servers aren't configured for photo search.** To enable it on `:3000`, set these in the git-ignored env files:
   - `AI_MODEL_ARTIFACT_DIR=apps/ai-service/models/effb0-commons-v2`.
   - `AI_VECTOR_DATABASE_URL`: the reader DSN from `.ai-vector/dev.json` (or use the `ai-service-dev-readonly` launch config).
   - Backend `AI_SERVICE_URL`.
   - Frontend `VITE_IMAGE_SEARCH_ENABLED=true`.
6. **Kaggle credential location.** The Kaggle token lives in `apps/ai-service/.env`, the service's runtime env. Move it to `~/.kaggle` or a training-only env file.
7. **PROD apply** needs the protected PROD migration gate: the same reviewed SQL plus role logins and ingestion. Not done.

## J. Docker (WSL Docker 29.1.3)

**Image:** `electrohub-ai:task-04.2` (`sha256:137820e0…`). Python 3.11.13-slim, `torch==2.13.0+cpu` from the CPU index, built with `--no-deps` and `pip check` passing. 328 MB, user `app`.

**Container smoke** (`--read-only`, model mounted `:ro`, environment `qa`, read-only vector role over TLS to the QA pgvector container):

| Check | Result |
|---|---|
| `/health` | healthy |
| `/internal/v1/ready` | imageSearch READY, `effb0-commons-v2-3224d2cc9e57` |
| Real search | PS5 ranked #1 (score 0.883) |
| No key | 401 |
| Writes to `/srv/ai-models` and `/srv/ai-service` | Refused (read-only) |
| Database URL or key in container logs | 0 lines |

**Defect found by this smoke:** the first build crashed at import because `safetensors.torch` imports `packaging`, which wasn't in the `--no-deps` runtime set (local environments had it from other tools). Fixed by pinning `packaging==25.0` in `requirements-runtime.txt`, then rebuilt and re-smoked.

## K. Engineer self-review

**Score: 85/100.** The pipeline is real end to end and measured:
- A licensed, leakage-audited dataset.
- Real GPU training with an honest baseline.
- A safe artifact.
- Least-privilege pgvector in QA and DEV, with version safety and rollback.
- A secure gateway and resilient UI, plus two real UI defects found and fixed in browser review.

Points are lost for:
- A thin dataset and modest live accuracy.
- A backbone that was not selected.
- Incomplete viewport, zoom and camera device coverage.
- A runtime packaging defect that only the container smoke caught (now fixed).

**Recommendation: READY FOR ARCHITECT REVIEW**, with the limitations in I disclosed. Nothing is committed.
