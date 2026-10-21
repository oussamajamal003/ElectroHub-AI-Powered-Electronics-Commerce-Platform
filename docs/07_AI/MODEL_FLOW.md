# AI Model Flow

## 1. Purpose

This document defines the data flow for ElectroHub's AI capabilities.

The project contains two primary AI-assisted workflows:

```text
Image Search
Recommendation System
```

The AI layer remains separate from the main commerce backend.

---

# 2. Overall AI Flow

```text
Customer
   ↓
React Frontend
   ↓
Node.js / Express
   ↓
FastAPI
   ↓
AI Processing
   ↓
Product References + Scores
   ↓
Node.js / Express
   ↓
Prisma
   ↓
Supabase PostgreSQL
   ↓
Validated Product Data
   ↓
React Frontend
```

---

# 3. Image Search Flow

```text
User
 ↓
Select Image
 ↓
Upload / Camera Capture
 ↓
Frontend Validation
 ↓
Backend Validation
 ↓
FastAPI
 ↓
Image Preprocessing
 ↓
Feature / Similarity Processing
 ↓
Candidate Products
 ↓
Similarity Scores
 ↓
Backend Validation
 ↓
Database Product Lookup
 ↓
Active Product Filtering
 ↓
Ranked Results
 ↓
Product Cards
```

---

# 4. Image Preprocessing

The image may pass through:

```text
Input Image
 ↓
Format Validation
 ↓
Size Validation
 ↓
Resize / Normalize
 ↓
Model / Similarity Processing
```

Preprocessing should be deterministic where practical.

Oversized or unsupported images must be rejected before expensive processing.

---

# 5. Learned Image Matching

The required path is a pretrained EfficientNet-B0 CNN fine-tuned in PyTorch. Its encoder produces learned embeddings used for pgvector retrieval. Classification outputs alone are not the search result, and simulated matching is not an accepted completion path.

---

# 6. Offline Training Flow

```text
Approved / licensed electronics images
 ↓
Data quality checks and leakage-aware train / validation / test split
 ↓
Kaggle Free GPU setup in task 04.2
 ↓
Fine-tune pretrained EfficientNet-B0 in PyTorch
 ↓
Evaluate held-out classification where applicable and retrieval quality
 ↓
Export trusted checkpoint + preprocessing + evaluation metadata
 ↓
Review and promote versioned inference artifact
```

Keep near-duplicate images and related views grouped appropriately to avoid overstated results. Dataset coverage and generalization limits must be recorded. Customer requests never trigger training. Notebook setup, hyperparameters, dataset selection, and acceptance targets belong to task 04.2.

---

# 7. Catalog and Query Similarity Flow

```text
Catalog images → Controlled embedding job → Versioned pgvector records

Query image
 ↓
Backend + FastAPI image validation
 ↓
Shared deterministic inference preprocessing
 ↓
Deployed fine-tuned EfficientNet-B0 encoder
 ↓
Query embedding
 ↓
pgvector nearest-neighbor retrieval against compatible catalog vectors
 ↓
Top-K product references + ranking scores + version metadata
 ↓
Backend current catalog / authorization checks
```

Catalog embeddings are computed ahead of online queries and refreshed on image/model changes. Keep inference read access separate from ingestion write access. No-match and unavailable-store states must be handled explicitly.

---

# 8. Recommendation Flow

```text
User Activity
 ↓
Behavioral Events
 ↓
Backend
 ↓
Recommendation Strategy
 ↓
Candidate Generation
 ↓
Ranking
 ↓
Backend Product Validation
 ↓
Recommendation Results
 ↓
Frontend
```

---

# 9. Recommendation Inputs

Possible inputs include:

```text
Current Product
User Purchase History
Viewed Products
Cart Activity
Wishlist Activity
Category
Popularity
```

Only required information should be used.

---

# 10. Embedding-Based Recommendation Flow

```text
Current product embedding OR behavior-derived embedding profile
 ↓
pgvector candidate retrieval using the shared encoder version
 ↓
ML content similarity + optional metadata / behavior ranking signals
 ↓
Exclude unsuitable or duplicate candidates
 ↓
Backend catalog validation
 ↓
Recommendations with explicit result mode
```

Rules alone do not satisfy the ML recommendation scope. Popularity/category ranking is retained for cold start, outages, and supporting business constraints. A separate deep recommendation network is not required.

---

# 11. Personalized Recommendation Flow

