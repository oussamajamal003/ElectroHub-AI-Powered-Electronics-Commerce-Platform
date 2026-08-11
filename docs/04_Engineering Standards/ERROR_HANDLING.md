# Error Handling

## 1. Purpose

This document defines the error-handling standards for ElectroHub.

The goal is to ensure failures are:

- Detected.
- Handled consistently.
- Safe for users.
- Useful for developers.
- Observable in production.
- Recoverable where possible.

Error handling applies across the frontend, backend, AI service, external integrations, and asynchronous workflows.

---

## 2. Core Principles

Errors must be handled intentionally.

The system should:

- Fail safely.
- Preserve useful diagnostic information.
- Avoid exposing internal implementation details.
- Provide actionable user feedback.
- Distinguish expected errors from unexpected failures.
- Log appropriate operational information.
- Avoid silently swallowing failures.

---

## 3. Error Categories

ElectroHub should distinguish between:

```text
Validation Errors
Authentication Errors
Authorization Errors
Not Found Errors
Conflict Errors
Business Rule Errors
External Service Errors
Database Errors
Network Errors
Unexpected / System Errors
```

Each category should have an appropriate response and handling strategy.

---

## 4. Backend Error Flow

Backend errors should follow:

```text
Request
 ↓
Validation
 ↓
Controller
 ↓
Service
 ↓
Repository / External Service
 ↓
Error
 ↓
Error Handling Layer
 ↓
Safe API Response
```

Controllers should not expose raw internal exceptions directly to clients.

---

## 5. Expected Errors

Expected errors should be represented using controlled application errors.

Examples:

```text
Invalid credentials
Product not found
Insufficient inventory
Order not found
Unauthorized operation
Payment declined
Invalid OTP
Expired OTP
```

These errors should return predictable HTTP status codes and safe messages.

---

## 6. Unexpected Errors

Unexpected failures include:

```text
Unhandled exceptions
Programming errors
Unexpected database failures
Unavailable infrastructure
Unexpected third-party responses
```

These should:

- Be captured by centralized error handling.
- Be logged with diagnostic context.
- Return a generic safe response to the client.
- Never expose stack traces in production responses.

---

## 7. API Error Contract

API errors should follow the documented API structure.

Example:

```json
{
  "error": {
    "code": "PRODUCT_NOT_FOUND",
    "message": "Product not found."
  }
}
```

Validation errors may include safe details:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request.",
    "details": {}
  }
}
```

The response must not contain secrets or sensitive internal details.

---

## 8. HTTP Status Mapping

Use meaningful status codes.

```text
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Unprocessable Entity
429 Too Many Requests
500 Internal Server Error
502 Bad Gateway
503 Service Unavailable
```

Do not return `200 OK` when an operation actually failed.

---

## 9. Validation Errors

Invalid input should fail before business logic executes.

```text
Request
 ↓
Runtime Validation
 ↓
Invalid?
 ├── Yes → Validation Error
 └── No  → Business Logic
```

Validation should cover:

- Request body.
- Query parameters.
- Route parameters.
- Uploaded files.
- Authentication-related input.

---

## 10. Authentication Errors

Authentication failures should not reveal sensitive information.

Avoid responses that distinguish unnecessarily between:

```text
User does not exist
Password is wrong
```

where that distinction could enable account enumeration.

Authentication errors should use safe messages and appropriate rate limiting.

---

## 11. Authorization Errors

Authorization failures should be handled separately from authentication.

```text
Unauthenticated
    ↓
401

Authenticated but not permitted
    ↓
403
```

Resource ownership must also be verified.

---

## 12. OTP Errors

OTP operations require specific error handling.

Possible cases:

```text
Invalid OTP
Expired OTP
Already Used OTP
Too Many Attempts
Too Many Requests
Brevo Unavailable
```

OTP failures must not expose the stored OTP or internal verification details.

---

## 13. Payment Errors

Payment errors require special care.

Examples:

```text
Payment Declined
Payment Failed
Payment Expired
Invalid Payment State
Stripe Unavailable
```

The frontend must not determine payment success independently.

The backend must verify the authoritative payment state.

---

## 14. Order Errors

Order creation must protect against partial failure.

Important cases include:

```text
Invalid Cart
Insufficient Inventory
Payment Failure
Duplicate Order Attempt
Database Failure
Email Failure
PDF Generation Failure
```

Critical order/payment state must not be incorrectly rolled back or marked successful because a non-critical notification failed.

---

## 15. Email Errors

Brevo is an external dependency.

If an order is successfully created but the confirmation email fails:

```text
Order State
    ↓
Remains Successful
    ↓
Email Failure
    ↓
Log / Retry / Operational Handling
```

Email delivery should not incorrectly invalidate an already-authoritative order unless the business requirements explicitly require it.

---

## 16. PDF Generation Errors

Invoice and payment receipt generation failures should be handled independently.

```text
Order / Payment
 ↓
PDF Generation
 ├── Success → Document Available
 └── Failure → Safe Error + Logging
