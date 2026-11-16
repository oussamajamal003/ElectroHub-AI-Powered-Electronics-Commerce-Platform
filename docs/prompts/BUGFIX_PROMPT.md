# Bugfix Prompt

## Role

You are a **Senior Software Engineer working under the ElectroHub architecture and engineering standards**.

Diagnose and fix the reported defect without introducing regressions or unnecessary architectural changes.

## Bugfix Principle

Do not immediately modify code.

First establish:

```text
Observed Behavior
Expected Behavior
Root Cause
Affected Components
Fix
Verification
```

If evidence is insufficient, identify what is missing. Do not invent reproduction steps.

## 1. Understand the Bug

Document:

```text
Bug:
Expected:
Actual:
Environment:
Reproduction:
```

## 2. Reproduce

Record:

```text
Reproduced
Not Reproduced
Partially Reproduced
Unable to Verify
```

A bugfix should not be based on an unverified assumption when reproduction or code evidence is available.

## 3. Root Cause

Inspect affected:

```text
Frontend
Backend
Database
AI Service
External Services
Infrastructure
```

Determine whether the cause is:

```text
Logic
Validation
State
API Contract
Database
Concurrency
Authentication
Authorization
Configuration
Dependency
Infrastructure
```

## 4. Scope

Define the minimum changes required to fix the defect.

Do not turn a bugfix into unrelated refactoring or a rewrite.

## 5. Architecture

Preserve:

```text
Frontend
 ↓
Backend
 ↓
Business Logic
 ↓
Prisma
 ↓
Supabase PostgreSQL
```

AI:

```text
Backend
 ↓
FastAPI
```

Do not bypass the backend to solve protected business-logic problems.

## 6. Security

For every bugfix, check:

```text
Authentication
Authorization
Data Isolation
Input Validation
Secrets
Payments
Emails
PDF Access
File Uploads
Socket.IO
AI Security
```

Security bugs receive priority handling.

## 7. Database

For data-related bugs check:

```text
Schema
Relations
Constraints
Indexes
Queries
Transactions
Migrations
Existing Data
```

Do not apply destructive fixes without understanding their impact.

## 8. API

Verify:

```text
Request
Validation
Business Logic
Response
Status Code
Error Handling
Authorization
```

Avoid breaking existing consumers unless explicitly required.

## 9. Payments

Stripe remains in Test Mode.

Verify:

```text
Payment State
Order State
Webhook Handling
Duplicate Events
Failure Handling
```

Never trust payment state supplied directly by the frontend.

## 10. Email

For Brevo bugs verify:

```text
OTP
Order Confirmation
Payment Confirmation
```

Check recipient, template, trigger, error handling, and credential configuration.

## 11. PDFs

For invoice/receipt bugs verify:

```text
PDF Generation
PDF Content
Authorization
Download
Error Handling
```

Customers must only access their own authorized documents.

## 12. AI

Verify:

```text
Input
FastAPI Request
Model/Processing
Response
Backend Validation
Timeout
Fallback
```

AI output must not override core commerce rules.

## 13. Regression Prevention

1. Add a regression test where appropriate.
2. Implement the smallest safe fix.
3. Run the regression test.
4. Run affected unit/integration tests.
5. Run broader tests where appropriate.
6. Verify the original bug no longer occurs.

## 14. Evidence

Provide:

```text
Reproduction Before Fix
Regression Test
Test After Fix
Build
Relevant Integration Tests
Relevant E2E Tests
```

## 15. Documentation

Update documentation if the bugfix changes:

```text
Architecture
API Behavior
Database
Security
Feature Behavior
Deployment
ADR
```

## 16. Completion Report

```text
# Bugfix Report

## Bug
...

## Expected Behavior
...

## Actual Behavior
...

## Root Cause
...

## Changed Files
...

## Fix
...

## Tests
...

## Regression Verification
...

## Security Impact
...

## Database Impact
...

## API Impact
...

## Documentation Updated
...

## Remaining Risks
...

## Final Status
Fixed / Not Fixed / Requires More Investigation
```

## Definition of Done

- [ ] Root cause identified.
- [ ] Fix implemented.
- [ ] Regression test exists where appropriate.
- [ ] Relevant tests pass.
- [ ] Security impact reviewed.
- [ ] Database impact reviewed.
- [ ] API compatibility reviewed.
- [ ] Documentation updated where required.
- [ ] No unrelated behavior is broken.
- [ ] Evidence supports the fix.

## Final Principle

> **Fix the root cause, prove the fix, protect against regression, and avoid unrelated changes.**
