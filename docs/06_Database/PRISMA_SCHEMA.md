# Task 03.5 Checkout schema additions

The actual `schema.prisma` now adds Order checkout attempt UUID/request hash, delivery and Card-method enums, shipping phone and two UTC date snapshots; OrderItem gains nullable `productImageUrl`. Owner/attempt uniqueness protects idempotency. Decimal(12,2), existing relationships and historical migration files remain unchanged. Forward migration `20261006000000_checkout_core` adds positive-item/nonnegative-money checks. Public reference is derived as `ORD-<Order UUID>`, not an `orderNumber` column. No Payment or Delivery record is created by 03.5. See [Checkout Core](../05_Features/CHECKOUT_CORE_03.5.md) and [deployment evidence](../tasks/Phase-03/TASK_03.5_IMPLEMENTATION_EVIDENCE.md). Historical examples below are conceptual/future examples and are not substitutes for the current schema.

# ElectroHub Database — Task 02.5 Implementation

> Task 02.5 implementation supersedes the historical 02.2 catalog details below. Current local schema has 23 application models, including Brand and ProductSpecification. Shared DEV/PROD application and live schema verification are deferred to Gemini; see [database handoff](PRODUCT_FOUNDATION_HANDOFF.md).

## Task 02.5 catalog schema

Brand has unique name/slug and nullable description/logoUrl. Product.brandId is nullable UUID with Restrict deletion; modelNumber and compareAtPrice Decimal(12,2) are optional. Category.imageUrl is optional. ProductSpecification stores bounded group/name/value text and sortOrder, not JSON. ProductImage.sortOrder uses @map("position") and the existing compound index name, preserving stored positions. Existing SKU, price, status, Inventory and commerce fields/relationships remain unchanged.

Brand is mandatory for all new/curated 02.5 products, while legacy rows without verifiable manufacturer data remain nullable until safely reconciled.

---

# Historical Task 02.2 Database Foundation

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

# Prisma Schema — Current Baseline

# Prisma Schema

## 1. Purpose

This document defines the Prisma ORM architecture for ElectroHub.

```text
Node.js / Express
      ↓
   Prisma ORM
      ↓
Supabase PostgreSQL
```

Prisma provides type-safe database access. The schema, migrations, and conceptual ERD must remain synchronized.

---

## 2. Datasource

The project uses PostgreSQL through Supabase.

Conceptually:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

`DATABASE_URL` is an environment secret and must never be committed.

---

## 3. Core Models

The expected model groups are:

```text
User
Category
Product
ProductImage
Inventory
Cart
CartItem
WishlistItem
Order
OrderItem
Payment
Delivery
Recommendation
BehavioralEvent
Notification
GeneratedDocument (optional)
```

---

## 4. User

```prisma
model User {
  id            String            @id @default(uuid())
  email         String            @unique
  passwordHash  String
  role          UserRole          @default(CUSTOMER)
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt

  cart          Cart?
  orders        Order[]
  wishlist      WishlistItem[]
  events        BehavioralEvent[]
  notifications Notification[]
}
```

### UserRole

```prisma
enum UserRole {
  CUSTOMER
  ADMIN
}
```

Role authorization is enforced by the backend.

---

## 5. Category

```prisma
model Category {
  id          String    @id @default(uuid())
  name        String
  slug        String    @unique
  description String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  products    Product[]
}
```

---

## 6. Product

```prisma
model Product {
  id             String            @id @default(uuid())
  name           String
  slug           String            @unique
  description    String?
  price          Decimal
  status         ProductStatus     @default(ACTIVE)
  categoryId     String
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  category       Category          @relation(fields: [categoryId], references: [id])
  images         ProductImage[]
  inventory      Inventory?
  cartItems      CartItem[]
  wishlist       WishlistItem[]
  orderItems     OrderItem[]
  sourceRecs     Recommendation[]  @relation("SourceRecommendations")
  targetRecs     Recommendation[]  @relation("RecommendedProducts")
  events         BehavioralEvent[]

  @@index([categoryId])
  @@index([status])
}
```

### ProductStatus

```prisma
enum ProductStatus {
  ACTIVE
  INACTIVE
  ARCHIVED
}
```

---

## 7. ProductImage