```

A PDF-generation failure must not falsely indicate that the underlying order or payment failed.

---

## 17. AI Service Errors

FastAPI may become temporarily unavailable.

The backend should handle:

```text
Timeout
Connection Failure
Invalid AI Response
Service Unavailable
Processing Failure
```

Where appropriate, the application may provide graceful degradation, such as:

```text
Recommendations unavailable
Image search temporarily unavailable
```

Core commerce functionality should not fail solely because optional AI functionality is unavailable.

---

## 18. External Service Failures

External services include:

```text
Stripe
Brevo
Cloudinary
FastAPI
Supabase
```

External failures should be:

- Detected.
- Logged.
- Converted into safe application-level errors.
- Retried only when safe.
- Prevented from leaking provider internals.

---

## 19. Retry Strategy

Retries should only be used when they are safe.

Good candidates may include transient:

```text
Network failures
Temporary external service unavailability
```

Avoid blindly retrying:

```text
Payment creation
Order creation
Non-idempotent operations
```

Use idempotency or reconciliation where duplicate execution is possible.

---

## 20. Database Errors

Database failures should be handled centrally.

The system should distinguish where possible between:

```text
Not Found
Constraint Violation
Conflict
Connection Failure
Transaction Failure
Unexpected Database Error
```

Raw database errors must not be returned to users.

---

## 21. Transactions

Operations that require atomicity should use appropriate Prisma transactions.

Example:

```text
Create Order
+
Create Order Items
+
Update Inventory
```

If these operations must succeed together, they should be coordinated transactionally.

External services remain outside the database transaction boundary and require explicit failure handling.

---

## 22. Frontend Error Handling

The frontend should translate API failures into appropriate UI states.

Examples:

```text
Toast
Inline Validation
Error Banner
Empty State
Retry Action
Full Error Page
```

Avoid displaying raw API errors directly when they are not intended for users.

---

## 23. React Query Errors

React Query operations should define appropriate error behavior.

For example:

```text
Query Failure
 ↓
Error State
 ↓
User Feedback
 ↓
Retry
```

Critical operations should provide clear failure feedback.

---

## 24. Forms

Form errors should be displayed close to the relevant input where possible.

Example:

```text
Email
[ invalid@email ]

Please enter a valid email address.
```

Server-side validation errors should be mapped back into the form when appropriate.

---

## 25. Loading, Error, and Empty States

Data-driven UI should distinguish:

```text
Loading
Success with Data
Success with Empty Data
Error
```

These states must not be conflated.

---

## 26. Error Boundaries

React error boundaries should protect appropriate UI sections from unexpected rendering failures.

A failure in one isolated feature should not unnecessarily crash the entire application.

The fallback UI should provide:

- Clear feedback.
- Recovery/retry where possible.
- Navigation to a safe location where appropriate.

---

## 27. Logging

Errors should be logged with enough context to diagnose the problem.

Useful context may include:

```text
Timestamp
Request ID
Route
Operation
User ID where appropriate and safe
Error Code
External Service
Environment
```

Do not log secrets or sensitive payment/authentication information.

Detailed logging standards are defined in `LOGGING.md`.

---

## 28. Request Correlation

Important backend operations should support request/trace correlation where practical.

Conceptually:

```text
Client Request
 ↓
Request ID
 ↓
Controller
 ↓
Service
 ↓
Database / External Service
```

This makes distributed failures easier to investigate.

---

## 29. User-Facing Messages

User-facing errors should be:

- Clear.
- Concise.
- Non-technical.
- Actionable where possible.

Prefer:

```text
Payment could not be completed. Please try again.
```

Avoid:

```text
PrismaClientKnownRequestError: P2002...
```

---

## 30. Security Requirements

Never expose:

```text
Stack traces
Database connection strings
JWT secrets
API keys
Stripe secrets
Brevo credentials
Cloudinary secrets
Internal file paths
Raw SQL
```

Production error responses must be sanitized.

---

## 31. Monitoring and Alerts

Critical recurring failures should be observable.

Examples:

```text
Repeated payment failures
Database connectivity failures
AI service downtime
Email delivery failures
High API error rates
```

Monitoring and operational response are documented separately.

---

## 32. Testing Error Handling

Tests should verify important failure paths.

Examples:

```text
Invalid Input
Unauthorized Request
Forbidden Request
Not Found
Insufficient Inventory
Payment Failure
OTP Failure
Email Failure
PDF Failure
AI Failure
Database Failure
Network Failure
```

Critical error paths should be included in integration/E2E coverage where appropriate.

---

## 33. Error Handling Completion Criteria

Error handling is production-ready when:

- Expected errors are represented consistently.
- Unexpected errors are centrally handled.
- API responses are safe.
- Authentication and authorization failures are protected.
- Payment/order failures are handled correctly.
- External service failures are isolated.
- Frontend error states are implemented.
- Errors are logged appropriately.
- Sensitive information is never exposed.
- Critical failure paths are tested.

---

## 34. Error Handling Principle

> **Fail safely, communicate clearly, preserve diagnostic context, and never allow an error in an optional dependency to corrupt authoritative business state.**
