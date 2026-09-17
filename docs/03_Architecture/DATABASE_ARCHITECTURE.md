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

# Database Architecture — Current Baseline

# Database Architecture

## 1. Purpose

This document defines the database architecture for ElectroHub.

The database layer is responsible for persistent application state while business rules remain in the Node.js backend.

ElectroHub uses:

```text
Supabase PostgreSQL
        +
Prisma ORM
```

The frontend never connects directly to PostgreSQL.

---

## 2. Database Responsibilities

The database stores authoritative persistent data for:

- Users and authentication-related records.
- Roles and permissions.
- Products.
- Categories.
- Product images and media metadata.
- Inventory.
- Carts.
- Wishlist entries.
- Orders.
- Order items.
- Payments.
- Delivery information.
- Recommendation-related data.
- User behavior where required.
- Operational and audit data where required.

---

## 3. Architecture Flow

```text
React Frontend
      ↓
Node.js / Express Backend
      ↓
Service Layer
      ↓
Prisma ORM
      ↓
Supabase PostgreSQL
```

The backend is the only application layer responsible for normal database access.

---

## 4. Supabase PostgreSQL

Supabase provides the PostgreSQL database infrastructure.

The application uses PostgreSQL as the authoritative persistence layer.

Supabase-specific infrastructure should not replace application-level authorization and business rules.

The backend remains responsible for validating every operation.

---

## 5. Prisma ORM

Prisma is the primary database access layer.

Prisma provides:

- Type-safe database queries.
- Schema definition.
- Relationships.
- Migrations.
- Database client generation.
- Consistent database access.

Conceptually:

```text
Backend Service
      ↓
Prisma Client
      ↓
PostgreSQL
```

Database queries should not be scattered throughout controllers.

---

## 6. Core Data Domains

The database is organized around the following domains:

```text
Identity
Products
Commerce
Payments
Inventory
Delivery
Recommendations
Administration
Operations
```

These domains should remain logically separated even when implemented within the same PostgreSQL database.

---

## 7. Identity Data

Identity-related data may include:

```text
User
Role
Refresh Token / Session
OTP
```

Authentication secrets and sensitive credential data must be stored securely.

Passwords must never be stored in plaintext.

OTP records should support expiration and attempt controls where persistence is required.

---

## 8. Product Data

Product-related entities include:

```text
Product
Category
ProductImage
```

A product may contain information such as:

- Name.
- Description.
- Price.
- SKU.
- Category.
- Availability.
- Inventory reference.
- Media references.
- Product metadata.

Product data is authoritative in PostgreSQL.

---

## 9. Category Data

Categories organize products.

Conceptually:

```text
Category
   │
   └── Products
```

The relationship should support efficient category-based filtering and product discovery.

---

## 10. Media Data

Product images are stored through Cloudinary.

The database stores relevant metadata/references rather than large image binaries where possible.

Conceptually:

```text
Product
   ↓
ProductImage
   ↓
Cloudinary URL / Public Reference
```

Media ownership and administrative operations remain controlled by the backend.

---

## 11. Inventory Data

Inventory represents product availability.

Conceptually:

```text
Product
   ↓
Inventory
   ├── Quantity
   ├── Low-stock threshold
   └── Availability
```

Availability states:

```text
In Stock
Low Stock
Out of Stock
```

Inventory changes must occur through authorized backend operations.

---

## 12. Cart Data

Cart data represents a customer's current shopping state.

Conceptually:

```text
User
 ↓
Cart
 ↓
CartItem
 ↓
Product
```

The backend validates product availability and quantity before checkout.

The client-side cart must never be considered authoritative.

---

## 13. Wishlist Data

Wishlist relationships connect users with products.

Conceptually:

```text
User
 ↓
Wishlist / WishlistItem
 ↓
Product
```

Users should only be able to modify their own wishlist through authorized backend operations.

---

## 14. Order Data

Core order entities include:

```text
Order
OrderItem
```

Conceptually:

```text
User
 ↓
Order
 ↓
OrderItem
 ↓
Product
```

Orders should preserve the relevant purchase information required for historical accuracy.

The order record must not depend on the product's future state to reconstruct a completed purchase.

---

## 15. Order Lifecycle

Supported order states:

```text
Confirmed
Preparing
Out for Delivery
Delivered
```

The backend controls valid state transitions.

The database stores the current authoritative order state.

---

## 16. Payment Data

Payment information is represented separately from the order.

Conceptually:

```text
Order
 ↓
Payment
```

Payment records should retain the relevant Stripe/Test Mode reference and application payment state.

Sensitive payment credentials must never be stored in the database.

Stripe remains the external payment-provider source for provider-side payment information.

---

## 17. Checkout Consistency

Checkout may involve multiple database changes:

```text
Order
+
Order Items
+
Payment State
+
Inventory
```

Where business consistency requires atomicity, related database operations should use Prisma transactions.

