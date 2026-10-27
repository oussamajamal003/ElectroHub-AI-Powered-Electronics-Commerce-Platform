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

### Migration tooling correction (2026-10-25)

**Supersedes** every statement above that the reconciliation checker, `dev-migration.yml` or `prod-migration.yml` is local/uncommitted or absent from the remote: they were pushed in `8adb9cc` (and are corrected by the commit recorded below). Development CI run `40207521980` on `8adb9cc` failed 1/13 migration-safety tests: the live payment-SQL test asserted Windows CRLF working-tree bytes, while Linux checks out canonical LF. The test now accepts either checkout form: the Git blob must hash to the pinned canonical SHA-256 `a45372e2...`, its CRLF transform to the pinned `0cf4bc6b...`, and the working copy must be exactly LF or CRLF and hash to the matching pinned value. Content or checksum changes are still rejected (unit cases unchanged). Local: `node --test .github/scripts/ci-safety.test.cjs` 13/13 and the workflow policy check pass on the CRLF checkout; the payment test also passes on a simulated LF export. Final pushed HEAD and CI result: see the CI line appended below.

DEV remains 21/22 until the protected workflow is dispatched through GitHub Actions with Environment review. PROD remains blocked (unmatched foundation checksum, unverified backup/PITR and restore drill, unverified protected environment; `prod-migration.yml` must also reach the default branch `develop` via an owner-approved action before it can be dispatched). No merge, direct SQL or ledger edit occurred.

### Push CI update (2026-10-25)

Commit `7553e5fdb970883b571ad6230d1da5d63eb8538e` was pushed to the feature branch. Its Security Audit passed. Its Development CI passed backend tests/build/typecheck/lint and frontend build/typecheck/lint/tests plus migration safety policy; AI Service / Test exposed Ruff findings in the new Docker upload smoke, fixed in `faf80b0b5903d99d51dd1caabd7fb3a3606420f3`. That follow-up passed Ruff, format, mypy, Python tests and dependency audit. AI Service / Docker failed because `TMPDIR=/dev/shm` was set before build-time dependency installation; pip exhausted the small tmpfs at 62.5 MB of the 191.8 MB PyTorch wheel. Commit `343a57c207dfffdfff61977174c7aefdf299ddc7` moves the runtime tmpdir setting after installation. On that commit, Development CI run [40201187493](https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/actions/runs/40201187493) passed all 11 jobs, including AI Service / Docker and container smoke; Security Audit run [40201187506](https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/actions/runs/40201187506) passed. The intermediate `faf80b0` run's backend test was cancelled when the newer push superseded it; the final `343a57c` run completed successfully.

### Final status: HEAD `cc37d88`, DEV deployment, PROD blocked (2026-10-25)

**Status: APPLICATION APPROVED / DATABASE ROLLOUT PENDING** (DEV complete; PROD not deployed).

- **Reviewed HEAD** `cc37d88b5ba7955f127b01419cabf5880e8bb044`. Development CI run `40208208588`: SUCCESS on attempt 2. Security Audit run `40208208446`: SUCCESS. The Linux LF/CRLF payment-SQL regression is fixed. Attempt 1 failed one unrelated frontend test (`CheckoutPage.test.tsx` "replaces setup loading with one actionable retry after a sanitized setup failure"; no frontend change in the range); it passed on rerun, so intermittent behavior is disclosed, not diagnosed.
- **DEV `pzxekjybdiulzmssalfo`: 22/22.** `dev-migration.yml` run [40209898767](https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/actions/runs/40209898767) (workflow_dispatch at `cc37d88`, approved_migrations `20261025000000_ai_vector_staging_guard`): pre-check passed (21 ledger rows; line-ending-only checksum for payment-ownership verified), `prisma migrate deploy` applied only the guard, `prisma migrate status` reported "Database schema is up to date!" (22 migrations), post-check passed (22 ledger rows, none pending). **Disclosure:** the run started without a reviewer pause - the GitHub API shows `electrohub-dev-database` has no protection rules (no required reviewers, no branch policy), so the "required reviewers" control described in the workflow header is NOT enforced in GitHub settings. Reliance was on the owner's documented authorization (section M); the Environment should be given required reviewers.
- **Independent read-only DEV verification** (SQL SELECTs only): 22 finished ledger rows, 0 unfinished/rolled back, last `20261025000000_ai_vector_staging_guard`; pgvector 0.8.2; triggers enabled (`O`) on `ai.product_image_embeddings` (`embeddings_staging_only`) and `ai.model_versions` (`model_versions_insert_staging`, `model_versions_immutable`); active index still `effb0-commons-v2-3224d2cc9e57` (activated 2026-10-24), 412 embeddings / 412 catalog images; `ai_vector_reader` SELECT-only; `ai_vector_ingest` has no privilege on any other schema object beyond the `ai` grants listed (no DELETE on model_versions/active_index); `anon`/`authenticated` have no `ai` USAGE; public schema 31 tables (30 Prisma models + ledger). Immutability of ACTIVE vectors against ingestion writes was NOT re-tested with a write on DEV (read-only); it rests on the trigger being present/enabled plus the disposable-QA behavioral proof (15/15 migration, 21/21 role cases).
- **PROD `yepfgjehdstlxbpespun`: 20/22, NOT touched.** Blockers: foundation checksum `5de060a3...` unresolved; backup/PITR and restore drill unverified; GitHub Environment `electrohub-prod-database` does not exist (API 404); `prod-migration.yml` is only on the feature branch and must reach `develop` by owner-approved Git integration; production release authorization not obtained. No PROD workflow dispatch or write occurred. PROD index remains unpopulated; ingestion/activation need separate authorization.
- **Git:** no merge, auto-merge, or `develop`/`main` change.

### PROD foundation checksum resolution and PROD gate status (2026-10-25)

- **Foundation checksum resolved by exact reproduction.** `git log --all` shows one blob for `20240101000000_database_foundation` (commit `f3934ed`, SHA-256 `cb2baf5e...`). UTF-8 BOM + CRLF applied to that blob yields exactly the PROD ledger value `5de060a305af86bbc70d683ebe3bea1fe35c1c6454c048cbeed07d22fe347f96` (checked against all blob/variant combinations; no other variant matches). So the applied SQL text is the canonical SQL with a BOM and CRLF line endings only: file-encoding drift, not a content difference. No original deployment log or backup artifact was available; the conclusion rests on the cryptographic reproduction. `migration-plan.cjs` now carries a third content-pinned record (ledger value pinned, canonical blob hash pinned, BOM+CRLF proof required); any other foundation checksum still fails. Focused tests: 13/13 safety tests and the workflow policy check pass locally. Nothing in the ledger or applied SQL was touched. A DBA/Project Owner sign-off on this exception is still recommended before the release authorization.
- **PROD re-read (read-only SELECTs, 2026-10-25):** project `electrohub` (`yepfgjehdstlxbpespun`, ap-northeast-1) `ACTIVE_HEALTHY`, Postgres 17.6; ledger 20 finished, 0 unfinished/rolled back, last `20261018000000_commerce_email_outbox`; no `ai` schema, no `vector` extension; 31 public tables. **PROD is still 20/22 and was not written.**
- **Still blocking PROD execution (not verifiable from this session):** (1) backup/PITR freshness/retention and a restore drill - the available tooling does not expose backup state; (2) GitHub Environment `electrohub-prod-database` does not exist (API 404), so reviewers, branch restriction and PROD-only secrets are unconfigured; (3) `prod-migration.yml` is on the feature branch only, not default branch `develop`; (4) no recorded PROD release authorization. No PROD workflow dispatch occurred. Status remains **APPLICATION APPROVED / DEV COMPLETE / PROD PENDING**. No merge.

### Local photo-search activation on :3000 (2026-10-25)

Configuration only; no model, schema, migration, PROD or Git change (all edited files are git-ignored). Values are not recorded here.

- **Config (git-ignored):** `apps/ai-service/.env` gained `AI_SERVICE_API_KEY` (new random key shared only with the backend), `AI_MODEL_ARTIFACT_DIR` (absolute path to `models/effb0-commons-v2`) and `AI_VECTOR_DATABASE_URL` (DEV `ai_vector_reader` DSN built from `.ai-vector/dev.json`; read-only role). `apps/backend/.env.local` gained the same `AI_SERVICE_API_KEY` and `AI_SERVICE_URL=http://127.0.0.1:8000`. `apps/frontend/.env` gained `VITE_IMAGE_SEARCH_ENABLED=true`.
- **Windows path finding:** a relative `sslrootcert` (`prisma/supabase-ca.pem`) fails from the AI-service working directory, and an absolute path inside this repository also fails because libpq mishandles the em dash in the folder name. The public Supabase CA certificate was copied to the ASCII-only `C:/Users/ouss0/.electrohub/supabase-ca.pem` (outside the repo) and the DSN points there. Certificate verification stays on.
- **Services:** FastAPI :8000, backend :5000, frontend :3000 (launched via local, git-ignored `.claude/launch.json` entries `ai-service-local`, `backend-local`, `frontend-local`; the pre-existing :3000/:5000 processes were restarted to load the new env).
- **End to end (browser, `http://localhost:3000/search`):** uploaded catalog photo `acermouse-02.jpg` through the Search-by-photo dialog. Loading state "Finding visually similar products..." with Cancel was shown, then `POST /api/search/image` returned 200 with 12 ordered results; #1 Acer Predator Cestus 330 (the product in the photo). FastAPI log: decode 135 ms, encode 136 ms, inference 274 ms, retrieval 3.9 s on the cold pool; index `effb0-commons-v2-3224d2cc9e57`. Warm repeat completed in about 3.4 s end to end.
- **Failure behavior observed:** before the CA fix the backend returned 503 and the UI showed "Image search is unavailable right now ... Text search and the full catalog still work" with Search by text / Browse products actions; the first request after the fix exceeded the backend 8 s upstream budget on a cold DEV connection (10.6 s in FastAPI) and returned 504, shown as "The search took too long" with Try again. Both states were graceful and the retry succeeded. Cold-start latency is the documented latency limitation and was not changed.
- **Normal search:** `GET /api/search/products?q=logitech` returned 200 with 10 results; the Search page and catalog (206 products) render. Console shows only anonymous-session 401 probes plus the 503/504 deliberately observed above; none during the successful run.
- **Kaggle isolation:** `apps/ai-service/.env` contains no `KAGGLE_*` entries; the token exists only in the git-ignored, training-only `apps/ai-service/training/.data/kaggle.env` (no other file under `apps/` contains it, none in the process environment). `kaggle_cli.py --names` still resolves the credential (`KAGGLE_API_TOKEN`), so training functionality is preserved. `~/.kaggle` is empty and was not needed. No move was necessary in this pass; the isolation is verified, not newly created.
- **Not changed / retained:** accepted model-accuracy, latency and training limitations remain documented future work. The generated read-only DSN sits in a git-ignored env file by owner request; rotate the `ai_vector_reader` password via `ai-vector-dev.cjs roles` if that file is ever shared.

### PROD release gate: owner waiver, workflow correction and Environment check (2026-10-25)

