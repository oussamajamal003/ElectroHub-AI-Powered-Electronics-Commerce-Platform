# FastAPI AI Service

## 1. Purpose

This document defines the FastAPI AI service used by ElectroHub.

FastAPI provides an isolated service boundary for AI-related processing.

Primary capabilities include:

- Image search processing.
- Embedding-based recommendation processing.
- AI-specific preprocessing and scoring.
- EfficientNet-B0 inference and shared learned embeddings.

FastAPI does not own core commerce business logic.

---

# 2. Service Architecture

```text
React Frontend
      ↓
Node.js / Express Backend
      ↓
FastAPI AI Service
      ↓
AI Processing
      ↓
Structured Result
      ↓
Node.js / Express Backend
      ↓
React Frontend
```

The Node.js backend remains the authoritative application service.

---

# 3. Responsibilities

FastAPI is responsible for:

```text
Image Processing
Feature Extraction
Similarity Processing
Recommendation Processing
Model Inference
AI-Specific Validation
```

FastAPI is not responsible for:

```text
Customer Authentication
Customer Authorization
Cart
Orders
Payments
Inventory
Commerce Pricing
```

---

# 4. Service Isolation

The AI service must remain independently deployable.

```text
apps/
├── backend/
└── ai-service/
```

The AI service must communicate through explicit HTTP API contracts.

It must not import Node.js backend source code or directly manipulate frontend state.

---

# 5. Technology

The AI service uses:

```text
Python
FastAPI
Pydantic
Uvicorn
```

PyTorch, torchvision, and an image-decoding library support the pretrained EfficientNet-B0 encoder. A restricted PostgreSQL/pgvector repository supports embedding retrieval. Training dependencies are separated from runtime dependencies where practical.

Dependencies must be documented and pinned appropriately.

---

# 6. API Contract

The browser calls the backend's public API. FastAPI exposes separately authenticated internal APIs; a public backend route does not imply the same route is exposed by FastAPI.

Conceptual routes:

```text
Backend: POST /api/ai/image-search, POST /api/ai/recommendations
Internal FastAPI: POST /image-search, POST /recommendations
Operational: GET /health, GET /ready
```

Use validated request/response schemas and bounded inputs. Product IDs, ranking scores, model/embedding versions, and result mode are returned where relevant. Health reports process availability; readiness verifies the approved model and compatible embedding store are usable. Final routes, error formats, and service authentication are specified in task 04.1. Before the task 04.2 model/store is available, readiness must reflect that state without falsely reporting functional ML; isolated contract fixtures do not establish feature completion.

---

# 7. Image Search Request

Conceptually:

```text
POST /api/ai/image-search
Content-Type: multipart/form-data
```

Input:

```text
image
```

Possible optional parameters:

```text
category
limit
```

The final contract must be defined in the API documentation.

---

# 8. Image Search Response

Conceptually:

```json
{
  "matches": [
    {
      "productId": "product-id",
      "score": 0.91
    }
  ]
}
```

FastAPI returns product references and AI-related metadata.

It must not return authoritative:

```text
Price
Inventory
Payment Status
Order Status
```

Those values belong to the main backend/database.

---

# 9. Recommendation Request

Conceptually:

```text
POST /api/ai/recommendations
```

Possible inputs:

```text
userId or anonymized context
productId
category
behavioral context
recommendation mode
limit
```

Only the minimum required information should be sent. The backend derives user context from the authenticated request and selects authorized history; never trust a client-supplied userId as permission to read another user's behavior.

---

# 10. Recommendation Response

Conceptually:

```json
{
  "recommendations": [
    {
      "productId": "product-id",
      "score": 0.88
    }
  ]
}
```

The Node.js backend validates returned product references before exposing them to customers. Scores are ranking metrics, not calibrated probabilities; include model/embedding version and result-mode metadata in the final contract.

---

# 11. Backend-to-AI Communication

The backend calls FastAPI as an internal service.

```text
Backend
 ↓
Validate Request
 ↓
FastAPI
 ↓
Validate AI Response
 ↓
Resolve Products
 ↓
Apply Business Rules
 ↓
Return Response
```

The backend must not blindly trust AI output.

---

# 12. AI Service Authentication

FastAPI endpoints must not be assumed to be public.

The deployment architecture should restrict access to the AI service where possible.

Internal communication may use:

```text
Private Network
+
Service Authentication
+
Environment-Based Secrets
```

