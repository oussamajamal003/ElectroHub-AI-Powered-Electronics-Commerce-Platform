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
| T41-03 Python 3.11 / reproducible deps | PASS | §G: native CPython 3.11.9 venv — `pip check`, 118 passed, ruff, strict mypy, pip-audit clean; container runs CPython 3.11.13; remote CI "AI Service / Test" (3.11) green on `a69fd2f`/`3fb20eb` |
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
| T41-17 Local Docker build + health | PASS | §G: real `docker build` (Docker Engine 29.1.3, WSL Ubuntu) → image `3a21962e40e8`, 51 MB; container smoke all green |
| T41-18 Tests/lint/type/build | PASS | §D + §G: backend full suite on a disposable DB, 1494 passed / 0 failed; remote CI on `3fb20eb` green. New CI gates green remotely on `90680ef` (Development CI 11/11 jobs, Security Audit success) |
| T41-19 Downstream contracts | PASS | Spec §9/§13 + invariants V08; interfaces in `app/models`, `app/integrations`; FASTAPI.md section |
| T41-20 Evidence/runbook/API docs | PASS | This file, FASTAPI.md runbook, `.env.example` |

---

## F. Residual risks, gaps and next-task contracts

- **Closed:** the new CI steps ran on GitHub Actions for `90680ef`: Development CI 11/11 jobs success, including "AI Service / Docker"; Security Audit success. The backend CI `.env.test.local` sets `AI_SERVICE_URL` without a key, which yields one `AI_SERVICE_MISCONFIGURED` warning with AI disabled (harmless).
- **Closed:** `tests/account-deletion.integration.test.ts` (pre-existing) assumed a `CUSTOMER` role created by other test files and failed when it ran first on a fresh database. It now upserts the role, the same pattern `tests/google.integration.test.ts` uses. Verified on a brand-new disposable database (migrate deploy, then this file alone): **2/2 passed**.
- **Closed — QA admin password login:** the earlier mismatch was the fixture file's *email*, not the password. The QA DB's admin accounts use a different address (`a***@electrohub.com`); the fixture `admin_password` verifies against their hash (read-only check). Real `POST /api/auth/login` (isolated QA DB, real app, no mocks) for the seeded admin → **200, role ADMIN, HttpOnly refresh cookie**; wrong password → **401**. With that session token, `GET /api/admin/ai/status` against live FastAPI (Python 3.12 venv, `qa`, :8201) → **200** `reachable:true, environment:qa, modelReady:false, MODEL_NOT_CONFIGURED`, `Cache-Control: private, no-store`, no key or port in the body. No credentials were changed.
- **Closed — MAIN DEV route:** the MAIN DEV backend was not running (:5000 free), so I started it with the standard watched `npm run dev` (shared DEV DB; Task 04.0 guard `watched-dev-server-on-shared-target` keeps payment mutations disabled; no payment or email worker started). `/api/health` 200, `/api/health/ready` ready + database connected, `/api/admin/ai/status` anonymous **401** (route present and guarded), `/api/search/products?q=phone` 200. `/api/health/payments` reports `degraded` with 19 overdue items (oldest ≈27.7 h, i.e. predating this start): the separately tracked payment-recovery runner issue, not a 04.1 regression, and not touched. Operators running a local AI instance still need a matching `AI_SERVICE_API_KEY` in both `.env` files.
- Plan Mode was carried out as an in-session planning phase with a frozen contract (scratch `AI_CONTRACT_04.1.md`), not via the Plan Mode approval UI, to avoid blocking an already-authorized run. Parallel agents: Express integration (Opus) and read-only DB verification (Opus); the lead implemented FastAPI and reviewed/edited the Express diff (added client telemetry).
- **04.2 contract:** multipart `image` part on `/internal/v1/image-search`, magic-byte decode + pixel/byte limits, EXIF strip, `ImageEmbeddingEncoder` loader verifying `artifact_sha256` (safetensors/onnx only), pgvector gateway with a read-only role named `AI_*` (never `DATABASE_URL`), descriptor-matched index activation, Express product re-validation, command-search UI redesign verified against Figma.
- **04.3/04.4/04.5–04.7:** unchanged boundaries per spec §2/§13; AI remains uncoupled from delivery, maps and sockets.

