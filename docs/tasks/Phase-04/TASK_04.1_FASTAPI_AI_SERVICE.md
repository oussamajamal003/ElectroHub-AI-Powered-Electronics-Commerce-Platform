# ELECTROHUB — TASK 04.1 / FASTAPI AI SERVICE FOUNDATION

**Phase:** 04 — AI & Real-Time Features  
**Task:** 04.1 — FastAPI AI Service: Production-Oriented ML Infrastructure and Express Integration  
**Proposed feature branch:** `feature/FastAPI-AI-Service`  
**Base / integration target:** current **approved** `develop`, verified locally and against the remote at execution time  
**Proposed task file:** `docs/tasks/Phase-04/TASK_04.1_FASTAPI_AI_SERVICE.md`  
**Prepared:** 2026-10-21  
**Status:** **IMPLEMENTATION SPECIFICATION — NOT IMPLEMENTED OR VERIFIED BY THIS DOCUMENT**  
**Scope:** Existing Python/FastAPI skeleton; Python architecture, reproducible dependencies, runtime/environment isolation, private API security, contracts, model lifecycle and version interfaces, Express AI client, health/readiness, failure isolation, tests, Docker packaging, developer tooling, logging, documentation and future Phase 04 integration contracts.  
**Phase-wide delivery target:** Prefer **14 calendar days** for the entire Phase 04 (04.1–04.7), with an optional **2–3 days** only if genuine implementation/QA blockers require them. This is a **planning target, not permission to remove safety, claim unmeasured ML accuracy, or skip acceptance evidence**. Review scope/capacity daily; detailed estimates are managed in individual task plans.  
**Execution boundary:** This document authorizes no Git mutation by itself. Task implementation may make locally approved, task-scoped source/tests/docs edits after repository/worktree ownership checks. **No remote DEV/PROD database writes or migrations, external data upload, Kaggle notebook/GPU setup, real ML training, customer-image export, payment/commerce mutation, secret change, CI trigger, commit, push, merge or deployment without separate applicable authorization.**

> **Outcome:** ElectroHub's pre-existing FastAPI skeleton becomes a secure, independently runnable, reproducible, testable **AI infrastructure service** integrated safely through Express, with clear contracts for a **real trained/fine-tuned deep-learning vision encoder, learned embeddings, pgvector search and ML-based recommendations**. Core commerce stays operational when FastAPI is unavailable. Task 04.1 prepares—not simulates or trains—the capabilities to be delivered and evaluated in 04.2 and 04.4.

---

## Task-Specific Visual / UX and Unit / Security Invariants

These invariants summarize the binding constraints below; they add no scope. "Test" names the automated check that guards each one where it is a concrete code path (paths relative to `apps/ai-service/tests/` or `apps/backend/`).

### Visual / UX

| ID | Invariant | Guard |
| --- | --- | --- |
| V01 | 04.1 does not redesign the customer search experience. | No `apps/frontend` changes in the 04.1 diff |
| V02 | Text search, suggestions, search navigation and catalog results keep working. | Browser + API smoke recorded in the evidence file |
| V03 | Image matching is not presented as working before 04.2 delivers real trained inference. | `ImageSearchShell` copy unchanged ("Image matching is not available yet") |
| V04 | The image-search placeholder stays truthful until 04.2 replaces it with command search. | As V03 |
| V05 | No fake similarity results, fabricated ML scores, misleading success indicators or AI banners. | `test_contracts.py`, `test_lifespan.py` (503/501, never matches) |
| V06 | AI startup/readiness problems never block the customer UI or commerce. | `ai.config.test.ts` (never throws), AI-down smoke |
| V07 | Poppins, SCSS/CSS Modules, tokens, square radius, shared components, a11y and responsiveness are preserved. | No UI files changed |
| V08 | 04.2 transforms Text/Image search into a unified premium command-search UI (Figma-verified); not implemented early. | Documented hand-off (§9, §13.1) |

### Unit / security

| ID | Invariant | Guard |
| --- | --- | --- |
| U01 | Express is the public gateway and business authority. | Browser never calls FastAPI; no CORS (`test_auth.py::test_cors_is_not_enabled`) |
| U02 | FastAPI cannot authenticate customers, change roles, write orders/stock, take payments, send commerce email or create PDFs. | No such code or credentials; U06 guard |
| U03 | Internal routes require verified service authentication; CORS is not authentication. | `test_auth.py` |
| U04 | Missing, malformed or mismatched configuration fails safely. | `test_settings.py`, `ai.config.test.ts` |
| U05 | Isolated QA never inherits DEV/PROD database or AI credentials or remote write authority. | `scripts/dev-isolated.test.cjs`, `test_auth.py::test_dev_credential_cannot_call_qa_instance` |
| U06 | FastAPI never receives Stripe, Brevo, JWT/refresh, payment-supervisor or unrestricted Supabase secrets. | `test_settings.py::test_load_settings_refuses_commerce_secrets_*` |
| U07 | No model artifact means honest not-ready reporting, never simulated AI. | `test_contracts.py::test_readiness_is_truthful_without_a_model` |
| U08 | Request/response DTOs are bounded, typed and validated on both sides. | `test_contracts.py`, `test_services.py`, `ai.client.test.ts` |
| U09 | AI failures/timeouts never break catalog, cart, checkout, payment, Orders, PDFs, email or delivery. | `ai.client.test.ts` (timeout/refused), AI-down smoke |
| U10 | Model loading is lifecycle-managed; CPU-bound work never blocks the event loop unboundedly. | `test_lifespan.py`, `test_limits.py` (executor) |
| U11 | Logs never contain secrets, raw images, vectors or identity data. | `test_logging.py`, `test_health.py` |
| U12 | No pgvector migration, training, Kaggle setup, dataset upload or embedding backfill in 04.1. | Diff review; DB verification (NO-OP) |
| U13 | DEV payment recovery, email dispatch and financial isolation are unchanged. | No payment/email source changes in the diff |
| U14 | Prisma migration history is never forged or rewritten. | No migration or `_prisma_migrations` writes |
| U15 | Nothing is PASS without actual evidence. | Evidence file acceptance matrix |

---

## 0. Executive architectural contract — read before implementation

```text
                          CUSTOMER INTERACTION
 React / TypeScript / Vite (MAIN DEV :3000; ISOLATED QA :3200)
       | search / image-search / recommendation request
       v
 Express / TypeScript (MAIN DEV :5000; ISOLATED QA :5200)
  | JWT and business authorization; request budgets; catalog truth
  | product validation; pricing/stock; rate limits; sanitization
  |--- Prisma ---> Supabase DEV (MAIN DEV only)
  |             \-> isolated PostgreSQL :55434 (QA only)
  |
  | private, authenticated, bounded HTTP request; no browser secrets
  v
 Python / FastAPI AI Service (separate per-environment instance)
  | API routers + Pydantic schemas + dependencies + errors + logs
  | Application AI services + model/embedding contracts
  | Runtime model loader/lifecycle and inference adapter (prepared 04.1)
  |--- 04.2: actual fine-tuned EfficientNet-B0 image encoder
  |           versioned product image embeddings + pgvector retrieval
  |--- 04.4: embedding-based ML recommendations/behavior context
  v
 Rankable PRODUCT REFERENCES + SCORES + MODEL VERSION (not product truth)
  |
  v
 Express validates IDs, model/output limits and authoritative products
  |
  v
 React displays accessible, trustworthy catalog result cards

OFFLINE 04.2: curated licensed product imagery -> Kaggle Free NVIDIA GPU
             -> real PyTorch transfer learning/fine-tuning -> evaluation
             -> versioned signed/checksummed model artifact -> bounded
                embedding generation/reindex -> coherent pgvector activation
```

### Non-negotiable boundaries

