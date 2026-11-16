# AI Product Recommender

> **Implemented in Task 04.4.** This section is authoritative; the numbered sections below are the Phase 00 planning
> baseline. Note: the shipped encoder is the D3 SigLIP2 model from Tasks 04.2/04.3, not the EfficientNet-B0 named there.
> Feature and API view: [`05_Features/RECOMMENDATIONS.md`](../05_Features/RECOMMENDATIONS.md).

## Implemented recommender (Task 04.4)

### What is ML and what is not

| Mode | Computed by | Learned model? |
|---|---|---|
| Similar Products | FastAPI `EmbeddingRecommender`, pgvector | Yes: D3 SigLIP2 image embeddings (`siglip2-b16-p256-d1`, 256-d) |
| You May Also Like | FastAPI, same index, deeper pool; Express diversifies by category | Yes (embeddings) + rule (diversity) |
| Recommended for You | FastAPI profile vector over D3 centroids from Express-built `profile-v1` signals | Yes (embeddings); weights are hand-set hyperparameters |
| Frequently Bought Together | Express SQL over qualifying orders | No (co-purchase counting) |
| Popular Products | Express SQL over decayed signals | No (measured demand) |

No new model was trained. **Training GO/NO-GO: NO-GO** for a separately trained behaviour ranker: DEV holds 54 paid
orders from 10 QA users, 6 distinct co-purchase pairs (max support 2) and no interaction history, and there is no
consent basis to export behaviour to Kaggle. Revisit once consented interaction volume exists.

### Algorithm `d3-centroid-v1`

- Product vector = mean of the product's source-eligible unit image vectors of the **active** embedding version
  (Task 04.3 eligibility: base or matching-revision overlay vectors), read in one REPEATABLE READ snapshot with an
  active-identity recheck; a mismatch is `AI_INDEX_NOT_READY`, never mixed versions.
- Similar: cosine nearest centroids to the anchor (excluding anchor and excluded ids), pool `min(200, 3·limit)`,
  near-duplicate suppression at cosine ≥ 0.995, ties by product id.
- Recommended for You: normalised weighted sum of the signal products' unit centroids; signal products are excluded.
- FBT and POPULAR requests to FastAPI return 422 by design.

### Signals (`profile-v1`, Express)

VIEW 1, RECOMMENDATION_CLICK 1.5, CART 2, WISHLIST 3, PURCHASE 4; 14-day half-life; 90-day window; weights normalised
to (0, 1]; evidence threshold ≥ 2 products and total weight ≥ 3. VIEW / RECOMMENDATION_CLICK count only with consent.
Qualifying purchase: payment `SUCCEEDED`, not refunded, order `CONFIRMED | PREPARING | OUT_FOR_DELIVERY | DELIVERED`,
non-fixture products. Popularity: 30-day decayed per-user maximum, ≥ 3 contributing users. FBT support ≥ 2 orders.

### Offline evaluation (QA vector store, historical diagnostics and corrected recall rerun)

`apps/ai-service/training/recommendations/evaluate.py`; taxonomy rule fixed before results (device family + brand = 3,
family = 2, category = 1). This is not an independent judgment set. The corrected results below use the frozen
206-anchor / 206-product isolated-QA snapshot in
`apps/ai-service/training/recommendations/judgments/taxonomy_evaluation_206.json` (199 anchors contribute to recall;
206 contribute to NDCG). D3 local scoring latency was mean 0.069 ms / p95 0.078 ms; end-to-end QA requests were
approximately 120–175 ms.

| Strategy | Recall@1 | Recall@10 | NDCG@5 | NDCG@10 | Coverage@10 | Category diversity@10 | Mean ms |
|---|---|---|---|---|---|---|---|
| Category baseline | 0.081 | 0.558 | 0.904 | 0.936 | 0.612 | 0.000 | n/a |
| Popularity baseline | not evaluated (no measured demand) | | | | | | |
| **D3 centroid** | **0.129** | **0.591** | **0.979** | **0.982** | **1.000** | 0.170 | 0.069 |

