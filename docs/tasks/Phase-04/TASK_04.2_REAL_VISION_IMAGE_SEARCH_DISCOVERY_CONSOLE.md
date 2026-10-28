# ELECTROHUB — TASK 04.2 / REAL DEEP LEARNING IMAGE SEARCH + DISCOVERY CONSOLE

**Phase:** 04 — AI and Real-Time Features  
**Task:** 04.2 — Production-Oriented Computer Vision Retrieval, Catalog Embeddings, pgvector, Express APIs, and Premium Command Search  
**Status:** IMPLEMENTATION SPECIFICATION — **not** a claim that the work or real ML training has passed  
**Prepared:** 2026-10-24  
**Proposed task/integration branch:** `feature/04.2-Real-Vision-Search-Integration`  
**Authoritative base:** **the locally verified approved integration state**, normally current `develop`; do not assume remote and local worktrees match  
**Location for repository copy:** `docs/tasks/Phase-04/TASK_04.2_REAL_VISION_IMAGE_SEARCH_DISCOVERY_CONSOLE.md`  
**Scope:** All task-owned offline data preparation, licensed-image acquisition, Kaggle GPU training and evaluation, secured artifact handoff, FastAPI CPU inference, versioned pgvector index and ingestion, Express public API/product resolution, existing Discovery Console completion, customer image-upload/camera UX, full results/navigation and end-to-end verification.  
**Exclusions:** Complete Supabase Storage product image-management automation (04.3), real personalized recommendation training/deployment (04.4), delivery tracking/maps/Socket.IO (04.5–04.7), payment/auth rewrites, production deployment, and fabricated AI matching.  
**Planning window:** Target **about five focused working days for 04.2** if the legal images and free GPU are available. The overall Phase 04 target is **14 days**, with a potential **2–3-day extension** if credible implementation/quality blockers warrant it. This is a risk-management target, not grounds to fake results, skip QA or bypass rights/production authorization.

> **Required outcome:** A customer opens ElectroHub's global Discovery Console, uploads or photographs an electronic device, and receives real, ranked, catalog-authorized products from a **fine-tuned EfficientNet-B0 PyTorch embedding encoder** and **PostgreSQL pgvector** retrieval. The system is measurable on truly held-out photographs, version-consistent, safe against hostile uploads, accessible on desktop/mobile, operational on CPU, and does not degrade core commerce when AI fails.

---

## FRONT-LOADED TASK-SPECIFIC VISUAL AND UNIT/SECURITY INVARIANTS

These are binding design and verification constraints, placed here to prevent repetitive first-review defects. Every materially executable invariant must have a matching test/smoke-evidence line in the final acceptance matrix. Do not create redundant tests for unchanged behavior without a concrete risk.

### Visual / UX invariants

| ID | Invariant | Verification |
|---|---|---|
| V42-01 | The existing **real** `DiscoveryConsole`/provider/component implementation is inspected and completed, not recreated in parallel. | Diff + rendered browser QA |
| V42-02 | Header search and `Ctrl/Cmd+K` open one consistent Discovery Console from customer pages. | Keyboard/browser test |
| V42-03 | Text suggestions, brand/category navigation and real results preserve existing contracts and URL semantics. | Search integration + browser |
| V42-04 | `/products` retains category/brand/price/availability filters, sorting and pagination; the 16 active customer categories remain discoverable via API data. | API-backed UI/E2E |
| V42-05 | Upload, drop, optional paste and camera flows work; permission denial always offers upload fallback. | Component + manual device/browser |
| V42-06 | All meaningful states — initial, input, selected, processing, done, no match, invalid image, denied camera, AI down, timeout and cancelled — are real and accessible. | State matrix + browser |
| V42-07 | A fabricated match, dummy confidence percentage, fake progress bar or success on a missing model must **never** appear in production UI. | Network/API negative tests |
| V42-08 | Dialog focus containment/return, Escape, arrow navigation, screen-reader status and reduced motion work. | Accessibility/keyboard QA |
| V42-09 | A query image is displayed without uploading until explicit search; blob URLs, camera tracks and pending requests are cleaned up. | Lifecycle tests |
| V42-10 | Existing Poppins, SCSS Modules, tokens, Radix/Lucide, surface/border/spacing patterns and square-radius brand language remain recognizable. | Design inventory + screenshot comparison |
| V42-11 | Same validated product links, current price, visibility and stock state appear in AI results and conventional catalog. | Integration assertions |
| V42-12 | Desktop, tablet and mobile layouts are genuinely usable; no hidden camera buttons, broken overlays or horizontal overflow. | Playwright/browser screenshot QA |

### ML, data, security and architecture invariants

| ID | Invariant | Verification |
|---|---|---|
| U42-01 | Real fine-tuned neural-network weights, actual training evidence and learned embeddings are required; deterministic, random or generic-only pseudo-matchers cannot satisfy 04.2. | Training run, weight-delta, artifacts, retrieval E2E |
| U42-02 | Catalog target is **all eligible customer-visible SKUs** (~206 at the recorded baseline); training scope is **only adequately licensed, well-photographed identities** (initial target 80–120, not a guaranteed count). | Catalog/rights/coverage manifests |
| U42-03 | All 166 newly generated expansion renders remain labeled **illustrative storefront assets** with **no Kaggle/ML-training authorization** at the recorded baseline. | Rights gate excludes by default |
| U42-04 | Train, validation, test-query and retrieval-gallery captures are distinct; duplicate/derivative image groups and lookalike SKU variants cannot leak across evaluation splits. | Split validator + checksums/pHash + identity-group audit |
| U42-05 | Metrics are calculated on actual independent held-out queries against a defined gallery: Recall@1/5/10, mAP and category/appearance-family breakdown. | Saved script, manifest, predictions, raw metrics |
| U42-06 | Catalog/query embeddings must share exact model, preprocessing, embedding-space version and dimension; reject mixed-version retrieval. | Schema constraint + model/index integration tests |
| U42-07 | Express remains public gateway and commerce authority. FastAPI only returns advisory product IDs/scores and model metadata. | API/permission tests |
| U42-08 | Raw uploads are bounded, sniffed, decoded safely and not retained; no raw images/vectors/secrets in logs or telemetry. | Abuse/privacy/redaction tests |
| U42-09 | The browser never receives the FastAPI internal credential, vector DB secret or unrestricted Supabase admin credential. | Build/config/network inspection |
| U42-10 | QA is disposable and independent of DEV/PROD; read-only serving credentials differ from narrowly scoped ingestion credentials. | Environment identity + negative tests |
| U42-11 | DEV/PROD migrations obey the existing protected migration approval gate; **no automatic production migration** or seed. | Gate evidence/migration diff |
| U42-12 | AI missing/slow/crashed/malformed must not stop conventional text search, products, cart, checkout, orders, Stripe/Brevo/PDF or the Express process. | AI-down smoke/regression |
| U42-13 | A usable model and compatible **complete active** index are both required for `READY`; missing or stale index reports a truthful failure mode. | Readiness tests |
| U42-14 | Actual deployed CPU inference fits measured memory/concurrency/timeout limits, or the service refuses readiness with accurate cause. | Benchmarks + load/failure smoke |
| U42-15 | `04.2` finishes the retrieval pipeline; do not misreport `04.3` Supabase Storage or `04.4` recommendation work as done. | Scope/diff review |

---

## 0. STARTING STATE — ALREADY COMPLETED VS STILL OWED

### 0.1 Verified repository facts at specification authoring

The author's read-only inspection used the **remote `develop` branch** on 2026-10-24. **The implementer must inspect the actual local worktree before using this snapshot.**

1. **04.1 approved foundation exists:** `apps/ai-service/app/main.py` app factory and lifespan; `ModelRegistry`, `ImageEmbeddingEncoder`/loader interfaces, `EmbeddingSearchGateway`, Pydantic image-search schema, private service authentication/environment binding, `/health`, `/internal/v1/ready`, `/internal/v1/capabilities`, `/internal/v1/image-search`, bounded inference executor, sanitized logs and Docker/CI. `apps/backend/src/integrations/ai/ai.client.ts` and typed/configured client exist. The image route intentionally returns unavailable/placeholder errors until a genuine model and vector index exist. **Extend; do not duplicate or remove 04.1 protections.**
2. **Catalog expansion Part 1 has been implemented and applied to shared DEV** per `docs/06_Database/CATALOG_EXPANSION.md`, with 79 new SKUs and eight new categories. Its recorded QA/DEV acceptance reports **206 customer-visible products** and **16 customer categories**. The database includes additional non-customer/test fixture rows; always query visibility/status/test flags.
3. **166 new local WebP storefront assets** were generated/validated (158 SKU views + eight category covers). The provenance ledger expressly marks these as **AI-generated illustrations**, **not authorized for ML training/Kaggle distribution**. They are not a substitute for real independent product photographs.
4. **Catalog storefront Part 2** is reported complete. Reuse actual API-driven categories and ProductCard/filter behavior. Confirm branch integration and real rendered state, not merely completion claims.
5. **Discovery Console's first implementation exists in code**: `apps/frontend/src/features/search/discovery/DiscoveryConsole.tsx`, `DiscoveryProvider.tsx`, `DiscoveryImageMode.tsx`, `DiscoveryCamera.tsx`, quick actions, localized SCSS and associated utilities. The current `/search` and Products surfaces were modified to coordinate with it. **But the owner has not yet seen/accepted the actual new UI in the running frontend**: first job is to locate its entry/wiring and verify an actual browser-visible build rather than treating it as finished.
6. **Owner Kaggle setup complete:** Kaggle account signed in, T4 ×2 accelerator selectable, 30 free GPU hours/week shown at setup. This is account readiness, **not evidence of a successful training run**. No assumed training dataset, weights, metrics or indexed model exist yet.
7. **Local hardware:** HP Core i7/16 GB RAM, Intel UHD integrated graphics; use existing Python 3.12 for local development where supported and Docker/CI Python 3.11 for compatibility. No new permanent 3.11 laptop install is required. Use Kaggle Free for offline GPU work; online serving is CPU-first.
8. **DEV/QA:** MAIN DEV React `:3000` → Express `:5000` → approved Supabase DEV; isolated QA React `:3200` → Express `:5200` → local disposable PostgreSQL `:55434`, with a separate QA AI service credential/instance. Expected Supabase refs are DEV `pzxekjybdiulzmssalfo`, PROD `yepfgjehdstlxbpespun`; verify identities through trusted tools, not text alone.

