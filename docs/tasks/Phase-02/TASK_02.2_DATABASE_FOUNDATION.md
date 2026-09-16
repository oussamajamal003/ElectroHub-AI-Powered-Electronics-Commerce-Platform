# TASK 02.2 — DATABASE FOUNDATION

**Branch:** `feature/database-foundation`

**Status:** Authoritative implementation task

**Scope:** Database integration (Prisma + Supabase PostgreSQL), based on the approved database, backend, and system architecture documents.

## Implementation Authority

This task is the complete implementation authority for TASK 02.2.

**Do not invent, expand, remove, rename, or redesign database entities, relationships, constraints, indexes, migration behavior, or seed behavior during implementation.** If an implementation detail appears ambiguous, stop and report the ambiguity rather than silently creating a new design.

The authoritative database flow is:

```text
prisma/schema.prisma
        ↓
Prisma migration
        ↓
Supabase PostgreSQL
```

Supabase is the place where the actual PostgreSQL database is inspected and managed, while **Prisma remains the authoritative schema, migration, and application-access layer**.

Supabase supports Prisma as an external ORM and provides connection information through the project's Connect interface.

---

# 1. Database Foundation

Establish the database foundation for ElectroHub using:

- Supabase PostgreSQL
- Prisma ORM
- Prisma migrations
- deterministic Prisma seed strategy
- explicit relationships
- foreign keys and delete/update behavior
- indexes and constraints
- validation against the actual Supabase database

## Required workflow

```text
Supabase project Created already
        ↓
Save DB password securely in .env.local
        ↓
Project/connection configuration in .env.local
        ↓
Implement TASK 02.2
        ↓
Prisma migration
        ↓
Supabase tables created
        ↓
Seed
        ↓
Verify schema + relationships + indexes
```

---

# 2. Supabase Setup — Already Completed

The Supabase project has already been created.

The implementation must use the existing Supabase project rather than creating another project.

The database password must remain securely stored in the local environment and must never be committed.

The Supabase MCP server is already configured and must be used for inspection and verification.

**20 Supabase MCP tools are enabled.**

## MCP authority

Use Supabase MCP to:

- inspect the actual Supabase PostgreSQL environment
- verify tables
- verify relationships
- verify indexes
- verify constraints
- inspect database state
- validate the result of Prisma migrations
- inspect database/security/performance information where applicable

**Prisma remains the authoritative schema and migration source of truth.**

Do not:

- bypass Prisma migrations
- create the schema manually in the Supabase dashboard
- manually create the authoritative tables through the Supabase SQL editor
- replace Prisma with Supabase MCP as the schema source of truth
- invent additional database tables because future features are known

---

# 3. Supabase CLI — Already Used

The following setup commands have already been used:

```powershell
npm install supabase --save-dev
npx supabase init
npx supabase login
supabase link --project-ref yepfgjehdstlxbpespun
```

The Supabase CLI remains useful for:

- project linking
- Supabase configuration
- inspection
- future Supabase-specific migrations/functions
- other Supabase-specific workflows

For this task, however, **Prisma remains the authoritative schema/migration mechanism**.

The authoritative application database workflow remains:

```text
prisma/schema.prisma
        ↓
Prisma migration
        ↓
Supabase PostgreSQL
```

---

# 4. Prisma ORM Setup

## 4.1 Install ORM

Add Prisma to the project:

```powershell
npm install prisma --save-dev
```

Initialize Prisma:

```powershell
npx prisma init
```

If Prisma has already been initialized in the repository, do not create a duplicate configuration. Reuse and update the existing configuration according to this task.

---

# 5. Prisma Configuration

The Supabase connection strings are already present in `.env.local`.

The expected Prisma configuration is:

**File:** `prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

Do not expose connection strings, passwords, or secrets in source control.

The following must remain local/secret:

- database password
- `DATABASE_URL` credentials
- `DIRECT_URL` credentials
- JWT secrets
- Stripe credentials
- Brevo credentials
- Cloudinary credentials
- any other production credentials

---

# 6. Agent Skills — Already Installed

Supabase Agent Skills have already been installed.

Agent Skills provide AI coding tools with ready-made instructions, scripts, and resources for working with Supabase accurately and efficiently.

The implementation agent must use the installed Supabase Agent Skills where relevant.

---

# 7. Seed Strategy — Authoritative Requirement

> **Use Prisma seed scripts for deterministic development/test foundation data, while keeping production seeding controlled and separate.**

The seed strategy must be defined before implementation is completed because it affects schema design, migration verification, and testing.

## 7.1 What should be seeded in 02.2?

Only **foundation/reference data** that is genuinely required by the current schema.

Example:

```text
Database
├── schema
├── relationships
├── indexes
├── migrations
└── seed
    ├── required system/reference data
    └── minimal development fixtures
