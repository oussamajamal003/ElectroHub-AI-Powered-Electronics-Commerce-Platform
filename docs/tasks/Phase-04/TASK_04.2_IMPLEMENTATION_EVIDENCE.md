# Task 04.2 — Implementation Evidence

**Branch** `feature/04.2-Real-Vision-Search-Integration`. Current local HEAD and local `origin/feature/04.2-Real-Vision-Search-Integration` tracking ref: `5b62f75c5eae5b0b754360f7f228e0629baa0e6e`; `origin/develop`: `255cb9d2d898d374b597cdefb3d972747c547f6c`. Closure edits in the primary checkout are uncommitted. **No commit, push, merge or deploy.**

**Worktrees:**
- The main checkout (this task).
- `.claude/worktrees/discovery-console`: clean, separate branch.
- `.claude/worktrees/serene-edison-5a7d3e`: has unrelated checkout E2E edits; untouched.
- `C:\Users\ouss0\electrohub-release`: not inspected or changed because its repository has different Windows ownership.

**Prepared** 2026-10-25. Every result below comes from a command or run that was actually executed. Items not verified are marked as such.

## A. Historical console visibility issue (superseded by current browser QA)

The earlier stale-tab issue is historical. This closure pass tested the current feature branch and existing console in the isolated QA stack; see section L for current navigation, interaction and responsive results.

## B. What was built

| Area | Change |
|---|---|
| Dataset (Commons only) | `training/data/{catalog_snapshot,commons_collect,review_sheets,build_dataset}.py`. Uses the MediaWiki API (POST, ≤ 1 request/s), records per-file licence and provenance, auto-rejects bad candidates, then manual visual review. Photos are grouped into capture groups by SHA-256/pHash and same creator-day sessions, with creator-disjoint splits and a leakage audit. Dataset, photos and attributions are git-ignored. |
| Training | `training/src/{data,losses,metrics,train,export}.py`. Supervised-contrastive loss with a P×K sampler; frozen baseline first; validation-only selection; weight-delta logging; safetensors export with a parity check. `build_kaggle.py` packages a PRIVATE dataset plus a kernel; `kaggle_cli.py` passes only `KAGGLE_*` values. |
| Shared network | `app/models/embedding_network.py`: EfficientNet-B0 + Linear(1280→256) + L2 norm, and `preprocess_image` (`effb0-rgb-r256-c224-imagenet-v1`). Training, ingestion and serving all use it, so preprocessing cannot drift. |
| pgvector | Migration `20261024000000_ai_vector_search` (additive `ai` schema, 2 NOLOGIN roles). `app/ingest` CLI with stage/activate/rollback/status. Docs: `docs/06_Database/AI_VECTOR_INDEX.md`. |
| FastAPI (Haiku subagent W4, lead-fixed and reviewed) | Safetensors loader that checks SHA-256 before load; magic-byte decoder with bomb, frame and side limits; read-only pgvector gateway with an exact cosine search grouped by product; bounded in-memory multipart route; 8 MiB limit on that route only; readiness re-checked on each probe; index self-heal on the search path (throttled to 5 s); selector event loop on Windows; `AI_ENV_FILE`. |
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

**AI service**, in short-path venv `C:\Users\ouss0\.venvs\electrohub-ai`, torch 2.13 (recorded before the switch; local runs now use the repo venv `apps/ai-service/venv`):
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
| T42-18 | **OWNER-APPROVED SCOPE EXCEPTION — PENDING FINAL ARCHITECT VERIFICATION** | Backbone fine-tuning was attempted; validation selected the pretrained frozen backbone plus trained 256-D projection. See D and L. |
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
| T42-31 | PASS (QA) / PENDING AUTHORIZATION (DEV) | Database staging guard tested in disposable QA; shared DEV forward migration not applied. See L. |
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
| T42-54 | **PARTIAL** | Chromium virtual-camera capture, retake and track cleanup passed; physical-device camera was unavailable. |
| T42-55 | PASS | Real-model results and outage, Playwright and screenshots |
| T42-56 | **PARTIAL** | Image flow checked at 320/390/768/1024/1440/1920, keyboard focus/Escape and reduced motion; 200% equivalent Chromium reflow passed. Physical browser zoom and assistive screen-reader runs were not available. |
| T42-57 | PASS | Memory storage only; no bytes in logs (telemetry tests); keys never printed |