### 0.2 Existing branch and multi-agent coordination

Previously created branches include `feature/Catalog-Expansion-Real-Product-Media`, `feature/Real-AI-Image-Search-Command-UI`, and `feature/FastAPI-AI-Service`. At authoring time, their remote refs were **behind** remote `develop`, indicating relevant work may already have been integrated. Local branches/worktrees may nevertheless have additional uncommitted changes. **Do not branch blindly from one of those older feature heads.**

Propose `feature/04.2-Real-Vision-Search-Integration` **only after** confirming the approved local integration base and ownership. If the current command-search branch still has relevant unmerged local edits, safely use the approved dependent-worktree strategy; no resets, implicit merges or lost work. One writer per shared file. `AGENTS.md`, `AGENT_COORDINATION.md`, Task 04.1 evidence, current review prompt and relevant ADRs govern protected files.

### 0.3 What remains in Task 04.2

- Audit all eligible customer catalog identities, SKU/image relationships, photos, image rights, source duplicates and appearance-family groups.
- Collect/approve **authentic**, model-correct, independently captured/licensed photographs; prepare Kaggle-private dataset/manifest/splits and a truthful readiness gate.
- Create notebook and training pipeline, run **actual Kaggle GPU training**, benchmark frozen baseline, perform genuine EfficientNet-B0 fine-tuning, evaluate and export versioned safe weights/artifact metadata.
- Implement pgvector schema and controlled ingest/active-version management; verify retrieval with the real model.
- Complete private FastAPI image-processing inference and Express public upload/ranking/product-resolution endpoints.
- Finish, integrate and **show in the actual browser** the Discovery Console first implementation with real backend results, camera, reliable failure states, Products and full-results continuity.
- Add focused tests, performance and security checks, Docker/CI, isolated QA and concise handoff evidence.

---

## 1. REPOSITORY-FIRST EXECUTION CONTRACT

**First action, before edits/migrations/notebook publication:**

```bash
git remote -v
git status --short --branch
git branch -vv
git worktree list --porcelain
git rev-parse HEAD
git rev-parse origin/develop
git diff --stat
git diff --check
git ls-files --others --exclude-standard
```

Fetch only when safe (`git fetch --prune origin`). Inspect changed/untracked code and worktree ownership; never checkout across someone else's current Codex/Claude workspace. Read:

- Full Task 04.2 spec and the attached user's **actual requirements** (real model + command search; avoid reference to pasted attachment filenames).
- `AGENTS.md`, `AGENT_COORDINATION.md`, relevant current developer/review instructions.
- `docs/07_AI/{IMAGE_SEARCH,FASTAPI,MODEL_FLOW}.md`, AI and database/security architecture, latest `TECH_STACK.md`.
- `docs/tasks/Phase-04/TASK_04.1_FASTAPI_AI_SERVICE.md` and accepted implementation evidence.
- `docs/06_Database/CATALOG_EXPANSION.md`, actual catalog seed/media provenance files and Part 2 frontend handoff.
- Relevant live source in `apps/ai-service`, AI Express client, `prisma/schema.prisma` and migrations, Discovery Console, search page, catalog and UX testing.
- The effective current CI workflow, DEV/QA runbooks, Figma design source if available and direct dependencies.

**Focused inspection only.** Read additional files only if directly relevant to behavior, schema compatibility, security, customer data visibility, failure isolation or regression evidence. No broad Stripe/Brevo/payment audits unless a concrete 04.2 regression demands them.

**Plan Mode:** Produce a one-page dependency-aware architecture/implementation plan after actual inspection, not another rewrite of the requirements. Confirm agent file ownership; identify external rights/Kaggle authorization checkpoints, migrations and API contract, test strategy and rollback. Execute independent scoped work in parallel; integrate only when contracts are agreed. The task is not complete merely because the plan or prototype exists.

Suggested specialists: ML/data (training + provenance), DATABASE/pgvector (migration + indexing), FastAPI/Express (security/contracts), FRONTEND/UX (Discovery Console), QA (test/CI/browser). Critical shared contracts and source are serialized and owned by the lead. Use available model/agent capabilities, no invented model names or redundant competing agents.

**Git control:** Source/test/docs changes within assigned files allowed by implementation owner; no commit, push, merge, deploy or branch reset without separate owner approval. Live PROD DDL/DML explicitly not authorized. Shared DEV changes only after verified gates described below.

---

## 2. ARCHITECTURE AND DATA FLOW

```text
OFFLINE / TRAINING (Task 04.2)
  DEV catalog 206 eligible target SKUs / 16 categories (read-only inventory)
    + rights-approved authentic photographs / independent query captures
    -> provenance ledger -> exact/pHash dedup -> appearance groups
    -> train/validation/test_queries/gallery + holdout identity groups
    -> private Kaggle input dataset (no secrets, no customer photos)
    -> GPU PyTorch EfficientNet-B0 baseline / fine-tuning
    -> independent retrieval evaluation -> versioned artifact & SHA256
    -> trusted offline promotion/reproducible inference build
    -> approved bounded embedding generation/ingestion
    -> versioned, staged pgvector rows -> atomic active index pointer

ONLINE / CUSTOMER (not Kaggle)
  Header search / Ctrl+K / camera / file -> React Discovery Console
    -> Express PUBLIC route POST /api/ai/image-search
       signed-in or guest policy, rate limits, size/type/abuse bounds
    -> Express PRIVATE AiServiceClient -> per-env authenticated HTTP
    -> FastAPI POST /internal/v1/image-search
       safe decode -> same trained encoder / preprocessing
       -> L2 normalized query vector -> active-version pgvector ANN/exact
       -> ranked image/product references + finite scores + descriptor
    -> Express fetches real Product/ProductImage/Inventory via Prisma
       validates UUIDs, ACTIVE/visible/non-fixture/permission/stock policy
       groups by product, rejects stale/unauthorized, preserves relevance
    -> React renders true product cards + navigation

OUTAGE: 503/unavailable image search -> honest retry/text fallback
        ALL commerce/catalog/text-search paths remain operational.
```

### 2.1 Ownership and trust boundaries

| Layer | Owns | Must not own |
|---|---|---|
| React | Photo selection/camera, client UX validation, upload/cancel, text suggestions, display | FastAPI secret, vector DB credentials, price/stock authority |
| Express | Public HTTP, auth/guest decision, streaming size/rate bounds, API client, catalog eligibility, price/stock, public response | Training or raw neural embedding computation |
| FastAPI | Trusted model loader, decoding/preprocess, inference, versioned vector retrieval, safe candidate ranks, readiness | Commerce authentication, product updates, orders, inventory changes, customer data ownership |
| AI read-only pgvector adapter | Model/index descriptor checks and nearest neighbors | General public schema writes, orders/auth/payment access |
| AI ingestion process | Approved product-image projection into **staged** embedding version | User/order data, arbitrary DB DDL, uncontrolled reindex on every request |
| Offline Kaggle | Training/evaluation, non-public checkpoint output | Online inference, customer uploads, production DB credentials |
| Prisma/commerce DB | Authoritative customer-facing catalog, ownership and stock | Trusting scores as purchasability or accuracy probabilities |

### 2.2 Cross-task contracts

- **04.2 owns:** real vision search, dataset/training/model/promotion, versioned vector search, catalog ingestion bootstrap and command-search completion.
- **04.3 owns:** Supabase Storage product image hosting, admin upload lifecycle and automated embedding refresh/invalidation. Design a documented idempotent refresh interface in 04.2; do not preempt 04.3.
- **04.4 owns:** actual ML recommendations and behavioral personalization; it may reuse the stable visual encoder and embedding version. Do not turn `POST /internal/v1/recommendations` into fake image-search results.
- **04.5–04.7:** delivery status/Leaflet/Socket.IO remain outside scope. Protect their route/secret separation.

---

## 3. CATALOG DATASET AUDIT AND TRAINING READINESS (DAY 2)

### 3.1 First inspect **all 206 target products**; distinguish retrieval from fine-tuning

Query approved DEV **read-only** (or an equally current verified source), and export a **sanitized** `catalog_products.csv` with stable product UUID, SKU, category/brand, exact model, active/visible/test status, physical appearance family and permitted source image IDs. Do not export user/orders/payment/customer data. Reconcile the 206 catalog target against **actual current** visibility, not an arbitrary hardcoded total.

Audit:

- 16 real customer categories, not fixture/acceptance categories.
- Product identity and visual identity; color, model, storage/memory, capacity and region variants.
- Generated vs genuine photos; product-specific vs generic category stock.
- Duplicate images assigned to multiple SKUs, broken assets, mislabeled brands/models, synthetic composition and wrong views.
- Exact/near-duplicate SHA-256 and perceptual clusters; visually indistinguishable color/storage variants must be tracked and evaluated honestly.
- Rights: storefront display, ML training, private Kaggle upload/third-party processing, local retention and redistribution are **separate** authorizations.

**Interpretation:** All 206 (or current eligible count) are a **catalog retrieval/indexing goal**. Initial supervised fine-tuning should focus on approximately **80–120 distinct, adequately photographed, rights-approved products**, if attainable; 40–60 can serve as a limited feasibility benchmark, not a complete acceptance claim. Five-plus **independent actual photographs** per training identity are a useful ambition, **not an invented assertion of coverage**. Never build “five independent samples” from five AI-generated views or crops of one photograph.

**Critical:** Product storage/color variants might be invisible or indistinguishable in photographs. Define **appearance-family relevance** separate from **exact SKU relevance**. A 128/256 GB variant with identical casing often cannot be identified from an unmarked front view. Show visually similar results and exact-SKU recognition only when the image supports it. Catalog includes different variants with shared real-device appearance; do not inflate SKU recall or leak appearance variants between identity-holdout splits.

### 3.2 Data sourcing and owner checkpoints

