# ELECTROHUB — TASK 02.5
# PRODUCT FOUNDATION

**Branch:** `feature/product-foundation`  
**Target branch:** `develop`  
**Status:** Authoritative implementation task  
**Phase:** 02 — Core Platform  
**Scope:** Product-domain persistence + relationships + read APIs + validation + DEV catalog dataset + media references + migrations + tests + documentation

---

# 0. Task Authority

TASK 02.5 establishes the **product-domain foundation** required by later catalog, search, cart, wishlist, inventory, recommendation, Cloudinary, and admin-product-management work.

This task is **not** the full storefront and is **not** the final admin product-management experience.

The implementation must preserve the architecture already established by:

1. Phase 00 — Project Foundation
2. Phase 01 — Design & UI Foundation
3. TASK 02.1 — Backend Foundation
4. TASK 02.2 — Database Foundation
5. TASK 02.3 — Authentication
6. TASK 02.4 — Email/Auth Security Foundation
7. The current actual `develop` Prisma schema and migration history
8. Existing frontend/backend engineering standards
9. Existing ElectroHub Figma/design-system decisions where product data shape is relevant

> **Principal architecture rule:** TASK 02.5 evolves the actual existing product/database foundation. It must not recreate `Product`, `Category`, `Inventory`, or other existing models from scratch if they already exist.

If repository reality differs from assumptions in this task, inspect the current implementation first and adapt the implementation while preserving the architectural intent. Do not silently create a parallel product domain.

---

# 1. Roadmap Position

The approved sequence is:

```text
Phase 02 — Core Platform

02.1 Backend Foundation
   ↓
02.2 Database Foundation
   ↓
02.3 Authentication
   ↓
02.4 Email / OTP / OAuth Security
   ↓
02.5 Product Foundation
   ↓
02.6 Search Foundation
   ↓
02.7 State and API Foundation
```

TASK 02.5 must prepare the product domain for later phases without prematurely implementing them.

Future ownership remains:

```text
02.5 Product Foundation
        ↓
02.6 Search Foundation
        ↓
02.7 State/API Foundation
        ↓
03.1 Product Catalog UI
        ↓
03.4 Full Inventory
        ↓
04.3 Cloudinary
        ↓
05.2 Admin Product Management
```

---

# 2. Task Objective

Build a clean, migration-reviewable product-domain foundation covering:

```text
Product
Category
Brand
ProductImage
ProductSpecification
Pricing
Availability
DEV catalog data
Product read APIs
Validation
Migration
Tests
Documentation
```

The end state must provide a realistic development product dataset and stable product API contracts that later tasks can consume.

---

# 3. In Scope

TASK 02.5 owns:

- Product Prisma model evolution
- Category Prisma model evolution
- Brand persistence
- ProductImage persistence
- ProductSpecification persistence
- Product ↔ Category relationship
- Product ↔ Brand relationship
- Product ↔ ProductImage relationship
- Product ↔ ProductSpecification relationship
- Integration with the existing Inventory relationship where present
- Canonical product pricing representation
- Basic product availability projection
- Slugs and identifiers required by product APIs
- Product/category/brand domain services for read behavior
- Public read APIs
- Request/query/route validation
- API response DTOs/serialization
- Product seed data
- Category seed data
- Brand seed data
- Product image metadata
- Controlled DEV/demo media assets
- Product specification seed data
- Realistic demo/reference pricing
- Availability seed state
- Seed idempotency
- Product data/source attribution documentation
- Prisma migration
- DEV migration
- DEV seed
- PROD schema migration
- Swagger/OpenAPI
- Unit tests
- Integration/API tests
- Migration/seed verification
- Documentation

---

# 4. Explicitly Out of Scope

Do **not** implement in TASK 02.5 unless a direct compatibility requirement forces a minimal change:

## Customer Catalog UI — Phase 03.1

- Full Products page
- Full Category catalog page
- Final Product Details page
- Final product image gallery UI
- Customer catalog browsing experience
- Customer-facing product pagination UI

## Search — TASK 02.6

- Full-text search
- Search suggestions
- Search ranking
- Category filtering UI/API behavior beyond foundational relations
- Brand filtering behavior
- Price-range filtering
- Sorting system
- Search result experience

## State/API Foundation — TASK 02.7

- React Query architecture
- Query cache strategy
- Product query invalidation strategy
- Global API-state redesign

## Commerce — Phase 03

- Cart integration
- Wishlist integration
- Checkout
- Order creation
- Coupons
- Promotion engine
- Tax engine
- Shipping pricing

## Full Inventory — Phase 03.4

- InventoryMovement
- Restocking workflows
- Low-stock warnings
- Low-stock email notifications
- Reservation system
- Purchase concurrency rules
- Stock decrement workflow
- Stock adjustment history
- Warehouse support

## Cloudinary — Phase 04.3

- Cloudinary SDK integration
- Product-image uploads
- Image transformations
- Production media pipeline
- Signed upload flows
- Image deletion from Cloudinary

## AI / Recommendations — Phase 04

- Product embeddings
- Recommendation scores
- RecommendationEvent
- Similar-product AI persistence
- User behavior persistence
- Image-search vectors

## Admin Product Management UI — Phase 05.2

- Create Product form
- Edit Product form
- Delete Product UI
- Upload Images UI
- Manage Specifications UI
- Manage Categories UI
- Manage Brand UI
- Manage Stock UI

## Live External Data

- Manufacturer scraping
- Retailer scraping
- Live-price synchronization
- Automatic product import
- Scheduled catalog ingestion

---

# 5. Product-Domain Architecture

The target logical foundation is:

```text
                    PRODUCT FOUNDATION 02.5
                              │
              ┌───────────────┼────────────────┐
              ↓               ↓                ↓
           Category          Brand           Product
                                                │
                         ┌──────────────────────┼──────────────────┐
                         ↓                      ↓                  ↓
                   ProductImage       ProductSpecification     Pricing
                                                                     │
                                                                Availability
                                                                     │
                                                       Existing Inventory
                                                       boundary if present
```

Expected relationships:

```text
Category
   └── Product[]

Brand
   └── Product[]

Product
   ├── Category
   ├── Brand
   ├── ProductImage[]
   ├── ProductSpecification[]
   └── Inventory? / existing inventory relation
```

Do not duplicate an existing relationship under another name.

---

# 6. Existing Schema Must Be Evolved

TASK 02.2 already created the database foundation and may already contain some or all of:

```text
Product
Category
ProductImage
Inventory
Cart
Wishlist
Order
OrderItem
Payment
```

The implementation agent MUST inspect the current `schema.prisma` and migration history before changing anything.

Required process:

```text
Current schema
      ↓
Identify existing product models
      ↓
Compare against 02.5 requirements
      ↓
Add only missing/approved fields/models
      ↓
Create forward migration
```

Never:

```text
existing Product
      +
new ProductV2
```

or:

```text
existing Category
      +
new ProductCategory
```

simply to avoid evolving the existing schema.

---

# 7. Product Model

The Product model must represent the stable commercial identity and core descriptive data of an electronics product.

Expected concepts:

```text
id
categoryId
brandId
name
slug
description
sku                 ← preserve if already part of architecture
modelNumber         ← optional/required according to current product requirements
price
compareAtPrice?     ← optional reference/original price
isActive            ← preserve/add only if consistent with existing architecture
createdAt
updatedAt
```

The exact field names must follow current repository conventions.

Recommended conceptual Prisma shape:

```prisma
model Product {
  id             String   @id @default(uuid()) @db.Uuid
  categoryId     String   @db.Uuid
  brandId        String   @db.Uuid

  name           String   @db.VarChar(255)
  slug           String   @unique @db.VarChar(255)
  description    String

  sku            String?  @unique @db.VarChar(100)
  modelNumber    String?  @db.VarChar(150)

  price          Decimal  @db.Decimal(12, 2)
  compareAtPrice Decimal? @db.Decimal(12, 2)

  isActive       Boolean  @default(true)

  category       Category @relation(...)
  brand          Brand    @relation(...)
  images         ProductImage[]
  specifications ProductSpecification[]

  // Preserve/reuse existing Inventory relation when present.

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([categoryId])
  @@index([brandId])
  @@index([isActive])
  @@map("products")
}
```

This is conceptual. Adapt to current schema rather than blindly replacing it.

---

# 8. Product Naming / Identity Rules

Product identity must distinguish:

```text
Display Name
Slug
SKU
Model Number
```

## `name`

Human-readable product name.

Example:

```text
Samsung Galaxy A55 5G 256GB
```

## `slug`

Stable URL-safe public identifier.

Example:

```text
samsung-galaxy-a55-5g-256gb
```

Requirements:

- unique
- normalized
- predictable
- URL-safe
- lowercase where current slug convention requires it
- cannot silently collide

Do not use database ID as the only future public product navigation identifier if slug architecture already exists.

## `sku`

Preserve existing SKU architecture if already present.

Do not introduce arbitrary fake SKU semantics if the project does not currently use SKU.

If used, SKU must be unique.

## `modelNumber`

Useful for electronics manufacturer identity.

Examples:

```text
SM-A556E
83D2001AUS
WH-1000XM5
```

Do not assume model number alone is globally unique unless repository/product-source evidence supports that constraint.

If uniqueness is needed, prefer a safe composite such as:

```text
brand + modelNumber
```

rather than a blind global unique constraint.

---

# 9. Product Description / Details

TASK 02.5 owns **product data**, not the final customer Product Details screen.

Product data must provide enough information for 03.1 to render a complete product page later.

Expected content includes:

- official/product-recognizable name
- short factual summary
- full description where appropriate
- model information
- category
- brand
- pricing
- availability
- image gallery metadata
- structured specifications

Avoid marketing claims that cannot be supported by the selected source.

Do not store large rendered HTML blobs for product descriptions unless existing architecture explicitly uses rich text.

Prefer plain/sanitized text or approved structured content.

---

# 10. Category Model

TASK 02.5 establishes real category persistence.

Expected concepts:

```text
Category
├── id
├── name
├── slug
├── description?
├── imageUrl?      ← development/reference image only
├── isActive?      ← if consistent with current schema
├── products
├── createdAt
└── updatedAt
```

Conceptual shape:

```prisma
model Category {
  id          String    @id @default(uuid()) @db.Uuid
  name        String    @db.VarChar(150)
  slug        String    @unique @db.VarChar(150)
  description String?
  imageUrl    String?   @db.VarChar(1000)
  isActive    Boolean   @default(true)

  products    Product[]

  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([isActive])
  @@map("categories")
}
```

Adapt to current schema.

---

# 11. Category Hierarchy

Do NOT automatically introduce parent/child category hierarchy merely because it could be useful later.

Only implement:

```text
Category.parentId
Category.children[]
```

if CURRENT Figma/product architecture/documentation explicitly requires nested categories.

Otherwise keep 02.5 category structure flat and migration-reviewable.

Possible DEV categories:

```text
Smartphones
Laptops
Tablets
Headphones
Monitors
Smartwatches
Gaming
Accessories
```

The exact set may adapt to available product sources and final product-domain needs.

---

# 12. Brand Model

Brand must be normalized as a first-class entity.

Do not store only:

```text
product.brand = "Samsung"
```

Expected concepts:

```text
Brand
├── id
├── name
├── slug
├── description?
├── logoUrl?
├── products
├── createdAt
└── updatedAt
```

Conceptual Prisma shape:

```prisma
model Brand {
  id          String    @id @default(uuid()) @db.Uuid
  name        String    @db.VarChar(150)
  slug        String    @unique @db.VarChar(150)
  description String?
  logoUrl     String?   @db.VarChar(1000)

  products    Product[]

  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@map("brands")
}
```

Brand name/slug uniqueness must be enforced appropriately.

Representative DEV brands may include:

```text
Apple
Samsung
Sony
Lenovo
HP
ASUS
Dell
LG
Acer
JBL
```

Do not require a brand merely because it appears in this example list. Seed only the brands actually represented by curated products.

---

# 13. ProductImage Model

Product images must use a normalized one-to-many relationship.

Never add:

```text
image1
image2
image3
image4
```

fields directly to Product.

Expected concepts:

```text
ProductImage
├── id
├── productId
├── url
├── altText
├── sortOrder
├── isPrimary
├── createdAt
└── updatedAt
```

Conceptual Prisma shape:

```prisma
model ProductImage {
  id        String   @id @default(uuid()) @db.Uuid
  productId String   @db.Uuid

  url       String   @db.VarChar(1000)
  altText   String?  @db.VarChar(255)
  sortOrder Int      @default(0)
  isPrimary Boolean  @default(false)

  product   Product  @relation(
    fields: [productId],
    references: [id],
    onDelete: Cascade,
    onUpdate: Cascade
  )

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([productId, sortOrder])
  @@index([productId, isPrimary])
  @@map("product_images")
}
```

Adapt to current schema conventions.

---

# 14. Product Image Invariants

For every seeded product:

- at least one image reference should exist where media is available
- one image should be designated primary
- primary image should normally have `sortOrder = 0`
- additional images should have deterministic ordering
- alt text should be meaningful
- duplicate URLs for the same product should be avoided
- multiple primary images must not be produced by seed/service logic

Because PostgreSQL/Prisma does not provide a simple portable partial-unique constraint for `isPrimary = true`, enforce the one-primary-image invariant in seed/domain logic and tests unless the current database strategy already has an approved partial index migration.

Do not introduce complex custom SQL solely for this invariant unless justified.

---

# 15. ProductSpecification Model

Electronics require structured, category-agnostic specifications.

Do NOT add product columns such as:

```text
ram
processor
screen
battery
camera
storage
gpu
refreshRate
```