For authenticated users with sufficient permitted behavior, the backend selects that user's relevant interactions and sends minimal product references/weights to FastAPI. The AI service derives a preference profile from compatible product embeddings and retrieves/ranks related products.

Profile construction, history windows, and evaluation are specified in task 04.4. Sparse or missing history uses contextual product embeddings where available, then an explicit popular/category fallback. Similar visual appearance does not prove accessory compatibility or complementary purchase intent.

---

# 12. Frequently Bought Together Flow

```text
Current Product
 ↓
Historical Orders
 ↓
Find Co-Purchased Products
 ↓
Count Relationships
 ↓
Rank by Frequency
 ↓
Recommended Products
```

This can be implemented through PostgreSQL queries without ML.

---

# 13. Product Validation Flow

AI output is never directly returned to the customer.

```text
AI Product IDs
 ↓
Backend
 ↓
Database Lookup
 ↓
Verify Product Exists
 ↓
Verify Product Is Active
 ↓
Apply Availability Rules
 ↓
Return Safe Product Data
```

This prevents stale or invalid AI references from becoming customer-facing data.

---

# 14. Score Handling

AI services may return:

```text
Similarity Score
Recommendation Score
```

Scores are used for ranking.

Unless explicitly calibrated, a score must not be described as a probability.

---

# 15. AI Failure Flow

```text
Customer Request
 ↓
Backend
 ↓
FastAPI Failure
 ↓
Fallback
```

Image search:

```text
AI Failure
 ↓
Friendly Error
 ↓
Normal Catalog / Text Search
```

Recommendations:

```text
AI Failure
 ↓
Rule-Based / Popular Products
```

Core commerce remains operational.

---

# 16. Timeout Flow

```text
Backend Request
 ↓
FastAPI
 ↓
Timeout
 ↓
Backend Stops Waiting
 ↓
Controlled Failure
 ↓
Fallback / Retry
```

AI requests must never block indefinitely.

---

# 17. Analytics Flow

```text
User Action
 ↓
Event
 ↓
Backend
 ↓
Behavioral Event
 ↓
Analytics / Recommendation Input
```

Examples:

```text
product.viewed
image_search.completed
recommendation.clicked
recommendation.converted
```

Raw images and sensitive authentication data are excluded unless explicitly required.

---

# 18. AI Service Boundary

The AI service owns:

```text
Image Processing
Model Inference
Similarity
Recommendation Computation
```

The backend owns:

```text
Authentication
Authorization
Products
Inventory
Cart
Orders
Payments
Delivery
```

This separation is mandatory.

---

# 19. Model Versioning

The service must internally track the deployed model and embedding compatibility metadata, including:

```text
Model Name
Model Version
Inference Version
```

Changing a model in a way that affects application behavior should be documented.

---

# 20. Performance Flow

```text
Request
 ↓
Validate Early
 ↓
Limit Input
 ↓
Preprocess Efficiently
 ↓
Reuse Loaded Model
 ↓
Return Top-K Results
 ↓
Backend Validation
```

Do not process unnecessary candidates or return unnecessarily large AI responses.

---

# 21. Privacy Flow

```text
Customer Image
 ↓
Temporary Processing
 ↓
AI Result
 ↓
Temporary Data Removal
```

Customer search images should not automatically become permanent assets.

Behavioral data must follow data-minimization principles.

---

# 22. Definition of Done

The AI flow is complete when:

- Image search flow works.
- Recommendation flow works.
- AI service boundaries are respected.
- Backend validates AI results.
- Fallback behavior works.
- Timeout handling works.
- Scores are handled correctly.
- Behavioral data is controlled.
- Privacy requirements are implemented.
- Fine-tuning, retrieval evaluation, embedding refresh, and version compatibility are evidenced.
- Model versioning is documented.
- Tests verify critical flows.
- Documentation matches implementation.


---

## Phase 04 Decision Baseline

This Phase 00 document records the approved direction, not evidence that Phase 04 is implemented or validated. Task files will define detailed contracts, data preparation, model settings, database migrations, evaluation criteria, and operational procedures.

- **04.1:** establish the FastAPI service architecture, internal API contracts, configuration, validation, security, readiness, and backend integration.
- **04.2:** implement real image search using a pretrained EfficientNet-B0 CNN fine-tuned in PyTorch, learned image embeddings, and PostgreSQL pgvector retrieval. Kaggle Free GPU setup and training belong to this later task; no training environment is being provisioned by this document.
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
