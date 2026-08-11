# Integration Testing

## 1. Purpose

This document defines the integration-testing strategy for ElectroHub.

Integration tests verify that multiple application components work correctly together.

The focus is on service boundaries, persistence, external integrations, and real application workflows without requiring the complete browser-driven system.

## 2. Integration Test Scope

Integration testing covers:

```text
Backend + Database
Backend + Prisma
Backend + FastAPI
Backend + Stripe Test Mode
Backend + Brevo
Backend + Cloudinary
Backend + Socket.IO
Authentication + Database
Checkout + Orders
Orders + Inventory
Orders + Delivery
```

## 3. Integration Testing Principle

```text
Component A
    ↓
Real Integration Boundary
    ↓
Component B
    ↓
Expected Result
```

Integration tests should use realistic contracts rather than mocking every dependency.

## 4. Database Integration

Verify the backend correctly interacts with Supabase PostgreSQL through Prisma.

Test:

```text
Create
Read
Update
Delete
Relations
Transactions
Constraints
Indexes
```

Important scenarios include:

```text
User Creation
Product Creation
Cart Persistence
Order Creation
Order Items
Inventory Updates
Payment Records
Delivery Records
```

## 5. Authentication Integration

Verify:

```text
Registration
 ↓
Database User
 ↓
Password Hash
 ↓
Login
 ↓
JWT
 ↓
Refresh Token
 ↓
Protected API
```

Also verify:

```text
OTP Request
 ↓
OTP Generation
 ↓
OTP Storage / Validation
 ↓
Brevo Delivery
 ↓
Verification
```

Sensitive OTP values must not appear in logs or test artifacts.

## 6. Checkout Integration

Verify:

```text
Cart
 ↓
Inventory Validation
 ↓
Order Creation
 ↓
Stripe Test Mode
 ↓
Payment Result
 ↓
Order / Payment State
```

The integration must prevent invalid orders when validation fails.

## 7. Stripe Integration

Use Stripe Test Mode only.

Verify:

```text
Payment Intent / Checkout Creation
Successful Payment
Failed Payment
Payment Reference
Payment Status
Webhook / Callback Handling
Duplicate Event Handling
```

No real card or production payment credentials may be used.

## 8. Brevo Integration

Verify transactional email integration for:

```text
OTP
Order Confirmation
Payment Confirmation
```

Verify:

```text
Backend Event
 ↓
Brevo Request
 ↓
Expected Recipient
 ↓
Expected Template / Payload
 ↓
Controlled Success / Failure
```

Production recipient data must not be used in automated tests.

## 9. PDF Integration

Verify:

```text
Order Data
 ↓
PDF Generator
 ↓
Order Invoice PDF
 ↓
Download / Response
```

and:

```text
Payment Data
 ↓
PDF Generator
 ↓
Payment Receipt PDF
 ↓
Download / Response
```

Verify unauthorized users cannot generate or download another customer's documents.

## 10. Cloudinary Integration

Where Cloudinary is used for product media:

```text
Upload
 ↓
Cloudinary
 ↓
Returned Asset Reference
 ↓
Database
 ↓
Product
```

Test upload failure and invalid asset responses.

## 11. FastAPI Integration

Verify:

```text
Backend
 ↓
FastAPI
 ↓
AI Result
 ↓
Backend Validation
 ↓
Product Lookup
```

Test successful responses, invalid responses, timeout, unavailable service, and empty results.

The backend must not blindly trust AI output.

## 12. Socket.IO Integration

Verify:

```text
Admin Update
 ↓
Backend
 ↓
Socket.IO
 ↓
Authorized Customer
 ↓
Updated Delivery State
```

Test connection, authentication, order isolation, status update, disconnect, reconnect, and unauthorized access.

## 13. Inventory Integration

Verify:

```text
Product
 ↓
Cart
 ↓
Checkout
 ↓
Order
 ↓
Inventory Decrease
```

Test concurrent or repeated operations where inventory integrity could be affected.

Negative inventory must never be produced.

## 14. Order Integration

Verify:

```text
Order
 ↓
Order Items
 ↓
Payment
 ↓
Inventory
 ↓
Delivery
 ↓
Email
 ↓
PDF
```

The system should maintain correct relationships and state transitions.

## 15. Integration Failure Testing

Test:

```text
Database Failure
Stripe Failure
Brevo Failure
Cloudinary Failure
FastAPI Failure
Socket Failure
PDF Generation Failure
```

Failures must result in controlled application behavior.

## 16. Test Isolation

Integration tests should use controlled test data.

Avoid dependence on:

```text
Production Database
Production Stripe
Production Brevo
Production Cloudinary
Production Secrets
```

## 17. Cleanup

Tests that create persistent data must clean it up or use an isolated test database/environment.

```text
Setup
 ↓
Execute
 ↓
Assert
 ↓
Cleanup
```

## 18. CI Integration Tests

CI should run integration tests in an environment with the required dependencies.

Typical sequence:

```text
Install
 ↓
Start Dependencies
 ↓
Database Setup
 ↓
Integration Tests
 ↓
Cleanup
```

## 19. Definition of Done

Integration testing is complete when:

- Service boundaries are tested.
- Database interactions are verified.
- Critical external integrations are verified.
- Failure scenarios are covered.
- Authorization boundaries are tested.
- Test data is isolated.
- Cleanup is reliable.
- Tests pass locally.
- CI integration tests pass.
- Evidence is available.

## 20. Integration Testing Principle

> **Integration tests provide evidence that independently implemented components communicate correctly through their real contracts and boundaries.**