for every possible product category.

Use a normalized generic specification model.

Expected concepts:

```text
ProductSpecification
├── id
├── productId
├── group
├── name
├── value
├── sortOrder
├── createdAt
└── updatedAt
```

Conceptual Prisma shape:

```prisma
model ProductSpecification {
  id        String   @id @default(uuid()) @db.Uuid
  productId String   @db.Uuid

  group     String   @default("General") @db.VarChar(100)
  name      String   @db.VarChar(150)
  value     String   @db.VarChar(500)
  sortOrder Int      @default(0)

  product   Product  @relation(
    fields: [productId],
    references: [id],
    onDelete: Cascade,
    onUpdate: Cascade
  )

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([productId, group, sortOrder])
  @@map("product_specifications")
}
```

A uniqueness rule such as `[productId, group, name]` may be used if current product data guarantees it. Do not add a constraint that rejects legitimate repeated specification labels without evidence.

---

# 16. Specification Examples

Smartphone example:

```text
Display
  Screen Size       6.6"
  Resolution        1080 × 2340
  Refresh Rate      120 Hz

Performance
  Processor         Exynos 1480
  RAM               8 GB

Storage
  Capacity          256 GB

Camera
  Main Camera       50 MP

Battery
  Capacity          5000 mAh
```

Laptop example:

```text
Performance
  Processor         Intel Core Ultra 7
  Memory            16 GB
  Graphics          Integrated / dedicated model

Storage
  SSD               1 TB

Display
  Size              15.6"
  Resolution        1920 × 1080
```

Headphone example:

```text
Audio
  Driver Size       30 mm
  Noise Cancellation  Yes

Connectivity
  Bluetooth         5.x

Battery
  Playback          30 h
```

The schema must not need modification whenever a new electronics category is added.

---

# 17. Pricing Architecture

TASK 02.5 establishes one canonical product-price representation.

Use exact decimal money storage.

Never use binary floating-point fields for authoritative monetary values.

Expected concepts:

```text
price
compareAtPrice?
```

Meaning:

```text
price
→ current demo/selling price

compareAtPrice
→ optional reference/original price shown for comparison
```

Do NOT add both `salePrice` and `compareAtPrice` unless existing architecture already requires both.

Recommended storage:

```prisma
price          Decimal  @db.Decimal(12, 2)
compareAtPrice Decimal? @db.Decimal(12, 2)
```

Validation:

- price >= 0
- compareAtPrice >= 0 when present
- compareAtPrice should normally be >= price when representing a reference/original price
- reject invalid numeric formats
- API serialization must preserve decimal precision

---

# 18. Currency Scope

Do not introduce a multi-currency system in TASK 02.5 unless the existing project architecture already defines one.

For the DEV catalog, use the project's approved/default currency.

If no currency system currently exists, document the seed prices as:

> Development/demo reference pricing; not live retailer pricing.

Do not promise live Lebanese or international retail accuracy.

---

# 19. Decimal API Serialization

Prisma `Decimal` values must not be casually converted through floating-point operations that can lose precision.

Follow existing API DTO conventions.

If no convention exists, serialize money using a stable decimal string representation such as:

```json
{
  "price": "499.00",
  "compareAtPrice": "549.00"
}
```

Do not introduce inconsistent money types between list/detail endpoints.

---

# 20. Availability Boundary

TASK 02.5 requires product availability but does NOT own full inventory operations.

The current database foundation may already include `Inventory`.

If `Inventory` exists, it remains the stock source of truth.

Do NOT add a second competing quantity/stock source to Product.

Conceptually:

```text
Product
  ↓
isActive?
  +
Inventory.quantity
  ↓
Availability projection
```

A simple public availability representation may be:

```text
AVAILABLE
UNAVAILABLE
```

or the repository's approved equivalent.

Do not implement low-stock business behavior here.

---

# 21. Availability Rules

If existing Inventory has quantity:

Recommended conceptual read behavior:

```text
Product inactive
→ UNAVAILABLE

Product active + quantity <= 0
→ UNAVAILABLE

Product active + quantity > 0
→ AVAILABLE
```

If the existing schema already defines an inventory/availability status, reuse it rather than introducing another enum.

If inspection proves there is no Inventory model despite the current foundation assumptions, stop and document the mismatch before inventing a duplicate stock architecture.

---

# 22. Inventory Functionality Explicitly Deferred

Do NOT implement in 02.5:

- low-stock state machine
- reorder thresholds
- alerts
- warehouse quantities
- reservations
- cart-based reservations
- checkout stock locks
- concurrency-controlled decrements
- restock history
- stock movement ledger
- admin inventory operations

Those belong to later inventory/commerce work.

---

# 23. Delete / FK Behavior

Foreign-key behavior must preserve domain integrity.

Recommended principles:

## Product → Category

Do not silently delete all products when deleting a Category.

Prefer restriction/controlled reassignment consistent with existing architecture.

## Product → Brand

Do not silently delete all products when deleting a Brand.

Prefer restriction/controlled reassignment.

## Product → ProductImage

Cascade delete is generally appropriate because image metadata belongs to the product.

## Product → ProductSpecification

Cascade delete is generally appropriate because specifications belong to the product.

## Product → Inventory

Preserve the existing foundation's delete behavior unless there is a proven defect.

Do not change FK rules casually in 02.5.

---

# 24. Indexing Strategy

Add indexes that directly support known 02.5 access patterns.

Typical candidates:

```text
Product.slug              UNIQUE
Product.categoryId        INDEX
Product.brandId           INDEX
Product.isActive          INDEX if used
Category.slug             UNIQUE
Brand.slug                UNIQUE
ProductImage(productId, sortOrder)
ProductSpecification(productId, group, sortOrder)
```

Do not prematurely add:

- full-text search indexes
- trigram search indexes
- vector indexes
- recommendation indexes
- analytics indexes

Those belong to later phases when query behavior is defined.

---

# 25. Public Product Read API

TASK 02.5 must expose stable product-domain read APIs.

Expected routes, adapted to current routing conventions:

```text
GET /api/products
GET /api/products/:slug

GET /api/categories
GET /api/categories/:slug

GET /api/brands
GET /api/brands/:slug
```

If the current API convention uses IDs rather than slugs, inspect and preserve compatibility. Prefer slugs for future public navigation when consistent with existing product architecture.

Do not create multiple competing lookup routes without need.

---

# 26. Product List API

`GET /api/products`

Purpose:

- foundational product retrieval
- stable contract for future catalog/search work
- prevent unbounded database responses

Required behavior:

- pagination
- deterministic ordering
- active/public products only where applicable
- category summary
- brand summary
- primary image
- canonical price
- availability projection

Do NOT implement 02.6 features here:

- search text
- suggestions
- advanced filters
- price ranges
- complex sorting
- relevance ranking

A basic `page` / `limit` contract is acceptable.

Use safe maximum page sizes.

