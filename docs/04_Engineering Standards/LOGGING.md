# Logging

## 1. Purpose

This document defines logging standards for ElectroHub.

Logging exists to support:

- Debugging.
- Monitoring.
- Incident investigation.
- Security auditing.
- Performance analysis.
- Production troubleshooting.

Logs must provide useful operational information without exposing secrets or sensitive data.

---

## 2. Logging Principles

Logs should be:

- Structured.
- Consistent.
- Actionable.
- Searchable.
- Environment-aware.
- Safe.

Avoid logging simply because information is available.

Every production log should have a useful operational purpose.

---

## 3. Log Levels

Use appropriate severity levels.

```text
DEBUG
INFO
WARN
ERROR
```

### DEBUG

Detailed development information.

Examples:

```text
Cache decisions
Detailed request flow
Development diagnostics
```

DEBUG logging should generally be disabled or minimized in production.

### INFO

Normal important operational events.

Examples:

```text
Server started
Order created
Payment verified
Deployment completed
```

### WARN

Unexpected but recoverable conditions.

Examples:

```text
Retrying external request
AI service temporarily unavailable
Email delivery retry
Low-stock threshold reached
```

### ERROR

Failures requiring investigation or operational attention.

Examples:

```text
Database failure
Unhandled exception
Payment integration failure
Critical external service failure
```

---

## 4. Structured Logging

Prefer structured logs rather than unstructured strings.

Conceptually:

```json
{
  "level": "info",
  "event": "order.created",
  "orderId": "order-123",
  "timestamp": "..."
}
```

Structured logs make filtering and analysis easier.

---

## 5. Event Names

Use consistent event names.

Examples:

```text
auth.login.success
auth.login.failure
auth.otp.requested
auth.otp.verified
order.created
order.status.updated
payment.created
payment.succeeded
payment.failed
email.sent
email.failed
pdf.generated
pdf.failed
delivery.updated
ai.request.failed
```

Event names should describe what happened rather than how it was implemented.

---

## 6. Request Logging

API requests may log:

```text
Request ID
HTTP Method
Route
Status Code
Duration
Environment
```

Avoid logging sensitive request bodies by default.

---

## 7. Request IDs

Requests should use a correlation/request ID where practical.

Conceptually:

```text
Request
 ↓
requestId
 ↓
Controller
 ↓
Service
 ↓
Database / External Service
```

The same identifier allows related events to be traced.

---

## 8. User Context

User context may be logged when operationally useful.

For example:

```text
userId
role
```

Do not log unnecessary personal information.

Never use logs as a general-purpose user-data store.

---

## 9. Authentication Logging

Authentication events may include:

```text
Login Success
Login Failure
Logout
OTP Requested
OTP Verification Success
OTP Verification Failure
Refresh Token Events
```

Never log:

```text
Password
OTP Value
JWT Token
Refresh Token
Authentication Secrets
```

---

## 10. Authorization Logging

Important authorization failures should be logged when useful for security monitoring.

Example:

```text
auth.authorization.denied
```

Useful context may include:

```text
requestId
userId
route
resource
required role
```

Do not expose sensitive information unnecessarily.

---

## 11. Payment Logging

Payment logging should be carefully limited.

Safe operational events include:

```text
payment.created
payment.succeeded
payment.failed
payment.verification.failed
```

Log identifiers and statuses where appropriate.

Never log:

```text
Card number
CVV
Payment secret
Stripe secret key
Sensitive payment credentials
```

---

## 12. Order Logging

Important order events may include:

```text
order.created
order.status.updated
order.cancelled
order.failed
```

Useful context:

```text
orderId
userId
status
requestId
```

Avoid logging complete shipping addresses or other unnecessary personal information.

---

## 13. Inventory Logging

Inventory events may include:

```text
inventory.updated
inventory.low_stock
inventory.insufficient
```

Useful context:

```text
productId
quantity change
remaining quantity
requestId
```

Do not log unnecessary customer information.

---

## 14. Delivery Logging

Delivery updates may include:

```text
delivery.status.updated
delivery.location.updated
delivery.notification.sent
```

Useful context:

```text
orderId
status
requestId
```

Sensitive location information should only be logged when operationally necessary.

---

## 15. Email Logging

Brevo operations may log:

```text
email.requested
email.sent
email.failed
email.retry
```

Useful context:

```text
event type
recipient identifier where safe
message/template identifier
provider response code
requestId
```

Never log:

```text
Brevo API key
OTP value
Sensitive email contents
```

