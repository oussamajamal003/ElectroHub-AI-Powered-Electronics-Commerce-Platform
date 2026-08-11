# Unit Testing

## 1. Purpose

This document defines the unit-testing standards for ElectroHub.

Unit tests verify small, isolated units of behavior without requiring the complete application stack.

Unit tests should be:

- Fast.
- Deterministic.
- Isolated.
- Readable.
- Repeatable.

## 2. Unit Test Scope

Unit tests should cover:

```text
Functions
Utilities
Validation
Business Rules
Services
React Components
Hooks
Pure Recommendation Logic
AI Processing Helpers
```

Tests should focus on behavior rather than implementation details.

## 3. Frontend Unit Testing

Frontend unit tests should cover important:

```text
Components
Hooks
Utilities
Form Logic
Validation
State Transitions
```

Examples:

```text
Product Card
Cart Item
Checkout Form
Order Status
Recommendation Section
Image Search Input
```

## 4. Backend Unit Testing

Backend unit tests should cover:

```text
Business Services
Validation
Authorization Rules
Order State Logic
Inventory Rules
Payment State Logic
Recommendation Rules
Utility Functions
```

Database integration should be avoided in pure unit tests.

## 5. AI Service Unit Testing

FastAPI unit tests should cover isolated:

```text
Image Preprocessing
Validation
Similarity Helpers
Recommendation Scoring
Response Formatting
```

For simulated AI logic, deterministic fixtures should be preferred.

## 6. Test Isolation

A unit test should not require:

```text
Supabase
Stripe
Brevo
Cloudinary
FastAPI Network Service
DigitalOcean
```

unless it is intentionally an integration test.

External dependencies should be mocked or replaced with deterministic test doubles.

## 7. Arrange-Act-Assert

Tests should generally follow:

```text
Arrange
 ↓
Act
 ↓
Assert
```

## 8. Naming

Test names should describe behavior.

Prefer:

```text
rejects checkout when requested quantity exceeds stock
```

over:

```text
testCheckout2
```

## 9. Authentication Unit Tests

Verify:

```text
Valid Credentials
Invalid Credentials
Password Hash Verification
Expired Token Handling
Invalid Token Handling
Role Checks
OTP Validation
```

Sensitive credentials must not appear in test output.

## 10. Validation Unit Tests

Validation tests should include:

```text
Valid Input
Missing Input
Invalid Format
Boundary Values
Unexpected Values
Oversized Input
```

## 11. Cart Unit Tests

Verify:

```text
Add Item
Remove Item
Increase Quantity
Decrease Quantity
Duplicate Item
Invalid Quantity
Empty Cart
```

## 12. Inventory Unit Tests

Verify:

```text
In Stock
Low Stock
Out of Stock
Quantity Decrease
Restock
Invalid Quantity
Insufficient Stock
```

Example invariant:

```text
quantity < 0
```

must never be accepted.

## 13. Order Unit Tests

Verify order-state rules:

```text
Confirmed
Preparing
Out for Delivery
Delivered
```

Invalid state transitions should be rejected.

## 14. Payment Unit Tests

Verify payment state handling without contacting Stripe:

```text
Pending
Succeeded
Failed
```

Also test:

```text
Payment → Order State
Duplicate Payment Event
Invalid Payment Reference
```

External Stripe behavior belongs in integration tests.

## 15. Email Unit Tests

Brevo should not be contacted from ordinary unit tests.

Verify:

```text
Email Template Selection
Recipient Construction
Payload Construction
Event Mapping
Error Handling
```

Examples:

```text
OTP → OTP Email
Order Created → Order Confirmation
Payment Succeeded → Payment Confirmation
```

## 16. PDF Unit Tests

Verify:

```text
Invoice Data Mapping
Receipt Data Mapping
Required Fields
Invalid Data Handling
Filename Generation
```

Actual file-generation integration can be tested separately.

## 17. Recommendation Unit Tests

Verify deterministic recommendation rules:

```text
Category Match
Popularity Score
Purchase History
Frequently Bought Together
Fallback Recommendation
```

## 18. Image Search Unit Tests

Verify isolated image-processing behavior:

```text
Valid Image
Invalid Image
Unsupported Type
Oversized Input
Preprocessing
Similarity Score
Result Formatting
```

## 19. Authorization Unit Tests

Verify:

```text
Customer Can Read Own Order
Customer Cannot Read Another User's Order
Customer Cannot Access Admin Endpoint
Admin Can Manage Products
Admin Can Update Delivery
```

## 20. Error Handling Unit Tests

Verify controlled errors for:

```text
Invalid Input
Not Found
Unauthorized
Forbidden
Conflict
External Failure
Unexpected Failure
```

Errors must not expose secrets or internal stack traces to customers.

## 21. Mocking

Mocks may be used for:

```text
Stripe Client
Brevo Client
Cloudinary Client
FastAPI Client
Repository
Clock
Random ID Generator
```

Mocks must reflect the actual dependency contract. Over-mocking can produce tests that pass while real integrations are broken.

## 22. Test Data

Prefer small explicit fixtures.

Example:

```text
User
Product
Inventory
Order
```

Test data should describe the scenario rather than create unnecessary application-wide state.

## 23. Boundary Testing

Important boundaries include:

```text
Quantity = 0
Quantity = 1
Quantity = Stock
Quantity > Stock
Price = 0
Empty Search
Maximum Upload Size
Expired OTP
Expired Token
```

## 24. Determinism

Unit tests must not depend on:

```text
Current Time
Random Values
Network
External APIs
Execution Order
Shared Database State
```

unless the dependency is intentionally controlled.

## 25. Coverage

Coverage should be reviewed alongside test quality.

Priority should be given to:

```text
Authentication
Authorization
Payments
Checkout
Orders
Inventory
Delivery Rules
AI Business Logic
```

Do not write meaningless tests only to increase coverage percentages.

## 26. CI

Unit tests must run in CI.

A typical validation sequence is:

```text
Install
 ↓
Lint
 ↓
Type Check
 ↓
Unit Tests
 ↓
Build
```

A failed unit-test stage must prevent the relevant merge/release according to the project workflow.

## 27. Regression Tests

Every significant bug should result in a regression test where practical.

```text
Bug
 ↓
Regression Test
 ↓
Fix
 ↓
Test Passes
```

## 28. Definition of Done

A unit-tested feature is complete when:

- Important business logic has unit tests.
- Positive cases are covered.
- Negative cases are covered.
- Boundary cases are covered where relevant.
- Tests are deterministic.
- External services are isolated.
- Tests are readable.
- Tests pass locally.
- Tests pass in CI.
- Important regressions have coverage.

## 29. Unit Testing Principle

> **Unit tests should provide fast, reliable evidence that isolated application behavior is correct without depending on external infrastructure.**
