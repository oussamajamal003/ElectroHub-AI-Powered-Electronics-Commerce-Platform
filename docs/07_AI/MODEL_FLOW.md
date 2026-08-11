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

# 5. Image Matching

The implementation may use either:

```text
Simplified / Simulated Matching
```

or:

```text
Real Embedding / Similarity Model
```

The architecture supports both.

---

# 6. Simulated Matching Flow

A simple academic implementation may use:

```text
Image
 ↓
Basic Feature / Metadata Extraction
 ↓
Category Detection or Mapping
 ↓
Candidate Product Set
 ↓
Similarity Score
 ↓
Rank Results
```

This is acceptable for the portfolio demonstration.

---

# 7. Real Similarity Flow

A future implementation may use:

```text
Image
 ↓
Preprocessing
 ↓
Embedding Model
 ↓
Image Vector
 ↓
Product Image Vectors
 ↓
Similarity Calculation
 ↓
Top-K Candidates
```

The FastAPI service can own the model inference.

The product database remains the commerce source of truth.

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

# 10. Rule-Based Recommendation Flow

The portfolio implementation may use:

```text
Current Product
 ↓
Category
 ↓
Related Products
 ↓
Popularity / Purchase Signals
 ↓
Rank
 ↓
Return Recommendations
```

This provides explainable recommendation behavior without requiring model training.

---

# 11. Personalized Recommendation Flow

For authenticated users:

```text
User
 ↓
Historical Activity
 ↓
Preferred Categories / Products
 ↓
Candidate Products
 ↓
Ranking
 ↓
Personalized Results
```

If insufficient history exists:

```text
No User History
 ↓
Popular / Category Recommendations
```

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

Where real models are used, the service should expose or internally track:

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
- Model versioning is documented where applicable.
- Tests verify critical flows.
- Documentation matches implementation.
