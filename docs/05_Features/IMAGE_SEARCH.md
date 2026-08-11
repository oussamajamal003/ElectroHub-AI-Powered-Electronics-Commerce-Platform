# Image Search

## 1. Purpose

Image Search allows customers to discover similar electronics products using an uploaded image or a photo captured from the device camera.

The feature is designed as a high-impact product-discovery capability and integrates the React frontend, Node.js backend, and FastAPI AI service.

The implementation may use real computer-vision/ML functionality or controlled/simulated matching logic for academic demonstration, as defined by the project roadmap.

---

## 2. User Workflow

The customer workflow is:

```text
User Opens Image Search
        ↓
Choose Input Method
   ┌────┴────┐
 Upload     Camera
   │          │
   └────┬─────┘
        ↓
Image Validation
        ↓
Backend Upload / Processing
        ↓
FastAPI AI Service
        ↓
Similarity / Matching
        ↓
Matching Product References
        ↓
Product Catalog
        ↓
Results Displayed
        ↓
User Selects Product
        ↓
Product Details
```

---

## 3. Input Methods

The user can:

```text
Upload Image
Capture Photo
```

Camera capture uses browser/device camera capabilities where supported.

The application should provide a fallback to file upload when camera access is unavailable or denied.

---

## 4. Camera Access

Camera capture may use WebRTC/browser media APIs.

The browser requests camera permission before accessing the device camera.

The application must:

- Explain why camera access is required.
- Handle permission denial.
- Handle unsupported devices.
- Stop the camera stream when it is no longer required.
- Avoid keeping camera access active unnecessarily.

Camera access must remain user-controlled.

---

## 5. Upload Validation

Image uploads must be validated before processing.

Controls include:

```text
File Type
File Size
Image Dimensions
Content Validity
Processing Limits
```

Invalid uploads should fail with a clear user-facing message.

The backend must repeat important validation because frontend validation is not a security boundary.

---

## 6. Supported Image Types

The implementation should support common web image formats appropriate to the application.

Examples:

```text
JPEG
PNG
WebP
```

The final supported formats are determined by the backend and AI-service implementation.

---

## 7. Search Architecture

```text
React Frontend
      ↓
Node.js / Express API
      ↓
Validation
      ↓
FastAPI AI Service
      ↓
Image Analysis
      ↓
Product Matching
      ↓
Node.js Backend
      ↓
Product Data
      ↓
React Results
```

The backend remains the public API boundary.

The FastAPI service should not expose unnecessary internal AI implementation details.

---

## 8. Backend Responsibilities

The backend is responsible for:

- Authentication where required.
- File validation.
- Request limits.
- Forwarding the image to the AI service.
- Validating AI responses.
- Retrieving authoritative product data.
- Returning normalized product results.
- Error handling.
- Logging operational events.

---

## 9. FastAPI Responsibilities

The AI service is responsible for:

- Receiving validated image input.
- Image preprocessing.
- Similarity/matching logic.
- Returning product references or matching identifiers.
- Reporting processing failures.

The AI service must not become the owner of commerce business logic.

---

## 10. Matching Logic

The matching system may use:

```text
Real Image Similarity Model
```

or, where the roadmap allows academic simulation:

```text
Controlled / Simulated Matching
```

If simulated matching is used, it must be documented clearly and must not be represented as production-grade computer vision.

Possible matching signals include:

```text
Category
Product Tags
Image Metadata
Feature Similarity
Predefined Product Mapping
```

---

## 11. Product Result Resolution

The AI service should return product references rather than authoritative product objects where practical.

Flow:

```text
AI Service
 ↓
Product IDs / References
 ↓
Backend
 ↓
Database
 ↓
Validated Product Records
 ↓
Frontend
```

This ensures the backend remains the source of truth for product information, prices, inventory, and availability.

---

## 12. Results

Results should display appropriate product information such as:

```text
Product Image
Product Name
Price
Category
Availability
Similarity / Match Information where appropriate
```

The user can select a result to open the normal product details page.

---