1. **Express is the public gateway and commerce authority** (authentication, authorization, products, price, visibility, cart, stock, checkout, payments, orders, shipping, email, PDFs and admin writes). FastAPI is an internal ML processing service; the frontend never connects to it using embedded credentials.
2. **No simulated matcher as final Phase 04 image search.** Task 04.2 must deliver actual trained/fine-tuned PyTorch vision embeddings, a real vector index and recorded held-out retrieval evaluation. In Task 04.1, a fake processor may exist **only in tests**, or a clearly disabled/not-ready interface; never make a fake ranking endpoint look like working AI.
3. **Task 04.1 must remain independent of task 04.2 training.** Do not open Kaggle, allocate GPU quota, collect private data, fine-tune weights, create live pgvector migrations or backfill catalog embeddings now.
4. **Real ML recommendation scope:** Task 04.4 uses learned embeddings plus justified behavioral features. Popular/category/co-purchase heuristics are labeled baselines, cold-start behavior or outage fallbacks; rules alone do not satisfy its ML acceptance.
5. **No accidental DEV/PROD activity from isolated QA.** MAIN DEV stays React :3000 -> Express :5000 -> approved Supabase DEV; isolated QA stays React :3200 -> Express :5200 -> resettable local PostgreSQL :55434. Use distinct AI service targets, credentials and resource/data scopes or a wholly mocked isolated AI adapter. Tests fail closed when isolation is uncertain.
6. **Model output is advisory:** an embedding score is not a calibrated probability; FastAPI cannot invent SKUs, prices, stock or user entitlements. Express post-validates product references and product eligibility.
7. **AI degradation never blocks commerce:** if FastAPI times out, crashes, has no model or returns malformed data, catalog/text search, auth, cart, checkout, Stripe Test Mode, Orders, email, PDFs and tracking continue.
8. **Maintain existing protected financial safeguards.** No change to payment isolation, Stripe supervised runtime/worker scope, account reconciliation, Brevo dispatch, PDF guards or Supabase connection governance is needed just to implement 04.1.
9. **No undocumented delivery claims:** a service skeleton/green API unit test does not prove trained retrieval, recommendations, Supabase Storage, live tracking, production load or deployment readiness.

### Visual/UI invariants

- **Task 04.1 is primarily infrastructure.** No premature frontend redesign or fabricated ML results.
- Existing Text Search, Catalog and Image Search placeholder remain functional until 04.2 explicitly replaces/refines them.
- **In 04.2, the current Image Search placeholder and Text/Image tab experience will be comprehensively upgraded into a cohesive premium command-search experience** (search command palette/overlay, keyboard and mobile access, text suggestions, camera/upload, image preview/progress and ranked results). This is a **confirmed downstream design requirement**, not a reason to implement the visual overhaul during 04.1.
- Use ElectroHub's actual Figma/design-system tokens, Poppins, CSS Modules/SCSS, Radix where appropriate, Lucide icons, current square-radius conventions and existing shared components. Do not paste a generic Tailwind/shadcn command-palette design into the app.
- Modal/command-search open-close, focus trap/return, Escape, reduced motion, keyboard arrow selection, semantic combobox/listbox, mobile camera permission, explicit file constraints and fallback to text search must be planned in 04.2; design verification uses real screenshots and browser interaction.

---

## 1. Repository-first authority, discovery and baseline

### 1.1 Mandatory FIRST action before planning or implementation

The agent must **inspect the real repository before every edit**. The remote baseline inspected for authoring was `feature/DEV-Environment-Stabilization`, whose last observed remote head was `b716b5322477939ef1a6fb6abd9cd1b7d01ebc7f`; this is **not** a claim that the current locally modified Task 04.0 work is committed, merged or reflected remotely. Re-check everything at implementation time; never branch from the authoring snapshot without review.

```bash
git remote -v
git status --short --branch
git branch -vv
git worktree list --porcelain
git fetch --prune origin
git rev-parse HEAD
git rev-parse origin/develop
git log -8 --oneline --decorate origin/develop
git diff --stat
git diff --check
git ls-files --others --exclude-standard
```

Then examine the actual current branch, task registry, ownership, `AGENTS.md`, `AGENT_COORDINATION.md`, `docs/prompts/DEVELOPER_PROMPT.md`, `docs/prompts/REVIEW_PROMPT.md`, current Phase 00 AI architecture docs, `docs/01_Project Foundation/ROADMAP.md`, the final Task 04.0 acceptance/evidence and environment runbook, current test/CI patterns, `package.json`, Python dependencies and task 03.7–04.0 specifications. Check whether Task 04.0 is **approved and integrated** before basing a new branch on `develop`. If integration is pending, request an approved base/strategy rather than stacking silently on unfinished protected local changes.

**Branch plan:** after safe branch/base and agent ownership verification, use `feature/FastAPI-AI-Service`. Never overwrite existing worktrees or untracked files. If a branch/worktree of that name exists, inspect and reuse only if appropriate; otherwise coordinate a distinct worktree. Register task ID, base SHA, owners, protected files, scope and approvals per `AGENT_COORDINATION.md`.

### 1.2 Repository facts verified while preparing this specification

The following were read from the connected remote feature branch, **not from the uncommitted local workspace**:

| Location | Observed state / implication |
| --- | --- |
| `apps/ai-service/app/main.py` | Minimal `FastAPI` app exists; uses `CORSMiddleware`, includes health router, deprecated `@app.on_event("startup")` empty initialization. **Extend**; do not pretend app is nonexistent. Prefer `lifespan` for model resources. |
| `apps/ai-service/app/core/config.py` | Existing `BaseSettings` with `PROJECT_NAME`, `ENVIRONMENT`, `BACKEND_URL`, `.env` loading. Needs validated environment isolation, service-to-service auth and production-safe settings; do not retain wide CORS as a substitute for internal auth. |
| `apps/ai-service/app/api/health.py` | Existing `/health` returns status, timestamp, environment and version; existing health test asserts this. Preserve or intentionally migrate contract with test/consumer updates. Avoid secrets/environment internals in public readiness. |
| `apps/ai-service/requirements.txt` | Existing pinned baseline: `fastapi==0.115.6`, `uvicorn==0.34.0`, `pydantic-settings==2.7.0`, `pytest==8.3.4`, `httpx==0.28.1`. Check vulnerability/compatibility and project policy **before changing versions**. |
| `apps/ai-service/Dockerfile` | Existing Python `3.11.4-slim`, Uvicorn on :8000, source-copy build. Harden appropriately; do not impose an unverified GPU requirement on CPU serving. |
| `apps/ai-service/tests/test_health.py` | Existing FastAPI `TestClient` health test. Extend rather than remove coverage. |
| `apps/frontend/src/features/search/ImageSearchShell.tsx` | Local-preview-only placeholder. Accepts dragged/browsed image, blob preview, error label; explicitly says image matching unavailable. The UI is **not** real search and must not be marked done in 04.1. |
| `apps/frontend/src/features/search/SearchPage.tsx` | Real search page currently separates `text`/`image` tabs. The 04.2 command-search redesign must account for current routing, filters, React Query and URL semantics. |
| `apps/frontend/src/components/ui/SearchField/SearchField.tsx` | Existing accessible-intent combobox with suggestions/debounce/keyboard interactions; 04.2 should reuse/fix as appropriate rather than duplicate unrelated search logic. |
| `apps/backend/src/config/env.ts` | Existing `AI_SERVICE_URL` optional setting. 04.1 must add/private-connect carefully without making commerce startup dependent on AI availability. |
| `apps/backend/prisma/schema.prisma` | Existing authoritative relational models include `Product`, `ProductImage`, `Brand`, `Category`, `Inventory`, `Order` and `Delivery`; no automatic new AI vector migration is authorized in 04.1. |
| `AGENTS.md` and `AGENT_COORDINATION.md` | Existing agent ownership, CCR/protected-file governance, QA and deployment restrictions apply to AI additions too. |
| Task 03.8/03.9/04.0 specifications | Require source-first, status/evidence honesty, protected ownership, actual browser checks and independent Architect scoring/approval; retain their security contracts. |

**Important:** Current docs may still say simulated image matching is acceptable. The owner's newer, explicit Phase 04 requirement supersedes this wording for **actual deliverables**. Keep the Phase 04 scope authoritative without casually editing all historical feature/task documents. Consult the updated Phase 00 AI docs when they are available and integrated.

### 1.3 Source-of-truth and conflict management

Order of authority: explicit Task 04.1 requirements and safety gates -> current verified source/tests/database schema -> repository coordination and approved owner decisions -> current architecture/task docs -> current external provider documentation -> explicitly marked inference. Do not invent a model registry, embedding table, endpoint or auth mechanism as an existing fact. Every proposal below needs a small contract decision and a test.

---

