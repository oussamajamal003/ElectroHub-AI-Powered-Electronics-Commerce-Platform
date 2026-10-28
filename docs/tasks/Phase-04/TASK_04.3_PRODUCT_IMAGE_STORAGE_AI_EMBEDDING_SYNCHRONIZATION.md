# ELECTROHUB — TASK 04.3 / PRODUCT IMAGE STORAGE & AI EMBEDDING SYNCHRONIZATION

**Phase:** 04 — AI & Real-Time Features  
**Task:** 04.3 — Product Image Storage & AI Embedding Synchronization  
**Task type:** Feature · Infrastructure · Database · Security · Admin UI · AI integration · Operations  
**Status:** **IMPLEMENTATION SPECIFICATION / FIRST HANDOFF — NOT IMPLEMENTED OR TEST-VERIFIED BY THIS DOCUMENT**  
**Prepared:** 2026-10-27  
**Proposed task branch:** `feature/04.3-product-media-storage-embedding-sync`  
**Integration target:** `develop` — verify remote/local HEAD and worktree state at task start  
**Proposed repository task location:** `docs/tasks/Phase-04/TASK_04.3_PRODUCT_IMAGE_STORAGE_AI_EMBEDDING_SYNCHRONIZATION.md`  
**Related tasks:** 04.1 FastAPI Foundation; 04.2 Image Search / Discovery Console; 04.4 AI Recommendations (separate); 05.2 Full Admin Product Management (reuses this work).  
**Repository reviewed read-only:** `oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform`, branch `develop`, SHA `7d8b073a565af7a05670e923fd8ce7361d6b1e8a` at drafting time. **The implementing agent MUST re-inspect actual HEAD, repository, state, tests, and docs before editing.**  
**Scope:** Secure administrator-managed product photography; Supabase Storage upload/ownership/delivery; backward-compatible `ProductImage` metadata and lifecycle; durable change outbox; source-revision-aware, version-correct embedding invalidation and refresh; customer-facing media rendering; reconciliation, operations, tests and evidence.  
**Safety boundary:** This specification itself authorizes **no remote database/storage writes, migration execution on shared DEV or PROD, AI model promotion, credential changes, Git commit/push/merge, or deployment**. Implement on an isolated branch and disposable QA first; request explicit owner authorization for controlled shared-environment operations.
 
> **Mission:** An authorized ElectroHub administrator can add, preview, replace, reorder, designate primary and remove real product photographs. Images are stored in Supabase Storage and delivered efficiently to the storefront. Catalog metadata stays authoritative, historical order images remain available, and the production-oriented AI search never silently serves obsolete, deleted or mismatched-image embeddings. Failures are observable, recoverable and safely retryable without mutating immutable ACTIVE model vectors or accidentally promoting any model.

---

# 0. Instructions to the implementing developer — read before writing code

## 0.1 Mandatory repository-first inspection (do not skip)

1. Inspect `git status --short`, current branch, worktrees, `git log -8 --oneline --decorate`, local `develop`, `origin/develop`, and uncommitted user changes; do not overwrite, stash or reset unrelated work without authorization. Compare current HEAD with this document's read-only baseline; if material contracts changed, follow **actual code first** and report differences.
2. Read `AGENTS.md`, `AGENT_COORDINATION.md`, `docs/11_Workflow/{TASK_TEMPLATE,BRANCHING,GIT_WORKFLOW,CODE_REVIEW,RELEASE_PROCESS}.md`, the Phase 04 task specs/evidence, and the architecture/stack/roadmap. Do not merely search filenames: inspect their **actual content** and current implementation.
3. Trace existing frontend product image consumers, admin login/layout/routes, auth context, API client, TanStack Query keys, product cards/details, cart/wishlist, search results, order receipts and any placeholders or legacy media utilities.
4. Trace Express auth/RBAC, product controller/service/selects, SQL search projection, `imageSearchUpload` (customer query upload is **not** the same as catalog upload), health/logging, startup/worker architecture and transactional outbox patterns.
5. Inspect `schema.prisma`, migration history and actual AI SQL definitions, role grants, `ai.catalog_images`, version/readiness checks, `PgVectorGateway`, ingestion CLI, FastAPI descriptors and AI-service configuration. Confirm which behavior is implemented, rather than assuming this task's proposed design already exists.
6. Inventory local catalog source files, `ProductImage.url` patterns, image provenance, accessibility metadata, legacy `publicId`, actual QA/DEV catalog IDs and pending migrations; distinguish repository fixture counts from live environments.
7. Check Supabase Storage project capabilities/quotas and current API docs before choosing SDK operations or transforms; check package manager, lockfile, supported Node/Python versions and test harnesses.
8. Produce a succinct **discovery memo / architecture decision record** before material schema or indexing design: what exists, contradictions, chosen safe data/reader design, alternatives rejected, migration dependency and explicit environment authorization requirements. Do not stall on minor uncertainty; make bounded, testable decisions.
9. Create/switch to the proposed task branch **only after** the worktree and coordination checks pass. Never begin from a stale, unrelated or dirty base by assumption.

## 0.2 Confirmed implementation baseline from read-only repo inspection

| Subject | Confirmed baseline | Task implication |
|---|---|---|
| Prisma catalog | `Product` has `images: ProductImage[]`; existing `ProductImage` has `id`, `productId`, `url`, nullable `publicId`, nullable `altText`, `sortOrder` mapped to `position`, `isPrimary`, timestamps | **Extend** the relation; no competing image table |
| Public product API | `apps/backend/src/routes/product.routes.ts` exposes GET lists/details and reviews; no product-media admin CRUD routes there | Introduce the smallest compatible authorized routes |
| Auth | `requireAuth` verifies JWT and re-reads active user role; `requireRole('ADMIN')` exists | Reuse both; verify negative authorization behavior |
| Frontend | `apps/frontend/src/features/products/{types,queries}.ts`, TanStack Query, SCSS modules; admin login exists; `AdminLayout` is minimal/placeholder | Build a media-specific management surface without pretending full Task 05.2 admin CRUD exists |
| Product output | `product.service.ts` selects image `{id,url,altText,sortOrder,isPrimary}`; raw SQL search also projects image data | Retain backward-compatible display contracts and audit **both** Prisma and SQL paths |
| AI model/index | Versioned `ai.model_versions`, `ai.product_image_embeddings`, `ai.active_index`, `ai.catalog_images`, restricted reader/ingest roles | Reuse 04.2 boundaries; no unrelated vision retraining |
| Reader SQL | `PgVectorGateway._NEAREST_SQL` presently queries `ai.product_image_embeddings` by version and `MIN` image distance grouped by product, **without a source-revision eligibility join** | **Highest-risk required change:** prevent stale/deleted-photo vectors from appearing in results |
| AI ingest | Existing `app.ingest` resolves repository-local `/images/...` URLs from a catalog root and writes **STAGING** vectors | It cannot be assumed to read Supabase Storage images as-is; design a trusted canonical-media source resolver |
| Staging guard | `20261025000000_ai_vector_staging_guard` blocks `ai_vector_ingest` from mutating non-STAGING embeddings | Do **not** grant ordinary media worker write access to immutable ACTIVE rows |
| Existing operations pattern | Commerce-email transactional outbox and lease/worker patterns exist | Reuse concepts selectively without coupling media jobs to commerce-email tables or payment workers |
| Existing file uploads | `multer` is in Express dependencies, including an image-search memory upload path | Separate admin media limits, validation, quotas and permissions |
| AI model state (reported operational state, not verified from repo) | Shared DEV D3 `siglip2-b16-p256-d1-b3900dd9fad5` ACTIVE with 412 vectors/206 products; previous commons index RETIRED; Candidate C STAGING | Reconfirm live state read-only before any connected tests or refreshes; never mix or auto-activate versions |
| Environment identities | Supabase DEV `pzxekjybdiulzmssalfo`; PROD `yepfgjehdstlxbpespun`; isolated QA typically frontend `:3200`, Express `:5200`, FastAPI `:8200`, PostgreSQL `:55434` | No assumed identity interchange; QA may have differing UUIDs |
| Release pipeline **critical** | At repo HEAD, `.github/workflows/prod-migration.yml` includes `push` to `develop` as well as manual dispatch | **Merging to `develop` may start a PROD-targeting workflow automatically.** Independently review its allowlist/plan before any merge. This task does not authorize PROD migration execution |

These facts are starting observations, not permission to hard-code all numeric counts or consider tests passed. The architecture decision for **04.3 is Supabase Storage**. Report and update the relevant task/technology references without gratuitously rewriting historical documentation.

## 0.3 Binding source-of-truth and scope

Follow the task requirements, then observed repository/tests, then project architecture, then relevant Figma/design references and verified provider documentation. If a documented path or table differs from live code, **report and resolve explicitly**. This document specifies *required behavior* and *proposed names*; API routes, tables and component filenames must be reconciled with existing conventions before implementation.