- **Owner decision (recorded in the owner's instruction to the Lead Engineer, 2026-10-25):** the Project Owner explicitly **waives backup/PITR and restore-drill verification** for this release and accepts the associated data-loss and recovery risk. **No backup or restore point has been verified or is claimed to exist.** `prod-migration.yml` now requires a nonempty `risk_acceptance_reference` (documenting that decision) in place of the backup/restore evidence inputs. Commit pinning, exact two-migration allowlist, ordered `prisma migrate deploy`, `prisma migrate status`, the pre/post checksum checks, the PROD project-ref pin, the `electrohub-prod-database` Environment binding and the nonempty release-authorization reference are unchanged. Focused checks: 13/13 safety tests and the workflow policy check pass locally; CI result is recorded below after the push.
- **Reviewed baseline:** HEAD `986655330f0d4266a09055d8991e892d73d3ea65` (Development CI and Security Audit green) before this workflow correction; PROD identity re-read read-only: `electrohub` / `yepfgjehdstlxbpespun`, 20/22, no `ai` schema, no `vector` extension.
- **GitHub Environment check (read-only API, 2026-10-25): NOT READY.** `electrohub-prod-database` exists and holds `ELECTROHUB_PROD_DATABASE_URL` and `ELECTROHUB_PROD_DIRECT_URL`, but it reports **no protection rules (no required reviewers, no wait timer) and no deployment-branch policy**, so reviewer approval and branch restriction are not enforced. Separately, the repository (not Environment) secrets list still contains `ELECTROHUB_DEV_DATABASE_URL`, `ELECTROHUB_DEV_DIRECT_URL`, `ELECTROHUB_PROD_DATABASE_URL`, `ELECTROHUB_PROD_DIRECT_URL`, `ELECTROHUB_PROD_NEW_PASS` and `TEMP_OLD_DIRECT_URL`, which makes PROD credentials readable by any workflow on the repository; the workflow header requires them to exist only as Environment secrets. These are owner-managed settings and were not changed.
- **Default branch:** `prod-migration.yml` is not on `develop` (404); only the Project Owner merges. **No PROD workflow dispatch, no PROD write, no merge.** PROD remains 20/22. Status: APPLICATION APPROVED / DEV COMPLETE / PROD PENDING.
- **CI for the workflow correction:** commit `bfdda0a693f10189bd65d627fa717a69cf09398b`: Development CI run `40225524862` SUCCESS, Security Audit run `40225524870` SUCCESS. A later docs-only commit records this line; the workflow content is identical to `bfdda0a`.

### Photo-search bugfix: vector pool timeouts on the remote DEV pooler (2026-10-25)

Owner report: on `localhost:3000`, Search by image showed either "Image search isn't available yet" or "Image search is unavailable right now" for camera (JPEG), SSD (JPEG) and Canon (WEBP) photos, while text search worked.

- **Root cause (exact):** the FastAPI pgvector pool could never open a connection, so readiness stayed `INDEX_NOT_READY`, the AI service answered `503 AI_INDEX_NOT_READY` and the backend mapped that to `503 IMAGE_SEARCH_UNAVAILABLE` (UI "unavailable right now"). Measured from this Windows dev machine to the DEV pooler (`aws-0-ap-northeast-2`), DNS is 0.05 s but a plain TCP connect takes 0.5–2.2 s and a full TLS + Postgres startup 4.7–9.2 s. `pgvector_gateway.py` allowed `connect_timeout=5`, a 3 s pool wait and `min_size=0` (connect on demand), so every check hit `PoolTimeout` / `ConnectionTimeout`. A synchronous probe with the same reader DSN connected (active index `effb0-commons-v2-3224d2cc9e57`, 412 embeddings), which ruled out credentials, the CA path, the role and the index. The "isn't available yet" message is the `VITE_IMAGE_SEARCH_ENABLED` off state; the running Vite serves the flag as `true` (checked via `imageSearchEnabled()` in the page), so a tab loaded before the flag was set needs a reload. No CORS, proxy, port, upload or contract defect was found: requests reached the backend (`POST /api/search/image`), the backend reached FastAPI, and FastAPI loaded `models/effb0-commons-v2` (`modelReady: true`).
- **Fix:** `apps/ai-service/app/integrations/pgvector_gateway.py`: `CONNECT_TIMEOUT_SECONDS` 5 → 15, `POOL_TIMEOUT_SECONDS` 3 → 10, new `POOL_MIN_SIZE = 1` (one warm connection reused by requests). Statement timeout (2 s), read-only session, role, query and model are unchanged. Regression test `test_default_pool_keeps_a_warm_connection_with_a_remote_pooler_connect_budget`. No model, index, schema, migration, env or PROD change. The git-ignored `.claude/launch.json` `ai-service-local` entry now sets `PYTHONUNBUFFERED=1` so FastAPI logs appear in the launcher.
- **Real service evidence:** FastAPI log for a browser search: decode 100 ms, encode 275 ms, inference 379 ms, retrieval 2.4 s, `POST /internal/v1/image-search` 200 in 2.85 s; responses carry `meta.embeddingVersion = effb0-commons-v2-3224d2cc9e57`, `modelVersion = effb0-commons-v2`. Backend `POST /api/search/image` (curl): camera JPEG 200 in 2.6 s, SSD JPEG 200 in 3.3 s, Canon WEBP 200 in 3.4 s, 12 products each.
- **Browser end to end (`http://localhost:3000/search`, Discovery Console, built-in browser):** test photos were Commons test-query images from the training dataset (`canon-eos-r10/139804700.jpg`, `samsung-980-pro/140843397.jpg`, and `canon-eos-r100/139581204.jpg` re-encoded to WEBP), fed to the real `Choose a photo` input. Camera JPEG → 200, #1–#4 Canon EOS R6 Mark II, R10, R7, R50 (product links `/products/<slug>`, catalog images load). Search again → second 200. Replace with SSD JPEG → previous photo and results cleared, 200; ranks 1–9 AMD Ryzen CPUs, the exact Samsung 980 PRO 1TB at #10, Samsung 970 EVO Plus and 990 PRO at #11–12. Replace with Canon WEBP → 200, #1 Canon EOS R10 (the photographed product's family). Remove → photo and results cleared. Text search: typing "samsung ssd" lists Samsung SSD suggestions; `GET /api/search/products?q=canon|laptop|macbook` 200 with 8/20/20 results.
- **Camera:** a browser-simulated camera (`getUserMedia` replaced by a canvas stream of the Canon test photo) drove the console's real Camera → shutter → "Use this photo" flow; the captured `camera-2026-10-25-19-57-02.jpg` searched with 200 and Canon EOS bodies at #1–#4. The machine reports one physical video input; it was deliberately not opened, so physical-camera capture is NOT VERIFIED.
- **Fallback:** with FastAPI stopped, the photo search returned 503 and the console showed "Image search is unavailable right now ... Text search and the full catalog still work" with Search by text / Browse products; text search kept returning 200. After restarting FastAPI, Search again returned results. Console errors were only the guest `/api/auth/refresh` 401, the deliberate 503, and one reset from the temporary local photo server used to feed test files.
- **Checks:** ai-service pytest (all pass, 1 skipped as before), ruff check, `ruff format --check`, `mypy app tests`.
- **Remaining limitation:** first-connection latency to the remote DEV pooler is still 5–9 s from this machine; the warm connection hides it for requests, but a search in the first seconds after start-up can still report unavailable or time out until the pool connects. Small flat electronics (SSD vs CPU) are confused by the model (documented Recall@1 limitation); no retraining or reindexing was done.

### Task 04.2-Q: image-search relevance (calibrated no-match gate) (2026-10-26)

**Root causes (measured, not assumed).**

1. *Forced nearest neighbours.* `_NEAREST_SQL` always returns `topK` products by cosine distance, with no relevance floor, so every photo produced 12 products. Raw similarity cannot fix this alone. On the calibration split, out-of-catalog photos reach a top-product similarity of 0.59 at the 90th percentile, while 10% of genuine catalog photos score below 0.46.
2. *Embedding confusion between categories.* With the frozen backbone and a projection trained on 127 Commons photos, SSD photos rank AMD CPUs first: 5 of 7 reviewed SSD photos and all 6 M.2 photos. Smartwatch, router, extender, tablet, Xbox and TV photos also land in the wrong category.
3. *Training coverage.* The training set has 0 real laptop photos, although laptops are 49 of the 206 indexed products. It has 5 tablet photos for 28 tablet products. It has no monitor, networking, printer or smart-home photos.
4. *Gallery domain gap.* The index holds 412 catalog illustrations (2 per product), not photographs.
5. *Preprocessing.* Resize to 256 then centre-crop to 224 cuts off parts of wide objects. Changing it requires re-encoding the whole index under a new `preprocessVersion`, so it was left unchanged.

**Independent category signal.**

- The approved checkpoint's backbone is byte-identical to torchvision `EfficientNet_B0_Weights.IMAGENET1K_V1` (maximum absolute difference 0.0 over 358 tensors).
- So the matching ImageNet classifier head is a valid, independent "what kind of object is this" signal. It is computed from features the encoder already produces.
- Its softmax mass on 63 electronics classes (listed in `training/export_relevance_head.py`) separates the groups. At the 10th to 90th percentile, out-of-catalog photos score 0.002–0.10 and catalog photos score 0.26–0.95.

**Benchmark** (`apps/ai-service/training/relevance/`).

- **Gallery:** the 412 vectors of the ACTIVE DEV index `effb0-commons-v2-3224d2cc9e57`, read through the read-only role.
- **Catalog queries:** Commons photos of catalog products from the existing manifests (validation, test_queries, unseen_sku_queries, unseen_sku_gallery). None are training images.
- **Probe set:** 240 newly collected Commons photos (CC0, PD, CC BY or CC BY-SA) in 30 labels.
  - It covers catalog categories, an adjacent group (Xbox, TV), and out-of-catalog objects: washing machine, refrigerator, microwave, vacuum, chair, cat, shoe, mug, bicycle, fruit, car and plant.
  - It is for evaluation only and is not redistributed; provenance is in `probe_manifest.csv`.
  - Every photo was reviewed visually. 67 off-topic search hits (storefronts, die shots, logos, an Apple II under "fruit") are listed in `probe_excluded.json` and left out.
- **Splits:** calibration and test are split by family, and by image for probe categories. Out-of-catalog labels are split by class, so the test classes (washing machine, refrigerator, cat, shoe, bicycle, fruit) were never seen during calibration.
- **Tuning:** thresholds were grid-searched on the calibration split only. The rule was at most 10% false rejection, then the lowest unknown acceptance. The thresholds were then frozen and run once on the test split.
- **Stability:** the chosen values sit on a plateau. Varying λ from 0.2 to 0.5 or δ from 0.05 to 0.10 changes calibration category hits by at most 3.

**Held-out test split, reviewed labels**

Sample sizes: 142 catalog photos, 45 out-of-catalog photos, and 99 photos with an identifiable exact product.

| Metric | Baseline (forced top 12) | Gate (shipped) | Gate + category rerank (measured, not shipped) |
|---|---|---|---|
| Unknown objects receiving any product | 45/45 (100%) | **3/45 (6.7%)** | 3/45 |
| Catalog photos wrongly rejected | 0/142 | **1/142 (0.7%)** | 1/142 |
| Category precision of shown results | 0.411 | **0.513** | 0.553 |
| Category Recall@1 | 74/142 | 73/142 | 90/142 |
| Category Recall@5 | 90/142 | 87/142 | 98/142 |
| Exact-product Recall@1 / @5 | 14/99 / 45/99 | 14/99 / 44/99 | 15/99 / 53/99 |
| Mean products shown (accepted queries) | 12 | 7.9 | 8.3 |

On the calibration split, the gate accepts 1 of 36 out-of-catalog photos and rejects 3 of 134 catalog photos.

**Per case** (reviewed probe photos from all splits, with the gate on):

| Photo type | Result |
|---|---|
| Washing machine | 1 of 6 got products (before: 6 of 6) |
| Refrigerator, microwave, shoe, chair | 0 got products |
| Cat | 1 of 8 got products |
| Canon DSLR | 8 of 8 matched cameras |
| Keyboard | 6 of 7 matched keyboards |
| Laptop | 2 of 2 matched laptops (only 2 usable photos) |
| PS5 | 4 of 4 matched gaming |
| SSD | 5 of 7 still return CPUs (**not fixed**) |
| Tablet, smartwatch, router, extender, Xbox, TV | Still mostly the wrong category (**not fixed**) |

These remaining errors come from the embedding itself, and the gate deliberately does not hide them.

**Implementation.**

- **No-match gate:** `app/models/relevance.py` holds the gate loader and the `select` policy.
  - The loader checks exact keys and the SHA-256, and requires `backboneModelVersion` to equal the serving `modelVersion`.
  - `EfficientNetEncoder.encode_assessed` returns the embedding and the electronics mass from one forward pass.
  - `ImageSearchService` applies the gate after retrieval and logs only counts.
  - It is configured with `AI_RELEVANCE_ARTIFACT_DIR`; when unset, behaviour is unchanged.
- **Unchanged:** API contract, backend, database, ACTIVE index and approved checkpoint.
- **Frontend:**
  - The no-match state now uses the approved copy and adds a "Browse products" action.
  - While the camera is live, a one-line framing hint appears under the viewfinder.
- **Category reranking is not shipped.** It needs each candidate's category inside the AI service, which the read-only `ai` role cannot see. Two ways to provide it, both owner decisions:
  - a typed contract addition: query-category hints that Express uses to rerank;
  - category metadata in the index.

**Verification.**

- **ai-service:** `pytest` 248 passed and 1 skipped, including the new `tests/test_relevance_gate.py`. `ruff check .`, `ruff format --check .` and `mypy app tests` are clean.
- **Frontend:** discovery tests pass 26/26 with `VITE_IMAGE_SEARCH_ENABLED=false`, as in CI. One existing "not enabled" test fails when the local env sets the flag to true, with or without these changes.
- **Live stack** (AI service on :8000 with the gate, backend on :5000, DEV index), via `POST /api/search/image`, 1.7–3.2 s per request:
  - Cat, shoe and refrigerator photos returned `200` with 0 items.
  - The Canon photo returned 7 Canon EOS bodies.
  - The keyboard photo returned 6 Logitech keyboards.
  - The smartphone photo returned 12 phones.
  - SSD, tablet and Xbox photos still returned CPUs.
- **Browser** (`localhost:3000`):
  - The shoe photo showed "No similar products found" with Try another photo, Search by text and Browse products.
  - Browse products navigated to `/products`.
  - Replacing the photo with a Canon one returned 7 Canon results, with `/products/canon-eos-r6-mark-ii` first.
  - Ctrl+K text search for "canon" listed the Canon EOS products.

**Kaggle training: justified, not performed in this task.**

- **Why it's needed:** the remaining SSD/CPU, tablet, router and console errors come from the embedding, and the training data has no laptop, monitor or networking photos.
- **What a new run needs, in order:**
  1. A reviewed, licensed dataset expansion (owner gate).
  2. A staging embedding version.
  3. Re-ingestion.
  4. Owner-approved activation.
- **Current state:** the approved checkpoint and the ACTIVE DEV index are unchanged.

**Limitations.**

- **Small probe set:** 1–8 reviewed photos per label, so per-category numbers are indicative only.
- **Unsold electronics:** the gate counts any electronics photo as in-domain, so electronics the catalog doesn't sell (Xbox, TV) still get the nearest products.
- **Physical camera:** NOT VERIFIED. Camera captures use the same upload path, so the gate applies to them.
- **Preprocessing:** unchanged. A padded, subject-preserving resize needs a new `preprocessVersion` and a re-encoded staging index.

## Task 04.2-Q — Kaggle retraining and final benchmark (2026-10-26)

Dataset `realphoto-v1` (git-ignored, licences CC0/PD/CC BY/CC BY-SA only, per-file attribution in `license_attributions.md`): train 853 photos + 412 catalog images, dev 156 (99 known / 57 unsupported), final 89 (74 known / 15 unsupported, 15/15/15/15/15/14 per bucket). Splits by source group; 0 groups cross splits; final never packaged for Kaggle.

Kaggle kernel `electrohub-realphoto-train-v2` (T4), dataset `electrohub-realphoto-v2`:
- B `effb0-realphoto-b2` (frozen backbone, SupCon + category head), best epoch 5, sha `4addfad0…`
- C `effb0-realphoto-c2` (last 2 stages unfrozen after 3 warm-up epochs), best epoch 5, sha `b6f83c9c…`

Selection on dev only: C with its learned gate, minMass 0.8, gap 0.1, rerank weight 0.

| Metric | A baseline (commons-v2 + ImageNet gate) | C selected |
|---|---|---|
| Dev category R@1 | 38/99 | 67/99 |
| Dev family R@1 | 1/30 | 11/30 |
| Dev unknown accepted | 5/57 | 6/57 |
| Dev known rejected | 17/99 | 9/99 |
| **Final** category R@1 / R@5 | 30/74 / 35/74 | 43/74 / 48/74 |
| **Final** precision of shown | 0.291 | 0.653 |
| **Final** unknown accepted | 4/15 | 2/15 |
| **Final** known rejected | 2/74 | 7/74 |
| Final SSD→CPU / mouse↔SSD | 4 / 0 | 1 / 0 |
| Simulated mouse camera (24 variants) top-1 mouse | 16/24 | 16/24 (5 rejected, 3 wrong) |
| Encode p50 / p95 (CPU) | 0.049 / 0.059 s | 0.044 / 0.056 s |

The final benchmark was run once per model after selection. Final has no family labels (family recall n/a). Candidate C is staged locally only; the DEV active index and deployed checkpoint are unchanged. A staging embedding version and live E2E need separate DB authorisation.

### Candidate c2 on the disposable QA stack (2026-10-26, no DEV/PROD writes)

- `python -m app.ingest stage` (ingest role) into `localhost:55434/electrohub_disposable`: `effb0-realphoto-c2-b6f83c9c224b`, 412/412 images, 206 products, job COMPLETED. `activate` then made it ACTIVE in QA only (previous `effb0-commons-v2-3224d2cc9e57`, restorable with `rollback`).
- QA FastAPI :8200 ran c2 plus its learned gate (`relevance-realphoto-c2`, minMass 0.8) via `ai-vector-qa.cjs ai-service <artifact> <relevance-dir>` (new optional argument). Express :5200 and the frontend :3200 used the real chain with no interception.
- `discovery-image.isolated.spec.ts` with `ISOLATED_MODEL_VERSION_PREFIX=effb0-realphoto-c2`: 6 passed, 1 skipped (outage). Covered: console entry, held-out photo returning visible products (`meta.modelVersion` c2), paste/drop validation, gateway states and Escape, virtual camera capture/retake/track release, camera denial, keyboard, 200% zoom and reduced motion.
- With the AI service stopped (`ISOLATED_AI_DOWN=1`), the outage test passed: photo search reports unavailable, while text search and the catalog keep working.
- DEV active index, the deployed checkpoint and PROD are unchanged.

### Task 04.2-Q — Option A: candidate c2 staged in DEV (no activation), 2026-10-26

Owner-authorised staging only. Run once with `python -m app.ingest stage --artifact-dir models/effb0-realphoto-c2 --catalog-root apps/frontend/public`, connected as the restricted `ai_vector_ingest` role (DSN assembled in memory, never printed or stored; no admin DSN in the process environment). Pre/post checks were SELECT-only through the same role.

| Check | Result |
|---|---|
| DEV identity | Verified: project `pzxekjybdiulzmssalfo`, `current_user = ai_vector_ingest` |
| Artifact SHA-256 | `b6f83c9c224ba1de453868b1ab89d3397de83d8089e2041eb1341d585a932005` (computed from the local file, equals the descriptor and the registered row) |
| Candidate version | `effb0-realphoto-c2-b6f83c9c224b`, preprocess `effb0-rgb-r256-c224-imagenet-v1`, dim 256 |
| Candidate status | STAGING |
| Ingestion job | COMPLETED, 412 planned / 412 succeeded, source digest `55d36d92…2306b` |
| Image coverage | 412 embeddings = 412 rows in `ai.catalog_images` |
| Product coverage | 206 distinct products = 206 in `ai.catalog_images` |
| ACTIVE DEV index | Unchanged: `effb0-commons-v2-3224d2cc9e57`, same `updated_at` (2026-10-24 21:43:35 UTC); its 412 embeddings have the same content fingerprint before and after (`md5 7c134103…`) |
| Commerce tables | Not written: the CLI only reads the `ai.catalog_images` view, and the ingest role has no write grants outside `ai` |
| PROD | Untouched |
| Git merge / commit | NOT PERFORMED |
| Candidate C activation | NOT PERFORMED; `localhost:3000` still serves the commons-v2 index |

### Task 04.2-Q — owner screenshot acceptance cases (2026-10-26)

Original owner files from the owner's Downloads folder (sizes match the screenshots), except `camera-2026-10-25-22-42-06.jpg`, which is unavailable; the mouse row uses a crop of the owner's supplied screenshot of a different camera photo (not original resolution). Photos stay in the session scratch folder (not in the repository). "Current" = DEV-equivalent `effb0-commons-v2` + ImageNet gate + Express weight 0.5, reproduced offline with the served scoring code (identical to the owner's screenshots). "c2" = real browser at `localhost:3200` → Express :5200 → FastAPI :8200 → disposable pgvector (c2 ACTIVE in QA only).

| Owner photo | Expected | Current model, top results | c2 in the QA browser, top 5 | Result |
|---|---|---|---|---|
| `images (11).jpg` controller | gaming | Cestus 330 mouse, Tapo C210, Tapo C200 | ROG Ally, PlayStation 5, Cestus 330 (3 shown, all gaming) | Category fixed; the catalog sells no standalone controller |
| `images (12).jpg` speaker | speakers-audio | JBL Flip 6, then 3 Tapo cameras, a monitor | JBL Charge 5, Boombox 3, Xtreme 3, Flip 6, Bar 300 | Fixed |
| `images (9).jpg` Wi-Fi extender | networking-wifi | iPhone 16 ×2, Tapo T110, iPhone 15 ×2 | Tapo T110 (smart-home), Archer T3U, Tapo C310, Archer AX10, AXE75 | Partly: networking in top 3, but rank 1 is a sensor; no extender is stocked |
| `images (5).jpg` laptop | laptops | MacBook Air ×2, then 3 keyboards | MacBook Air ×5 (12 shown) | Fixed |
| `images.jpg` tablet | tablets | Apple Watch ×5 | iPad Air / iPad 10 ×5 (12 shown) | Fixed |
| `images (8).jpg` console | gaming | Dell monitor, Apple Watch, ASUS monitor, Watch, Tapo P100 | PlayStation 5, ROG Ally, Cestus 330 | Fixed |
| owner mouse (screenshot crop) | keyboards-mice | Tapo P110, Tapo P100 | No match ("No similar products found"), with no capture guidance | Fails: mice are stocked |

Request latency through Express in QA: 245–503 ms warm, 1.3 s for the first request after start.

### Manual PROD logical backup and isolated restore verification (2026-10-26)

Owner-authorized (backup and restore verification only; the two pending migrations were NOT applied and PROD was not written). **This supersedes the earlier statement that no backup exists; the owner's backup waiver is no longer the only recovery posture for this release.**

- **Tooling:** official Supabase CLI `2.122.0` (Windows amd64 release from `github.com/supabase/cli`, SHA-256 verified against the release `checksums.txt`; the npm package has no win32 binary) installed outside the repo at `C:\ElectroHub-Backups\tools`. The CLI's existing login was recognized (no new login). Docker/Podman is not installed (and `C:` has ~1.6 GB free), and CLI 2.122.0 needs a container for `db dump`; the CLI's own `--dry-run` scripts were therefore generated and executed with local PostgreSQL 17.11 `pg_dump`/`pg_dumpall` (read-only; one flag spelled out as `--quote-all-identifiers`). The CLI creates a temporary `cli_login_postgres` login role on PROD while generating its credentials (platform-managed, no application data touched).
- **Identity:** project `electrohub`, ref `yepfgjehdstlxbpespun`, ap-northeast-1, Postgres 17.6, status ACTIVE_HEALTHY; connection via the CLI's session pooler login (not the transaction pooler). No connection string or password was printed or stored; the temporary scripts were deleted.
- **Backup set:** `C:\ElectroHub-Backups\prod-pre-migration-20261026-20261026-134530\` (outside Git; not uploaded anywhere; folder permissions are the inherited defaults: BUILTIN\Users read and Authenticated Users modify on C:\ElectroHub-Backups; an attempt to restrict them to the owner did not take effect, so the owner should restrict the folder or move the backup to an encrypted location before relying on it - the files contain no customer rows but do contain the full schema).

| File | Bytes | SHA-256 |
|---|---|---|
| `prod-schema.sql` | 66,186 | `da831d5b021ee61dadd33be53ecc07d443bc4fcfc0261fde7d76d1974db397ad` |
| `prod-data.sql` | 23,401 | `c346e0f5b285848c9dd6609aea067702c97d52a4648d4ef7f3e2b9c02680bdce` |
| `prod-roles.sql` | 370 | `168a95a9c745af5ed4679751f90419ac9dc434240a213b03e32a06d5664c2308` |

  `MANIFEST.txt` in the same folder records the hashes, CLI/pg_dump versions and method.
- **Coverage:** schema dump has 31 `public` tables, 96 index statements, 37 foreign keys, 2 triggers and the extensions `pg_stat_statements`, `pgcrypto`, `supabase_vault`, `uuid-ossp`; the data dump has 64 of 64 COPY blocks complete (31 `public`, plus `auth`/`storage`) and includes `public._prisma_migrations` (20 rows). **No `ai` schema or `vector` extension exists on PROD yet, so none is in the backup (expected: those arrive with the pending migrations).** Standard exclusions per the CLI: Supabase-managed schemas (`auth`, `storage`, `realtime`, `vault`, `extensions`, `cron`, `graphql*`, ...) have no schema/ACL definitions in the dump; Storage objects, Auth configuration, secrets and platform settings are not covered by a logical dump. The roles file only carries role settings (anon, authenticated, authenticator statement timeouts) - role passwords/definitions of platform roles are not included.
- **Important data finding:** PROD currently has **0 users, 0 products, 0 orders, 0 categories and 0 `auth.users`; the only populated table is `_prisma_migrations` (20 rows).** The commerce tables are empty, so the backup is small by nature and no customer data exists in it.
- **Isolated restore:** disposable PostgreSQL 17.11 cluster on loopback port 55436 at `C:\ElectroHub-Backups\restore-pg-20261026-134530\data` (separate from PROD, shared DEV and the QA database), database `electrohub_restore_test`, stopped after verification. Order: prerequisite roles (`postgres`, `anon`, `authenticated`, `authenticator`, `service_role`, `supabase_realtime_admin`), `extensions` schema and `supabase_realtime` publication (platform prerequisites), roles file, schema, data, each with `ON_ERROR_STOP` - all exit 0. Documented adaptations: one statement (`CREATE EXTENSION supabase_vault`, platform-only, unavailable locally) was filtered from the schema; 33 `auth`/`storage` COPY blocks (all zero rows, tables in Supabase-managed schemas) were filtered from the data. A first attempt stopped on the missing `supabase_realtime` publication and was rerun from a clean database after adding that prerequisite.
- **Restore comparison (identical read-only queries on PROD and the restored copy):** tables 31/31; columns 338/338 (column-definition hash `f34eea13...` equal); indexes 127/127 (definition hash `3e152ccc...` equal); constraints PK 31, FK 37, check 23 equal; enum types 22/22; public triggers 2/2; `_prisma_migrations` 20 finished, 0 unfinished/rolled back, last `20261018000000_commerce_email_outbox`, name+checksum hash `d72b942c...` equal; users/products/orders 0/0/0 equal; no `ai` schema and no `vector` extension on either side. No discrepancies.
- **Historical checksum:** `20240101000000_database_foundation` ledger checksum `5de060a3...` is present in the backup exactly as on PROD and is the exact UTF-8 BOM + CRLF form of the only Git blob (see the earlier resolution). It is reconciled by the pinned checker record (13/13 safety tests pass) and is not a blocker; it still needs the DBA/owner acknowledgement already requested. No ledger or checksum was modified.
- **Managed backup/PITR (read-only `supabase backups list`):** `walg_enabled: true`, **`pitr_enabled: false`, and no managed backups are listed.** There is therefore no verified Supabase-managed restore point or PITR window for PROD; the manual logical backup above is the only verified recovery artifact (and it does not cover Storage objects or platform configuration). Recovery procedure for these migrations: restore `prod-schema.sql` / `prod-data.sql` into a fresh Supabase project or database, or roll forward with a reviewed corrective migration; there is no automatic rollback.
- **Not done / still blocked:** the two pending PROD migrations were not applied (PROD remains 20/22); no Git commit or push, no merge. Remaining gates are unchanged: Environment protections/reviewers, `prod-migration.yml` on `develop` (owner merge), and the production release authorization.

Decision: **BACKUP VERIFIED - READY FOR ARCHITECT REVIEW** for the logical (database) backup, with the PITR/managed-backup limitation above; PROD migrations remain blocked pending Owner and Architect review.

### Task 04.2-Q — owner-failure fixes and final benchmark 2 (2026-10-26)

**Per-model category weight.** The relevance gate artifact may now carry `categoryRerankWeight` (default 0.5, the value chosen for the first gate). FastAPI returns it as `categoryWeight` alongside the hints (`null` without hints), and Express uses it instead of its constant when present. c2's gate carries 0, the weight selected on the dev split. In the QA browser, `images (9).jpg` (Wi-Fi extender) now ranks TP-Link Archer T3U (networking) first instead of the Tapo T110 sensor.

**Capture guidance.** When a photo search returns no match, the console measures the photo locally (160 px canvas, nothing uploaded). It flags a dark photo (mean luma < 70) and a blurry photo (Laplacian variance < 300); the thresholds sit below the 5th percentile of the training photos. It always adds a fill-the-frame tip. In the QA browser the owner mouse screenshot shows "This photo looks blurry…" plus the framing tip. The model still returns no mouse for that photo; only the guidance is new.

**Final benchmark 2 (locked).** `training/.data/final-benchmark-2/` (git-ignored) holds 61 visually reviewed Commons/Openverse photos (CC0/PD/CC BY/CC BY-SA): 49 catalog-category products and 12 unrelated objects. `build_final_benchmark.py` excluded any photo whose file, page or photographer appears in the earlier collection (105 excluded) or that is a near-duplicate of any earlier photo, and caps each photographer at 3. `lock.json` records the SHA-256 of every file. Each model was scored once; nothing was tuned on it.

| Metric (49 known, 12 unknown) | Current DEV model (commons-v2 + ImageNet gate, weight 0.5) | c2 (learned gate 0.8, weight 0) |
|---|---|---|
| Category correct at rank 1 | 21/49 | **37/49** |
| Category in top 5 | 22/49 | **40/49** |
| Precision of shown products | 0.317 | **0.778** |
| Known products rejected | 1/49 | 2/49 |
| Unrelated objects accepted | **0/12** | 3/12 (2 umbrellas, 1 pair of shoes; top similarity 0.31–0.36) |
| Encode latency p50 / p95 (CPU, offline) | 0.031 / 0.037 s | 0.033 / 0.038 s |

Per class, c2 gets rank 1 right for speakers 6/6 (current 0/6), tablets 3/6 (0/6), gaming 4/7 (1/7), mice/keyboards 4/5 (2/5), laptops 5/6 (3/6), networking 4/4 (3/4), SSDs 1/2 (0/2). It is worse on CPUs (3/5 vs 5/5) and unrelated objects (9/12 vs 12/12). Family metrics do not apply: these photos have no product-family labels.

Verification: ai-service `pytest` all passed, `ruff`/`ruff format`/`mypy` clean; backend vitest (image search + AI integration, 123 tests), `tsc` and eslint clean; frontend discovery tests 31/31 with `VITE_IMAGE_SEARCH_ENABLED=false` (as in CI). With the developer's git-ignored `apps/frontend/.env` enabling the flag, one existing "not enabled" test fails both with and without these changes.

### Task 04.2-Q — minimum-similarity no-match floor (2026-10-26)

The relevance gate artifact accepts an optional `minTopSimilarity` (default 0, off): FastAPI returns no products when even the best catalog match is less similar than the floor. It was chosen on the **dev split only** (c2, gate 0.8, gap 0.1, weight 0; 99 known, 57 unknown):

| Floor | Category @1 | Precision shown | Unknown accepted | Known rejected |
|---|---|---|---|---|
| 0 (off) | 67/99 | 0.713 | 6/57 | 9/99 |
| **0.36 (selected)** | 67/99 | 0.713 | 4/57 | 9/99 |
| 0.40 | 67/99 | 0.736 | 2/57 | 12/99 |
| 0.45 | 67/99 | 0.770 | 1/57 | 16/99 |

0.36 is the highest floor that rejects no additional known product on dev. c2's gate now carries `minTopSimilarity: 0.36`.

Owner cases in QA (Express :5200 → FastAPI → disposable pgvector, c2 + floor): all seven results are unchanged. The controller, speaker, extender (TP-Link Archer T3U first), laptop, tablet and console still return their categories first; the lowest of their best-match similarities is 0.646. The mouse screenshot still returns no match (it was already rejected by the 0.8 gate). Warm request latency: 473–655 ms.

The locked final benchmark 2 was not re-scored, because it has already been used once. The floor's effect on independent photos (two umbrellas and a pair of shoes there had best-match similarity 0.31–0.36) needs a fresh, untouched benchmark to confirm.

### PROD release gate re-check after owner authorization (2026-10-26)

Observed read-only (no PROD write, no dispatch, no merge):

- Environment `electrohub-prod-database`: custom branch policy, only `develop` allowed; no required reviewers (owner decision). Environment secrets: `ELECTROHUB_PROD_DATABASE_URL`, `ELECTROHUB_PROD_DIRECT_URL`. DEV Environment holds the DEV pair. Repository-level DEV/PROD database secrets: **absent**.
- Repository secrets still present: `ELECTROHUB_PROD_NEW_PASS`, `TEMP_OLD_DIRECT_URL` (both created 2026-09-26). No workflow on the feature branch references them. Purpose is not established and they may hold a still-valid PROD credential, so they were NOT deleted; owner decision required.
- **`prod-migration.yml` is NOT on `develop` or `main`** (contents API 404 on both; `gh workflow list` shows no PROD workflow). It cannot be dispatched until the owner merges it.
- PROD ledger (read-only): 20/20 finished, 0 unfinished/rolled back, last `20261018000000_commerce_email_outbox`, name+checksum hash `d72b942c...` identical to the backup; 0 users/products/orders; no `ai` schema. The backup is current.
- Backup folder `C:\ElectroHub-Backups`: inheritance removed; now only the owner account, SYSTEM and Administrators have full control. SHA-256 of all three dump files unchanged.

Decision: PROD migrations NOT executed (NO-GO: workflow not on default branch; legacy secret disposition unresolved).

### Task 04.2-Q — candidate D (SigLIP 2) with category filter, disposable QA only (2026-10-26)

**Change.** The relevance gate artifact accepts an optional `minCategoryRatio` (default 0, off). FastAPI returns it as `categoryMinRatio` (null without hints or when 0); Express `filterByCategory` drops products whose database category hint is below that fraction of the strongest hint, then reranks as before. Internal AI→Express contract only; the public `/api/search/image` response is unchanged. Only D's gate carries a ratio; the current DEV model and C are unaffected. `evaluate_policy.py score` gained `--floor` and `--ratio` so offline scoring mirrors the served policy.

**Selection on dev only (99 known / 57 unknown), before opening the benchmark.**

| gap | ratio | Category @1 | Purity of shown | Known rejected | Unknown accepted | Mean shown |
|---|---|---|---|---|---|---|
| 0.10 | 0 (previous D) | 92 | 0.780 | 1 | 4 | 6.5 |
| **0.15** | **0.10 (selected)** | 96 | 0.990 | 2 | 3 | 5.8 |
| 0.20 | 0.10 | 97 | 0.983 | 2 | 3 | 6.2 |

Owner photos were identical for 0.15 and 0.20 except the speaker (4 vs 6 results, all JBL speakers). 0.15 was chosen for higher purity.

**QA deployment.** `siglip2-b16-p256-d1-b3900dd9fad5` staged with the `ai_vector_ingest` role into `localhost:55434/electrohub_disposable` (412/412 images, 206 products, COMPLETED) and activated there only (previous C, restorable with `rollback`). Shared DEV active index unchanged; C remains staged and inactive in DEV.

**Owner photos, served (Express :5200 → FastAPI :8200 → QA pgvector).**

| Photo | Current DEV model | C | D (gap 0.15, ratio 0.1) |
|---|---|---|---|
| Controller | Acer Predator Cestus 330, then 2 Tapo cameras | ROG Ally, PS5, Cestus 330 | PS5 (1 result) |
| Speaker | JBL Flip 6, then Tapo cameras, LG monitor | 5 JBL speakers | JBL Bar 300, Flip 6, Go 4, Boombox 3 (no printer/switch) |
| Wi-Fi extender | iPhones, Tapo T110 | Archer T3U, Tapo T110, Archer routers | 6 TP-Link Archer routers |
| Laptop | MacBook Air, then keyboards | MacBook Airs | MacBook Airs (12) |
| Tablet | Apple Watches | iPads | Galaxy Tab S9, iPad 10 (12) |
| Console | monitors, watches | PS5, ROG Ally, Cestus 330 | PS5 (1 result) |
| Mouse screenshot | Tapo plugs | no match | 6 Logitech mice (screenshot crop; physical-camera check still pending) |

Browser (React :3200): speaker upload → "4 products · ordered by visual relevance", JBL Bar 300 / Flip 6 / Go 4 first. Warm end-to-end latency 1.85–2.06 s; first (cold) request timed out at the 5 s inference limit (encode 7.2 s).

**Locked final benchmark 2, scored once for D (lock: 62/62 hashes match).**

| Metric (49 known, 12 unknown) | Current | C | D |
|---|---|---|---|
| Category @1 | 21/49 | 37/49 | **41/49** |
| Category in top 5 | 22/49 | 40/49 | 41/49 |
| Purity of shown | 0.317 | 0.778 | **0.998** |
| Known rejected | 1/49 | 2/49 | **8/49** |
| Unknown accepted | 0/12 | 3/12 | 1/12 |
| Encode p50 / p95 (offline) | 0.031 / 0.037 s | 0.033 / 0.038 s | 1.33 / 1.97 s (measured while QA staging shared the CPU) |

Per class D: gaming 7/7, speakers 6/6, laptops 6/6, mice 5/5, CPUs 5/5, networking 4/4, cameras 2/2, SSDs 2/2, smartphones 3/6, tablets 1/6, unknown 11/12. Of the 8 rejections, 7 are phones/tablets: 5 have best catalog similarity 0.02–0.11 (below the 0.12 floor), 2 lost every candidate to the category filter. Family metrics do not apply (no family labels).

**Gate result.** Category @1 84% (≥80% met), unknown acceptance better than C (met), known rejection 16% (≤5% **not met**), phone/tablet regressions vs C, CPU latency ~50× C. Not recommended for DEV promotion yet.

### Task 04.2-Q — candidate D: phone/tablet rejection correction, new dev data, benchmark 3 (2026-10-26)

**Root causes of the 8 known rejections on benchmark 2** (diagnosis only; benchmark 2 was not used for selection). All 8 were phones/tablets (3 phones, 5 tablets), not 7 as first reported. Six fell below the 0.12 similarity floor (best catalog similarity 0.02–0.11, with the category head at 0.39–0.99 for the right class), one tablet failed the electronics-mass gate (0.067), and one phone lost every candidate to the category filter (its 12 nearest products were laptops). Scores are consistent across offline, FastAPI and Express. The centered PCA 768→256 projection lowers phone/tablet similarity more than other classes (train 5th percentile 0.074 vs 0.163); in raw 768-d they are equal. The old dev split had only 13 easy phone/tablet photos, so it could not detect this.

**New data (Wikimedia Commons; Openverse unreachable from this network).** `training/.data/realphoto-v3` (git-ignored): 1,011 candidates collected (CC0/PD/CC BY/CC BY-SA only, provenance per file), visually reviewed. The collector now also accepts `thumb.wikimedia.org` (Commons' current thumbnail host) and has a `--sources` option. `training/data/build_benchmark3.py` excludes any photo whose hash, page, Commons page or photographer appears in earlier collections, or within dHash Hamming 6 of any earlier dataset/gallery/benchmark/owner photo (105 excluded: 73 photographer reuse, 23 same file/page, 9 near-duplicates), then assigns whole photographer groups to the benchmark first and the rest to dev.

- New dev photos: 53 phones, 25 tablets (`realphoto-v3/dev/dev.csv`).
- **Final benchmark 3 (locked):** 114 photos — 83 stocked (15 phones, 16 tablets, every catalog category except computer-components: the only 2 CPU photos came from already-used photographers), 15 unstocked electronics (e-readers, projectors, calculators, radios, drone, GPS, DVD players, photo frames), 16 unrelated objects. `benchmark.csv` SHA-256 `b0fcdc5b47158dcf0177b34bc7f2fafa8474afa3bb26c6ecd7b1485038d280a8`; `lock.json` SHA-256 `db3263afed42af630b5bc87526022e5b264553a1e37a951036f8469cf24881e2` (115 files). Only 2 photos carry a defensible catalog family (older JBL Flip models → JBL Flip 6); the other photographed models are not sold, so family relevance is measurable on 2 photos only.

**Selection on dev only (177 known incl. 78 new phone/tablet photos, 57 unknown).**

| Space / policy | Cat @1 | Purity | Known rejected | Unknown accepted | New P/T rejected |
|---|---|---|---|---|---|
| PCA-256, floor 0.12 (previous D) | 150 | 0.934 | 17 (9.6%) | 3 | 15/78 |
| PCA-256, no floor | 155 | 0.931 | 11 (6.2%) | 5 | 9/78 |
| **PCA-256, floor 0.12 + fallback 0.9 (selected)** | **163** | **0.934** | **3 (1.7%)** | **3** | **1/78** |
| uncentered-256 + fallback 0.9 | 162 | 0.916 | 5 (2.8%) | 4–5 | 2/78 |
| raw 768 + fallback 0.9 | 163–164 | 0.917 | 0–1 | 4–6 | 0–1/78 |

Raw 768 is not clearly better on purity or family relevance and would need a `vector(768)` index (schema change, not authorized), so the 256-d contract and the existing QA index are kept. Fallback depth 48 matches unlimited depth on dev (12: 11 rejected; 24: 6).

**Change (D only; default off).** The relevance artifact accepts `categoryFallbackConfidence`. When the gate accepts a photo and its strongest category hint reaches it, FastAPI also returns `fallbackMatches` (48 nearest, no gap cut) and `fallbackScoreGap`; Express uses them only if the regular list is empty after its category filter, keeping products of the strongest hinted database category within the gap. Internal AI→Express fields only; public response unchanged. D's relevance now carries `categoryFallbackConfidence: 0.9` (embedding version unchanged, `siglip2-b16-p256-d1-b3900dd9fad5`). Also: SigLIP warm-up forward pass before readiness; loader integrity tests; evaluator mirrors floor, filter and fallback.

**Live QA (React/Express → FastAPI → disposable pgvector, D active in QA only).** New dev photos through Express: phones 50/53 right category first, 0 rejected; tablets 17/25, 1 rejected (matches offline). Owner regressions unchanged: speaker → 4 JBL speakers (no printer/switch); extender → 6 TP-Link routers; laptop → MacBook Airs; tablet → Galaxy Tab S9/iPad 10; mouse screenshot crop → 6 Logitech mice (physical-camera photo still unavailable); controller and console → PS5 (1 result each).

**Idle machine (i7-1355U, load 11%, game closed).** Init (verify + load + warm-up) 1.25 s; first encode 236 ms; warm encode p50 228 / p95 253 ms at 2 threads (4 threads slower: 328 ms); process +720 MiB, peak 1.19 GB. Express end-to-end on 78 photos: p50 263 ms, p95 295 ms. FastAPI concurrency: 1 → p50 0.25 s; 2 → 0.54 s; ≥4 → requests beyond the 2 inference slots get 429 with Retry-After (existing design; no timeouts). After a service restart the first request took 5.4 s, of which 350 ms was decode/encode/retrieval; the rest was the first pgvector connection (startup `PoolTimeout` against the WSL Docker QA database), not the model.

**Browser QA (in-app browser, :3200).** Paste → 12 iPhone 16 results; keyboard Enter on the focused search button; drag-and-drop → 8 iPads (456 ms); Replace (file input) → honest "No similar products found" with framing tip for the one dev tablet still rejected; Remove → empty state; camera: permission is denied in this browser, the "Camera access is blocked" state with Upload/Back works, **capture and retake not verified**; buttons show the 2563EB focus ring; AI outage (service stopped) → "Image search is unavailable right now" with text search and browse; text search, category listing and product page (price, Add to Cart) work during the outage.

**Final benchmark 3 — scored once (dev-selected settings; current and C scored for comparison only).**

| Metric | Current DEV | C | D |
|---|---|---|---|
| Category @1 (83 known) | 29 (35%) | 47 (57%) | **77 (92.8%)** |
| Category in top 3 | 35 | 52 | **77 (92.8%)** |
| Purity of shown products | 0.304 | 0.614 | **0.913** |
| Known rejected | 3 (3.6%) | 6 (7.2%) | **2 (2.4%)** |
| Unrelated objects accepted | 6/16 | 7/16 | **4/16** |
| Unstocked electronics accepted | 14/15 | 11/15 | 14/15 |
| Unknown total accepted | 20/31 | 18/31 | 18/31 |
| Family in top 5 | 1/2 | 1/2 | 2/2 |
| Phones @1 / rejected | 10/15 / 0 | 7/15 / 1 | 12/15 / 2 |
| Tablets @1 / rejected | 2/16 / 0 | 8/16 / 2 | 15/16 / 0 |
| Encode p50 (offline tool) | 0.041 s | 0.039 s | 0.384 s |

D per class: every class 100% except networking 4/6 (ZyXEL switch → components; mesh puck → speakers), phones 12/15 (2 low-similarity rejections, Motorola Milestone slider → smart-home), tablets 15/16 (Surface Pro with keyboard → laptops). Unstocked electronics: D shows products for 14/15 (e-readers/photo frame → tablets, projectors → monitors, radios/projector → speakers, DVD/calculator → networking, drone/GPS → smart-home).

### Task 04.2-Q — open-set negative-family expansion and Benchmark 4 (2026-10-27)

Owner-authorized single round. Disposable QA only; shared DEV index, Candidate C (staged, inactive), PROD, migrations and Git untouched.

**Benchmark 4 protection.** `benchmark.csv` SHA-256 `f58bc94df17fb4c9793759893613aed1b4cfedd617d91d5909af33d0f3fb4734` checked before development and again (with every file hash in `lock.json`) immediately before the single evaluation. No benchmark photo, label or score was opened during development; near-duplicate checks used the raw collection folders, not the benchmark folder. The evaluation script writes a run marker and refuses a second run.

**New negative families (dev only).** 16 families, each first checked against the catalog API snapshot (no product name/spec matches; standalone fax machines and pen displays excluded as ambiguous with the stocked MFP printer and tablets/monitors): label printer, voice recorder, electronic dictionary, barcode scanner, card terminal, pager, remote control, medical meters, guitar pedal, audio mixer, UPS, typewriter, NAS, graphics (pen) tablet, webcam, digital scale. Oscilloscopes/multimeters and media players were not collected: they overlap Benchmark 4's reserved unseen families. Document scanners are stocked; GPS, photo frames and satellite receivers were already dev families. Collection `training/.data/realphoto-v5` (git-ignored): 1,450 Wikimedia Commons / Openverse candidates (CC0, PD, CC BY, CC BY-SA only, provenance per file), 559 kept after visual review (`review_keep.py` records each decision and the exclusion reasons), then 236 excluded (217 photographer/source group already used, 17 near-duplicates within dHash 6, 2 same file/page), leaving **278 dev photos from 209 source groups** (≤4 per group).

**Family-disjoint validation** (`openset_fd.py`, session scratch): 31 unsupported families split into 6 folds by family; for each fold the classifier, calibration and threshold never saw those families; known/unrelated rows folded by source group. Same 193 stocked dev photos, 362 unstocked (84 round-4 + 278 new), 155 unrelated.

| Detector | Stocked Top-1 | Rejected | Unstocked accepted (held-out families) | of which round-4 families | Unrelated |
|---|---|---|---|---|---|
| 1 D, no family gate | 92.2% | 1.6% | 73% | 71/84 (85%) | 6/155 |
| 2 Text support ≥0.005 | 91.2% | 3.1% | 39% | — | 2/155 |
| 3 Classifier, old negatives ≥0.3 | 90.2% | 4.1% | 32% | — | 3/155 |
| 4 Text ≥0.003 & classifier (old) ≥0.2 | 90.2% | 4.7% | 28% | 38/84 (45%) | 2/155 |
| 5a Classifier, expanded negatives ≥0.3 | 89.1% | 6.2% | 21% | — | 2/155 |
| **5c Combined unit, expanded negatives ≥0.25 (selected)** | **91.7%** | **4.1%** | **15%** | **17/84 (20%)** | **2/155** |

Hypotheses: (H1) more negative families help the linear classifier (3→5a: 32%→21%); (H2) text support, head confidence and best catalog similarity are complementary to the raw embedding (5a→5c: 21%→15% with lower rejection). Phone/tablet dev3: Top-1 67/78 in both D and the selected gate (5 vs 1 rejected). Threshold 0.25 and 0.3 give identical stocked results on the folds; 0.25 was chosen because 0.3 rejected the owner mouse screenshot (family evidence 0.276) that D answered with Logitech mice.

**Selected design (D-specific, versioned).** `models/relevance-siglip2-d2` (git-ignored artifact): D's unchanged head plus `family_gate.safetensors` (SHA-256 `e7535c230366e9dd17d199b9d609fd64047f7cfe0121bdf9ae3877cacef09fdc`, 141 KB; 45 supported-family prompt embeddings + one logistic unit over 771 inputs) and `relevance.json` with new optional keys `familyGateSha256` and `minFamilyEvidence: 0.25` (version `siglip2-b16-p256-d1-family-gate-v1`). Built by `training/build_family_gate.py` (578 positives, 751 negatives; two builds gave the same SHA-256). Below the threshold the service returns no products **and no category fallback**; the fallback otherwise works as before. `relevance-siglip2-d1`, C and EfficientNet artifacts load and behave exactly as before (keys absent ⇒ gate off). Public API shape unchanged; the log event gains `familySupported`. Served code vs development code: 0 decision mismatches on 710 dev rows.

**Cost (CPU, 8 threads idle machine; Steam idle, no game running).** Gate per query p50 0.37 ms / p95 0.87 ms vs 0.13 / 0.44 ms for D's head alone (+0.24 ms median); peak Python allocation of the gate step ~62 KB; artifact +141 KB; cold load 1.0 s (unchanged); full encode p50 ~0.30–0.32 s.

**Tests.** ai-service `pytest` all pass (new family-gate tests: off without keys, evidence threshold, fails closed without evidence, refuses bad hash/threshold/shapes/missing file); `ruff check`, `ruff format --check` on changed files, `mypy --strict app` clean. Backend `vitest src/integrations/ai`: 116/116.

**Live QA (React :3200 → Express :5200 → FastAPI → disposable pgvector, D + d2 gate in QA only).** Owner photos: controller/console → PlayStation 5; JBL speaker → 4 JBL; laptop → MacBook Airs; Wi-Fi extender → TP-Link Archer; tablet → Galaxy Tab S9; mouse screenshot → 6 Logitech mice (screenshot crop, not a camera verification). Browser (in-app pane, real UI, file supplied by script): typewriter → "No similar products found" with capture tips; electronic dictionary → no match; mouse screenshot → 6 Logitech products. Both unstocked browser photos are development photos (UI smoke only, not a generalization claim). Live phone/tablet dev set (78): phones Top-1 50/53 (1 rejected), tablets 17/25 (4 rejected; D: 50/53 and 17/25 with 0 and 1 rejected), end-to-end p50 0.27 s / p95 0.31 s. **Physical-camera capture/retake: NOT VERIFIED** (needs the owner's real device with camera permission).

**Benchmark 4 (single run, after selection).**

| Population | D (reference) | Selected D2 | Gate |
|---|---|---|---|
| Stocked Top-1 / Top-3 | 66/69 (95.7%) / 66 | 59/69 (85.5%) / 59 | ≥80% ✔ (prefer ≥90% ✘) |
| Stocked rejected | 3/69 (4.3%) | **10/69 (14.5%)** | ≤5% **✘ FAIL** |
| Correct-category share of shown products | 0.986 | 0.992 | — |
| Unstocked electronics accepted | 82/115 (71%) | **21/115 (18.3%)** | ≤20% ✔ |
| — of which unseen families | 45/62 (73%) | 16/62 (26%) | — |
| Unrelated accepted | 0/40 | 0/40 | no worse ✔ |

New stocked rejections: 3 smartphones, 3 printers, 1 smartwatch (plus D's 3). Remaining unstocked acceptances concentrate on fitness trackers (8/8, wrist bands close to the stocked smartwatch family), USB flash drives (5/6, close to portable SSDs) and hard disks (2/3). Development folds predicted 4.1% stocked rejection; the benchmark shows 14.5%, so the dev known set (193 photos, 16 from round 4) under-represents the stocked appearance variety the gate must accept. No tuning on Benchmark 4 was done after the run.

**Recommendation: REQUEST FURTHER QUALITY CHANGES.** The detector substantially fixes misleading results for unsupported devices (71% → 18% accepted) without unrelated-object regressions, but it rejects too many genuine stocked photos (phones, printers) to replace D. Per the stopping rule no further collection or training was started. Architect options: accept a higher no-match rate for stocked photos, or fund a stocked-photo expansion (positives) before another gate round with a new locked benchmark.

## Task 04.2-Q — Candidate D3 targeted correction and Benchmark 5 (2026-10-27)

Scope: one bounded round authorised by the Architect decision "Candidate D2 rejected for promotion". Disposable QA only;
Candidate C stays STAGING in shared DEV; no shared DEV index change, no PROD write, no migration, no commit.

### Diagnosis of D2 false rejections (development data only)
- Positive coverage was the main gap: before this round the development set held 3 printer, 1 smartwatch and 3 smart-home
  stocked photos, and training positives held 9 printer and 13 monitor/headphone photos.
- Out-of-fold ablation on the existing folds: raw embedding only rejected 3.6% stocked / accepted 22% unstocked; the three
  scalar inputs only 5.2% / 22%; raw + text 2.6% / 18%; all inputs (D2) 4.1% / 15%. No single input explains the rejections.
- The development folds did not reproduce Benchmark 4's 14.5% stocked rejection (D2 recipe: 4.4% on development), so the
  development distribution remains easier than the independent benchmarks.

### Data (realphoto-v6)
- Licensed Commons/Openverse photos (CC0, PD, CC BY, CC BY-SA only), reviewed by eye on numbered contact sheets
  (`review_keep.py`): 1,208 stocked photos kept across all 15 catalog categories, 10 reserved unseen families
  (VR headset, power bank, robot vacuum, electric shaver, alarm clock, hearing aid, sewing machine, car stereo,
  metal detector, electric toothbrush), 11 unstocked families, 150 unrelated objects.
- `build_benchmark4.py` (now with `--bench-prefix/--dev-prefix`) excluded 762 photos already used (same file or page),
  654 from already-used source groups and 5 near-duplicates. Result: development `dev6` 155 photos (148 stocked),
  locked Benchmark 5 with 201 photos, manifest SHA-256 `de1e87ed5763f44d9076dbc39fba422d2ee6dc6f0349f0400133ac324e671fa1`.
- Limitation: the exclusion left thin development coverage for smart-home (1), tablets (4), smartwatches (6), and the
  benchmark has only 3 speaker and 3 CPU photos.

### Candidate comparison (common family/source-disjoint development folds, 341 stocked, 369 unstocked, 155 unrelated)
| Candidate | Top-1 | Stocked rejected | Unstocked accepted | Unrelated accepted |
|---|---|---|---|---|
| D | 93.5% | 1.2% | 74% | 6/155 |
| D2 recipe, 0.25 | 91.8% | 4.4% | 16% | 2/155 |
| Category-balanced, 0.30 | 91.8% | 4.1% | 20% | 2/155 |
| Balanced + stocked rescue, 0.25 | 92.7% | 2.9% | 30% | 2/155 |
| **D3: D2 recipe + new positives, 0.35** | **92.1%** | **3.8%** | **18%** | **2/155** |

Rescue rule rejected (re-admits typewriters and other unsupported families). Weight decay 1e-2 changed nothing.

### D3 artifact
- `models/relevance-siglip2-d3/` (git-ignored), version `siglip2-b16-p256-d1-family-gate-v2`, threshold 0.35,
  family_gate SHA-256 `be4e874667e7ab86742805788b7055d427eba8018dead5543b4755fdf7ba952a`; a clean rebuild reproduced the same
  hash. D and D2 artifacts unchanged (D2 gate still `e7535c23…`).
- pytest all pass, mypy --strict clean, ruff clean on changed app/training files. Served-vs-numpy parity: 1 boundary
  mismatch in 865 rows. Gate p50 0.36 ms (D2 0.42 ms), peak ~62 KB, cold start 1.0 s, encode ~0.32 s.

### Live QA (disposable stack :3200 → :5200 → QA AI service with D3)
- Development phones/tablets: phones Top-1 50/53, 1 rejected; tablets Top-1 17/25, 3 rejected (D2 4, D 1). End-to-end
  p50 0.32 s, p95 0.47 s.
- Owner photos preserved: controller → PlayStation 5; router, tablet, laptop, soundbar, mouse screenshot unchanged;
  typewriter and dictionary → no match.
- Browser: paste, submit, Replace (typewriter → no-match guidance), Remove, Escape verified. AI outage: photo search 503
  `IMAGE_SEARCH_UNAVAILABLE` in 0.05 s while suggestions, text search and categories returned 200.
- Not verified: drag/drop (synthetic drop not accepted by the drop zone), the automated isolated Playwright suite (its runtime
  preflight requires the authenticated diagnostic token), physical camera capture.

### Benchmark 5 (single run, D3 selected on development data)
| Population | D | D2 | D3 |
|---|---|---|---|
| Stocked Top-1 | 97/103 (94.2%) | 94/103 (91.3%) | 93/103 (90.3%) |
| Stocked rejected | 3/103 (2.9%) | 6/103 (5.8%) | **7/103 (6.8%) — fails ≤5%** |
| Unstocked electronics accepted | 32/64 (50%) | 7/64 (10.9%) | 10/64 (15.6%) |
| Unseen families accepted | 27/53 | 5/53 | 8/53 (15.1%) |
| Unrelated accepted | 2/34 | 0/34 | 0/34 |

D3 rejections: networking 2, monitors 2 (also rejected by D), smartphone 1 (also by D), laptop 1, keyboard 1. No printer,
smartwatch or tablet was rejected. D3 still accepts 6/9 VR headsets.
Outcome: D3 meets Top-1 and both unstocked gates but fails the stocked-rejection gate. Per the stopping rule no further
collection or tuning was started.

### Task 04.2-Q — Truthful uncertainty UX and real-browser QA (2026-10-27)

Architect decision after Benchmark 5: model iterations stop; D3 stays in disposable QA; Candidate C stays STAGING and inactive in shared DEV (no activation, no migration, no PROD, no commit).

**Metric integrity.** D3 fails the ≤5% stocked-rejection gate on Benchmark 5 (7/103 = 6.8%; D 3/103, D2 6/103). A rejected stocked photo remains a false rejection even though the no-match state offers manual search or browsing. Those actions are not counted as matches.

**Changes (frontend only, no API contract change).**
- `apps/frontend/src/features/search/discovery/DiscoveryImageMode.tsx`: the no-match description no longer asserts that nothing in the catalog is close. It says no confident match was found and that this does not always mean the product is not sold. The existing title, announcement and three actions (Try another photo, Search by text, Browse products) are unchanged; no nearest neighbours are shown.
- `apps/frontend/src/features/search/discovery/discovery.test.tsx`: the "not enabled" test now sets `VITE_IMAGE_SEARCH_ENABLED=false` explicitly; it previously passed only when the local `.env` left the flag off.

**Automated suite.** The earlier preflight failure was environmental: the Docker QA launcher writes its token to `apps/backend/.isolated-docker/runtime-token.txt` (not `.isolated/`), a `tsx watch` reload left the QA backend on :5200 with a stale token (EADDRINUSE), and the ad-hoc frontend on :3200 listened on `::1` only. Restarted with the documented method (`npm run dev -- --host 127.0.0.1 --strictPort` with `E2E_FRONTEND_PORT=3200`, `E2E_API_PROXY_TARGET`) and `ISOLATED_RUNTIME_TOKEN_FILE`; no authentication or security control was weakened. `discovery-image.isolated.spec.ts`: 6 passed / 1 skipped with the AI service up (`ISOLATED_MODEL_VERSION_PREFIX=siglip2`), and 6 passed / 1 skipped (live-model test) with `ISOLATED_AI_DOWN=1` and the service stopped. Vitest `src/features/search`: 65 passed; `tsc` and ESLint clean.

**Real-browser drag-and-drop.** Chromium `Input.dispatchDragEvent` with real file paths onto the drop zone (not a synthetic DOM event): preview appeared and the search ran for all five files.

| File | Result |
|---|---|
| Owner tablet photo | 12 products, top 3 Samsung Galaxy Tab S9 / S9 / iPad 10 |
| Dev phone photo | 12 products, top 3 iPhone 16 / iPhone 16 / Galaxy S24 |
| Owner typewriter (unsupported) | No similar products found; 3 recovery actions |
| Benchmark 5 stocked photos D3 rejected (2 files, UI behaviour only, not scoring) | No similar products found; 3 recovery actions |

Text search "iPhone 16" returned suggestions and the search page, and a product card opened its product page. Camera capture/retake uses the virtual device only; the physical camera is NOT VERIFIED and needs the owner on a permission-enabled device. The screenshot crop of the owner's mouse photo is not the original camera file.

### Task 04.2-Q — Runtime trace and MAIN DEV vs D3 QA comparison (2026-10-27)

Measured with identical files through `POST /api/search/image`, once via `localhost:3000` and once via `127.0.0.1:3200`. No activation, pointer change, migration, PROD write or commit.

| Chain | Frontend | Backend | AI service | Model version returned | Embedding version returned |
|---|---|---|---|---|---|
| MAIN DEV | :3000, image search enabled | :5000 | :8000 (stopping :8000 made :3000 photo search return 503, so the link is verified) | `effb0-commons-v2` | `effb0-commons-v2-3224d2cc9e57` |
| D3 QA | :3200, image search enabled | :5200 | :8200 with the D3 gate (`relevance-siglip2-d3`) | `siglip2-b16-p256-d1` | `siglip2-b16-p256-d1-b3900dd9fad5` |

Conclusion: both chains are wired as intended. :3000 runs the original ACTIVE model with no relevance gate, so owner results there are unchanged by D3 by design. Candidate C and D3 are not active in shared DEV.

### Task 04.2-Q — D3 shared-DEV staging: PREPARED, NOT EXECUTED (2026-10-27)

No shared DEV write was made. Read-only verification only.

- Artifact `models/siglip2-b16-p256-d1`: descriptor embeddingVersion `siglip2-b16-p256-d1-b3900dd9fad5`, artifactSha256 `b3900dd9…243a` (manifest hash over `weights.json`-listed files, verified by the loader at service start), preprocess `siglip2-rgb-r224-bilinear-norm05-v1`, dimension 256.
- Gate `models/relevance-siglip2-d3`: `head.safetensors` `db8acc3a…6587`, `family_gate.safetensors` `be4e8746…952a`, version `siglip2-b16-p256-d1-family-gate-v2`, minFamilyEvidence 0.35. Files hash to the values recorded in `relevance.json`.
- Catalog baseline: shared DEV (:5000) and QA (:5200) both list 206 visible products with identical slugs, but only 79 of 206 product UUIDs match. The QA D3 index is therefore NOT transferable; D3 must be ingested against shared DEV's own `ai.catalog_images`.
- Staging mechanism (existing, no migration): `python -m app.ingest stage --artifact-dir models/siglip2-b16-p256-d1 --catalog-root apps/frontend/public` with `AI_VECTOR_INGEST_DATABASE_URL` (role `ai_vector_ingest`); registers a separate STAGING version, upserts idempotently, never touches other versions' rows.
- Activation/rollback (admin role, second owner decision): `activate --embedding-version <v>` refuses unless stored = expected = eligible, flips `ai.active_index` in one locked transaction and records `previous_version`; `rollback` restores it.
- Coherence: the gateway requires the ACTIVE row to equal the loaded descriptor. If the pointer flips before the :8000 service is restarted on D3 (or vice versa), photo search returns 503 until they agree; it never serves mixed versions.

### Task 04.2-Q — Candidate D3 STAGED in shared DEV (2026-10-27, owner-authorised, staging only)

Executed by the owner in their own terminal through the repository operator tool `apps/backend/scripts/ai-vector-dev.cjs exec --` (approval flag `AI_VECTOR_DEV_APPROVED=pzxekjybdiulzmssalfo`) running a process-scoped helper kept outside the repository. The helper deleted the injected admin and reader DSNs before any Python ran; only `AI_VECTOR_INGEST_DATABASE_URL` was used, and it was cleared when the run ended. The redacted `report.txt` contains no connection string or password. An earlier attempt failed at connect time (relative `sslrootcert`) before any write; the helper now uses an ASCII-path copy of the public Supabase CA.

| Item | Verified result |
|---|---|
| DEV project / role | `pzxekjybdiulzmssalfo`; `current_user = ai_vector_ingest`; PROD ref absent from the connection |
| Role check (`ai-vector-dev.cjs check`, read-only) | both AI roles LOGIN; `anon`/`authenticated` no `ai` usage; reader cannot read `users`; ingest cannot update `products`; pgvector 0.8.2 |
| Staging guard | trigger `embeddings_staging_only` present and enabled on `ai.product_image_embeddings` |
| Eligible catalog (DEV authoritative, `ai.catalog_images`) | 412 images / 206 products; every source file readable (0 unreadable); equals the ACTIVE version's expected 412 |
| Artifact contract | `siglip2-b16-p256-d1-b3900dd9fad5`, dim 256, preprocess `siglip2-rgb-r224-bilinear-norm05-v1`; gate `head`/`family_gate` checksums match `relevance.json` |
| D3 job | stage exit 0; `COMPLETED`; planned 412, succeeded 412, skipped 0, failed 0; source digest `55d36d92…2306b` |
| D3 staged version | `siglip2-b16-p256-d1-b3900dd9fad5` status **STAGING**, expected 412, 412 vectors, 206 products, all 256-d, metadata equals descriptor, 0 of 412 stored image checksums differ from the files |
| ACTIVE | still `effb0-commons-v2-3224d2cc9e57` (ACTIVE, 412/206); content fingerprint before and after identical (412 rows, md5 prefix `68e70c54c26b`) |
| Candidate C | `effb0-realphoto-c2-b6f83c9c224b` still STAGING (412/206); fingerprint identical before and after (md5 prefix `9855d785a536`) |
| `localhost:3000` | a real request still returns `effb0-commons-v2` / `effb0-commons-v2-3224d2cc9e57` |
| Not performed | activation, `ai.active_index` change, `:8000` switch, migration, PROD access, Git operations, training |

Remaining blockers for activation: owner acceptance of D3's 6.8% (7/103) stocked rejection against the 5% requirement; a second explicit DEV activation authorization.

Proposed, NOT executed, DEV activation: (1) admin role runs `python -m app.ingest activate --embedding-version siglip2-b16-p256-d1-b3900dd9fad5` (refuses unless stored = expected = eligible = 412; one locked transaction; records `previous_version`); (2) immediately restart the `:8000` service with `AI_MODEL_ARTIFACT_DIR=models/siglip2-b16-p256-d1` and `AI_RELEVANCE_ARTIFACT_DIR=models/relevance-siglip2-d3`; (3) re-run the owner-photo comparison on `:3000`. Between (1) and (2) photo search returns 503 because the service's identity no longer matches the ACTIVE row (fail closed, never mixed). Rollback: `python -m app.ingest rollback` (restores `effb0-commons-v2-3224d2cc9e57`), then restart `:8000` with the original model and no D3 gate.

### Task 04.2-Q — Candidate D3 ACTIVATED in shared DEV (2026-10-27, owner-authorised, DEV only)

Owner decision: reversible DEV-only activation with explicit acceptance of the measured 6.8% (7/103) stocked rejection against the original ≤5% limit. This is a documented DEV exception, not a pass of the gate, and not a PROD authorisation.

Executed by the owner through `apps/backend/scripts/ai-vector-dev.cjs exec --` running a helper kept outside the repository (admin and ingest credentials injected by the repository tool for that process only; stripped from the restarted service's environment; cleared afterwards; report redacted).

| Check | Verified result |
|---|---|
| Preflight (before any change) | connections DEV and not PROD; ACTIVE `effb0-commons-v2-3224d2cc9e57`; Candidate C STAGING 412/206; D3 STAGING 412 vectors / 206 products, 256-d, checksums and source files match; staging guard enabled; no RUNNING ingestion job; a real `:5000` request still returned the original model |
| Activation | `python -m app.ingest activate --embedding-version siglip2-b16-p256-d1-b3900dd9fad5` as the admin role: `{"active": D3, "previous": "effb0-commons-v2-3224d2cc9e57", "vectors": 412}` |
| Version states after | D3 ACTIVE; `effb0-commons-v2-3224d2cc9e57` RETIRED (its 412 vectors retained; rollback target); Candidate C STAGING 412/206 |
| Service | only `:8000` restarted, with `AI_MODEL_ARTIFACT_DIR=models/siglip2-b16-p256-d1` and `AI_RELEVANCE_ARTIFACT_DIR=models/relevance-siglip2-d3` supplied as process environment; `apps/ai-service/.env` unchanged. The gateway requires the ACTIVE row to equal the loaded descriptor, so a mismatched pair returns 503 and never mixed results |
| Real request through `localhost:3000` | model `siglip2-b16-p256-d1`, embedding `siglip2-b16-p256-d1-b3900dd9fad5` on every one of 14 requests; every returned product id exists in the DEV catalogue (0 unknown) |
| Rollback | not needed; not performed |
| PROD, migrations, Candidate C, Git | untouched |

Owner photographs through `localhost:3000` (identical files; real browser screenshots in the session scratch folder): controller → PlayStation 5 only (1); Xbox console → PlayStation 5 only (1; a different brand, not an exact match); speaker → JBL Bar 300, Flip 6, Go 4, Boombox 3 (right category, brand-specific); laptop → MacBook Air ×5; Wi-Fi extender → TP-Link Archer routers ×6 (routers are not the same product type as an extender); Samsung tablet → Galaxy Tab S9 ×2 then iPad 10; mouse screenshot → Logitech M720, Lift, MX Anywhere 3S, M650, MX Master 3S; phones → iPhone 16 / Galaxy S24; iPad and tablets → iPad Air / iPad 10; one tablet photo → no match (known false rejection); typewriter and dictionary → no match with the three recovery actions. Text search ("iPhone 16": results and suggestions) and browsing (products, categories) work, and a result opens its product page.

Limitations kept: 7/103 stocked rejection (6.8%) above the 5% gate; wrong-brand/near-category answers listed above; physical-camera QA NOT done (one virtual-camera pass only). Operational caveat: if `:8000` is restarted without those two environment overrides it loads the old model from `.env`, the identity check fails and photo search returns 503 until `.env` (or the launcher) is updated; that configuration change is not yet authorised. Rollback: `python -m app.ingest rollback` as the admin role (restores `effb0-commons-v2-3224d2cc9e57`), then restart `:8000` without the overrides.

## D3 configuration persisted for the :8000 service

`apps/ai-service/.env` now sets only `AI_MODEL_ARTIFACT_DIR=models/siglip2-b16-p256-d1` and `AI_RELEVANCE_ARTIFACT_DIR=models/relevance-siglip2-d3` (owner-run script; a full backup was kept outside the repo; no other line or secret changed or printed). After a normal restart of :8000 (no environment overrides) the service logged `ai.model_loaded siglip2-b16-p256-d1`, `ai.ready` and `ai.search_relevance` with `relevanceVersion siglip2-b16-p256-d1-family-gate-v2`, and a real request through :5000 returned `siglip2-b16-p256-d1` / `siglip2-b16-p256-d1-b3900dd9fad5`. Shared DEV ACTIVE stays `siglip2-b16-p256-d1-b3900dd9fad5`; Candidate C stays STAGING. Rollback is two steps in this order: restore the `.env` backup, then `activate-d3.ps1 -Mode rollback` (admin).

## Camera preview bug (black viewfinder) — fix and evidence

**Code findings (`DiscoveryCamera.tsx`, before the fix).** `getUserMedia` is called on mount with `facingMode: {ideal:'environment'}` on every device, so a desktop browser could pick a camera other than the user's webcam (IR/virtual). The status became `live` as soon as the stream resolved, whether or not a frame ever arrived; `play()` rejections were swallowed; a live stream that sent no frames left a black preview with an enabled shutter that silently did nothing. Only `denied`/`unsupported`/`failed` had copy, `NotReadableError` was mapped to a generic message, and only `failed` offered a retry. The actual cause on the owner's device (privacy shutter, wrong/virtual camera, another app) is **not established**; it needs the physical check below.

**Fix.** Request only a width hint on desktop and the rear camera only on touch devices (`pointer: coarse`); on `OverconstrainedError` retry with plain video. `live` is set only once the video reports a decoded frame (`loadeddata`/`playing`/`resize` with `videoWidth > 0`); after 8 s with no frame the stream is stopped and "The camera sent no picture" is shown. Specific titles for blocked, no camera, in use (`NotReadableError`/`AbortError`), no picture and failed, each with the browser error name, **Retry camera** and **Upload a photo**; no automatic re-prompting (retry is user-initiated). A track `ended` event stops to an error. **Switch camera** appears when more than one video input exists. Tracks still stop on capture, cancel, switch, failure and unmount.

**Verification actually run.** `vitest src/features/search/discovery`: 34 passed (3 new: busy + Retry camera, desktop constraints + over-constrained fallback, no-frame timeout). `tsc --noEmit` clean; `eslint src/features/search/discovery` clean. Isolated real-browser Playwright (Chromium fake device): virtual camera capture/retake/track end, and camera denial with keyboard, Escape, focus restoration and 200% reflow, both pass. The full isolated suite also reported 2 failures unrelated to the camera: the catalog-storefront home test, and the held-out-photo test that expects the QA service model prefix `effb0-commons-` while :8200 serves D3 (set `ISOLATED_MODEL_VERSION_PREFIX`); not investigated further here.

**Not verified.** Physical camera on the owner's device: PENDING. Brave/Windows physical check: open `localhost:3000`, Ctrl+K, Search by image, Camera. Expect a live picture, or a specific message after 8 s; use Switch camera if shown, and close other apps using the camera. Capture, Retake and Use this photo then go through the existing D3 flow.

## Camera closure (Architect review)

**Device blocker — physical-camera QA: BLOCKED.** The owner's Windows Camera app shows the same black picture and a "Your camera might be covered" banner (privacy shutter, keyboard camera key or camera switch), so no app receives pixels from this device. This is not an ElectroHub defect and nothing in the frontend can fix it. Physical-camera QA is not claimed as passed; it needs a working device. Software behaviour is covered by the virtual-camera tests below, which are not evidence of hardware compatibility.

**Camera changes (final).** `DiscoveryCamera.tsx`: live only after a decoded frame from an unmuted track (a muted track is not live; `unmute` can still make it live); 8 s no-picture timeout; specific messages (blocked, none, in use, no picture, failed) with browser error name, Retry camera and Upload; desktop requests no rear-facing constraint (rear only on `pointer: coarse`), over-constrained fallback to plain video; Switch camera when several cameras exist; tracks stop on capture, cancel, switch, failure and unmount. `Discovery.module.scss`: viewfinder `max-height` 38dvh so the camera controls are not clipped.

**Automated QA run.** Vitest `src/features/search/discovery`: 35 passed, including the new regression for a muted track (shutter stays disabled, no live preview, "The camera sent no picture" with Retry camera and Upload, track stopped). `tsc --noEmit` and eslint clean. Isolated real-browser Playwright `discovery-image`: 6 passed, 1 skipped (AI-outage variant needs `ISOLATED_AI_DOWN=1`), covering virtual camera capture/retake/track end, camera denial with keyboard, Escape, focus and 200% reflow, and the D3 photo-search contract.

**Test triage.**
- Photo-search test: the hardcoded `effb0-commons-` default was an outdated assertion (the QA service now serves D3). It now asserts the contract: a well-formed `modelVersion` and an `embeddingVersion` that starts with it; `ISOLATED_MODEL_VERSION_PREFIX` still pins a specific model when set. Results, product visibility and counts assertions are unchanged.
- Catalog-storefront Home test: **not a regression of this task.** It fails identically with the camera files stashed (`#home-category-grid` content not found in the responsive loop after earlier steps), no Home/storefront file is modified in this change, and the grid renders at 320/390/768/1024/1920 on a fresh load. Left out of scope.

D3 persisted configuration (above) is unchanged. ACTIVE index, Candidate C, PROD, schema and data untouched; nothing committed.