## 2. Phase 04 delivery boundaries (04.1–04.7)

**04.1 owns foundational AI infrastructure.** Design compatibility for the rest of Phase 04, but do not implement later capabilities early merely because their interfaces are mentioned.

| Task | Owns implementation | Interface/groundwork expected from 04.1 | Not a 04.1 completion blocker |
| --- | --- | --- | --- |
| **04.1 FastAPI AI Service** | Python app configuration, layered routers/schemas/dependencies/services, private auth, lifecycle, health/readiness, errors, logs, bounded Express client, testing, Docker | Ready-to-implement typed model/inference and vector-access contracts | ML artifact, live images, customer search UI |
| **04.2 Real DL Search by Image + Command Search** | Kaggle Free setup, licensed dataset, train/validate/test, fine-tune pretrained EfficientNet-B0 using PyTorch, embeddings, pgvector migrations/backfill/index, live inference, upload/camera, **complete command-search UX redesign**, relevance metrics | Verified 04.1 app, contracts, private transport, model-version/readiness interfaces | Real retrieval quality and usability are assessed in 04.2 |
| **04.3 Supabase Storage** | Safe product-media upload/storage/delivery, transformations, asset lifecycle and embedding refresh triggers | Stable image identity and a future reindex request contract | Supabase Storage API keys/media uploads in 04.1 |
| **04.4 ML Product Recommendations** | Reuse learned embeddings; content/user-context recommendation, behavior-derived profiles if data sufficient, ranking evaluation, model/version tracking, backfills/aggregates, all supported widgets and cold-start/outage fallbacks | Versioned typed recommendation request/result schema and limits | Personalized training and historic behavior tables in 04.1 |
| **04.5 Delivery Tracking** | Backend-authoritative shipment status, location/ETA/timeline, permissions and persistence | AI service must remain unrelated to delivery authority | Shipment mutation/UI/ETA engine in 04.1 |
| **04.6 Leaflet + OSM** | Client maps, markers, route presentation, accessibility, provider constraints | No AI coupling required | Map components/tiles in 04.1 |
| **04.7 Socket.IO** | Scoped admin update -> backend transaction -> owner-room realtime event, reconnection/snapshot/ordering, simulation where clearly labeled | AI availability must not block realtime delivery | Socket server changes in 04.1 |

**Cross-phase data contract:** `Product/ProductImage` identity stays with Prisma, `embedding identity` is tied to source image + preprocessing + model version; return rankable unique IDs; Express re-fetches and filters current catalog records. For delivery, location/status event source of truth is Express/Postgres, *not* FastAPI or a browser-generated socket event.

---

## 3. Task 04.1 functional scope and measurable outcomes

### 3.1 Required by end of 04.1

1. Working FastAPI application in existing `apps/ai-service` with explicit `create_app`/startup strategy, routers, structured errors, OpenAPI and stable health contract.
2. Maintainable but proportionate Python layers with Pydantic request/response models, service adapters, configuration, security and deterministic tests.
3. Reproducible local Python 3.11.4 environment and Docker build; support the HP Core i7/16 GB RAM and **CPU mode**, without GPU requirement.
4. Validated DEV/QA/PROD environment identity and distinct internal endpoints/credentials. Misconfigured or ambiguous environments fail closed for protected routes; isolated QA tests never call shared DEV.
5. Private authenticated Express -> FastAPI transport, with bounded timeouts, URL/host allowlist/SSRF protections appropriate to service configuration, strict responses and no secret disclosure.
6. Versioned or explicitly frozen initial API contract: liveness/readiness, internal capability/status, future `image-search` and `recommendations` schemas (may be nonfunctional `503 MODEL_NOT_READY`, not pretend search).
7. Model/provider interface and lifecycle architecture that can load a trained artifact **once per process later**, validate model/checksum/version/dimensions, and support readiness and bounded inference. **No model weights required in 04.1.**
8. Clear vector-access decision and typed boundary to later pgvector; **no shared database privilege or schema migration in 04.1 by default**.
9. Structured request/error logging, health, timings, redaction, resource limits and graceful shutdown.
10. Python unit/API tests, Express adapter contract tests, DEV/QA isolation checks, controlled AI failure demonstration, Docker smoke, documentation and evidence.
11. Correctly scoped documentation/handoff for 04.2–04.7, including the command-search UX requirement.

### 3.2 Explicitly excluded from implementation now

- Kaggle Free account/notebook/GPU initialization, CUDA tooling, actual PyTorch training, dataset acquisition and model weight/artifact download.
- Vision model embedding generation, inference on real catalog photos, vector table creation/backfill/index activation, AI product-result UI or a fake matching substitute.
- Browser camera UX, drag-drop redesign, command-search implementation, image result gallery, image-search analytics at production scale.
- Supabase Storage provider/API integration or live media changes.
- Personalized/co-purchase recommendations, material ML feature processing or actual ranking-model training.
- New user-behavior/recommendation/AI event persistence and Prisma migrations unless strictly necessary for 04.1 (unlikely).
- Delivery status/ETA/maps/Socket.IO changes.
- Any change to payment states, supervised worker/Stripe isolation, commercial email dispatch, PDFs, production infrastructure or deployment.

---

## 4. Python/FastAPI architecture — every layer

Use the existing monorepo; **inspect exact files and import patterns first**. This is a target shape, not a command to generate unused modules:

```text
apps/ai-service/
  app/
    __init__.py
    main.py                     # application factory, lifespan, middleware/router assembly
    api/
      __init__.py
      dependencies.py           # authorization and injected typed services
      routes/
        health.py               # liveness/readiness (reuse existing route)
        capabilities.py         # internal service contract/capability availability
        image_search.py         # deferred protected contract: not-ready until 04.2
        recommendations.py      # deferred protected contract: not-ready until 04.4
    core/
      config.py                 # validated Pydantic Settings, env separation
      security.py               # internal auth & credential redaction
      errors.py                 # domain exceptions / sanitized HTTP mappings
      logging.py                # structured log data, request correlation
      lifespan.py               # future model lazy/startup ownership
    schemas/
      common.py                 # response/meta/error models and versions
      image_search.py           # future request/result DTOs
      recommendations.py        # future request/result DTOs
    services/
      image_search_service.py   # orchestration interface; 04.2 implementation
      recommendation_service.py # orchestration interface; 04.4 implementation
    models/                     # ML artifact descriptors/adapters, NOT ORM Product models
    processors/                 # preprocessing/inference adapters added when real models exist
    integrations/               # vector gateway/adapter interfaces, no unauthorized DB creds
  tests/
    conftest.py
    test_health.py
    test_settings.py
    test_auth.py
    test_contracts.py
    test_errors.py
    test_limits.py
    test_lifespan.py
    test_environment_isolation.py
  requirements.txt / lock strategy (following project policy)
  pyproject.toml                # only if justified by formatter/type/checker/test configuration
  .env.example                  # placeholders ONLY; never secret values
  Dockerfile
  .dockerignore
```

### 4.1 Application entry and lifespan

- Use an application factory if it improves isolated tests/dependency overrides; keep an `app` export that existing Uvicorn/test commands can import.
- Prefer `lifespan` (FastAPI recommended lifecycle) over existing deprecated `@app.on_event("startup")`; do not leave both acting on the same resources.
- Initialize lightweight configuration/logging when starting 04.1. Reserve model adapter load/release hooks for 04.2; no CPU/GPU resource spin-up or model downloads on import.
- Liveness stays cheap; readiness reports whether configured required dependencies/model are actually ready **without secrets or overly detailed internal topology**.
- Handle shutdown of future HTTP/embedding connections and model resources; avoid orphan background work.

### 4.2 Routers/controllers

- `APIRouter` with clear prefix/version and tags. Health endpoints handled separately from protected inference routes.
- Endpoints validate input, call an injected application service and serialize typed output. No ML feature extraction, SQL or business inventory decisions in HTTP handlers.
- Avoid public routes whose only behavior is fictional similarity results. If exposing future routes, document them as not-ready and return a stable controlled `503`/appropriate code.
- Keep `/health` backward compatible unless migration justified. Keep `/docs` and `/openapi.json` restricted/disabled as appropriate outside trusted local development.

### 4.3 Pydantic schemas and serialization