**Quality gates and handoff**

| ID | Status | Evidence |
|---|---|---|
| T42-58 | **PARTIAL** | Affected feature gates and read-only Docker model/upload smoke pass; backend full suite had five environment/non-feature failures recorded in L. |
| T42-59 | **PARTIAL** | Historical counts in G are superseded by final closure runs and outcome in L. |
| T42-60 | PASS | This evidence file was updated for final handoff in L. |

## I. Material limitations (actionable)

1. **Exact-product accuracy is modest.** Live photo→catalog Recall@1 is 0.375 for known products and 0.0 for unseen ones, because the catalog images are AI illustrations and Commons covers only 96 of 206 SKUs. The highest-value next step is real product photography for catalog images, which belongs with Task 04.3 image management.
2. **The backbone isn't fine-tuned in the deployed checkpoint.** It needs more independent real photos per family than Commons provides. This was reported rather than forced.
3. **DEV latency** (p50 3.6 s) is dominated by Supabase round-trips over this connection. It's within the 8 s timeout, and PROD latency is not measured.
4. **Windows MAX_PATH.** The torch 2.13 wheel needs Windows long-path support to install inside this repository. With it enabled, every local run uses the repo venv `apps/ai-service/venv`. Docker and CI on Linux are unaffected.
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

## K. Historical pre-closure engineer self-review (superseded by L)

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

## L. Final blocker-closure evidence (2026-10-25)

This section supersedes earlier environment/status and test summaries above. The primary checkout remains at local HEAD `5b62f75c5eae5b0b754360f7f228e0629baa0e6e` with closure changes uncommitted; its local tracking ref matches. The final effective diff comprises 34 modified tracked files and 11 untracked files (including the forward migration and focused tests); `git diff --check` is clean. No commit, push, merge, deploy, PROD operation, or shared DEV write was performed. A separate checkout worktree has unrelated checkout E2E modifications and was left untouched. The release checkout was not accessed because its Windows ownership differs.

### Findings and implementation

