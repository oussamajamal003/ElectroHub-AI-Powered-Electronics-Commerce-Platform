# ElectroHub Task 02.2 — Latest Implemented Database Foundation

> This document is synchronized to the current Task 02.2 baseline. Prisma is the schema/migration source of truth. The implemented application model set is 15 models; `_prisma_migrations` is Prisma metadata.

## Environments

- Development: `electrohub-dev` — Supabase project ref `pzxekjybdiulzmssalfo`
- Production: Supabase project ref `yepfgjehdstlxbpespun`
- Development seed: allowed only on `electrohub-dev`
- Production development seed: forbidden

## Implemented Application Models

`Role`, `User`, `Address`, `Category`, `Product`, `ProductImage`, `Inventory`, `Cart`, `CartItem`, `Wishlist`, `WishlistItem`, `Order`, `OrderItem`, `Payment`, `Delivery`.

## Explicitly Out of Task 02.2 Core Schema

`RefreshToken`, `OTP`, `RecommendationEvent`, `RecommendationResult`, `UserBehavior`, `AuditLog`, `ShipmentHistory`, `StripeWebhookEvent`, `EmailDelivery`, `PDFDocument`, and other future feature-specific models unless separately approved.

## Authoritative Flow

```text
Task 02.2
   ↓
apps/backend/prisma/schema.prisma
   ↓
Prisma migration
   ↓
Supabase PostgreSQL
```

Do not use `supabase db push` as a competing migration source of truth.

# Relationships — Current Baseline

# Database Relationships

## 1. Purpose

This document defines the relationships between the ElectroHub database entities.

The relationship model supports:

```text
Catalog
Cart
Wishlist
Checkout
Payments
Orders
Inventory
Delivery
Recommendations
Analytics
Notifications
Documents
```

The Prisma schema and database migrations must remain consistent with these relationships.

---

# 2. Relationship Overview

```text
User
 ├── 1:1 ── Cart
 ├── 1:N ── WishlistItem
 ├── 1:N ── Order
 ├── 1:N ── BehavioralEvent
 └── 1:N ── Notification

Category
 └── 1:N ── Product

Product
 ├── N:1 ── Category
 ├── 1:N ── ProductImage
 ├── 1:1 ── Inventory
 ├── 1:N ── CartItem
 ├── 1:N ── WishlistItem
 ├── 1:N ── OrderItem
 └── N:N ── Product Recommendation

Cart
 └── 1:N ── CartItem

Order
 ├── 1:N ── OrderItem
 ├── 1:1 ── Payment
 ├── 1:1 ── Delivery
 └── 1:N ── GeneratedDocument
```

---

# 3. User → Cart

Relationship:

```text
User 1 ──── 1 Cart
```

A customer has one active cart.

Database rule:

```text
carts.user_id UNIQUE
```

This prevents multiple active carts for the same user under the approved model.

---

# 4. User → Wishlist

Relationship:

```text
User 1 ──── N WishlistItem
```

A customer can save many products.

Each wishlist item belongs to exactly one user.

Uniqueness:

```text
UNIQUE(user_id, product_id)
```

This prevents duplicate saved products.

---

# 5. User → Orders

Relationship:

```text
User 1 ──── N Order
```

A customer can create multiple orders.

Each order belongs to one customer.

Foreign key:

```text
orders.user_id → users.id
```

---

# 6. User → Behavioral Events

Relationship:

```text
User 1 ──── N BehavioralEvent
```

A user can generate multiple behavioral events.

The relationship may be nullable to support events that do not require an authenticated user.

Example:

```text
Anonymous Product View
```

may not have a `user_id`.

---

# 7. User → Notifications

Relationship:

```text
User 1 ──── N Notification
```

A user may receive multiple transactional notifications.

Examples:

```text
OTP
Order Confirmation
Payment Confirmation
```

Brevo handles external email delivery.

---

# 8. Category → Product

Relationship:

```text
Category 1 ──── N Product
```

A category can contain many products.

Each product belongs to an appropriate category according to the approved product model.

Foreign key:

```text
products.category_id → categories.id
```

---

# 9. Product → Product Images

Relationship:

