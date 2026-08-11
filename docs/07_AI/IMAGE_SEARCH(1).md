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

FastAPI is responsible for:

```text
Image Input
 ↓
Image Processing
 ↓
Feature / Similarity Processing
 ↓
Candidate Product References
```

The service should return structured results rather than commerce-specific HTML or frontend data.

Example conceptual response:

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

The exact API contract is defined by the AI architecture and API guidelines.

---

# 10. Academic / Portfolio Implementation

The image matching system may use simulated or simplified matching logic.

This is explicitly acceptable for the portfolio project.

Possible demonstration approaches include:

```text
Image Metadata
 ↓
Product Category
 ↓
Predefined Similarity Mapping
```

or:

```text
Image
 ↓
Simplified Feature Extraction
 ↓
Similarity Score
 ↓
Product Candidates
```

The UI must not falsely claim that a simulated system is a production-grade computer-vision model.

---

# 11. Real AI Extension

The architecture should allow future replacement of the simplified matcher with a real model.

```text
Current
FastAPI
 ↓
Simplified Matching

Future
FastAPI
 ↓
Embedding Model
 ↓
Vector Similarity
 ↓
Product Candidates
```

The frontend and core commerce backend should not need major architectural changes.

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

# 21. Cloudinary

Cloudinary is intended for product media.

Customer search images should not automatically be stored in Cloudinary.

Product catalog images and customer search inputs are separate data categories.

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
- Matching products are returned.
- Backend validates AI results.
- Similarity ranking works.
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