Limitations: the catalog has many near-identical variants (storage/colour), which inflates absolute scores; the
baseline is weak by construction (id-ordered category listing). Worst anchors are single-member families
(TP-Link TL-SG105, JBL Bar 300, ROG Ally, PS5) where visual neighbours cross categories; You May Also Like can
surface visually similar but functionally unrelated items (e.g. cameras after a router). Visual similarity is not
compatibility. Latency is local scoring only; end-to-end QA measured ~120–175 ms per product page request.

Recall@k must divide top-k hits by the complete relevant set size. The checked-in historical JSON used
`min(k, relevant_count)` and therefore overstated recall; those historical values are invalid and are not used in
this table. The table reports the new isolated-QA snapshot identified above.
The taxonomy-derived NDCG remains a measure of agreement with the frozen family/brand/category rule, not independent
or human-judged recommendation quality. A separate, small blinded agent-judged sample and its limitations are recorded
in `apps/ai-service/training/recommendations/judgments/README.md`.

---

## 1. Purpose

This document defines the AI-assisted product recommendation architecture for ElectroHub.

The recommendation system provides contextual product suggestions throughout the customer journey.

It is designed to demonstrate personalized commerce behavior while remaining practical for a portfolio implementation.

---

# 2. Recommendation Goals

The system supports recommendation experiences such as:

```text
Recommended for You
You May Also Like
Frequently Bought Together
Popular Products
Similar Products
```

The required ML recommendation path uses the FastAPI service and reuses learned product embeddings from the fine-tuned EfficientNet-B0 encoder. Rules and popularity support ranking or explicit fallbacks.

---

# 3. High-Level Architecture

```text
Customer Activity
 ↓
Frontend
 ↓
Backend
 ↓
Behavioral Data
 ↓
Recommendation Logic
 ↓
FastAPI shared embedding retrieval / ranking
 ↓
Product Candidates
 ↓
Backend Catalog Validation
 ↓
Frontend
```

The backend remains responsible for authoritative product availability.

---

# 4. Recommendation Modes

The system may support:

```text
Popular Items
Similar Category
Purchase History
Frequently Bought Together
Personalized Recommendations
```

The exact modes implemented in the portfolio version are defined by the approved feature scope.

---

# 5. Popular Products

Popular-product recommendations may be based on aggregate behavior such as:

```text
Purchases
Views
Cart Adds
Wishlist Adds
```

A simplified implementation may rank products by a weighted activity score.

Example conceptual model:

```text
Popularity Score
=
Purchase Weight
+
Cart Weight
+
View Weight
+
Wishlist Weight
```

The actual weights should be documented if used.

---

# 6. Category-Based Recommendations

A simple recommendation mode can use the current product category.

```text
Customer Viewing Product
 ↓
Product Category
 ↓
Other Active Products
 ↓
Recommendation List
```

This provides a reliable fallback when personalized behavior is unavailable.

---

# 7. Similar Products

Use the current product's learned embedding to retrieve related catalog vectors with pgvector. Image search and the recommender share the same versioned product embeddings and catalog refresh lifecycle rather than training duplicate encoders.

Product category, attributes, price preferences, and permitted behavior may refine ranking. Visual similarity alone does not establish accessory compatibility; complementary suggestions need catalog compatibility rules or credible co-purchase evidence. Exclude the source product and duplicate product references.

---

# 8. Frequently Bought Together

This mode can use historical order relationships.

Conceptually:

```text
Product A
 ↓
Orders Containing A
 ↓
Other Products in Those Orders
 ↓
Frequency
 ↓
Recommended Products
```

This can be implemented through database aggregation without requiring a machine-learning model.

---

# 9. Purchase-History and Behavior Profiles

