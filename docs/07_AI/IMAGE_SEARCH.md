# AI Image Search

## 1. Purpose

This document defines the AI-assisted image-search architecture for ElectroHub.

The feature allows customers to search the electronics catalog using an uploaded image or a camera capture.

The goal is to provide a strong portfolio demonstration of visual product discovery while keeping the implementation practical.

---

# 2. Feature Overview

```text
User
 ↓
Upload Image / Capture Photo
 ↓
React Frontend
 ↓
Node.js / Express Backend
 ↓
FastAPI AI Service
 ↓
Image Analysis / Similarity
 ↓
Matching Product References
 ↓
Backend
 ↓
Product Results
 ↓
Product Details
```

The FastAPI service is responsible for AI/image-processing logic.

The Node.js backend remains responsible for commerce business logic and product authorization.

---

# 3. User Workflow

```text
User clicks "Search by Image"
 ↓
Choose:
 ├── Upload Image
 └── Capture Photo
        ↓
      Camera
        ↓
   Image Submission
        ↓
  AI Processing
        ↓
 Similar Products
        ↓
 Product Results
        ↓
 Product Details
```

---

# 4. Image Input

The frontend supports:

```text
Upload Image
Capture Photo
```

For camera capture, the browser camera APIs/WebRTC-based access may be used where supported.

The application must request camera permission explicitly.

If camera access is unavailable, image upload remains available.

---

# 5. Upload Validation

Before sending an image, the frontend should validate:

- File type.
- File size.
- Image dimensions where required.
- Upload availability.

The backend must repeat security-sensitive validation.

Never trust client-side validation alone.

---

# 6. Supported Image Types

The implementation should define an explicit allowlist of supported image formats.

For example:

```text
JPEG
PNG
WEBP
```

The final allowlist must match the image-processing service capabilities.

Unsupported formats must be rejected safely.

---

# 7. Camera Capture

The camera workflow is:

```text
Request Camera Permission
 ↓
Open Camera Stream
 ↓
Preview
 ↓
Capture Frame
 ↓
Validate Image
 ↓
Submit Search
```

Camera access must only occur after an explicit user action.

Camera streams should be released when no longer required.

---

# 8. Backend Responsibilities

The Node.js backend is responsible for:

- Authentication where required.
- Request validation.
- File validation.
- Upload-size enforcement.
- Calling FastAPI.
- Validating AI-service responses.
- Resolving returned product references.
- Returning authorized catalog results.

The backend must not blindly trust product IDs returned by an external service.

---

# 9. FastAPI Responsibilities

FastAPI validates and decodes the image, applies the approved inference preprocessing, runs the deployed EfficientNet-B0 visual encoder (pretrained frozen backbone plus the owner-approved trained 256-dimensional projection), and retrieves candidates from compatible catalog embeddings in PostgreSQL pgvector through its restricted vector repository.

It returns product references, ranking scores, and model/embedding version metadata. It does not return authoritative price or inventory. The backend resolves current catalog data and authorization before showing results. The public backend endpoint and internal FastAPI endpoint are distinct trust boundaries; exact contracts are defined in task 04.1 and completed in 04.2.

---

# 10. Required Phase 04 Implementation

Task 04.2 delivers real learned visual similarity search. Backbone fine-tuning was attempted, but validation selected the checkpoint with the frozen pretrained EfficientNet-B0 backbone and genuinely trained 256-dimensional projection head. This is an owner-approved scope exception pending final Architect verification; the deployed backbone is not described as fine-tuned. The encoder's learned features become image embeddings; nearest-neighbor retrieval uses PostgreSQL pgvector.

Simulated category mappings, image metadata matching, or random vectors do not satisfy this scope. The owner-approved Task 04.2 exception is specifically the measured trained-projection checkpoint described above. The feature does not promise exact model/SKU identification from arbitrary photographs.

---

# 11. Training and Catalog Embeddings

Task 04.2 covers Kaggle Free GPU setup, data preparation, offline fine-tuning, held-out evaluation, checkpoint export, and catalog embedding generation. The HP laptop remains the local development and CPU inference environment. Kaggle is not used for online search requests.

