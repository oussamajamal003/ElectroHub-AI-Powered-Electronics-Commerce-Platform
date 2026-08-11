# Database Tables

## 1. Purpose

This document defines the logical database tables for ElectroHub.

The table design is based on the approved ERD and Prisma architecture:

```text
Supabase PostgreSQL
        ↑
      Prisma
        ↑
   Node.js Backend
```

The Prisma schema is the implementation source for the database model.

---

# 2. Table Overview

The core database tables are:

```text
users
categories
products
product_images
inventories

carts
cart_items

wishlist_items

orders
order_items
payments
deliveries

recommendations
behavioral_events
notifications
generated_documents
```

Not every optional table must be implemented if its corresponding feature does not require persistence.

---

# 3. users

Stores authenticated customers and administrators.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID/String | PK | User identifier |
| email | String | UNIQUE, NOT NULL | Login email |
| password_hash | String | NOT NULL | Hashed password |
| role | Enum | NOT NULL | CUSTOMER / ADMIN |
| created_at | DateTime | NOT NULL | Creation timestamp |
| updated_at | DateTime | NOT NULL | Last update |

Indexes:

```text
PRIMARY KEY (id)
UNIQUE (email)
```

Relationships:

```text
users → carts
users → orders
users → wishlist_items
users → behavioral_events
users → notifications
```

---

# 4. categories

Stores product categories.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID/String | PK | Category identifier |
| name | String | NOT NULL | Category name |
| slug | String | UNIQUE, NOT NULL | Public URL identifier |
| description | String | NULLABLE | Category description |
| created_at | DateTime | NOT NULL | Creation timestamp |
| updated_at | DateTime | NOT NULL | Last update |

Indexes:

```text
PRIMARY KEY (id)
UNIQUE (slug)
```

Relationships:

```text
categories 1 → N products
```

---

# 5. products

Stores the electronics catalog.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID/String | PK | Product identifier |
| name | String | NOT NULL | Product name |
| slug | String | UNIQUE, NOT NULL | Public product identifier |
| description | String | NULLABLE | Product description |
| price | Decimal | NOT NULL | Current product price |
| status | Enum | NOT NULL | ACTIVE / INACTIVE / ARCHIVED |
| category_id | UUID/String | FK | Product category |
| created_at | DateTime | NOT NULL | Creation timestamp |
| updated_at | DateTime | NOT NULL | Last update |

Indexes:

```text
PRIMARY KEY (id)
UNIQUE (slug)
INDEX (category_id)
INDEX (status)
```

Relationships:

```text
products → categories
products → product_images
products → inventories
products → cart_items
products → wishlist_items
products → order_items
products → recommendations
```

---

# 6. product_images

Stores product-image references and metadata.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID/String | PK | Image identifier |
| product_id | UUID/String | FK | Related product |
| url | String | NOT NULL | Cloudinary/media URL |
| alt_text | String | NULLABLE | Accessibility text |
| metadata | JSON | NULLABLE | Image metadata |
| created_at | DateTime | NOT NULL | Creation timestamp |

Indexes:

```text
PRIMARY KEY (id)
INDEX (product_id)
```

Relationship:

```text
products 1 → N product_images
```

---

# 7. inventories

Stores current stock information.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID/String | PK | Inventory identifier |
| product_id | UUID/String | UNIQUE, FK | Related product |
| quantity | Integer | NOT NULL | Current quantity |
| low_stock_threshold | Integer | NOT NULL | Low-stock threshold |
| updated_at | DateTime | NOT NULL | Last inventory update |

Indexes:

```text
PRIMARY KEY (id)
UNIQUE (product_id)
```

Relationship:

```text
products 1 → 1 inventories
```

Inventory updates must support concurrency-safe purchasing.

---

# 8. carts

Stores the active cart for an authenticated customer.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID/String | PK | Cart identifier |
| user_id | UUID/String | UNIQUE, FK | Cart owner |
| created_at | DateTime | NOT NULL | Creation timestamp |
| updated_at | DateTime | NOT NULL | Last update |

Indexes:

```text
PRIMARY KEY (id)
UNIQUE (user_id)
```

Relationship:

```text
users 1 → 1 carts
carts 1 → N cart_items
```

