# Entity Relationship Diagram

## 1. Purpose

This document defines the conceptual Entity Relationship Diagram (ERD) for ElectroHub.

The database supports users, catalog, cart, wishlist, orders, payments, inventory, delivery tracking, recommendations, analytics, notifications, and generated order/payment documents.

---

## 2. Database System

```text
React
  ↓
Node.js / Express
  ↓
Prisma ORM
  ↓
Supabase PostgreSQL
```

Prisma is the backend database access layer. Supabase provides PostgreSQL. The FastAPI AI service does not own commerce data.

---

## 3. High-Level ERD

```text
User
 ├── Cart ──── CartItem ──── Product ──── Category
 ├── WishlistItem ────────── Product
 ├── Order ─── OrderItem ─── Product
 │     ├── Payment
 │     └── Delivery
 ├── BehavioralEvent
 └── Notification

Product
 ├── ProductImage
 ├── Inventory
 └── Recommendation relationships

Order
 └── GeneratedDocument (optional persistent document metadata)
```

---

## 4. Core Relationships

| Entity | Relationship | Entity |
|---|---|---|
| User | 1:1 | Cart |
| User | 1:N | Orders |
| User | 1:N | Wishlist Items |
| User | 1:N | Behavioral Events |
| User | 1:N | Notifications |
| Category | 1:N | Products |
| Product | 1:N | Product Images |
| Product | 1:1 | Inventory |
| Cart | 1:N | Cart Items |
| Product | 1:N | Cart Items |
| Product | 1:N | Wishlist Items |
| Order | 1:N | Order Items |
| Product | 1:N | Order Items |
| Order | 1:1 | Payment |
| Order | 1:1 | Delivery |
| Product | N:N* | Recommendations |

`*` Recommendation relationships are represented through an intermediate relationship model.

---

## 5. User

Represents an authenticated customer or administrator.

Typical data:

```text
id
email
passwordHash
role
createdAt
updatedAt
```

Relationships:

```text
User 1 ─── 1 Cart
User 1 ─── N WishlistItem
User 1 ─── N Order
User 1 ─── N BehavioralEvent
User 1 ─── N Notification
```

---

## 6. Catalog

### Category

```text
id
name
slug
description
createdAt
updatedAt
```

```text
Category 1 ─── N Product
```

### Product

```text
id
name
slug
description
price
status
categoryId
createdAt
updatedAt
```

```text
Product N ─── 1 Category
Product 1 ─── N ProductImage
Product 1 ─── 1 Inventory
Product 1 ─── N CartItem
Product 1 ─── N WishlistItem
Product 1 ─── N OrderItem
```

### ProductImage

Stores product-image references and metadata. Cloudinary may store the actual media.

```text
id
productId
url
altText
metadata
createdAt
```

### Inventory

```text
id
productId
quantity
lowStockThreshold
updatedAt
```

Inventory is authoritative for purchasability and must support concurrency-safe updates.

---

## 7. Cart and Wishlist

### Cart

```text
id
userId
createdAt
updatedAt
```

A customer has one active cart.

### CartItem

```text
id
cartId
productId
quantity
createdAt
updatedAt
```

Recommended constraint:

```text
Unique(cartId, productId)
```

### WishlistItem

```text
id
userId
productId
createdAt
```

Recommended constraint:

```text
Unique(userId, productId)
```

---

## 8. Orders

### Order

```text
id
orderNumber
userId
subtotal
shippingAmount
total
status
shippingInformation
createdAt
updatedAt
```

```text
User 1 ─── N Order
Order 1 ─── N OrderItem
Order 1 ─── 1 Payment
Order 1 ─── 1 Delivery
```

### OrderItem

```text
id
orderId
productId
productNameSnapshot
unitPrice
quantity
```

The historical purchase price must be preserved independently of the current product price.

---

## 9. Payment

```text
id
orderId
provider
providerReference
amount
status
createdAt
updatedAt
```

Stripe is the payment provider and is used in Test Mode. Raw card information is never stored.

Payment status is independent of order/delivery status.

---

## 10. Delivery

```text
id
orderId
status
latitude
longitude
estimatedArrival
updatedAt
```

Supported workflow states:

```text
Confirmed
Preparing
Out for Delivery
Delivered
```

Delivery coordinates are exposed only to authorized users.

---

## 11. Recommendations

Recommendation relationships may contain:

```text
sourceProductId
recommendedProductId
type
score
createdAt
```

Supported strategies include:

```text
Popular
Similar Products
Category Based
Personalized
Frequently Bought Together
```

Recommendations may be rule-based, database-derived, or produced by the FastAPI AI service.

---

## 12. Behavioral Events and Analytics

A behavioral event may contain:

```text
id
userId nullable
eventType
productId nullable
orderId nullable
metadata
createdAt
```

Examples:

```text
product.viewed
product.clicked
cart.item_added
wishlist.added
search.performed
image_search.completed
recommendation.clicked
checkout.started
order.created
```

Passwords, OTP values, JWTs, refresh tokens, card data, and other secrets must never be stored as analytics events.

---

## 13. Notifications

Where persistence is required, notifications may contain:

```text
id
userId
type
status
createdAt
sentAt
```

Brevo handles transactional email delivery for:

```text
OTP
Order Confirmation
Payment Confirmation
```

Notification failure must not incorrectly change payment or order state.

---

## 14. Generated Documents

Orders/payments support:

```text
Order Invoice PDF
Payment Receipt PDF
```

PDFs may be generated dynamically. If persistent metadata is required, a document record can contain:

```text
id
orderId
type
storageReference
createdAt
```

Document downloads require authentication and order ownership/authorization.

---

## 15. Image Search

Image Search is primarily a service workflow:

```text
Image Input
 ↓
Backend
 ↓
FastAPI
 ↓
Product References
 ↓
Backend Product Data
```

Customer search images should not automatically become permanent product assets.

---

## 16. Referential Integrity

Foreign keys must enforce valid relationships. Historical order records must not be accidentally destroyed when catalog products are archived or removed.

Prefer archival over destructive deletion for products referenced by historical orders.

---

## 17. Source of Truth

```text
Conceptual ERD
 ↓
Prisma Schema
 ↓
Prisma Migration
 ↓
Supabase PostgreSQL
```

These representations must remain synchronized.

---

## 18. Future Expansion

Possible future entities include:

```text
Coupons
Reviews
Returns
Refunds
Addresses
Product Variants
Audit Logs
Delivery Location History
```

They should only be introduced when required by an approved feature or architectural decision.
