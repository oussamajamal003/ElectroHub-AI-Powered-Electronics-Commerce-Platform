# Checkout

## 1. Purpose

This document defines the checkout workflow for ElectroHub.

Checkout converts a customer's cart into an order through:

```text
Cart
 ↓
Shipping Information
 ↓
Order Validation
 ↓
Stripe Test Mode Payment
 ↓
Order Creation
 ↓
Payment Confirmation
 ↓
Order Confirmation
 ↓
Invoice Generation
```

No real customer payments are processed.

---

## 2. Checkout Architecture

```text
Customer
 ↓
React Checkout
 ↓
React Hook Form + Zod
 ↓
Backend Checkout API
 ↓
Cart / Inventory Validation
 ↓
Stripe Test Mode
 ↓
Order Service
 ↓
Payment Service
 ↓
PDF Service
 ↓
Brevo Email Service
```

The backend remains authoritative for order, pricing, inventory, and payment state.

---

## 3. Checkout Steps

The customer workflow is:

```text
1. Review Cart
2. Enter Shipping Information
3. Select Payment Method
4. Validate Checkout
5. Process Stripe Test Mode Payment
6. Create Order
7. Confirm Payment
8. Generate Order Documents
9. Send Confirmation Emails
10. Display Order Number
```

The exact UI sequence follows the approved Figma design.

---

## 4. Cart Review

Before payment, the customer reviews:

```text
Products
Quantities
Prices
Subtotal
Shipping
Total
```

The backend must revalidate the cart before creating the order.

The frontend must not be trusted for final pricing.

---

## 5. Shipping Information

Checkout collects the required shipping information.

Validation should include:

- Required fields.
- Valid formats.
- Maximum lengths.
- Safe input handling.

Frontend validation uses:

```text
React Hook Form
+
Zod
```

The backend must validate the same critical fields independently.

---

## 6. Inventory Validation

Before order creation, the backend verifies:

```text
Product Exists
Product Is Active
Requested Quantity Is Valid
Inventory Is Sufficient
```

If inventory is insufficient:

```text
Checkout
 ↓
Inventory Failure
 ↓
User Notification
 ↓
Cart Adjustment
```

The order must not be created as successfully paid when required inventory is unavailable.

---

## 7. Price Validation

The backend calculates authoritative checkout totals.

The system must not trust:

```text
Client Price
Client Total
Client Discount
```

The backend resolves current product pricing and applicable checkout calculations.

---

## 8. Payment Method

Stripe is the payment provider for the project.

Stripe operates in:

```text
Test Mode
```

The project does not process real customer payments.

The frontend may collect payment details through Stripe's approved client-side integration so sensitive payment information does not pass through the application's own backend unnecessarily.

---

## 9. Payment Flow

Conceptually:

```text
Checkout
 ↓
Backend Creates Payment Context
 ↓
Stripe Test Mode
 ↓
Customer Confirms Payment
 ↓
Backend Verifies Payment State
 ↓
Order Creation / Confirmation
```

The backend must never mark an order as paid based only on a frontend success message.

---

## 10. Order Creation

A successful checkout creates an order containing the required historical information.

An order should preserve information such as:

```text
Order Number
Customer
Purchased Products
Purchased Prices
Quantities
Shipping Information
Order Total
Payment Reference / Status
Order Status
Created At
```

Historical order information must remain understandable even if product data changes later.

---

## 11. Order State

The initial order state is:

```text
Confirmed
```

Subsequent order states include:

```text
Preparing
Out for Delivery
Delivered
```

The state transition rules are controlled by the backend.

---

## 12. Payment State

Payment state is separate from order delivery state.

Possible payment states include:

```text
Pending
Succeeded
Failed
```

The implementation may define additional states where required.

The system must not confuse:

```text
Payment Status
```

with:

```text
Order / Delivery Status
```

---

## 13. Transactional Email

After successful order/payment processing, the backend may trigger transactional email through Brevo.

Relevant messages include:

```text
Order Confirmation
Payment Confirmation
```

Flow:

```text
Order / Payment Event
 ↓
Email Service
 ↓
Brevo
 ↓
Customer Email
```

Brevo credentials remain server-side.

Email failure must not incorrectly change authoritative payment or order state.

---

## 14. PDF Generation

Checkout integrates with the document-generation system.

Documents include:

```text
Order Invoice PDF
Payment Receipt PDF
```

Flow:

```text
Successful Order / Payment
 ↓
PDF Service
 ↓
Generated Document
 ↓
Customer Download
```

PDF generation failure must not falsely indicate that the payment or order failed.