The exact mechanism follows the deployment architecture.

---

# 13. Timeouts

AI requests must have explicit timeouts.

The backend must not wait indefinitely for FastAPI.

Possible failures:

```text
Timeout
Connection Failure
Invalid Response
Model Failure
```

The backend should return a controlled application-level response.

---

# 14. Failure Isolation

AI service failure must not break core commerce functionality.

The following must remain operational if FastAPI is unavailable:

```text
Product Catalog
Search
Cart
Checkout
Payments
Orders
Inventory
Delivery
```

AI-dependent features should provide an appropriate fallback.

---

# 15. Image Processing

Image processing should:

- Validate input.
- Limit input size.
- Resize oversized images where appropriate.
- Use safe temporary storage.
- Avoid executing uploaded content.
- Remove temporary data when processing completes.

The service should process only the minimum required image data.

---

# 16. Model Loading and Inference

Load the reviewed Task 04.2 checkpoint once per serving process, use evaluation/inference mode, and reuse its encoder for embeddings. The owner-approved Task 04.2 scope exception deploys the pretrained, frozen EfficientNet-B0 backbone with a genuinely trained 256-dimensional projection head; do not describe the deployed backbone as fine-tuned. Validate the artifact and embedding compatibility before declaring readiness. Multiple workers duplicate model memory; choose worker count and concurrency using measured CPU/memory behavior.

Customer requests do not train or update the model. Training is offline in task 04.2; serving is designed to support CPU inference on the HP development laptop and planned deployment host, subject to latency verification. Do not assume a production GPU is available.

---

# 17. Real ML and Explicit Fallbacks

The Phase 04 baseline expects real learned embeddings from a pretrained EfficientNet-B0 CNN fine-tuned in PyTorch. Task 04.2 has an owner-approved scope exception for its validation-selected pretrained, frozen backbone plus trained projection head; see the Task 04.2 evidence for the measured rationale and pending Architect verification. Simulated mappings, random vectors, and category-only matching do not satisfy image-search completion.

Recommendations reuse the same embeddings for content-based retrieval and behavior-derived profiles. Popularity/category rules may supplement ranking or provide clearly identified cold-start and outage fallbacks. A fallback must not be reported as a successful trained-model response.

---

# 18. Logging

FastAPI logs should include useful operational information without exposing sensitive data.

Good examples:

```text
Request Type
Processing Duration
Result Count
Model Version
Error Type
```

Do not log:

```text
Passwords
OTP Values
JWTs
Payment Credentials
Secret Keys
Raw Customer Images
```

---

# 19. Observability

The service should expose sufficient information for operational monitoring.

Potential health endpoint:

```text
GET /health
```

It may report:

```text
Service Status
Model Availability
Version
```

Health checks must not expose secrets.

---

# 20. Testing

FastAPI testing should cover:

```text
Request Validation
Image Validation
Successful Image Search
No Image
Invalid Image
Oversized Image
Recommendation Request
Invalid Recommendation Input
AI Result Validation
Timeout Handling
Service Failure
Health Endpoint
```

Model-dependent tests should use deterministic fixtures where possible. Also verify readiness failure, incompatible embedding versions, catalog refresh, and a real checkpoint-to-pgvector retrieval path. Report held-out retrieval/recommendation quality separately from API correctness.

---

# 21. Performance

The service should:

- Avoid unnecessary image processing.
- Limit request sizes.
- Limit result counts.
- Reuse loaded models.
- Avoid blocking operations where practical.
- Apply explicit request timeouts.
- Monitor memory usage.

AI processing must not consume all resources on the shared deployment host.

---

# 22. Security

FastAPI must implement:

- Input validation.
- Request-size limits.
- Service-to-service authentication for internal AI endpoints.
- Safe file handling.
- Dependency security.
- Secure error responses.
- No secret exposure.

The AI service is an internal trust boundary, not a reason to disable validation.

---

# 23. Docker

FastAPI should run as a separate container in development and production.

Conceptually:

```text
Docker Network
│
├── frontend
├── backend
└── ai-service
```

The service should have its own Docker configuration and dependency installation.

---

# 24. Environment Variables

AI configuration belongs in environment variables.

Examples:

```text
AI_SERVICE_PORT
AI_SERVICE_API_KEY
MODEL_PATH
MODEL_VERSION
```

Actual secret values must never be committed.

---

# 25. Deployment

The AI service is deployed with the application stack during the production phase.

Production infrastructure uses:

```text
DigitalOcean VPS
Ubuntu
Docker
Nginx
SSL
GitHub Actions
```

Nginx should not expose internal AI endpoints publicly unless explicitly required.

---

# 26. Definition of Done

The FastAPI service is complete when:

- FastAPI service starts correctly.
- Health check works.
- API contracts are defined.
- Image-search endpoint works.
- Embedding-based recommendation endpoint works.
- Backend integration works.
- Request validation works.
- AI response validation works.
- Timeouts are configured.
- Failure isolation works.
- Security controls are implemented.
- Docker deployment works.
- Logging is safe.
- Tests pass.
- A trusted checkpoint and compatible catalog embeddings are integrated and evaluated with accurate model-scope labeling.
- ML recommendations and explicitly identified fallbacks are verified.
- Documentation matches implementation.


---

## Phase 04 Decision Baseline

This Phase 00 document records the approved direction, not evidence that Phase 04 is implemented or validated. Task files will define detailed contracts, data preparation, model settings, database migrations, evaluation criteria, and operational procedures.

- **04.1:** establish the FastAPI service architecture, internal API contracts, configuration, validation, security, readiness, and backend integration.
- **04.2 baseline:** implement real image search using a pretrained EfficientNet-B0 CNN fine-tuned in PyTorch, learned image embeddings, and PostgreSQL pgvector retrieval. The current Task 04.2 checkpoint uses the separately documented owner-approved projection-only scope exception, pending final Architect verification. Kaggle Free GPU setup and training belong to this later task; no training environment is being provisioned by this document.
- **04.4:** implement ML-oriented content-based recommendations by reusing those learned product embeddings, with behavior-based profiles where sufficient data exists. Rules and popularity remain supporting signals or explicit fallbacks.
- **Local development:** use the HP Core i7 laptop with 16 GB RAM and Intel UHD graphics for application development, preprocessing, tests, and CPU inference checks. Do not assume its reported shared graphics memory provides a CUDA training GPU.
- **Training boundary:** Kaggle is an offline training environment, not an application host, production dependency, database gateway, or customer-image processor. Free GPU availability is not guaranteed; save and export checkpoints and record reproducible training metadata.
- **Quality boundary:** demonstrate measured performance on representative held-out data. Neither pretrained weights nor fine-tuning guarantee accurate SKU identification or production-grade recommendations.

## Shared Embedding Lifecycle and Data Boundary

```text
Approved, licensed training data
  → Offline Kaggle training / validation
  → Reviewed, versioned EfficientNet-B0 checkpoint + preprocessing metadata
  → FastAPI inference runtime

Approved catalog images
  → Controlled embedding ingestion
  → Same encoder + inference preprocessing
  → Product references + versioned embeddings in PostgreSQL pgvector

Customer query image
  → Backend validation → FastAPI validation / preprocessing / encoder
  → Query embedding → pgvector nearest neighbors
  → Product references + ranking scores
  → Backend authorization / current catalog lookup → Customer results
```

The trained encoder supplies feature embeddings rather than treating classification labels as product matches. The training objective and extraction layer must be selected and evaluated in task 04.2; classification accuracy alone does not prove retrieval quality. Training augmentation is separate from deterministic inference preprocessing shared by catalog and query images.

Track the encoder/checkpoint version, preprocessing version, vector dimension, normalization, similarity metric, and catalog image revision with derived embeddings. Never compare incompatible vector spaces. A changed encoder or preprocessing pipeline requires a controlled catalog re-embedding and coherent activation, with a rollback path. New, changed, and removed catalog images must trigger corresponding embedding refresh or removal; the backend still filters stale references.

The backend owns schema migrations and commerce writes. FastAPI may use a dedicated least-privilege repository to read only the derived vector/product-reference data needed for retrieval. A separately authorized ingestion job writes derived embeddings; online inference does not receive general catalog-write privileges. Keep vector data private and unexposed to browser clients; if any tables are exposed through a Data API, enforce explicit grants and appropriate row-level policies. Vector SQL, extension setup, and index choices belong in reviewed migrations/repository code rather than scattered queries. Prisma remains the backend commerce ORM; pgvector-specific access may require an isolated, parameterized SQL adapter.

Use approved catalog sources for ingestion rather than accepting arbitrary remote URLs. Restrict remote fetching to trusted media locations and reject private-network or unsafe destinations. Decode uploaded bytes against an image allowlist with byte, dimension, and decoded-pixel limits; do not trust filenames or MIME headers. Bound inference concurrency, result counts, timeouts, and ingestion work. Use temporary image data only as needed and clean it up on success and failure.