- Use Pydantic v2-style `BaseModel`, `Field`, bounded lists/numbers, `UUID`, strict/forbid-extra behavior where compatibility permits, and response models.
- Decide explicit alias strategy (`productId`/`modelVersion` JSON vs Python `product_id`/`model_version`). Validate both outgoing Express and incoming FastAPI contracts; do not leak snake/camel differences.
- Reject unbounded candidates, `NaN`, infinity, invalid/duplicate product IDs, inconsistent content type, unknown request modes and oversized JSON. Rank/scores have finite valid numeric types; do not call uncalibrated scores probabilities.
- Treat expected empty matches as valid 200 result rather than always an error.

### 4.4 Services, processors, models

- Define typed protocols/interfaces for `ImageEmbeddingEncoder`, `EmbeddingSearchGateway`, `RecommendationRanker`, `ModelDescriptor`, `Readiness` and current model version/config.
- An image encoder takes already-validated bytes/decoded image in 04.2 and produces a finite normalized vector with exact expected dimension. It must never access products, payments or user sessions directly.
- Embedding gateway 04.2 will query a **restricted, version-specific pgvector catalog projection** with bounded top-K and authorized source references. The Python service must never be handed unrestricted financial database credentials.
- Use `def` for synchronous CPU-bound handlers where appropriate; `async def` for actual async I/O, with bounded CPU/GPU inference scheduling. Do not run CPU-intensive work unbounded on the event loop. Do not eagerly load a model in every request.
- Test fakes are allowed in `tests/`; production readiness must fail or honestly report unavailable when no real model is installed.

### 4.5 Configuration

- Start from the existing `pydantic-settings` module. Validate `AI_ENVIRONMENT`, internal service secret(s), bind host/port, Express origin/target, model readiness mode, max input bytes/pixels, candidate/top-K limits, inference timeouts, concurrency, log levels and optional model artifact metadata.
- Avoid duplicate/conflicting environment loaders between Express and Python. Service-to-service authorization and explicit environment identity are stronger than permissive CORS. Never allow any remote-host target supplied directly by a customer.
- Missing required protected settings in QA/DEV/PROD fail closed or disable protected capability clearly. A localhost demo mode must not silently become network-accessible unauthenticated.
- Add secret-free `.env.example`, document safe configuration and runtime startup from workspace root and AI-service directory. Read CI defaults/prod requirements before changing.

---

## 5. API contracts — proposed baseline, finalize after source inspection

**Existing** repo API examples use public Express `/api/...` and a separate FastAPI `/health`; routes mentioned in old docs (`/image-search`, `/recommendations`, `/api/ai/...`) are conceptual. Avoid assuming those paths are already implemented or introducing two public APIs accidentally.

**Recommended internal convention:** use `/internal/v1/*` under FastAPI and keep `/api/ai/*` public Express routes for future 04.2/04.4. If existing architecture consumers mandate a different prefix, document one consistent equivalent and test it. Version changes require compatible migration.

### 5.1 Liveness / readiness / capabilities

| Proposed route | Protection | Meaning | 04.1 requirement |
| --- | --- | --- | --- |
| `GET /health` | Safe restricted-scope liveness; if exposed sanitize | Process responds with bounded nonsecret JSON; do not test external DB/ML | Required, migrate existing contract carefully |
| `GET /internal/v1/ready` | Internal auth/private network | Configured capabilities and eventual model/embedding readiness; truthful `ready=false` when absent | Required |
| `GET /internal/v1/capabilities` | Internal auth/private network | Supported contract versions, available features, current model artifact version if any, limits (no keys) | Recommended if needed for Express gating |
| `POST /internal/v1/image-search` | Internal auth/private network | Future multipart/validated image -> learned embedding -> ranked references | Contract only / not-ready until 04.2 |
| `POST /internal/v1/recommendations` | Internal auth/private network | Future bounded context/candidates -> ML ranking -> references | Contract only / not-ready until 04.4 |

**Do not return HTTP 200 and invented results for an uninitialized model.** A future endpoint may be omitted until the feature task, or present with documented machine-readable `AI_MODEL_NOT_READY` status, depending on Express consumer requirements. Choose one and assert it in tests.

### 5.2 Response contracts and version safety

Example conceptual future search result (not proof of existing implementation):

```json
{
  "data": {
    "matches": [
      { "productId": "550e8400-e29b-41d4-a716-446655440001", "score": 0.82 }
    ],
    "modelVersion": "vision-example-v1",
    "embeddingVersion": "embedding-example-v1"
  }
}
```

- IDs are valid UUIDs matching actual Prisma `Product` identities. Express resolves unique IDs using Prisma, excludes inactive/unauthorized/absent products, verifies current availability rules, and returns authoritative fields in established frontend DTO shape.
- Bound maximum returned candidates; preserve stable deterministic tie-breaking and no duplicate product IDs. Model metadata helps incident/debugging but must not leak raw private vectors to browsers.
- Define explicit `Content-Type`, upload part name, allowed image MIME/signatures, decoded pixel/file limits and accepted response schema in **04.2**. A 04.1 schema can describe the future shape without processing real uploads.
- Recommendation DTO (04.4) includes bounded context and supported mode, candidate/reference IDs, scores, model/version and optional conservative reason tags. No raw customer addresses, email, JWT, card data, order histories or full behavioral event logs.
- Publish OpenAPI and check contract drift against TypeScript schemas. Do not generate client artifacts unless proven worthwhile for this monorepo.

### 5.3 Error envelope

Use the existing Express error-envelope conventions at the public gateway. FastAPI internal application errors should be typed, sanitized, stable and mapped by Express rather than passing arbitrary raw traces to React.

Example *internal* application error:

```json
{
  "error": {
    "code": "AI_MODEL_NOT_READY",
    "message": "AI processing is temporarily unavailable.",
    "requestId": "request-id"
  }
}
```

| Situation | Recommended meaning and handling |
| --- | --- |
| Invalid/missing API secret | 401/403, no useful internal data in body |
| Malformed typed JSON / bounds | FastAPI 422 or mapped contract error; no uncontrolled traceback |
| Oversized upload | 413; perform size limit at proxy/Express/FastAPI before decode |
| Unsupported image MIME or magic bytes | 415/422, as documented |
| Too much work / rate limited | 429 and honest bounded retry metadata |
| No real model/artifact deployed | 503 `AI_MODEL_NOT_READY`, no fake ranked products |
| Model/index version conflict | 503 `AI_INDEX_NOT_READY`/stable equivalent, do not mix vectors |
| Model inference unexpected failure | sanitized 500 with request ID; full traceback only in restricted redacted log |
| Express->FastAPI unreachable/timeout | public gateway controlled 503/504, bounded wait, unaffected non-AI commerce |
| Empty real retrieval result | 200 with empty `matches`; frontend offers useful fallback |

### 5.4 API compatibility gates

- Document and test every exported public route/DTO. No breaking change to existing `/search` semantics or Query caches in 04.1.
- Private FastAPI paths/credentials never returned to browser, source maps, HTML or public debug logs.
- Validate FastAPI response in Express even after TLS/auth and JSON parsing; reject extra/unexpected shapes and impossible scores.
- User request IDs can be propagated in a safe controlled header; reject unbounded/malicious header values and don't log them as trust tokens.

---

## 6. Security and environment isolation — first-class requirements

### 6.1 Internal boundary

- Verify user/customer permissions at the Express gateway when those future routes are exposed. FastAPI authenticates **the backend service**, not end users; do not forward customer JWTs as an AI service credential.
- Use private transport or loopback/internal Docker networking; a strictly validated service secret (e.g. shared short-lived/configured internal credential) is required for protected routes. Store it separately in DEV/QA/PROD; never use a default hardcoded key.
- CORS is not service authentication. Existing `allow_methods=["*"]`/`allow_headers=["*"]` should be reduced or removed as appropriate for internal server-to-server calls; confirm no authorized browser consumer before doing so.
- Explicit allowed service URL/host; prevent redirect following to unexpected hosts; no attacker-selected upstream URLs or SSRF/proxy abuse.
- Do not expose unprotected interactive Swagger in production if it leaks internals; avoid promising Docker private networking when it is still just a local localhost process.

### 6.2 Upload and image hardening (04.2 implementation, 04.1 contracts)