| Finding | Closure and evidence |
|---|---|
| F-01 | **CLOSED / unchanged.** The existing GitHub workflow uses `pgvector/pgvector:0.8.0-pg17`; the last verified feature HEAD had all 12 CI/Security checks passing. No CI rebuild or new remote run was performed. |
| F-02 | `app/api/routes/image_search.py` uses a request-scoped bounded in-memory parser; auth/readiness still precede body reads, file bytes are capped before writes, and handles close on complete/error/disconnect/cancel. The Docker runtime sets `TMPDIR=/dev/shm` (Docker-bounded tmpfs); the parser never rolls uploads to disk. Real read-only/non-root runtime smoke: JPEG/PNG/WebP at 2,097,152 and 8,387,584 bytes all returned 200; oversize, unsupported/malformed, wrong/multiple fields, missing authentication and temporary-file checks passed (**13 checks**). Python tests specifically forbid `SpooledTemporaryFile.rollover` and verify cleanup for complete, malformed, disconnect and cancellation paths. The already-built image was smoke-tested with the same `TMPDIR` runtime setting; a rebuild attempt after adding the Dockerfile default could not complete because Docker reported no space during the 191.8 MB torch download. |
| F-03 | **CLOSED IN QA; DEV APPLY PENDING FRESH AUTHORIZATION.** New forward migration `20261025000000_ai_vector_staging_guard`; historical `20261024000000_ai_vector_search` unchanged (SHA-256 `5fc41c43d238de3b62850c1f7aa24f4fe37a619ce3267a18dac373f59632ffa7`). Fresh disposable DB replay plus staging eligibility, forbidden statuses, both activation lock interleavings, rollback and catalog cascades: **15/15**. QA role verification: **21/21**. Current QA has 22 migrations, existing v2 index preserved. Read-only Supabase DEV checks confirm the original migration is applied and the index remains 412/206 at v2; the new guard is not applied there. No DEV write was made. |
| F-04 | `scripts/ai-vector-dev.cjs` now uses verified CA and hostname checks through `scripts/lib/ai-vector-dev-security.cjs`, retains DEV identity and PROD refusal/approval gates, and emits no credentials/DSNs. Controlled real handshakes: approved CA/hostname accepted; untrusted CA and wrong hostname rejected. No DEV mutation or privileged DEV connection was run. |
| F-05 | Express upload admission/deadline/lifecycle in `src/middleware/imageSearchAdmission.ts`, before multipart parsing; capacity 4, 10 s upload deadline, 25 s total request deadline, separate from the 8 s AI inference timeout. Cleanup covers success, invalid/oversize, disconnect/abort, parser failure, timeout and downstream errors. Focused admission/telemetry/route tests: **48/48**. |
| F-06 | `scripts/dev-isolated.cjs` publishes the QA port only on `127.0.0.1:55434`; actual container inspection showed that address. Loopback connection/TLS identity passed; LAN and WSL-host interface probes timed out. No DEV/PROD network exposure changed. |
| F-07 | Existing console completed; `DiscoveryImageMode.tsx`, `DiscoveryCamera.tsx`, status ownership and `SearchPage`/`SearchField` submit race were corrected. Image-specific real-stack Playwright: **6/6**; includes all six widths (320, 390, 768, 1024, 1440, 1920), real held-out image through Express/FastAPI/pgvector/Prisma, current product prices/detail links, paste/drop, explicit submit, errors/no-results, virtual camera capture/retake/track cleanup, denial fallback, focus/Escape, reduced motion and 200%-equivalent 720×500 CSS reflow. AI outage: **1/1**, ordinary text and catalog remained available. Separate search/filter/navigation viewport checks after the submit fix: **4/4** at 390/768/1440/1920. Screenshots at 320/768/1440 and 200%-equivalent camera-denial state were opened and visually inspected; filenames are listed below. Physical camera, physical browser zoom and assistive screen-reader operation were not available. |
| F-08 | **OWNER-APPROVED SCOPE EXCEPTION — PENDING FINAL ARCHITECT VERIFICATION.** No training, artifact, embedding-version or index changes. The deployed v2 remains pretrained frozen EfficientNet-B0 backbone + genuinely trained 256-D projection; backbone fine-tuning was attempted, but validation selected projection-only. Known photo Recall@1 improved `0.500 → 0.625`; live catalog Recall@1 remains `0.375` known / `0.000` unseen. Describe only as real learned visual similarity search, not exact-SKU recognition or a fine-tuned deployed backbone. |

### Observability, credentials and tests

Express emits structured allowlisted `image_search.lifecycle` outcomes with QA environment, correlation ID, safe status/outcome, bounded active-request count, upload and total duration. Actual disposable QA logs showed `admitted → parsed → completed` (200) and `upstream_unavailable` (503); no filenames, image bytes, vectors, auth, or arbitrary labels. AI phase logs carry fixed phase names (`decode`, `encode`, `inference`, `retrieval`), safe model/index versions and durations. For request `ccb9176a-da0e-48b0-a8f7-545b848f6e1b`, observed QA phase times: decode 30.10 ms, encode 120.49 ms, inference 152.20 ms, retrieval 23.42 ms. Logger failures are fail-safe-tested.

Kaggle credential presence was inspected without printing its value: removed from ignored `apps/ai-service/.env`, moved to ignored training-only `training/.data/kaggle.env`; serving config rejects inherited `KAGGLE_*`, and `.dockerignore` excludes `training/`. Training credential isolation tests: **9 passed** with the training suite. No secret was added to Git.

