## Task 03.6 payment evidence categories

Deterministic payment domain, provider, orchestration, route and raw signed webhook tests are separate from genuine financial proof. PAYMENT_STRIPE_LIVE_DEV=true enables payment.stripe.live.test.ts using exact DEV identity, real authenticated routes, official Stripe Test Mode and disposable fixtures; it rejects PROD and cleans only recorded fixture identities. Fault injection occurs around actual provider/DB work to prove rollback and same-identity recovery. scripts/stripe-browser-gate.cjs uses the real local app, hosted Payment Element, Stripe CLI forwarding and a scoped restarted worker without API interception. Focused Checkout Playwright uses explicitly intercepted SDK/API states and therefore proves UI only. STRIPE_ENTRY_PROBE=true enables a real hosted-entry probe with intercepted application setup, not purchase proof. Required captures must be opened, not merely written. Never persist raw secrets in HAR/trace artifacts. [Verified results and remaining gates](../tasks/Phase-03/TASK_03.6_IMPLEMENTATION_EVIDENCE.md).

# Testing Strategy

## Task 03.7 Order Management verification

Mocked-persistence API contract tests live in `apps/backend/src/routes/orders.management.test.ts`. The opt-in real DEV read gate is `ORDERS_LIVE_DEV=true NODE_ENV=test npx vitest run src/services/__tests__/orders.management.live.test.ts`, run from `apps/backend`. It reuses `assertSyntheticDevEnvironment`, writes only labeled `orders-gate-*` fixtures, and cleans them up only after every test passes.

Frontend component and query tests are in `features/orders/*.test.tsx` and `pages/customer/OrdersPage.test.tsx`. Browser journeys and visual captures are in `tests/orders/orders.spec.ts`: run `npm run build && npx playwright test -c playwright.orders.config.ts` (mocked reads, no baseline updates; captures are written to `test-results/orders/`). Stories: `Customer/Order Management`. See [Task 03.7 evidence](../tasks/Phase-03/TASK_03.7_IMPLEMENTATION_EVIDENCE.md).

## Task 03.5 Checkout verification

Focused unit/API/component tests verify validation, authority, idempotency, guards, drafts and Cart cache installation. `playwright.checkout.config.ts` provides explicitly intercepted UI coverage; it is not database proof. Production Checkout stories and axe checks use `playwright.cart-storybook.config.ts checkout.stories.spec.ts`. Screenshot capture waits for actual API/step readiness, and ignored local evidence lives under `apps/frontend/screenshots/checkout-visual` and `checkout-live` so Playwright output cleanup cannot erase it.

The opt-in `CHECKOUT_LIVE_DEV=true` backend `checkout.live.test.ts` uses real customer login/routes/DEV PostgreSQL and disposable fixture IDs, including genuine last-unit/same-Cart concurrency. The rollback case injects a controlled second Inventory failure into the production OrderService inside a real database transaction. `scripts/checkout-browser-gate.cjs` exercises Chromium → localhost → real DEV with no interception. Both gates verify cleanup and reject PROD targeting. Local Inventory PostgreSQL tests remain skipped without their isolated test URL; the real DEV gate is separately labeled. See [Task 03.5 evidence](../tasks/Phase-03/TASK_03.5_IMPLEMENTATION_EVIDENCE.md) for exact runs, failures corrected and deployment evidence.


## Task 03.4A focused Inventory verification

Run backend Inventory/Product/Cart/Wishlist service tests and Cart/Wishlist route tests; frontend ProductCard, Details, Cart/Wishlist pages/providers; `npx playwright test -c playwright.catalog.config.ts tests/catalog/inventory.spec.ts`; and Inventory Storybook axe checks. Browser edge states are intercepted UI evidence, not live API/database persistence. `inventory.postgres.test.ts` requires explicitly configured local `INVENTORY_TEST_DATABASE_URL`, rejects non-local hosts, uses an isolated schema and applies the actual CHECK SQL. It runs genuine SQL row-lock concurrency through a transaction adapter, not full Prisma integration. Without that configuration, its two tests are skipped—not passed. See [final matrices](../tasks/Phase-03/TASK_03.4A_IMPLEMENTATION_EVIDENCE.md).

## 1. Purpose

This document defines the overall testing strategy for ElectroHub.

Testing verifies that the application behaves according to its requirements and that changes do not introduce regressions.

Testing applies across:

```text
Frontend
Backend
AI Service
Database
Integrations
Infrastructure
```

The project follows an evidence-based approach. A feature is not considered complete only because the implementation exists; relevant tests and verification evidence must pass.

