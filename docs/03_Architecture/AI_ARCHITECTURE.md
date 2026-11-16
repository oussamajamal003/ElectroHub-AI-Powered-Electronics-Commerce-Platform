# AI Architecture

## 1. Purpose

This document defines the AI architecture for ElectroHub.

The AI layer is a separate FastAPI service isolated from core commerce business logic.

It supports:

- Search by image.
- Product similarity.
- Product recommendations.
- Future AI/ML capabilities.

Phase 04 requires real pretrained EfficientNet-B0 fine-tuning in PyTorch, learned embeddings, pgvector retrieval, and embedding-based recommendations. Rules remain supporting signals or explicitly identified fallbacks.

## 2. Technology Stack

```text
Python
FastAPI / Pydantic / Uvicorn
PyTorch / torchvision / EfficientNet-B0
Image decoding / preprocessing
Restricted PostgreSQL pgvector repository
```

The service is maintained inside the monorepo and communicates with the Node.js backend through defined HTTP APIs.

## 3. Service Boundary

The AI service owns:

```text
AI Processing
Image Analysis
Similarity Logic
Recommendation Logic
Model Execution
```

It does not own:

```text
Customer Authentication
Customer Authorization
Orders
Payments
Inventory
Customer Accounts
Commerce Business Rules
```

Those remain backend responsibilities.

## 4. Architecture

```text
Customer
 ↓
React Frontend
 ↓
Node.js / Express Backend
 ↓
FastAPI AI Service
 ├── Image Search
 └── Recommendations
```

The backend remains the gateway between frontend and AI.

## 5. Recommended Structure

```text
apps/ai-service/
├── app/
│   ├── api/
│   ├── core/
│   ├── services/
│   ├── models/
│   ├── schemas/
│   ├── processors/
│   └── main.py
├── tests/
├── requirements.txt
└── Dockerfile
```

## 6. Communication Flow

```text
Frontend
 ↓
Backend API
 ↓
AI Integration Layer
 ↓
FastAPI
 ↓
AI Processing
 ↓
FastAPI Response
 ↓
Backend
 ↓
Frontend
```

The backend validates and authorizes requests before calling the AI service.

## 7. AI API Boundary

Purpose-specific endpoints may include:

```text
POST /image-search
POST /recommendations
GET /health
```

The final API contract should be documented in the API documentation.

## 8. Image Search

```text
User
 ↓
Search by Image
 ↓
Upload / Camera
 ↓
Frontend
 ↓
Backend
 ↓
FastAPI
 ↓
Image Processing
 ↓
Similarity Matching
 ↓
Product References / Scores
 ↓
Backend Product Retrieval
 ↓
Frontend Results
```

The AI service should return product references or matching scores rather than becoming the product database.

## 9. Image Input and Validation

Supported sources:

```text
File Upload
Camera Capture
```

The frontend handles camera permissions and image selection.

The backend validates authorization, file type, file size, and input constraints before AI processing.

## 10. Image Processing

Possible processing stages:

```text
Image Validation
 ↓
Normalization
 ↓
Feature Extraction
 ↓
Similarity Calculation
 ↓
Ranking
```

Use the approved fine-tuned EfficientNet-B0 encoder and the same deterministic inference preprocessing for query and catalog embeddings. Retrieve nearest neighbors through pgvector; record and enforce embedding compatibility.

## 11. Product Matching

Conceptual response:

```json
{
  "matches": [
    {
      "productId": "product-123",
      "score": 0.92
    }
  ]
}
```

The backend retrieves authoritative product information from PostgreSQL.

## 12. Recommendations

Possible recommendation signals:

```text
Popular Products
Similar Category
Purchase History
Product Views
Product Clicks
Purchases
```

Recommendations reuse the learned product embeddings for content-based retrieval and behavior-derived profiles. Popularity, categories, metadata, and co-purchase evidence remain supplemental strategies or explicit fallback modes.

## 13. Recommendation Flow

```text
Customer Behavior
 ↓
Backend
 ↓
Recommendation Service
 ↓
FastAPI Shared Embedding Recommender
 ↓
Ranked Product References
 ↓
Backend
 ↓
Authoritative Product Data
 ↓
Frontend
```