Final frontend unit suite after the search submit correction: **109 files, 907 tests passed**. Frontend build/typecheck and lint passed; build emitted only the existing >500 kB chunk advisory. Backend affected full suite did run once: **1,596 passed, 101 skipped, 5 failed**. The five were outside Task 04.2 feature tests: disposable metrics CA chain mismatch, runtime bridge assertion under the globally set QA launcher flag (that route file passed separately 15/15 with wishlist), a wishlist timeout under suite load, and two payment tests that require a test-mode credential but were intentionally given no Stripe key. Focused Task 04.2 Express tests passed 48/48. The broad inherited Search Playwright file ran 18 scenarios before the final keyboard correction: 13 passed/5 failed; the query-submit cases were corrected and the four real search viewport scenarios passed after the correction. Three other inherited cases remain non-green (stale-refetch request-count expectation, an aborted large ordinary-search response, and a 40 px control-height expectation against the rendered 56 px shared input). The image-specific suite and focused search viewport suite are green; these broader results are not represented as full-suite passes.

AI service final evidence: full Python tests **238 passed, 1 skipped** (optional DB URL absent); strict mypy **56 files passed**; Ruff **58 files clean**; training tests **9 passed**. Root/backend typecheck, lint and build passed earlier in this closure. Frontend final build/typecheck, lint and unit results are recorded above.

### Environment, model and visual evidence

- Shared DEV: read-only verified original migration applied, index v2 412 images/206 products; forward guard **pending fresh scoped owner approval**. PROD remains read-only/unmodified. Disposable QA forward guard and local browser/API QA only.
- Current artifact SHA-256 `3224d2cc9e57fe00212e453e761ddf169d17ba7b20341bbeb4fa57b9a9e4d744`, embedding version `effb0-commons-v2-3224d2cc9e57`; no reindex or promotion.
- Physical 200% browser zoom and screen-reader operation are not claimed. Chromium reflow equivalent, keyboard behavior and status-region semantics were checked. No physical camera was present; capture used Chromium virtual-device facilities.
- Inspected screenshots: `apps/frontend/playwright-report/task04-closure/discovery-results-320.png`, `discovery-results-768.png`, `discovery-results-1440.png`, and `discovery-zoom200-camera-denied.png`. AI outage screenshot: `discovery-ai-down-1440.png`.

### Remaining owner/Architect gates

1. Apply the reviewed forward staging-guard migration to shared DEV only after fresh scoped owner approval; QA proves the migration, but DEV intentionally remains without the guard until that gate.
2. Independent Architect verification of the existing training evidence and owner-approved T42-18 exception.
3. Review the non-Task-04.2 broad-suite/environment failures listed above; they are preserved as failures, not waived or counted as feature passes.

**Recommendation: READY FOR ARCHITECT REVIEW**, with the limitations in I disclosed. The initial closure report predates the commit; see the push CI update below.

## M. Final integration and database preflight (2026-10-25)

This is the latest read-only integration/database status and supersedes earlier branch and environment statements above. The feature branch is at `ff911b6209d0696a532e5e3ce54f4d4a35a432cf`, matching `origin/feature/04.2-Real-Vision-Search-Integration`; `origin/develop` is `255cb9d2d898d374b597cdefb3d972747c547f6c`. The primary worktree had only the two prior documentation edits before this closure correction. The branch is 10 commits ahead of develop (merge base is develop); its three-dot diff is 109 files, +8,359/-189. The read-only merge preview showed no conflict markers; writing a merge tree was denied by the checkout's read-only Git object database, and no merge was performed. `git diff --check` reports trailing whitespace in the new task specification's Markdown hard-break lines. One prior commit in the feature range also changes three checkout recovery files and the CI test timeout; these are outside Task 04.2 and remain in the prepared branch diff pending integration-owner disposition. Other worktrees, including the dirty checkout E2E worktree, were left untouched. The current database-checker and workflow changes below are local and uncommitted; no new commit, push, merge, or deployment was performed.

### Read-only database preflight

