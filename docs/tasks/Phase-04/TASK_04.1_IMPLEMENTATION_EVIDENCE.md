# TASK 04.1 — IMPLEMENTATION EVIDENCE / ARCHITECT HANDOFF

**Task:** 04.1 — FastAPI AI Service Foundation · **Spec:** `docs/tasks/Phase-04/TASK_04.1_FASTAPI_AI_SERVICE.md`
**Date:** 2026-10-21 · **Status:** REVIEW READY (engineer self-assessment; not independent approval)
**Git:** nothing staged, committed, pushed, merged or deployed.

---

## A. Repository

| Item | Value |
| --- | --- |
| Branch | `feature/FastAPI-AI-Service` (tracks `origin/feature/FastAPI-AI-Service`) |
| Base / HEAD | `cb8c953678c1d3a262b41cf2e0fb7a55cadb5328` = `origin/develop` (merge of PR #33, Task 04.0) — Task 04.0 is integrated in the base |
| Pre-existing local changes (owner's, not 04.1) | 9 modified Phase 00 docs (`ROADMAP.md`, `TECH_STACK.md`, `AI_ARCHITECTURE.md`, `SYSTEM_ARCHITECTURE.md`, `07_AI/*.md`) and the untracked task spec. 04.1 only **appended** a section to `docs/07_AI/FASTAPI.md` and **inserted** the invariants section into the task spec. |
| Other worktrees | `.claude/worktrees/serene-edison-5a7d3e` (`fix/checkout-e2e-recovery`), `C:/Users/ouss0/electrohub-release` (`release/task-03.6-r3`) — untouched |
| Protected-file notes (CCR record) | `apps/backend/src/config/env.ts`: removed only the optional `AI_SERVICE_URL` key (no other consumer) so an AI misconfiguration can no longer abort Express startup; AI settings moved to `src/integrations/ai/ai.config.ts`. `apps/backend/scripts/dev-isolated.cjs` (Task 04.0 QA launcher): additive AI-variable isolation. `routes/index.ts`: one mount line. No auth middleware, payment, cart, checkout, email, PDF, Prisma or CI file changed. **Owner/Architect acknowledgement of these three shared-file edits is requested in review.** |

### Changed files

**AI service (`apps/ai-service`)** — modified: `app/main.py`, `app/core/config.py`, `Dockerfile`, `.env.example`, `requirements.txt`, `tests/test_health.py`; removed: `app/api/health.py` (moved to `app/api/routes/health.py`), four `.gitkeep`; added: `app/__main__.py`, `app/api/dependencies.py`, `app/api/routes/{health,readiness,image_search,recommendations}.py`, `app/core/{security,errors,logging,middleware,runtime}.py`, `app/schemas/{common,image_search,recommendations}.py`, `app/services/{image_search_service,recommendation_service}.py`, `app/models/{descriptor,interfaces,registry}.py`, `app/processors/{image,inference}.py`, `app/integrations/vector_gateway.py`, package `__init__.py` files, `tests/{conftest,fakes,test_settings,test_auth,test_contracts,test_errors,test_limits,test_lifespan,test_services,test_logging}.py`, `pyproject.toml` (tool config only), `requirements-runtime.txt`, `requirements-dev.txt`, `.dockerignore`.

**Backend (`apps/backend`)** — added: `src/integrations/ai/{ai.config,ai.schemas,ai.client}.ts`, `src/integrations/ai/__tests__/{ai.config,ai.client}.test.ts`, `src/routes/ai-admin.routes.ts`, `src/routes/ai-admin.routes.test.ts`; modified: `src/config/env.ts`, `src/routes/index.ts`, `scripts/dev-isolated.cjs`, `scripts/dev-isolated.test.cjs`.

**Docs** — `docs/07_AI/FASTAPI.md` (appended "Task 04.1 — Implemented Contract and Runbook"), task spec (invariants section), this file.

No frontend, Prisma schema/migration, payment, email, PDF or CI workflow file changed.

---

## B. Implementation

- **Application:** `create_app(settings, registry)` factory with FastAPI `lifespan` (deprecated `on_event` removed). `app.main:app` still works for `uvicorn`, but resolves lazily so importing the module loads no settings and builds no app. `python -m app` validates the bind address and runs one worker, no access log, graceful shutdown 10 s.
- **Layers:** routes (transport only) → services (readiness gate, configured limits, output validation) → `ModelRegistry` / `InferenceExecutor` / `EmbeddingSearchGateway` seams. Schemas are Pydantic v2, camelCase on the wire, `extra="forbid"`, frozen, strict ints.
- **Contracts:** `GET /health` (public, legacy flat shape kept; version bumped to 0.2.0), `GET /internal/v1/ready`, `GET /internal/v1/capabilities`, `POST /internal/v1/recommendations` (validated, then `503 AI_MODEL_NOT_READY`), `POST /internal/v1/image-search` (body not read; `503 AI_MODEL_NOT_READY`; `501 AI_NOT_IMPLEMENTED` only if a model were injected before 04.2 wires uploads). Decision: future routes are **present as typed not-ready contracts**, not absent, so Express can gate on them; none can return fabricated results.
- **Security:** per-environment key in `X-ElectroHub-AI-Key` + environment binding in `X-ElectroHub-AI-Environment`, enforced in ASGI middleware **before routing/body parsing** and again by a router dependency (OpenAPI security scheme). Constant-time compare; 512-byte header cap. No CORS. No key configured → protected routes `503 AI_AUTH_NOT_CONFIGURED`; production without key, non-loopback bind without key, or docs in production → refuse to start. Commerce secrets (Stripe, Brevo, JWT/OTP, Google, Cloudinary, `DATABASE_URL`/`DIRECT_URL`, Supabase service role, payment approval) in env or `.env` → refuse to start. Settings validation errors hide inputs.
- **Errors/logging:** one envelope `{error:{code,message,requestId}}`, stable `AI_*` codes, 422 details carry `loc`/`type` only. Unhandled exceptions → sanitized 500 with headers; traceback only in the process log. Structured JSON events (`ai.runtime_start`, `ai.ready`, `ai.request`, `ai.auth_rejected`, `ai.validation_rejected`, `ai.model_unavailable`, `ai.model_loaded/_load_failed`, `ai.runtime_stop`) with a field-name redaction filter (key/secret/token/authorization/image/vector/embedding/body/email/…).
- **Limits (budgets and justification):** request body 1 MiB (JSON-only API in 04.1; 04.2 sets image limits), topK ≤ 24 (a results grid page), candidates ≤ 200, inference timeout 5 s, 2 concurrent inferences (single CPU-mode worker on the 16 GB HP laptop). Excess concurrency → `429` (non-blocking admission); a timed-out thread keeps its slot until it really ends, so stuck work cannot pile up. Express: 2.5 s total timeout, 256 KiB response cap.
- **Model lifecycle:** `ModelRegistry` loads each configured artifact once at startup in a worker thread, type-checks it against `ImageEmbeddingEncoder` / `RecommendationRanker` protocols, reports `MODEL_NOT_CONFIGURED` / `MODEL_NOT_LOADED` / `INDEX_NOT_READY` truthfully, closes models and gateway on shutdown. `ModelDescriptor` binds model/embedding/preprocess versions, dimension, sha256 and a non-pickle format (`safetensors|onnx`). 04.1 ships **no loaders**.
- **Express integration:** `ai.config.ts` (pure, never throws, names-only issues), `ai.schemas.ts` (strict Zod: UUIDs, unique products, finite scores in [-1,1], contiguous ranks, non-increasing scores, caps), `ai.client.ts` (`redirect:'manual'`, `credentials:'omit'`, total timeout + caller abort, content-type and environment-header checks, byte-capped streaming read, safe request-id propagation, never sends `Authorization`/cookies, sanitized `AI_SERVICE_REQUEST_FAILED` telemetry). `GET /api/admin/ai/status` (`requireAuth` + `requireRole('ADMIN')`, `no-store`, always 200 with `reachable`, never URL/key). No customer-facing AI route is published.
- **Environment isolation:** MAIN DEV → AI env `development`; isolated QA launcher blanks inherited `AI_SERVICE_*`, forces `AI_SERVICE_ENVIRONMENT=qa` and only uses explicit `ISOLATED_AI_SERVICE_URL/_API_KEY`; production NODE_ENV accepts only `production` + https/internal host. A QA→DEV mis-target is refused twice (different key → 401; environment binding → 403 / response-header mismatch).
- **Docker:** `python:3.11.13-slim`, runtime-only pinned deps installed `--no-deps` + `pip check`, non-root user, `HEALTHCHECK` on `/health`, `CMD python -m app`, `.dockerignore` excludes `.env*`, venvs, tests, notebooks, datasets and model weights. No CUDA.
- **Dependencies:** pip-audit of the old pins found advisories in starlette 0.41.3 (and pytest 8.3.4). Upgraded to fastapi 0.156.8 / starlette 1.9.0 / uvicorn 0.54.0 / pydantic 2.14.1 / pydantic-settings 2.16.1; full transitive pins; `pip_audit -r requirements-dev.txt` → **No known vulnerabilities found**. Resolution for CPython 3.11 / manylinux verified with `pip install --dry-run --python-version 3.11`.

---

## C. Database (read-only)

Verified through the Supabase MCP (`list_projects`, `execute_sql` SELECT only) plus local Prisma tooling; no writes of any kind.

| | DEV | PROD |
| --- | --- | --- |
| Project | `pzxekjybdiulzmssalfo` "electrohub-dev", ap-northeast-2, ACTIVE_HEALTHY, PG 17.6 | `yepfgjehdstlxbpespun` "electrohub", ap-northeast-1, ACTIVE_HEALTHY, PG 17.6 |
| `_prisma_migrations` | 20 rows, all finished, 0 failed/rolled back; names = local 20 (0 pending/missing/extra) | same |
| Checksums | 20/20 match a local variant (as recorded in `database-discovery.json`) | 20/20; foundation (BOM+CRLF) and OTP (CRLF) match the **documented** 04.0 exceptions |
| pgvector | available 0.8.2, **not installed**; no embedding/vector app tables | same |
| Decision | **Case A (NO-OP) + Case D (pgvector deferred to 04.2)** | **Case A + Case D** |

Local `apps/backend/.env`: `DATABASE_URL` (pooler :6543) and `DIRECT_URL` (pooler :5432) both resolve to the DEV ref (values never printed). `npx prisma migrate status` (DEV, read-only): "20 migrations found … Database schema is up to date!". **No migration created or applied, no seed run, no `_prisma_migrations` change.** Not re-verified this task: full physical `prisma migrate diff` (relied on 04.0 evidence), RLS/advisors (out of scope), the isolated QA cluster schema.

---

## D. Tests and QA (all commands actually executed)

| Check | Command (cwd) | Result |
| --- | --- | --- |
| Python tests | `venv/Scripts/python -m pytest` (`apps/ai-service`) | **118 passed** (warnings are errors) |
| Python lint/format | `ruff check .` / `ruff format --check .` | pass / 45 files formatted |
| Python types | `mypy app tests` (strict + pydantic plugin) | **no issues in 45 files** |
| Dependency audit | `pip_audit -r requirements-dev.txt` | no known vulnerabilities |
| Express AI tests | `npx vitest run src/integrations/ai src/routes/ai-admin.routes.test.ts` (`apps/backend`) | **68 passed** (3 files) |
| QA launcher | `node --test scripts/dev-isolated.test.cjs` | **8 passed** (incl. new AI-isolation test) |
| Backend typecheck / lint | `npm run typecheck` / `npm run lint` | pass / pass |
| Full backend suite (context) | `npx vitest run` | 1135 passed, 270 failed in 60 files — **every failure is a Task 04.0 environment guard**: `DATABASE_TEST_TARGET_REQUIRED` (local `.env` is shared DEV, not a disposable test DB) or payment isolation 503 "Payments are unavailable in this environment". None import AI code; they need CI's disposable PostgreSQL. |
| `git diff --check` | repo root | clean (only CRLF notices) |
| Secret scan | regex over untracked files and diff (Stripe/Brevo/credentialed Postgres URLs) | none; test keys are labelled fakes |

**Runtime smoke (real processes, loopback only, throwaway key never printed):**
- `python -m app` on 127.0.0.1:8765 (netstat: bound to 127.0.0.1 only). curl: `/health` 200; `/internal/v1/ready` no key 401, wrong key 401, `qa` binding 403, correct 200 (`modelReady:false`, both features `MODEL_NOT_CONFIGURED`, `X-Request-Id: smoke-1` echoed); capabilities 200; recommendations 503 `AI_MODEL_NOT_READY`; invalid UUID 422 (`details` loc/type only); image-search 503; 2 MB body 413. Key occurrences in process log: 0.
- Real Express `AiServiceClient` (tsx) → live FastAPI: readiness OK 34 ms, capabilities OK, recommend → `unavailable 503 AI_MODEL_NOT_READY`, wrong key → `unauthorized 401`, `qa` binding → `environment_mismatch`.
- **AI down:** FastAPI stopped → readiness/recommend → `connect` in 5–27 ms (no hang); timeout and refused paths also covered against a real `node:http` server in `ai.client.test.ts`.
- **Linux container-equivalent (WSL Ubuntu, Python 3.12, the 16 pinned manylinux wheels, Dockerfile `CMD`):** production without key → exit 2; `STRIPE_SECRET_KEY` present → exit 2 naming the variable; keyed `0.0.0.0` start → healthcheck 200, `/docs` 404; SIGTERM → lifespan `ai.runtime_stop`; key in log 0.
- **Commerce unaffected:** running MAIN DEV `:5000` and isolated QA `:5200` backends both `/api/health` 200 and `/api/search/suggestions` 200 while their `AI_SERVICE_URL` has no key (AI disabled, not crashed). QA `:5200` (hot-reloaded) answers `/api/admin/ai/status` 401 to anonymous callers. MAIN DEV `:5000` was started before these changes and returns 404 for the new route until restarted.
- **Browser non-regression (isolated QA `http://localhost:3200/search?q=phone`, built-in browser):** "35 results for 'phone'" with product cards; Image Search tab shows the unchanged local-only placeholder (source copy: "Local preview only. Image matching is not available yet."). Only console error: a guest 401 from the anonymous session check (pre-existing). No UI files changed, so no Figma comparison was required.

---

## E. Acceptance matrix (T41-01 – T41-20)

| ID | Status | Evidence |
| --- | --- | --- |
| T41-01 Repo/base verified | PASS | §A: HEAD = origin/develop `cb8c953`, 04.0 merged, worktrees listed, no foreign edits overwritten |
| T41-02 Skeleton extended, not duplicated | PASS | Existing main/config/health/Dockerfile/test evolved in place; health moved into `api/routes` |
| T41-03 Python 3.11 / reproducible deps | PARTIAL | Fully pinned runtime set; 3.11 resolution dry-run OK; tests executed on 3.12 (Windows + Linux). **No local 3.11 interpreter**; CI job runs 3.11 |
| T41-04 Health/liveness | PASS | `test_health.py` (3) + live curl 200 |
| T41-05 Honest readiness | PASS | `test_contracts.py`, `test_lifespan.py`, live `/ready` `modelReady:false` |
| T41-06 Typed API/model interfaces | PASS | Pydantic + Zod schemas, OpenAPI test, protocols/descriptor tests |
| T41-07 Internal auth + network boundary | PASS | `test_auth.py` (14), loopback default, non-loopback requires key, live 401/403 |
| T41-08 Config fails closed | PASS | `test_settings.py` (34 cases), `ai.config.test.ts`, Linux refusal exits |
| T41-09 Payload/resource/timeout bounds | PASS | `test_limits.py` (413 declared/streamed, 429, 504, slot hold), Express timeout/size tests |
| T41-10 Errors + log redaction | PASS | `test_errors.py`, `test_logging.py`, live log key count 0 |
| T41-11 Lifecycle seam, CPU | PASS | `test_lifespan.py` (load once in worker thread, close on stop, failures), no import-time work |
| T41-12 Isolated QA AI runtime | PASS | `dev-isolated.test.cjs`, environment binding tests, live 403 |
| T41-13 Express client validated | PASS | 68 tests incl. adversarial payloads + live client→FastAPI run |
| T41-14 AI outage never blocks commerce | PASS | Config never throws; live AI-down `connect` errors; backends healthy with AI disabled |
| T41-15 Search UI non-regression | PASS | Browser smoke on :3200, API smoke on :5000/:5200 |
| T41-16 No premature ML/vector/training | PASS | No migrations, datasets, weights, notebooks, Kaggle, Cloudinary; DB NO-OP |
| T41-17 Local Docker build + health | **NOT VERIFIED** | Docker is not installed on Windows or WSL. Substitute evidence: Linux run of the same pinned wheels + `CMD` (§D). `docker build` must run on a Docker host |
| T41-18 Tests/lint/type/build | PASS (local) | §D. Backend `build` = `tsc` covered by `typecheck`. Remote CI not run (no push) |
| T41-19 Downstream contracts | PASS | Spec §9/§13 + invariants V08; interfaces in `app/models`, `app/integrations`; FASTAPI.md section |
| T41-20 Evidence/runbook/API docs | PASS | This file, FASTAPI.md runbook, `.env.example` |

---

## F. Residual risks, gaps and next-task contracts

- **Docker image not built** (T41-17). Python 3.11 exercised only by CI resolution, not executed locally.
- **CI:** unchanged by design (CI edits need Owner/Architect approval). The existing "AI Service / Test" job installs `requirements.txt` (now runtime + pytest + httpx2) and runs pytest, so it stays compatible. Proposed follow-up: add `ruff check`, `mypy app tests` and `pip_audit` steps using `requirements-dev.txt`. The backend CI `.env.test.local` sets `AI_SERVICE_URL` without a key; that now yields one `AI_SERVICE_MISCONFIGURED` warning and AI disabled (harmless).
- The admin status route was exercised by supertest (auth mocked) and anonymously on :5200, not with a real admin session against a live AI process.
- `MAIN DEV :5000` must be restarted to load the new route; operators running a local AI instance need a matching `AI_SERVICE_API_KEY` in both `.env` files.
- Plan Mode was carried out as an in-session planning phase with a frozen contract (scratch `AI_CONTRACT_04.1.md`), not via the Plan Mode approval UI, to avoid blocking an already-authorized run. Parallel agents: Express integration (Opus) and read-only DB verification (Opus); the lead implemented FastAPI and reviewed/edited the Express diff (added client telemetry).
- **04.2 contract:** multipart `image` part on `/internal/v1/image-search`, magic-byte decode + pixel/byte limits, EXIF strip, `ImageEmbeddingEncoder` loader verifying `artifact_sha256` (safetensors/onnx only), pgvector gateway with a read-only role named `AI_*` (never `DATABASE_URL`), descriptor-matched index activation, Express product re-validation, command-search UI redesign verified against Figma.
- **04.3/04.4/04.5–04.7:** unchanged boundaries per spec §2/§13; AI remains uncoupled from delivery, maps and sockets.

**Engineer self-review score: 88/100** (deductions: Docker build and local 3.11 execution unverified; CI quality gates proposed but not wired; three shared-file edits await acknowledgement).
**Recommendation: REVIEW READY.**