The backend remains responsible for returning valid and authorized products.

## 14. Recommendation Modes

### Popular Items

Based on aggregate product activity.

### Similar Category

Products related to the current product/category.

### Purchase History

Recommendations based on previous purchases.

### Behavior-Based

Recommendations based on browsing and interaction signals.

## 15. Offline Training and Online Inference

Task 04.1 establishes FastAPI architecture and safe internal contracts. Task 04.2 later sets up Kaggle Free GPU training, fine-tunes pretrained EfficientNet-B0 in PyTorch, evaluates retrieval, and exports a versioned inference artifact. Local development and CPU inference checks use the HP Core i7 / 16 GB RAM / Intel UHD laptop.

The online service loads the approved artifact and generates embeddings without training on customer requests. Kaggle does not host the application or receive customer uploads or application/database credentials. Free GPU availability and notebook persistence must not be runtime dependencies.

---

## 16. Shared Embeddings and Evaluation

Catalog embedding generation and pgvector persistence are required Phase 04 capabilities, not a future optional extension. Task 04.4 reuses these vectors for similar-product and behavior-profile recommendations without requiring a second deep model.

Track checkpoint, preprocessing, vector dimension, normalization, distance metric, and catalog image revisions. Refresh changed products and coordinate full re-embedding when the vector space changes. Measure held-out retrieval and recommendation quality separately from classification/API correctness, compare with an appropriate baseline, and record limitations. Similarity scores are ranking metrics rather than guaranteed probabilities.

---

## 17. Product Data Ownership

```text
AI
 ↓
Product References / Scores
 ↓
Backend
 ↓
PostgreSQL
 ↓
Authoritative Product Data
```

AI output must not bypass product authorization or business rules.

## 18. Authentication Boundary

The frontend does not directly authenticate with FastAPI.

```text
User
 ↓
Backend Authentication
 ↓
Authorized AI Request
 ↓
FastAPI
```

The backend controls access to AI capabilities.

## 19. AI Security

Requirements include:

- Service-to-service authentication.
- Input validation.
- File-size limits.
- File-type validation.
- Resource limits.
- Timeouts.
- Safe temporary-file handling.
- Error sanitization.

Uploaded images are untrusted input.

## 20. Error Handling

Possible failures:

```text
Invalid Image
Unsupported Format
Processing Failure
Timeout
No Matches
Service Unavailable
Model Error
```

FastAPI errors should be converted by the backend into appropriate application-level responses.

## 21. AI Availability

Core commerce functionality should not depend on AI availability.

```text
AI Available
 → Image Search / Recommendations

AI Unavailable
 → Friendly Error / Fallback
```

## 22. Performance

Consider:

- Image size.
- Processing time.
- Memory usage.
- Request concurrency.
- Model loading.
- Response size.
- Timeout limits.

Inputs should be constrained before expensive processing where possible.

## 23. Observability

Monitor:

- Request failures.
- Processing duration.
- Service health.
- Model errors.
- Resource issues.

Avoid storing sensitive uploaded images unnecessarily in logs.

## 24. Testing

Test:

```text
Unit
API
Integration
Image Validation
Recommendation Logic
Error Handling
Performance
```

Image-search cases should include valid images, invalid files, oversized files, no matches, multiple matches, and AI-service failure.

## 25. Docker and Deployment

The AI service is containerized:

```text
docker-compose
├── frontend
├── backend
└── ai-service
```

The initial production environment uses:

```text
DigitalOcean VPS
Ubuntu
Docker
Nginx
SSL
```

The AI service may later move to separate infrastructure if required.

## 26. Completion Criteria

The AI architecture is complete when FastAPI boundaries, backend communication, image search, recommendations, product-data ownership, security, error handling, performance, training/inference separation, shared embedding lifecycle, evaluation, explicit fallbacks, testing, Docker, and deployment are documented. Implementation completion additionally requires verified fine-tuning and real retrieval/recommendation evidence.

## 27. AI Principle

> **Keep AI processing isolated, keep commerce data authoritative in the backend/database, and design the AI interface so implementation can evolve without destabilizing the core platform.**


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