```prisma
model ProductImage {
  id        String   @id @default(uuid())
  productId String
  url       String
  altText   String?
  metadata  Json?
  createdAt DateTime @default(now())

  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([productId])
}
```

Cloudinary stores media; PostgreSQL stores references/metadata.

---

## 8. Inventory

```prisma
model Inventory {
  id                String   @id @default(uuid())
  productId         String   @unique
  quantity          Int      @default(0)
  lowStockThreshold Int      @default(5)
  updatedAt         DateTime @updatedAt

  product           Product  @relation(fields: [productId], references: [id])
}
```

Inventory updates must be concurrency-safe.

---

## 9. Cart and CartItem

```prisma
model Cart {
  id        String     @id @default(uuid())
  userId    String     @unique
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  items     CartItem[]
}

model CartItem {
  id        String   @id @default(uuid())
  cartId    String
  productId String
  quantity  Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  cart      Cart     @relation(fields: [cartId], references: [id], onDelete: Cascade)
  product   Product  @relation(fields: [productId], references: [id])

  @@unique([cartId, productId])
  @@index([productId])
}
```

---

## 10. WishlistItem

```prisma
model WishlistItem {
  id        String   @id @default(uuid())
  userId    String
  productId String
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  product   Product  @relation(fields: [productId], references: [id])

  @@unique([userId, productId])
  @@index([productId])
}
```

---

## 11. Order

```prisma
model Order {
  id             String       @id @default(uuid())
  orderNumber    String       @unique
  userId         String
  subtotal       Decimal
  shippingAmount Decimal
  total          Decimal
  status         OrderStatus  @default(CONFIRMED)
  shippingInfo   Json
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  user           User         @relation(fields: [userId], references: [id])
  items          OrderItem[]
  payment        Payment?
  delivery       Delivery?
  documents      GeneratedDocument[]
  events         BehavioralEvent[]

  @@index([userId])
  @@index([status])
  @@index([createdAt])
}
```

### OrderStatus

```prisma
enum OrderStatus {
  CONFIRMED
  PREPARING
  OUT_FOR_DELIVERY
  DELIVERED
}
```

The UI displays `Out for Delivery`; the database enum uses a safe identifier.

---

## 12. OrderItem

```prisma
model OrderItem {
  id                  String   @id @default(uuid())
  orderId             String
  productId           String
  productNameSnapshot String
  unitPrice           Decimal
  quantity            Int

  order               Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  product             Product  @relation(fields: [productId], references: [id])

  @@index([orderId])
  @@index([productId])
}
```

`unitPrice` preserves the historical purchase price.

---

## 13. Payment

```prisma
model Payment {
  id                String          @id @default(uuid())
  orderId           String          @unique
  provider          PaymentProvider
  providerReference String?
  amount            Decimal
  status            PaymentStatus
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  order             Order           @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([status])
  @@index([providerReference])
}
```

### PaymentProvider

```prisma
enum PaymentProvider {
  STRIPE
}
```

### PaymentStatus

```prisma
enum PaymentStatus {
  PENDING
  SUCCEEDED
  FAILED
}
```

Stripe is used in Test Mode. Raw card data is never stored.

---

## 14. Delivery

```prisma
model Delivery {
  id               String      @id @default(uuid())
  orderId          String      @unique
  status           OrderStatus
  latitude         Decimal?
  longitude        Decimal?
  estimatedArrival DateTime?
  updatedAt        DateTime    @updatedAt

  order            Order       @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([status])
}
```

If delivery states later diverge from order states, introduce a dedicated `DeliveryStatus` enum through an approved schema change.

---

## 15. Recommendation

```prisma
model Recommendation {
  id                   String               @id @default(uuid())
  sourceProductId      String
  recommendedProductId String
  type                 RecommendationType
  score                Decimal?
  createdAt            DateTime             @default(now())

  sourceProduct        Product              @relation("SourceRecommendations", fields: [sourceProductId], references: [id], onDelete: Cascade)
  recommendedProduct   Product              @relation("RecommendedProducts", fields: [recommendedProductId], references: [id], onDelete: Cascade)

  @@unique([sourceProductId, recommendedProductId, type])
  @@index([recommendedProductId])
  @@index([type])
}
```

### RecommendationType

```prisma
enum RecommendationType {
  POPULAR
  SIMILAR
  CATEGORY_BASED
  PERSONALIZED
  FREQUENTLY_BOUGHT_TOGETHER
}
```