---

# 9. cart_items

Stores products selected in a cart.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID/String | PK | Cart-item identifier |
| cart_id | UUID/String | FK | Parent cart |
| product_id | UUID/String | FK | Selected product |
| quantity | Integer | NOT NULL | Requested quantity |
| created_at | DateTime | NOT NULL | Creation timestamp |
| updated_at | DateTime | NOT NULL | Last update |

Constraints:

```text
UNIQUE (cart_id, product_id)
```

Indexes:

```text
PRIMARY KEY (id)
INDEX (product_id)
```

Relationships:

```text
carts 1 → N cart_items
products 1 → N cart_items
```

---

# 10. wishlist_items

Stores products saved by customers.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID/String | PK | Wishlist-item identifier |
| user_id | UUID/String | FK | Wishlist owner |
| product_id | UUID/String | FK | Saved product |
| created_at | DateTime | NOT NULL | Creation timestamp |

Constraints:

```text
UNIQUE (user_id, product_id)
```

Indexes:

```text
PRIMARY KEY (id)
INDEX (product_id)
```

Relationships:

```text
users 1 → N wishlist_items
products 1 → N wishlist_items
```

---

# 11. orders

Stores historical commerce transactions.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID/String | PK | Internal order identifier |
| order_number | String | UNIQUE, NOT NULL | Customer-facing order number |
| user_id | UUID/String | FK | Customer |
| subtotal | Decimal | NOT NULL | Order subtotal |
| shipping_amount | Decimal | NOT NULL | Shipping amount |
| total | Decimal | NOT NULL | Final order total |
| status | Enum | NOT NULL | Order state |
| shipping_info | JSON | NOT NULL | Shipping information |
| created_at | DateTime | NOT NULL | Order creation |
| updated_at | DateTime | NOT NULL | Last update |

Indexes:

```text
PRIMARY KEY (id)
UNIQUE (order_number)
INDEX (user_id)
INDEX (status)
INDEX (created_at)
```

Relationships:

```text
users 1 → N orders
orders 1 → N order_items
orders 1 → 1 payments
orders 1 → 1 deliveries
```

Historical order information must remain stable.

---

# 12. order_items

Stores the products purchased in an order.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID/String | PK | Order-item identifier |
| order_id | UUID/String | FK | Parent order |
| product_id | UUID/String | FK | Purchased product |
| product_name_snapshot | String | NOT NULL | Historical product name |
| unit_price | Decimal | NOT NULL | Historical purchase price |
| quantity | Integer | NOT NULL | Purchased quantity |

Indexes:

```text
PRIMARY KEY (id)
INDEX (order_id)
INDEX (product_id)
```

Relationships:

```text
orders 1 → N order_items
products 1 → N order_items
```

The stored `unit_price` is the historical price and must not be replaced by the current product price.

---

# 13. payments

Stores payment state and provider references.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID/String | PK | Payment identifier |
| order_id | UUID/String | UNIQUE, FK | Related order |
| provider | Enum | NOT NULL | STRIPE |
| provider_reference | String | NULLABLE | Stripe reference |
| amount | Decimal | NOT NULL | Payment amount |
| status | Enum | NOT NULL | Payment state |
| created_at | DateTime | NOT NULL | Creation timestamp |
| updated_at | DateTime | NOT NULL | Last update |

Indexes:

```text
PRIMARY KEY (id)
UNIQUE (order_id)
INDEX (status)
INDEX (provider_reference)
```

Raw card details must never be stored.

---

# 14. deliveries

Stores delivery progress for an order.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID/String | PK | Delivery identifier |
| order_id | UUID/String | UNIQUE, FK | Related order |
| status | Enum | NOT NULL | Delivery/order state |
| latitude | Decimal | NULLABLE | Current latitude |
| longitude | Decimal | NULLABLE | Current longitude |
| estimated_arrival | DateTime | NULLABLE | Estimated arrival |
| updated_at | DateTime | NOT NULL | Last update |

Indexes:

```text
PRIMARY KEY (id)
UNIQUE (order_id)
INDEX (status)
```

Delivery location must only be accessible to authorized users.

---

# 15. recommendations