Load only trusted model artifacts, verify their identity/integrity, and avoid executing untrusted checkpoint serialization. Keep secrets server-side, use service authentication and private networking where available, and encrypt cross-host service/database traffic. Never place database credentials, commerce records, authentication tokens, or customer search images in Kaggle notebooks/datasets. Training uses approved, minimized data only; verify dataset licensing and notebook/dataset visibility before upload.

---

## Task 04.1 — Implemented Contract and Runbook

This section records what Task 04.1 actually implemented. Where it differs from the conceptual sections above (routes in §6, variable names in §24), this section is authoritative. Evidence: `docs/tasks/Phase-04/TASK_04.1_IMPLEMENTATION_EVIDENCE.md`.

### Layout (`apps/ai-service`)

```text
app/main.py                 create_app() factory, lifespan, middleware + router assembly (`app` resolved lazily)
app/__main__.py             `python -m app` — validated bind, 1 worker, no access log
app/core/                   config (Pydantic Settings), security, errors, logging, middleware, runtime/lifespan
app/api/                    dependencies.py, routes/{health,readiness,image_search,recommendations}.py
app/schemas/                camelCase wire contracts (common, image_search, recommendations)
app/services/               image-search / recommendation orchestration (readiness gate, bounds, output validation)
app/models/                 ModelDescriptor, encoder/ranker/loader protocols, ModelRegistry (load once, close on stop)
app/processors/             ValidatedImage contract, InferenceExecutor (bounded, off the event loop)
app/integrations/           EmbeddingSearchGateway protocol (pgvector in 04.2; no DB credential in 04.1)
```

### Routes

| Route | Auth | 04.1 behaviour |
| --- | --- | --- |
| `GET /health` | none | `200 {status, service, timestamp, environment, version}` — liveness only |
| `GET /internal/v1/ready` | service key | `200 {data:{status:"ready", modelReady:false, features:{imageSearch, recommendations}}}`; `503 AI_NOT_READY` before startup completes |
| `GET /internal/v1/capabilities` | service key | features + `limits` (no secrets) |
| `POST /internal/v1/recommendations` | service key | typed body validated (`422`), then `503 AI_MODEL_NOT_READY` |
| `POST /internal/v1/image-search?topK=` | service key | body not read; `503 AI_MODEL_NOT_READY` (multipart upload arrives in 04.2) |
| `/docs`, `/openapi.json` | none | development/test only; disabled in qa, forbidden in production |

Features report `available:false, status:"NOT_READY", reason:"MODEL_NOT_CONFIGURED"` until a trained artifact is loaded (`MODEL_NOT_LOADED` if loading failed, `INDEX_NOT_READY` when the encoder has no active matching index). No route returns fabricated matches.

### Service authentication and environment binding

- Request headers: `X-ElectroHub-AI-Key` (per-environment secret, ≥ 32 chars) and `X-ElectroHub-AI-Environment` (`development|qa|production|test`). Never `Authorization`; customer JWTs are never forwarded.
- Checked in ASGI middleware before routing or body parsing: missing/wrong key → `401 AI_UNAUTHORIZED`; right key, wrong environment → `403 AI_ENVIRONMENT_MISMATCH`; no key configured → `503 AI_AUTH_NOT_CONFIGURED` (fail closed).
- Every response carries `X-ElectroHub-AI-Environment` and `X-Request-Id`; the Express client rejects a response from a different environment.
- No CORS middleware: the browser never calls this service.

### Errors

`{"error": {"code": "AI_*", "message": "<safe text>", "requestId": "..."}}` (+ `details: [{loc, type}]` on 422, never input values). Codes: `AI_UNAUTHORIZED` 401, `AI_ENVIRONMENT_MISMATCH` 403, `AI_NOT_FOUND` 404, `AI_METHOD_NOT_ALLOWED` 405, `AI_PAYLOAD_TOO_LARGE` 413, `AI_VALIDATION_FAILED` 422, `AI_RATE_LIMITED` 429, `AI_INTERNAL_ERROR` 500, `AI_NOT_IMPLEMENTED` 501, `AI_MODEL_NOT_READY` / `AI_INDEX_NOT_READY` / `AI_AUTH_NOT_CONFIGURED` / `AI_NOT_READY` 503, `AI_INFERENCE_TIMEOUT` 504.