The actual persistence strategy may vary if recommendations are generated dynamically by FastAPI.

---

## 16. BehavioralEvent

```prisma
model BehavioralEvent {
  id        String   @id @default(uuid())
  userId    String?
  eventType String
  productId String?
  orderId   String?
  metadata  Json?
  createdAt DateTime @default(now())

  user      User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  product   Product? @relation(fields: [productId], references: [id], onDelete: SetNull)
  order     Order?   @relation(fields: [orderId], references: [id], onDelete: SetNull)

  @@index([eventType])
  @@index([userId])
  @@index([productId])
  @@index([orderId])
  @@index([createdAt])
}
```

Sensitive authentication and payment data must never be stored in `metadata`.

---

## 17. Notification

```prisma
model Notification {
  id        String             @id @default(uuid())
  userId    String
  type      NotificationType
  status    NotificationStatus
  createdAt DateTime           @default(now())
  sentAt    DateTime?

  user      User               @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([status])
}

enum NotificationType {
  OTP
  ORDER_CONFIRMATION
  PAYMENT_CONFIRMATION
}

enum NotificationStatus {
  PENDING
  SENT
  FAILED
}
```

Brevo handles transactional email delivery.

---

## 18. GeneratedDocument

This model is optional when PDFs are generated dynamically.

```prisma
model GeneratedDocument {
  id               String         @id @default(uuid())
  orderId          String
  type             DocumentType
  storageReference String?
  createdAt        DateTime       @default(now())

  order            Order          @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([orderId])
  @@index([type])
}

enum DocumentType {
  ORDER_INVOICE
  PAYMENT_RECEIPT
}
```

Documents must be access-controlled.

---

## 19. Money Types

Use Prisma `Decimal` for monetary fields:

```text
Product.price
Order.subtotal
Order.shippingAmount
Order.total
OrderItem.unitPrice
Payment.amount
```

Do not use floating-point values for authoritative financial calculations.

---

## 20. Constraints and Indexes

Important constraints include:

```text
User.email UNIQUE
Product.slug UNIQUE
Order.orderNumber UNIQUE
Cart.userId UNIQUE
CartItem(cartId, productId) UNIQUE
WishlistItem(userId, productId) UNIQUE
Inventory.productId UNIQUE
Payment.orderId UNIQUE
Delivery.orderId UNIQUE
```

Indexes should support actual query patterns and must not be added indiscriminately.

---

## 21. Historical Data

Orders are historical records.

```text
Current Product Price
        ≠
Historical Order Item Price
```

Products referenced by historical orders should normally be archived rather than destructively deleted.

---

## 22. Migrations

All schema changes use Prisma migrations.

```text
schema.prisma
      ↓
Migration Review
      ↓
Prisma Migration
      ↓
Test
      ↓
Apply
      ↓
Verify Supabase PostgreSQL
```

Production migrations require review before deployment.

---

## 23. Transactions

Use Prisma transactions when multiple database operations must remain consistent.

Examples:

```text
Order Creation
Order Items
Inventory Update
```

External systems such as Stripe and Brevo do not participate in the PostgreSQL transaction and must be handled with appropriate application-level consistency/idempotency.

---

## 24. Seeding

Development/test seed data may include:

```text
Users
Categories
Products
Inventory
Orders
```

Seed data must not contain real credentials, payment information, or secrets.

---

## 25. Environment Security

Database configuration is provided through environment variables, for example:

```text
DATABASE_URL
```

Never commit production credentials.

Development, test, and production databases must use separate credentials/configuration.

---

## 26. Source of Truth

```text
ERD
 ↓
Prisma Schema
 ↓
Prisma Migration
 ↓
Supabase PostgreSQL
```

Any significant schema change must update the relevant documentation and, where appropriate, an ADR.

---

## 27. Definition of Done

The Prisma database layer is complete when:

- Core models are implemented.
- Relationships are correct.
- Foreign keys are enforced.
- Unique constraints are defined.
- Required indexes exist.
- Money uses decimal types.
- Historical order data is preserved.
- Critical multi-step operations use appropriate transactions.
- Migrations are tested.
- Seed data works.
- Environment variables are secure.
- Prisma Client generation works.
- Documentation matches the implementation.
- Tests pass.