Valid sources are explicitly approved owner photographs or verified photos whose licenses/permissions allow **training and uploading to private Kaggle datasets**, with separate commercial-site usage rights if used as storefront imagery. Official product pages are **specification references**, not automatically rights to copy/manipulate images. No copyrighted scraped images on the assumption that a source is publicly accessible; do not bypass access controls or robots/terms. No customer-uploaded search images in training without separate affirmative consent and a specific data policy.

Maintain a photo-rights ledger. For each asset record: source URL/owner; captured/obtained date; copyright holder; precise license/permission proof; allowed training, third-party GPU/Kaggle upload, public redistribution, display, modification; attribution; retention; SHA-256; dimensions; actual SKU; variant/appearance family; capture-session/source-photo group; genuineness and image-type classification; manual reviewer; decision (`approved`, `blocked`, `pending`). Default unknown rights to `blocked`.

**The 166 AI-generated storefront images are excluded** from the real-photo supervised ground truth, independent test set and public Kaggle releases. If used as a separately labeled *synthetic domain* augmentation experiment after explicit usage authorization, never mix them into purported real-photo metrics. Until rights are granted, they remain storefront-only. Do not treat owner approval of storefront images as approval of ML training.

The owner has already enabled Kaggle T4 availability, so **do not ask for repeat account setup**. Only ask when notebook/dataset access genuinely requires fresh interactive account authorization or explicit photo-rights decisions. Continue parallel UI/API/database design if collection is delayed; never claim training complete without training.

### 3.3 Leakage-resistant dataset topology and files

```text
electrohub-vision-v1/
  README.md                    # intended private use, known limitations
  dataset_report.json          # coverage, rights, duplicate clusters, splits
  manifests/
    catalog_products.csv       # product IDs, appearance family, identity metadata
    image_provenance.csv       # per-image license/source/checksum/capture group
    images.csv                 # image_id/path/SKU/group/checksum/rights
    train.csv                  # fine-tuning input only
    validation.csv             # model selection only
    test_queries.csv           # frozen unseen query captures only
    gallery.csv                # index/gallery photos disjoint from query captures
    unseen_sku_queries.csv     # SKU-disjoint generalization benchmark if possible
    split_audit.json           # split integrity, duplicate exclusions
  images/<sku-or-appearance-group>/<file> # rights-approved source photo bytes
  SHA256SUMS
```

- Validate real image bytes, EXIF orientation, format/size/pixel count, broken files and transparent backgrounds as appropriate.
- Compute SHA-256 and perceptual hashes; augmentations, crops, re-encodes, burst shots and same-origin near-duplicates belong to the same **capture group** and never cross training/validation/test boundaries. Manual spot-review borderline clusters.
- Use group-aware splitting on capture/source session; create **separate product-disjoint holdouts** to test generalization. For known-product retrieval, evaluate novel query photos against a legitimate gallery of seen identities while keeping query-photo capture disjoint from its gallery source.
- A gallery picture may represent a product that also has training pictures **only when** the query/test photos are independent, disclosure is clear and the exact evaluation protocol allows known-product retrieval. Never train on the test query/gallery pair when it is the same capture or derivative.
- Freeze test queries/relevance labels before trial-and-error tuning; don't hand-select successes after training.
- Reserve hard negatives (similar shape/brand, close models, color/appearance variants, accessories vs device) without accidentally treating correct visual relatives as unequivocal negatives.
- Protect privacy: strip personal EXIF/geolocation, exclude human customer context where possible; keep private Kaggle visibility unless all redistribution rights explicitly permit otherwise.
- Do not upload DB URLs, service secrets, credentials, private customer records or unreviewed scraped photos to Kaggle.

**Split eligibility:** With too few independent captures, mark product `index-only`, `train-only`, `not-evaluable` or `excluded`; never silently fabricate a val/test split. A small credible benchmark is better than a fabricated 206-product headline.

### 3.4 Day 2 readiness gate

Complete a **truthful** audit with: catalog target count; number of unique appearance groups; genuinely approved photo count; per-category/SKU coverage; number of independent capture groups; split leakage check; distinct query/gallery coverage; blocked/pending rights; training subset; indexable subset; confidence in any exact-SKU claims; and source verification evidence.

**Training GO** only when there is a defensible supervised objective, approved photos, non-leaking train/val/test/gallery setup and sufficient positives/negatives for the chosen loss. If not, ask for the **precise missing image/permission checkpoint**, pursue safe collection and continue independent 04.2 engineering; do not use generated images as substitute ground truth or declare a fake GO.

---

## 4. KAGGLE FREE GPU / REAL PYTORCH TRAINING (DAY 3)

### 4.1 Notebook and reproducible training layout

Prepare a version-controlled offline pipeline, e.g.:

```text
apps/ai-service/training/
  README.md                     # runbook; source and rights requirements
  requirements-training.txt    # reproducible Kaggle packages; no secrets
  notebooks/electrohub_vision_train.ipynb
  src/dataset.py               # manifest and capture-group checks
  src/model.py                 # encoder and projection head
  src/losses.py                # product-aware metric learning
  src/train.py                 # genuine optimization
  src/evaluate.py              # frozen retrieval test
  src/export.py                # signed/checksummed safe inference artifact
  src/encode_catalog.py        # later offline ingestion interface
  tests/                       # deterministic pipeline correctness tests
```

Paths are recommendations; fit repository conventions. Kaggle input contains **only rights-approved photo dataset**. Use the already enabled NVIDIA T4 accelerator (possibly T4 ×2) and PyTorch. Confirm `torch.cuda.is_available()`, actual device, free VRAM, Python/Torch/Torchvision versions and weekly quota in run metadata; two T4s do **not** automatically act as one 32 GB GPU. Use **one GPU initially** unless a measured need justifies multi-GPU complexity. No paid cloud provider or GPU charges without owner authorization. Kaggle is **offline training**; not an online production service.

Install **only** required training libraries; pin dependencies/versions after verifying compatibility in the actual Kaggle environment. Use deterministic seeds/workers where feasible, record nondeterministic operations, source commit hash, dataset manifest digest, frozen split digest, hyperparameters, epochs, optimizer, scheduler, batch size, image size, worker count, mixed precision, device and training duration. Save checkpoints periodically to persistent Kaggle output/approved local storage because notebook sessions can disconnect. Keep private rights-sensitive assets and model outputs access-controlled.

### 4.2 Required real fine-tuning strategy

**Backbone:** genuine pretrained `torchvision.models.efficientnet_b0` weights, used as a frozen feature-extractor retrieval baseline first. The final deliverable is a **fine-tuned retrieval embedding encoder**, not an ImageNet category label classifier masquerading as product search.

Model implementation:

1. Use standard EfficientNet-B0 input resizing/normalization, establish **one versioned deterministic inference transform** (e.g. 224 × 224, ImageNet mean/std if correct for the weights), with separate training-only augmentation.
2. Replace/expose the final classification path with a real projection head, e.g. 128/256-dimensional embeddings; select the final dimension **once** for SQL migration/artifact/index compatibility. L2-normalize embeddings and verify finite values/nonzero norms.
3. Choose product/appearance-family-aware metric-learning loss appropriate to label density: supervised contrastive, triplet/batch-hard or multi-similarity loss with meaningful positive and hard-negative sampling. If only category labels are credible, do not pretend exact-SKU retrieval supervision is available. Avoid negative-pair contradictions between visually indistinguishable variants.
4. First evaluate the untouched pretrained backbone on the frozen protocol. Then train projection head and unfreeze selected pretrained CNN layers to perform actual learned updates, with tracked trainable parameter groups, optimizer steps and weight-change evidence.
5. Validate each epoch on disjoint validation queries, implement early stopping, choose best checkpoint by predeclared retrieval metric (not training accuracy or arbitrary last epoch). Use mixed precision on supported GPU, sensible gradient clipping and memory-aware batch sizes after a short benchmark.
6. Run no more than the smallest useful bounded sequence of experiments without evidence. Trial classification-only training may be an auxiliary baseline but **cannot replace** metric-learning fine-tuning.
7. Optional frozen SigLIP/OpenCLIP comparison if legally/license- and time-compatible; **does not replace mandatory trained EfficientNet-B0** and must not delay end-to-end completion.

**Indicative, not hardcoded:** 5–15 epochs, 224px images, batch/accumulation sized for T4, validation-driven training; choose actual values based on dataset scale and a real time/VRAM smoke benchmark. Record learning curves, time/epoch and convergence. Never claim a training result from a notebook that was authored but not executed.

### 4.3 Metric and relevance contract

Define relevance in advance: `exact product identity`, `appearance family / visually equivalent product`, and optional `category-relevant` as *separate* measures. Main user-facing task is **visually similar product retrieval**, not reliable hidden storage capacity inference.

For frozen held-out query set compute **Recall@1, Recall@5, Recall@10, mAP**, with a clearly stated relevance set and query count. Where applicable report MRR, per-category breakdown, known-SKU vs unseen-SKU, product vs appearance-family, confidence intervals/uncertainty for small sample size, and worst-case false matches. Evaluate **same gallery and queries** for baseline vs fine-tuned; note whether baseline is stronger (do not hide regression).

Measure:

- `n_train_images`, `n_val_queries`, `n_test_queries`, `n_gallery_images`, distinct products and appearance groups.
- Known-SKU held-out query performance and generalization to completely unseen training SKU identities, where dataset supports both.
- Performance against independent non-studio/phone captures; annotate domain gaps honestly.
- Hard negatives (e.g., different devices sharing near-identical profile).
- Per-category errors/uneven coverage (all 16 catalog categories vs actual tested categories).
- Inference latency distribution on **laptop/target CPU**, not only Kaggle GPU.

**Quality gate:** Predeclare a feasible improvement/acceptability hypothesis after dataset baseline audit, and require real evidence of useful retrieval and a defensible baseline comparison. **No invented 90%/95% performance mandate** or fabricated threshold. If learned encoder is weaker, diagnose with a bounded experiment and surface true limitation; do not cherry-pick test sets, lower difficulty after seeing results or silently fall back to a simulated matcher.

### 4.4 Artifact export and chain of custody