---

## 15. Order Confirmation

After successful checkout, the customer receives:

```text
Order Number
Order Summary
Payment Status
Order Status
```

The customer should have access to the order details page.

Where implemented, the confirmation screen may provide:

```text
Download Invoice
Download Payment Receipt
Continue Shopping
View Order
```

---

## 16. Checkout Failure

Possible failures include:

```text
Invalid Cart
Inventory Failure
Invalid Shipping Data
Payment Failure
Stripe Unavailable
Order Creation Failure
Email Failure
PDF Generation Failure
Network Failure
```

The UI must clearly distinguish critical checkout failures from non-critical notification/document failures.

---

## 17. Payment Failure

If payment fails:

```text
Payment Attempt
 ↓
Payment Failed
 ↓
No Successful Paid Order
 ↓
User Receives Safe Error
 ↓
Retry / Return to Checkout
```

The system must avoid duplicate charges and duplicate orders.

Idempotency should be used where appropriate.

---

## 18. Email Failure

Email delivery is a non-authoritative notification operation.

Example:

```text
Order Created
 ↓
Payment Confirmed
 ↓
Brevo Failure
```

The order and payment remain authoritative.

The email failure should be:

```text
Logged
Handled
Retried where safe
```

according to the notification architecture.

---

## 19. PDF Failure

PDF generation is also separated from payment state.

Example:

```text
Payment Confirmed
 ↓
PDF Generation Failure
```

The customer should still be able to view the order.

The system may provide a retry or later document-generation mechanism.

---

## 20. Duplicate Checkout Protection

Checkout must protect against repeated submissions.

Controls may include:

```text
Disabled Submit State
Request Idempotency
Payment Idempotency
Order Uniqueness
Backend Validation
```

A network retry must not unintentionally create multiple paid orders.

---

## 21. Checkout API

Typical endpoints may include:

```text
POST /api/checkout
POST /api/payments/create
GET  /api/orders/:id
```

The exact API contract follows the backend implementation and `API_GUIDELINES.md`.

---

## 22. Security

Checkout must enforce:

- Authentication.
- Cart ownership.
- Product validation.
- Inventory validation.
- Server-side price calculation.
- Payment verification.
- Secure shipping-data handling.
- Rate limiting where appropriate.
- Safe error responses.

Payment secrets remain server-side.

---

## 23. Accessibility

Checkout must support:

- Keyboard navigation.
- Accessible form labels.
- Visible validation errors.
- Focus management.
- Accessible payment controls.
- Clear order status feedback.
- Screen-reader-friendly messages.

Validation errors should be associated with the relevant fields.

---

## 24. Responsive Design

Checkout must support:

```text
Mobile
Tablet
Desktop
```

The most important information should remain visible and usable on small screens.

---

## 25. Localization and RTL

Checkout supports:

```text
English
Arabic / RTL
```

Shipping fields, validation messages, totals, and confirmation content must follow the localization system.

Currency formatting must use the approved locale-aware formatting strategy.

---

## 26. Performance

Checkout should minimize unnecessary requests.

The system should:

- Avoid duplicate payment requests.
- Avoid repeated cart fetches.
- Use efficient API responses.
- Keep payment interactions responsive.
- Avoid blocking checkout on optional email/PDF operations.

---

## 27. Testing

Checkout testing should cover:

```text
Valid Checkout
Invalid Shipping Data
Empty Cart
Invalid Product
Price Change
Insufficient Inventory
Successful Test Payment
Failed Test Payment
Payment Retry
Duplicate Submission
Order Creation
Email Trigger
PDF Generation
Email Failure
PDF Failure
Unauthorized Checkout
Network Failure
Mobile Layout
RTL
Accessibility
```

Critical checkout flows must be covered by E2E tests.

---

## 28. Definition of Done

Checkout is complete when:

- Cart review works.
- Shipping information works.
- Validation works.
- Inventory is revalidated.
- Prices are server-authoritative.
- Stripe Test Mode works.
- Payment state is verified server-side.
- Orders are created correctly.
- Order numbers are generated.
- Brevo order/payment notifications work.
- Invoice PDF generation works.
- Payment receipt PDF generation works.
- Failures are handled safely.
- Duplicate checkout is prevented.
- Accessibility is verified.
- Responsive behavior is verified.
- RTL/localization is verified.
- Tests pass.
- Documentation matches implementation.

---

## 29. Checkout Principle

> **Checkout must treat payment, inventory, pricing, and order creation as authoritative backend operations while keeping optional email and document generation isolated from critical commerce state.**
