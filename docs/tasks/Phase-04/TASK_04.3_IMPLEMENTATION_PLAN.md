# Task 04.3 — Product Image Storage & AI Embedding Synchronization Implementation Plan

Status: implemented and verified locally/DEV with documented coverage limits; PROD recovery gate blocked; not Architect approved. Baseline: `7d8b073a565af7a05670e923fd8ce7361d6b1e8a`. Final results are in `TASK_04.3_IMPLEMENTATION_REPORT.md`.

## Baseline and scope

Existing branch: `feature/04.3-Product-Media-Storage-Embedding-Sync` (case differs from requested spelling). Existing modified documentation and untracked task specification belong to the owner and must be preserved. Fetch requires sandbox access. No commit, push, merge, deployment or AI activation is authorized. This runtime has three collaborator slots; three GPT-6 Luna collaborators are assigned exclusive surfaces. Actual Plan Mode is unavailable; this saved plan supplies the preimplementation planning boundary.

Extend existing ProductImage, Express services and ADMIN middleware; retain public DTO fields and historical order URLs. Supabase Storage is the official product media provider. Full product CRUD, recommendations, training and model promotion remain out of scope.

## Related file manifest and ownership

* Lead: `apps/backend/prisma/schema.prisma`, new `20261028000000_product_media` migration; backend media service/controller/routes/tests/OpenAPI; route aggregator; direct product/search/cart/wishlist/checkout media projections; package/lockfile; isolated QA and task evidence/runbook.
* Storage collaborator: `apps/backend/src/integrations/storage/`, `src/validators/product-media*` and focused tests. Existing image-search upload middleware is read-only reference.
* AI collaborator: `apps/ai-service/app/integrations/pgvector_gateway.py`, new media worker, related tests/config, new `20261028010000_catalog_media_overlay` migration. Existing model loader and ingestion lifecycle remain the authority.
* Frontend collaborator: admin media route/page/query client/styles/tests under `apps/frontend`; existing shared controls, product DTOs/query keys and admin layout are dependencies.
* Operational references: `.github/workflows/prod-migration.yml`, `.github/scripts/migration-plan.cjs`, workflow policy tests, `apps/backend/scripts/dev-isolated.cjs`, existing vector migrations, current task spec, applicable architecture/security/testing/design docs. Expand this manifest only for a demonstrated dependency.

## Decisions and contracts

1. Backend-mediated, one-file-per-idempotent-mutation upload; frontend sequences multi-file input and reports partial results. Validate JPEG/PNG/WebP, 6 MiB, safe full decode, 20M pixels, 128–6000 dimensions; normalize with pinned sharp to metadata-free WebP.
2. Immutable generated path `products/<product>/<image>/<revision>/original.webp`. Server-held Storage credential and explicit project identity, no dynamic transformations required. Verify downloaded object digest before publication. Retain old paths; reconciliation initially reports/dry-runs without unsafe automated deletion.
3. Add nullable/default metadata on ProductImage. Soft retirement preserves FKs/base snapshots/order history. At most one published primary enforced by SQL partial uniqueness; product-row lock serializes media writes. If-Match prevents lost intent, including legacy rows using updatedAt.
4. Catalog media event and image revision commit in one Prisma transaction. Unique mutation key plus request hash rejects mismatched retries. Network/image processing stays outside transactions. DB failure leaves a verifiable unreferenced immutable object for safe reconciliation, rather than risking deletion after uncertain commit.
5. AI base snapshots remain immutable. A restricted worker writes a separate version-scoped overlay only; narrow eligibility view checks live ProductImage state/ownership and product/category visibility. Legacy untouched sources retain baseline eligibility; any explicit revision fails closed unless digest/revision matches. No fabricated legacy digest backfill.
6. Durable leased worker checks exact loaded model descriptor, trusted Storage host/path, canonical bytes, normalized vector and current source before atomic overlay/ack. Retry bounded, stale events superseded; no ACTIVE-pointer writes or base-vector grants. Candidate C requires controlled freshness verification before future promotion.
7. Admin endpoints: list picker `/api/admin/products`; images GET/POST, file PUT, metadata PATCH, soft DELETE, retry POST and index-status GET. Mutations require live ADMIN and recheck before commit. Responses use existing `{data}` and AppError conventions. Media DTO adds revision, updatedAt, state and truthful indexing state; public DTO remains compatible.
8. Protected frontend route `/admin/products/:productId/media` plus product picker. Reuse shared controls, tokens and TanStack Query. Preserve gallery during background refresh; scoped pending state, preview cleanup, confirmation, retry, keyboard ordering and separate publication/index status.

## Invariants and verification boundaries

Protect V43-01–10 and U43-01–20 from the task. Focused tests cover malicious/corrupt files, RBAC/ownership/revocation, duplicate request mismatch, revision CAS, transaction rollback/outbox atomicity, concurrent primary/replacement, retained objects, immediately excluded stale vectors, out-of-order/expired leases, exact descriptor/digest, AI/Storage outages and stale UI responses. Mock tests establish control flow only.

Before shared writes: identify actual DEV `pzxekjybdiulzmssalfo` and PROD `yepfgjehdstlxbpespun`, inspect migration ledgers/checksums/roles/active model/counts, prove complete disposable pgvector migration replay and constraints. PROD additionally requires verified backup/recovery and deployed-code compatibility. Do not force a failed preflight. Current task prompt explicitly authorizes eligible writes despite older specification's separate-approval wording.

Integration order: additive relational migration → overlay/grants/reader → backend Storage/API → worker → frontend. Verify clean QA replay/no-op, then DEV integration and eligible PROD schema only. Existing production workflow allows only two 04.2 migrations; leave safety policy intact and document that new pending migrations block its precheck until a reviewed release updates authorization.

Run focused tests throughout; final affected unit/typecheck/lint/build and AI pytest/Ruff/mypy, real PostgreSQL integration and real Storage/authenticated browser where available. Capture and inspect 390/768/1440/1920 screenshots, keyboard/focus/zoom/reduced motion and direct storefront consumers. Missing integration or visual evidence stays NOT VERIFIED.

## Handoff gate

Review every task-owned changed/new file, inspect final diff and preserve owner changes. Record commands, actual results, environment identities, migration state, source freshness proof, screenshot observations and residual defects in implementation evidence. Ready requires all mandatory task gates; implementing agents cannot self-approve. Rollback stops worker/API first, retains additive schema and old objects/base vectors, and coordinates reader compatibility; no destructive down migration.
