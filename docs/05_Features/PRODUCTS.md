# Products

## 1. Purpose

This document defines the product catalog functionality for ElectroHub.

Products are the central commerce entities of the platform and are used by:

- Product browsing.
- Search.
- Categories.
- Image search.
- Recommendations.
- Wishlist.
- Cart.
- Checkout.
- Inventory.
- Orders.
- Administration.

---

## 2. Product Model

A product represents an electronics or technology item sold through ElectroHub.

A product should contain appropriate information such as:

```text
ID
Name
Description
Price
Images
Category
Brand
Inventory Quantity
Availability
Specifications
Created At
Updated At
```

The exact database schema is defined by Prisma and documented in `docs/06_Database/`.

---

## 3. Product Catalog

Customers can browse the product catalog.

The catalog supports:

- Product listing.
- Product details.
- Categories.
- Search.
- Filtering.
- Sorting.
- Availability information.
- Recommendations.

The catalog should remain responsive across supported devices.

---

## 4. Product Details

A product details page should provide:

```text
Product Name
Images
Price
Description
Specifications
Category
Availability
Quantity Selection
Add to Cart
Wishlist Action
Recommendations
```

Where applicable, the page may also expose related products.

---

## 5. Product Images

Product images are managed through Cloudinary where appropriate.

Flow:

```text
Admin
 ↓
Product Image Upload
 ↓
Cloudinary
 ↓
Image URL / Metadata
 ↓
Product Record
 ↓
Frontend
```

Images should be optimized for the required display sizes.

---

## 6. Product Categories

Products belong to categories.

Categories support:

```text
Catalog Navigation
Filtering
Search
Recommendations
Administration
```

Example electronics categories may include:

```text
Laptops
Smartphones
Tablets
Accessories
Gaming
Networking
Computer Components
```

The final category structure is determined by the project data and admin configuration.

---

## 7. Product Search

Customers can search the product catalog.

Conceptually:

```text
Search Input
 ↓
Search API
 ↓
Backend
 ↓
Product Query
 ↓
Filtered Results
```

Search should support:

- Query text.
- Pagination.
- Relevant filtering.
- Sorting.
- Empty results.
- Loading states.
- Error states.

---

## 8. Search by Image

Products can also participate in the image-search workflow.

```text
User Image
 ↓
Backend
 ↓
FastAPI AI Service
 ↓
Image Similarity / Matching
 ↓
Product References
 ↓
Product Catalog
 ↓
Matching Products
```

The AI service may use simulated or rule-based matching for academic/demo purposes where real ML is not required.

---

## 9. Recommendations

Products may appear in recommendation sections such as:

```text
Recommended for You
You May Also Like
Frequently Bought Together
Similar Products
Popular Products
```

Recommendation logic may use:

```text
User Views
User Clicks
Purchase History
Product Category
Popularity
```

The backend remains responsible for returning valid product data.

---

## 10. Inventory and Availability

Product availability is linked to inventory.

Customers may see:

```text
In Stock
Low Stock
Out of Stock
```

If a product is unavailable, the customer must not be able to complete a purchase for unavailable quantity.

The backend must revalidate inventory during checkout.

---

## 11. Cart Integration

Customers can add available products to their cart.

Flow:

```text
Product
 ↓
Add to Cart
 ↓
Cart API
 ↓
Cart State
```

The cart must reference valid products and quantities.

Checkout performs authoritative product and inventory validation.

---

## 12. Wishlist Integration

Customers can add products to their wishlist.

The wishlist is account-owned and server-authoritative.

```text
Product
 ↓
Wishlist Action
 ↓
Backend
 ↓
Wishlist
 ↓
React Query
```

Customers may add or remove products according to the wishlist workflow.

---

## 13. Checkout Integration

Product data contributes to checkout calculations.

Before order creation, the backend must validate:

```text
Product Exists
Price Is Valid
Product Is Available
Requested Quantity Is Valid
Inventory Is Sufficient
```

The frontend must not be treated as the authoritative source for final product pricing or availability.

---

## 14. Order Snapshot

When an order is created, the system should preserve the necessary product/order-item information required for historical order accuracy.

An order should not depend on the customer viewing the current mutable product record to understand what was purchased.

Important historical information may include:

```text
Product Name
Purchased Price
Quantity
Relevant Product Reference
```

---

## 15. Administration

Administrators can manage products according to their role.

Administrative product operations may include:

```text
Create Product
View Product
Update Product
Delete / Archive Product
Manage Images
Manage Category
Update Price
Update Inventory
```

All administrative operations require server-side authorization.

---

## 16. Product Validation

Product creation and updates must validate:

- Required fields.
- Price.
- Quantity.
- Category.
- Image data.
- Product metadata.
- Supported values.

Invalid product data must be rejected by the backend.

---

## 17. Product Deletion

Product deletion must consider existing references.

If a product has historical order relationships, the system should avoid destroying information required to preserve order history.

Where appropriate, an archive/inactive strategy may be preferred over destructive deletion.

---

## 18. Product API

Typical endpoints may include:

```text
GET    /api/products
GET    /api/products/:id
POST   /api/admin/products
PATCH  /api/admin/products/:id
DELETE /api/admin/products/:id
```

Search and filtering may use dedicated query parameters or endpoints.

The exact contract follows `API_GUIDELINES.md` and the backend implementation.

---

## 19. Product Performance

Product catalog performance should use:

- Pagination.
- Efficient Prisma queries.
- Appropriate indexes.
- Image optimization.
- React Query caching.
- Lazy loading where appropriate.

Avoid loading the entire product catalog for normal browsing.

---

## 20. Product Security

Product management must enforce:

```text
Authentication
+
Administrator Authorization
+
Input Validation
```

Customers may read public catalog information but must not modify products or inventory.

---

## 21. Product States

A product may have availability determined from inventory and administrative state.

Conceptually:

```text
Active + Quantity > Threshold
        ↓
In Stock

Active + Low Quantity
        ↓
Low Stock

Active + Quantity = 0
        ↓
Out of Stock

Inactive
        ↓
Not Purchasable
```

The exact thresholds are configurable according to the inventory implementation.

---

## 22. Testing

Product functionality should include tests for:

```text
Product Listing
Product Details
Search
Filtering
Sorting
Category Filtering
Product Creation
Product Update
Product Validation
Image Handling
Inventory Availability
Wishlist Integration
Cart Integration
Authorization
Product Not Found
Empty Results
```

Critical catalog and purchase flows should also be covered by E2E tests.

---

## 23. Definition of Done

Products are complete when:

- Customers can browse products.
- Product details are available.
- Categories work.
- Search works.
- Filtering/sorting works where required.
- Images are managed correctly.
- Inventory availability is displayed.
- Cart integration works.
- Wishlist integration works.
- Recommendations can consume product data.
- Admin product management is secured.
- Validation is implemented.
- Tests pass.
- Documentation matches the implementation.

---

## 24. Product Principle

> **Products are the central catalog entities of ElectroHub and must remain consistent across browsing, search, recommendations, inventory, cart, checkout, and historical orders.**
