# AI Vector Index (Task 04.2)

Migration `apps/backend/prisma/migrations/20261024000000_ai_vector_search/migration.sql` is additive. It does not alter any existing table, enum, row or grant in `public`.

## Objects

| Object | Purpose |
|---|---|
| `extensions.vector` (pgvector) | Vector type and cosine operator. Installed in the `extensions` schema, as Supabase does. |
| `ai.model_versions` | One row per embedding space: model and preprocess version, `dimension = 256`, safetensors SHA-256, status `STAGING → VERIFIED → ACTIVE → RETIRED` (or `FAILED`), and `expected_images`. Triggers enforce that new rows start as `STAGING` and that identity columns are immutable after verification. |
| `ai.product_image_embeddings` | Holds `vector(256)` per (version, product image). Has foreign keys to `public.product_images` and `public.products` with `ON DELETE CASCADE`, and a CHECK that `‖v‖ = 1 ± 0.001`. |
| `ai.ingestion_jobs` | Resumable journal of counts and safe error codes. It never stores image bytes or vectors. |
| `ai.active_index` | Singleton pointer to the active version plus `previous_version`, so the switch is a single-row update. |
| `ai.catalog_images` (view) | Images of storefront-visible products only (`ACTIVE`, not a test fixture, `storefrontVisible`, active category). It exposes no prices, stock, users or orders. |

Prisma does not model the `ai` schema; it introspects `public` only. On disposable QA, `prisma migrate diff` shows nothing for `ai` or `vector`. The only diff lines are older column-default differences on auth tables, which predate this task.

## Roles (least privilege)

The roles are created `NOLOGIN`. An operator enables `LOGIN` and sets passwords per environment; that is never part of a migration.

| Role | Can | Cannot |
|---|---|---|
| `ai_vector_reader` (FastAPI) | `SELECT` on `ai.active_index`, `ai.model_versions`, `ai.product_image_embeddings` | Read anything in `public` (users, orders, payments, products) or `ai.catalog_images`; write; run DDL |
| `ai_vector_ingest` (offline CLI) | `SELECT ai.catalog_images`; `INSERT` versions (as `STAGING`); `UPDATE (expected_images)`; write embeddings and journal rows | Read or write commerce tables; change a version's status; write `ai.active_index`; run DDL |
| Operator (migration owner) | Activate and roll back | — |

`anon` and `authenticated` lose all rights on `ai` when those Supabase roles exist. `node apps/backend/scripts/ai-vector-qa.cjs verify` runs 19 allow/deny checks.

## Retrieval

Exact cosine search over the active version: `MIN(embedding <=> q)` per product, ordered by distance and then product id, with `topK ≤ 24`. Score = `1 − distance`, an uncalibrated similarity, never shown to customers. With about 400 vectors an exact scan is faster and more faithful than HNSW, so no ANN index is created.

## Operator workflow

```bash
# disposable QA (pgvector container in WSL Docker; see scripts/dev-isolated.cjs ISOLATED_PG_DOCKER=1)
ISOLATED_PG_DOCKER=1 PG_BIN=C:/PostgreSQL/17/bin node apps/backend/scripts/dev-isolated.cjs init
ISOLATED_PG_DOCKER=1 PG_BIN=C:/PostgreSQL/17/bin node apps/backend/scripts/ai-vector-qa.cjs roles
ISOLATED_PG_DOCKER=1 PG_BIN=C:/PostgreSQL/17/bin node apps/backend/scripts/ai-vector-qa.cjs verify
# with AI_VECTOR_INGEST_DATABASE_URL / AI_VECTOR_ADMIN_DATABASE_URL from .isolated-docker/ai-vector-roles.json
python -m app.ingest stage --artifact-dir <export dir> --catalog-root apps/frontend/public   # idempotent, resumable
python -m app.ingest activate --embedding-version <version>   # refuses unless stored == expected == eligible
python -m app.ingest rollback                                 # back to previous_version
python -m app.ingest status
```

`stage` reads storefront-relative `/images/...` files only (path-traversal-safe, ≤ 8 MiB). It encodes them with the same verified loader the service uses. Re-running skips images whose bytes are unchanged, and it commits per batch so an interrupted run resumes. Cloudinary-driven refresh belongs to Task 04.3; until then, re-run `stage` and `activate` after catalog image changes.

## Environment status (2026-10-24)

| Environment | Migration | Index |
|---|---|---|
| Disposable QA (`localhost:55434/electrohub_disposable`, pgvector 0.8.0) | Applied from a clean history (21 migrations) | `effb0-commons-v2-3224d2cc9e57` ACTIVE: 412/412 images, 206/206 products. Activation and rollback demonstrated. |
| DEV `pzxekjybdiulzmssalfo` (pgvector 0.8.2 available) | **Pending owner approval.** A read-only check shows this the only pending migration, no `ai` schema and no roles | Not ingested |
| PROD `yepfgjehdstlxbpespun` | Not touched. The same reviewed SQL is prepared; applying it needs the protected PROD gate | — |
