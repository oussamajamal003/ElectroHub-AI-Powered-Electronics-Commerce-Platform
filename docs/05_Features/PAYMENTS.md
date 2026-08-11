# Payments

## 1. Purpose

This document defines the payment architecture for ElectroHub.

The project uses:

```text
Stripe Test Mode
```

for payment demonstrations and development.

No real customer payments are processed.

---

## 2. Payment Architecture

```text
Customer
 ↓
React Checkout
 ↓
Stripe Client Integration
 ↓
Backend Payment API
 ↓
Stripe
 ↓
Payment Verification
 ↓
Order Service
```

The backend is responsible for authoritative payment state.

---

## 3. Stripe Test Mode

Stripe is intentionally configured for:

```text
Test Mode
```

This allows the project to demonstrate:

- Payment creation.
- Payment confirmation.
- Payment failure.
- Payment state handling.
- Order/payment integration.

Production real-money processing is outside the project's current scope.

---

## 4. Payment Flow

```text
1. Customer Opens Checkout
2. Backend Validates Cart
3. Backend Calculates Authoritative Total
4. Payment Context Is Created
5. Customer Completes Stripe Test Payment
6. Stripe Processes Test Payment
7. Backend Verifies Payment State
8. Order Is Created / Confirmed
9. Payment Confirmation Is Recorded
10. Confirmation Email Is Triggered
11. Payment Receipt PDF Is Generated
```

The exact sequence must follow the final Stripe integration architecture.

---

## 5. Payment Amount

The backend is authoritative for the amount charged.

The client must not be trusted for:

```text
Price
Subtotal
Discount
Shipping
Total
```

The backend recalculates the final payable amount from trusted product/order data.

---

## 6. Stripe Credentials

Stripe secret credentials must remain server-side.

Never expose:

```text
STRIPE_SECRET_KEY
```

or other private Stripe credentials through frontend code.

Client-safe Stripe configuration may be exposed only where required by the official integration.

---

## 7. Payment State

Payment state is separate from order state.

Typical states:

```text
Pending
Succeeded
Failed
```

Additional internal states may be introduced where required.

The application must not assume:

```text
Order Delivered = Payment Succeeded
```

or any other invalid state equivalence.

---

## 8. Payment Verification

The backend must verify payment status using authoritative Stripe information.

Do not trust:

```text
Frontend Success Callback
```

as the sole confirmation of payment.

Where Stripe webhooks are used, webhook authenticity must be verified.

---

## 9. Stripe Webhooks

If implemented, webhook processing follows:

```text
Stripe
 ↓
Webhook Endpoint
 ↓
Signature Verification
 ↓
Event Validation
 ↓
Idempotent Processing
 ↓
Payment / Order State Update
```

The webhook endpoint must reject invalid signatures.

Duplicate webhook delivery must not create duplicate orders or state transitions.

---

## 10. Idempotency

Payment operations must protect against duplicate requests.

Use idempotency mechanisms where appropriate for:

```text
Payment Creation
Payment Confirmation
Order Creation
Webhook Processing
```

A network retry must not unintentionally create a second payment or order.

---

## 11. Order Integration

Payment and order state are closely related but separate.

Conceptually:

```text
Payment Succeeded
 ↓
Order Confirmation
 ↓
Order Status = Confirmed
```

The exact transition depends on the approved checkout architecture.

---

## 12. Inventory Integration

Inventory must be validated before final order confirmation.

The system must prevent successful purchase of unavailable stock.

Where concurrency is possible, inventory updates should use appropriate database transaction/locking strategies supported by the architecture.

---

## 13. Payment Failure

Possible payment failures include:

```text
Card Declined
Payment Cancelled
Payment Expired
Stripe Error
Network Failure
Invalid Payment State
```

The frontend should display a safe, understandable message.

Do not expose raw Stripe internals to customers.

---

## 14. Retry

Payment retry must be safe.

The system should avoid:

```text
Duplicate Charge
Duplicate Order
Duplicate Confirmation
```

Retries should use appropriate idempotency and authoritative payment-state checks.

---