The product-media pipeline is distinct from a customer's transient query photo. **Never persist customer camera/upload images into permanent catalog storage**. The admin's approved source image and its content digest are what the image-search catalog embedding represents.

---

# 1. Task objective and Definition of Done

Deliver one coherent end-to-end product-media lifecycle:

```text
ADMIN (JWT + ADMIN role)
  React Media Editor (preview / upload / replace / primary / reorder / remove)
       │ multipart through Express; no browser storage-secret
       ▼
EXPRESS — RBAC + size/signature/decode validation + ProductMediaService
       ├── Supabase Storage adapter ──> bucket / CDN / immutable objects
       └── Prisma transaction ────────> ProductImage + media state + durable event
                                       │
                                       ▼
                              Media Sync Worker / Reconciler
                               ├─ check revision & eligibility
                               ├─ load trusted canonical Storage source
                               ├─ encode using matching model artifact
                               └─ version-compatible guarded delta/index publication
                                           │
                                           ▼
AI read path: source-eligible vectors ONLY ─> ranked product IDs
                                           │
                                           ▼
EXPRESS resolves visible catalog products + current prices/availability
                                           │
                                           ▼
CUSTOMER: fast images, useful visual search, honest no-match/AI-down states
```

**Done means functional customer/admin outcomes, not simply a bucket created, a successful upload API or a passing mock.** Show a real change propagating through Storage, Prisma, storefront and AI retrieval using controlled, isolated integration evidence.

The initial delivery shall include a **usable media-only admin editing surface** on the existing admin architecture, while complete product descriptions/category/specification/pricing CRUD and general admin dashboard remain **Task 05.2**. Do not make 04.3 contingent on building the entire Task 05 admin system.

---

# 2. Explicit scope

## 2.1 In scope — all required

- Repository discovery and architecture/ADR for Storage provider choice and AI consistency strategy.
- Secure, repeatable QA configuration of a **Supabase Storage-compatible** backend (prefer real local Supabase Storage if supported; otherwise credential-free compatible fake plus reviewed real DEV smoke after permission).
- Dedicated public-delivery product media bucket `product-media` (proposed), environment-isolated, with backend-only mutations.
- Original/canonical image ingestion, optional predefined variants, CDN URL metadata, immutable revision/object names, object lifecycle and cleanup.
- ProductImage additive metadata, media state/search-eligibility metadata and durable transactionally produced outbox with retry/lease/idempotency.
- Express product-image management routes, validation, role checks, ownership/primary/order concurrency controls and admin indexing status.
- Minimal real admin media gallery editor, drag/drop/multi-file preview, upload, replace, remove, set primary/reorder, alt text, busy/errors and indexing state.
- Customer catalog detail, listing, search/discovery cards, cart/wishlist, order media continuity; accessible responsive rendering and missing media fallback.
- Revised trusted canonical-image resolver to support authorized Supabase Storage sources in **new ingestion/refresh workflows** without breaking existing `/images/...` legacy paths.
- **Transactional stale-vector ineligibility at the moment of replacement/deletion/visibility change** (not only asynchronous cleanup), followed by correct new-embedding publication using versioned source identity.
- Active+staging compatibility policy; protected AI reader, restricted media sync worker, fully auditable index freshness; **no automatic active-index pointer change**.
- Replay/repair/reconciliation jobs, retries, dead-letter diagnostics, negative security tests, fault injection and QA browser evidence.
- Docs, OpenAPI, environment example files (no real secrets), operating runbooks, migration and rollback instructions, evidence file and release handoff.

## 2.2 Out of scope — explicitly defer

- New ML encoder, D4 training, retraining thresholds, new classifier categories or benchmark tuning.
- Product personalization, “Recommended for You”, “Frequently Bought Together” or model-based recommendations (Task 04.4).
- Full admin product/category/brand CRUD, inventory and analytics dashboards (Task 05.2), beyond the media-specific minimum.
- Customer-generated images as permanently stored catalog content; user account avatars and order attachments.
- Bulk migration of all legacy images into Storage **unless separately justified, batch-reviewed and authorized**; baseline compatibility must work without forced move.
- Category cover (`Category.imageUrl`) and brand logo (`Brand.logoUrl`) migration unless explicitly approved as safe limited follow-up; audit and document.
- Unlimited video/360-degree media, arbitrary file formats, SVG uploads, dynamic user-defined transformations or speculative media CMS.
- New public FastAPI endpoints, public vector-schema access, unrestricted ingestion role grants, automatic model promotion, PROD changes/deployments.
- Rewriting checkout, payment, email, commerce recovery or redesigning the Discovery Console.

---

# 3. Front-loaded testable invariants

| ID | Invariant | Required evidence |
|---|---|---|
| M43-01 | Only live authenticated ADMIN may mutate a product's media; customers/anonymous are 401/403 | Express RBAC tests and real admin/customer requests |
| M43-02 | Every image belongs to a valid authoritative product; cross-product IDs are rejected | API/DB tests |
| M43-03 | Uploads reject over-limit bytes/pixels, malformed/truncated/polyglot content and unsupported formats | Decoder, multipart, memory abuse tests |
| M43-04 | No secret/service-role key, ingest DSN, source signed URL or raw image bytes in browser bundle/logs | Static/network/log inspection |
| M43-05 | Replacements use immutable Storage paths/revisions; users never see stale CDN cache after replacement | Live URL and browser tests |
| M43-06 | Supabase Storage + Prisma partial failures cannot create invisible permanent objects, false published references or lost change events | Fault injection + reconciliation |
| M43-07 | ProductImage existing IDs, API image fields and historical orders remain compatible | Migration + API + order snapshot tests |
| M43-08 | At most one published primary image per product under concurrent requests | DB invariant and concurrent mutation test |
| M43-09 | Source revision and digest are authoritative and atomically committed with media mutation/outbox | Transaction and race tests |
| M43-10 | A replaced, retired, deleted or hidden source ceases to contribute to visual-search ranking **immediately upon committed change** | DB reader integration test before worker runs |
| M43-11 | A worker crash, backlog or retry never re-enables a stale source | Lease/revision race tests |
| M43-12 | AI vectors have matching source digest/revision, **exact** model/preprocessing/embedding-space version and unit-norm dimension 256 | Integration assertions and descriptor tests |
| M43-13 | Non-STAGING base vectors, original ACTIVE/RETIRED versions and Candidate C data are not overwritten | Trigger/role negative tests and before/after fingerprints |
| M43-14 | New/changed supported images become searchable after worker processing, without active pointer promotion | QA E2E proof or explicit Architect-approved safe snapshot-refresh design |
| M43-15 | Upload success, image publication and AI indexing success are distinct observable states | API + UI state tests |
| M43-16 | Failed indexing cannot block cart, checkout, text search, payment or product page access | AI-down/worker-down tests |
| M43-17 | QA, shared DEV and PROD never share unrestricted storage or migration credentials | Config/preflight tests |
| M43-18 | Deleted/retired image objects are removed only after reference/retention/recovery checks | Orphan cleanup tests |
| M43-19 | Media UX works at mobile/tablet/desktop, 200% zoom, keyboard, reduced motion and screen readers | Playwright + component accessibility tests |
| M43-20 | Existing Task 04.2 upload/camera/no-match behavior remains functional; query images are not catalog uploads | Browser regression |
| M43-21 | PROD migration/deployment cannot be inadvertently triggered by task validation or unreviewed merge | Workflow and release preflight record |
| M43-22 | No unsupported claims of live DEV/PROD operation, AI accuracy or storage transformations | Evidence with actual IDs/counts/run results |

**Critical blocker:** M43-10 must not be deferred. A feature that uploads files while continuing to rank obsolete deleted/replaced vectors is not complete, regardless of other checks.

---

# 4. Product media lifecycle and canonical identity

## 4.1 Three independent identities

A catalog-image search representation belongs to:

`(productImageId, sourceRevision/sourceSha256, embeddingVersion)`.

- `ProductImage.id`: stable logical gallery slot and product ownership. Replacement retains it.
- `sourceRevision`: immutable content revision identifier for that slot; each replacement is a new source, even with the same display name. `sourceSha256` is computed from **the actual canonical bytes used for AI**.
- `embeddingVersion`: complete encoder + preprocessing + embedding-space identity; a matching 256-element length alone does not prove compatibility.

For an image replaced from revision A to B, the display URL moves to a new immutable Storage object. **Revision A becomes AI-ineligible atomically with the catalog update**, even if revision B's embedding is pending. A worker subsequently encodes B; an out-of-order A job cannot replace it.

## 4.2 Asset states and separate status dimensions

Propose explicit, finite state machines (names adaptable to repo conventions):