### Configuration (`apps/ai-service/.env.example`)

| Variable | Default | Rule |
| --- | --- | --- |
| `AI_ENVIRONMENT` (legacy `ENVIRONMENT`) | required | `development\|qa\|production\|test` |
| `AI_SERVICE_API_KEY` | unset | ≥ 32 printable ASCII, non-placeholder; required in production and for any non-loopback bind |
| `AI_BIND_HOST` / `AI_PORT` | `127.0.0.1` / `8000` | IP literal; port 1024–65535 |
| `AI_DOCS_ENABLED` | dev/test on | cannot be true in production |
| `AI_MAX_REQUEST_BYTES` | 1 MiB | 1 KiB–20 MiB (Content-Length and streamed bytes) |
| `AI_MAX_TOP_K` / `AI_MAX_CANDIDATES` | 24 / 200 | 1–100 / 1–1000 |
| `AI_INFERENCE_TIMEOUT_SECONDS` / `AI_MAX_CONCURRENT_INFERENCES` | 5 / 2 | 0.1–60 / 1–16; saturation → 429, never an unbounded queue |

The process refuses to start if Stripe, Brevo, JWT/OTP, Google, administrative storage credentials, `DATABASE_URL`/`DIRECT_URL` or Supabase service-role values are present in its environment or `.env`.

Express side (`apps/backend/src/integrations/ai/ai.config.ts`, not `src/config/env.ts`, so a bad AI setting can only disable AI): `AI_SERVICE_URL` (origin only, no credentials/query; production requires https unless loopback/single-label internal host), `AI_SERVICE_API_KEY`, `AI_SERVICE_ENVIRONMENT` (production NODE_ENV → `production`; development → `development|qa`), `AI_SERVICE_TIMEOUT_MS` (100–10000, default 2500). Responses are capped at 256 KiB, redirects are never followed, and every payload is validated with strict Zod schemas (UUIDs, unique products, finite scores in [-1, 1], contiguous ranks). Admin-only probe: `GET /api/admin/ai/status`.

Isolated QA (`npm run dev:isolated --workspace=@electrohub/backend`) never inherits MAIN DEV's `AI_SERVICE_*`: the launcher blanks them, binds `AI_SERVICE_ENVIRONMENT=qa`, and only uses explicit `ISOLATED_AI_SERVICE_URL` / `ISOLATED_AI_SERVICE_API_KEY` (a separate AI instance, e.g. :8200, with its own key).

### Local runbook (Windows/Git Bash shown; CPU only, no GPU)

```bash
cd apps/ai-service
python -m venv venv
venv/Scripts/python -m pip install -r requirements-dev.txt
venv/Scripts/python -m pytest
venv/Scripts/python -m ruff check . && venv/Scripts/python -m ruff format --check .
venv/Scripts/python -m mypy app tests
venv/Scripts/python -m pip_audit -r requirements-dev.txt
venv/Scripts/python -m app        # reads apps/ai-service/.env; Ctrl+C stops it gracefully
```

Requirement files: `requirements-runtime.txt` (fully pinned runtime set, used by the Dockerfile), `requirements.txt` (runtime + pytest/httpx2, installed by the CI "AI Service / Test" job), `requirements-dev.txt` (+ ruff, mypy, pip-audit).

Docker (non-root, CPU-only, healthcheck on `/health`, binds `0.0.0.0` inside the container so a key is mandatory):

```bash
docker build -t electrohub-ai:local apps/ai-service
docker run --rm -p 127.0.0.1:8000:8000 -e AI_ENVIRONMENT=development -e AI_SERVICE_API_KEY=<generated> electrohub-ai:local
```

Publish the container port on loopback or a private Docker network only; Nginx must not expose `/internal/*`.

## Task 04.2 — Implemented Image Search Runtime

Task 04.2 replaces the 04.1 placeholder with real inference. The app factory, authentication-before-body, error envelope, bounded `InferenceExecutor` and readiness semantics are unchanged.

