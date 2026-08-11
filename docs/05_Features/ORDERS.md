# Orders

## 1. Purpose

This document defines the order-management system for ElectroHub.

Orders represent completed or in-progress commerce transactions and connect:

```text
Customer
Cart
Products
Inventory
Payment
Shipping
Delivery
Invoices
Notifications
```

The backend and database are authoritative for order state.

---

## 2. Order Architecture

```text
Customer
 ↓
Checkout
 ↓
Order Service
 ├── Inventory
 ├── Payment
 ├── Database
 ├── Brevo
 └── PDF Generation
        ↓
     Order Record
        ↓
Customer / Admin
```

---

## 3. Order Creation

An order is created through the checkout workflow after the required validation and payment conditions are satisfied.

Conceptually:

```text
Cart
 ↓
Validate Cart
 ↓
Validate Inventory
 ↓
Calculate Authoritative Total
 ↓
Process / Verify Payment
 ↓
Create Order
 ↓
Update Inventory
 ↓
Confirmation
```

The exact transaction and payment sequence follows the approved checkout/payment architecture.

---

## 4. Order Information

An order should preserve the information required to understand the historical transaction.

Typical information includes:

```text
Order ID
Order Number
Customer ID
Order Items
Purchased Prices
Quantities
Subtotal
Shipping
Total
Shipping Information
Payment Status
Order Status
Created At
Updated At
```

The exact schema is defined by Prisma.

---

## 5. Order Number

Each order receives a customer-facing order number.

The order number should be:

- Unique.
- Stable.
- Suitable for customer communication.
- Safe to expose publicly according to the API security model.

Internal database IDs and customer-facing order numbers do not need to be identical.

---

## 6. Order Items

Order items preserve the historical purchase.

An order item should contain the information required to determine:

```text
Product
Purchased Quantity
Purchased Price
Relevant Product Snapshot
```

Current product price must not overwrite the historical purchased price.

---

## 7. Order Status

Supported order states are:

```text
Confirmed
Preparing
Out for Delivery
Delivered
```

Conceptually:

```text
Confirmed
   ↓
Preparing
   ↓
Out for Delivery
   ↓
Delivered
```

The backend controls valid transitions.

---

## 8. Payment Status

Payment status is separate from order status.

Possible payment states include:

```text
Pending
Succeeded
Failed
```

Examples:

```text
Order Status: Preparing
Payment Status: Succeeded
```

The system must not use delivery status as a replacement for payment state.

---

## 9. Customer Workflow

Customers can:

- View their orders.
- View order details.
- View purchased products.
- View quantities and totals.
- View payment status.
- View order status.
- Track delivery.
- Download invoices.
- Download payment receipts where available.

Customers may only access their own orders.

---

## 10. Order Details

The order details page may display:

```text
Order Number
Order Date
Products
Quantities
Prices
Total
Payment Status
Order Status
Shipping Information
Delivery Progress
Invoice
Payment Receipt
```

The final presentation follows the Figma design.

---

## 11. Order Confirmation Email

After successful order creation, the backend can send an order-confirmation email through Brevo.

Flow:

```text
Order Confirmed
 ↓
Email Service
 ↓
Brevo
 ↓
Customer
```

The email may include:

```text
Order Number
Order Date
Order Total
Order Status
Order Details Link
```

Email delivery is a notification operation and must not be treated as authoritative order state.

---

## 12. Invoice PDF

Customers can download an order invoice PDF.

Flow:

```text
Order
 ↓
Authorization
 ↓
PDF Generation / Retrieval
 ↓
Invoice PDF
 ↓
Customer Download
```

The invoice should contain relevant order information such as:

```text
Order Number
Customer Information
Purchased Products
Quantities
Prices
Subtotal
Shipping
Total
Order Date
```

Only appropriate customer information should be included.

---

## 13. Payment Receipt PDF

Where applicable, customers can download a payment receipt.

The receipt is associated with the payment/order and must be access-controlled.

See `PAYMENTS.md` for payment-specific behavior.

---

## 14. PDF Authorization

Before returning an order document:

```text
Authenticate
 ↓
Verify Order Ownership / Admin Permission
 ↓
Generate or Retrieve Document
 ↓
Return PDF
```

Changing an order identifier must never allow access to another customer's documents.

---

## 15. Delivery Tracking

Orders integrate with the delivery-tracking system.

Customers can view:

```text
Confirmed
Preparing
Out for Delivery
Delivered
```

Where map tracking is implemented:

```text
Order Details
 ↓
Leaflet
 ↓
OpenStreetMap
 ↓
Delivery Location / Route
```

Real-time updates may be delivered through Socket.IO.

The delivery feature is documented in `DELIVERY_TRACKING.md`.

---

## 16. Real-Time Order Updates

Where required:

```text
Admin Updates Order
 ↓
Backend
 ↓
Socket.IO Event
 ↓
Relevant Customer
 ↓
Order UI Updates
```

Only authorized users should receive events related to an order.

Real-time events must not expose unrelated customer or order data.

---

## 17. Admin Workflow

Administrators can:

- View orders.
- Open order details.
- Review payment status.
- Update order status.
- Manage shipment progress.
- Review customer/order information according to permissions.
- Generate/retrieve operational reports.

Administrative order operations require server-side authorization.

---

## 18. Order Status Updates

An administrator may update:

```text
Confirmed
Preparing
Out for Delivery
Delivered
```

The backend must validate allowed transitions.

Invalid transitions should be rejected.

Example:

```text
Confirmed → Preparing
Preparing → Out for Delivery
Out for Delivery → Delivered
```

The exact transition policy should remain consistent across the backend, UI, and delivery tracking.

---

## 19. Order Cancellation

Cancellation behavior must follow the approved business rules.

If cancellation is supported, the system must define:

```text
Who can cancel
When cancellation is allowed
Payment/refund behavior
Inventory restoration
Order-state transition
Customer notification
```

Cancellation must not silently bypass payment or inventory rules.

---

## 20. Inventory Integration

Order creation and inventory updates must remain consistent.

A successful finalized purchase should update inventory according to the approved transaction strategy.

Duplicate order processing must not decrease inventory more than once.

---

## 21. Payment Integration

Orders are connected to payment state.

The backend must verify payment before treating an order as successfully paid.

Payment credentials and sensitive payment information must never be stored unnecessarily.

See `PAYMENTS.md`.

---

## 22. Email Integration

Transactional order notifications use Brevo.

Relevant events may include:

```text
Order Confirmation
Payment Confirmation
```

Brevo failures must be handled independently from authoritative order state.

---

## 23. Order API

Typical endpoints may include:

```text
GET   /api/orders
GET   /api/orders/:id
GET   /api/orders/:id/invoice
GET   /api/orders/:id/payment-receipt
PATCH /api/admin/orders/:id/status
```

The exact API contract follows the backend implementation and `API_GUIDELINES.md`.

---

## 24. Order Security

Order operations must enforce:

- Authentication.
- Resource ownership.
- Administrator authorization.
- Input validation.
- Safe document access.
- Safe error responses.
- No sensitive payment logging.

Customers must never access another customer's order.

---

## 25. Order Performance

Order APIs should:

- Use pagination for order lists.
- Fetch only required data.
- Use efficient Prisma relations.
- Avoid unnecessary repeated queries.
- Cache appropriate non-authoritative data where useful.

Order details should not load unrelated large datasets.

---

## 26. Error Handling

Possible failures include:

```text
Order Not Found
Unauthorized
Invalid Status Transition
Payment State Conflict
Inventory Conflict
PDF Generation Failure
Email Failure
Delivery Service Failure
Network Failure
```

The UI should distinguish between critical order-state failures and optional notification/document failures.

---

## 27. Accessibility

Order pages must support:

- Keyboard navigation.
- Accessible status indicators.
- Clear headings.
- Screen-reader-friendly order information.
- Accessible document download controls.
- Clear loading and error states.

Status should not be communicated only through color.

---

## 28. Localization and RTL

Order pages and documents should support:

```text
English
Arabic / RTL
```

Currency, dates, numbers, addresses, and layout direction must follow the localization strategy.

PDF generation should use appropriate fonts and RTL handling where Arabic documents are required.

---

## 29. Testing

Order testing should cover:

```text
Order Creation
Order Number Generation
Order Details
Order Ownership
Admin Order Access
Order Status Transitions
Invalid Status Transition
Payment Integration
Inventory Integration
Order Confirmation Email
Invoice PDF
Payment Receipt PDF
Delivery Tracking Integration
Socket.IO Updates
Unauthorized Access
Pagination
Network Failure
PDF Failure
Email Failure
RTL
Accessibility
```

Critical order workflows must be covered by E2E tests.

---

## 30. Definition of Done

Orders are complete when:

- Orders are created through checkout.
- Historical order information is preserved.
- Unique order numbers work.
- Order status works.
- Payment status is separate and correct.
- Customers can view their own orders.
- Administrators can manage authorized orders.
- Inventory integration works.
- Delivery tracking integrates correctly.
- Socket.IO updates work where required.
- Brevo order/payment notifications work.
- Invoice PDF generation works.
- Payment receipt PDF access works.
- Ownership and authorization are enforced.
- Loading/error states exist.
- Accessibility is verified.
- RTL/localization is verified.
- Tests pass.
- Documentation matches implementation.

---

## 31. Order Principle

> **An order is the authoritative historical record of a commerce transaction and must remain consistent across payment, inventory, delivery, customer access, notifications, and generated documents.**