- Export production inference weights to approved **non-executable**, non-pickle format (`safetensors` or a validated ONNX conversion); training-local `.pt/.pth` may exist for trusted offline training only, **never loaded in serving**.
- Create descriptor compatible with `app/models/descriptor.py`: `name`, `modelVersion`, `embeddingVersion`, `preprocessVersion`, `embeddingDimension`, `artifactFormat`, `artifactSha256`.
- Include JSON-safe architecture/projection metadata, training commit, dataset/split digests, complete preprocessing spec, metrics, source, license, checkpoint selection, weights checksum, recommended CPU runtime and artifact sizes.
- Validate exported artifact parity: compare deterministic embeddings from trusted training model and server/ONNX/safetensors adapter on test images under numeric tolerance; assert finite normalized vectors and correct dimensions.
- Bundle only approved weights/preprocessing metadata, not private raw photos; verify SHA-256 and trusted artifact path before load; no arbitrary URLs/untrusted deserialization.
- Promotion is a **separate explicit reviewable action** from saving training results. Artifact and active vector set must be matched and roll-backable.

---
## 5. VECTOR DATABASE / PRISMA / VERSIONED INGESTION (DAY 4)

### 5.1 Read existing schemas and migration history before designing tables

Task 04.2 introduces **only AI-specific additive schema**, referencing the existing `Product` and `ProductImage` primary keys (UUID), which remain Prisma/Express-owned. The original relational foundation belongs to Phase 02, and the 79-product seed is already separate. Avoid a second Product/Inventory catalog and do not mutate seed-generated catalog data to fit the ML design.

Read `apps/backend/prisma/schema.prisma`, migration directory, current `_prisma_migrations` ledger, AI architecture docs, actual Supabase extension support and application role policies. `pgvector` support/installation may differ between DEV and QA: check, do not assume. Use a **schema-first, reviewed migration** and Prisma-compatible raw SQL for vector types/operators. Prisma's `Unsupported("vector(N)")` or raw SQL may be needed depending on the installed Prisma/pgvector versions; verify against actual ORM/DB before settling. Avoid `prisma db push` and manual migration-history manipulation.

### 5.2 Suggested logical data model — adapt to existing SQL conventions

```text
ai_model_versions
  model_version PK
  embedding_version unique / immutable
  preprocess_version
  embedding_dimension int
  artifact_checksum SHA-256
  artifact_format / URI reference (no raw secret URL)
  training_dataset_hash, evaluation_hash
  status (STAGING / VERIFIED / ACTIVE / RETIRED / FAILED)
  created_at, verified_at

ai_product_image_embeddings
  image_id UUID / canonical source image reference
  product_id UUID -> authoritative products.id (if in exposed DB schema)
  embedding_version FK -> ai_model_versions
  image_source_checksum
  vector vector(N) NOT NULL
  eligibility/index status
  created_at, updated_at
  unique (image_id, embedding_version)

ai_ingestion_jobs / ai_ingestion_entries [as justified]
  job key, version, planned/finished/failed/skip counts
  source fingerprint, error code (no raw image/logging)
  state, attempt count, timestamps

ai_active_index
  singleton/environment-specific active embedding_version
  switched_at, activation audit metadata
```

Prefer an **AI-owned non-public schema** or equivalent restrictive grants. If foreign keys cannot span ownership/schema boundaries safely, keep canonical IDs and enforce referential integrity via the approved ingestion/Express lookup with explicit cleanup/invalidation, while recognizing the risks. Schema names are suggestions, not a requirement to add unnecessary join tables.

Required constraints:

- A version has immutable embedding dimension/preprocessing checksum/artifact identity after activation.
- No arbitrary raw user vector upload to ingestion.
- Finite embeddings of dimension `N`, expected norm (prefer normalized), and valid source-image digest.
- Unique stable image-version identity; source-image removal is reflected in eligibility or reindex activation.
- Exact-version filtering in all similarity queries; **fail closed** on mismatch.
- Unique product results, deterministic tie-breaker, max result/candidate bound; retrieve enough neighbors to compensate for inactive product filtering, then avoid duplicate cards.
- Never expose entire vector rows through public REST endpoints or browser credentials.
- Transactionally activate one complete reviewed index version; rollback to previous viable version if activation fails.

### 5.3 Similarity strategy and indexing

1. Choose normalized cosine similarity (`<=>`) or corresponding dot-product convention **consistently**; record the score conversion and its mathematical range. **Do not call cosine similarity a confidence probability**.
2. Start with **exact nearest-neighbor** distance queries for ~206 products / a few hundred source images; for this small gallery exact scan may be simpler and more faithful than prematurely using ANN/HNSW.
3. Benchmark query plans/latency under realistic concurrent reads. Adopt HNSW only if measurement warrants index complexity; record approximate-recall loss vs exact baseline and operator class (`vector_cosine_ops`) if used.
4. Parameterize SQL values (embedding version, `topK`, image identifiers). Never interpolate user-supplied SQL/identifiers or expose arbitrary PostgREST filters.
5. Group image-level distances by product before final public results; a product with six images cannot dominate six result cards.
6. Handle multiple variants within appearance family without misleading exact-SKU certainty. Relevance display should distinguish “looks similar” from unobservable variant capacity.
7. At evaluation time report retrieval before and after Express catalog filtering separately; a hidden/disabled/stock-out item should not leak through.

### 5.4 Restricted DB roles / least privilege

- **FastAPI online vector reader:** read-only, confined to AI index/projection, without permissions to orders, users, auth, payments, catalog mutation or administrative schema operations. If the vector store has to reference `products`, grant only justified read-only fields/access through an approved view/interface; prefer Express authoritative validation.
- **Offline ingestion worker:** narrowly scoped INSERT/UPDATE into staging AI tables or a controlled function, never general Prisma/commerce write authority. No migration/DDL privilege at runtime.
- **Migration operator:** separate gated elevated credential, used for reviewed migrations only.
- No general Supabase `service_role` secret in React, FastAPI or Kaggle notebook; no `DATABASE_URL`/`DIRECT_URL` commerce credentials in the AI service, preserving 04.1 startup restrictions. Add dedicated `AI_VECTOR_*` settings with validation, TLS and identity binding.
- If a Supabase exposed schema/view is used, apply appropriate RLS/GRANT policy and do not unintentionally expose vectors to `anon` or `authenticated`. Test role denial.

### 5.5 Migration and deployment authorization matrix

| Environment | Migration/index/seed action | Required gate |
|---|---|---|
| Local disposable QA (`:55434`) | Add pgvector extension/schema, resettable fixture data, ingestion and rollback | Identity confirmed disposable; isolated credentials; approved QA procedure |
| Supabase DEV | Forward-only additive pgvector migration, bounded ingestion and version activation | Verify exact DEV project, migration history/SQL/diff, source rights, backup/rollback plan, existing DATABASE/Architect protected-ownership gate, explicit scoped owner approval |
| Supabase PROD | **No automatic write/DDL/migration or live index activation** from Task 04.2 prompt | Separate reviewed PROD migration, backup/PITR and explicit authorized execution/rollout |

Do not claim DEV/PROD migration syncing merely by running one Prisma generate. Confirm actual schema and migration ledger; apply only reviewed SQL to the exact authorized target. Do not run a broad general catalog seed. Never repair drift by inserting into `_prisma_migrations`, rewriting historical SQL or using unreviewed `db push`. Avoid long locks and destructive operations; list rollback and resource limits before applying.

### 5.6 Bounded, resumable catalog embedding ingestion

Implement a deterministic CLI/job that:

1. Reads eligible **approved catalog images** via a trusted read-only catalog export/API, **not** user uploads, and captures stable product/image IDs, checksums and visibility.
2. Verifies image processing rights, source bytes, presence and exact model identity or declared illustration status; separates training eligibility from indexing. If an illustration is indexed as storefront representation, report that this may not resemble a real photograph and that no rights for Kaggle training were inferred.
3. Loads the approved **same** model and preprocessing as online inference, with matching descriptor and dimension.
4. Generates finite normalized vectors in bounded batches; records source digest, model version, success/skipped/failed counts and product/appearance family.
5. Inserts into **staging** index version, idempotently upserts by approved product image/version key, never overwrites active-version vectors in place.
6. Reconciles product/image counts and completeness; handles vanished/inactive images, duplicate URL sharing and model-mismatched sources without silent false coverage.
7. Validates nearest-neighbor queries and representative model-correct photos against actual product IDs. Verifies declared coverage of all *eligible* products (target 206, but report real count), not a fabricated guarantee.
8. Activates atomically only if measured completeness, metadata hashes, model artifact and vector descriptor all match.
9. Provides rollback/invalidation; archive/retire old version only after controlled observation window.
10. Exposes a manual safe reindex for catalog changes to serve until 04.3 adds Supabase Storage-driven auto-refresh.

An image gallery with identical generated illustrations for many SKUs will **not** guarantee exact product retrieval. Record that limitation, rank by appearance family if justified and avoid false SKU precision. **No fake embeddings, random vectors or hardcoded label-to-product mapping in active data.**

---

## 6. FASTAPI — REAL IMAGE PREPROCESSING, INFERENCE AND RETRIEVAL

### 6.1 Extend Task 04.1 foundation, do not replace it

Relevant existing code includes:

```text
apps/ai-service/app/main.py
apps/ai-service/app/api/routes/image_search.py
apps/ai-service/app/core/{config,security,middleware,runtime}.py
apps/ai-service/app/models/{descriptor,interfaces,registry}.py
apps/ai-service/app/processors/{image,inference}.py
apps/ai-service/app/services/image_search_service.py
apps/ai-service/app/integrations/vector_gateway.py
apps/ai-service/app/schemas/image_search.py
```

Keep app factory, request ID, exception shape, service-key + environment-header authentication, model lifecycle, bounded inference executor, JSON logging, health/readiness semantics, non-root Docker and 04.1 security tests.