Catalog and query images use the same deployed encoder and inference preprocessing. Catalog embeddings are generated ahead of search requests and refreshed when product images change. A model/preprocessing change requires versioned re-embedding and coordinated activation, not a mixture of old and new vectors. Detailed training objectives, retrieval metrics, thresholds, and vector schema are deferred to task files.

---

# 12. Product Matching

AI results should identify candidate products.

The backend then resolves the candidates against the authoritative product catalog.

```text
FastAPI
 ↓
Product IDs + Scores
 ↓
Backend
 ↓
Database
 ↓
Active Products
 ↓
Customer Results
```

Inactive or unauthorized products must not be returned merely because the AI service produced their identifiers.

---

# 13. Similarity Score

A similarity score may be returned by the AI service.

Example:

```text
Product A → 0.94
Product B → 0.87
Product C → 0.76
```

The score is an AI/service metric and should not be presented as a guaranteed probability unless it is actually calibrated as one.

---

# 14. Result Ranking

Results should be ordered according to the approved matching strategy.

Conceptually:

```text
Highest Similarity
        ↓
Relevant Active Products
        ↓
Catalog Result Ordering
```

The backend may apply additional catalog rules after receiving AI candidates.

---

# 15. Search Result UI

The customer should see:

- Matching products.
- Product image.
- Product name.
- Price.
- Availability.
- Similarity relevance where appropriate.

Selecting a result opens the normal product details page.

---

# 16. No Results

The system must handle:

```text
No Similar Products
```

with a useful response.

Example:

```text
No matching products found.
Try another image.
```

The user should be able to return to normal text/catalog search.

---

# 17. AI Service Failure

If FastAPI is unavailable:

```text
AI Request
 ↓
Failure
 ↓
Friendly Error
 ↓
Normal Store Remains Usable
```

AI failure must not break:

```text
Catalog
Cart
Checkout
Orders
Payments
```

---

# 18. Timeout Handling

AI requests should have explicit timeouts.

The backend must not wait indefinitely for FastAPI.

Possible result:

```text
AI Timeout
 ↓
Return Controlled Error
```

The frontend should provide a retry option.

---

# 19. Security

Image search must include:

- File-type validation.
- File-size limits.
- Request authentication where required.
- Rate limiting where appropriate.
- Safe temporary-file handling.
- No execution of uploaded files.
- Secure AI-service communication.
- Input validation.

Uploaded images must never be treated as executable content.

---

# 20. Privacy

Customer-uploaded images should be processed only as required by the feature.

The system should avoid permanent storage unless explicitly required.

If temporary files are used:

```text
Upload
 ↓
Process
 ↓
Delete Temporary File
```

Image contents must not be stored in analytics unnecessarily.

---

# 21. Supabase Storage & Media Boundaries

Supabase Storage (the `product-media` bucket) is dedicated to catalog product media.

Customer search query images (captured via camera or uploaded) are ephemeral and must never be stored in Supabase Storage or persistent product media.

Product catalog images and customer search inputs are strictly separate data categories:
- Catalog media: Uploaded by authenticated administrators via Express, stored in Supabase Storage, tracked in `ProductImage`, and durably indexed via transactional outbox into `ai.product_image_embeddings`.
- Search query images: Processed in-memory in FastAPI for feature extraction and similarity search against pgvector, then immediately discarded.

---

# 22. Analytics

The system may record non-sensitive image-search events such as:

```text
image_search.started
image_search.completed
image_search.no_result
image_search.product_selected
```

Analytics should not store the raw uploaded image unless explicitly required.

---

# 23. Admin Workflow

Administrators may support image-search quality by:

- Uploading product images.
- Managing product image metadata.
- Tagging products where required.
- Reviewing image-search success metrics.

Admin functionality is documented in `ADMIN.md`.

---

# 24. AI Service API

Conceptually:

```text
POST /api/ai/image-search
```

Request:

```text
Image
```

Response:

```text
Matching Product References
Similarity Scores
```

The exact endpoint and payload are defined by the backend/API implementation.

---

# 25. AI Service Isolation

The FastAPI service must not directly own:

```text
Orders
Payments
Cart
Inventory
User Authorization
```