In CI, backend test files run with one worker and each test Prisma pool is bounded to five connections. This leaves headroom within the shared DEV session pool's observed 15-client limit while retaining the concurrent requests inside ownership/OTP tests. Development and production connection settings are unchanged.

Branch validation must inspect GitHub Actions for the exact pushed commit; local checks alone do not establish branch CI success.

## 2. Testing Pyramid

```text
             E2E
          /       \
     Integration
       /         \
      Unit Tests
```

The majority of tests should be fast unit tests. Integration tests verify service boundaries and persistence. E2E tests verify important end-to-end workflows.

## 3. Testing Levels

### Unit Testing

Tests isolated functions, utilities, components, and business rules.

Examples:

```text
Validation
Calculations
Recommendation Rules
Cart Logic
Order State Rules
Utility Functions
React Components
```

### Integration Testing

Tests interactions between multiple application components.

Examples:

```text
API + Database
Backend + Prisma
Authentication + Database
Checkout + Order Creation
Backend + FastAPI
Backend + Stripe Test Mode
Backend + Brevo
```

### End-to-End Testing

Tests complete customer and administrator workflows.

Examples:

```text
Registration
Login
Product Search
Add to Cart
Checkout
Payment
Order Confirmation
Delivery Tracking
Admin Order Management
Image Search
Recommendations
```

## 4. Frontend Testing

Frontend tests should verify component behavior, form validation, routing, user interactions, loading/error states, responsive behavior where practical, and accessibility-critical behavior.

Important areas include:

```text
Authentication
Product Catalog
Product Details
Cart
Wishlist
Checkout
Orders
Delivery Tracking
Admin Dashboard
Image Search
Recommendations
```

## 5. Backend Testing

Backend tests should verify API contracts, request validation, authentication, authorization, business rules, database interactions, error handling, transaction behavior, and external-service integration boundaries.

Security-sensitive endpoints require both positive and negative tests.

## 6. AI Service Testing

FastAPI tests should cover:

```text
Image Search
Recommendation Processing
Input Validation
Invalid Images
Oversized Images
AI Response Schema
Timeouts
Failure Handling
Health Check
```

Simulated AI behavior must be deterministic enough for reliable automated testing.

## 7. Database Testing

Database testing should verify:

- Prisma schema validity.
- Migrations.
- Relationships.
- Constraints.
- Unique fields.
- Indexes where relevant.
- Seed data.
- Transaction behavior.

Examples:

```text
Duplicate Email
Duplicate Product Slug
Invalid Foreign Key
Duplicate Cart Item
Duplicate Wishlist Item
Invalid Order Reference
```

## 8. Integration Testing

Important integrations include:

```text
Supabase PostgreSQL
Stripe Test Mode
Brevo
Cloudinary
FastAPI
Socket.IO
```

External services should normally use test/sandbox credentials and controlled fixtures.

Real payment credentials must never be used in automated tests.

## 9. Payment Testing

Stripe integration must be tested in Test Mode.

Verify:

```text
Checkout Creation
Successful Payment
Failed Payment
Payment Status
Order Creation
Payment Confirmation
Duplicate Callback / Webhook Handling
```

No real customer payments are processed by the project.

## 10. Email Testing

Brevo transactional email flows should be tested for:

```text
OTP Delivery
Order Confirmation
Payment Confirmation
```

Tests should verify the request, recipient, template/content, and success/failure handling.

## 11. PDF Testing

PDF generation must be verified for:

```text
Order Invoice
Payment Receipt
```

Tests should confirm PDF generation, required information, download behavior, invalid references, and safe failure handling.

## 12. Delivery Tracking Testing

Verify:

```text
Order Details
Delivery Status
Location Update
Estimated Arrival
Socket.IO Update
Admin Update
Customer Update
```

Supported states:

```text
Confirmed
Preparing
Out for Delivery
Delivered
```

Unauthorized users must not receive another user's delivery information.

## 13. Image Search Testing

Verify:

```text
Upload Image
Camera Capture
Invalid File
Unsupported Format
Oversized File
Successful Matching
No Results
AI Failure
Result Selection
```

## 14. Recommendation Testing

Verify:

```text
Popular Products
Category Recommendations
Similar Products
Frequently Bought Together
Purchase History
Personalized Recommendations
Anonymous User Fallback
No Results
AI Failure
```

Recommendation output must be validated against the product catalog.

## 15. Security Testing

Security testing includes:

```text
Authentication
Authorization
JWT Handling
Refresh Tokens
Password Hashing
Input Validation
Rate Limiting
File Upload Validation
API Access Control
Secret Handling
```