- Layered size/type checks in React (UX), Express (security gateway) and FastAPI (decode safety). Validate magic bytes and actual image decode, not MIME or filename alone.
- Bound bytes, pixel count, width/height, animation frames, memory, inference concurrency and request time. Reject decompression bombs, corrupt images and unsafe formats; never execute/extract uploaded archives or image metadata as code.
- Strip EXIF and privacy-sensitive metadata when appropriate; avoid permanent storage of customer query photos. Delete temporary content on completion/cancel/error and do not put raw photos in logs, vectors returned to browser or analytics.
- Camera access is user-initiated, permission-gated and stops streams when closed. Do not enable microphone or continuous background capture.

### 6.3 Database and pgvector security (04.2)

- Prefer a dedicated schema/tables/projections such as versioned `ai_product_image_embeddings` with explicit `productId`, `productImageId`, `modelVersion`, `preprocessVersion`, `embeddingDimension`, source asset identity/checksum, active flag and update lineage.
- The **actual field names/schema**, pgvector dimension/index choices and migration mechanism require Task 04.2 approval after inspecting current Prisma and live migration state. Do not turn the conceptual example into an unreviewed migration.
- Product/stock/order/customer tables remain Prisma/Express authority. Read-only inference credentials (if DB connection is granted) must not access or mutate payment, orders, auth or mail tables. Use separate, tightly reviewed ingestion write capability for embedding batch jobs only; not customer HTTP handlers.
- Enforce DEV/QA/PROD project identity, migration approval, role privileges, RLS/grants and transactional model-index activation; QA uses local fixtures and must never fall through to shared DEV Supabase.
- Review pgvector extension availability, index performance (exact vs HNSW/IVFFlat after measurement), index size/refresh cost, metadata filters, per-model versions, handling stale/removal and safe backfill rollback.

### 6.4 Financial/external safety

Do not give the AI process Stripe, Brevo, JWT-refresh, Supabase service-role or payment supervisor secrets. Do not touch Task 04.0's isolated older payment backlog. Real Brevo/Supabase Storage/Kaggle/external image-provider calls require appropriate scope/privacy and account authorization before execution.

---

## 7. ML architecture preparation for 04.2 and 04.4

### 7.1 Real vision training decision

- **Training platform:** **Kaggle Notebooks Free**, GPU typically NVIDIA T4 when allocated; quota and availability are conditional. Do **not** book/initialize it during Task 04.1.
- **Local hardware:** HP Intel Core i7, 16 GB system RAM, Intel UHD integrated graphics. Treat advertised ~8 GB GPU memory as likely shared RAM; support Python/CPU inference locally and avoid assuming CUDA.
- **Framework:** PyTorch, `torchvision` and justified image-processing dependencies added when needed in 04.2. Do not inflate baseline 04.1 Docker image with heavyweight training dependencies.
- **Initial model:** pretrained **EfficientNet-B0 CNN**, fine-tuned on carefully prepared electronics product images for **embedding similarity/metric learning**, not merely classification. Compare a pretrained CLIP/SigLIP approach later only if time and evidence justify it.
- **Training method:** transfer learning + limited fine-tuning, with appropriate positive/hard-negative pairs, controlled augmentations, repeatable splits, learning curves/checkpoints and validated model artifacts. Never label frozen pretrained inference alone as fine-tuned.
- **Data:** sufficiently diverse and appropriately licensed product photographs. Different angles, lighting, background, near-duplicates, accessories and close SKUs matter more than inflated raw image count. Prevent same/near-identical photos across train/held-out test sets.
- **Evidence:** training configuration, dataset/source policy, seeds, held-out Recall@1/@5/@10, mAP (and slice failure examples), model dimension, training/runtime latency, actual device memory, artifact checksum, preprocessing version, index version and rollback plan.
- **Accuracy claims:** quality targets set after dataset/hardware baseline, not invented in 04.1. Small-data models can still confuse near-identical products; report limitations.

### 7.2 Inference / vector-index contract

```text
04.2 offline (Kaggle/controlled pipeline): train -> validate -> artifact hash/version
    -> ingest approved catalog images -> normalize/encode -> stored embeddings
    -> versioned pgvector index (not auto-active until completeness checks)
04.2 online (CPU FastAPI or measured suitable runtime): image -> validate/decode
    -> exact same preprocessing/model -> query vector -> version-matched
    nearest-neighbor search -> unique references/scores -> Express catalog filtering
```

- Artifact acquisition must be controlled and checksum-verified, from approved trusted storage; no arbitrary startup fetch or execution of unsafe pickle from unknown origin.
- Preprocessing, normalization, vector dimension and model checkpoint must match index metadata exactly; fail closed on mismatches.
- Model activation must avoid mixed-version results during reindex/backfill. Preserve prior coherent version for rollback where feasible and authorized.
- Benchmark intended **CPU inference** on the HP/local/target server; free Kaggle training GPU does not mean deployed DigitalOcean VPS has CUDA. If CPU budget is inadequate, require an explicit serving-hardware decision rather than silently changing architecture.
- Do not use an embedding database as customer account or payment data store. No browser exposure of raw vectors.

### 7.3 ML recommendations (04.4)

- Reuse trained product image embeddings to build a genuine content-based similarity recommender. Add behavior-derived profile vectors or a separately learned ranker **only when event history/labels are sufficiently credible**.
- Modes: `Recommended for You`, `You May Also Like`, `Similar Products`, `Frequently Bought Together`, `Popular Products`; distinguish which modes use learned embeddings, aggregated co-purchases, popular baselines and cold-start strategies.
- Do not mislabel popularity weights or category rules as trained personalized ML. If insufficient behavioral data exists, document that limitation and use a truthful fallback.
- Event/data contracts consider views, clicks, cart additions, wishlists, purchases, recommendation impressions/clicks/conversions; filter bot noise and minimize personal information. Future event storage/backfill belongs in 04.4 with reviewed Prisma migrations.
- Evaluate relevance (Recall/NDCG/HitRate@K as appropriate), coverage, diversity, cold-start, accidental leakage and serving latency. Apply authoritative product filtering after ranking; never recommend unlisted/inaccessible SKUs because an embedding exists.

---

## 8. Express integration — required Task 04.1 coding work

### 8.1 Adapter/client ownership

Find and follow the current Express integration style and error schemas before adding an `AiServiceClient` (name/location proposed). It owns:

1. Allowlisted AI base URL from server-side configuration, explicit DEV/QA/PROD identity and private secret/header.
2. Bounded connection and total timeouts, abort propagation on client disconnect where safe, bounded HTTP response size, and no uncontrolled repeated retries of heavy inference work.
3. Proper handling of 401/403, 413, 422, 429, 503, invalid JSON, schema mismatch, DNS/network errors and abort/timeouts.
4. Sanitized request-id/duration telemetry; do not log credential headers, raw upload bytes, vector data, complete browsing history or arbitrary provider traces.
5. Strong runtime response validation with existing TypeScript schema patterns. Verify UUIDs, length, finite scores, source/model version when present, ordering and duplicate references.
6. Graceful AI-feature fallback; **never** couple AI health to Express boot readiness for catalog, payments, Orders, PDFs or email. A dead AI process must not keep the store unavailable.
7. QA adapter mocking/captured behavior isolated from live shared DEV, with explicit test-only credentials/targets.

**Scope choice:** In 04.1, implement an *internal client* and a guarded health/contract smoke path to prove connectivity; do **not** publish a fully usable real customer image-search or recommendations route yet. If adding a diagnostic route, secure/admin-scope it or keep it internal; don't expose system internals to guests.

### 8.2 Future image result processing (04.2)

- Express handles session/guest access policy, per-user/per-IP rate limits, request budget, product lookup, active/visible restrictions and stable result DTOs.
- Image search does **not** provide arbitrary product creation/update endpoints and doesn't bypass current Search business logic.
- If AI returns stale references after catalog changes, Express filters them and can request bounded extra candidates, without unbounded recursive loops.
- Normal text search must remain available when AI is unavailable, without mixing fake image matches into text results.

### 8.3 Shared frontend/API code governance

If 04.1 needs to edit the shared Express API client, middleware, config or auth files, first identify the protected workstream and get a CCR if required. Prefer a dedicated AI integration module. Existing checkout/cart/auth/Stripe code must remain untouched.

---

## 9. UI/UX plan — commitment for 04.2 command search, not 04.1 scope