| Environment | Verified identity and ledger | Migration/index state | Operation status |
|---|---|---|---|
| DEV | Supabase project `electrohub-dev`, ref `pzxekjybdiulzmssalfo`, `ap-northeast-2`; 21 finished rows, zero unfinished/rolled-back. Original `20261024000000_ai_vector_search` checksum matches canonical source. | Only `20261025000000_ai_vector_staging_guard` is pending. The staging trigger is absent. Active v2 remains `effb0-commons-v2-3224d2cc9e57`: 412 images / 206 products. Ingestion has no public table privileges; reader is SELECT-only on embeddings. | Owner authorized the guard on 2026-10-25. **Not applied.** Byte proof shows payment-ownership ledger hash equals the deterministic CRLF transform of canonical Git SQL. A narrowly pinned reconciliation is implemented locally and its focused tests pass. The remote workflow commit still has the old strict check; local GitHub CLI authentication is invalid and the GitHub connector has no dispatch operation. No direct DB shortcut was used. |
| PROD | Supabase project `electrohub`, ref `yepfgjehdstlxbpespun`, `ap-northeast-1`; 20 finished rows, zero unfinished/rolled-back. | Two migrations are pending in order: `20261024000000_ai_vector_search`, then `20261025000000_ai_vector_staging_guard`. `vector` 0.8.2 is available but not installed; no `ai` schema or trigger exists. Public schema matches Prisma at 30 tables / 330 columns. | Not touched. Email-OTP and payment-ownership hashes are exactly verified CRLF variants. Foundation checksum `5de060a3…` matches neither Git LF nor deterministic CRLF and is absent from reachable Git history; backup/PITR is unverified. A protected PROD workflow draft exists only locally and is uncommitted; remote environment approvals/secrets are not established by this pass. |

PROD checksum review compared exact bytes from live ledger entries, the current working copies, the canonical Git blobs and the deterministic CRLF transformations. For `20261012120000_payment_purchase_ownership`, DEV and PROD ledger `0cf4bc6b88a2222b47e691100364b0e961b5bb20b61149dfb759b651ef177ff8` equals the working-tree CRLF hash and the CRLF transform of canonical Git blob `a45372e2e25895345b7499e6d7d82b852e75a1a5e29b03b8b1fcf53a0f8cc310`; stripping CRLF restores the Git blob byte-for-byte (10 line endings). For PROD `20240103000000_email_otp_foundation`, ledger `ba99562ff2a870230d15990e107b59610f0aabc08678c342bc5509d9e45ad524` equals the CRLF transform of canonical Git blob `e1a2b518c6d52b04211d2b078412794d2754b27016432028e87f7450f915b241`; normalized bytes match exactly (84 line endings). These two cases are narrowly reconciled by `.github/scripts/migration-plan.cjs`, which pins each migration name plus its canonical and CRLF SHA-256 and rejects any other content/checksum combination.

For `20240101000000_database_foundation`, PROD ledger `5de060a305af86bbc70d683ebe3bea1fe35c1c6454c048cbeed07d22fe347f96` matches neither the sole reachable Git blob (`cb2baf5e79d8127f31fa9873c5e2cfd28b159f7a375d8d4d2856dd8766b5fd17`) nor its exact CRLF transform (`a41f086f7f9dc2f67621622a77f3e716027285e015991db470e8ab7bed1314a8`). The PROD row remains unresolved and blocks deployment; only trustworthy historical deployment evidence or a formal DBA-controlled reconciliation can clear it. No historical SQL was changed, no ledger row was modified, and the checker does not accept this mismatch.

**PROD execution remains blocked and was not dispatched:** reconcile the unmatched foundation checksum, verify a current backup/PITR restore point and tested recovery path, and establish the protected `electrohub-prod-database` environment with database-owner/release reviewers and PROD-only secrets. A workflow draft now exists locally at `.github/workflows/prod-migration.yml`, but is not on the remote branch and its GitHub Environment protection settings are unverified. The exact order remains `20261024000000_ai_vector_search` then `20261025000000_ai_vector_staging_guard` via Prisma after all gates pass; no migration command was run.

The protected DEV workflow on remote HEAD `ff911b6209d0696a532e5e3ce54f4d4a35a432cf` still has the old strict checksum check; the locally corrected checker is uncommitted. The owner authorization is present, but this session cannot publish the reviewed checker or dispatch GitHub Actions (CLI credential invalid; connected GitHub tool is read-only). No direct migration alternative was used. Existing disposable QA evidence remains the verification for the forward guard: clean replay, staging-only/forbidden-status checks, activation interleavings, rollback, catalog deletion, and reader/ingestion role isolation (15/15 migration cases; 21/21 role cases). No shared DEV or PROD write, manual migration-ledger edit, reindex, or model change occurred. `prisma migrate status` outcomes are **NOT RUN** for both shared environments; current migration state above comes from read-only inspection of the live Prisma ledgers.

