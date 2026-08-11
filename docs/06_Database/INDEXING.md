# Database Indexing

## 1. Purpose

This document defines the indexing strategy for ElectroHub PostgreSQL.

Indexes are used to improve the performance of frequent database operations while avoiding unnecessary storage and write overhead.

The indexing strategy must remain aligned with:

```text
Application Queries
        ↓
Prisma
        ↓
PostgreSQL
```

Indexes should be added based on actual query patterns and reviewed as the application grows.

---

# 2. Indexing Principles

Indexes should support:

- Frequently queried fields.
- Foreign-key lookups.
- Unique constraints.
- Filtering.
- Sorting.
- Pagination.
- Administrative searches.
- Order history queries.
- Analytics queries where appropriate.

Indexes must not be added automatically to every column.

Every index introduces:

```text
Storage Cost
+
Write / Update Cost
+
Maintenance Cost
```

---

# 3. Primary Keys

Primary keys automatically provide an index.

Examples:

```text
users.id
categories.id
products.id
orders.id
payments.id
```

No additional duplicate index should be created for a primary key.

---

# 4. Unique Indexes

Unique constraints also provide indexed lookup behavior.

Important unique fields include:

```text
users.email
categories.slug
products.slug
orders.order_number
```

Relationship uniqueness also creates important indexes:

```text
carts.user_id
inventories.product_id
payments.order_id
deliveries.order_id
```

---

# 5. User Indexes

Recommended:

```text
UNIQUE(email)
```

Primary lookup:

```text
users.id
```

The email index supports authentication lookup.

Avoid additional indexes on rarely queried user fields without evidence.

---

# 6. Category Indexes

Recommended:

```text
UNIQUE(slug)
```

The category slug supports public category navigation.

If administrative filtering by status is introduced, an index should only be added when the query volume justifies it.

---

# 7. Product Indexes

Important indexes include:

```text
UNIQUE(slug)
INDEX(category_id)
INDEX(status)
```

These support:

```text
Product Details
Category Browsing
Product Filtering
Catalog Administration
```

If search implementation introduces additional searchable fields, indexing should follow the actual PostgreSQL search strategy.

---

# 8. Product Image Indexes

Recommended:

```text
INDEX(product_id)
```

This supports:

```text
Load Product
 ↓
Load Product Images
```

---

# 9. Inventory Indexes

Recommended:

```text
UNIQUE(product_id)
```

Inventory is normally accessed through the product relationship.

Additional indexes should only be added if administrative inventory queries demonstrate a need.

---

# 10. Cart Indexes

Recommended:

```text
UNIQUE(user_id)
```

This supports locating the authenticated user's active cart.

---

# 11. Cart Item Indexes

Recommended:

```text
UNIQUE(cart_id, product_id)
INDEX(product_id)
```

The composite unique index supports:

```text
Find Product in Cart
Prevent Duplicate Cart Item
```

The product index supports product-related lookups.

---

# 12. Wishlist Indexes

Recommended:

```text
UNIQUE(user_id, product_id)
INDEX(product_id)
```

This supports:

```text
User Wishlist
Duplicate Prevention
Product Wishlist Lookup
```

---

# 13. Order Indexes

Orders are frequently queried by customer and status.

Recommended:

```text
UNIQUE(order_number)
INDEX(user_id)
INDEX(status)
INDEX(created_at)
```

These support:

```text
Customer Order History
Admin Order Filtering
Order Status Dashboards
Date-Based Reporting
```

---

# 14. Composite Order Indexes

Composite indexes may be introduced when actual query patterns justify them.

Example:

```text
INDEX(user_id, created_at)
```

This can support:

```text
Get User Orders
Ordered by Creation Date
```

A composite index should only be added when the query pattern is common enough to justify it.

---

# 15. Order Item Indexes

Recommended:

```text
INDEX(order_id)
INDEX(product_id)
```

These support:

```text
Load Order Items
Product Purchase History
Sales Analytics
```

---

# 16. Payment Indexes

Recommended:

```text
UNIQUE(order_id)
INDEX(status)
INDEX(provider_reference)
```