---

## 16. PDF Logging

PDF operations may log:

```text
pdf.requested
pdf.generated
pdf.failed
```

Useful context:

```text
document type
orderId
userId where appropriate
requestId
duration
```

Do not log the complete contents of generated documents.

---

## 17. AI Logging

AI operations may log:

```text
ai.image_search.requested
ai.image_search.completed
ai.image_search.failed
ai.recommendation.requested
ai.recommendation.failed
```

Useful context:

```text
requestId
operation
duration
result count
service status
```

Do not log uploaded image contents or sensitive user data unnecessarily.

---

## 18. Database Logging

Database logs should focus on operational failures.

Examples:

```text
database.connection.failed
database.query.failed
database.transaction.failed
```

Avoid logging full SQL queries when they could contain sensitive parameters.

Never log database credentials or connection strings.

---

## 19. External Service Logging

External integrations include:

```text
Stripe
Brevo
Cloudinary
FastAPI
Supabase
```

Log:

```text
Service
Operation
Success / Failure
Status
Duration
Request ID
```

Do not expose provider credentials.

---

## 20. Error Logging

Errors should include enough context for diagnosis.

Example:

```json
{
  "level": "error",
  "event": "payment.failed",
  "requestId": "req-123",
  "orderId": "order-123",
  "errorCode": "PAYMENT_FAILED"
}
```

Stack traces may be recorded in secure server-side logs for unexpected errors, but must never be returned to clients.

---

## 21. Sensitive Data

Never log:

```text
Passwords
OTP codes
JWT tokens
Refresh tokens
API keys
Stripe secrets
Brevo credentials
Cloudinary secrets
Database passwords
Card data
CVV
Private keys
```

Avoid unnecessary logging of:

```text
Email addresses
Phone numbers
Shipping addresses
Precise location data
Full request bodies
```

---

## 22. Production Logging

Production logs should prioritize:

```text
INFO
WARN
ERROR
```

DEBUG logs should be disabled or restricted unless temporarily required for an approved incident investigation.

Temporary verbose logging must be removed or disabled after investigation.

---

## 23. Log Retention

Log retention should follow the deployment and operational environment.

Logs should not be retained indefinitely without a business or operational reason.

Retention policies should balance:

```text
Debugging
Security
Cost
Privacy
Compliance
```

---

## 24. Log Rotation

Server-side logs should be rotated or managed by the deployment platform to prevent uncontrolled disk growth.

The production environment must not allow logs to consume all available disk space.

---

## 25. Monitoring

Important log events should support monitoring and alerting.

Potential alerts include:

```text
High 5xx rate
Database unavailable
Repeated payment failures
Repeated authentication failures
AI service unavailable
Email delivery failures
Disk usage warnings
Container failures
```

---

## 26. Performance Logging

Expensive operations may record duration.

Examples:

```text
API request duration
Database operation duration
AI processing duration
PDF generation duration
External API duration
```

Performance logs should be used to identify measurable bottlenecks.

---

## 27. Frontend Logging

Frontend logging should be minimal in production.

Avoid leaving:

```ts
console.log(...)
console.debug(...)
```

in production code unless explicitly justified.

Unexpected frontend errors should be surfaced through the approved monitoring/error-reporting strategy when implemented.

Never log secrets or sensitive user information.

---

## 28. Logging and Privacy

Logging must follow data minimization.

Before adding a field to a log, ask:

```text
Is this required to diagnose or operate the system?
```

If not, do not log it.

---

## 29. Logging and Security

Logs can contain sensitive operational information and must be treated as protected infrastructure.

Access should be limited to authorized personnel.

Logs should not become an alternative database for sensitive information.

---

## 30. Testing Logging

Tests should verify critical logging behavior where appropriate.

Examples:

```text
Payment failure is logged
Authorization denial is logged
Unexpected server error is logged
External service failure is logged
Sensitive values are not logged
```

Do not make tests depend unnecessarily on exact log formatting.

---

## 31. Logging Completion Criteria

Logging is production-ready when:

- Important operational events are logged.
- Log levels are used consistently.
- Logs are structured where practical.
- Request correlation exists where appropriate.
- Errors contain useful diagnostic context.
- Sensitive information is excluded.
- Production DEBUG logging is controlled.
- Log rotation/retention is defined.
- Critical failures can be monitored.
- Temporary debug logging has been removed.

---

## 32. Logging Principle

> **Log enough to understand what happened, but never enough to expose secrets or unnecessary personal data.**