---

# 27. Product Detail API

`GET /api/products/:slug`

Expected conceptual response:

```json
{
  "product": {
    "id": "...",
    "name": "Samsung Galaxy A55 5G 256GB",
    "slug": "samsung-galaxy-a55-5g-256gb",
    "description": "...",
    "sku": "...",
    "modelNumber": "SM-A556E",
    "brand": {
      "id": "...",
      "name": "Samsung",
      "slug": "samsung"
    },
    "category": {
      "id": "...",
      "name": "Smartphones",
      "slug": "smartphones"
    },
    "price": "499.00",
    "compareAtPrice": null,
    "availability": "AVAILABLE",
    "images": [],
    "specifications": []
  }
}
```

Exact envelope/error conventions must follow current API standards.

---

# 28. Product Detail Ordering

Product detail must return deterministic ordered collections.

Images:

```text
primary first
then sortOrder ascending
```

Specifications:

```text
group order / configured group ordering
then sortOrder ascending
```

Do not rely on undefined database row order.

---

# 29. Category APIs

Required foundational behavior:

```text
GET /api/categories
GET /api/categories/:slug
```

Category list should provide only the fields needed for future catalog/navigation foundations.

Possible response fields:

```text
id
name
slug
description
imageUrl
```

Do not return huge nested product arrays by default.

Category detail may return category metadata and lightweight counts if cheap and already supported, but must not become a search/catalog implementation.

---

# 30. Brand APIs

Required foundational behavior:

```text
GET /api/brands
GET /api/brands/:slug
```

Possible response fields:

```text
id
name
slug
description
logoUrl
```

Do not return every product for every brand in the base list response.

---

# 31. Write APIs / Admin Boundary

TASK 02.5 does **not** implement the final admin product-management workflow.

Do not build new customer-accessible write APIs.

Do not build the Phase 05.2 admin UI.

The backend should use clean domain/service boundaries that later admin tasks can extend safely.

Required now:

```text
ProductService
CategoryService
BrandService
```

At minimum they own foundational read/domain behavior.

If the repository already contains approved admin product write endpoints, preserve compatibility and update them only where the schema evolution requires it.

Do not create a second CRUD API surface purely for 02.5.

---

# 32. Validation

Use the existing validation library/pattern.

Do not introduce another schema-validation dependency.

Validate:

- slug format
- pagination parameters
- maximum page size
- product identifiers
- price values where write/domain helpers are present
- image URL/path length
- specification lengths
- category/brand existence in seed/domain operations

Route parameters must never be passed directly into unsafe raw SQL.

Prisma parameterization should remain the default.

---

# 33. Error Contract

Use existing centralized error handling.

Expected classes:

```text
400 invalid request/query
404 product/category/brand not found
500 unexpected internal error
```

Do not expose:

- Prisma internals
- SQL
- table names unnecessarily
- stack traces
- filesystem paths
- database URLs

Do not return `500` for expected product-not-found behavior.

---

# 34. Performance / Query Design

Avoid obvious N+1 query behavior.

Use Prisma `select` / `include` deliberately.

Product lists should not fetch every specification/gallery image when only summary fields are needed.

Recommended list behavior:

```text
Product summary
├── brand summary
├── category summary
├── primary image only
├── price
└── availability
```

Product detail can fetch:

```text
full image metadata
full specification metadata
```

Use pagination for list APIs.

Do not introduce caching architecture before TASK 02.7.

---

# 35. Frontend Scope

TASK 02.5 frontend work is intentionally minimal.

Allowed/expected where needed:

- Product TypeScript types/interfaces
- Product API response types
- Category types
- Brand types
- ProductImage types
- ProductSpecification types
- price/availability mapping types
- reusable data contracts required by existing shared components
- controlled DEV media assets under public/static folders

Do NOT implement:

- final Products page
- final Product Details page
- category browsing UI
- gallery UI
- filter UI
- search UI
- admin product forms

Those belong to later tasks.

---

# 36. Product Data Contract for Future UI

The 02.5 contracts must be sufficient for future UI to render:

```text
ProductCard
├── name
├── brand
├── category
├── primary image
├── price
└── availability

ProductDetails
├── identity
├── description
├── brand
├── category
├── price
├── availability
├── image gallery
└── grouped specifications
```

Do not build the UI now; make the data contract ready.

---

# 37. DEV Product Dataset Foundation

By the end of TASK 02.5, DEV must contain a realistic non-trivial electronics catalog.

Target range:

```text
6–8 categories
8–12 brands
20–30 products
```

The exact count can adapt slightly if source quality/licensing requires it, but the dataset must be large enough to exercise:

- category relationships
- brand relationships
- list pagination
- multiple products/category
- multiple products/brand
- price diversity
- availability states
- image ordering
- specifications
- future search/filtering work

Do not seed hundreds of products.

---

# 38. Minimum Seed Quality Per Product

Each seeded product should include where reasonably available:

```text
1 category
1 brand
name
slug
model number or SKU where appropriate
short/full description
1 canonical demo price
optional compareAtPrice
availability-supporting inventory state
1 primary image
2–4 additional gallery images when licensed/available
6–15 meaningful specifications
```

Do not pad specifications with meaningless filler just to reach a number.

Quality is more important than exact counts.

---

# 39. Product Data Acquisition

For factual product information, prioritize official manufacturer sources.

Examples may include:

```text
Apple
Samsung
Sony
Lenovo
HP
ASUS
Dell
LG
Acer
JBL
```

Use official sources to curate factual attributes such as:

- official product/model name
- model number
- dimensions
- display
- processor
- RAM
- storage
- battery
- ports
- connectivity
- camera
- audio
- product-specific technical details

Do NOT create a web scraper in 02.5.

Do NOT automatically ingest manufacturer sites.

Workflow:

```text
Official product page
        ↓
manual/agent-assisted factual curation
        ↓
seed manifest
        ↓
source attribution
        ↓
Prisma DEV seed
```

---

# 40. Data Accuracy Rule

Do not invent technical specifications when a factual source is available.

If a specification cannot be verified:

- omit it
- or clearly mark the dataset entry as demo/inferred in source notes

Do not present AI-generated guesses as manufacturer specifications.

The product seed should be internally credible.

---

# 41. Pricing Data Acquisition

Live retailer prices are NOT required.

Use representative/demo USD pricing or the current project-approved default currency.

Required documentation note:

> Seed prices are development/demo reference prices and are not live retailer pricing.

Do not build:

- retailer price scrapers
- live pricing API
- price synchronization jobs
- regional pricing engine
- discount engine

Price values should be plausible enough for UI/API testing.

---

# 42. Media Concerns Are Separate

TASK 02.5 distinguishes:

```text
1. Product-image database metadata
2. DEV/demo image assets
3. Production media pipeline
```

02.5 owns:

```text
1 + 2
```

04.3 owns:

```text
3 (Cloudinary)
```