| Piece | File | Behaviour |
|---|---|---|
| Network | `app/models/embedding_network.py` | EfficientNet-B0 features → GAP → Linear(1280→256) → L2 norm. It also owns `preprocess_image` (`PREPROCESS_VERSION effb0-rgb-r256-c224-imagenet-v1`), shared by training evaluation, ingestion and serving. |
| Loader | `app/models/efficientnet_loader.py` | `descriptor.json` must contain exactly 7 identity keys. `model.safetensors` is SHA-256-verified **before** deserialisation, then loaded with `load_state_dict(strict=True)`. No pickle and no `torch.load`. |
| Decoder | `app/processors/image.py` | Detects the type from magic bytes, never from the declared type. Accepts JPEG, PNG and WebP. Single frame only; sides 32–12,000 px; ≤ `AI_MAX_IMAGE_PIXELS`. Decompression bombs return 413. Applies EXIF orientation and flattens alpha onto white. |
| Vector gateway | `app/integrations/pgvector_gateway.py` | Uses a read-only `ai_vector_reader` pool (`search_path=ai,extensions`, 2 s statement timeout). `is_ready` requires the active version to match the descriptor and a complete index. `nearest` runs an exact cosine search grouped by product (`MIN(distance)`, ties broken by product id) and re-checks the active version inside the same snapshot. |
| Route | `app/api/routes/image_search.py` | Reads exactly one multipart part named `image` after auth and readiness checks, up to `AI_MAX_IMAGE_BYTES` (plus 64 KiB of framing on this route only). A request-scoped in-memory multipart parser is bounded below its spool threshold; `TMPDIR=/dev/shm` points Python at Docker's bounded tmpfs for tempfile initialization, but image parts never spool to it. Decode and encode run inside one executor slot. |
| Ingestion CLI | `app/ingest/__main__.py` | `stage`, `activate`, `rollback` and `status` (offline operator tool; see `docs/06_Database/AI_VECTOR_INDEX.md`). |

Configuration added: `AI_MODEL_ARTIFACT_DIR`, `AI_VECTOR_DATABASE_URL` (read-only role; TLS required for non-loopback hosts), `AI_MAX_IMAGE_BYTES` (8 MiB), `AI_MAX_IMAGE_PIXELS` (40 M) and `AI_TORCH_THREADS` (2). `AI_ENV_FILE` points a process at another env file, and isolated QA passes a non-existent path so nothing is inherited from the developer `.env`. Commerce secrets (`DATABASE_URL`, Stripe, JWT and so on) stay forbidden.

Task 04.2-Q adds `AI_RELEVANCE_ARTIFACT_DIR`, a directory holding `relevance.json` and `head.safetensors`. The loader verifies the SHA-256 and refuses an artifact calibrated for a different `modelVersion`. When the setting is present, `app/models/relevance.py` runs the pretrained ImageNet head on the backbone features the encoder already computes:

- If the photo's softmax mass on electronics classes is below `minElectronicsMass` (0.08), the search returns `matches: []`.
- Otherwise, only products whose similarity is within `maxScoreGap` (0.10) of the best match are kept.

The wire contract is unchanged; `matches` can now hold anywhere from 0 to topK items. Calibration and evidence are in `docs/tasks/Phase-04/TASK_04.2_IMPLEMENTATION_EVIDENCE.md`.

Windows note: psycopg's async driver cannot use the Proactor loop, so `python -m app` selects the selector loop on `win32`. Linux and Docker keep uvicorn's default.

Runtime dependencies: CPU-only `torch==2.13.0+cpu` / `torchvision==0.28.0+cpu` from the PyTorch CPU index. 2.8.0 was replaced after `pip-audit` reported advisories fixed in ≤ 2.13.0. Also `pillow`, `numpy`, `safetensors`, `psycopg[binary]`, `psycopg-pool` and `python-multipart`, all pinned with their transitive dependencies. Training dependencies never enter the image, and `training/` is excluded from the Docker build context.

The selected v2 artifact is an EfficientNet-B0 pretrained frozen backbone plus a trained 256-dimensional projection head, accepted as an owner-approved Task 04.2 scope exception pending final Architect verification. Do not label the deployed backbone fine-tuned. The read-only Docker runtime uses its bounded `/dev/shm` tmpfs as Python's `TMPDIR`; no upload is retained or spooled there. Kaggle credentials are training-only (`training/.data/kaggle.env`, ignored); serving refuses inherited `KAGGLE_*` variables, and Docker excludes `training/`.

Measured on the local CPU (Core i7, QA, warm, real model and pgvector):
- Sequential: p50 278 ms, p95 324 ms.
- Concurrency 2: p50 397 ms, no rejections.
- Concurrency 4: the two-slot executor sheds the excess immediately with 429.
- Private memory: about 780 MiB idle and 828 MiB after load.