The backend selects authorized interaction history for the current user. FastAPI can combine the corresponding compatible product embeddings into a preference profile and use it for pgvector retrieval and ranking.

This is content-based ML personalization using learned item features, not a claim that a separate collaborative-filtering or deep recommender model has been trained. Profile weights, history windows, event quality, and evaluation are defined in task 04.4. Sparse histories use contextual embedding recommendations where possible, then explicit popularity/category fallbacks.

---

# 10. Behavioral Signals

The recommender may use events such as:

```text
Product View
Product Click
Cart Add
Wishlist Add
Purchase
Recommendation Click
```

These signals can improve recommendation relevance.

---

# 11. Behavioral Tracking

Conceptually:

```text
User Action
 ↓
Behavioral Event
 ↓
Backend
 ↓
Stored Event / Aggregate
 ↓
Recommendation Input
```

Behavioral data must remain separate from sensitive authentication data.

---

# 12. Recommendation Scoring

Learned embedding similarity is the core ML signal for similar-product and profile-based recommendations. Metadata, behavior, popularity, and compatibility constraints may supplement it. Define and version the actual ranking strategy in task 04.4.

Scores are ranking measures, not calibrated purchase probabilities. Return enough result metadata to distinguish embedding-based results, co-purchase results, curated placements, and fallback results. Do not claim that all recommendation modes use trained ML.

---

# 13. Real ML Requirement and Quality Limits

A real ML-oriented recommendation path is required, reusing the learned embeddings produced in task 04.2. A category/popularity-only or simulated system does not fulfill task 04.4.

Frequently Bought Together may use database co-purchase aggregation, and featured placements may remain curated. Popularity/category rules remain useful fallbacks. Evaluate recommendation relevance and coverage against an appropriate baseline using available data, and document sparse-history and visual-similarity limitations without claiming production-grade accuracy or business uplift.

---

# 14. FastAPI Integration

FastAPI provides the embedding-based recommendation computation. Its restricted vector repository retrieves candidates; the backend supplies authorized minimal context and validates the resulting references.

Conceptually:

```text
Backend
 ↓
FastAPI
 ↓
Recommendation Processing
 ↓
Product IDs + Scores
 ↓
Backend
```

FastAPI must not become the source of truth for:

```text
Product Price
Inventory
Order State
Payment State
```

---

# 15. Backend Validation

AI or recommendation results must be validated by the backend.

```text
Recommendation Candidates
 ↓
Backend
 ↓
Verify Product Exists
 ↓
Verify Product Active
 ↓
Verify Availability Rules
 ↓
Return Results
```

This prevents stale or invalid recommendation references from reaching customers.

---

# 16. Recommendation Placement

Recommendations may appear on:

```text
Home Page
Product Details
Cart
Order Confirmation
```

The exact placement follows the approved Figma design.

---

# 17. Product Details

On a product page:

```text
Product Details
 ↓
You May Also Like
```

The recommendations should be contextually related to the current product.

---

# 18. Cart Recommendations

The cart may display:

```text
Frequently Bought Together
```

This can help customers discover complementary products before checkout.

Recommendations must not interfere with checkout validation.

---

# 19. Homepage Recommendations

The homepage may include:

```text
Recommended for You
Popular Products
Featured Products
```

Authenticated users may receive personalized results.

Anonymous users may receive popular or category-based recommendations.

---

# 20. Recommendation Improvement

The project may demonstrate recommendations changing after user activity.

Example:

```text
User Views Laptop
 ↓
Laptop Recommendations
 ↓
User Views Gaming Accessories
 ↓
Updated Recommendations
```

Dynamic profiles reuse the trained image encoder and existing catalog embeddings; they do not require retraining that encoder for each user interaction.

---

# 21. Admin Workflow

Administrators may:

- Select recommendation mode.
- Pin featured products.
- Review recommended products.
- View recommendation analytics.
- Review conversion metrics.

Administrative configuration must be enforced server-side.

