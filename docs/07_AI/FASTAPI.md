# FastAPI AI Service

## 1. Purpose

This document defines the FastAPI AI service used by ElectroHub.

FastAPI provides an isolated service boundary for AI-related processing.

Primary capabilities include:

- Image search processing.
- Recommendation processing where required.
- AI-specific preprocessing and scoring.
- Future model integration.

FastAPI does not own core commerce business logic.

---

# 2. Service Architecture

```text
React Frontend
      ↓
Node.js / Express Backend
      ↓
FastAPI AI Service
      ↓
AI Processing
      ↓
Structured Result
      ↓
Node.js / Express Backend
      ↓
React Frontend
```

The Node.js backend remains the authoritative application service.

---

# 3. Responsibilities

FastAPI is responsible for:

```text
Image Processing
Feature Extraction
Similarity Processing
Recommendation Processing
Model Inference
AI-Specific Validation
```

FastAPI is not responsible for:

```text
Authentication
Authorization
Cart
Orders
Payments
Inventory
Commerce Pricing
```

---

# 4. Service Isolation

The AI service must remain independently deployable.

```text
apps/
├── backend/
└── ai-service/
```

The AI service must communicate through explicit HTTP API contracts.

It must not import Node.js backend source code or directly manipulate frontend state.

---

# 5. Technology

The AI service uses:

```text
Python
FastAPI
Pydantic
Uvicorn
```

Additional ML/image-processing dependencies may be added only when required by the implemented AI functionality.

Dependencies must be documented and pinned appropriately.

---

# 6. API Contract

AI endpoints should use structured request and response models.

Conceptually:

```text
POST /api/ai/image-search
POST /api/ai/recommendations
```

The exact routes may evolve with the backend API architecture.

Requests and responses must be explicitly validated.

---

# 7. Image Search Request

Conceptually:

```text
POST /api/ai/image-search
Content-Type: multipart/form-data
```

Input:

```text
image
```

Possible optional parameters:

```text
category
limit
```

The final contract must be defined in the API documentation.

---

# 8. Image Search Response

Conceptually:

```json
{
  "matches": [
    {
      "productId": "product-id",
      "score": 0.91
    }
  ]
}
```

FastAPI returns product references and AI-related metadata.

It must not return authoritative:

```text
Price
Inventory
Payment Status
Order Status
```

Those values belong to the main backend/database.

---

# 9. Recommendation Request

Conceptually:

```text
POST /api/ai/recommendations
```

Possible inputs:

```text
userId or anonymized context
productId
category
behavioral context
recommendation mode
limit
```

Only the minimum required information should be sent.

---

# 10. Recommendation Response

Conceptually:

```json
{
  "recommendations": [
    {
      "productId": "product-id",
      "score": 0.88
    }
  ]
}
```

The Node.js backend validates returned product references before exposing them to customers.

---

# 11. Backend-to-AI Communication

The backend calls FastAPI as an internal service.

```text
Backend
 ↓
Validate Request
 ↓
FastAPI
 ↓
Validate AI Response
 ↓
Resolve Products
 ↓
Apply Business Rules
 ↓
Return Response
```

The backend must not blindly trust AI output.

---

# 12. AI Service Authentication

FastAPI endpoints must not be assumed to be public.

The deployment architecture should restrict access to the AI service where possible.

Internal communication may use:

```text
Private Network
+
Service Authentication
+
Environment-Based Secrets
```

The exact mechanism follows the deployment architecture.

---

# 13. Timeouts

AI requests must have explicit timeouts.

The backend must not wait indefinitely for FastAPI.

Possible failures:

```text
Timeout
Connection Failure
Invalid Response
Model Failure
```

The backend should return a controlled application-level response.

---

# 14. Failure Isolation

AI service failure must not break core commerce functionality.

The following must remain operational if FastAPI is unavailable:

```text
Product Catalog
Search
Cart
Checkout
Payments
Orders
Inventory
Delivery
```

AI-dependent features should provide an appropriate fallback.

---

# 15. Image Processing

Image processing should:

- Validate input.
- Limit input size.
- Resize oversized images where appropriate.
- Use safe temporary storage.
- Avoid executing uploaded content.
- Remove temporary data when processing completes.

The service should process only the minimum required image data.

---

# 16. Model Loading

If a real model is introduced, model initialization should not occur unnecessarily on every request.

Preferred architecture:

```text
FastAPI Startup
 ↓
Load Model
 ↓
Keep Model Available
 ↓
Process Requests
```

The implementation must consider memory usage and deployment limits.

---

# 17. Simulated AI Mode

The portfolio version may use simplified AI logic.

For example:

```text
Image
 ↓
Extract Simple Attributes
 ↓
Map to Product Category
 ↓
Return Similar Products
```

or:

```text
Product Context
 ↓
Category / Popularity Rules
 ↓
Recommendation Candidates
```

This is acceptable for demonstration purposes.

The documentation and UI must not falsely represent simulated logic as a trained production model.

---

# 18. Logging

FastAPI logs should include useful operational information without exposing sensitive data.

Good examples:

```text
Request Type
Processing Duration
Result Count
Model Version
Error Type
```

Do not log:

```text
Passwords
OTP Values
JWTs
Payment Credentials
Secret Keys
Raw Customer Images
```

---

# 19. Observability

The service should expose sufficient information for operational monitoring.

Potential health endpoint:

```text
GET /health
```

It may report:

```text
Service Status
Model Availability
Version
```

Health checks must not expose secrets.

---

# 20. Testing

FastAPI testing should cover:

```text
Request Validation
Image Validation
Successful Image Search
No Image
Invalid Image
Oversized Image
Recommendation Request
Invalid Recommendation Input
AI Result Validation
Timeout Handling
Service Failure
Health Endpoint
```

Model-dependent tests should use deterministic fixtures where possible.

---

# 21. Performance

The service should:

- Avoid unnecessary image processing.
- Limit request sizes.
- Limit result counts.
- Reuse loaded models.
- Avoid blocking operations where practical.
- Apply explicit request timeouts.
- Monitor memory usage.

AI processing must not consume all resources on the shared deployment host.

---

# 22. Security

FastAPI must implement:

- Input validation.
- Request-size limits.
- Service authentication where required.
- Safe file handling.
- Dependency security.
- Secure error responses.
- No secret exposure.

The AI service is an internal trust boundary, not a reason to disable validation.

---

# 23. Docker

FastAPI should run as a separate container in development and production.

Conceptually:

```text
Docker Network
│
├── frontend
├── backend
└── ai-service
```

The service should have its own Docker configuration and dependency installation.

---

# 24. Environment Variables

AI configuration belongs in environment variables.

Examples:

```text
AI_SERVICE_PORT
AI_SERVICE_API_KEY
MODEL_PATH
MODEL_VERSION
```

Actual secret values must never be committed.

---

# 25. Deployment

The AI service is deployed with the application stack during the production phase.

Production infrastructure uses:

```text
DigitalOcean VPS
Ubuntu
Docker
Nginx
SSL
GitHub Actions
```

Nginx should not expose internal AI endpoints publicly unless explicitly required.

---

# 26. Definition of Done

The FastAPI service is complete when:

- FastAPI service starts correctly.
- Health check works.
- API contracts are defined.
- Image-search endpoint works.
- Recommendation endpoint works where required.
- Backend integration works.
- Request validation works.
- AI response validation works.
- Timeouts are configured.
- Failure isolation works.
- Security controls are implemented.
- Docker deployment works.
- Logging is safe.
- Tests pass.
- Documentation matches implementation.
