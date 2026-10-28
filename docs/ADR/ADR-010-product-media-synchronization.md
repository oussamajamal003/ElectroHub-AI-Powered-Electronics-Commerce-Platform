# ADR-010: Product media Storage and revision-aware visual search

Status: Implemented proposal for Principal Architect review; not self-approved.
Date: 2026-10-28. Task: 04.3.

## Context

The existing ProductImage IDs and URL DTOs are consumed by products, search, cart, wishlist and purchase snapshots. Existing AI base vectors include ACTIVE, STAGING and RETIRED snapshots. Replacing a URL alone leaves obsolete vectors searchable, while physically deleting an image cascades across model snapshots. The ordinary ingest role deliberately cannot alter non-STAGING base rows.

## Decision

Use Supabase Storage, with backend-only writes to the environment's `product-media` bucket. Catalog uploads are approved public product photography: normalized objects become publicly retrievable at an unguessable immutable path before the database reference is published. This bucket is unsuitable for private/customer query images. React never receives a Storage secret. The configured Storage project must match the actual backend database target; isolated launchers clear shared Storage credentials.

Input is one JPEG/PNG/WebP per mutation, at most 6 MiB, 128–6000 pixels per side and 20 million decoded pixels. Pinned sharp checks signatures, fully decodes, orients, strips metadata and encodes WebP. Canonical output is capped at 12 MiB, also enforced by the bucket and worker. Source SHA-256 is over these exact normalized bytes. No paid image transformation entitlement is assumed.

Storage paths are `products/<product UUID>/<image UUID>/<revision UUID>/original.webp`. Replacement keeps ProductImage.id, generates a revision and new path, and retains the old object. Upload verifies downloaded bytes before committing a reference. The SQL transaction contains bounded relational work only. An uncertain database outcome never triggers blind object deletion. Recovery inventories objects against current rows, retained revision events and historical order URLs; initial garbage collection is dry-run only.

Extend ProductImage additively and soft-retire media. Product-row locking serializes gallery mutations, a partial unique index enforces one published primary, and If-Match uses a monotonically advanced updatedAt timestamp for lost-intent protection. Metadata changes do not require re-encoding. Media mutation and durable outbox event are one Prisma transaction. Request UUID plus actor/product/content/intent hash makes lost-response retries safe and rejects changed payloads.

Keep immutable AI base snapshots. A narrow private source view derives eligibility from image ownership/publication and current product/category visibility. Revisioned images rank only through an overlay matching image, product, revision, source digest and exact active embedding version. Untouched null-revision legacy images retain their existing base eligibility: this is an explicit compatibility trust boundary, not a claim that legacy hashes were independently backfilled. All media mutations must use the revisioned service. No legacy import/backfill or model promotion is performed implicitly.

The private overlay publisher checks a current unexpired event lease, source identity, exact model/preprocess/artifact identity and active pointer under row locks. The separate restricted worker verifies bytes, uses the registered artifact, and publishes/acknowledges atomically. It cannot mutate base vectors, switch active_index, read users/orders or obtain Storage write credentials. Readiness retains the base-count/model identity check; current image coverage is a separate freshness signal. Missing eligible overlays are reconciled in bounded sweeps; permanent failures require explicit retry.

Candidate C promotion and historical rollback require current-source coverage/digest verification. Existing snapshots remain available, but an old snapshot is not automatically considered current after media changes. No automatic model activation is part of media synchronization.

## Consequences and rollout

Apply additive relational and overlay migrations before deploying this reader/API. Then start the artifact-compatible worker and expose the admin editor. Old application code remains compatible with the added columns/tables. Existing `/images/...` references and OrderItem.productImageUrl snapshots remain unchanged. A retired row with event history cannot be physically deleted without a separately reviewed retention/archive process; full product deletion belongs to later product management work.

Use clean disposable replay/no-op/checksums, real PostgreSQL concurrency/failure tests, restricted-role reader/worker tests and actual Storage verification before shared writes. DEV and PROD identities are independently checked. Current PROD backup/PITR absence fails its task-specific gate; preserve PROD until recovery prerequisites are established.

On Windows, historical migration checkout bytes can differ solely because of CRLF conversion. A task deployment snapshot uses exact historical Git blobs only after normalized SQL equality is proved; it never edits original migrations or `_prisma_migrations`. Existing policy guards still validate the snapshot against the actual ledger and exact pending migration list.

The two newly applied Task 04.3 migration files are pinned with per-file `-text` attributes, following the repository's byte-preservation exception pattern. This prevents future `core.autocrlf` staging from changing their applied checksums. No SQL/ledger rewrite is used to repair line-ending drift.

### Worker health and lifecycle addendum

The media worker now records one row per process in the private `ai.media_worker_heartbeats` table. `ai_media_worker` is the only application role granted access; RLS is enabled and PUBLIC, `anon`, and `authenticated` have no table privileges. Each row carries environment, lifecycle state, heartbeat time, active model version, current event, success/failure counters and a bounded error code. The worker refreshes its row while idle and processing, validates role/table/function privileges and active artifact compatibility before reporting READY, and removes rows older than seven days. The operations status command derives STALE from a 60-second heartbeat age and keeps process health separate from queue health. SIGINT/SIGTERM stops new claims, lets a bounded current event finish, returns an unstarted claim to retry, persists shutdown state and closes the encoder. No external monitoring platform or new public API is introduced.

The production workflow retains its existing trigger, project pinning, exact ordered pending-set check, checksum/destructive-SQL guards and pre/post verification. Its allowlist now names the two previously approved Task 04.2 migrations followed by the three Task 04.3 migrations (`20261028000000_product_media`, `20261028010000_catalog_media_overlay`, `20261028020000_product_media_worker_health`). This source change did not dispatch the workflow, merge, deploy or apply a PROD migration. PROD backup/PITR state is outside Task 04.3 source acceptance.

Rollback stops the media worker and mutation routes first, retains additive schema/objects/base vectors, and keeps revision-aware reads for any already-mutated catalog. Reverting to a reader that ignores revisions would revive stale base vectors and is not a safe rollback. Destructive down migrations and automatic historical-media deletion are excluded.