## 15. Payment Confirmation Email

After successful payment, the backend can trigger a transactional email through Brevo.

Flow:

```text
Payment Succeeded
 ↓
Email Service
 ↓
Brevo
 ↓
Payment Confirmation Email
```

The email may include:

```text
Order Number
Payment Status
Order Total
Payment Date
Order Link
```

Sensitive payment credentials must never be included.

---

## 16. Payment Receipt PDF

A successful payment can produce a downloadable payment receipt PDF.

Flow:

```text
Payment Confirmed
 ↓
PDF Generation Service
 ↓
Payment Receipt PDF
 ↓
Authorized Download
```

The receipt may contain:

```text
Order Number
Payment Reference
Payment Status
Payment Date
Purchased Items
Total
```

Only information appropriate for the customer should be included.

---

## 17. PDF Authorization

Payment receipts are protected documents.

Before downloading:

```text
Authenticate
 ↓
Verify Order / Payment Ownership
 ↓
Generate / Retrieve Receipt
 ↓
Return PDF
```

Customers must not access another customer's receipt by changing an order identifier.

---

## 18. Email and PDF Failure Isolation

Email and PDF generation are not the authoritative payment system.

Example:

```text
Payment Succeeded
        ↓
 ┌──────┴──────┐
 ↓             ↓
Brevo         PDF
Failure       Failure
 ↓             ↓
Log/Retry     Log/Retry
```

The payment state must remain correct.

---

## 19. Payment Security

Payment security requires:

- Server-side payment verification.
- Secret-key protection.
- HTTPS.
- Secure webhook handling.
- Idempotency.
- Safe error handling.
- No sensitive payment logging.
- Appropriate rate limiting.

The application must never store raw card details unless explicitly required by a future architecture and approved payment-compliance design.

---

## 20. Payment Logging

Safe payment events may include:

```text
payment.created
payment.succeeded
payment.failed
payment.verification.failed
```

Logs may contain safe identifiers such as:

```text
Order ID
Payment status
Request ID
```

Never log:

```text
Card Number
CVV
Stripe Secret Key
Payment Secrets
Authentication Tokens
```

---

## 21. Payment API

Typical endpoints may include:

```text
POST /api/payments/create
POST /api/payments/confirm
GET  /api/payments/:id
GET  /api/orders/:id/payment-receipt
```

Webhook endpoint if implemented:

```text
POST /api/payments/webhook
```

The exact contract follows the backend implementation.

---

## 22. Payment Access Control

Customers may only access payment information belonging to their own orders.

Administrators may access payment status according to their authorized role.

The backend must enforce these permissions.

---

## 23. Payment Performance

Payment operations should:

- Avoid unnecessary API calls.
- Use appropriate Stripe integration patterns.
- Use timeouts.
- Handle transient provider failures.
- Avoid blocking successful order state on optional notifications.

Payment operations must prioritize correctness over premature optimization.

---

## 24. Testing

Payment testing must use Stripe Test Mode.

Test scenarios should include:

```text
Successful Payment
Declined Payment
Cancelled Payment
Invalid Payment State
Duplicate Request
Webhook Success
Invalid Webhook Signature
Duplicate Webhook
Stripe Unavailable
Network Failure
Order Creation Failure
Email Failure
PDF Failure
Unauthorized Receipt Access
```

No real payment credentials or real customer payment data should be used.

---

## 25. Definition of Done

Payments are complete when:

- Stripe Test Mode is configured.
- Payment creation works.
- Payment confirmation works.
- Backend verification works.
- Payment states are tracked.
- Duplicate operations are prevented.
- Webhooks are secured if used.
- Order integration works.
- Payment confirmation email through Brevo works.
- Payment receipt PDF generation works.
- Receipt access is authorized.
- Sensitive payment data is not logged.
- Payment failures are handled safely.
- Tests pass.
- Documentation matches implementation.

---

## 26. Payment Principle

> **Stripe is the payment provider, but the backend remains the application's authoritative payment boundary: verify every payment, prevent duplicate operations, protect credentials, and isolate non-critical notifications and documents from payment state.**