Do not collapse these concerns.

---

# 43. Controlled DEV Product Assets

Preferred DEV/demo structure:

```text
apps/frontend/public/
└── images/
    ├── products/
    │   ├── <product-slug>/
    │   │   ├── front.webp
    │   │   ├── back.webp
    │   │   └── detail.webp
    │   └── ...
    │
    ├── categories/
    │   ├── smartphones.webp
    │   ├── laptops.webp
    │   └── ...
    │
    └── brands/
        ├── samsung.svg
        ├── apple.svg
        └── ...
```

Adapt to the actual repository asset structure and design-system conventions.

Do not create duplicate asset roots if one already exists.

---

# 44. Image URL Strategy

DEV seed may store deterministic local URLs such as:

```text
/images/products/samsung-galaxy-a55/front.webp
```

This is preferred over fragile hotlinks.

Later Cloudinary migration can replace URL values without redesigning ProductImage.

Do not hard-code full localhost URLs into database rows.

Prefer application-relative paths for local static assets.

---

# 45. Remote Image URLs

Remote URLs are allowed only when:

- licensing/usage permits it
- hotlinking is acceptable
- the source is stable enough for DEV use

Do not make the seed depend entirely on volatile third-party image URLs.

Do not download/copy copyrighted images into the repository merely because they are publicly viewable.

---

# 46. Copyright / Licensing / Attribution

Product data facts and media rights are different concerns.

For media included in the repository/public portfolio:

Prefer:

- project-owned images
- generated demo imagery
- permissively licensed images
- manufacturer media where usage terms explicitly allow it
- approved Figma/product assets

Do not assume manufacturer product photography or brand logos are freely redistributable.

Brand logos are trademarks and must be used only where appropriate for the portfolio/demo context and according to applicable usage terms.

When rights are unclear, use a neutral/generic placeholder and retain source notes rather than copying the asset.

---

# 47. Product Seed Source Documentation

Create/update an attribution/source file such as:

```text
docs/data/PRODUCT_SEED_SOURCES.md
```

Adapt path to current docs structure.

For each product, record where applicable:

```text
Product name
Manufacturer
Information source URL/reference
Image source/license/reference
Usage note
Pricing note
Date collected
```

Do not store secrets or private credentials in this document.

Do not embed large copied manufacturer descriptions.

Use short factual summaries and links/references.

---

# 48. Category Media

Category images do not need to be tied to a specific manufacturer.

Use:

- approved Figma category assets
- licensed generic electronics imagery
- generated category artwork
- simple project-owned illustrations

Examples:

```text
Smartphones
Laptops
Headphones
Monitors
Accessories
```

No Cloudinary integration in this task.

---

# 49. Brand Logos

If Brand has `logoUrl`, DEV may use controlled logo assets where appropriate.

Possible local paths:

```text
/images/brands/apple.svg
/images/brands/samsung.svg
```

Do not introduce a logo-upload workflow.

If logo redistribution rights are unclear, use a text-only brand representation or approved placeholder instead of copying assets.

---

# 50. Asset Optimization

Do not commit enormous unoptimized media files.

For DEV/demo assets:

- use reasonable dimensions
- prefer efficient formats where practical
- preserve transparency where needed
- avoid multi-megabyte images unless justified
- include alt text metadata

Do not build an image-processing pipeline in 02.5.

---

# 51. DEV Seed Architecture

The seed must remain:

- deterministic
- idempotent
- development-only
- safe to rerun
- free of real secrets
- free of active external credentials

Recommended structure:

```text
seed
├── roles / existing foundation
├── categories
├── brands
├── products
├── product images
├── product specifications
└── inventory state
```

Reuse the current seed architecture rather than creating a second independent seed system.

---

# 52. Seed Idempotency

Seed reruns must not create duplicate:

- categories
- brands
- products
- images
- specifications
- inventory rows

Use deterministic unique identifiers/slugs and appropriate `upsert`/reconciliation patterns.

The seed must be safe to run more than once.

Prove idempotency by running the documented DEV seed twice and comparing expected final counts/state.

---

# 53. Seed Counts / Verification

After seeding, report exact counts:

```text
categories
brands
products
product images
product specifications
inventory rows associated with seeded products
```

Verify:

- every product references an existing category
- every product references an existing brand
- every product has valid price data
- every product has a valid availability projection
- primary-image invariant holds
- image ordering is deterministic
- no orphan specifications
- no duplicate slugs

---

# 54. Production Data Rule

PRODUCTION must NOT receive the DEV/demo product seed automatically.

Production migration receives schema only.

Do not run:

```text
npm run seed
```

or equivalent DEV product seed against PROD.

Production product data will be managed through future production/admin workflows.

---

# 55. Prisma Migration Strategy

Prisma remains authoritative.

Do not use:

```text
prisma db push
```

for authoritative schema evolution.

Do not manually create authoritative tables through Supabase SQL/dashboard simply to make code pass.

Required sequence:

```text
Current schema + existing migrations
          ↓
Implement approved 02.5 evolution
          ↓
prisma validate
          ↓
prisma generate
          ↓
create/review forward migration
          ↓
DEV migration
          ↓
verify DEV physical schema + ledger
          ↓
DEV seed
          ↓
verify seed
          ↓
run relevant tests
          ↓
PROD migration
          ↓
verify PROD physical schema + ledger
```

---

# 56. Migration Safety Review

Before applying migration, inspect exact SQL for:

- CREATE TABLE
- ALTER TABLE
- ADD COLUMN
- DROP COLUMN
- DROP TABLE
- nullability changes
- default changes
- indexes
- unique constraints
- foreign keys
- enum changes
- destructive data conversions

Do not accept unexpected destructive changes.

If existing DEV/PROD product data exists, migration must preserve it unless explicit approved transformation is documented.

---

# 57. DEV Migration Verification

After DEV migration, verify physically:

- Product table evolution
- Category table evolution
- Brand table
- ProductImage table/evolution
- ProductSpecification table
- Inventory relationship
- columns
- types
- nullability
- unique constraints
- indexes
- foreign keys
- onDelete/onUpdate behavior
- Prisma migration metadata

Also verify:

```text
DEV physical schema = schema.prisma
DEV _prisma_migrations = repository migration history
DEV pending = 0
DEV failed = 0
```

Do not manually fabricate `_prisma_migrations` rows.

---

# 58. Production Migration Verification

Before PROD migration:

- confirm target project/environment
- inspect PROD physical schema
- inspect PROD `_prisma_migrations`
- compare exact ordered repository migration history
- identify pending migrations
- identify failed migrations
- review pending SQL

After PROD migration:

```text
PROD physical schema = schema.prisma
PROD _prisma_migrations = repository migration history
PROD pending = 0
PROD failed = 0
PROD seed = NOT RUN
```

Never use `db push` against PROD.

Never run DEV catalog seed against PROD.

---

# 59. Supabase / TLS / Connection Safety