- **Media**: `PREPARED/UPLOADING` (not public reference) → `PUBLISHED` → `RETIRED` / `DELETE_PENDING` → `PURGED`; failures must be observable, and the DB must not claim publication before object existence is confirmed.
- **Index** per image/revision/embedding version: `NOT_ELIGIBLE`, `PENDING`, `PROCESSING`, `INDEXED`, `RETRY_WAIT`, `FAILED_PERMANENT`, `STALE`.
- Public media success and index success are different; e.g. published image displays immediately while `Index pending` is shown to admins.

Avoid a user-facing success message claiming “AI searchable” before the appropriate vector is verified.

## 4.3 Example transitions

| Admin/catalog operation | Storage | Prisma + durable event | Search eligibility / AI action |
|---|---|---|---|
| Add image | Upload unique canonical source + optional variants | Insert ProductImage/media metadata and `IMAGE_ADDED` event in transaction | New photo pending and **not searchable** until exact digest's vector published |
| Replace | Upload **new unique path**, verify; keep old bytes temporarily | Update same image ID to new path+revision; insert `IMAGE_REPLACED` | Old digest excluded synchronously; regenerate new compatible vectors |
| Remove | Soft-retire gallery record (or controlled tombstone) | `IMAGE_RETIRED` event; preserve ownership/tombstone until index cleanup | Exclude immediately; worker retires versioned overrides; later safe Storage garbage collection |
| Set primary | No binary change | Adjust flags/ordering transactionally; `MEDIA_METADATA_CHANGED` if needed | No re-encode; check any primary-weight search logic |
| Reorder | No binary change | Update deterministic `sortOrder` atomically | No re-encode |
| Alt text | No binary change | Update validated string | No re-encode unless a future model explicitly uses metadata |
| Product visibility / category active state | No binary change | Produce or derive eligibility change consistently | Exclude invisible products before AI ranking; re-include eligible matching vector only when source current |
| Re-upload identical bytes | Treat as explicit decision: deduplicate safely only if ownership/revision semantics preserved | Idempotency key + digest | No duplicate vectors; preserve freshness evidence |

## 4.4 Historical order continuity

`OrderItem.productImageUrl` is a purchase-time historical snapshot. Existing order invoices, emails and order-detail displays must not break if current ProductImage is replaced or retired. Audit where URLs point: immutable referenced objects require documented retention (minimum until the historical order retention policy allows archival) or a durable archival/copy/fallback policy. **Never blindly purge an object referenced by an order snapshot.** Replacing a catalog photo must not alter historical purchase facts.

---

# 5. Supabase Storage implementation

## 5.1 Environment/bucket design

- **Proposed name:** `product-media` in each **separate** Supabase project. Same bucket name is safe across different projects; separate project identity is mandatory.
- Published customer-visible images may use a **public-read** bucket; it does **not** mean public write. For unpublished review/pending imagery, use a protected private bucket or keep it unreferenced until publish; choose one and test it.
- Use **backend-managed upload** for the first delivery. Browser → Express multipart → verified normalization → Storage API → authoritative Prisma reference. Signed browser-direct upload/TUS are optional future enhancements requiring independent ownership verification.
- Do not request unrestricted Storage SDK access from the frontend. A server-only storage provider secret/key has high privilege (service-role keys bypass Storage RLS); protect it as such; restrict it to backend processes, bucket allowlists, explicit media API authorization and environment identity preflights.
- Supabase bucket-level allowed MIME/size checks supplement, never replace, backend content-validation checks.
- Never insert/update/delete `storage.objects` manually through Prisma/SQL; use the Storage API, and isolate schema changes from Storage operations.

## 5.2 Immutable path naming

Illustrative object key (backend generated, not supplied by a client):

`products/<product-uuid>/<image-uuid>/<revision-uuid>/original.webp`

Additional predictable static variants can live under the same revision, e.g. `card-480.webp`, `detail-1200.webp` (actual sizes after inspecting UI requirements). Do not upsert old immutable paths; new bytes mean new revision. Validate URL/domain/bucket from trusted configuration and reject traversal, encoded separators, mixed encodings, Unicode tricks, arbitrary origins and `../` segments.

`ProductImage.url` remains the safe public delivery URL. Store exact provider, bucket and object key in dedicated fields; do not reverse-parse public URLs for permission decisions. Stable logical ID + revised immutable path solves CDN stale-on-replace behavior.

## 5.3 Upload validation and normalization

- Proposed **initial** accepted input: JPEG, PNG, WebP. Reject SVG, GIF animations, HEIC, PDF, video and other types pending a reviewed expansion.
- Proposed request limits (verify actual frontend/device, network and plan constraints): **≤6 MiB input per image, ≤20 million decoded pixels, ≥128×128, ≤6,000 px each dimension, ≤8 images/product**. These are starting policy values, not existing guaranteed limits; make them centralized and testable. Confirm existing 412 image count and per-product gallery distribution before setting a hard cap that would reject legacy rows.
- Validate MIME, magic signature **and safe actual decode**; reject truncated/inconsistent/polyglot files and decompression bombs. Strip EXIF/location metadata and dangerous metadata, correct orientation, prevent unbounded buffers, choose deterministic WebP/JPEG normalization for canonical bytes, and cap conversion CPU/memory.
- Use a well-maintained server image library such as `sharp` **only if not already installed and justified**, pin/lock dependencies and avoid re-implementing codecs. Validate output bytes again and hash the **canonical post-normalization** bytes. Respect transparency and accurate colors; don't trim product silhouettes arbitrarily.
- Original filename only for audit label after sanitization if needed; never use it in a Storage key or returned shell/path.
- Enforce request budgets, total multipart size, file count, rate limits, upstream timeout/circuit breaking and abort cleanup. Never rely on a JavaScript client `accept` attribute as security.

## 5.4 Image variants, CDN and cost

- Frontend uses `loading="lazy"`, width/height/aspect-ratio to avoid CLS, correctly chosen `sizes`/`srcset` if variants exist, adequate alt text and an accessible missing-image placeholder.
- Product cards preserve the full silhouette with `object-fit: contain` where appropriate. Do not crop away device details; detail pages can allow zoom.
- Supabase on-the-fly Storage image transformations may be **Pro-plan or higher**, and quota/billing constraints apply. **Inspect the project's actual capability and pricing**; do not make paid transforms a dependency of basic storefront. If unavailable, pre-generate/retain static size variants during upload, or use the canonical optimized image with responsive CSS as a documented fallback.
- Use appropriate immutable-object caching and CDN behavior; changes use new keys, not cache-busting query strings on overwritten bytes.
- Track storage bytes, egress, transform usage, missing objects, cold caches, orphan counts and storage errors. Do not log signed URL tokens.

## 5.5 Storage/Prisma consistency and cleanup

Storage and PostgreSQL **do not share a transaction**. Design a recoverable saga:

1. Authorize/validate; reserve a stable mutation ID/idempotency key.
2. Upload to unique unreferenced Storage path; verify object existence, size/digest (and delivery format where applicable).
3. Commit `ProductImage` metadata, authoritative source state and outbox row in **one** Prisma transaction.
4. On DB failure, mark/upload object for safe orphan cleanup or delete if no references; never claim success or create duplicate media slot on retry.
5. On worker failure, keep PUBLISHED image and durable pending sync event; retry according to policy.
6. On replacement/removal, retain old object until snapshots, TTL, rollback and historical-order dependencies allow retirement.
7. Periodic reconciler compares Storage object inventory ↔ DB references ↔ pending/retired/snapshot states; **dry run** before deletion. Recheck references under concurrency before actual removal.

Define explicit behavior for crash after Storage PUT, crash before DB commit, lost HTTP response, duplicate idempotency key, concurrent replace/delete and Storage DELETE failure. Each must have a test and observable diagnostic.

---

# 6. PostgreSQL/Prisma schema and migration strategy

## 6.1 Extend existing ProductImage — additive and backward-compatible

Recommended **conceptual** optional fields (final names/types after code inspection):

| Field | Type suggestion | Purpose |
|---|---|---|
| `storageProvider` | enum/string `LEGACY_LOCAL` / `SUPABASE_STORAGE` / `EXTERNAL` | Legacy-safe asset routing |
| `storageBucket` | nullable string | Strict bucket ownership |
| `storagePath` | nullable unique string per environment/revision | Exact immutable provider key |
| `sourceRevision` | nullable UUID/string | Current canonical source generation |
| `sourceSha256` | nullable 64-char digest | Canonical current bytes |
| `sourceMimeType`, `width`, `height`, `byteSize` | nullable metadata | Delivery/validation/diagnostics |
| `mediaState` / `retiredAt` | state + nullable timestamp | Avoid physical FK cascade to AI on immediate remove |
| `sourceProvenance` / `usageRights` | small audited metadata or associated record | Distinguish licensed/owned/AI-generated imagery; don't imply ML-training rights |

