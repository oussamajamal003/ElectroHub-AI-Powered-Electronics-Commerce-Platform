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
| `ai_vector_ingest` (offline CLI) | `SELECT ai.catalog_images`; `INSERT` versions (as `STAGING`); `UPDATE (expected_images)`; write embeddings and journal rows while the database guard confirms `STAGING` and eligible catalog references | Read or write commerce tables; change a version's status; write `ai.active_index`; mutate vectors for any non-STAGING version; run DDL |
| Operator (migration owner) | Activate and roll back | — |

`anon` and `authenticated` lose all rights on `ai` when those Supabase roles exist. Forward migration `20261025000000_ai_vector_staging_guard` installs a database trigger that checks ingestion writes under a row lock shared with activation, denies non-STAGING mutations, and preserves trusted catalog deletion cascades. `node apps/backend/scripts/ai-vector-qa.cjs verify` runs the current allow/deny role checks.

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

## Environment status (verified 2026-10-25)

| Environment | Migration | Index |
|---|---|---|
| Disposable QA (`localhost:55434/electrohub_disposable`, pgvector 0.8.0) | Forward guard applied; 22 migrations present, with clean-history replay verified separately | `effb0-commons-v2-3224d2cc9e57` ACTIVE: 412/412 images, 206/206 products. Activation, rollback, concurrency and catalog deletion behavior verified. Docker listener binds only `127.0.0.1:55434`. |
| DEV `pzxekjybdiulzmssalfo` (pgvector 0.8.2) | 22/22. Guard `20261025000000_ai_vector_staging_guard` applied via `dev-migration.yml` run 40209898767 at `cc37d88` (2026-10-25); `prisma migrate status` clean; staging triggers enabled. | Existing v2 index `effb0-commons-v2-3224d2cc9e57` remains ACTIVE: 412 images, 206 products. |
| PROD `yepfgjehdstlxbpespun` | Read-only: 20/22 applied, zero failed/rolled-back; pending `20261024000000_ai_vector_search`, then `20261025000000_ai_vector_staging_guard`. `vector` 0.8.2 is available but not installed; no `ai` schema. Foundation migration checksum is unmatched in Git history; email-OTP and payment-ownership hashes reflect CRLF worktree bytes rather than canonical Git blobs. Backup/PITR is unverified and no protected PROD workflow exists. No writes performed. | No index until both migrations and separately authorized ingestion/activation are completed. |