---

## G. Final acceptance closure (2026-10-21)

**Code state:** HEAD `3fb20eb` (pushed: `a69fd2f` Task 04.1, `3fb20eb` vite 6.4.5 for GHSA-587h-7wmj-h5pm; remote Development CI and Security Audit both green on `3fb20eb`). **Closure changes (committed and pushed on owner request):** `.github/workflows/ci.yml`, new `apps/backend/src/integrations/ai/ai.telemetry.ts` + `__tests__/ai.telemetry.test.ts`, `ai.client.ts`, `ai-admin.routes.ts` / `.test.ts`, this file.

**Shared-file CCR — acknowledged (owner-authorized, retrospective).** Final effective diff against `origin/develop`: `env.ts` (−1 optional `AI_SERVICE_URL` key, +1 comment), `dev-isolated.cjs` (+7: blank inherited `AI_SERVICE_*`, force `qa`, explicit `ISOLATED_AI_SERVICE_*` only), `routes/index.ts` (+2: import + mount). This is identical to the handoff. No auth middleware, payment guard, DB-target or pool change. The route is guarded by `requireAuth` + `requireRole('ADMIN')`, with no collision (only `/admin/ai/status`). Express startup no longer depends on AI config. A QA→DEV AI fallback is impossible (blank + `qa` binding + per-environment key).