**Existing `url`, `publicId`, `sortOrder`, `isPrimary` and legacy image records must keep working.** Do not reinterpret `publicId` without auditing use in code and seeded fixtures. `url` remains a valid display field for legacy API clients. Expose only required public fields and preserve existing TypeScript ProductImage DTOs.

Where necessary, add a distinct app-owned `CatalogMediaSourceState` / `CatalogMediaEvent` table, but **not** a second catalog-image table. Only add schema objects that serve a demonstrated integrity or reliability requirement.

## 6.2 Durable outbox (required)

Proposed `CatalogMediaEvent` fields (adapt to Prisma naming conventions):

```text
id UUID PK
idempotencyKey UNIQUE
productId UUID
productImageId UUID
operation ENUM(ADDED, REPLACED, RETIRED, ELIGIBILITY_CHANGED, RECONCILE)
sourceRevision UUID/String nullable
sourceSha256 CHAR(64) nullable
embeddingTargets / policy reference (version-aware)
state ENUM(READY, CLAIMED, RETRY_WAIT, COMPLETED, PERMANENT_FAILURE, SUPERSEDED)
attemptCount, nextAttemptAt, claimedUntil, leaseToken
createdAt, updatedAt, completedAt, lastErrorCode
```

- Insert the event inside **the same Prisma transaction** as the image metadata and current AI eligibility state; if event insertion fails, image state cannot commit independently.
- Stable idempotency keys reject mismatched replays, dedupe duplicate network submissions and allow bounded retries.
- Worker claims events with DB leases/`SKIP LOCKED` where appropriate; acknowledge only current lease holder. Duplicate delivery is allowed; **exactly-once execution is not assumed**.
- Backoff with jitter, max attempt/age, permanent failure visibility, manual requeue when safe, operator metrics and periodic reconciliation.
- An older revision event must be recognized as `SUPERSEDED` and must never re-enable or overwrite a newer revision. Re-read current product/media state before and **immediately before** write publication using a compare-and-swap guard.
- Do not send arbitrary raw image bytes or customer PII through the event table.

## 6.3 Primary/order concurrency and constraints

- Enforce at most one `PUBLISHED AND isPrimary` media image per product (e.g. partial unique index reviewed as PostgreSQL migration where Prisma alone lacks representation). Select/design a consistent primary after deletion; no accidental zero-primary when alternatives exist unless explicitly allowed.
- Transactionally serialize mutations for the same product/image (row locks/advisory lock if justified), then normalize dense or stable ordering; deterministic tie-break by image ID.
- Verify foreign key ownership in the mutation itself, not only front-end state; route must reject attempts to move/delete another product's image.
- Database indexes for common image listing, outbox claim/due work, revision ownership and Storage uniqueness; avoid redundant indexes.
- Ensure no cross-environment values or reusable public object paths are stored unintentionally.

## 6.4 Source-state/AI-read compatibility (required design work)

The existing `ai.product_image_embeddings` has `(embedding_version, product_image_id)` primary key with `image_sha256`. Its `product_image_id` foreign key can **cascade-delete rows from every version** if a ProductImage is physically removed. The current read query does not check current source digest or deletion eligibility, and the existing ACTIVE count-check expects its recorded rows.

A naive `ProductImage` DELETE or URL replacement therefore can silently affect archived vectors, trigger readiness failures or keep stale matches. **Do not rely on asynchronous delete alone or on Express filtering by product ID**: a product can remain visible while its photograph changes.

Task 04.3 must design and implement a **transactional, narrow, source-revision-aware eligibility representation** that the **reader** consults. One viable design to evaluate:

- An app-owned table such as `public.catalog_media_search_state` stores `(productImageId, productId, currentSourceRevision, currentSha256, eligible, updatedAt)`, updated in **the same Prisma transaction** as `ProductImage` and the event. Grant `ai_vector_reader` read access only to a narrow approved view/table, never unrestricted commerce tables or public API roles.
- The nearest-neighbor query joins each candidate vector to a current-source eligibility row and requires **matching productImage ID, product ID and canonical digest** (or an explicitly proven equivalent revision mapping), plus current public-visibility eligibility. A change to source/visibility makes older vectors ineligible as soon as the transaction commits.
- Keep a soft-retired ProductImage tombstone until vectors and order/history constraints are reconciled, rather than deleting it and allowing a cascade across immutable model versions.
- Legacy current images require a controlled **backfill of canonical source SHA** matching the existing vector source digest. Gate rollout must be **backward-compatible** and must not make all 412 existing D3 rows vanish without proof of backfill.

The final design may use a narrow `ai` security-barrier view, application-owned public state, transactionally maintained tombstones or an equivalent **audited** mechanism. Explain authorization/grants, RLS/exposure, SQL transaction isolation and stale-window proof. Do not create a broad `SECURITY DEFINER` function, grant broad `public` SELECT to the AI reader, or expose `ai` through PostgREST simply to make joins work.

## 6.5 Versioned search publication (do not handwave)

The current `ai_vector_ingest` role is blocked from modifying non-STAGING `ai.product_image_embeddings`. A new admin upload **must not violate that guard** or write directly to ACTIVE rows.

Choose and prove **one** of these patterns before finalizing schema:

**Preferred for real incremental behavior (if safe): version-scoped, revision-checked search overlay.** Maintain immutable base ACTIVE/STAGING snapshots; introduce a narrowly privileged, independent `media` delta/overlay table storing only validated `(embedding_version, imageId, revision, sourceDigest, vector)` for image changes. An authorized worker with *restricted overlay-only* write privileges produces compatible 256D vectors; reader SQL selects the latest eligible overlay where present and otherwise eligible base vector, excluding mismatched source digests. Eligibility updates commit with catalog changes. Active pointer and immutable base snapshot remain untouched. The loader/readiness/index SQL and every model version's overlay must be tested together. A separate schema/role/trigger/DB migration and safe rollout are required; avoid granting `ai_vector_ingest` ACTIVE-base rights.

**Alternative for lower concurrency, if explicitly justified:** rebuild a complete **new compatible staged snapshot** and perform a reviewed/coherent index+descriptor activation with rollback. This is simpler at ~412 baseline images but **cannot satisfy fully automatic incremental publication without a safe, authorized promotion strategy**. If chosen, state that limitation clearly, deliver immediate stale-source exclusion, and obtain Architect approval of the revised acceptance contract before claiming M43-14 passes.

Guard both designs against concurrent model promotion, overlay supersession, index availability and unexpected image counts. A descriptor/version must represent the **exact** embedding space; D3's active model is not interchangeable with Candidate C or retired commons. Do not insert a new model's vectors into another version's table.

## 6.6 Migration and backfill choreography

1. Design additive Prisma migration(s) for product media/outbox/status and narrow SQL migration(s) for any AI reader/overlay roles/views, with reviewed grants and down/rollback mitigation. Never edit previously applied Task 04.2 migration files.
2. First exercise migrations from a clean baseline on disposable PostgreSQL/Supabase-compatible QA; run Prisma generate, schema validation, migration replay, SQL role/trigger/readiness and rollback simulations.
3. Add fields nullable/default-compatible with legacy rows. Keep API projections and current D3 retrieval unchanged until backfill/reader gates are verified.
4. Backfill current legacy media source digests from **verified original files** in a separate controlled job; do not run image decoding or remote Storage operations inside schema migrations.
5. Verify media state exactly reconciles all currently eligible images; compare D3 ACTIVE and Candidate C fingerprints, AI queries and readiness **before and after enabling the new guarded reader**.
6. Enable source-aware query/overlay via versioned rollout flag only after completeness and role tests pass. Guard negative/partial states fail closed for mutated images, not silently yield stale results.
7. Deploy worker/adapter, then media UI/API after safe schema and reader. Keep customer commerce operational throughout.
8. Shared DEV migrations, bucket creation and backfill require a **separate scoped owner authorization** with exact project identity, pre/post evidence and rollback. PROD is a separate release; no silent automatic deployment from this spec.

Migrations **never** rewrite `_prisma_migrations` history, delete old vector snapshots or reuse QA product UUIDs in DEV/PROD.

---

# 7. Express backend/API design

## 7.1 Service boundaries and files

Adopt existing project layout:

```text
apps/backend/src/routes/product-media.routes.ts       # proposed, mounted under /api
apps/backend/src/controllers/product-media.controller.ts
apps/backend/src/services/product-media.service.ts
apps/backend/src/integrations/storage/product-media.storage.ts
apps/backend/src/services/catalog-media-events.ts
apps/backend/src/services/catalog-media-worker.ts
apps/backend/src/services/catalog-media-reconciler.ts
apps/backend/src/validators/product-media.validator.ts
apps/backend/src/docs/swagger/product-media.openapi.ts
```