Use the current approved Supabase/Prisma connection architecture.

Do not weaken TLS validation.

Never introduce:

```text
NODE_TLS_REJECT_UNAUTHORIZED=0
rejectUnauthorized=false
sslaccept=accept_invalid_certs
sslmode=disable
```

Use the repository-approved CA/trust configuration if required.

Never print DB credentials in migration evidence.

---

# 60. Backend Service Boundaries

Follow current layered backend architecture.

Conceptual structure:

```text
Route
  ↓
Controller
  ↓
ProductService / CategoryService / BrandService
  ↓
Prisma
```

Do not put Prisma queries directly in route files when current architecture uses service layers.

Do not create duplicate repositories/services if current product service already exists.

---

# 61. ProductService Responsibilities

At minimum:

- list products with pagination
- get product by public identifier/slug
- map product summary DTO
- map product detail DTO
- compute/derive availability through existing Inventory state
- deterministic image/spec ordering
- use safe Decimal serialization

Do not implement search ranking here.

---

# 62. CategoryService Responsibilities

At minimum:

- list categories
- get category by slug/identifier
- return lightweight metadata
- preserve active-state rules where present

Do not implement full category catalog browsing logic.

---

# 63. BrandService Responsibilities

At minimum:

- list brands
- get brand by slug/identifier
- return lightweight metadata

Do not implement brand-admin workflows.

---

# 64. API Security Boundary

Public product/category/brand read endpoints may be unauthenticated according to current product architecture.

They must still:

- validate input
- use safe query construction
- enforce page-size limits
- avoid exposing internal fields
- preserve centralized rate limiting if applicable
- preserve structured logging/error handling

No write endpoint may trust client-controlled role/ownership assumptions.

Admin write architecture remains a later task unless already present.

---

# 65. Sensitive Data

Product APIs must never expose unrelated sensitive fields such as:

- user data
- internal credentials
- database URLs
- admin-only secrets
- private storage credentials

Media URLs are product metadata, not credentials.

---

# 66. Swagger / OpenAPI

Document all new/changed product-foundation endpoints.

At minimum:

```text
GET /api/products
GET /api/products/:slug
GET /api/categories
GET /api/categories/:slug
GET /api/brands
GET /api/brands/:slug
```

Swagger must document:

- parameters
- pagination
- response shapes
- 400 responses
- 404 responses
- server errors
- money serialization
- availability values
- image/specification structures

Swagger must match the actual implementation.

---

# 67. Backend Tests — Product Model / Services

Required unit/service coverage where applicable:

- slug handling
- list pagination
- maximum page size
- product lookup by slug
- product not found
- price serialization
- compareAtPrice validation if write/domain validators exist
- availability calculation
- inactive product behavior
- primary image selection
- image ordering
- specification ordering
- DTO mapping

Do not write meaningless tests solely to increase coverage.

---

# 68. Database Integration Tests

Required integration coverage:

- create/read Category
- create/read Brand
- create/read Product
- Product ↔ Category relationship
- Product ↔ Brand relationship
- Product ↔ ProductImage relationship
- Product ↔ ProductSpecification relationship
- existing Inventory relation remains valid
- FK integrity
- unique slug behavior
- image cascade behavior
- specification cascade behavior
- Category/Brand delete restriction behavior if implemented
- Decimal persistence/precision

Use test/DEV DB according to repository standards.

---

# 69. API Integration Tests

Required:

```text
GET /api/products
→ paginated stable response

GET /api/products/:slug
→ full product detail

unknown product
→ 404

GET /api/categories
→ valid category list

GET /api/categories/:slug
→ valid category metadata

GET /api/brands
→ valid brand list

GET /api/brands/:slug
→ valid brand metadata
```

Verify product detail includes:

- brand
- category
- price
- availability
- ordered images
- ordered specifications

---

# 70. Seed Tests

Required:

- seed completes successfully
- seed reruns successfully
- counts remain stable after second run
- no duplicate slugs
- no duplicate product records
- no orphan images
- no orphan specifications
- all products have valid relationships
- all image paths/URLs have valid format
- primary image invariant
- demo pricing valid

Do not require every local image file to exist only through a database string check; verify referenced controlled local assets where practical.

---

# 71. Migration Tests

Verify:

- Prisma schema validates
- Prisma client generates
- migration applies to DEV
- migration ledger updated by Prisma
- migration does not require `db push`
- no destructive operation without justification
- existing foundational product data preserved
- migration status clean after apply

---

# 72. Frontend / Static Asset Validation

If local DEV assets are added, verify:

- expected files exist
- paths referenced by seed resolve correctly
- file names are deterministic
- no broken primary image path
- no huge accidental binary files
- alt text is present in data

Do not build the final gallery/catalog UI.

---

# 73. Responsive / Figma Boundary

TASK 02.5 does not own final customer product-page UI.

However, inspect relevant Figma/product documentation to ensure the data model supports known design requirements such as:

- product card primary image
- product name
- brand
- price
- availability
- product gallery
- grouped specifications
- category/brand presentation

Do not implement UI just because Figma shows it.

Record any data requirement implied by approved Figma that is missing from the model.

---

# 74. API Compatibility

Verify 02.5 does not break existing:

- authentication
- admin authentication
- cart schema relations
- wishlist schema relations
- order schema relations
- inventory relation
- current seed roles/users
- existing API error contract
- logger
- health checks

Do not rename existing product API routes silently if any already exist.

If an endpoint contract changes, document it.

---

# 75. Repository Hygiene

Before completion:

- remove scratch product-data scripts
- remove temporary download files
- remove unlicensed media accidentally added
- remove duplicate product models/services
- remove dead seed prototypes
- remove console debug logs
- verify `.gitignore`

Do not commit:

- `.env`
- DB credentials
- scraper cookies
- authenticated manufacturer session data
- temporary browser downloads
- giant raw image archives
- local QA screenshots unless intentionally documented assets

---

# 76. Documentation Requirements

Update relevant documentation for:

- Product domain architecture
- Category model
- Brand model
- ProductImage model
- ProductSpecification model
- Pricing representation
- Availability derivation
- Inventory boundary
- Product read APIs
- Seed strategy
- DEV catalog dataset
- Product data sourcing
- Media/licensing approach
- Migration workflow
- DEV migration
- PROD migration
- No PROD seed
- Swagger
- Testing
- Known limitations

Do not document live external pricing as guaranteed accurate.

---

# 77. Recommended Documentation Files

Use existing repository structure first.

Relevant files may include:

```text
docs/05_Features/PRODUCTS.md
docs/05_Features/CATEGORIES.md
docs/06_Database/PRISMA_SCHEMA.md
docs/06_Database/TABLES.md
docs/06_Database/RELATIONSHIPS.md
docs/06_Database/INDEXING.md
docs/06_Database/SEEDING.md
docs/06_Database/MIGRATIONS.md
docs/data/PRODUCT_SEED_SOURCES.md
```