Implement verified `ImageEmbeddingEncoder` loader for exported artifact, real image processor, restricted `EmbeddingSearchGateway`, and image-search service. `ModelRegistry` loads once per worker at lifespan start; eager verification of artifact/hash and index compatibility; fully close pooled resources at shutdown. If the active index changes, devise a consistent refresh/readiness strategy; do not leave `ready` cached as true while active version no longer matches. Multiple serving replicas/workers require coherent promotion/restart or version pinning; avoid per-request model downloads.

### 6.2 Request and response contract

**Internal route:** `POST /internal/v1/image-search`, with the current private headers (`X-ElectroHub-AI-Key`, environment binding, safe request ID), authenticated **before consuming image body**, validated query `topK`, and **bounded multipart upload** with one allowed `image` field. Do not quietly accept multiple image files or arbitrary field names. Configure route-specific size limits consistently across the 04.1 middleware and ingress proxy.

**Response:** Retain existing `DataEnvelope[ImageSearchResult]` and camelCase DTO conventions; return `matches` ranked by finite calibrated-or-uncalibrated *similarity score*, `modelVersion` and `embeddingVersion` (plus allowed metadata if justified). Internal ranked candidates must be stable real product UUIDs; if image-level references are included, mark as internal and prevent unreviewed frontend exposure. Preserve model/image-validation error codes and safe envelope contract for 400/401/403/413/415/422/429/503/504 as appropriate. Do not invent new inconsistent envelope shapes.

**Readiness:** `/health` means process alive; `/internal/v1/ready` for `imageSearch` means artifact decoded, encoder healthy, vector adapter reachable and **matching complete active version** verified. `recommendations` may legitimately remain NOT_READY until 04.4; don't report global AI service offline merely because 04.4 is pending. `/internal/v1/capabilities` advertises real supported upload types, max size, model/index version, topK cap and inferred readiness, but never secrets.

### 6.3 Image security and resource controls

- File allowlist **JPEG, PNG, WebP**, matching browser and PIL/decoder runtime; sniff signature and decoded type, don't trust extension or `Content-Type`.
- Enforce file byte budget at streaming boundaries, body size, single-image count and timeout; the UI currently uses a **10 MB** limit. Determine and document a compatible effective bound end-to-end; Task 04.1 FastAPI default is **1 MiB** and Express client default timeout **2,500ms (max configured 10,000ms)**, so **actual per-route or scoped changes are required** after CPU benchmarking. Avoid making unrelated routes unlimited.
- Enforce decoded pixel count/dimensions, decoder warnings, EXIF orientation, Unicode filenames discarded, unsupported animated/multiframe images, malformed/truncated files and decompression bombs. Explicitly refuse or deterministically normalize alpha, color space and orientation as training expects.
- No arbitrary user-supplied image URLs, fetch-from-URL, filesystem paths, zip extraction, redirects, external conversion programs, shell execution or serialized Python code.
- Bound memory/CPU/concurrency; use `InferenceExecutor` or appropriate limited worker thread instead of blocking event loop; distinguish queue saturation (429/503) and actual inference timeout (504/controlled code).
- Never store customer-uploaded raw bytes permanently, on Supabase Storage, Kaggle, model training, DB telemetry, logs or disk by default. If a bounded temp path is unavoidable, use safe permissions, lifetime and immediate cleanup; prefer in-memory bounded processing.
- Do not leak weights/filesystem paths, SQL, stack traces, image bytes, embeddings, service keys or secret addresses in logs/errors; controlled correlation IDs only.
- Validate vector norm, dimension and finiteness; reject invalid index data or shape mismatch before scoring.

### 6.4 Serving performance and packaging

- CPU-first model loading/inference on local HP hardware, with actual measured cold/warm timing; benchmark preprocessing, encoder, vector roundtrip and total service latency separately, including p50/p95/p99 where sample count supports it.
- Measure memory at idle, model loaded, concurrency 1/2/4 and cancellation/timeout; choose concurrency cap from evidence, not laptop nominal “8 GB GPU memory” shared RAM.
- Use version-pinned PyTorch/torchvision or validated ONNX Runtime CPU; small runtime dependency set. Reconcile actual safe checkpoint format with model loader. Keep Kaggle training packages out of production Docker unless runtime genuinely needs them.
- Build new Docker image, check Python 3.11 package resolution, start non-root, private networking, no automatic model downloads/no DB writes on startup, health/readiness and graceful stop; prevent accidental artefact/secret inclusion in image layers.
- Preserve independent lifecycle: online service never connects to Kaggle and never trains during a user request.

---

## 7. EXPRESS — PUBLIC SECURE IMAGE SEARCH AND CATALOG RESOLUTION

### 7.1 Entry and ownership

**Proposed public route:** `POST /api/ai/image-search` (confirm existing API namespace/route ownership first). Browser sends a single multipart image and optional validated `topK`/search context through ordinary same-origin API client; choose and document **guest vs authenticated** search policy. Product discovery commonly permits guests, but use stronger rate/abuse bounds without making a guest camera flow unusable. Apply CSRF/cookie considerations based on current app auth and read-only intent.

Reuse the existing TypeScript `AiServiceClient`, AI configuration and telemetry; extend to safe bounded `multipart/form-data` upload and real response schema, not a raw generic proxy. Avoid forwarding browser auth cookies or JWTs to FastAPI. Keep private per-env service authentication and request ID.

### 7.2 Public request pipeline

1. Enforce route-specific rate limit (guest and authenticated users), safe payload budget, accepted multipart form/count/type, request timeout and maximum simultaneous uploads. Do not buffer unbounded body before enforcement.
2. Validate file extension/type for UX but confirm actual magic bytes and decoder checks downstream; reject malformed/multi-file payloads, extra unexpected fields and empty/oversized input; no untrusted object URL fetch.
3. Normalize/marshal to internal trusted upload contract; bounded private HTTP with no cross-environment redirect or host injection. Configure connection/response timeouts from measured CPU inference budget, preserving AI-only failure isolation; do not increase checkout/payment HTTP timeouts.
4. Validate FastAPI response via Zod/strict DTO: UUIDs, version strings, finite scores/range convention, unique image/product semantics, sorted count, topK and hard limits; tolerate only documented optional fields.
5. Resolve candidate product IDs from the authoritative Prisma catalog **in one bounded query**; include active status, storefront visibility, non-test-fixture, allowed category/data, current image, brand and stock. Decide documented policy for out-of-stock search: either exclude by default or show with honest unavailable state, consistent with existing product-search behavior.
6. Group image-level hits into unique product cards, preserve model relevance ranking after filtering, stable tie-breaks and clearly state filtering/pagination semantics. Never invent products or order by stale AI prices.
7. Return the established public product-summary contract (or documented additive DTO) with real product slug/detail URL, image, actual price/availability, safe text, visual relevance rank, non-calibrated score only if explicitly justified and no secret/vector leakage.
8. Handle client cancellation, FastAPI unavailable/503 index mismatch/invalid response/timeouts and internal rate-limit responses with stable machine-readable public errors. UI gets retry/text-search fallback. Express app remains available.

### 7.3 Security and telemetry specifics

- Service credential is server-only. No direct public FastAPI/pgvector connection.
- Correlation ID is length/pattern bound. Log only operation, sanitized status/outcome, elapsed ms, model version, candidate count, rejection categories and aggregate timing; **no raw image, image filename if sensitive, embedding, customer name/email, JWT, DB URL or secret**.
- Upload limits must be consistent across reverse proxy, Express parser/stream, AI client, FastAPI middleware/route and browser copy. Test exact-boundary and just-over-boundary cases.
- No automatic retries that duplicate large uploads or amplify load. Use controlled retry button once user asks.
- Protect against upstream spoofed product IDs, deleted/stale/hidden products, duplicate IDs, NaN/Infinity scores, invalid versions, stale vectors and excessive response size.
- Verify no AI dependency on startup, health of commerce or payment-worker connection pool. Stopping FastAPI must not alter cart/checkout/orders.

### 7.4 Concrete contract verification matrix

| Scenario | Expected result |
|---|---|
| Valid image, trained encoder + complete matching index | Finite ranked authoritative products, correct descriptor |
| Valid image, no trained encoder | Honest 503 `AI_MODEL_NOT_READY` or approved mapped unavailable code |
| Encoder present, index incomplete/mismatched | Honest not-ready; no fake or old-version results |
| No internal service key / wrong key | 401 before body read |
| Wrong environment header | 403 before image body read |
| Unsupported content/image type | Controlled 415/422, no decoder crash |
| Oversized/multi-image/decompression bomb | Bounded 413/validation error, no resource blow-up |
| Forged inactive/hidden product ID from mocked FastAPI | Not shown by Express |
| Duplicate image candidates for one product | One product result; best documented rank |
| Similar appearance but different storage variant | Honest “similar”; no claimed visual certainty of hidden capacity |
| Timeout/connection refused | Controlled retryable status and normal commerce alive |
| Client cancels while processing | Abort/drop stale response without persistent upload |

---

## 8. REACT / VITE — COMPLETE PREMIUM DISCOVERY CONSOLE (DAY 5)

### 8.1 Existing implementation is **not accepted solely because it exists in code**

The owner reports that the first command-search design/implementation is done, **but they have not yet seen it working in the running frontend**. Treat this as a concrete visibility/integration concern, not a request to generate another design specification. Inspect:

```text
apps/frontend/src/features/search/discovery/
  DiscoveryConsole.tsx
  DiscoveryProvider.tsx
  DiscoveryImageMode.tsx
  DiscoveryCamera.tsx
  DiscoveryQuickActions.tsx
  imageSearch.ts
  Discovery.module.scss
apps/frontend/src/features/search/SearchPage.tsx
apps/frontend/src/features/search/{api,queries,searchState}.ts
apps/frontend/src/pages/HomePage.tsx
apps/frontend/src/components/ui/{SearchField,ProductCard,CategoryCard,FilterControls}/
```

Trace header search trigger, provider placement, keyboard shortcut, build routes, runtime feature flags, `imageSearchEnabled()`, `.env` names and what Vite server/branch/port the owner is actually viewing. If served files are stale or the wrong worktree is running, fix only the startup/branch wiring. **Show a real browser screenshot/session** demonstrating the actual new component; do not say “implemented” based on static stories/SCSS only.

### 8.2 Search information architecture