Names are proposals; **inspect the repo first** and reuse auth/validation/error envelope, logging and OpenAPI conventions. Keep Storage SDK code behind a typed adapter; make it injectable/fakeable in tests.

Existing `multer` may be reused if appropriate; customer image-query upload middleware's policy/limits must not be used blindly for permanent catalog assets. A server-only Supabase Storage client must be isolated from Prisma and the AI vector reader/ingest clients.

## 7.2 Proposed HTTP contracts (adjust naming only for consistency)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/products/:slug/images` or use existing product detail payload | Public, product visibility rules | Current published gallery, ordered |
| `GET` | `/api/admin/products/:productId/images` | ADMIN | Full gallery and media/index states |
| `POST` | `/api/admin/products/:productId/images` | ADMIN | Upload multipart image(s); validate, store, attach; idempotency |
| `PUT` | `/api/admin/products/:productId/images/:imageId/file` | ADMIN | Replace source, same logical ID, new immutable revision |
| `PATCH` | `/api/admin/products/:productId/images/:imageId` | ADMIN | Alt text, primary, order/state (whitelisted fields only) |
| `DELETE` | `/api/admin/products/:productId/images/:imageId` | ADMIN | Soft-retire, immediate visual-search exclusion; asynchronous GC |
| `GET` | `/api/admin/products/:productId/image-index-status` | ADMIN | Per-image per-version indexing progress and safe status |
| Internal | Job status/requeue/reconcile command | restricted worker/operator only | Retry/reconcile failed work, never public upload endpoint |

Do not create redundant public gallery endpoints if existing `/api/products/:slug` fully covers customer needs. Use `:productId` as canonical admin identity after checking existing admin/API conventions. **Never authorize by an untrusted image URL, bucket name or client-supplied product ID in a JSON body when the route identifies the parent.**

### Illustrative upload request

```http
POST /api/admin/products/<product-uuid>/images
Authorization: Bearer <admin-jwt>
Idempotency-Key: <stable-client-mutation-uuid>
Content-Type: multipart/form-data; boundary=...

files=<image data>; altText="Front view"; isPrimary=false
```

- Support safe, bounded multi-file upload with clear partial-result semantics; if using one-file-per-mutation, the UI may upload sequentially and report per-file results. Avoid fake all-or-nothing guarantees across Storage and Postgres.
- `201 Created` or appropriate consistent envelope only after authoritative DB publication; response includes canonical `ProductImage` ID, public URL, current source revision, index status (`PENDING`) and server-chosen metadata.
- A pending AI job is **not** a failed catalog upload. `202 Accepted` may be appropriate if final image publication is asynchronous; specify precisely.

### Illustrative response envelope

```json
{
  "data": {
    "id": "uuid",
    "productId": "uuid",
    "url": "https://<project>.supabase.co/storage/v1/object/public/product-media/...",
    "altText": "Front view",
    "sortOrder": 2,
    "isPrimary": false,
    "sourceRevision": "uuid",
    "mediaState": "PUBLISHED",
    "indexing": { "state": "PENDING", "embeddingVersion": "<active-version>" }
  }
}
```

This contract is **proposed**, not a claim that the endpoint exists. Do not expose internal object permissions, embeddings, signed download tokens, administrative diagnostics or storage credentials.

## 7.3 Errors and HTTP semantics

Use existing `AppError`/request ID/error conventions: 400 malformed metadata; 401 unauthenticated; 403 not ADMIN; 404 product/image absent or unauthorized resource indistinguishability when appropriate; 409 concurrent revision/idempotency/primary invariant; 413 too large; 415 unsupported signature/type; 422 cannot decode/dimensions; 429 throttling; 503 Storage temporarily unavailable; 500 unexpected safe error. Ensure invalid images never leave published DB rows. Rate limits and timeouts should prevent abusive multi-file floods.

Use `If-Match`/version or equivalent optimistic concurrency for replacement, primary/order and deletion. Prefer stable API error codes that the UI can map to actionable messages. Respect aborts/disconnects and never log multipart bodies.

## 7.4 Backend-mediated security

- Verify ADMIN via live DB-backed role and active account; frontend auth is UX only.
- Explicit allowlisted files and validated Storage object keys; ignore arbitrary client bucket/path/URL.
- Prevent SSRF: worker may read only trusted storage bucket+key derived from DB, and checked legacy relative paths. Deny user URLs, IP literal redirects, credentials in URL and private network destinations.
- Storage client creds are server-only; backend's generic DB secret **must not** become a Storage upload key; `AI_VECTOR_INGEST_DATABASE_URL` must not be exposed to web routes.
- Restrict CORS to approved frontends and storage origins for public media only; avoid permissive cross-origin credentials.
- Prevent browser HTML/SVG execution, multipart parser abuse, zip bombs, EXIF GPS leaks, SQL injection and unsafe file handling.
- Handle a revoked ADMIN role between initiating and finalizing an upload; check authorization before commit.
- Support audit events for product/image/action/actor/time without file bodies or sensitive tokens.

## 7.5 Operational runtime

Keep image-processing CPU and Storage network calls out of long DB transactions; transactions contain only bounded DB writes. Worker is an **independent, supervised process/mode** consistent with existing outbox patterns, with startup readiness, health, metrics and graceful shutdown. Avoid launching an unbounded task within each HTTP request. Define retry budgets, queue lease timeout, priority, max concurrent encodes and backpressure for CPU inference; preserve request capacity for real-time photo search.

---

# 8. FastAPI + pgvector synchronization design

## 8.1 Zero-training rule; exact artifact

Task 04.3 reuses **approved existing model** and preprocessing for each version. Shared DEV currently reports D3 ACTIVE; verify live descriptor before processing. The historical EfficientNet model is RETIRED, Candidate C STAGING. Do not assume the artifact is loaded just because a database row exists; do not silently reuse D3 vectors for EfficientNet or vice versa.

The indexing worker must securely obtain the canonical image bytes **as currently published**, compute/verify SHA-256 and perform preprocessing with the exact registered artifact and input policy. Prefer an authenticated internal encode interface or a separately authorized offline worker, without exposing FastAPI or vector credentials publicly. Do not create a public `POST /embed` endpoint or reuse customer-image search for catalog ingestion without proper private service boundaries.

## 8.2 Version targets

- **ACTIVE D3:** critical version for customer correctness. Refresh matching source revisions using the chosen guarded overlay/shadow scheme, with no ACTIVE-base writes or pointer changes.
- **STAGING Candidate C:** never auto-activate. Define a deliberate maintenance policy: either keep compatible staging images synced using Candidate C's exact artifact and restricted staging writer, or mark stale/incomplete and require a verified full rebuild before it can be promoted. Do not report Candidate C as ready if it contains old source hashes.
- **RETIRED commons:** preserve for rollback with clear limitations. When catalog images change, retired snapshot relevance/eligibility must be reconciled before an operator can safely roll it back; returning an older model does not entitle it to obsolete images. Do not overwrite its historical vectors.
- **Future versions:** a new model descriptor must be registered and staged by the existing authorization flow. Media sync must never silently create/activate arbitrary embedding spaces.

## 8.3 Safe worker processing sequence

```text
Claim CatalogMediaEvent with bounded lease
  -> Load current media state + product eligibility
  -> Reject SUPERSEDED event if revision/digest mismatch
  -> Read only approved Storage object or verified legacy path
  -> Decode/check actual source digest
  -> Resolve exact eligible model descriptor, weights and preprocessing
  -> Encode on bounded worker pool; validate 256D, finite and normalized
  -> Re-read current revision/product visibility and expected embedding version
  -> CAS write guarded delta or staging vector according to authority
  -> Read back published row/source digest to verify
  -> Mark event COMPLETED (lease token + idempotency)
  -> Notify admin status; update lag/metric
```

For retirement/deletion/visibility change, immediate eligibility exclusion must occur **at the Prisma commit**; workers perform cleanup/reconciliation later. An unavailable FastAPI or Storage service should show indexing pending/failure, never a fake success; underlying catalog browsing and text search remain healthy.

## 8.4 Race cases and failure modes (mandatory)

- A→B→C rapid replacement, where A's encode finishes last: A must never publish over C.
- Two simultaneous admins set primary or replace same slot: exactly one accepted revision transition and correct primary invariant.
- Event claimed, worker crashes after encoding but before ack: idempotent replay resumes without duplicate active overlays.
- Storage object deleted before retry: permanent/repairable error surfaced, not silent mismatch.
- Product becomes hidden during encode: no search eligibility even if vector exists.
- Media removed during image-search read: query's committed-snapshot semantics are defined; subsequent reads exclude it.
- Embedding model changes during processing: fail/requeue for exact version, never publish to unrelated ACTIVE space.
- CPU overload or FastAPI outage: bounded queue and no effect on commerce availability.
- Catalog revision backfill incomplete: launch flag remains off; no mass disappearance of current D3 matches.
- Retired rollback candidate misses media updates: readiness must reflect freshness and block unsafe rollback/promotions.

