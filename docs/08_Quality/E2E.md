# End-to-End Testing

## 1. Purpose

This document defines end-to-end testing for ElectroHub.

E2E tests verify complete user workflows from the interface through the application backend and required services.

## 2. E2E Scope

Critical workflows include:

```text
Authentication
Product Discovery
Search
Image Search
Recommendations
Cart
Wishlist
Checkout
Payment
Orders
Delivery Tracking
Admin Operations
```

## 3. Customer Journey

```text
Open Store
 ↓
Browse Products
 ↓
Search / Filter
 ↓
Product Details
 ↓
Add to Cart
 ↓
Checkout
 ↓
Stripe Test Mode
 ↓
Order Confirmation
 ↓
Invoice
 ↓
Delivery Tracking
```

## 4. Authentication E2E

Verify:

```text
Registration
Login
OTP Verification
Logout
Refresh Session
Protected Pages
Role-Based Access
```

Negative scenarios:

```text
Invalid Credentials
Invalid OTP
Expired OTP
Expired Session
Unauthorized Page
```

## 5. Product Discovery E2E

Verify:

```text
Homepage
Catalog
Categories
Search
Filters
Product Details
Product Images
Availability
```

## 6. Image Search E2E

Verify:

```text
Open Image Search
 ↓
Upload / Capture Image
 ↓
Submit
 ↓
AI Processing
 ↓
Matching Results
 ↓
Open Product
```

Also verify invalid image, no results, AI failure, and camera permission denial.

## 7. Recommendation E2E

Verify recommendations on approved pages:

```text
Homepage
Product Details
Cart
Order Confirmation
```

Verify display, interaction, product navigation, and fallback.

## 8. Cart E2E

Verify:

```text
Add Product
 ↓
Cart
 ↓
Change Quantity
 ↓
Remove Product
 ↓
Cart Total
```

Also verify invalid and out-of-stock scenarios.

## 9. Checkout E2E

Verify:

```text
Cart
 ↓
Shipping Information
 ↓
Validation
 ↓
Payment
 ↓
Order Creation
 ↓
Confirmation
```

Invalid information must prevent checkout.

## 10. Payment E2E

Stripe must remain in Test Mode.

Verify successful test payment, failed payment, payment status, order status, and payment confirmation.

## 11. Email E2E

Verify:

```text
OTP
Order Confirmation
Payment Confirmation
```

The test environment must use controlled recipients.

## 12. PDF E2E

Verify:

```text
Order Created
 ↓
Invoice Available
 ↓
Download Invoice
```

and:

```text
Payment Completed
 ↓
Receipt Available
 ↓
Download Receipt
```

Authorization must prevent access to another user's documents.

## 13. Order E2E

Verify:

```text
Create Order
 ↓
View Order
 ↓
View Items
 ↓
View Payment
 ↓
View Delivery
 ↓
Download Documents
```

## 14. Delivery Tracking E2E

Verify:

```text
Admin Changes Delivery Status
 ↓
Backend
 ↓
Socket.IO
 ↓
Customer Receives Update
```

Test:

```text
Confirmed
Preparing
Out for Delivery
Delivered
```

## 15. Admin E2E

Verify:

```text
Admin Login
 ↓
Dashboard
 ↓
Products
 ↓
Inventory
 ↓
Orders
 ↓
Payments
 ↓
Delivery
 ↓
Analytics
```

Customer accounts must not access administrative workflows.

## 16. Responsive E2E

Critical workflows should be verified on:

```text
Mobile
Tablet
Desktop
```

## 17. E2E Test Data

Use dedicated test accounts and test products.

Never use real customer accounts, production payment data, or production secrets.

## 18. E2E Stability

Prefer:

```text
Stable Selectors
Explicit Assertions
Network-Aware Waiting
Deterministic Test Data
```

Avoid arbitrary long sleeps where possible.

## 19. CI

Critical E2E tests should run before release.

A full E2E suite may run in a dedicated CI stage when execution time is significant.

## 20. Definition of Done

E2E testing is complete when:

- Critical customer workflows pass.
- Critical admin workflows pass.
- Payment flow passes in Test Mode.
- Email/PDF workflows are verified.
- Delivery tracking is verified.
- Authorization boundaries are verified.
- Responsive critical paths are verified.
- Test data is isolated.
- CI execution is successful.

## 21. E2E Principle

> **End-to-end tests verify that the complete system delivers the intended user workflow, not merely that individual components work in isolation.**