```

If 02.2 creates entities such as:

- User
- Role
- Category
- Product
- etc.

then the seed should contain **minimal deterministic records** needed to verify relationships and development workflows.

It must **not** create a huge realistic catalog.

---

# 8. Migration ≠ Seed

These are separate concerns.

## Migration

Migration answers:

```text
"How do we change the database structure?"
```

Examples:

```text
Create Product table
Create Category table
Add Product.categoryId
Create index
```

## Seed

Seed answers:

```text
"How do we populate a fresh database with known initial data?"
```

Examples:

```text
Create ADMIN role
Create a small test category
Create a few development products
```

---

# 9. Seed Requirements

The seed must be:

- **Deterministic** — same input produces the same logical state
- **Idempotent** — safe to run repeatedly without creating duplicates
- **Environment-aware** — development/test data must not accidentally enter production
- **Minimal** — only data required for foundation/testing
- **Documented** — developers know how and when to run it
- **Non-secret** — no real passwords, API keys, payment credentials, etc.
- **Compatible with migrations** — migrations create the structure first, seed populates it afterward

Expected lifecycle:

```text
prisma migrate
      ↓
Database schema exists
      ↓
prisma seed
      ↓
Deterministic foundation data
```

---

# 10. Production Seed Safety

Production must **not** allow:

```text
npm run seed
```

to blindly insert development fixtures into production.

Production initialization must be explicitly controlled, especially once users, orders, payments, and real commerce data exist.

The seed strategy is a **deterministic development/test seeding mechanism — not production data initialization.**

---

# 11. Required Seed Scope

For 02.2, seed only enough data to prove the schema works.

Recommended foundation seed:

```text
Roles
├── CUSTOMER
└── ADMIN

Categories
├── Smartphones
├── Laptops
├── Tablets
└── Accessories

Products
├── 4–8 deterministic development products
└── each linked to a category

Inventory
└── one record per seeded product

Users
├── development admin
└── development customer
```

The implementation must:

- use the repository's Prisma seed mechanism
- seed the minimum foundation/reference data required by the current schema
- keep seed data deterministic
- make repeated seed execution safe/idempotent where practical
- never include real credentials, secrets, API keys, payment credentials, or production customer data
- clearly distinguish development/test fixtures from production data
- document how the seed is executed and when it should be used
- not create large or unrealistic commerce datasets unless explicitly required for schema verification
- not automatically seed production environments
- ensure migrations create the database structure before seed execution

Do **not** seed fake orders, fake payments, fake OTPs, or fake customer credentials unless the task specifically requires them.

For passwords, seed only **development-only hashed passwords**, never plaintext credentials.

---

# 12. Required Implementation Order

The implementation must follow this order:

```text
1. Define Seed Strategy
        ↓
2. Design Prisma schema
        ↓
3. Define relationships + constraints
        ↓
4. Define indexes
        ↓
5. Create migrations
        ↓
6. Implement Prisma seed
        ↓
7. Run migration + seed on a clean database
        ↓
8. Verify everything
        ↓
9. Complete TASK 02.2
```

Important:

**Decide the seed strategy first → implement it during 02.2 → verify it before declaring 02.2 complete.**

The actual seed script is implemented after the schema is finalized enough to seed.

---

# 13. Database Scope Boundary

Because this is **Database Foundation**, define the schema carefully now, but do not implement every future feature's full database model simply because those features are coming.

Distinguish:

## Required now

- Core entities required by the approved architecture
- Relationships
- Primary keys
- Foreign keys
- Constraints
- Indexes
- Prisma configuration
- Supabase PostgreSQL connection
- Migrations
- Seed strategy

## Later tasks

- detailed commerce fields
- payment-specific tables
- OTP/authentication persistence
- AI-specific persistence
- advanced order/payment workflows
- analytics/event storage

---

# 14. Authoritative TASK 02.2 Schema

**TASK 02.2 is authoritative for exactly these 14 tables:**

```text
Role
User
Address

Category
Product
ProductImage
Inventory

Cart
CartItem
Wishlist
WishlistItem