Stores persisted product-recommendation relationships where required.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID/String | PK | Recommendation identifier |
| source_product_id | UUID/String | FK | Source product |
| recommended_product_id | UUID/String | FK | Recommended product |
| type | Enum | NOT NULL | Recommendation strategy |
| score | Decimal | NULLABLE | Recommendation score |
| created_at | DateTime | NOT NULL | Creation timestamp |

Constraints:

```text
UNIQUE (source_product_id, recommended_product_id, type)
```

Indexes:

```text
PRIMARY KEY (id)
INDEX (recommended_product_id)
INDEX (type)
```

This table is optional if recommendations are generated dynamically.

---

# 16. behavioral_events

Stores non-sensitive application behavior used for analytics and recommendations.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID/String | PK | Event identifier |
| user_id | UUID/String | NULLABLE, FK | Optional user |
| event_type | String | NOT NULL | Event name |
| product_id | UUID/String | NULLABLE, FK | Related product |
| order_id | UUID/String | NULLABLE, FK | Related order |
| metadata | JSON | NULLABLE | Non-sensitive event context |
| created_at | DateTime | NOT NULL | Event timestamp |

Indexes:

```text
PRIMARY KEY (id)
INDEX (event_type)
INDEX (user_id)
INDEX (product_id)
INDEX (created_at)
```

Sensitive authentication, payment, and secret data must never be stored here.

---

# 17. notifications

Stores transactional notification state when persistence is required.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID/String | PK | Notification identifier |
| user_id | UUID/String | FK | Recipient |
| type | Enum | NOT NULL | OTP / order / payment |
| status | Enum | NOT NULL | Pending / sent / failed |
| created_at | DateTime | NOT NULL | Creation timestamp |
| sent_at | DateTime | NULLABLE | Delivery timestamp |

Relationships:

```text
users 1 → N notifications
```

Brevo remains the external email delivery provider.

---

# 18. generated_documents

Optional table for persisted invoice and payment-receipt metadata.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| id | UUID/String | PK | Document identifier |
| order_id | UUID/String | FK | Related order |
| type | Enum | NOT NULL | Invoice / receipt |
| storage_reference | String | NULLABLE | Document reference |
| created_at | DateTime | NOT NULL | Creation timestamp |

Possible document types:

```text
ORDER_INVOICE
PAYMENT_RECEIPT
```

If PDFs are generated dynamically and do not require persistence, this table may be omitted.

---

# 19. Money Fields

Financial values use decimal types.

Relevant tables include:

```text
products.price
orders.subtotal
orders.shipping_amount
orders.total
order_items.unit_price
payments.amount
```

Floating-point database types should not be used for authoritative monetary values.

---

# 20. Common Constraints

The database should enforce important invariants.

Examples:

```text
users.email UNIQUE

categories.slug UNIQUE

products.slug UNIQUE

inventories.product_id UNIQUE

carts.user_id UNIQUE

cart_items(cart_id, product_id) UNIQUE

wishlist_items(user_id, product_id) UNIQUE

orders.order_number UNIQUE

payments.order_id UNIQUE

deliveries.order_id UNIQUE
```

Database constraints complement backend validation.

---

# 21. Referential Integrity

Foreign keys must prevent invalid references.

Examples:

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
```

Delete behavior must be selected deliberately for every relationship.

---

# 22. Historical Data

Historical commerce records must remain understandable.

Therefore:

```text
Product Current Price
        ≠
Order Item Historical Price
```

Products involved in historical orders should generally be archived rather than destructively deleted.

---

# 23. Database Naming

The project should use one consistent naming convention.

Recommended database naming:

```text
snake_case
```

Examples:

```text
created_at
updated_at
product_id
order_number
low_stock_threshold
```

Prisma field naming may use the project's TypeScript convention with explicit database mappings where necessary.

---

# 24. Definition of Done

The database table design is complete when:

- Required tables are implemented.
- Primary keys are defined.
- Foreign keys are defined.
- Unique constraints are defined.
- Required indexes exist.
- Monetary values use decimal types.
- Historical order data is preserved.
- Delete behavior is intentional.
- Optional tables are implemented only when required.
- Prisma schema matches the documented tables.
- Migrations reflect the approved schema.