**Global entry:** the existing header magnifier + `Ctrl/Cmd+K` opens the one search console from Home, Products, detail and relevant customer screens. On mobile, a full-height/safe-area-aware sheet; desktop centered premium overlay. Escape closes or backs out of nested camera/preview; focus returns to the original trigger. Do not intercept shortcuts belonging to rich editors and ensure keyboard/SR navigation works.

**Text search:** Use existing `/api/search/suggestions` (product/brand/category) and `/api/search/products`, TanStack Query/cache, debouncing, bounded query and ARIA combobox/listbox semantics. Never display invented popular items; initial quick actions/categories are API-backed. Navigate selected suggestions and “View all results”, preserve `/search` compatibility/query links.

**Visual search:** photo upload/drop/paste, selected-image preview, replace/remove, explicit submit, camera permissions/live preview/capture/retake/upload fallback, genuine AI processing, ranked results, useful no match and retry. Do **not** replace current genuine placeholder with fake results when the ML API isn't active. User must see whether photo search is available.

**Products/results:** `/products` remains the canonical filter/sort browser (category, brand, price, availability, `relevance`/newest/price/name, pagination). Preserve working customer navigation and all **16** category entries via backend data. `/search` remains shareable; if image results are shown outside the modal, use an explicitly scoped, privacy-safe navigation state/token with expiry, **never base64 image content in URL/localStorage**. Visual relevance stays default for image results; other sort choices must clearly stop claiming similarity ranking.

**Visual identity:** Respect actual current design system, Poppins, primary blue `#2563eb`, deep navy `#0f172a`, restrained cyan `#06b6d4`, spacing/SCSS semantic Discovery tokens, shared Radix/Lucide and existing squared aesthetics. Build a polished premium interface with clear hierarchy, proportion, reasonable whitespace, purposeful subtle motion, loading skeletons and reduced-motion. No wholesale global token replacement, Tailwind/shadcn template dump, generic giant dashed box or unrelated visuals. Figma design system/actual current screenshots are reference where available.

### 8.3 Interaction state machine and accessibility

Define (or reconcile current) state transitions and cleanup:

```text
closed -> text/initial -> text/typing -> suggestions -> navigation
      -> image/entry -> camera/permission -> camera/preview -> selected
      -> upload/ready -> searching -> ranked results / empty / unavailable
                              | cancel/abort -> ready
      -> replace / retake / remove -> entry/ready
      -> close/unmount -> stop tracks + abort pending fetch + revoke blob URLs
```

- Do not automatically submit on file selection or silently retain an image.
- Show actionable error for empty file, MIME mismatch, decoded-invalid, too-large, permission denial, insecure context, timeouts and AI outage.
- Real loading states without made-up progress percent/number of products scanned.
- Avoid stale response overwrite after selecting another image or closing.
- Camera only after explicit click; `getUserMedia()` requires secure context/permission. Stop every track on capture/close/navigate; never request microphone.
- Mobile picker `capture` fallback when supported; support desktop drag/drop and clipboard image paste only if validated and tested.
- Focus-trapped semantic dialog; ARIA live updates for suggestion count and request state; arrow/Enter/Escape/Tab behavior; visible focus; alt text; touch target size; reduced motion; 200% zoom, keyboard-open safe layout.
- Product cards show verified current product image/name/price/stock and slug-based link; same behavior as existing catalog.

### 8.4 Required visual verification

Inspect actual browser at **320, 390, 768, 1024, 1440, 1920 px**, plus zoom and reduced-motion. Verify header and shortcut, desktop search with real suggestions, visible all-category discovery, upload/preview/results/AI-unavailable, real camera if device permits (or permission-denied fallback), keyboard-only operation, active product navigation, Products filters/sort and normal cart navigation. Capture a concise set of actual screenshots for the evidence file; **do not substitute Storybook/static previews** for the running application.

### 8.5 UI style and separate ownership

Treat UI as **completion and integration** of the existing first implementation. Do not create a competing command palette, duplicate React Context provider or second image-upload component. If existing code includes honest feature flag/UI stubs, update only when real Express/FastAPI is verified to work. Clearly identify changed reusable components and search-specific design tokens. Do not allow DB and UI agents to edit the same shared files concurrently.

---
## 9. FULL QA STRATEGY — REAL EVIDENCE, NOT REPETITIVE AUDITS

Use a risk-based approach: focused tests during each implementation stream, then one integrated acceptance pass in disposable QA. Do not disable environment guards to make tests pass; do not claim an unrelated full-suite failure is an AI regression without reproduction.

### 9.1 Tooling and verification inventory

Confirm actual installed repository commands before execution:

| Area | Expected tools / evidence |
|---|---|
| Data quality | Python scripts, Pillow/image decoding, SHA-256, pHash/perceptual clustering, label/provenance audit, train/test leakage tests |
| Training | Kaggle Notebook, PyTorch/torchvision, CUDA/T4 verification, GPU utilization/memory logs, notebook execution history, training checkpoint, optimizer/weight delta |
| ML metrics | Deterministic retrieval evaluator (`Recall@1/5/10`, mAP), frozen query/gallery manifest, baseline comparison, per-category and hard-negative breakdown |
| Artifact | `safetensors` or ONNX, SHA-256, manifest schema, parity tests, CPU loader, code/version/dataset digest |
| FastAPI | `pytest`, TestClient/httpx, Ruff, strict mypy (where configured), pip-audit, runtime curl, real model/index integration |
| Express | Vitest, TypeScript typecheck, ESLint, API/supertest, Zod schema tests, rate-limit/upload streaming checks |
| DB | Prisma schema validate/migration status, reviewed SQL/pgvector, isolated PostgreSQL with pgvector, RLS/permissions/role-denial, EXPLAIN/latency, reindex/rollback tests |
| Frontend | React/TypeScript tests, TanStack Query contracts, Playwright/real browser, accessibility checks, CSS/lint/typecheck/build, screenshot comparisons |
| Docker/CI | Python 3.11 Docker model load smoke, non-root, no network training, dependency/security audits, GitHub workflow policy tests and CI-equivalent local checks |
| Ops/privacy | Sanitized request telemetry, p50/p95, max sizes, model/index readiness, cancellation, no retention, AI-down commerce regression |

If a tool/test runner is unavailable, identify one specific alternative and whether acceptance evidence is equivalent. Do not invent terminal outcomes or cite unexecuted commands. Never upload private legal documents/raw credentials as generic CI artifacts.

### 9.2 Data/ML-specific test matrix

**Dataset tests:** manifest schema/unique ID; source-photo rights and allowed Kaggle processing; real vs generated classification; valid image decode; image geometry/orientation; source checksum; per-product positive-pair adequacy; train/validation/test/gallery disjoint source groups; pHash duplicate-family leakage; unseen-SKU/appearance-family separation; category balance; no missing labels; stable frozen split.

**Training tests:** model initializes from actual pretrained weights; projection output right shape; nonzero gradient updates to at least intended head/backbone weights; loss finite and decreases on a small controlled sample; checkpoint resume reproduces expected optimizer state offline; validation selection doesn't read test set; no training of the frozen test-query images; data loader sampling avoids false negatives for same appearance group.

**Retrieval tests:** vector normalized/finite, real image encoding deterministic with approved preprocess; baseline and trained checkpoint same held-out benchmark; evaluation refuses duplicate input paths/capture-group overlap; expected exact vs appearance metrics; meaningful small test gallery known-result smoke; query with wrong model/version fails closed; no-result/partial coverage accurately reported.

### 9.3 Database and ingestion test matrix

- Migrate **empty disposable QA** from canonical migration history, including pgvector extension only when available in controlled QA; no shared DEV fallback.
- Validate actual extension and vector dimension, table constraints, role permissions, indexes and migration checksums.
- Ingest same batch twice = no duplicate embeddings or product mutation; count and checksum unchanged on second run.
- Interrupted ingestion + retry = consistent staging status, active index not partially changed.
- Stale/deleted image, changed checksum, hidden/inactive product, removed variant = correct invalidation/eligibility behavior.
- Incomplete index/version mismatch = not ready and no silent fallback to mixed embeddings.
- Promotion switches exactly one active pointer atomically; old version can be rolled back; concurrent queries see one coherent version.
- Exact cosine kNN returns correct products under deterministic tiny fixtures; bounded topK and tie-breaking; duplicate image hits grouped correctly.
- Reader cannot write or select auth/order/payment tables; ingestion writer cannot write commerce tables; no exposed public vector API.
- If SQL migrations are needed in DEV, verify active DEV identity/TLS and separate approval gate before execution; record zero PROD writes.

### 9.4 FastAPI / backend negative cases

Tests must cover authentication before image body read, environment mismatch, missing credentials, malformed header/request ID, missing files/multiple files, byte exactly at/over limit, MIME spoof, corrupt/truncated WebP/JPEG/PNG, animated/multiframe, extreme dimensions/decompression bomb, EXIF orientation, grayscale/alpha handling, inference budget and busy executor, invalid vector, mismatch descriptor, index unreachable, network refusal, timeout and graceful shutdown.

Express must test signed-out vs signed-in allowed access, rate limit and returned retry semantics; AI server malicious candidate UUIDs/duplicates/NaN/infinity/large response, hidden/inactive/test products, stale prices/stock, strict version schema, safe public error envelope, client abort, stale response, no raw bytes/tokens in logs and no upstream redirects. Preserve per-request telemetry added in 04.1; avoid duplicate success or sensitive traces.

### 9.5 Frontend UI/E2E matrix

- Header icon actually opens modal on Home, Products and Product Details.
- `Ctrl/Cmd+K`, focus trap, focus return, arrow/Enter/Escape and screen-reader status.
- Initial suggestions and 16 categories come from real API, no fake “trending” data.
- Text search, suggestion click, `/search` deep-link and `/products` category/brand/availability/price/sort/pagination survive navigation/back-refresh.
- File picker, drop, optional paste, preview, replace, remove, image validation and explicit search submission.
- Camera permission success where supported, deny/unavailable fallback, track cleanup and retake.
- Real model matches appear as product cards with authoritative price, image, stock, category and detail navigation.
- No match, AI down, unknown model, upload rejected, slow network, timeout, cancel, duplicate click and switch-image-before-response all show correct state.
- Desktop/tablet/mobile snapshots and real responsive interactions; no giant unused spaces, layering/focus bugs or horizontal scroll.
- No raw photo persisted after closing, no uncontrolled object URL retention; do not store image in localStorage/query parameters.
- Existing 04.1 admin status route reflects readiness, but no new admin-only AI UI required unless directly needed for diagnostics.

