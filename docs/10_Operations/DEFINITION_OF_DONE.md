# Definition of Done

## 1. Purpose

This document defines the completion criteria for ElectroHub development work.

A task is considered Done only when implementation, testing, documentation, and review requirements have been satisfied.

---

# 2. General Definition of Done

A task is Done when:

- [ ] Requirements are implemented.
- [ ] Acceptance criteria are satisfied.
- [ ] Code follows project standards.
- [ ] Relevant tests are implemented.
- [ ] Relevant tests pass.
- [ ] Error handling is implemented.
- [ ] Security requirements are satisfied.
- [ ] Documentation is updated where required.
- [ ] No critical regression is introduced.
- [ ] Code review is complete.
- [ ] CI checks pass where applicable.

---

# 3. Feature Completion

A feature must include:

```text
Requirements
 ↓
Design
 ↓
Implementation
 ↓
Validation
 ↓
Testing
 ↓
Documentation
 ↓
Review
```

A feature is not complete merely because the primary UI or API exists.

---

# 4. Frontend Completion

Frontend work is Done when:

- [ ] Figma design requirements are respected.
- [ ] Responsive behavior is implemented.
- [ ] Accessibility requirements are considered.
- [ ] Loading states exist where needed.
- [ ] Error states exist where needed.
- [ ] Empty states exist where needed.
- [ ] Forms validate correctly.
- [ ] API failures are handled.
- [ ] Relevant tests pass.
- [ ] No unnecessary styling duplication is introduced.

---

# 5. Backend Completion

Backend work is Done when:

- [ ] API contract is implemented.
- [ ] Authentication is enforced where required.
- [ ] Authorization is enforced.
- [ ] Input validation exists.
- [ ] Business rules are enforced server-side.
- [ ] Error handling is consistent.
- [ ] Database operations are correct.
- [ ] Transactions are used where required.
- [ ] Logging does not expose sensitive data.
- [ ] Relevant tests pass.

---

# 6. Database Completion

Database changes are Done when:

- [ ] Prisma schema is correct.
- [ ] Relationships are correct.
- [ ] Constraints are reviewed.
- [ ] Required indexes are considered.
- [ ] Migration is created.
- [ ] Migration is tested.
- [ ] Existing data compatibility is considered.
- [ ] Database documentation is updated where required.

---

# 7. AI Completion

AI functionality is Done when:

- [ ] API contract is defined.
- [ ] Input validation exists.
- [ ] AI service errors are handled.
- [ ] Timeouts/resource limits are considered.
- [ ] Backend validates AI results.
- [ ] Fallback behavior exists where required.
- [ ] Relevant tests pass.
- [ ] AI documentation is updated.

---

# 8. Payment Completion

Payment functionality is Done when:

- [ ] Stripe Test Mode is used.
- [ ] Payment status is verified server-side.
- [ ] Failure scenarios are handled.
- [ ] Duplicate events are handled safely.
- [ ] Order/payment state remains consistent.
- [ ] Payment confirmation email via Brevo works where required.
- [ ] Payment receipt PDF generation works where required.
- [ ] Sensitive payment information is protected.

No real customer payments are processed.

---

# 9. Order Completion

Order functionality is Done when:

- [ ] Order creation works.
- [ ] Order items are correct.
- [ ] Inventory is validated.
- [ ] Payment state is correct.
- [ ] Order status transitions are valid.
- [ ] Order confirmation email via Brevo works.
- [ ] Order invoice PDF works.
- [ ] Customer ownership is enforced.

---

# 10. Security Completion

Security requirements are Done when:

- [ ] Authentication is protected.
- [ ] Authorization is enforced.
- [ ] Input is validated.
- [ ] Secrets are protected.
- [ ] Sensitive information is not logged.
- [ ] File uploads are validated.
- [ ] Customer data isolation is verified.
- [ ] Protected documents are access-controlled.

---

# 11. Testing Completion

Testing is Done when the appropriate level has passed:

```text
Unit
 ↓
Integration
 ↓
E2E
```

Not every task requires every test layer, but critical workflows must have sufficient coverage.

---

# 12. Documentation Completion

Documentation must be updated when implementation changes:

```text
Architecture
API Contracts
Database
Features
Security
Deployment
Workflow
ADR
```

Documentation must not knowingly describe functionality that does not exist.

---

# 13. Review Completion

A task is not Done until review confirms:

- [ ] Requirements are satisfied.
- [ ] No architectural regression exists.
- [ ] Security issues are addressed.
- [ ] Edge cases are considered.
- [ ] Performance impact is acceptable.
- [ ] Tests provide evidence.
- [ ] Documentation is consistent.

---

# 14. Release Completion

A release is Done when:

- [ ] Release checklist passes.
- [ ] CI passes.
- [ ] Production build succeeds.
- [ ] Deployment succeeds.
- [ ] Health checks pass.
- [ ] Smoke tests pass.
- [ ] Monitoring is available.
- [ ] Rollback is documented.

---

# 15. Evidence Requirement

Claims of completion must be supported by evidence.

Examples:

```text
Test Output
CI Result
Build Result
Screenshot
API Response
Migration Result
Deployment Health Check
```

Never mark a task complete solely because code was written.

---

# 16. Definition of Done Principle

> **Done means verified and reviewable, not merely implemented.**