### 9.1 Current state

The verified frontend has `SearchPage.tsx` with Text/Image tabs and `ImageSearchShell.tsx` local image preview only. In 04.2, **replace the placeholder-level behavior with a designed, cohesive command-search discovery workflow**, rather than attaching an ML response to an outdated UI.

### 9.2 04.2 intended experience (to refine against Figma and real screenshots)

- A unified prominent search trigger in the existing header/search journey, available for keyboard and touch; appropriate optional shortcut such as **Ctrl/Cmd+K** if nonconflicting. Avoid hijacking browser shortcuts or typing into unrelated inputs.
- A premium command-search dialog/palette or responsive search surface, matching ElectroHub's tokens; **one unified entry point for text, suggestions, recent context (privacy-safe), and image-search action**.
- Search typing: existing fast suggestions, bounded debouncing, keyboard arrow navigation, meaningful groups (Products, Brands, Categories), clear-empty state, ESC close, Enter to select and correct URL semantics.
- Image mode: dedicated visible Upload Photo / Use Camera actions, drag/drop and paste only where safe/intentional, file preview/replace/remove; camera permission only after explicit user action. All unsupported/oversized images give immediate useful feedback.
- True processing state: show bounded progress/step text without fake percentages; cancellation aborts pending requests where possible. Keep form usable and show a safe retry if AI is down.
- Results: ranked verified Product cards with current images/name/price/availability, reasonable score presentation (relative similarity, never calibrated probability), no matches and text-search fallback; clicking navigates to existing Product Details.
- Responsiveness: desktop dialog, mobile full-height/bottom-safe layout chosen by actual design review; no awkward nested scroll, keyboard overlap, fixed overflow or clipped photo preview. Design at 320, 390, 768, 1440, 1920 px and 200% zoom.
- Accessibility: semantic dialog/combobox/listbox (use existing Radix/shared primitives), reachable close/clear/camera buttons, focus trap/return, visible focus, screen-reader result counts, reduced motion, practical touch targets, alt text and permission-denial alternative.
- Privacy/security: no silent photo upload merely on selection, no indefinite client blob URLs, revoke previews on remove/logout/unmount, do not persist uploaded customer images or add image queries to URLs/history unintentionally.
- QA: keyboard/touch/camera-permission denial, file validation, interrupted upload, stale response race, no-results, AI down, account switch, responsive screenshots, real model-result matching and backend/catalog security.

### 9.3 Task 04.1 UI deliverable

- **No customer-facing command palette implementation.** Produce only the documented UX acceptance contract and nonvisual API/error models needed later.
- Verify this task does not break existing text search and placeholder interaction. Do not add a dummy “AI Search ready” badge or mock recommendations.
- 04.2 owns final Figma-aligned designs, content, visual QA, component implementation, tests and navigation/URL decisions.

---

## 10. Docker, startup and developer tooling

### 10.1 Local workflow

- Continue using the repo's Python 3.11.4 convention unless current source/CI has approved a newer supported interpreter. Create `.venv` local to AI service or documented equivalent; never install packages globally or modify unrelated Node build state.
- Ensure developer script(s) start real AI service with explicit configuration. Avoid arbitrary port hardcoding; current Dockerfile uses 8000; confirm port availability and decide per-environment bindings.
- Main DEV FastAPI instance may use loopback/internal port :8000 as example; isolated QA should use a **different** explicit port/credentials or mocked adapter (e.g. :8200 if free). Numbers are **proposals**, not verified running processes.
- Keep reusable README/runbook commands short: create venv, install pinned deps, run lint/type/tests, start FastAPI, inspect health, run Express integration smoke, stop cleanly.
- Kaggle is **not** a developer runtime dependency for 04.1 and should not be set up now.

### 10.2 Container/security packaging

- Extend existing Dockerfile: non-root where feasible, pinned reproducible dependency installation, minimal base layers, `.dockerignore` preventing `.env`, credentials, caches, notebooks, large dataset or untrusted weights being baked into image.
- Health/lifespan and graceful stop; limited workers/resources appropriate to CPU mode. No multiworker duplication of large ML models by default; choose workers after measurement.
- Preserve Python `uvicorn` server and containerized service boundary without exposing private API on public internet through Nginx. Production rollout remains Phase 06/authorized deployment.
- Build and run a local container smoke with no shared DEV secret if feasible; record build digest and endpoint result. Never silently write to Supabase from a Docker build.

### 10.3 Code hygiene

- Adopt modest project-appropriate Python lint/formatter/type tools if absent (e.g. Ruff and a lightweight type checker); pin them and document commands, don't open a full repository-wide Python style migration.
- Typed settings, explicit domain exceptions, small services, safe dependency injection, async discipline, context-managed resources and no global mutable inference result cache shared across accounts.
- Keep tests deterministic and small; avoid downloading a pretrained model during CI/test collection.

---

## 11. Logging, health, reliability and performance

### 11.1 Logs/observability

Record bounded structured events: `ai.runtime_start`, `ai.health`, `ai.ready`, `ai.request`, `ai.inference` (future), `ai.validation_rejected`, `ai.model_unavailable`, `ai.timeout`, `ai.integration_error`, with request ID, environment class, operation, duration, coarse result count, model/version where appropriate.

Never log: uploaded raw images, API keys, full request bodies with personal data, access/refresh JWTs, database URLs, full traceback sent to customer, customer email/address/phone, Stripe/Brevo secrets or private vectors.

- Version metrics can be recorded without a model being present, but **do not** claim an inference model is loaded when none exists.
- Track basic process/startup failure, 4xx vs 5xx, request latency and bounded concurrency. Avoid full Prometheus/Sentry overhaul solely for 04.1.

### 11.2 Health states

- Liveness = process HTTP path works, independent from DB, Kaggle/GPU and commerce.
- Readiness = whether **declared required AI capabilities** are usable; `04.1` may truthfully report `modelReady=false` and `imageSearchAvailable=false` while service infrastructure is healthy.
- Express's own commerce readiness should not be blocked by AI readiness; only AI-dependent public features show a controlled unavailable/retry state.

### 11.3 Resource budgets

- Pick explicit initial request/response size, concurrency and timeout budgets through measured local CPU/API smoke. Record the values and justification in the task evidence; do not use arbitrarily enormous “safe” limits or a single Promise timeout that leaves CPU work continuing forever.
- Protect expensive future GPU/CPU inference with bounded admission/semaphore/worker scheduling and cancellation semantics. Do not allocate a separate async job queue or paid GPU service in 04.1 unless proven necessary.

---

## 12. Testing matrix — evidence proportional to risk

| Test ID | Requirement | Minimum evidence | Owner |
| --- | --- | --- | --- |
| F41-01 | Existing FastAPI application retained/refined | app import, application factory/lifespan smoke, no deprecated duplicate hooks | AI |
| F41-02 | `/health` contract | pytest `TestClient`, validated 200 nonsecret response | AI |
| F41-03 | readiness truthful without model | `modelReady=false`/controlled ready status; no fictional search results | AI |
| F41-04 | env/settings validation | missing/bad secret, invalid budget, duplicate env, wrong bind/target rejected | AI |
| F41-05 | QA/DEV separation | isolated credentials/target and no cross-env fallback | AI + Integration |
| F41-06 | internal auth security | missing/wrong key rejected; correct scoped credential accepted; no secret leaks | AI |
| F41-07 | OpenAPI schema | typed request/response, bounded aliases/validation; no accidental public inference access | AI |
| F41-08 | schema negative tests | invalid UUID, duplicate refs, NaN/inf, over-limit, extra fields | AI |
| F41-09 | controlled errors | validation/auth/unavailable/internal errors map to nonsecret stable codes | AI |
| F41-10 | timeouts/resource limits | finite response/timeout, abort handling, no infinite processing | AI + Backend |
| F41-11 | model lifecycle seam | model absent handled, adapter injection and shutdown resource cleanup verified | AI |
| F41-12 | no unauthorized DB writes | zero live database credentials/SQL mutations; no vector migration in 04.1 | DB + AI |
| F41-13 | Docker build/start/stop | real local image build and health smoke where feasible | AI |
| F41-14 | Express private transport | bounded internal HTTP call, auth header, response parser and request ID | Backend |
| F41-15 | Express malformed upstream defense | unparseable JSON, invalid IDs, overly large response and invalid scores rejected | Backend |
| F41-16 | AI outage isolation | stop/mismatch AI; catalog/auth/cart/checkout/order routes remain operational (safe fixtures/evidence) | Integration |
| F41-17 | current search UI nonregression | text results, suggestions, image placeholder unaffected and no fake ML claim | Frontend |
| F41-18 | protected-file governance | CCRs/owners for config/shared client if edited | Integration |
| F41-19 | Python quality | relevant lint, type checks, pytest; no model downloads during tests | AI |
| F41-20 | affected Node quality | affected TypeScript checks/tests/build/lint; no payment regressions introduced | Backend |
| F41-21 | security/secret scan | no credentials, `.env`, datasets, binary models or notebooks added accidentally | Integration |
| F41-22 | documentation/handoff | runbook, API contract, accurate future task interfaces and screenshots/log evidence | Integration |