### 9.6 Runtime / integration / commerce resilience

In **isolated QA** run React `:3200`, Express `:5200`, disposable PostgreSQL `:55434`, isolated FastAPI and a **real trained artifact with real indexed fixture/gallery vectors**. Demonstrate **one full successful user query end-to-end** with a previously unseen photograph. Compare returned product IDs to manual labels; retain privacy-safe screenshot/evidence and local test artifacts without publishing licensed photos.

Stop FastAPI, stop vector DB or deactivate index (on isolated QA only) and verify:

- Conventional product browsing, 16 categories, text search, cart and ordinary checkout-related routes continue to work with accepted mocks/safe fixtures; no Stripe charges, Brevo sends or payment supervisor activity.
- Visual search returns honest bounded unavailable state; normal navigation still works.
- Restore service/index and prove recovery; no stale model/results after version switching.
- Test isolated environment variables never point at shared DEV/PROD vector DB/AI key; use existing 04.0 launcher/environment guards.

**End-of-task wider tests:** Run relevant full frontend/backend suites **once** using verified disposable QA, with focused reruns after concrete fixes. Reuse credible existing CI evidence on unaffected systems. Do not turn the ML task into another endless payment-worker/network audit.

### 9.7 Security / performance pass thresholds

Define *bounded engineering budgets* based on a small runtime benchmark rather than arbitrary requirements that force invented results:

- File byte cap: frontend UX, Express ingestion and FastAPI decoder must match; exact number documented (current UI advertises 10 MB, current FastAPI middleware 1 MiB).
- Image pixel/format limits: explicit and tested before expensive decode/inference.
- AI upstream timeout: based on measured CPU p95 plus bounded headroom, within supported configuration or safe route-specific extension; Express request never hangs indefinitely.
- Concurrency and RAM: measure 1/2/4 requests; select safe cap for CPU environment and reject excess work promptly.
- Query latency: record p50/p95, breakdown (network, decode, encoder, kNN, product-resolution) and compare to frontend UX expectations. Treat cold-start separately.
- Retrieval quality: real metric rows, sample size, baseline, limitations, category/appearance-relevance. No hardcoded “95% accurate” threshold without an actual dataset.
- Permissions and no-persistence: negative tests must pass; security bypass is a blocker.

If performance can't fit user experience on intended CPU hardware, optimize within the approved architecture (smaller projection, efficient transforms, ONNX parity, index tuning, caps) and **show benchmarks**. Do not silently switch to an untrained dummy service.

---

## 10. WORK PLAN, DEPENDENCIES AND TIME-BOXING

The user describes dataset preparation as Day 2, Kaggle training Day 3, pgvector Day 4 and image-search UI completion Day 5. Because catalog and initial UI work are already done, actual implementation should be **dependency-driven**, with independent engineering in parallel. The labels are schedule targets, not a command to ignore a blocked dataset.

| Work window | Main deliverables | Required evidence / owner interaction |
|---|---|---|
| **Entry / Day 1 remainder** | Confirm base/worktrees, 04.1 accepted contracts, catalog 206 and 16 categories, already implemented Discovery Console browser wiring; set end-to-end interface shape | Branch/status, worktree owners, visible first-version UI screenshot, contract notes |
| **Day 2 — dataset preparation** | Full target SKU audit; photo/rights source verification; 80–120 eligible training subset if evidence supports; group-disjoint train/validation/test/gallery; Kaggle-private input package | Dataset readiness matrix; precise photo-rights owner approval; checksum/split leakage PASS |
| **Day 3 — real training** | Kaggle CUDA check; frozen pretrained baseline; genuine EfficientNet-B0 supervised/metric fine-tuning; held-out metrics; safe weight export/descriptor/checkpoint parity | Actual notebook execution, training curves/weight updates, metric JSON, model hash; GPU quota/runtime |
| **Day 4 — vector + inference** | Reviewed additive pgvector schema, exact retrieval, restricted read/writer roles, safe staged ingestion, atomic activation/rollback, real FastAPI and Express API | Disposable QA migration and index tests, actual CPU inference, DEV gate evidence if authorized |
| **Day 5 — UI completion and QA** | Connect existing Discovery Console to real Express API; upload/camera/results; preserve `/search`/Products; device/browser QA; full integration and security acceptance | Real screenshot/E2E, tests/lint/typecheck/build, model-index readiness, AI-down smoke, final handoff |

**Critical path:** rights-approved independent photos → leakage-proof training dataset → actual trained weights + held-out evaluation → compatible embedding gallery/index → CPU inference → real user query. UI/API and migration design can progress concurrently, but **production-ready outcome cannot be declared without critical path**.

**Free Kaggle GPU:** account and accelerator selection done; start an actual GPU session only when the approved dataset and notebook are ready. Do not waste weekly quota idling, uploading unrelated images or experimenting without checkpoints. If GPU unavailable, schedule retry within reason and progress local tests/UI/vector infrastructure; do not pretend CPU training used GPU.

**Time-box investigation, not correctness:** small issues 5–15 minutes; significant scope 15–40 minutes; critical issues risk-based full boundary checks. This is not a promise that training/dataset collection takes minutes. Repeated audits without source changes are prohibited; reuse evidence; track rights, Kaggle access and PROD execution as *external gates*, not source defects.

**Scope escalation:** When a rights-approved dataset is materially insufficient or held-out retrieval is poor, stop claiming 04.2 ML acceptance, report precise missing positives/query/gallery and choose the smallest credible dataset/training remedy. Overall Phase 04 may extend 2–3 days if necessary, but do not eliminate the real-ML standard to hit a nominal date. If more than that is needed, prepare a decision with evidence rather than inventing success.

---

## 11. OWNER ACTIONS VS ENGINEERING AUTONOMY

**Already satisfied, do not request again:** Kaggle account sign-in/account verification to the extent required; NVIDIA T4 ×2 accelerator can be selected; catalog expansion Parts 1 and 2 reported completed; Discovery Console first design and source implementation exists.

**Claude/engineering owns:** repository inspection and Plan Mode; dataset extraction/audit/rights manifest; safe photo processing and collection from approved eligible sources; notebook/training/evaluation code; Kaggle execution if legitimately accessible; model promotion protocol and CPU compatibility; migrations on disposable QA; reviewed DEV plan; FastAPI/Express/React implementation; visual QA; security/performance/CI/tests; concise handoff.

**Owner only when necessary:** explicitly approve precise image sources/ML training rights and upload to Kaggle; provide indispensable licensed photographs if no eligible source exists; complete Kaggle interactive auth/CAPTCHA/terms that cannot be delegated; approve protected database migration/production deployment, and visually accept customer-facing redesign. Do not require owner to manually write SQL, curate CSV formatting or train the model.

**Mandatory external gate:** manufacturer image is not training-authorized merely because it's on a product page; no implied data license, scraper bypass or automatic Kaggle redistribution. If rights remain unconfirmed, engineering should finish safe independent code and provide an honest blocker report, **not** substitute fabricated labels/metrics.

---

## 12. CONTRACT AND DOCUMENTATION DELIVERABLES

### 12.1 Source and artifacts

- Implemented actual training scripts + Kaggle notebook, all pinned/captured environment versions and safe reproducibility manifest.
- Private Kaggle-ready licensed dataset with checksum and leakage audit; data copies only in approved protected storage; no raw private images/secrets in Git.
- Baseline and fine-tuned model with real training/validation history, held-out retrieval metrics and reference prediction samples.
- Secure versioned non-pickle inference artifact and descriptor, validation and CPU parity test.
- Reviewed SQL/Prisma compatible AI pgvector migrations, identity-gated application plan, vector role grants, version/ingestion/activation/rollback scripts.
- Real FastAPI image endpoint and readiness, Express public validated image API, product ID/stock visibility filtering, telemetry and integration tests.
- Finished first existing Discovery Console and actual browser-visible UI, including mobile camera and product result navigation.
- Updated docs: `docs/07_AI/IMAGE_SEARCH.md`, `docs/07_AI/MODEL_FLOW.md`, relevant FASTAPI/DB runbook and **one concise 04.2 implementation evidence document**. Preserve architecture consistency; update only materially changed descriptions.
- No broad duplicate documentation suite, no unnecessary README proliferation and no unilateral changes to unrelated payment/email systems.

### 12.2 Dataset/model provenance evidence must contain

At minimum: product/catalog snapshot timestamp/count; SKU → appearance-family mapping; photo-source/license evidence; excluded illustrative assets and reason; SHA/pHash dedup report; exact train/validation/test/gallery split counts; Kaggle notebook URL/id if privately accessible; actual GPU configuration; code/manifest/model hash; pretrained baseline metrics; fine-tuned metrics; exemplar correct/incorrect predictions (privacy-safe); measured CPU timings; artifact format/dimension/normalization/preprocessing; approval/promotion status. Do not print long original source photo URLs with sensitive tokens.

### 12.3 Source architecture / review evidence must contain

Branch/base SHA/current HEAD; worktree ownership; exact changed files/protected CCR notes; applied local/DEV/PROD migration actions with real identity; tests command, status/counts; Docker build outcome; CI runs only when actually triggered; browser screenshots; actual API request/response safe examples; image-upload abuse regression; model-index consistency and rollback proof; AI-down commerce smoke; current acceptance matrix; concrete blockers only; engineer self-score /100 and `READY FOR ARCHITECT REVIEW` or `CHANGES REQUIRED` recommendation.

---

## 13. ACCEPTANCE MATRIX — T42-01 THROUGH T42-60

All 60 checks require an actual evidence pointer/test; use PASS / FAIL / NOT VERIFIED. Items depending on owner permissions are not PASS until permission is recorded. There is no partial “ML success” from mock responses.