External Stripe operations do not participate in PostgreSQL transactions and must be reconciled carefully.

---

## 18. Delivery Data

Delivery information may be associated with an order.

Conceptually:

```text
Order
 ↓
Delivery
 ├── Status
 ├── Location
 └── Tracking Information
```

The backend controls delivery state.

Real-time Socket.IO events communicate state changes to connected customers, while PostgreSQL remains the persistent source of truth.

---

## 19. Recommendation Data

Recommendation-related data may include:

```text
Product interactions
Product views
Product clicks
Purchases
Recommendation results
```

The exact data model depends on the selected recommendation implementation.

The database stores application data, while AI processing remains isolated in FastAPI.

---

## 20. User Behavior

If behavior-based recommendations are implemented, relevant events may include:

```text
Product View
Product Click
Purchase
```

Only data required for the recommendation feature should be retained.

The system should avoid unnecessary collection of personal data.

---

## 21. Email and OTP Data

Transactional email is handled by Brevo.

The database may store application-level records required for:

```text
OTP verification
Email delivery state where required
Order notification state where required
Payment notification state where required
```

Brevo credentials are never stored as application data.

---

## 22. PDF Documents

Invoices and payment receipts are generated from authoritative order/payment data.

Conceptually:

```text
Order / Payment
      ↓
Backend PDF Service
      ↓
PDF
```

The database should retain the underlying authoritative financial/order information required to reproduce or validate the document.

Generated documents must only be accessible to authorized users.

---

## 23. Relationships

The main conceptual relationships are:

```text
User
 ├── Cart
 ├── Wishlist
 └── Orders

Category
 └── Products

Product
 ├── Product Images
 ├── Inventory
 ├── Cart Items
 ├── Wishlist Items
 └── Order Items

Order
 ├── Order Items
 ├── Payment
 └── Delivery
```

The final Prisma schema is the implementation source of truth for exact relationships.

---

## 24. Indexing

Indexes should be created based on actual query patterns.

Likely candidates include:

```text
Product SKU
Product Category
Product Search Fields where appropriate
Order User
Order Status
Order Created Date
Payment Provider Reference
Delivery Status
```

Indexes should be justified by query requirements and verified through performance testing.

Avoid unnecessary indexes because they increase write and storage costs.

---

## 25. Constraints

The database should use appropriate constraints for data integrity.

Examples:

- Primary keys.
- Foreign keys.
- Unique constraints.
- Non-null constraints.
- Appropriate defaults.
- Check constraints where supported and useful.

Business rules that require application context remain in the backend service layer.

---

## 26. Migrations

Database schema changes are managed through Prisma migrations.

Migration workflow:

```text
Schema Change
 ↓
Prisma Migration
 ↓
Review
 ↓
Testing
 ↓
Apply to Environment
```

Migrations must be version-controlled.

Destructive migrations require additional review and an appropriate recovery plan.

---

## 27. Seeding

Development and testing environments may use seed data.

Seed data can include:

```text
Demo Users
Demo Products
Categories
Inventory
Orders
```

Production data must never be overwritten by development seed operations.

---

## 28. Backup and Recovery

Production database operations must include a backup and recovery strategy.

The project should document:

- Backup frequency.
- Retention.
- Recovery procedure.
- Restore verification.
- Responsibility for backups.

Supabase/database provider capabilities should be used appropriately.

---

## 29. Security

Database security requirements include:

- Strong database credentials.
- Secure connection configuration.
- Least-privilege access where possible.
- No database credentials in source code.
- No direct browser database access for protected application data.
- Safe migrations.
- Controlled production access.

---

## 30. Environment Separation

Database environments should be separated conceptually:

```text
Development
Testing / CI
Preview
Production
```

Production credentials and connection strings must never be committed to Git.

---

## 31. Performance

Database performance should consider:

- Query efficiency.
- Indexing.
- Pagination.
- Relation loading.
- N+1 query prevention.
- Connection management.
- Appropriate transaction scope.

Performance changes should be based on measured query behavior rather than assumptions.

---

## 32. Testing

Database testing should cover:

```text
Schema
Migrations
Relationships
Constraints
Repositories / Prisma queries
Transactions
Seed data
Critical business workflows
```

Critical workflows include checkout, order creation, inventory updates, payment state, and delivery state.

---

## 33. Database Completion Criteria

The database architecture is complete when:

- Supabase PostgreSQL ownership is defined.
- Prisma responsibilities are defined.
- Core domains are defined.
- Relationships are documented.
- Inventory and order consistency are defined.
- Payment persistence is defined.
- Delivery persistence is defined.
- AI-related data ownership is defined.
- Indexing strategy is documented.
- Migrations are documented.
- Seeding is documented.
- Backup/recovery is documented.
- Security requirements are defined.
- Testing requirements are defined.

---

## 34. Database Principle

> **Keep PostgreSQL as the authoritative persistent state, Prisma as the typed access layer, and business rules in the backend service layer.**