## 8.5 Readiness and observability

Existing FastAPI `PgVectorGateway.is_ready()` checks ACTIVE model identity and total snapshot count. Preserve that baseline invariant, but add overlay/source freshness diagnostics so **"ready" cannot be used as proof every current catalog image is indexed**. Define separate statuses for base snapshot compatible, eligible image coverage, overlay lag, stale exclusions and worker health. Ensure the actual query's source constraints and status endpoint report consistent version identity.

Monitor: outbox pending oldest age, retry count, blocked/failed counts, eligible images missing vectors, stale-vector exclusions, catalog-vs-Storage drift, current index source checksums, read/write errors, worker throughput, encoding time, memory/CPU and media delivery failures. Log safe IDs/counters only.

---

# 9. Frontend and customer experience

## 9.1 Admin media editor — required minimal product-specific functionality

Integrate a route/component inside the existing admin architecture, for example `AdminProductMediaPage` or a media panel accessible to authorized admins, not an unrelated new admin app.

Design language: existing ElectroHub Poppins, SCSS Modules, token colors, responsive spacing, shared Buttons/Input/Alert/Dialog/Toast and Figma references where applicable. Clean premium e-commerce management UX, consistent with full admin product management planned for 05.2.

**Feature behaviors**:

1. Select a real product from an admin-safe picker or navigate directly by product ID.
2. Display existing images in correct order with thumbnail, alt text, primary badge, current publication/index status and accessible empty/loading states.
3. Drag and drop or file picker for single/multiple images; client previews using scoped object URLs; show type/size checks but always trust server validation.
4. Upload with visible per-file progress or pending state, success/error/retry (never fake completion). Cancellation cleans local object URLs and aborts when feasible.
5. Replace any owned image with before/after preview; preserve logical ID; show when AI indexing is pending.
6. Set primary photo; reorder with keyboard-accessible controls (up/down if drag reorder is not fully accessible), deterministic persistence; edit alt text.
7. Remove image only after clear confirmation; handle last-image and primary-image cases coherently, with undo only if actually supported.
8. Show separate `Image published` and `AI indexing pending/indexed/failed` states; do not block storefront publication during worker outage.
9. Show clear error guidance: wrong format, corrupt file, too large, unauthorized, deleted product, concurrent update, bucket offline, AI outage.
10. Support real small screens, tablet, desktop, 200% zoom, high contrast, reduced motion, visible focus, screen-reader live regions, no clipped controls.

Use the existing API client and TanStack Query mutations; invalidate/refetch correct product list/details/search caches after media mutation. Do not force app reloads. Keep legacy product DTO fields stable; admin-only metadata types should not leak into customer JSON unnecessarily.

## 9.2 Customer storefront media integration

Audit actual UI consumers rather than only `ProductCard`: products/deals/category/brand listings, product details/zoom/gallery, global text/image search cards, cart, wishlist, checkout, saved purchases, order detail, email/PDF order images, and recommendation placeholders where applicable.

Existing images from `/images/...` continue to render. New Supabase public HTTPS URLs render with correct CSP/image-src configuration (verify current Helmet and frontend build policy), adaptive sizes, `object-fit` semantics and graceful broken-image fallbacks. Loading states should not cause excessive CLS. New image URLs must not break related product caches or cause cross-product image bleed.

Order history has immutable purchase-time image URLs; keep old objects/archived representation available or use a documented fallback—not rewriting historical orders as if they were current catalog entries.

## 9.3 Preserve Task 04.2

The current Discovery Console upload, paste, drag/drop, camera, retake/cleanup, no-match explanation and model-version checks remain unchanged. Customer query images remain transient, private and do not become `ProductImage` rows. A new catalog photo should not require retraining D3; it should trigger the compatible indexing path. Under AI outage, text search and commerce continue.

---

# 10. Security threat model and permissions

| Threat | Required behavior / verification |
|---|---|
| Anonymous/customer attempts admin upload/delete | 401/403 before Storage or DB mutation |
| ADMIN revoked, account disabled or wrong product | Reject at authorization/commit boundary |
| Client supplies Storage path to overwrite another product | Ignore/reject; generate trusted immutable keys |
| Browser receives backend Storage key or vector secret | Build/network inspection rejects any exposure |
| Service key bypasses RLS | Treat as privileged backend secret; explicit bucket/key allowlist + server RBAC + env isolation |
| Fake JPEG/SVG/script/polyglot | Content sniff, safe decode/re-encode, strict allowed formats |
| Decompression bomb/huge image | Byte, pixel, memory, CPU and concurrency limits |
| Malicious remote image URL/redirect | No arbitrary URL ingestion; approved Storage and legacy local paths only |
| Stale retry or duplicate event | Source revision CAS + idempotency + lease-token checking |
| Forced Active vector UPDATE by ingest user | Existing staging trigger and negative SQL tests block |
| Unauthorized AI reader access to commerce/PII | Narrow SELECT only; private AI schema; no public API exposure |
| Public image URL mistaken for public mutation right | Public read only; all mutation endpoints RBAC |
| Leakage from logs/reports | No images, EXIF GPS, passwords, DSNs, Storage token or vectors logged |
| Shared DEV/PROD credential confusion | Exact project identity check before each connected operation |
| Deleting media referenced by orders | Retention/reconciliation before GC |
| Unknown source provenance | Record source/rights; no assumption of ML training license |

Use secure secret injection: backend Storage provider credential, Prisma DB URL, AI reader/ingest and media worker credentials are **separate authorities**. Never store secrets in `VITE_*`, browser code, Git, test reports or plaintext screenshots. The only browser-safe values are public asset URLs and approved publishable parameters as justified.

An image that is publicly accessible in a Storage bucket can be viewed by anyone with its URL. Do not place private/sensitive/unapproved media in the public bucket. Before browser publication, audit moderation/rights requirements proportionately to the product catalog.

---

# 11. Tests, tools and QA strategy — concrete expected evidence

Use the tools actually installed in the monorepo; do not create an elaborate new test framework. Baseline tooling confirmed:

- **Frontend:** React/Vite/TypeScript; Vitest + Testing Library; Playwright for real browser; ESLint; Storybook visual/a11y where useful; TanStack Query; existing Figma design assets.
- **Backend:** Node/Express/TypeScript; Vitest + Supertest; Prisma Client/migrate; existing `multer`/validation; isolated PostgreSQL scripts and seeded fixtures; typecheck/build/lint.
- **AI:** Python 3.11+, pytest, Ruff, mypy (strict), existing FastAPI/pgvector integration tests; optional real local inference with **verified** D3 artifact.
- **Infrastructure:** Disposable PostgreSQL/pgvector, Docker, Supabase Storage emulator/local stack if available; deterministic Storage adapter fake for fault injections; migration replay; SQL role tests; GitHub Actions CI safe jobs.
- **Operations/quality:** Storage object manifest and digest checker; queue lag/reconciliation report; HTML/HTTP and screenshot evidence; sanitized logs; repository diff review.

## 11.1 Unit/API matrix

| Layer | Required cases |
|---|---|
| Auth | Anonymous/customer/nonactive user denied; valid admin only; cross-product image ID refused |
| Validator | MIME/signature/decode/size/pixel limits, EXIF stripping, malicious/truncated file, duplicate form parts |
| Storage adapter | Upload verified, object exists, provider rejects, timeout, orphan cleanup, no upsert overwrite |
| Prisma lifecycle | Add/replace/retire/primary/order/alt text, transaction rollback, idempotency, optimistic conflict |
| Outbox worker | Claim/lease, crash recovery, duplicate event, out-of-order A/B/C, retry/dead-letter, false completion prevention |
| Search eligibility | Immediate exclusion after commit on replace/retire/visibility, old digest cannot rank, new digest eligible after encoding |
| AI model/version | Wrong descriptor/dimension/hash rejected; staged vs active vs retired; version switch during work |
| Catalog mapping | Correct product IDs, no QA/DEV UUID reuse, current prices/availability from Express |
| Backfill/migration | Legacy fields survive, SQL migration replay from clean DB, primary unique constraint, source eligibility complete |
| Source-rights | Legacy external/illustrative media not mislabeled as authorized training photographs |

## 11.2 Real integration tests (not just mocks)

