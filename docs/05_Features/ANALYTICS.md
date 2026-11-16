# Analytics

## 1. Purpose

This document defines the analytics system for ElectroHub.

Analytics provide operational and product insights for administrators.

Potential areas include:

```text
Sales
Orders
Products
Categories
Inventory
Search
Image Search
Recommendations
Wishlist
Cart
Delivery
```

Analytics are intended to support product decisions and demonstrate measurable system behavior.

---

## 2. Analytics Architecture

```text
Customer / Admin Activity
        ↓
Application Events / Business Data
        ↓
Backend
        ↓
Analytics Service / Queries
        ↓
Aggregated Metrics
        ↓
Admin Dashboard
```

The exact implementation may use direct database aggregation, event-based tracking, or a combination according to project scope.

---

## 3. Analytics Principles

Analytics should be:

- Accurate.
- Purpose-driven.
- Efficient.
- Privacy-conscious.
- Reproducible.
- Based on authoritative data.

Analytics must not change core commerce state.

---

## 4. Sales Analytics

Administrators may view metrics such as:

```text
Revenue
Orders
Average Order Value
Sales Over Time
```

Revenue calculations must use authoritative order/payment data.

Test-mode payment data must be clearly understood as demonstration data.

---

## 5. Order Analytics

Possible order metrics include:

```text
Total Orders
Orders by Status
Confirmed
Preparing
Out for Delivery
Delivered
```

The dashboard may provide time-based trends.

---

## 6. Product Analytics

Product-level metrics may include:

```text
Views
Clicks
Add-to-Cart Actions
Wishlist Adds
Purchases
```

These metrics can identify popular products and customer interest.

---

## 7. Category Analytics

Category analytics may include:

```text
Products by Category
Orders by Category
Sales by Category
Popular Categories
```

Category metrics should use consistent category relationships.

---

## 8. Inventory Analytics

Inventory analytics may include:

```text
In-Stock Products
Low-Stock Products
Out-of-Stock Products
Restocking Activity
```

Inventory analytics must reflect current authoritative inventory state.

---

## 9. Search Analytics

Search behavior may include:

```text
Search Count
Popular Search Queries
No-Result Searches
Product Selection After Search
```

Search analytics should avoid storing unnecessary sensitive user information.

---

## 10. Image Search Analytics

Image-search events may include:

```text
Search Requests
Successful Searches
No-Result Searches
Product Selected
```

The system should not retain uploaded image contents solely for analytics unless explicitly required.

---

## 11. Recommendation Analytics

Recommendation metrics may include:

```text
Recommendations Shown
Recommendation Clicks
Products Added to Cart
Purchases Following Recommendation
Conversion Rate
Most Recommended Products
```

A simplified conversion calculation may be:

```text
Recommendation Conversion Rate
=
Conversions / Recommendation Interactions
```

The exact metric definition must remain consistent across reports.

---

## 12. Wishlist Analytics

Possible wishlist events include:

```text
Wishlist Added
Wishlist Removed
Wishlist Product Opened
Wishlist Product Added to Cart
```

These events can provide insight into product intent.

---

## 13. Cart Analytics

Possible cart metrics include:

```text
Add to Cart
Quantity Changes
Item Removal
Cart Abandonment
Checkout Started
```

Cart abandonment definitions must be explicitly documented if implemented.

---

## 14. Delivery Analytics

Delivery analytics may include:

```text
Active Deliveries
Orders by Delivery Status
Delivery Progress
Estimated vs Actual Delivery
```

Location data should not be retained unnecessarily for analytics.

---

## 15. Authentication Analytics

Security-oriented metrics may include high-level events such as:

```text
Successful Login
Failed Login
OTP Requested
OTP Verification Failure
```

Sensitive authentication values must never be stored as analytics data.

---

## 16. Event Tracking

Where event tracking is implemented, events should use consistent names.

Examples:

```text
product.viewed
product.clicked
cart.item_added
cart.item_removed
wishlist.added
search.performed
image_search.completed
recommendation.clicked
checkout.started
order.created
payment.succeeded
delivery.updated
```

The exact event catalog should remain centralized and documented.

---

## 17. Event Data

Events should contain only information required for the metric.

Possible fields:

```text
Event Name
Timestamp
User / Anonymous Reference where appropriate
Product Reference
Order Reference
Category Reference
Context
```

Avoid storing unnecessary personal information.

---

## 18. Privacy

Analytics must follow data minimization.

Do not collect unnecessary:

```text
Passwords
OTP Values
Payment Credentials
JWTs
Refresh Tokens
Raw Card Data
Unnecessary Image Contents
```

Sensitive data must never be used as ordinary analytics payload.

---

## 19. Data Accuracy

Analytics should distinguish between:

```text
Authoritative Business Data
```

and:

```text
Behavioral / Derived Metrics
```

Orders, payments, and inventory should be calculated from authoritative business records.

Analytics events may supplement those records but should not replace them.

---

## 20. Test Mode Consideration

Because Stripe operates in Test Mode:

```text
Payment Metrics
Revenue Metrics
```

represent demonstration/test transactions rather than real commercial revenue.

The admin UI and documentation should make this distinction clear where necessary.

---

## 21. Performance

Analytics queries should avoid unnecessarily scanning large datasets on every dashboard request.

Consider:

- Aggregation queries.
- Appropriate indexes.
- Date-range filtering.
- Pagination for detailed reports.
- Cached aggregates where justified.

Analytics workloads must not degrade core checkout/order performance.

---

## 22. Dashboard

The admin dashboard may display:

```text
Revenue
Orders
Top Products
Popular Categories
Low Stock
Active Deliveries
Recommendation Conversion
Search Trends
```

Charts and tables should follow the approved Figma design.

---

## 23. Filtering

Analytics may support filters such as:

```text
Date Range
Category
Product
Order Status
```

Filter parameters must be validated server-side.

---

## 24. Authorization

Analytics may expose sensitive business information.

Access requires:

```text
Authentication
+
Administrator Authorization
```

Customers must not access administrative analytics.

---

## 25. Error Handling

Analytics failures must not break core commerce workflows.

If an analytics query fails:

```text
Dashboard Error
 ↓
Retry / Partial Dashboard
```

The following must continue to work independently:

```text
Products
Cart
Checkout
Payments
Orders
```

---

## 26. Accessibility

Analytics dashboards must provide:

- Accessible chart alternatives where practical.
- Data tables for important metrics.
- Keyboard navigation.
- Accessible labels.
- Clear headings.
- Non-color-only status indicators.

Important information should remain available without relying solely on visual charts.

---

## 27. Localization and RTL

Analytics UI should support:

```text
English
Arabic / RTL
```

Dates, numbers, currencies, labels, and layouts must follow the localization system.

---

## 28. Testing

Analytics testing should cover:

```text
Revenue Calculation
Order Metrics
Product Metrics
Category Metrics
Inventory Metrics
Search Events
Image Search Events
Recommendation Metrics
Wishlist Events
Cart Events
Delivery Metrics
Date Filtering
Authorization
Empty Dataset
Query Failure
Test-Mode Payment Data
```

Metric definitions should be verified against known test data.

---

## 29. Definition of Done

Analytics are complete when:

- Required business metrics are available.
- Metrics use authoritative data.
- Event tracking works where required.
- Recommendation analytics work where required.
- Search/image-search analytics work where required.
- Admin authorization is enforced.
- Test-mode payment data is correctly represented.
- Analytics failures do not break commerce workflows.
- Performance is acceptable.
- Accessibility is verified.
- Localization/RTL is verified where required.
- Tests pass.
- Documentation matches implementation.

---

## 30. Analytics Principle

> **Analytics should turn reliable application data into actionable insight without becoming a dependency for core commerce operations or collecting unnecessary sensitive information.**