### Integration and remaining gates

- Existing Development CI run `40201536886` passed all 11 jobs and Security Audit run `40201536943` passed on `ff911b6`; no new CI run or remote ref change was made in this pass.
- Code integration is architect-approved at 94/100 per owner-provided assessment. Actual merge remains pending explicit integration-owner authorization. Review whether the three checkout recovery files and test-timeout change should remain in the integration diff.
- DEV guard application awaits publishing the byte-pinned checker through an owner-authorized GitHub commit/push, then dispatching the existing workflow and completing its environment review. The local GitHub credentials do not currently allow dispatch. PROD remains read-only; resolve the unmatched foundation checksum, prove backup/PITR/recovery, and configure the protected PROD workflow/environment before execution.
- Model state, v2 artifact and index remain unchanged under the owner-approved T42-18 scope exception, pending final Architect verification. Existing simulated camera/responsive/keyboard accessibility QA is retained; physical camera, physical zoom, and assistive screen-reader testing remain disclosed limitations.
- Ordinary-search aborted-response behavior was not reproduced in this pass and was not changed.

### Migration blocker closure re-verification (2026-10-25)

Independently re-reproduced byte-for-byte (Python, `git cat-file blob HEAD:<path>` vs working tree): `20261012120000_payment_purchase_ownership` Git blob is 748 bytes, 10 LF, 0 CRLF, SHA-256 `a45372e2…`; the Windows working copy is 758 bytes, 10 CRLF, SHA-256 `0cf4bc6b…` (the DEV/PROD ledger value). LF-normalizing the working copy restores the blob exactly; the extra 10 bytes are the 10 CR characters. `20240103000000_email_otp_foundation` shows the same pattern (3113 vs 3197 bytes, 84 line endings, `e1a2b518…` vs `ba99562f…`). Cause: no `.gitattributes` rule for these files plus Windows `core.autocrlf=true` when the migrations were first deployed. Linux CI checkouts are LF, so only the pinned reconciliation can reconcile them. Re-run locally: `node --test .github/scripts/ci-safety.test.cjs` 13/13 pass; workflow policy check OK.

Status unchanged by this pass: **DEV 21/22 and PROD 20/22 - 22/22 NOT reached.** No database operation, workflow dispatch, push, or merge was performed. DEV needs the reconciled checker and `dev-migration.yml` published to the remote commit (needs explicit push authorization), then dispatch with the Environment reviewers. PROD still has the unmatched foundation checksum `5de060a3…` (no trustworthy historical evidence found), unverified backup/PITR and restore drill, and an unconfigured `electrohub-prod-database` Environment.

### Push CI update (2026-10-25)

Commit `7553e5fdb970883b571ad6230d1da5d63eb8538e` was pushed to the feature branch. Its Security Audit passed. Its Development CI passed backend tests/build/typecheck/lint and frontend build/typecheck/lint/tests plus migration safety policy; AI Service / Test exposed Ruff findings in the new Docker upload smoke, fixed in `faf80b0b5903d99d51dd1caabd7fb3a3606420f3`. That follow-up passed Ruff, format, mypy, Python tests and dependency audit. AI Service / Docker failed because `TMPDIR=/dev/shm` was set before build-time dependency installation; pip exhausted the small tmpfs at 62.5 MB of the 191.8 MB PyTorch wheel. Commit `343a57c207dfffdfff61977174c7aefdf299ddc7` moves the runtime tmpdir setting after installation. On that commit, Development CI run [40201187493](https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/actions/runs/40201187493) passed all 11 jobs, including AI Service / Docker and container smoke; Security Audit run [40201187506](https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/actions/runs/40201187506) passed. The intermediate `faf80b0` run's backend test was cancelled when the newer push superseded it; the final `343a57c` run completed successfully.