| ID | Acceptance requirement | Minimum evidence |
|---|---|---|
| T42-01 | Current worktree/base/branch and concurrent work ownership verified | Git/status/worktree proof |
| T42-02 | Task 04.1 internal contracts preserved | Diff/API test |
| T42-03 | 206-target customer catalog (actual latest eligible count) reconciled | Read-only catalog audit |
| T42-04 | All 16 active customer categories correctly identified; fixtures excluded | Query/visibility assertion |
| T42-05 | 166 expansion assets excluded from unsupported real-photo training labels | Rights/manifest negative test |
| T42-06 | Per-SKU authentic source and licensed use/third-party Kaggle rights recorded | Rights ledger / owner gate |
| T42-07 | Dataset photos match exact model/variant or marked appearance family | Manual/source audit |
| T42-08 | Image bytes validated/normalized with original hashes | Decoder/manifest tests |
| T42-09 | Exact and near-duplicate capture groups built and reviewed | SHA/pHash report |
| T42-10 | Train/validation/test/gallery leak-proof group split | Automated split audit |
| T42-11 | Separate unseen-SKU generalization split where credible | Identity-group manifest or justified N/A |
| T42-12 | Clear train-eligible vs index-eligible vs excluded coverage | Readiness report |
| T42-13 | Private Kaggle dataset contains no secrets/customer uploads/unlicensed files | Package audit |
| T42-14 | Kaggle notebook executed on real allocated GPU | CUDA/notebook evidence |
| T42-15 | Training packages/inputs/seeds/versions reproducibly recorded | Lock/run metadata |
| T42-16 | Frozen pretrained EfficientNet-B0 retrieval baseline evaluated | Baseline metrics |
| T42-17 | Genuine metric-learning/product-aware supervision implemented | Loss/sampler/source tests |
| T42-18 | Fine-tuning updates real trainable network weights | Weight delta/optimizer log |
| T42-19 | Validation-driven checkpoint selection; test held out | Training log/test audit |
| T42-20 | Recall@1/5/10 calculated on independent held-out queries | Raw predictions/metric script |
| T42-21 | mAP calculated under declared relevance definition | Evaluation script/result |
| T42-22 | Per-category/hard-negative/known-vs-unseen breakdown honest | Metric breakdown/errors |
| T42-23 | Baseline comparison and failure analysis reported without fabrication | Report |
| T42-24 | Non-pickle checksum-verified model artifact exported | Artifact/test |
| T42-25 | Preprocess/dimension/version metadata is reproducible and exact | Descriptor/parity test |
| T42-26 | CPU-serving parity, warm/cold latency and RAM measured | Local benchmark |
| T42-27 | Additive pgvector schema reviewed; no duplicate catalog models | Migration review |
| T42-28 | Disposable QA migrates from clean schema and has working vector extension | Migration test |
| T42-29 | Vector dimensions/finiteness/source integrity constrained | SQL/ingestion negative tests |
| T42-30 | AI reader cannot write commerce tables or access auth/payment data | DB role-denial test |
| T42-31 | AI ingestion writer narrowly scoped, no DDL/commerce write privileges | DB privilege test |
| T42-32 | Staged embedding ingestion is bounded, idempotent, resumable | Repeat/interruption test |
| T42-33 | 206-target indexing coverage reports actual eligible count/holes | Embedding coverage report |
| T42-34 | Model/index/preprocess version mismatch refuses READY/retrieval | Readiness test |
| T42-35 | Index activation atomic and rollback demonstrated | Transaction/restart tests |
| T42-36 | Exact kNN/product grouping/order works; HNSW only if justified | Deterministic vector integration |
| T42-37 | DEV migration/ingestion obeys real project identity/owner gate | Applied-or-pending authorization record |
| T42-38 | No unauthorized PROD mutation or auto-migration | Identity/no-write record |
| T42-39 | FastAPI loader verifies checksum and loads once per lifecycle | Lifespan test |
| T42-40 | Real image decoder supports JPEG/PNG/WebP within bounded limits | Decoder/negative tests |
| T42-41 | Private FastAPI route authenticates before reading upload | 401/403 abuse test |
| T42-42 | Real encoder + pgvector returns real IDs, finite scores/versions | E2E isolated QA |
| T42-43 | Health/readiness/capabilities truthful and version-consistent | API smoke |
| T42-44 | Safe request limits, concurrency and inference timeout measured | Load/timeout test |
| T42-45 | Express route validates multipart/type/size/rate limits | API tests |
| T42-46 | Express forwards securely through existing AI client only | Network/contract test |
| T42-47 | Express filters hidden/inactive/test/stale candidates and deduplicates | DB-backed tests |
| T42-48 | Public results use current price/image/stock, never model-invented commerce data | Product API smoke |
| T42-49 | Service unavailable/invalid response cannot affect regular commerce | AI-down regression |
| T42-50 | Actual first-version Discovery Console is visible in running frontend | Screenshot/route/wiring proof |
| T42-51 | Header trigger/shortcut/suggestions and full-results navigation work | Browser E2E |
| T42-52 | 16 category exploration and Products filter/sort/pagination remain intact | Browser/API E2E |
| T42-53 | Photo select/drop/paste/preview/replace/remove/cancel work | UI integration tests |
| T42-54 | Camera permission/capture/retake/cleanup/fallback work | Browser/device/negative |
| T42-55 | Live ML visual results and actionable no-match/unavailable/error states render | Real model E2E + UI |
| T42-56 | Desktop/mobile responsiveness, accessibility, keyboard and reduced motion pass | Browser/screenshots/a11y |
| T42-57 | No raw image/secrets/vector leakage, retention or unsafe uploads | Privacy/security evidence |
| T42-58 | Python/TypeScript tests, lint, typecheck, Docker/CI-equivalent checks pass | Actual commands/counts |
| T42-59 | Full affected-system QA, version rollback and AI-down resilience accepted | Integrated suite/smoke |
| T42-60 | Accurate, concise implementation evidence and one first-review-ready handoff | Signed-off engineer report |

**Acceptance rule:** Required rows cannot be marked PASS based on a mock or planned implementation. A small set of training-category coverage/whole-catalog precision limitations can be documented as **measured non-blocking residual risk** only if the end-to-end real model's utility, approved intended claims and applicable acceptance gates are demonstrated. A **blocked** data-rights gate or no real fine-tuned weights is a real blocker for complete 04.2 approval, not grounds to fake success.

---

## 14. ENGINEER'S FINAL HANDOFF AND ARCHITECT REVIEW

### Required final report (one evidence file)

1. **Repository:** base/HEAD, branch/worktree owners, diff, non-04.2 changes, protected-file CCR and any cherry-picks/integration approvals.
2. **Dataset:** the 206-target count, exact split/rights/duplicate audit, eligible vs excluded, any remaining rights-owner gate.
3. **Training:** actual Kaggle run, used T4 and hours, pretrained baseline and fine-tuned retrieval metrics, model hash, trained parameter evidence, saved artifact and limitations.
4. **Index:** migration SQL/Prisma status, DEV/QA identity and actual applied actions, separate vector roles, staged backfill completeness and activation/rollback, version parity.
5. **Services:** FastAPI and Express route/schema changes, actual image safety/resource limits, CPU serving stats, readiness, no customer/financial access.
6. **Frontend:** the real Discovery Console build and screenshots, UX/camera/input tests, Products/categories `/search` and text-search preservation, mobile/accessibility.
7. **QA:** commands and pass/fail counts, CI only if actually executed, Docker build, isolation, AI unavailable commerce smoke and any substantive gap.
8. **Acceptance:** T42-01–T42-60 evidence matrix and confirmed material defects only, engineer self-review score /100 and `READY FOR ARCHITECT REVIEW` or `CHANGES REQUIRED`.

### Risk-based Principal Architect acceptance

The Architect reads this task prompt, implementation summary, changed files and relevant code, examines actual model/data/index evidence and affected tests, scores /100 and decides: ✅ Approve / ⚠ Request Changes / ❌ Reject. Verify proportionately to risk; do not invent defects, over-demand unrelated regressions or reopen accepted 04.1/Phase 03 work without concrete evidence. No guarantee of a 100/100 score. Accept reasonable disclosed limitations of a 206-product portfolio system when security/rights and real retrieval claims are supported. Never claim synthetic renders are genuine dataset photos or an uncalibrated score is accuracy.

### Stop conditions

**Stop for handoff only when:** the real notebook has run; training rights gate is recorded; leakage-safe dataset and trained retrieval checkpoint exist; model/index version and full actual query pipeline work; upload/camera and command UI are demonstrated in the browser; DEV/QA isolation is proven; security/cancellation/performance/AI-down tests are credible; QA/CI is performed as authorized; no unresolved material defect remains; evidence is current. Do not continue speculative audits after these are met.

**Explicitly NOT DONE by this task:** Kaggle account onboarding (already done), unrequested product-seed replay, Supabase Storage production automation, 04.4 recommendation model, delivery maps/Socket.IO, production rollout, PR merge or Git commit/push without separate approval.

---

## 15. FINAL EXECUTION DIRECTIVE (FOR TASK IMPLEMENTER)

**Inspect the real repository and worktrees first.** Then enter Plan Mode, reuse the accepted FastAPI/Express foundation and already implemented catalog/Discovery Console, get a truthful rights-and-leakage-qualified dataset, perform **real** T4 PyTorch EfficientNet-B0 fine-tuning and evaluated retrieval, deploy only the safe reviewed model and version-matched pgvector index to authorized environments, complete the existing React command search with image upload/camera/results, run real QA and produce one strong architect-review-ready handoff.

**Do not promise “production-grade accuracy” merely because production-quality engineering infrastructure is present.** Demonstrate actual trained weights, genuine photos, held-out metrics, catalog coverage, CPU inference and secure resilience. Full Phase 04 remains a roughly 14-day effort, potentially extended 2–3 days when needed for real quality.

**NO UNAUTHORIZED PROD WRITES. NO FABRICATED DATASETS OR AI RESULTS. NO SECRET LEAKS. NO COMMIT, PUSH, MERGE OR DEPLOYMENT WITHOUT SEPARATE APPROVAL.**