## 13. Empty Results

If no suitable products are found, display a dedicated empty state.

Example:

```text
No similar products found.
Try another image or browse our categories.
```

The user should be able to:

```text
Try Again
Upload Another Image
Open Product Search
Browse Categories
```

---

## 14. Error Handling

Possible failures include:

```text
Invalid Image
Camera Permission Denied
Unsupported Browser
Upload Failure
AI Service Timeout
AI Service Unavailable
Invalid AI Response
No Matching Products
Network Failure
```

Optional AI functionality should fail gracefully without breaking core commerce functionality.

---

## 15. Performance

Image search must protect system resources.

Controls should include:

```text
Maximum File Size
Maximum Image Dimensions
Request Timeout
AI Processing Timeout
Result Limit
Rate Limiting
```

Images should be resized or optimized before expensive processing where appropriate.

---

## 16. Security

Image search must enforce:

- Input validation.
- File-size limits.
- File-type validation.
- Rate limiting where appropriate.
- Safe temporary storage.
- Authorization where required.
- No executable uploads.
- No sensitive image logging.

Uploaded images should not be retained longer than required unless the product requirements explicitly require storage.

---

## 17. Cloudinary

Cloudinary may be used for product images and controlled media storage.

Product images follow the normal catalog media architecture.

User search images should not automatically become permanent product assets.

---

## 18. Privacy

Camera and uploaded images may contain unintended personal information.

The system should:

- Request camera permission explicitly.
- Process only what is required.
- Avoid unnecessary retention.
- Avoid logging image contents.
- Clearly communicate how images are used where appropriate.

---

## 19. React Query

Image-search requests may be treated as server operations and integrated with the application's server-state strategy.

The UI should provide:

```text
Idle
Uploading
Processing
Success
Empty
Error
```

The implementation should avoid unnecessary repeated processing of the same request.

---

## 20. Accessibility

Image search must support:

- Keyboard navigation.
- Accessible upload controls.
- Accessible camera controls.
- Visible focus states.
- Screen-reader-friendly status messages.
- Clear error messages.
- Accessible result cards.

Camera permission denial must not leave the user trapped in the camera workflow.

---

## 21. Localization and RTL

The feature must support:

```text
English
Arabic / RTL
```

All user-facing labels and messages should be localized.

Layout must work correctly in RTL mode.

---

## 22. Admin Workflow

Administrators may support image-search quality through product metadata.

Possible operations include:

```text
Upload Product Images
Manage Image Metadata
Tag Products
Review Search Success Logs
```

Administrative operations require appropriate authorization.

---

## 23. Search Success Analytics

The system may record high-level image-search events such as:

```text
Search Requested
Search Completed
Results Returned
Product Selected
No Results
```

Analytics should not store unnecessary image contents or sensitive information.

---

## 24. API

A typical public application endpoint may be:

```text
POST /api/image-search
```

The exact request and response contract is defined by the backend implementation.

The frontend must not call the internal FastAPI service directly unless the architecture explicitly requires it.

---

## 25. Testing

Testing should include:

```text
Valid Upload
Invalid File
Oversized File
Camera Permission Granted
Camera Permission Denied
Unsupported Camera
No Results
Matching Results
AI Service Failure
AI Timeout
Network Failure
Rate Limit
Mobile Camera
Desktop Upload
Accessibility
RTL
```

Critical image-search workflows should be covered by E2E tests where practical.

---

## 26. Definition of Done

Image Search is complete when:

- Upload works.
- Camera capture works where supported.
- Camera fallback works.
- Image validation works.
- Backend validation works.
- FastAPI integration works.
- Matching results are returned.
- Product references are resolved by the backend.
- Empty/error states are handled.
- Resource limits exist.
- Accessibility is verified.
- RTL/localization is verified.
- Security requirements are met.
- Tests pass.
- Documentation matches the implementation.

---

## 27. Image Search Principle

> **Use AI-powered or clearly documented simulated similarity to create fast product discovery while keeping product data, authorization, and commerce decisions authoritative in the backend.**