It provides AI processing only.

The Node.js backend remains the system's commerce authority.

---

# 26. Performance

Image search should:

- Limit upload size.
- Resize large images where appropriate.
- Avoid unnecessary repeated processing.
- Use explicit request timeouts.
- Return only the required candidate results.
- Avoid blocking normal application operations.

---

# 27. Accessibility

Image search must remain usable without camera access.

The interface must provide:

```text
Upload Image
```

as an alternative.

Buttons, inputs, progress states, errors, and results must be accessible.

---

# 28. Responsive Behavior

Image search must work across:

```text
Desktop
Tablet
Mobile
```

Camera capture is particularly important on mobile devices.

---

# 29. Testing

Testing should cover:

```text
Image Upload
Camera Permission
Camera Capture
Unsupported File
Oversized File
Invalid Image
No Results
Successful Matching
Result Ranking
AI Timeout
AI Service Failure
Unauthorized Access
Product Filtering
Analytics Events
Mobile Camera Flow
```

---

# 30. Definition of Done

Image search is complete when:

- Upload-image search works.
- Camera capture works where supported.
- Input validation works.
- FastAPI integration works.
- The owner-approved Task 04.2 encoder (pretrained frozen EfficientNet-B0 backbone plus trained 256-D projection) and pgvector retrieval return candidate products; this scope exception is pending final Architect verification and is not described as a fine-tuned deployed backbone.
- Held-out retrieval quality and known failure cases are documented.
- Catalog embedding refresh and version compatibility are verified.
- Backend validates AI results.
- Similarity ranking works; thresholds are evaluated rather than forcing a match for every image.
- No-result state works.
- AI failure is handled gracefully.
- Privacy controls are implemented.
- Analytics work without unnecessary image storage.
- Admin image metadata support works where required.
- Responsive behavior is verified.
- Accessibility is verified.
- Tests pass.
- Documentation matches the implementation.

---

# 31. AI Image Search Principle

> **Image search is an isolated AI capability that enhances product discovery while keeping product authorization, catalog truth, and commerce logic inside the main backend.**


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

## Task 04.2 — Implemented Public Contract

`POST /api/search/image` (Express; guests allowed). It accepts one multipart part named `image` (JPEG/PNG/WebP, detected by magic bytes, ≤ 8 MiB) and an optional `limit` of 1–24 (default 12). It is rate-limited to 20 requests per 5 minutes per IP. Cookies and JWTs are never forwarded.

Express sends the bytes through `AiServiceClient.imageSearch`: per-environment service key, no redirects, a capped response, an 8 s route timeout (`AI_IMAGE_SEARCH_TIMEOUT_MS`, max 15 s), and abort on client disconnect. It validates the ranked product ids, then resolves them in **one** query that uses the same storefront-visibility predicate and `ProductSummary` mapper as `/api/search/products`. Rank order is preserved, hidden or forged ids are dropped, and prices and stock always come from the database.

Response: `{ data: { items: ProductSummary[] }, meta: { modelVersion, embeddingVersion, count } }`. Similarity scores are never sent to the browser.

| Situation | Status / code | UI |
|---|---|---|
| Model or index not ready, AI unreachable or misconfigured, invalid upstream | 503 `IMAGE_SEARCH_UNAVAILABLE` | "Image search is unavailable right now" (the photo reached the server and was not saved) |
| Inference queue full | 429 `IMAGE_SEARCH_BUSY` + `Retry-After` | Generic retry state |
| Timeout | 504 `IMAGE_SEARCH_TIMEOUT` | "The search took too long" |
| Too large, unsupported or unreadable | 413 / 415 / 422 | Inline photo error |
| Feature flag off (`VITE_IMAGE_SEARCH_ENABLED`) | No request is sent | "Image search isn't available yet" (the photo was not sent) |

The same 8 MiB budget applies end to end: browser `MAX_IMAGE_BYTES`, Express `IMAGE_SEARCH_MAX_BYTES`, and FastAPI `AI_MAX_IMAGE_BYTES`. Results say "These products look similar to your photo. Colour and storage versions can look identical…", because exact-SKU recognition is not claimed.