Order
OrderItem
Payment
Delivery
```

Do not add additional tables unless a separate approved task explicitly changes this scope.

---

# 15. Core Table Responsibilities

| Table | Purpose | Main relationships |
|---|---|---|
| `User` | Customer/admin identity foundation | Role, Address, Cart, Wishlist, Order |
| `Role` | Authorization foundation | Users |
| `Address` | User addresses | User |
| `Category` | Product categorization | Products |
| `Product` | Product catalog foundation | Category, Images, Inventory, CartItem, WishlistItem, OrderItem |
| `ProductImage` | Product media metadata | Product |
| `Inventory` | Stock foundation | Product |
| `Cart` | Shopping cart | User, CartItem |
| `CartItem` | Products in cart | Cart, Product |
| `Wishlist` | User wishlist | User, WishlistItem |
| `WishlistItem` | Products in wishlist | Wishlist, Product |
| `Order` | Purchase/order foundation | User, OrderItem, Payment, Delivery |
| `OrderItem` | Products purchased | Order, Product |
| `Payment` | Order payment foundation | Order |
| `Delivery` | Order delivery foundation | Order |

---

# 16. Relationship Matrix

The authoritative relationship model is:

```text
Role 1 ──── N User

User 1 ──── N Address
User 1 ──── 1 Cart
User 1 ──── 1 Wishlist
User 1 ──── N Order

Category 1 ──── N Product

Product 1 ──── N ProductImage
Product 1 ──── 1 Inventory

Cart 1 ──── N CartItem
Product 1 ──── N CartItem

Wishlist 1 ──── N WishlistItem
Product 1 ──── N WishlistItem

Order 1 ──── N OrderItem
Product 1 ──── N OrderItem

Order 1 ──── 1 Payment
Order 1 ──── 1 Delivery
```

## Relationship diagram

```text
                    ┌──────────────┐
                    │     Role     │
                    └──────┬───────┘
                           │ 1
                           │
                           │ N
                    ┌──────▼───────┐
                    │     User     │
                    └──────┬───────┘
             ┌─────────────┼──────────────┐
             │             │              │
             │ 1           │ 1            │ 1
             │             │              │
             │ N           │ 1            │ N
      ┌──────▼──────┐ ┌────▼─────┐ ┌──────▼──────┐
      │   Address   │ │   Cart   │ │    Order    │
      └─────────────┘ └────┬─────┘ └──────┬──────┘
                           │               │
                           │ 1             │ 1
                           │               │
                           │ N             │ N
                    ┌──────▼──────┐ ┌──────▼──────┐
                    │  CartItem   │ │  OrderItem  │
                    └──────┬──────┘ └──────┬──────┘
                           │ N:1           │ N:1
                           │               │
                           └───────┬───────┘
                                   │
                                   ▼
                            ┌─────────────┐
                            │   Product   │
                            └──────┬──────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │  N:1        │ 1:1           │ 1:N
                    ▼             ▼               ▼
              ┌──────────┐ ┌───────────┐ ┌──────────────┐
              │ Category │ │ Inventory │ │ProductImage  │
              └──────────┘ └───────────┘ └──────────────┘
```

---

# 17. Authoritative Prisma Schema

The following schema is the **authoritative 02.2 schema**.

Do not alter the entity list, field semantics, relationship model, FK behavior, enum values, constraints, or indexes without an approved architecture/task change.

**File:** `prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  CUSTOMER
  ADMIN
}

enum ProductStatus {
  ACTIVE
  INACTIVE
}

enum InventoryStatus {
  IN_STOCK
  LOW_STOCK
  OUT_OF_STOCK
}

enum OrderStatus {
  CONFIRMED
  PREPARING
  OUT_FOR_DELIVERY
  DELIVERED
  CANCELLED
}

enum PaymentStatus {
  PENDING
  PROCESSING
  SUCCEEDED
  FAILED
  REFUNDED
}

enum PaymentProvider {
  STRIPE
}

enum DeliveryStatus {
  CONFIRMED
  PREPARING
  OUT_FOR_DELIVERY
  DELIVERED
}

enum AddressType {
  SHIPPING
  BILLING
}