Tests should include unauthorized and forbidden requests.

## 16. Negative Testing

Every important feature should include failure scenarios:

```text
Missing Required Field
Invalid Input
Unauthorized User
Forbidden User
Nonexistent Resource
Duplicate Resource
Database Failure
External Service Failure
Timeout
Malformed Response
```

## 17. Regression Testing

When a bug is fixed, an appropriate regression test should be added whenever practical.

```text
Bug Found
 ↓
Fix
 ↓
Regression Test
 ↓
Prevent Recurrence
```

## 18. Test Isolation

Tests should avoid relying on shared mutable state. Where database state is required:

```text
Create Fixture
 ↓
Run Test
 ↓
Clean / Reset
```

## 19. Test Data

Test data must be synthetic, deterministic where practical, safe, and environment-specific.

Never commit:

```text
Real Customer Data
Production Passwords
API Secrets
Payment Credentials
Private Tokens
```

## 20. CI Testing

CI should execute appropriate automated checks before merging.

Typical checks include:

```text
Lint
Type Check
Unit Tests
Integration Tests
Build
```

E2E tests may run in dedicated CI stages depending on execution cost.

## 21. Coverage

Coverage is a supporting metric, not the only quality measurement.

High-priority areas include:

```text
Authentication
Authorization
Payments
Orders
Inventory
Checkout
Delivery
AI Integration
```

A high percentage does not prove that the application is correct if critical behavior is untested.

## 22. Performance Testing

Performance verification should cover important operations such as:

```text
Product Listing
Product Search
Checkout
Order Retrieval
Admin Tables
Recommendation Retrieval
Image Search
```

## 23. Accessibility Testing

Accessibility verification should include:

```text
Keyboard Navigation
Focus Management
Form Labels
Error Messages
Semantic Structure
Color Contrast
Alternative Text
Screen Reader Compatibility
```

## 24. Definition of Done

A feature is considered tested when:

- Appropriate unit tests exist.
- Required integration tests exist.
- Critical E2E behavior is covered.
- Negative cases are covered.
- Security-sensitive paths are tested.
- External integrations use safe test environments.
- Tests pass locally.
- CI checks pass.
- Relevant regressions are covered.
- Test evidence is available.

## 25. Testing Principle

> **Testing verifies behavior, not implementation claims. A feature is complete only when its important behavior has been demonstrated with appropriate evidence.**

## Task 03.3 Wishlist evidence

- Backend: `src/services/__tests__/wishlist.service.test.ts` and `src/routes/wishlist.routes.test.ts`; mocked Prisma and route auth, no live database.
- Frontend: `src/features/wishlist/*.test.ts*` and `src/pages/customer/WishlistPage.test.tsx`; focused ProductCard/Cart regressions.
- Browser: `npx playwright test -c playwright.catalog.config.ts wishlist.spec.ts`. These flows intercept API responses and explicitly map A–T in the implementation report.
- Storybook: focused `wishlist.stories.spec.ts` scans actual local fixtures at four viewports.
- Non-intercepted smoke: start this branch API/frontend, then `WISHLIST_SMOKE_URL=http://127.0.0.1:3102 node tests/wishlist-local-smoke.mjs` (set the environment variable using your shell). It reads real catalog APIs and exercises guest save/refresh/removal, writes evidence under ignored `test-results`, and never claims authenticated hosted persistence.

Production `npm run build` is required in addition to standalone typecheck, because project-reference settings also validate test/story code. No migration, seed or PROD writes are part of these checks.

## Frontend loading baseline (intercepted)

`apps/frontend/tests/checkout/loading-baseline.spec.ts` runs under `playwright.checkout.config.ts` with every API and the Stripe SDK intercepted. It records request counts per navigation, time to useful content, layout shift, provider mounts, setup/resume POST counts and time to order acknowledgement at 0 ms and at a fixed 400 ms injected delay per API request, and writes `test-results/checkout/loading-baseline.json`. The delay exposes how many requests a screen issues in sequence. It asserts only deterministic counts (one Cart read per cold load, no skeleton on a client-side return, one setup POST, one secure-entry mount, one submit, one resume POST under StrictMode); millisecond values are recorded, not asserted, because they depend on the machine. It also captures the saved-purchase retry page's unverified and refused states at 390 and 1440 px. These are frontend-only measurements: they are not backend, database or live Stripe timings.

```bash
cd apps/frontend
npx playwright test -c playwright.checkout.config.ts tests/checkout/loading-baseline.spec.ts
```