- Run SQL migration in isolated database and execute role/trigger tests with the same least-privilege grants as intended production.
- Use local Supabase Storage or approved disposable provider namespace to upload/call public object URL; verify actual returned bytes/digest/size, storage delete semantics and lifecycle. If a fake adapter is used for unit tests, **also** require one real Storage integration smoke before claiming Storage integration complete.
- Execute canonical image mutation → Prisma commit+outbox → AI eligibility gate → worker encode/retry → version-correct vector → real FastAPI nearest query → Express current product projection. Verify source digest after every step.
- With worker stopped, replace photo A with B. Search must stop returning stale A immediately; B must become eligible after worker resumes, **without a D3 active-pointer change** if overlay design selected.
- With Storage unavailable, upload returns a safe state and DB remains consistent; with AI unavailable, storefront photo still shows and indexing remains pending.
- Run two replacements concurrently and while a model/index version activation is simulated (in disposable QA only); assert no mixed model/version or stale revision is served.
- Test `ProductImage` soft-retire so preserved RETIRED/ACTIVE/STAGING vector rows are not accidentally cascaded away. Verify old version fingerprints/row totals and explicit readiness diagnostics.
- Verify a historical order snapshot image continues to display after catalog replacement or deletion.
- Test GC dry run and safe deletion of a true unreferenced object; verify **no** deletion of a referenced order object.

## 11.3 Real frontend/browser smoke

- Actual logged-in ADMIN visits media editor; uploads photo, sees thumbnail and index pending, replaces and sees a changed immutable URL; reorders, sets primary, edits alt text, removes with confirmation.
- Anonymous and customer user cannot access media mutations through UI or direct API.
- Customer product cards/details/category/search show the updated image, including responsive/fallback states; cart/wishlist/order images still work.
- Image search query against newly indexed source returns coherent catalog products; pending/stale source cannot appear; query photo is not persisted.
- Browser width checks: narrow mobile, tablet, desktop; keyboard-only primary/reorder, focus return, 200% zoom, reduced motion and assistive text.
- AI-down and Storage-down partial failure flows display truthful guidance; conventional search/checkout unaffected.

## 11.4 Test execution guidance

Run proportionate commands after verifying current package scripts:

```bash
# Backend (exact workspace scripts exist at reviewed HEAD)
npm run lint --workspace=@electrohub/backend
npm run typecheck --workspace=@electrohub/backend
npm run test:ci --workspace=@electrohub/backend
npm run build --workspace=@electrohub/backend

# Frontend
npm run lint --workspace=@electrohub/frontend
npm run typecheck --workspace=@electrohub/frontend
npm run test --workspace=@electrohub/frontend
npm run build --workspace=@electrohub/frontend

# AI (from apps/ai-service with approved venv)
python -m pytest
python -m ruff check .
python -m mypy app
```

Use targeted suites as you develop and only rerun broader suites when relevant. **Do not label a mocked Storage SDK call or synthetic embedding as a successful end-to-end AI integration.** Report tool version, target environment, cases executed, pass/fail/skip, screenshots/log paths, and reasons for any blocked cases. Distinguish unrelated baseline failures from regressions with credible evidence.

---

# 12. Implementation work packages and expected outputs

The suggested order minimizes migration/role/security risks. Each package should end with a small tested increment and avoid unapproved remote writes.

### WP0 — Repository and runtime discovery

**Work:** Initial repo/worktree inspection; current image consumer inventory; Storage plan/bucket capability; AI schema and active model; exact DEV/QA data mapping; risk/ADR.  
**Output:** Read-only baseline inventory, dependency graph, minimal schema/API/AI decision with guardrails.  
**Gate:** No coding based on unverified storage assumptions or already-existing admin CRUD.

### WP1 — Storage adapter and isolated QA foundation

**Work:** Provider credentials/config abstraction; bucket rules; MIME limits; immutable path strategy; fail-closed project identity; real disposable Storage integration/fake fault harness.  
**Output:** Safe upload/read/remove adapter, object source checker, deterministic tests.  
**Gate:** Public read/private mutation verified; no frontend secrets.

### WP2 — Compatible schema and transactional media source/outbox

**Work:** Additive Prisma schema/migration, source revision state, outbox, primary uniqueness, soft-retirement and legacy-safe migration/backfill plans; clean replay and concurrency tests.  
**Output:** Stable image ownership, revision+digest invariants and durable events.  
**Gate:** No history/checkout regression, no orphan event on transaction failure.

### WP3 — Express admin media APIs and indexing status

**Work:** Auth/RBAC, decoder and rate limit, media service, Storage+DB failure handling, OpenAPI, admin index-status projection.  
**Output:** Real stable API and negative auth tests; hosted Storage integration under approved QA identity.  
**Gate:** No cross-product mutation or arbitrary URL/path authority.

### WP4 — Stale-source protection and safe AI refresh

**Work:** Implement approved eligibility reader join and limited versioned overlay **or** Architect-approved alternative, worker, source resolver, model-version verification, reconciliation and read-after-write checks.  
**Output:** Full mutation → pending → indexed flow; automatic ineligible stale source; safe failure/replay.  
**Gate:** M43-10 and M43-14 verified against real PG/AI in disposable QA; no ACTIVE-base writes.

### WP5 — Frontend media UI and storefront integration

**Work:** Media-only admin panel, TanStack Query mutations/statuses, responsive previews, gallery CRUD, normalized image delivery + fallback, existing views compatibility.  
**Output:** Premium, usable admin media lifecycle; customer gallery/search continuity.  
**Gate:** Browser screenshots, keyboard/mobile QA and real persisted upload.

### WP6 — Migrate legacy media by policy (not compulsory wholesale import)

**Work:** Reconcile legacy URLs and exact source hashes, preserve order snapshots and retained assets; optionally controlled small migration if justified; correct category/brand/rights documentation.  
**Output:** Baseline compatibility and repeatable migration manifest, no unsupported rights assumptions.  
**Gate:** Existing 206/412 baseline (if still current) remains visually and AI healthy.

### WP7 — Deployment/operations and first handoff

**Work:** Rollout flags, environment-secret docs, worker deployment mode, provider quotas, observability, alert/repair commands, Swagger update, ADR and evidence checklist.  
**Output:** Review-ready task diff + complete evidence + explicit shared DEV/PROD migration staging plan.  
**Gate:** No unapproved remote writes or merge; platform CI and migration safety documented.

---

# 13. Environment isolation, CI and release controls

| Environment | Permitted in this task without further authorization | Requires separate owner authorization |
|---|---|---|
| Local/disposable QA | Source/tests/docs edits on task branch, local Postgres/pgvector migrations, isolated Storage-compatible test, fake/real QA fault injection | Cloud network/cost usage if not already authorized; any protected credentials |
| Shared DEV | Read-only inspection through approved connector/credentials and safe request verification | Bucket creation, Storage writes, Prisma/SQL migrations, legacy backfill, worker grants, active-image search SQL rollout or model/index changes |
| PROD | Read-only documented release planning only | **All** Storage bucket/policy creation, schema/migration, ingestion, backfills, credential changes, deployment, active-index switch and cleanup |

**Critical current pipeline fact:** At reviewed `develop` HEAD, `prod-migration.yml` has `push: develop`. This could run a PROD-targeting migration job after a merge even if the task author does not manually dispatch it. Its current hardcoded allowlist covers the existing 04.2 vector migrations; Task 04.3's new migrations are **not automatically approved**. Therefore:

- Inspect the live workflow and policy again immediately before opening/merging the Task 04.3 PR.
- Do not alter migrations' allowlists, add 04.3 migration names, or relax validation merely to make CI green without a reviewed PROD release plan.
- The agent must explicitly tell the Project Owner what **automatic workflow execution on `develop`** would do and whether it is safe/no-op, blocked or capable of writing PROD.
- **No merge to `develop` is authorized by this task document.** Do not equate local development permission with production migration permission.
- PRODUCTION migration completion, PROD Storage setup, PROD catalog source backfill and PROD AI index must be verified **against PROD's actual catalog IDs/images**; never copy QA/DEV vectors by ID.

A separate release manifest must pin: backend/frontend/worker/AI artifact versions, migration schema version, bucket/policy revision, source digest convention, active embedding version, overlay/read query revision, expected catalog coverage, rollback procedure and smoke test set. Rollback must coordinate application code, worker, Storage metadata and the search reader contract, not just revert a feature branch.

**Model state and backups:** Keep older model artifacts/indices and historical media objects through the agreed recovery window. Ensure current active model/vector data and historical order references have compatible rollback state before GC. Avoid dangerous cleanup of shared catalog sources during first release.

---

# 14. Detailed acceptance / final QA checklist

## A. Storage and images

- [ ] Dedicated environment-isolated Storage bucket and access policy demonstrated; anonymous/customer cannot mutate.
- [ ] Real upload, download and deletion through Storage API; content digest and content type independently verified.
- [ ] New immutable revision keys on replace; CDN never relies on overwriting existing URL.
- [ ] Canonical source and any variants have clear ownership/retention and compatible image quality.
- [ ] Image transformation entitlement tested; functional no-paid-transform fallback.
- [ ] Orphan cleanup and historical-order retention prevent dangling references.