### 12.1 Core Python unit/API checks

- Health, readiness, settings, dependency overrides, protected endpoints, startup/shutdown, error envelope, request correlation, validation and secret redaction.
- A stub fake in tests can assert service calls and error handling; **not** a production matching algorithm. A real ML result is expressly **not** required/claimed by 04.1.
- Use no cloud resource, database secret, provider email or paid API during normal tests.

### 12.2 Express integration tests

- Valid upstream response contract, denied auth, connection refusal, timeout, maliciously large body, malformed payload, wrong model/index version, duplicate/invalid product IDs and server-safe fallback.
- Do not issue customer payments or mutate orders to prove AI failure isolation; use disposable QA fixtures or previously accepted relevant evidence.
- Verify AI client does not accidentally propagate `Authorization: Bearer <customer JWT>` to FastAPI logs or request body.

### 12.3 Browser/UX QA

- If 04.1 makes no actual customer UI changes, no new command-search visual acceptance is required. Perform a bounded normal Search smoke at an appropriate viewport and inspect screenshot only if there is an affected frontend regression; 04.2 will own comprehensive redesign QA.
- Verify existing image placeholder is honestly labeled not available; no misleading functional AI claim.

### 12.4 CI/release gates

- Integrate Python lint/test/build **as supported by current GitHub Actions** without deleting existing Node security/test jobs. CI file edits require coordination and explicit authorization. If CI changes cannot be executed from local scope, submit a verified plan/commands and mark CI gate pending rather than claim passing.
- No production Docker deployment is a 04.1 acceptance requirement; local packaging and documented future release path are.

---

## 13. Phase 04 cross-task acceptance handoffs (required documentation, not current implementation)

### 13.1 04.2 — image search & command-search UX

**Explicit deliverables:** secure upload and mobile camera capture; rigorous image decode validation; approved training dataset and real fine-tuning on Kaggle Free; versioned EfficientNet-B0 encoder and embedding pipeline; **pgvector nearest-neighbor retrieval** with measured query latency, indexes and coherent activation; strict model-vs-index version match; ownership and permissions; Express filtering; full React command-search redesign; responsive, accessible real results; model failure fallback; measured Recall@1/5/10 and mAP.

**Input from 04.1:** private AI transport, typed error/response and model-version contract, reliable health/readiness, lifecycle adapter and DEV/QA safety.

**Open 04.2 decisions:** dataset count, labels/SKU identity, exact-product vs visually-similar ranking objective, positive/hard-negative construction, target CPU inference latency, image/pixel limits, embedding dimension and index choice, storage/artifact hosting, reindex/backfill migration approvals, final command UI design and authoritative result DTO.

### 13.2 04.3 — product image lifecycle

**Deliverables:** Supabase Storage product media upload with admin-only authorization; signed/transformation-safe asset identity, storage/update/delete lifecycle, rate/payload limits, URLs and fallback images; reliable image metadata update; queue/batch re-embedding of changed images with idempotency; no upload of customer query photos without a separately approved policy. Image deletion/update invalidates versioned embeddings without accidentally showing stale/unlisted products.

### 13.3 04.4 — real ML recommendations

**Deliverables:** learned embedding-based similarity recommendations and suitable user/context vectors; optional learned ranker if data supports it; named modes, cold-start, honest non-ML popularity/co-purchase fallbacks, privacy/security, event capture, versioned ranking, measurable relevance/coverage/latency, catalog filtering, pagination/caching and account isolation. No fake personalized assertions.

### 13.4 04.5 — order delivery tracking

**Deliverables:** backend-authoritative statuses `CONFIRMED -> PREPARING -> OUT_FOR_DELIVERY -> DELIVERED` with validated permitted transitions, owner/admin scope, location source/precision/privacy, ETA derivation and labeling, timeline/event persistence, monotonic ordering and stale-update behavior; no false live GPS in simulated data. Avoid touching payment states.

### 13.5 04.6 — Leaflet / OpenStreetMap

**Deliverables:** map UI with accessible text alternative, route/marker display, attribution/provider usage compliance, lat/long validation, graceful tile errors, responsive mobile behavior, safe location precision and no third-party leaks beyond required map functionality. Admin and customer views only see authorized shipment location.

### 13.6 04.7 — Socket.IO

**Deliverables:** authenticated, customer-/order-scoped rooms, server-verified admin status/location updates, anti-IDOR, reconnect and snapshot catch-up, dedupe/out-of-order handling, server sequence/timestamps, rate bounds, scaling decision supported by measured load, mobile lifecycle and accessible announcements; simulation may be used **for delivery movement** with clear demo labeling, not as a substitute for real trained image search.

### 13.7 Cross-phase testing stack

- Python `pytest`/FastAPI `TestClient`/HTTPX; optional Ruff/type checking after project alignment.
- Node/Express TypeScript test conventions; Prisma migration checks; isolated PostgreSQL fixtures.
- Playwright/browser tests, Storybook where current patterns support it, Chrome/Brave/Firefox checks proportional to feature risk, keyboard/a11y checks, 320/390/768/1440/1920 px and 200% zoom for redesigned UI.
- PyTorch offline training/evaluation notebook (04.2) with dataset provenance and artifact validation; vector index correctness/performance tests.
- Docker build/local smoke; CI compatible with current GitHub Actions governance; no unapproved external sends/charges.

---

## 14. Workstreams, ownership and protected files

| Workstream | Owns | Protected dependencies / coordination |
| --- | --- | --- |
| **AI SERVICE** | `apps/ai-service/app/**`, Python tests, model interface, nonsecret local Docker config | Shared deployment/CI and AI DB adapters when introduced |
| **BACKEND INTEGRATION** | Dedicated Express AI client and private contract tests | `src/config/env.ts`, auth middleware, shared API/error clients require owner/Architect coordination |
| **FRONTEND UX** | No redesign in 04.1; future 04.2 command-search designs and implementation | Existing Header/SearchField/SearchPage/design tokens and routing |
| **DATABASE / ML STORAGE** | Future 04.2 pgvector design, migrations, restricted access and backfills | Prisma schema/generator, connection roles, remote migration approval |
| **SECURITY / OBSERVABILITY** | Internal secrets, scrubbed logging, bounded requests, environment identity | Protected shared middleware and secret configuration |
| **INTEGRATION** | Repo inspection, branch ownership, task registry, QA, evidence, independent review handoff | Authorizes integration only after review |

Use CCR for protected cross-workstream edits; approval to change source never implies permission to run against shared DEV/PROD or configure Kaggle, Supabase Storage or external credentials. With safe scope confirmed, parallelize isolated Python vs Express adapter tests only when there is a real benefit, and serialize final integration.

---

## 15. Implementation stages and efficient execution plan

**Stage 0 — Source, ownership and contracts.** Verify local worktree/base/04.0 integration; inspect Python/Express/search wiring and test tooling; map dependencies. Agree one private API path/JSON casing/auth mechanism and environment split. Record manifest and CCRs once.

**Stage 1 — FastAPI foundation.** Refactor existing main/config/health proportionately; typed settings; lifespan; security dependency, errors/logging; actual liveness/readiness and OpenAPI contracts; maintain test.

**Stage 2 — AI interface seam.** Define model descriptor, future encoder/ranker/vector gateway interfaces, version/availability semantics, upload/recommendation Pydantic contracts or clear deferred routes, deterministic test injection. No fake production model.

