# AI Architecture

## 1. Purpose

This document defines the AI architecture for ElectroHub.

The AI layer is a separate FastAPI service isolated from core commerce business logic.

It supports:

- Search by image.
- Product similarity.
- Product recommendations.
- Future AI/ML capabilities.

Simulated or rule-based logic may be used for academic/demo purposes when explicitly documented.

## 2. Technology Stack

```text
Python
FastAPI
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
Authentication
Authorization
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

The exact implementation depends on the selected AI approach.

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

The architecture supports progressively more sophisticated recommendation logic.

## 13. Recommendation Flow

```text
Customer Behavior
 ↓
Backend
 ↓
Recommendation Service
 ↓
FastAPI AI Service where applicable
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

## 15. Simulated AI

For portfolio/academic demonstration, AI behavior may be simulated using:

```text
Category Similarity
Keyword Similarity
Product Metadata Matching
Weighted Scoring
Deterministic Ranking
```

When simulated:

- Documentation must state that it is simulated.
- The UI must not falsely claim a trained ML model produced the result.
- The interface should remain replaceable with a real model later.

## 16. Real ML Extension

Future implementations may use:

```text
Embedding Models
Vector Similarity
Computer Vision Models
Recommendation Models
Machine Learning Pipelines
```

The backend-facing contract should remain stable where practical.

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

The AI architecture is complete when FastAPI boundaries, backend communication, image search, recommendations, product-data ownership, security, error handling, performance, simulated-vs-real behavior, testing, Docker, and deployment are documented.

## 27. AI Principle

> **Keep AI processing isolated, keep commerce data authoritative in the backend/database, and design the AI interface so implementation can evolve without destabilizing the core platform.**