---

# 22. Recommendation Analytics

Possible metrics include:

```text
Recommendations Shown
Recommendation Clicks
Add-to-Cart After Recommendation
Purchases After Recommendation
Conversion Rate
Most Recommended Products
```

A recommendation conversion metric should use a clearly defined denominator.

---

# 23. Recommendation Events

The system may track:

```text
recommendation.shown
recommendation.clicked
recommendation.added_to_cart
recommendation.converted
```

The event catalog should remain centralized.

---

# 24. No Recommendation History

If the user has insufficient behavior:

```text
No User History
 ↓
Popular Products
```

The recommendation system must always have a fallback where the feature is displayed.

---

# 25. No Results

If no suitable recommendation exists:

```text
No Recommendation Candidates
 ↓
Hide Section
```

The empty state must not break the page layout.

---

# 26. AI Service Failure

If FastAPI is unavailable:

```text
AI Failure
 ↓
Backend Fallback
 ↓
Rule-Based / Popular Recommendations
```

Recommendation failure must never break:

```text
Product Page
Cart
Checkout
Orders
```

---

# 27. Caching

Recommendations may be cached where appropriate.

Potential caching targets include:

```text
Popular Products
Category Recommendations
Frequently Bought Together
```

Cache keys and invalidation must account for model/embedding version, catalog changes, and relevant interaction changes. Personalized recommendations must consider user-specific cache isolation.

Never return one user's personalized recommendations to another user.

---

# 28. Performance

Recommendation processing should:

- Avoid expensive calculations on every page render.
- Limit the number of returned candidates.
- Use efficient database queries.
- Use indexes appropriate to recommendation queries.
- Cache stable recommendation sets where useful.
- Avoid blocking checkout or order operations.

---

# 29. Privacy

Recommendation systems should follow data minimization.

Do not use or store:

```text
Passwords
OTP Values
Payment Credentials
JWTs
Refresh Tokens
```

Behavioral data should contain only what is necessary for recommendation functionality.

---

# 30. Security

Recommendation APIs must enforce:

- Authentication where required.
- Authorization.
- Input validation.
- Rate limiting where appropriate.
- Product-result validation.

Recommendation results must never expose unauthorized data.

---

# 31. Accessibility

Recommendation sections must provide:

- Accessible headings.
- Keyboard navigation.
- Accessible product cards.
- Visible focus states.
- Meaningful image alternative text.
- Non-color-only status indicators.

Recommendations must remain usable with assistive technologies.

---

# 32. Responsive Design

Recommendation layouts must support:

```text
Desktop
Tablet
Mobile
```

Product cards should follow the approved responsive design system.

---

# 33. Testing

Testing should cover:

```text
Popular Recommendations
Category Recommendations
Similar Products
Frequently Bought Together
Purchase History
Personalization
Anonymous User Fallback
No History Fallback
No Results
Recommendation Ranking
Admin Configuration
Analytics
Caching
Cache Isolation
FastAPI Failure
Backend Validation
Authorization
```

---

# 34. Definition of Done

The recommender is complete when:

- Required recommendation modes work.
- Customer recommendations appear in approved UI locations.
- Anonymous-user fallback works.
- Personalized behavior works where required.
- Recommendation results are backend-validated.
- FastAPI embedding-based recommendations and pgvector retrieval work.
- Shared embedding compatibility and catalog refresh are verified.
- Relevance, coverage, baseline comparisons, and limitations are documented.
- Rule-based fallback works.
- Recommendation analytics work.
- Cache behavior is safe.
- User data is isolated.
- Security controls are enforced.
- Accessibility is verified.
- Responsive behavior is verified.
- Tests pass.
- Documentation matches implementation.

---

# 35. AI Recommendation Principle

> **The recommender enhances product discovery through explainable and replaceable recommendation strategies while keeping product truth, authorization, and commerce logic inside the main backend.**


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