Do not create duplicates if equivalent docs already exist.

---

# 78. Known Limitations to Document

Expected legitimate limitations after 02.5 may include:

- demo/reference prices are not live retailer prices
- DEV media is local/licensed/generated rather than Cloudinary-managed
- no customer catalog UI yet
- no advanced search/filter/sort yet
- no full inventory operations yet
- no admin product-management UI yet
- no live product ingestion
- no recommendation/AI persistence

These are planned boundaries, not defects.

---

# 79. Definition of Done — Architecture

```text
[ ] Existing product foundation evolved rather than recreated
[ ] Category is canonical and not duplicated
[ ] Brand is normalized
[ ] ProductImage is normalized
[ ] ProductSpecification is generic/category-agnostic
[ ] Existing Inventory remains stock source of truth
[ ] No future commerce/payment/AI/analytics schema introduced
[ ] No duplicate product service/API architecture
```

---

# 80. Definition of Done — Database

```text
[ ] Product model/evolution complete
[ ] Category model/evolution complete
[ ] Brand model complete
[ ] ProductImage complete
[ ] ProductSpecification complete
[ ] price uses Decimal/exact storage
[ ] compareAtPrice decision implemented/documented
[ ] indexes reviewed
[ ] unique constraints reviewed
[ ] FK behavior reviewed
[ ] migration reviewed
[ ] DEV migration successful
[ ] DEV physical schema matches schema.prisma
[ ] DEV Prisma ledger clean
[ ] DEV seed successful
[ ] DEV seed idempotent
[ ] PROD migration successful
[ ] PROD physical schema matches schema.prisma
[ ] PROD Prisma ledger clean
[ ] PROD seed NOT RUN
```

---

# 81. Definition of Done — Dataset

```text
[ ] ~6–8 representative categories
[ ] ~8–12 representative brands
[ ] ~20–30 realistic DEV products
[ ] product descriptions are credible
[ ] meaningful specifications exist
[ ] demo/reference prices exist
[ ] availability states are testable
[ ] primary image metadata exists
[ ] gallery image metadata exists where appropriate
[ ] controlled DEV assets exist where allowed
[ ] source attribution documented
[ ] media licensing/usage reviewed
```

Counts may vary slightly with documented justification.

---

# 82. Definition of Done — Backend / API

```text
[ ] ProductService complete for foundational read use cases
[ ] CategoryService complete
[ ] BrandService complete
[ ] GET /api/products
[ ] GET /api/products/:slug
[ ] GET /api/categories
[ ] GET /api/categories/:slug
[ ] GET /api/brands
[ ] GET /api/brands/:slug
[ ] pagination bounded
[ ] deterministic ordering
[ ] product detail includes brand/category/images/specifications
[ ] price serialization consistent
[ ] availability projection consistent
[ ] validation implemented
[ ] error contract consistent
[ ] Swagger accurate
```

---

# 83. Definition of Done — Testing

```text
[ ] Prisma validate PASS
[ ] Prisma generate PASS
[ ] migration verification PASS
[ ] seed verification PASS
[ ] seed idempotency PASS
[ ] service/unit tests PASS
[ ] database integration tests PASS
[ ] API integration tests PASS
[ ] existing auth compatibility PASS
[ ] existing inventory relation compatibility PASS
[ ] build/typecheck/lint PASS where applicable
```

---

# 84. Definition of Done — Security / Quality

```text
[ ] no secrets added
[ ] no raw SQL injection path
[ ] safe validation
[ ] page-size limits
[ ] no N+1 obvious query design
[ ] no accidental sensitive fields in responses
[ ] no unlicensed/unknown media silently committed
[ ] no live scraping architecture
[ ] no TLS bypass
[ ] no PROD seed
[ ] no db push
[ ] no manual _prisma_migrations fabrication
```

---

# 85. Required Evidence Before Approval

The implementation agent must provide evidence, not assertions.

Required evidence:

1. Branch and HEAD SHA
2. Changed-file list
3. Prisma schema diff
4. Exact migration name/hash
5. Migration SQL review summary
6. DEV `prisma migrate status`
7. DEV physical schema verification
8. DEV `_prisma_migrations` verification
9. Seed output
10. Seed second-run/idempotency evidence
11. Exact seed counts
12. Product API test results
13. DB integration test results
14. Backend lint/typecheck/build results
15. Swagger verification
16. Product-source attribution file
17. Local asset validation
18. PROD migration evidence
19. PROD physical schema verification
20. PROD `_prisma_migrations` verification
21. Explicit `PROD SEED: NOT RUN`
22. Documentation updates
23. Security/quality review

Never declare completion based only on:

```text
"implemented"
"migration created"
"seed works"
"tests pass"
```

without the supporting evidence.

---

# 86. Principal Architect Review Gate

Before merge, independently review:

## Architecture

- Did 02.5 evolve existing Product/Category/Inventory rather than duplicate them?
- Is Brand first-class and normalized?
- Are images/specifications normalized?
- Is Inventory still the stock source of truth?
- Were future domains kept out?

## Database

- Is migration additive/safe?
- Are money fields Decimal?
- Are constraints appropriate?
- Are Category/Brand delete semantics safe?
- Is migration history clean in DEV and PROD?
- Was PROD seed avoided?

## API

- Are list/detail contracts stable?
- Is pagination bounded?
- Are responses minimal where appropriate?
- Is product detail complete?
- Is Swagger accurate?

## Dataset

- Is seed realistic enough for later search/catalog work?
- Is seed deterministic/idempotent?
- Are product facts credible?
- Are sources documented?
- Are media rights/usage handled responsibly?

## Performance

- Are list queries bounded?
- Any N+1 patterns?
- Any huge nested payloads?
- Any unnecessary indexes?

## Security

- Any secret leakage?
- Unsafe URL/query handling?
- Any accidental admin/write exposure?
- Any TLS weakening?

## Scope

- Did the task avoid implementing 02.6 / 02.7 / 03.1 / 03.4 / 04.3 / 05.2 early?

---

# 87. Approval Rule

TASK 02.5 is eligible for approval only if:

```text
Architecture PASS
AND
Database PASS
AND
Migration PASS
AND
DEV Seed PASS
AND
Dataset Quality PASS
AND
Backend/API PASS
AND
Testing PASS
AND
Documentation PASS
AND
PROD Migration Evidence PASS
AND
Scope Boundary PASS
```

Any critical migration defect, duplicate product-domain model, unsafe pricing representation, broken existing inventory relation, secret leakage, unauthorized future-domain expansion, non-idempotent seed, or unverified production migration blocks completion.

---

# 88. Final Scope Freeze

## 02.5 owns

