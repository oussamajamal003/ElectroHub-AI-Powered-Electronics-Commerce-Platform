# Code Review

## 1. Purpose

This document defines the code-review standards for ElectroHub.

Code review exists to verify:

```text
Correctness
Architecture
Security
Testing
Performance
Maintainability
Documentation
```

---

# 2. Review Principle

Reviewers must evaluate evidence rather than assuming that an implementation works.

Statements such as:

```text
"It works"
"Tests pass"
"Secure"
"Production ready"
```

should be supported by appropriate evidence.

---

# 3. Requirements Review

Verify:

- [ ] Task requirements are satisfied.
- [ ] Acceptance criteria are satisfied.
- [ ] Scope is respected.
- [ ] Out-of-scope changes are identified.
- [ ] Edge cases are considered.

---

# 4. Architecture Review

Verify:

- [ ] Service boundaries remain clear.
- [ ] Frontend does not access the database directly.
- [ ] Backend owns business logic.
- [ ] AI service remains isolated.
- [ ] Database responsibilities remain appropriate.
- [ ] No unnecessary coupling is introduced.

---

# 5. Security Review

Check:

```text
Authentication
Authorization
Input Validation
Secrets
File Uploads
Data Isolation
API Security
Logging
External Services
```

Verify that sensitive operations are enforced server-side.

---

# 6. Database Review

Check:

- [ ] Schema correctness.
- [ ] Relationships.
- [ ] Constraints.
- [ ] Indexes.
- [ ] Migration safety.
- [ ] Transaction boundaries.
- [ ] Query efficiency.
- [ ] Data integrity.

Destructive migrations require additional scrutiny.

---

# 7. API Review

Verify:

```text
Request Validation
Response Contract
HTTP Status Codes
Authentication
Authorization
Error Handling
Pagination
Rate Limiting where required
```

Check for accidental breaking changes.

---

# 8. Frontend Review

Verify:

```text
Component Structure
State Management
API Usage
Loading States
Error States
Empty States
Responsive Behavior
Accessibility
Styling Consistency
```

The implementation must follow the approved Figma/design system where applicable.

---

# 9. AI Review

Verify:

```text
Input Validation
Timeouts
Resource Limits
Error Handling
Fallbacks
Output Validation
```

AI output must not bypass commerce business rules.

---

# 10. Payment Review

For payment-related changes verify:

- [ ] Stripe Test Mode is used.
- [ ] Payment state is server-verified.
- [ ] Webhook handling is safe.
- [ ] Duplicate events are handled.
- [ ] Order/payment consistency is preserved.
- [ ] Payment confirmation email is correct.
- [ ] Payment receipt PDF is authorized.

---

# 11. Order Review

Verify:

```text
Order Creation
Inventory
Payment
Order State
Delivery
Email
Invoice PDF
Authorization
```

Customers must not access another customer's orders or documents.

---

# 12. Testing Review

Check:

- [ ] Unit tests where appropriate.
- [ ] Integration tests for service boundaries.
- [ ] E2E tests for critical workflows.
- [ ] Negative cases.
- [ ] Regression coverage.
- [ ] Tests actually exercise the changed behavior.

Do not accept tests that only prove mocks were called without verifying meaningful behavior.

---

# 13. Performance Review

Check for:

```text
N+1 Queries
Unnecessary Requests
Large Payloads
Unnecessary Re-renders
Unbounded Lists
Expensive AI Processing
Unnecessary PDF Generation
```

Performance concerns should be supported by evidence where significant.

---

# 14. Dependency Review

Verify:

- [ ] New dependencies are justified.
- [ ] Versions are controlled.
- [ ] Security implications are considered.
- [ ] Bundle/container impact is reasonable.
- [ ] Licenses are acceptable where applicable.

---

# 15. Documentation Review

Verify that implementation changes are reflected in relevant documentation.

Potential areas:

```text
Architecture
Features
Database
AI
Security
Deployment
Workflow
ADR
Changelog
```

---

# 16. Review Severity

Use:

```text
Critical
High
Medium
Low
Nit
```

## Critical

Security vulnerability, data loss, severe corruption, or release-blocking failure.

## High

Major functional, architectural, security, or reliability issue.

## Medium

Important defect or maintainability concern that should normally be fixed before merge.

## Low

Minor issue that does not materially affect correctness.

## Nit

Optional style or readability improvement.

---

# 17. Review Decision

```text
✅ Approve
⚠ Request Changes
❌ Reject
```

Approval requires sufficient evidence that the implementation is complete and safe to merge.

---

# 18. Review Report

Recommended format:

```text
Score: XX/100

Decision: APPROVE / REQUEST CHANGES / REJECT

Findings:
1. [Severity] Finding
   Evidence:
   Required Change:

2. [Severity] Finding
   Evidence:
   Required Change:

Testing:
- 

Security:
- 

Architecture:
- 

Performance:
- 

Documentation:
- 
```

---

# 19. Definition of Review Completion

A review is complete when:

- [ ] Requirements reviewed.
- [ ] Changed files reviewed.
- [ ] Architecture reviewed.
- [ ] Security reviewed.
- [ ] Edge cases reviewed.
- [ ] Performance reviewed.
- [ ] Database changes reviewed.
- [ ] API compatibility reviewed.
- [ ] Tests verified.
- [ ] Documentation verified.
- [ ] Decision recorded.

---

# 20. Code Review Principle

> **Reviewers approve evidence-backed implementations, not intentions or assumptions.**