These support:

```text
Find Payment by Order
Filter Payment Status
Reconcile Provider References
```

Provider references should be indexed only when they are used for reconciliation or lookup.

---

# 17. Delivery Indexes

Recommended:

```text
UNIQUE(order_id)
INDEX(status)
```

These support:

```text
Load Delivery for Order
Admin Active Delivery Filtering
```

---

# 18. Recommendation Indexes

For persisted recommendations:

```text
UNIQUE(source_product_id, recommended_product_id, type)
INDEX(recommended_product_id)
INDEX(type)
```

These support:

```text
Similar Products
Frequently Bought Together
Recommendation Retrieval
```

---

# 19. Behavioral Event Indexes

Behavioral events can grow significantly.

Recommended starting indexes:

```text
INDEX(event_type)
INDEX(user_id)
INDEX(product_id)
INDEX(created_at)
```

Potential composite indexes may include:

```text
INDEX(event_type, created_at)
INDEX(product_id, created_at)
```

These should be introduced when analytics queries demonstrate the need.

---

# 20. Notification Indexes

Recommended:

```text
INDEX(user_id)
INDEX(status)
```

If notifications are frequently queried by user and status:

```text
INDEX(user_id, status)
```

may be considered.

---

# 21. Generated Document Indexes

If generated document metadata is persisted:

```text
INDEX(order_id)
INDEX(type)
```

These support:

```text
Find Order Documents
Find Invoice / Receipt
```

---

# 22. Search Indexing

Search requirements depend on the final implementation.

Simple catalog filtering may use ordinary indexes such as:

```text
category_id
status
```

If full-text search is introduced, the project should evaluate PostgreSQL full-text search or another approved search strategy.

Do not add arbitrary indexes to text fields without defining the search mechanism.

---

# 23. Pagination

Indexes should support common pagination patterns.

For example:

```text
ORDER BY created_at DESC
```

may benefit from an appropriate index when used frequently on large datasets.

Cursor-based pagination should be considered for large datasets.

---

# 24. Analytics Indexing

Analytics queries can become expensive.

Important fields include:

```text
event_type
created_at
product_id
user_id
order status
```

Analytics indexes must be balanced against the write volume of behavioral events.

---

# 25. Index Selectivity

Indexes are most useful when they significantly reduce the number of rows PostgreSQL must inspect.

Low-cardinality fields should not automatically receive standalone indexes.

Example:

```text
status
```

may be useful for some high-volume queries, but its usefulness depends on table size and query distribution.

---

# 26. Foreign-Key Indexing

Frequently queried foreign keys should be indexed.

Important examples:

```text
products.category_id
product_images.product_id
cart_items.cart_id
cart_items.product_id
wishlist_items.user_id
wishlist_items.product_id
orders.user_id
order_items.order_id
order_items.product_id
behavioral_events.user_id
behavioral_events.product_id
```

The exact indexing should be reviewed against generated SQL and query patterns.

---

# 27. Over-Indexing

Avoid creating:

```text
Duplicate Indexes
Unused Indexes
Indexes With Identical Prefixes Without Purpose
Indexes on Rarely Queried Fields
```

Every index should have an identifiable query or constraint purpose.

---

# 28. Index Review

Indexes should be reviewed when:

- A major feature is introduced.
- Query patterns change.
- A large amount of data is added.
- Performance regressions appear.
- Analytics queries become expensive.
- Database monitoring identifies slow queries.

Performance decisions should use evidence rather than assumptions.

---

# 29. Migration Safety

Index creation on production-sized tables must be considered carefully.

Large index operations can affect:

```text
Database Load
Locking
Deployment Time
Application Availability
```

Production index changes should be reviewed before deployment.

---

# 30. Definition of Done

Indexing is complete when:

- Primary keys are indexed.
- Required unique constraints exist.
- Important foreign keys are indexed.
- Common product queries are supported.
- Customer order queries are supported.
- Admin filtering is supported.
- Analytics queries have appropriate indexes where justified.
- Duplicate indexes are avoided.
- Indexes are documented.
- Performance is verified using evidence.