| Gap | Evidence | Status |
| --- | --- | --- |
| Python 3.11 execution | `winget` CPython 3.11.9 → venv: `pip install -r requirements-dev.txt`, `pip check` OK, `pytest` **118 passed**, ruff check/format clean, `mypy app tests` no issues (45 files), `pip_audit` no known vulnerabilities | PASS |
| Real Docker build + smoke | Docker Engine 29.1.3 (`docker.io`, WSL Ubuntu, unix socket only). `docker build -t electrohub-ai:task-04.1 apps/ai-service` → `3a21962e40e8`, 51 MB. Container: Python 3.11.13, uid 999 (`app`); image contains only `app/` + `requirements-runtime.txt`, no `.env`/weights/notebooks. Production without key → refuses. Keyed run on `127.0.0.1:18000`: HEALTHCHECK `healthy`; `/health` 200; no key 401; wrong key 401; wrong env 403; ready 200 `modelReady:false` / `MODEL_NOT_CONFIGURED`; recommend 503 `AI_MODEL_NOT_READY`; `/docs` and `/openapi.json` 404; 0 outbound TCP connections; `docker stop` → exit 0 + `ai.runtime_stop`; key in logs 0 | PASS |
| AI CI quality gates | `ci.yml` job "AI Service / Test": installs `requirements-dev.txt` + `pip check`, ruff lint, ruff format check, mypy strict, pytest, pip-audit (Python 3.11). New job "AI Service / Docker": real build + loopback smoke (fail-closed start, healthy, non-root, 200/401/403, `modelReady:false`, docs 404, clean stop, key not logged); no secrets, no registry push. Workflow policy: `node --test .github/scripts/*.test.cjs` **11/11**, `check-workflow-policy.cjs` OK. The Docker job's steps, extracted from the YAML, were executed against the local daemon: pass. Python job commands ran under 3.11 (above) | PASS (local + remote: run 39631055119 on `90680ef`, "AI Service / Test" and "AI Service / Docker" success) |
| AI observability | New `ai.telemetry.ts`: one allowlisted event per upstream call (`AI_SERVICE_REQUEST_COMPLETED` info / `AI_SERVICE_REQUEST_FAILED` warn) with `operation, environment, outcome, statusClass, statusCode, category, code, durationMs, requestId` (bounded pattern), plus bounded per-operation counters (`success, failure, failuresByCategory, lastDurationMs`) reported as `metrics` by `/api/admin/ai/status`. Telemetry is wrapped so it can never fail the call. FastAPI side unchanged: `ai.request` (duration, status, requestId), `ai.model_unavailable`, `ai.auth_rejected`, 429/504 saturation codes; `/ready` separates service readiness from `modelReady`/feature status. Tests `ai.telemetry.test.ts` (6): success event fields, failure event + counters, unsafe/oversized request IDs dropped, no key/URL/Bearer/body text logged, a throwing logger cannot fail a successful call, misconfiguration warning logged once across repeated init. `npx vitest run src/integrations/ai src/routes/ai-admin.routes.test.ts` → **74 passed**; typecheck + lint pass | PASS |
| Authenticated admin status | Real `app` (no mocked auth) on the isolated QA DB `localhost:55434/electrohub_disposable` + live FastAPI (Python 3.11, `qa`, :8201, throwaway key). Anonymous 401; real customer login → 403; admin (real token for the seeded ADMIN user, signed with the isolated runtime's JWT secret) → 200 `reachable:true, environment:qa, modelReady:false, MODEL_NOT_CONFIGURED`, metrics success 1. AI stopped → admin 200 `reachable:false, error.category:connect`, metrics failure 1; restarted → reachable again. Text search `/api/search/products?q=phone` 200 (20 items) in every state. Body never contained the AI port or key; key in FastAPI log 0 | PASS |
| Full backend suite on disposable DB | Throwaway PostgreSQL **18** (CI uses 17; Docker Hub CDN was unreachable from WSL DNS) with TLS, loopback `127.0.0.1:55432`, random password, per-run CA; `prisma migrate deploy` 20/20 then `migrate status` "up to date"; CI's `test:ci` command and env values, `CI=1`. Result: **326 files, 1494 passed, 0 failed, 102 skipped**. One file reported a suite-level setup error: `account-deletion.integration.test.ts` needs a `CUSTOMER` role created by other files (pre-existing ordering dependency, not 04.1). Rerun alone: **2/2 passed**. Cluster stopped and deleted | PASS |
| DEV/PROD migration status | Reused from §C: Prisma schema, migrations and DB targets unchanged since (`git diff origin/develop -- apps/backend/prisma` empty). Verified NO-OP; pgvector deferred to 04.2 | PASS |
| Shared-file CCR | Acknowledgment above | PASS |

**Defects found and fixed during closure:** none in 04.1 runtime code. Observability gap closed (above). The CI `secrets.` text policy check flagged my first smoke draft; the key generator was switched to `openssl rand`.

**Not done / external:** native PostgreSQL 17 for the local suite run (18 used; CI itself runs 17 and is green).

**Python version policy (owner addendum):**
- **Local development:** existing CPython **3.12.10** (`C:\Users\ouss0\AppData\Local\Programs\Python\Python312`), untouched. No TensorFlow is installed in that global interpreter (`pip show tensorflow` empty). The project venv `apps/ai-service/venv` (git-ignored, `home = …\Python312`, 3.12.10) re-verified: `pip check` OK, **118 passed**, ruff/format clean, strict mypy clean, pip-audit clean, `python -m app` start → `/health` 200 → stop. No TensorFlow/PyTorch in the venv, no global installs.
- **Python 3.11.9** was installed during this closure (`winget`, user scope, 2026-10-21, separate `Python311` directory, never on PATH). Its only consumer was a temporary `.venv311`, now deleted; no other venv under `Desktop/Tools/Coding` referenced it. It has been **uninstalled** (`winget uninstall` plus removal of the leftover `Python311\Lib`/`Doc`, including the `pyyaml` I had added for the YAML check). `py -0p` now lists 3.14/3.13/3.12; `python` = 3.12.10. WSL's system Python was not touched.
- **3.11 verification source:** the native 3.11.9 run (Gap table, before uninstall), the Docker image (CPython 3.11.13), and CI "AI Service / Test" (`python-version: '3.11'`, unchanged). The Docker and CI targets remain 3.11.
- No remaining compatibility issue found between 3.11 (Docker/CI) and 3.12 (local).

**Engineer self-review score: 96/100.** Deductions: the local full suite ran on PG 18 rather than CI's 17.
**QA status:** all T41-01 – T41-20 rows PASS on actual evidence.
**Recommendation: READY FOR ARCHITECT REVIEW** (engineer assessment, not architect approval).