## B. Database and backend

- [ ] Existing `ProductImage` IDs/fields and Product DTOs remain backward compatible.
- [ ] Prisma migration replays cleanly on isolated DB; existing migrations untouched; role grants proven.
- [ ] Product-image mutation and durable event commit/rollback atomically.
- [ ] Add, replace, retire, primary, reorder, alt text and per-version index state endpoints implemented.
- [ ] Same-product concurrent mutation and single-primary invariant proven.
- [ ] Unauthorized/customer, cross-product, malicious and huge uploads denied without side effects.
- [ ] Connection/role/project identities checked without leaking secrets.

## C. AI integrity and search

- [ ] Source-revision/digest eligibility gate prevents obsolete or deleted images from ranking immediately on committed mutation.
- [ ] Worker refreshes approved current source with exact descriptor; no mismatch of 256D spaces.
- [ ] New eligible media is searchable following automatic successful refresh **without uncontrolled active pointer changes**.
- [ ] Duplicates, old events, concurrent replacement, worker crash and AI outage are safe.
- [ ] Existing ACTIVE/RETIRED/Candidate C base vectors remain immutable and auditable.
- [ ] Model readiness, index freshness, pending status and stale/missing count are separately observable.
- [ ] Real SQL/pgvector/FastAPI/Express end-to-end QA confirms source-correct results and authoritative products.

## D. Frontend and commerce

- [ ] Real admin UI upload/preview/replace/delete/primary/order/alt; index pending/failure/success accurately shown.
- [ ] Keyboard, focus, screen reader, responsive/mobile/200% zoom and errors work.
- [ ] Product/list/detail/search/cart/wishlist/checkout/order media unchanged except intended new photos.
- [ ] Task 04.2 upload, camera, no-match and text fallback remain reliable.
- [ ] Historical order image remains available after catalog replacement.

## E. Release/evidence

- [ ] DEV/QA/PROD isolation documented; no PROD writes or unapproved shared DEV writes.
- [ ] Failed-path, regression, browser screenshots and real Storage/AI integration evidence attached.
- [ ] OpenAPI, example config, ops runbook, architecture ADR, migration plan and roadmap references updated.
- [ ] Latest CI/workflow effect reviewed before any PR merge to `develop`.
- [ ] No fabricated pass, mock-only e2e claim, secret leakage or unapproved commit/push/merge.

---

# 15. Specific first-handoff deliverables to return to the Architect

Produce these artifacts in the **task branch** for review; final exact paths reflect repository conventions:

1. A **change summary** by package (frontend, Express, Storage, Prisma, AI, operations), describing both implemented behavior and deliberate deferrals.
2. The **ADR** resolving Storage public/pending policy, file limit/conversion, source revision model, immediate eligibility gate, overlay versus snapshot strategy, role permissions and object garbage-collection policy. Explain why the design is safe in the observed schema.
3. All task-owned source files, generated Prisma migration(s), reviewed SQL/role changes, API contracts/OpenAPI, example configuration and lockfile updates.
4. Isolated QA setup and smoke scripts; a real Storage API integration verification where authorization is available; deterministic fake adapter for failure injection.
5. Verified **AI freshness proof**: starting source/image ID/revision/digest, upload/replace commit, outbox event ID/state, excluded stale vector, updated vector source digest, returned product ID/model version and observed AI/UI state.
6. Screenshot/browser evidence for admin media editor at desktop/mobile, upload/replacement/primary/deletion, customer gallery, pending/failed indexing and recovery.
7. Security evidence: 401/403, wrong product, malicious image, role grants, no browser secrets, Storage bucket restriction, protected AI schema and safe logs.
8. Migration/backfill plan showing actual image counts/UUID differences, compatibility with the existing 412-image baseline **if still current**, and precisely what needs separate shared DEV/PROD authorization.
9. Operations runbook: service/worker start/stop, heartbeat, stuck jobs, retry/reconcile, safe orphan garbage collection, Storage outage, expired credentials, source mismatch, version mismatch and rollback.
10. Evidence file `docs/tasks/Phase-04/TASK_04.3_IMPLEMENTATION_EVIDENCE.md` with actual commands, environment identities, pass/fail/skip, commit base, release risks and links/paths to logs/screenshots. Do not claim executed operations if not run.
11. Review summary that explicitly calls out **blocking defects versus optional improvements**, known test limits and residual risk.
12. A clear final disposition request: **Ready for Architect review**, **Blocked (with exact reason)** or **Partially implemented (with remaining checklist)**.

## Suggested implementation status report template

```text
Task 04.3 status:
Branch / base SHA / changed paths:
Architecture/ADR decision:
Storage real-smoke identity + result:
Prisma migration replay / AI role & stale-source gate:
API/RBAC validations:
Worker + event/replay/reconcile evidence:
Frontend browser screenshots and responsive QA:
AI correctness and version-coherence proof:
Regression suites (backend / frontend / AI / CI):
Environment writes actually performed and authorizations:
Known blockers / optional enhancements:
Recommended Architect decision (approve / changes / reject):
```

---

# 16. Final guardrails and implementation authorization

This is an **implementation specification** for a high-confidence first handoff, not a request to create a proof-of-concept that only uploads files.

**May do on an authorized task branch:** inspect repo; design and implement the complete scoped application change; edit tests/documentation; run local/disposable isolated migrations and tests; produce screenshots, reports and review-ready diffs; request approval for privileged remote work.

**Must not do without explicit additional owner authorization:** shared DEV/PROD Storage mutations, protected database migration execution, credentials/role changes, AI ACTIVE pointer changes, destructive image migration/cleanup, PROD ingestion/deployment, commits/pushes/merges, or production-sensitive workflow dispatch. Do not ask for redundant approval for purely local coding and safe isolated testing.

**Do not silently downgrade requirements** if an environment or provider integration is unavailable. Implement/test all feasible parts; mark a real hosted integration as blocked with exact setup action. A passing unit suite is not a substitute for an end-to-end storage and AI freshness proof. Avoid endless test loops; use credible existing evidence and risk-based targeted QA.

The precise success statement is:

> **ElectroHub now manages approved product photographs end-to-end through Supabase Storage, delivers them reliably to shoppers, and keeps source-revision-correct AI image search synchronized without exposing secrets, silently retaining obsolete vectors, rewriting the catalog or automatically promoting AI models.**

That outcome must be **demonstrated**, not merely asserted.

---

# 17. Source references / technical foundations

## Project / repository files inspected read-only (2026-10-27)

- `AGENTS.md`, `docs/11_Workflow/TASK_TEMPLATE.md`, `docs/11_Workflow/BRANCHING.md`, `docs/11_Workflow/GIT_WORKFLOW.md`
- `docs/tasks/Phase-04/TASK_04.1_FASTAPI_AI_SERVICE.md`, `TASK_04.2_REAL_VISION_IMAGE_SEARCH_DISCOVERY_CONSOLE.md`, and available implementation-evidence conventions
- `apps/backend/prisma/schema.prisma`; migrations `20261024000000_ai_vector_search` and `20261025000000_ai_vector_staging_guard`
- `apps/backend/src/{routes/product.routes.ts,routes/index.ts,middleware/auth.ts,services/product.service.ts,services/search.service.ts,services/search.sql.ts,services/commerce-email.producer.ts,services/commerce-email.dispatcher.ts,config/env.ts}`
- `apps/frontend/src/features/products/{types.ts,queries.ts}`, `apps/frontend/src/layouts/AdminLayout.tsx`, `apps/frontend/src/pages/admin/AdminLoginPage.tsx`
- `apps/ai-service/app/{integrations/pgvector_gateway.py,ingest/__main__.py}`
- `.github/workflows/prod-migration.yml`, package scripts and available isolated test harness paths.
- Uploaded project architecture documents covering frontend, backend, AI, database, deployment, system structure, stack and roadmap, and the approved Task 04.3 design decisions (product media and AI synchronization).

## Supabase authoritative documentation (recheck at implementation time)

- Standard uploads and immutable object paths: https://supabase.com/docs/guides/storage/uploads/standard-uploads
- Bucket access policy: https://supabase.com/docs/guides/storage/buckets/fundamentals
- Storage authorization and RLS: https://supabase.com/docs/guides/storage/security/access-control
- Image transformations, plans and fallbacks: https://supabase.com/docs/guides/storage/serving/image-transformations
- CDN behavior: https://supabase.com/docs/guides/storage/cdn/fundamentals

Do not infer current provider-plan entitlements, live bucket policy or database role state solely from docs or this specification. Verify actual environment when authorized.