```text
Product 1 ──── N ProductImage
```

A product may have multiple images.

Examples:

```text
Main Image
Gallery Image
Additional Product Image
```

Product image references may point to Cloudinary-hosted assets.

---

# 10. Product → Inventory

Relationship:

```text
Product 1 ──── 1 Inventory
```

Each product has one current inventory record under the approved model.

Database rule:

```text
inventories.product_id UNIQUE
```

Inventory quantity is authoritative for current stock.

---

# 11. Product → Cart Items

Relationship:

```text
Product 1 ──── N CartItem
```

A product can appear in many customers' carts.

A cart item references one product.

---

# 12. Cart → Cart Items

Relationship:

```text
Cart 1 ──── N CartItem
```

A cart contains multiple selected products.

Each cart item belongs to one cart.

Uniqueness:

```text
UNIQUE(cart_id, product_id)
```

---

# 13. Product → Wishlist Items

Relationship:

```text
Product 1 ──── N WishlistItem
```

A product can be saved by many customers.

Each wishlist item references one product.

---

# 14. Order → Order Items

Relationship:

```text
Order 1 ──── N OrderItem
```

An order contains one or more purchased items.

Each order item belongs to one order.

---

# 15. Product → Order Items

Relationship:

```text
Product 1 ──── N OrderItem
```

A product may appear in many historical orders.

Order items preserve historical information such as:

```text
Product Name Snapshot
Unit Price
Quantity
```

This prevents current product changes from corrupting historical orders.

---

# 16. Order → Payment

Relationship:

```text
Order 1 ──── 1 Payment
```

Under the current architecture, an order has one authoritative payment record.

Database rule:

```text
payments.order_id UNIQUE
```

Stripe is the external payment provider.

---

# 17. Order → Delivery

Relationship:

```text
Order 1 ──── 1 Delivery
```

An order has one delivery-tracking record under the current model.

Database rule:

```text
deliveries.order_id UNIQUE
```

Delivery status remains separate from payment status.

---

# 18. Order → Generated Documents

Relationship:

```text
Order 1 ──── N GeneratedDocument
```

An order may have multiple generated documents.

Current document types include:

```text
ORDER_INVOICE
PAYMENT_RECEIPT
```

Document records are optional if PDFs are generated dynamically.

---

# 19. Product → Recommendations

Recommendations can represent a self-referencing product relationship.

Conceptually:

```text
Product
   │
   ├── sourceProduct
   │
   └── recommendedProduct
```

Therefore:

```text
Product N ──── N Product
```

through:

```text
Recommendation
```

A recommendation record may contain:

```text
sourceProductId
recommendedProductId
type
score
```

---

# 20. Behavioral Events → Product

Relationship:

```text
Product 1 ──── N BehavioralEvent
```

A product may generate many events.

Examples:

```text
Product Viewed
Product Clicked
Wishlist Added
Cart Added
Recommendation Clicked
```

The product reference may be nullable for events that are not product-specific.

---

# 21. Behavioral Events → Order

Relationship:

```text
Order 1 ──── N BehavioralEvent
```

Order-related events may reference an order.

Examples:

```text
Order Created
Checkout Started
Payment Succeeded
Delivery Updated
```

The order reference is optional.

---

# 22. Relationship Cardinality Summary

| Relationship | Cardinality |
|---|---|
| User → Cart | 1:1 |
| User → WishlistItem | 1:N |
| User → Order | 1:N |
| User → BehavioralEvent | 1:N |
| User → Notification | 1:N |
| Category → Product | 1:N |
| Product → ProductImage | 1:N |
| Product → Inventory | 1:1 |
| Cart → CartItem | 1:N |
| Product → CartItem | 1:N |
| Product → WishlistItem | 1:N |
| Order → OrderItem | 1:N |
| Product → OrderItem | 1:N |
| Order → Payment | 1:1 |
| Order → Delivery | 1:1 |
| Order → GeneratedDocument | 1:N |
| Product → Recommendation | N:N |
| Product → BehavioralEvent | 1:N |
| Order → BehavioralEvent | 1:N |

---

# 23. Foreign-Key Rules

Core foreign keys include:

```text
products.category_id
product_images.product_id
inventories.product_id

carts.user_id
cart_items.cart_id
cart_items.product_id

wishlist_items.user_id
wishlist_items.product_id

orders.user_id
order_items.order_id
order_items.product_id

payments.order_id
deliveries.order_id

recommendations.source_product_id
recommendations.recommended_product_id

behavioral_events.user_id
behavioral_events.product_id
behavioral_events.order_id

notifications.user_id

generated_documents.order_id
```

Every foreign key must reference a valid parent record.

---

# 24. Delete Behavior

Delete behavior must be selected deliberately.

Reasonable examples include:

```text
User → Cart
Cascade may be acceptable.

User → WishlistItem
Cascade may be acceptable.

Cart → CartItem
Cascade is generally appropriate.

Order → OrderItem
Cascade only when order deletion itself is permitted.

Product → ProductImage
Cascade may be appropriate for media metadata.

Order → Payment
Delete behavior must preserve required financial/audit records.

Order → Delivery
Delete behavior must preserve required operational history.
```

Historical commerce records must receive stronger protection than temporary shopping data.

---

# 25. Product Deletion and Historical Orders

A product may be archived instead of physically deleted when it has historical order references.

```text
Product
 ↓
ARCHIVED
 ↓
Unavailable for New Purchases
 ↓
Historical Orders Remain Valid
```

This protects referential integrity and historical reporting.

---

# 26. Cart and Inventory Relationship

Cart items reference products, not reserved inventory.

```text
CartItem
    ↓
Product
    ↓
Inventory
```

Adding a product to a cart does not reserve stock unless an explicit reservation system is introduced.

Checkout performs final inventory validation.

---

# 27. Order and Inventory Relationship

There is no need for a direct `Order → Inventory` foreign key.

The relationship is logically:

```text
OrderItem
   ↓
Product
   ↓
Inventory
```

Inventory is updated as part of the approved order-finalization process.

---

# 28. Order and Payment Relationship

Payment and order are separate concepts.

```text
Order
 ├── Order Status
 │
 └── Payment
       └── Payment Status
```

Examples:

```text
Order: Preparing
Payment: Succeeded
```

This separation is required for correct commerce state management.

---

# 29. Order and Delivery Relationship

Delivery extends order fulfillment:

```text
Order
 ↓
Delivery
 ├── Status
 ├── Location
 └── Estimated Arrival
```

Delivery updates may be distributed through Socket.IO.

Only authorized customers and administrators should receive relevant delivery information.

---

# 30. External Service Relationships

External services do not become database owners.

```text
Supabase
 └── PostgreSQL Database

Stripe
 └── Payment Provider

Brevo
 └── Transactional Email

Cloudinary
 └── Product Media

FastAPI
 └── AI Processing

Leaflet + OpenStreetMap
 └── Delivery Map Visualization
```

The application database stores only the identifiers/references required for integration.

---

# 31. Transaction Boundaries

Relationships involving critical commerce operations should be handled consistently.

Example:

```text
Order
 ├── Order Items
 └── Inventory Update
```

These database changes should be coordinated through an appropriate Prisma transaction where required.

External operations such as Stripe and Brevo are not part of the PostgreSQL transaction.

---

# 32. Data Integrity Principle

Database relationships must protect the following invariants:

```text
Cart Item → Valid Product
Order Item → Valid Order
Order Item → Valid Product
Payment → Valid Order
Delivery → Valid Order
Inventory → Valid Product
Wishlist Item → Valid User + Product
```

Invalid relationships must be rejected by the database and/or backend.

---

# 33. Source of Truth

Relationship documentation follows:

```text
ERD
 ↓
Prisma Schema
 ↓
Database Migration
 ↓
Supabase PostgreSQL
```

When a relationship changes, the affected documentation, Prisma schema, and migration must remain synchronized.

---

# 34. Definition of Done

Database relationships are complete when:

- Cardinalities are defined.
- Foreign keys are implemented.
- Unique relationships are enforced.
- Delete behavior is intentional.
- Historical data is protected.
- Critical transactions are consistent.
- Prisma relations match the ERD.
- Migrations match the Prisma schema.
- Documentation matches the implementation.