model Role {
  id          String     @id @default(uuid()) @db.Uuid
  name        UserRole   @unique
  description String?

  users User[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("roles")
}

model User {
  id           String   @id @default(uuid()) @db.Uuid
  roleId       String   @db.Uuid
  email        String   @unique @db.VarChar(255)
  passwordHash String   @db.VarChar(255)
  firstName    String   @db.VarChar(100)
  lastName     String   @db.VarChar(100)
  phone        String?  @db.VarChar(30)
  isActive     Boolean  @default(true)

  role      Role      @relation(fields: [roleId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  addresses Address[]
  cart      Cart?
  wishlist  Wishlist?
  orders    Order[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([roleId])
  @@index([isActive])
  @@map("users")
}

model Address {
  id         String      @id @default(uuid()) @db.Uuid
  userId     String      @db.Uuid
  type       AddressType @default(SHIPPING)
  label      String?     @db.VarChar(50)
  recipient  String      @db.VarChar(200)
  line1      String      @db.VarChar(255)
  line2      String?     @db.VarChar(255)
  city       String      @db.VarChar(100)
  state      String?     @db.VarChar(100)
  postalCode String?     @db.VarChar(20)
  country    String      @db.VarChar(100)
  latitude   Decimal?    @db.Decimal(9, 6)
  longitude  Decimal?    @db.Decimal(9, 6)
  isDefault  Boolean     @default(false)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
  @@index([userId, type])
  @@map("addresses")
}

model Category {
  id          String     @id @default(uuid()) @db.Uuid
  name        String     @unique @db.VarChar(100)
  slug        String     @unique @db.VarChar(120)
  description String?
  isActive    Boolean    @default(true)

  products Product[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([isActive])
  @@map("categories")
}

model Product {
  id          String        @id @default(uuid()) @db.Uuid
  categoryId  String        @db.Uuid
  sku         String        @unique @db.VarChar(100)
  name        String        @db.VarChar(255)
  slug        String        @unique @db.VarChar(280)
  description String?
  price       Decimal       @db.Decimal(12, 2)
  status      ProductStatus @default(ACTIVE)

  category   Category        @relation(fields: [categoryId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  images     ProductImage[]
  inventory  Inventory?
  cartItems  CartItem[]
  wishItems  WishlistItem[]
  orderItems OrderItem[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([categoryId])
  @@index([status])
  @@index([categoryId, status])
  @@index([createdAt])
  @@map("products")
}

model ProductImage {
  id        String  @id @default(uuid()) @db.Uuid
  productId String  @db.Uuid
  url       String  @db.VarChar(2048)
  publicId  String? @db.VarChar(255)
  altText   String? @db.VarChar(255)
  position  Int     @default(0)
  isPrimary Boolean @default(false)

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([productId])
  @@index([productId, position])
  @@map("product_images")
}

model Inventory {
  id           String          @id @default(uuid()) @db.Uuid
  productId    String          @unique @db.Uuid
  quantity     Int             @default(0)
  lowStockAt   Int             @default(5)
  status       InventoryStatus @default(IN_STOCK)

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([status])
  @@map("inventory")
}

model Cart {
  id     String @id @default(uuid()) @db.Uuid
  userId String @unique @db.Uuid

  user  User       @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  items CartItem[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("carts")
}

model CartItem {
  id        String   @id @default(uuid()) @db.Uuid
  cartId    String   @db.Uuid
  productId String   @db.Uuid
  quantity  Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  cart    Cart    @relation(fields: [cartId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  product Product @relation(fields: [productId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@unique([cartId, productId])
  @@index([cartId])
  @@index([productId])
  @@map("cart_items")
}

model Wishlist {
  id     String @id @default(uuid()) @db.Uuid
  userId String @unique @db.Uuid

  user  User           @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  items WishlistItem[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("wishlists")
}

model WishlistItem {
  id        String   @id @default(uuid()) @db.Uuid
  wishlistId String  @db.Uuid
  productId String  @db.Uuid
  createdAt DateTime @default(now())

  wishlist Wishlist @relation(fields: [wishlistId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  product  Product  @relation(fields: [productId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@unique([wishlistId, productId])
  @@index([wishlistId])
  @@index([productId])
  @@map("wishlist_items")
}

model Order {
  id              String        @id @default(uuid()) @db.Uuid
  userId          String        @db.Uuid
  status          OrderStatus   @default(CONFIRMED)
  subtotal        Decimal       @db.Decimal(12, 2)
  shippingCost    Decimal       @db.Decimal(12, 2) @default(0)
  total           Decimal       @db.Decimal(12, 2)
  currency        String        @default("USD") @db.VarChar(3)

  shippingRecipient  String      @db.VarChar(200)
  shippingLine1      String      @db.VarChar(255)
  shippingLine2      String?     @db.VarChar(255)
  shippingCity       String      @db.VarChar(100)
  shippingState      String?     @db.VarChar(100)
  shippingPostalCode String?     @db.VarChar(20)
  shippingCountry    String      @db.VarChar(100)
  shippingLatitude   Decimal?    @db.Decimal(9, 6)
  shippingLongitude  Decimal?    @db.Decimal(9, 6)

  user     User        @relation(fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  items    OrderItem[]
  payment  Payment?
  delivery Delivery?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
  @@index([status])
  @@index([createdAt])
  @@index([userId, createdAt])
  @@index([status, createdAt])
  @@map("orders")
}

model OrderItem {
  id        String  @id @default(uuid()) @db.Uuid
  orderId   String  @db.Uuid
  productId String  @db.Uuid
  productName String @db.VarChar(255)
  sku       String  @db.VarChar(100)
  unitPrice Decimal @db.Decimal(12, 2)
  quantity  Int
  lineTotal Decimal @db.Decimal(12, 2)

  order   Order   @relation(fields: [orderId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  product Product @relation(fields: [productId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([orderId])
  @@index([productId])
  @@map("order_items")
}

model Payment {
  id                String          @id @default(uuid()) @db.Uuid
  orderId           String          @unique @db.Uuid
  provider          PaymentProvider @default(STRIPE)
  providerPaymentId String?         @unique @db.VarChar(255)
  status            PaymentStatus   @default(PENDING)
  amount            Decimal         @db.Decimal(12, 2)
  currency          String          @default("USD") @db.VarChar(3)
  paidAt            DateTime?
  failureReason     String?

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([status])
  @@index([provider, status])
  @@map("payments")
}

model Delivery {
  id           String         @id @default(uuid()) @db.Uuid
  orderId      String         @unique @db.Uuid
  status       DeliveryStatus @default(CONFIRMED)
  trackingCode String?        @unique @db.VarChar(100)
  latitude     Decimal?       @db.Decimal(9, 6)
  longitude    Decimal?       @db.Decimal(9, 6)
  estimatedAt  DateTime?
  deliveredAt  DateTime?

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([status])
  @@map("deliveries")
}
```

---

# 18. Foreign-Key and Delete/Update Rules

The authoritative relationship actions in the Prisma schema are:

| Relationship | `onDelete` | `onUpdate` |
|---|---|---|
| `User.role → Role` | `Restrict` | `Cascade` |
| `Address.user → User` | `Cascade` | `Cascade` |
| `Product.category → Category` | `Restrict` | `Cascade` |
| `ProductImage.product → Product` | `Cascade` | `Cascade` |
| `Inventory.product → Product` | `Cascade` | `Cascade` |
| `Cart.user → User` | `Cascade` | `Cascade` |
| `CartItem.cart → Cart` | `Cascade` | `Cascade` |
| `CartItem.product → Product` | `Restrict` | `Cascade` |
| `Wishlist.user → User` | `Cascade` | `Cascade` |
| `WishlistItem.wishlist → Wishlist` | `Cascade` | `Cascade` |
| `WishlistItem.product → Product` | `Restrict` | `Cascade` |
| `Order.user → User` | `Restrict` | `Cascade` |
| `OrderItem.order → Order` | `Cascade` | `Cascade` |
| `OrderItem.product → Product` | `Restrict` | `Cascade` |
| `Payment.order → Order` | `Cascade` | `Cascade` |
| `Delivery.order → Order` | `Cascade` | `Cascade` |

These rules are not optional implementation preferences. They are part of the authoritative schema.

The intent is:

- user-owned mutable records such as addresses/cart/wishlist can cascade with user deletion
- historical/order/product relationships are protected from accidental deletion through `Restrict`
- child records such as images/cart items/order items are removed with their owning parent where explicitly defined
- order payment and delivery records follow the order lifecycle at the foundation level

---

# 19. Constraints and Data Integrity

The schema must preserve:

- UUID primary keys
- explicit foreign keys
- unique constraints
- composite unique constraints
- appropriate nullable/non-nullable fields
- timestamp fields
- controlled enum values
- decimal monetary values
- one-to-one relationships where represented by unique foreign keys
- product/category/user uniqueness requirements
- cart item uniqueness per cart/product
- wishlist item uniqueness per wishlist/product
- one inventory record per product
- one cart per user
- one wishlist per user
- one payment per order
- one delivery per order
- unique SKU
- unique product slug
- unique category slug
- unique category name
- unique user email
- unique payment provider payment ID when present
- unique delivery tracking code when present

---

# 20. Indexes — Authoritative

The schema must contain the following indexes/unique indexes.

## Role

```text
UNIQUE(name)
```

## User

```text
UNIQUE(email)
INDEX(roleId)
INDEX(isActive)
```

## Address

```text
INDEX(userId)
INDEX(userId, type)
```

## Category

```text
UNIQUE(name)
UNIQUE(slug)
INDEX(isActive)
```

## Product

```text
UNIQUE(sku)
UNIQUE(slug)
INDEX(categoryId)
INDEX(status)
INDEX(categoryId, status)
INDEX(createdAt)
```

## ProductImage

```text
INDEX(productId)
INDEX(productId, position)
```

## Inventory

```text
UNIQUE(productId)
INDEX(status)
```

## Cart

```text
UNIQUE(userId)
```

## CartItem

```text
UNIQUE(cartId, productId)
INDEX(cartId)
INDEX(productId)
```

## Wishlist

```text
UNIQUE(userId)
```

## WishlistItem

```text
UNIQUE(wishlistId, productId)
INDEX(wishlistId)
INDEX(productId)
```

## Order

```text
INDEX(userId)
INDEX(status)
INDEX(createdAt)
INDEX(userId, createdAt)
INDEX(status, createdAt)
```

## OrderItem

```text
INDEX(orderId)
INDEX(productId)
```

## Payment

```text
UNIQUE(orderId)
UNIQUE(providerPaymentId)
INDEX(status)
INDEX(provider, status)
```

## Delivery

```text
UNIQUE(orderId)
UNIQUE(trackingCode)
INDEX(status)
```

The actual Supabase PostgreSQL database must be inspected to verify that the migration created the expected indexes and unique constraints.

---

# 21. Historical Order Data

`OrderItem` deliberately stores:

```text
productId
productName
sku
unitPrice
quantity
lineTotal
```

This is intentional.

Historical orders must remain reconstructable even if the referenced product later changes.

The current product record must not be the sole source for historical product name, SKU, or price.

---

# 22. Tables Explicitly Excluded From 02.2

Do not add these tables to TASK 02.2 unless an approved architecture/task change explicitly requires them:

```text
RefreshToken
OTP
RecommendationEvent
RecommendationResult
UserBehavior
AuditLog
ShipmentHistory
StripeWebhookEvent
EmailDelivery
PDFDocument
```

Additional future tables that were discussed but are not part of this authoritative 02.2 schema include:

```text
StripePaymentEvent
Recommendation
AIEmbedding
SearchHistory
Notification
Review
Coupon
Shipment
AnalyticsEvent
```

Authentication, OTP, detailed payment workflows, AI persistence, analytics/event storage, and advanced commerce workflows belong to their respective later tasks.

---

# 23. Migration Workflow

The implementation must follow:

```text
Edit prisma/schema.prisma
        ↓
Validate Prisma schema
        ↓
Generate Prisma client
        ↓
Create Prisma migration
        ↓
Review generated migration
        ↓
Apply migration to Supabase PostgreSQL
        ↓
Inspect actual Supabase database
        ↓
Run deterministic seed
        ↓
Verify schema + relationships + indexes
```

The migration must be generated from the authoritative Prisma schema.

Do not manually create the 14 authoritative tables in Supabase.

Do not use Supabase MCP to bypass Prisma migrations.

Do not use Supabase SQL Editor to establish the authoritative schema.

If manual SQL is required for a PostgreSQL capability that cannot be represented by the approved Prisma schema, stop and report it before implementation rather than silently changing the design.

---

# 24. Clean Database Verification

The implementation must verify the migration and seed against a clean database state.

At minimum:

1. Create/apply the migration.
2. Confirm all 14 required tables exist.
3. Confirm expected columns and types.
4. Confirm primary keys.
5. Confirm foreign keys.
6. Confirm `onDelete`/`onUpdate` actions.
7. Confirm unique constraints.
8. Confirm indexes.
9. Run the Prisma seed.
10. Confirm deterministic foundation data.
11. Run the seed again where practical.
12. Confirm no unintended duplicates.
13. Generate Prisma Client.
14. Run application/database tests.

---

# 25. Supabase Verification

Use the already-configured Supabase MCP server to inspect the real remote database.

Verify:

```text
[ ] 14 required tables exist
[ ] No unauthorized 02.2 tables were added
[ ] Primary keys exist
[ ] Foreign keys exist
[ ] Foreign-key delete actions match the task
[ ] Foreign-key update actions match the task
[ ] Unique constraints exist
[ ] Required indexes exist
[ ] Column types match the Prisma schema
[ ] Nullable/non-nullable behavior matches
[ ] Enum/status representation is correct
[ ] Seeded records exist
[ ] Seed is deterministic/idempotent where practical
```

Also inspect Supabase Security Advisor and Performance Advisor where available.

Do not treat a successful Prisma command as proof that the remote database is correct. The actual Supabase state must be inspected.

---

# 26. Prisma Client

Generate Prisma Client after the schema is valid:

```powershell
npx prisma generate
```

The application must use the generated Prisma Client through the backend/database access layer rather than creating ad-hoc PostgreSQL connections throughout the application.

Prisma must remain the application database access layer.

---

# 27. Environment Configuration

The database credentials already exist in `.env.local`.

Expected variables:

```env
DATABASE_URL="YOUR_SUPABASE_PRISMA_CONNECTION_STRING"
DIRECT_URL="YOUR_SUPABASE_DIRECT_CONNECTION_STRING"
```

Do not commit real values.

Do not place the database password into:

- source code
- Prisma schema
- migration files
- seed files
- documentation
- GitHub Actions logs
- implementation reports
- chat messages
- screenshots

`.gitignore` must protect local environment files, including:

```text
.env
.env.local
.env.*.local
```

Use the repository's existing environment conventions if they are stricter.

---

# 28. Supabase Connection Responsibility

The project uses Supabase PostgreSQL as the database.

Prisma connects to that PostgreSQL database.

The backend remains responsible for normal application database access.

The frontend must not directly connect to PostgreSQL.

The architecture remains:

```text
React frontend
      ↓
Express backend
      ↓
Prisma
      ↓
Supabase PostgreSQL
```

Supabase is not a replacement for the backend authorization boundary.

---

# 29. Security Requirements

The implementation must not:

- commit database passwords
- log database connection strings
- expose database credentials
- expose Prisma connection URLs in API responses
- place secrets in seed files
- seed production with development fixtures
- expose PostgreSQL directly to the frontend
- bypass the backend authorization boundary
- create unnecessary Supabase Data API exposure
- disable existing repository security controls

Where Supabase Data API exposure exists, RLS/security requirements must be evaluated according to the access model.

The task must not weaken security merely to make migration or seed execution easier.

---

# 30. Performance Requirements

The implementation must:

- retain the authoritative indexes listed in this task
- avoid unnecessary duplicate indexes
- index foreign-key/query paths explicitly specified by the schema
- use appropriate PostgreSQL numeric/decimal types for monetary values
- avoid creating a large development dataset
- verify indexes on the actual Supabase database

Do not add speculative indexes that are not justified by the authoritative schema without reporting the reason and receiving approval.

---

# 31. Architecture Boundary

This task establishes the database foundation.

It does not implement:

- authentication workflows
- OTP workflows
- refresh-token workflows
- product APIs
- category APIs
- inventory APIs
- cart business logic
- wishlist business logic
- checkout workflows
- order workflows
- Stripe integration
- payment processing
- delivery tracking workflows
- AI recommendation business logic
- image-search business logic
- analytics/event pipelines
- email workflows
- PDF workflows

Only the schema foundation required by the authoritative 02.2 model is established.

---

# 32. Completion Validation Checklist

## Repository

```text
[ ] Correct branch: feature/database-foundation
[ ] No unrelated feature work
[ ] No secrets committed
[ ] Working tree reviewed
[ ] Changed files reviewed
```

## Prisma

```text
[ ] Prisma installed/configured
[ ] prisma/schema.prisma exists
[ ] Schema validates
[ ] Prisma Client generates successfully
[ ] DATABASE_URL configured
[ ] DIRECT_URL configured where required by the repository workflow
```

## Schema

```text
[ ] Exactly 14 authoritative 02.2 tables are implemented
[ ] Role
[ ] User
[ ] Address
[ ] Category
[ ] Product
[ ] ProductImage
[ ] Inventory
[ ] Cart
[ ] CartItem
[ ] Wishlist
[ ] WishlistItem
[ ] Order
[ ] OrderItem
[ ] Payment
[ ] Delivery
```

## Relationships

```text
[ ] Role → User
[ ] User → Address
[ ] User → Cart
[ ] User → Wishlist
[ ] User → Order
[ ] Category → Product
[ ] Product → ProductImage
[ ] Product → Inventory
[ ] Cart → CartItem
[ ] Product → CartItem
[ ] Wishlist → WishlistItem
[ ] Product → WishlistItem
[ ] Order → OrderItem
[ ] Product → OrderItem
[ ] Order → Payment
[ ] Order → Delivery
```

## Foreign keys

```text
[ ] All required FKs exist
[ ] onDelete behavior matches the authoritative matrix
[ ] onUpdate behavior matches the authoritative matrix
```

## Constraints

```text
[ ] Primary keys
[ ] Unique email
[ ] Unique role name
[ ] Unique category name
[ ] Unique category slug
[ ] Unique product SKU
[ ] Unique product slug
[ ] Unique inventory productId
[ ] Unique cart userId
[ ] Unique cart/product pair
[ ] Unique wishlist userId
[ ] Unique wishlist/product pair
[ ] Unique payment orderId
[ ] Unique providerPaymentId
[ ] Unique delivery orderId
[ ] Unique trackingCode
```

## Indexes

```text
[ ] All authoritative indexes exist
[ ] Composite indexes exist where specified
[ ] No unintended duplicate indexes
```

## Migrations

```text
[ ] Migration generated from Prisma schema
[ ] Migration reviewed before application
[ ] Migration successfully applied
[ ] Supabase actual state inspected
```

## Seed

```text
[ ] Prisma seed mechanism implemented
[ ] Seed strategy documented
[ ] Seed data deterministic
[ ] Repeated execution safe/idempotent where practical
[ ] Development/test fixtures clearly separated
[ ] No production auto-seeding
[ ] No real credentials
[ ] Minimal foundation data only
[ ] Migration runs before seed
[ ] Clean database migration + seed verified
```

## Supabase

```text
[ ] Existing Supabase project used
[ ] Supabase MCP available
[ ] MCP used for actual verification
[ ] 14 required tables confirmed
[ ] Relationships confirmed
[ ] FKs confirmed
[ ] Delete/update actions confirmed
[ ] Indexes confirmed
[ ] Constraints confirmed
[ ] Seed data confirmed
[ ] Security Advisor checked
[ ] Performance Advisor checked where applicable
```

## Tests and validation

```text
[ ] Prisma validation passes
[ ] Prisma Client generation passes
[ ] Repository test suite passes
[ ] TypeScript/typecheck passes
[ ] Lint passes
[ ] Build passes
[ ] Database verification passes
[ ] Seed verification passes
```

---

# 33. Required Evidence

The implementation report must provide actual evidence.

Do not report:

```text
"Should work"
"Looks correct"
"Migration seems fine"
"Database should contain the tables"
```

Instead provide evidence such as:

```text
PASS — prisma validate
PASS — prisma generate
PASS — migration applied
PASS — Supabase MCP confirmed 14 required tables
PASS — FK verification
PASS — index verification
PASS — seed execution
PASS — repeated seed verification
PASS — tests
PASS — typecheck
PASS — lint
PASS — build
```

For any item that could not be verified:

```text
NOT VERIFIED — <exact reason>
```

Do not convert an unverified item into PASS.

---

# 34. Completion Gates

TASK 02.2 is complete only when **all applicable gates pass**.

## Gate 1 — Schema

```text
PASS
```

The authoritative Prisma schema is implemented exactly.

## Gate 2 — Relationships

```text
PASS
```

All specified relationships exist and match the relationship matrix.

## Gate 3 — Foreign Keys

```text
PASS
```

All FK delete/update actions match the authoritative rules.

## Gate 4 — Indexes

```text
PASS
```

All required indexes and unique constraints exist in the actual Supabase database.

## Gate 5 — Migration

```text
PASS
```

The Prisma migration applies successfully to Supabase PostgreSQL.

## Gate 6 — Seed

```text
PASS
```

The deterministic Prisma seed executes successfully and safely.

## Gate 7 — Clean Database Verification

```text
PASS
```

Migration and seed were verified against a clean database state.

## Gate 8 — Supabase Reality

```text
PASS
```

The actual remote Supabase database was inspected through the configured MCP and matches the intended schema.

## Gate 9 — Security

```text
PASS
```

No credentials/secrets were committed or exposed, and database access remains behind the backend.

## Gate 10 — Tests

```text
PASS
```

Required tests/typecheck/lint/build pass.

## Gate 11 — Documentation

```text
PASS
```

Seed usage, migration workflow, environment requirements, and database foundation behavior are documented.

## Gate 12 — Scope

```text
PASS
```

No unauthorized future-feature tables or unrelated implementation were added.

---

# 35. Out-of-Scope Tables

The following must remain outside 02.2:

```text
RefreshToken
OTP
RecommendationEvent
RecommendationResult
UserBehavior
AuditLog
ShipmentHistory
StripeWebhookEvent
EmailDelivery
PDFDocument
```

The following future entities are also not part of the authoritative 02.2 schema unless explicitly approved later:

```text
StripePaymentEvent
Recommendation
AIEmbedding
SearchHistory
Notification
Review
Coupon
Shipment
AnalyticsEvent
```

They must be introduced by their respective feature tasks so the migration history remains clean and understandable.

---

# 36. Final Expected Architecture

```text
                    ElectroHub
                        │
                        ▼
                Express Backend
                        │
                        ▼
                  Prisma Client
                        │
                        ▼
              prisma/schema.prisma
                        │
                        ▼
                Prisma Migration
                        │
                        ▼
              Supabase PostgreSQL
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
        Supabase MCP         Supabase Dashboard
              │                   │
              └─────────┬─────────┘
                        ▼
                 Actual DB Reality
```

Prisma is the **schema/migration/application access authority**.

Supabase is the **managed PostgreSQL environment and inspection/management surface**.

Supabase MCP is the **verification and project-inspection mechanism**, not a replacement for Prisma migrations.

---

# 37. Final Definition of Done

TASK 02.2 may be declared complete only when:

```text
Authoritative schema
        ↓
Relationships
        ↓
FK/delete rules
        ↓
Indexes/constraints
        ↓
Prisma migration
        ↓
Supabase PostgreSQL
        ↓
Deterministic seed
        ↓
Clean database verification
        ↓
Supabase MCP verification
        ↓
Tests/typecheck/lint/build
        ↓
Documentation
        ↓
Final evidence report
```

All applicable completion gates must be `PASS`.

Any critical security issue, schema deviation, unauthorized table, broken migration, incorrect FK behavior, missing required index, unsafe seed behavior, secret leakage, or unverified critical database state blocks completion.

**Never declare TASK 02.2 complete based on assumptions. Require evidence.**