```text
✅ Product persistence/evolution
✅ Category persistence/evolution
✅ Brand persistence
✅ Product images metadata
✅ Product specifications
✅ Product details data contract
✅ Canonical pricing
✅ Basic availability projection
✅ Existing Inventory integration
✅ Product/category/brand read services
✅ Product/category/brand read APIs
✅ Pagination foundation
✅ Validation
✅ Swagger
✅ DEV product dataset
✅ DEV media references/assets
✅ Source/attribution documentation
✅ DEV migration
✅ DEV seed
✅ PROD schema migration
✅ Tests
✅ Documentation
```

## 02.6 owns

```text
⏭ Product search
⏭ Search suggestions
⏭ Filtering
⏭ Sorting
⏭ Search results
```

## 02.7 owns

```text
⏭ React Query
⏭ Cache strategy
⏭ Query configuration
⏭ Global API-state foundation
```

## 03.1 owns

```text
⏭ Full Products page
⏭ Product Details page
⏭ Category catalog UI
⏭ Customer product gallery UI
⏭ Customer product specifications UI
```

## 03.4 owns

```text
⏭ Stock quantity workflows
⏭ Low-stock behavior
⏭ Out-of-stock business rules
⏭ Stock updates
⏭ Purchase restrictions
⏭ Low-stock alerts
⏭ Inventory movement/history
```

## 04.3 owns

```text
⏭ Cloudinary uploads
⏭ Production image storage
⏭ Image delivery/transformation pipeline
```

## 05.2 owns

```text
⏭ Full admin product-management UI
⏭ Product create/edit/delete workflows
⏭ Admin image uploads
⏭ Admin specification management
⏭ Admin category management
⏭ Admin stock management
```

---

# 89. Final Architecture Principle

ElectroHub should evolve as:

```text
02.5
PRODUCT DOMAIN FOUNDATION
        ↓
02.6
SEARCH
        ↓
02.7
STATE/API CONSUMPTION
        ↓
03.1
CUSTOMER CATALOG
        ↓
03.4
FULL INVENTORY
        ↓
04.3
CLOUDINARY
        ↓
05.2
ADMIN PRODUCT MANAGEMENT
```

not:

```text
02.5
Product
+ full storefront
+ advanced search
+ full inventory
+ Cloudinary
+ admin management
+ recommendations
+ analytics
```

The objective is a **clean, realistic, well-seeded product-domain foundation** that later phases can consume without schema rewrites or architectural duplication.

---

# 90. Final Implementation Sequence

Recommended execution order:

```text
1. Sync current repository / read AGENTS.md
2. Read current task + applicable docs
3. Inspect current Product/Category/Inventory schema
4. Inspect current seed
5. Inspect current product/backend routes/services
6. Inspect relevant Figma product data needs
7. Freeze exact schema evolution
8. Implement Brand / ProductImage / ProductSpecification as needed
9. Evolve Product/Category safely
10. Implement pricing/availability mapping
11. Implement read services/controllers/routes
12. Implement DTO/validation/Swagger
13. Curate DEV dataset + source attribution
14. Add controlled DEV media assets
15. Create/review Prisma migration
16. Apply DEV migration
17. Run DEV seed twice / verify idempotency
18. Run targeted + full applicable tests
19. Verify API contracts
20. Apply PROD schema migration only
21. Verify PROD physical schema + ledger
22. Update documentation
23. Repository hygiene
24. Produce evidence report
25. Hand off to Principal Architect
```

Do not skip migration or seed verification merely because APIs compile.

---

# 91. Required Implementation Report

At completion, provide:

```text
# TASK 02.5 — IMPLEMENTATION REPORT

STATUS:
READY FOR ARCHITECTURAL REVIEW / REQUEST CHANGES / BLOCKED

BRANCH:
feature/product-foundation

HEAD SHA:
...

## Architecture
EXISTING PRODUCT FOUNDATION EVOLVED: PASS/FAIL
DUPLICATE PRODUCT MODELS: NONE/<details>
INVENTORY SOURCE OF TRUTH PRESERVED: PASS/FAIL
SCOPE BOUNDARY: PASS/FAIL

## Database
PRODUCT: PASS/FAIL
CATEGORY: PASS/FAIL
BRAND: PASS/FAIL
PRODUCTIMAGE: PASS/FAIL
PRODUCTSPECIFICATION: PASS/FAIL
PRICING DECIMAL: PASS/FAIL
AVAILABILITY: PASS/FAIL

PRISMA VALIDATE: PASS/FAIL
PRISMA GENERATE: PASS/FAIL
MIGRATION: <exact name>

DEV PHYSICAL SCHEMA: MATCH/MISMATCH
DEV LEDGER: <applied>/<repo total>
DEV PENDING: <number + names>
DEV FAILED: <number + names>

PROD PHYSICAL SCHEMA: MATCH/MISMATCH/NOT VERIFIED
PROD LEDGER: <applied>/<repo total>
PROD PENDING: <number + names>
PROD FAILED: <number + names>
PROD SEED: NOT RUN

## DEV Dataset
CATEGORIES: <count>
BRANDS: <count>
PRODUCTS: <count>
PRODUCT IMAGES: <count>
SPECIFICATIONS: <count>
PRODUCT INVENTORY ROWS: <count>

SEED PASS 1: PASS/FAIL
SEED PASS 2: PASS/FAIL
SEED IDEMPOTENCY: PASS/FAIL
SOURCE ATTRIBUTION: PASS/FAIL
MEDIA VALIDATION: PASS/FAIL

## APIs
GET /api/products: PASS/FAIL
GET /api/products/:slug: PASS/FAIL
GET /api/categories: PASS/FAIL
GET /api/categories/:slug: PASS/FAIL
GET /api/brands: PASS/FAIL
GET /api/brands/:slug: PASS/FAIL
PAGINATION LIMITS: PASS/FAIL
PRICE SERIALIZATION: PASS/FAIL
AVAILABILITY PROJECTION: PASS/FAIL
SWAGGER: PASS/FAIL

## Tests
UNIT/SERVICE: <result>
DB INTEGRATION: <result>
API INTEGRATION: <result>
SEED TESTS: <result>
MIGRATION TESTS: <result>
TYPECHECK: PASS/FAIL
LINT: PASS/FAIL
BUILD: PASS/FAIL

## Compatibility
AUTH: PASS/FAIL
INVENTORY RELATION: PASS/FAIL
CART/WISHLIST RELATIONS: PASS/FAIL
ORDER RELATIONS: PASS/FAIL
ERROR CONTRACT: PASS/FAIL

## Repository
FILES CHANGED:
- ...

git diff --check: PASS/FAIL
SECRETS CHECK: PASS/FAIL
UNLICENSED/UNKNOWN MEDIA: NONE/<details>

## Observed Outside Scope
- None
OR
- ...

## Known Limitations
- ...

## Remaining Risks
- None
OR
- ...

## Final Implementer Decision
READY FOR INDEPENDENT ARCHITECTURAL REVIEW
/
REQUEST CHANGES
/
BLOCKED
```

Do not self-approve.

The Principal Software Architect must independently review the implementation before merge.