**Stage 3 — Express integration.** Dedicated private authenticated client with strict timeout, response validation and graceful degradation; add the minimum protected internal smoke to verify transport. Do not expose unimplemented public AI functionality.

**Stage 4 — Environment and packaging.** Isolated QA configuration, distinct secrets and targets, Docker local smoke, Python toolchain/CI integration if authorized and proportionate. No Kaggle or remote DB.

**Stage 5 — Tests and focused QA.** Run relevant Python/Node unit/integration/security tests, AI-down scenario, environment isolation and current search nonregression. Fix material issues, avoid broad repeat audits.

**Stage 6 — Evidence and handoff.** Produce one concise implementation evidence section, API contract/runbook update and 04.2–04.7 interfaces. Gather actual command outputs, SHA, test results and any remaining approvals. Stop; do not self-approve.

### Time management across Phase 04

Target **14 days total** for 04.1–04.7, optionally **2–3 extra days** if required by real blockers. Suggested initial planning envelope (revise after 04.1 repository inspection): 04.1 ~1–2 days, 04.2 ~3–4 days including data/GPU/command UX, 04.3 ~1 day, 04.4 ~2 days, 04.5 ~1 day, 04.6 ~1 day, 04.7 ~2 days and integration/verification across tasks ~1–2 days. These allocations overlap some tasks and should be actively recalculated; do not claim all work can be guaranteed within 14 days. Prioritize working, safe ML retrieval and reliable integration over a large but unverified feature list. The future training GPU is free **when accessible**, not guaranteed.

---

## 16. Mandatory first-handoff acceptance matrix (04.1)

| ID | Acceptance requirement | Required proof | Status at spec creation |
| --- | --- | --- | --- |
| T41-01 | Repository/worktree/current approved base verified | SHA, status, owned-file inventory, coordination record | NOT VERIFIED |
| T41-02 | Existing FastAPI skeleton extended, not duplicated | Changed-files review, app startup | NOT VERIFIED |
| T41-03 | Python 3.11/deps reproducible | Install/lock notes and test env | NOT VERIFIED |
| T41-04 | Health/liveness works and preserves contract | Real HTTP/pytest | NOT VERIFIED |
| T41-05 | Honest model readiness/capabilities | Disabled model yields accurate 503/ready state | NOT VERIFIED |
| T41-06 | Typed API/model interfaces established | Schema/OpenAPI/contract tests | NOT VERIFIED |
| T41-07 | Protected internal API auth and network boundary | Unauthorized negative tests and config evidence | NOT VERIFIED |
| T41-08 | Config/secret validation fails closed | Invalid DEV/QA/PROD env tests | NOT VERIFIED |
| T41-09 | Resource/payload/timeout bounds | Focused tests + configured budgets | NOT VERIFIED |
| T41-10 | Central error handling/log redaction | 4xx/5xx/request-id tests | NOT VERIFIED |
| T41-11 | Model lifecycle seam and CPU compatibility | No import-time model load, lifecycle tests | NOT VERIFIED |
| T41-12 | Safe isolated QA AI runtime/adapter | Distinct targets/keys; no shared DEV writes | NOT VERIFIED |
| T41-13 | Express client authenticated/validated | Request/response/adversarial integration tests | NOT VERIFIED |
| T41-14 | AI outage never blocks commerce | Safe fixture smoke and/or unaffected evidence | NOT VERIFIED |
| T41-15 | Existing search UI nonregression | Search text and placeholder smoke | NOT VERIFIED |
| T41-16 | No premature ML/vector/training actions | Diff/security review, no new migrations/dataset/artifacts | NOT VERIFIED |
| T41-17 | Local Docker build + health smoke | Recorded actual commands/results | NOT VERIFIED |
| T41-18 | Focused tests/lint/type/build pass | Exact commands and counts | NOT VERIFIED |
| T41-19 | Phase 04 downstream contracts documented | 04.2 command search and ML/pgvector/04.3–04.7 boundary review | NOT VERIFIED |
| T41-20 | Evidence/runbook/API docs current and review-ready | One concise file update + no unrelated drift | NOT VERIFIED |

This is the **Task 04.1 acceptance matrix**, not a claim that 04.2–04.7 are complete. Later tasks must have their own more detailed acceptance specifications and independent reviews.

---

## 17. Security, regression and compatibility stop conditions

Stop and report before action when: approved `develop` base unavailable; local worktree has conflicting unowned edits; protected ownership/CCR unresolved; any service config points QA to DEV/PROD; credentials appear in tracked/console output; an AI task proposes payment or customer-data mutations; migration execution is requested without approval; an endpoint can reach private resources via arbitrary input; planned model serving requires paid external GPU; Kaggle/free GPU inaccessible during later training; or a future task would silently replace real ML with simulated matching.

A blocker for **04.1** is a genuine failure of **04.1's runtime, security, API, integration, isolation or tests**, not the expected lack of trained image-search weights, a vector index, command-search UI, Supabase Storage, personalized recommendations or realtime maps.

Rollback of 04.1 source changes must preserve existing text search, existing FastAPI health contract where consumers rely on it, commerce payment state and all data. No financial or Prisma migration rollback action is appropriate because 04.1 should not modify them.

---

## 18. Handoff report format — mandatory

Produce a single concise **`TASK 04.1 — IMPLEMENTATION EVIDENCE / ARCHITECT HANDOFF`** containing:

1. Feature branch, approved base/HEAD, effective staged/unstaged/untracked file inventory, ownership/CCR approvals and status.
2. Architectural decisions: private API prefix/DTO naming, app factory/lifespan, auth secret placement, environment split, health/readiness semantics, Python package/quality choices, vector-access proposal (not migration).
3. Exact changed files and why each exists; no unowned or unrelated modifications.
4. Actual local Python/Docker startup instructions and validated health/readiness.
5. Express gateway transport/validation/errors and the AI-outage nonregression evidence.
6. QA/DEV separation and fail-closed security test outcomes.
7. OpenAPI/typed contracts, model interface/lifecycle design and honest absence of trained model in 04.1.
8. Python and related Node tests: commands, counts, skipped/failures and sources of evidence; builds/lint/type checks; CI results only if run and authorized.
9. Browser/UX nonregression, with a prominent 04.2 command-search handoff requirement.
10. No Kaggle setup, no real training, no pgvector migrations, no live Supabase Storage/Stripe/Brevo writes in 04.1; or list any separately authorized exception accurately.
11. Material unresolved defects, documented optional improvements and exact operational approvals needed later.
12. Engineer self-review score /100 and a recommendation; **do not impersonate independent Principal Architect approval**.

### Independent Principal Architect review

Architect reads specification + handoff and inspected effective diff, reviews implementation and surrounding code proportionately to risk, examines focused tests, API/security/DEV-QA isolation and ML scope, then issues score /100 and one decision:

- **✅ Approve** — Acceptance met, blockers absent; note acceptable residual risks.
- **⚠ Request Changes** — Concrete blockers or material verification gap with exact remedy.
- **❌ Reject** — Fundamental security/architecture violation or largely unimplemented required functionality.

Approval does not automatically authorize commit, push, merge, migration, production deployment or external provider access. Stop after evidence handoff pending review.

---

## 19. Definition of Done and final directive

Task 04.1 is **review-ready** only if all **T41-01–T41-20** required acceptance cells have credible matching evidence or an explicitly accepted scoped exception; no protected security/config breach, no unexpected DEV/PROD operation, no task 04.2 scope disguised as completed; FastAPI service and Express AI boundary work reliably in safe local/QA mode; failure isolation and tests are proven; runbook/API contracts are current.

**Agent directive:** Inspect the repository first, reuse and harden the existing FastAPI skeleton, implement the narrowly scoped production-oriented AI foundation, prove protected Express integration and isolation, prepare the real ML/vector/command-search interfaces for 04.2 and ML recommendations for 04.4, preserve all commerce safeguards, run risk-based tests, produce one evidence-backed first handoff, **and stop without commit/push/merge/deploy**.

> **Phase-wide principle:** Real trained DL image search and learned embeddings are mandatory Phase 04 capabilities, but **their training, evaluation, pgvector ingestion and command-search redesign are specifically Task 04.2 work**. Build the right seam now; do not fabricate those results in Task 04.1.
