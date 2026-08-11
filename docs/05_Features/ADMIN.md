# Admin

## 1. Purpose

This document defines the administrative platform for ElectroHub.

The admin interface allows authorized administrators to manage and monitor core commerce operations.

Administrative capabilities include:

- Products.
- Categories.
- Inventory.
- Orders.
- Delivery.
- Payments.
- Analytics.
- Recommendation configuration.
- Product image metadata.

---

## 2. Admin Architecture

```text
Administrator
 ↓
React Admin Interface
 ↓
Protected Backend API
 ↓
Authorization
 ↓
Service Layer
 ↓
Prisma
 ↓
Supabase PostgreSQL
```

The frontend provides the administrative interface.

The backend enforces all administrative permissions.

---

## 3. Administrator Authentication

Administrative access requires authentication.

The backend must verify:

```text
Authenticated User
+
Administrator Role
```

Frontend route protection improves UX but is not a security boundary.

---

## 4. Role-Based Access Control

At minimum, the system distinguishes:

```text
Customer
Administrator
```

Only authorized administrator accounts may perform administrative operations.

Future role expansion may be introduced through an explicit architectural decision.

---

## 5. Admin Dashboard

The dashboard may provide high-level information such as:

```text
Orders
Revenue
Products
Inventory
Low-Stock Products
Active Deliveries
Payment Status
Recommendation Metrics
```

Dashboard values must come from authoritative backend data.

---

## 6. Product Management

Administrators can manage products.

Operations may include:

```text
Create
View
Update
Archive / Delete where permitted
```

Product management includes:

- Name.
- Description.
- Price.
- Category.
- Images.
- Specifications.
- Availability.
- Inventory.

See `PRODUCTS.md`.

---

## 7. Category Management

Administrators can manage product categories.

Operations may include:

```text
Create Category
Update Category
Archive Category
View Categories
```

Category changes must preserve product relationships.

See `CATEGORIES.md`.

---

## 8. Inventory Management

Administrators can:

- View inventory.
- Update quantities.
- Restock products.
- Review low-stock products.
- Review out-of-stock products.

Inventory updates must be validated server-side.

See `INVENTORY.md`.

---

## 9. Order Management

Administrators can:

- View orders.
- Open order details.
- Review payment status.
- Update order status.
- Review customer/order information according to permissions.

Supported order states:

```text
Confirmed
Preparing
Out for Delivery
Delivered
```

See `ORDERS.md`.

---

## 10. Delivery Management

Administrators can manage active delivery progress.

Possible operations include:

```text
Update Delivery Status
Update Delivery Location
Update Estimated Arrival
Monitor Active Deliveries
```

Changes may be delivered to customers in real time through Socket.IO.

See `DELIVERY_TRACKING.md`.

---

## 11. Payment Visibility

Administrators may view authorized payment information such as:

```text
Payment Status
Order Number
Payment Reference
Payment Date
Amount
```

Sensitive payment credentials must never be exposed.

The admin interface must not display raw card information.

---

## 12. Recommendation Management

Administrators may configure the approved recommendation strategy.

Possible modes include:

```text
Popular Items
Similar Category
Purchase History
Frequently Bought Together
```

Administrators may also:

- Pin featured products.
- Review recommendation statistics.
- Review recommended products.

See `RECOMMENDATIONS.md`.

---

## 13. Image Search Management

Administrators may support image-search quality by managing:

```text
Product Images
Image Metadata
Product Tags
Search Success Logs
```

Administrative image operations must be authorized and validated.

See `IMAGE_SEARCH.md`.

---

## 14. Analytics

The admin interface may expose analytics for:

```text
Revenue
Orders
Products
Categories
Inventory
Recommendations
Search
Wishlist
Cart
```

Analytics must be calculated from authoritative application data.

See `ANALYTICS.md`.

---

## 15. Admin Tables

Large administrative datasets should use TanStack Table where appropriate.

Examples:

```text
Products
Orders
Inventory
Users
Analytics
```

Tables should support appropriate:

- Pagination.
- Sorting.
- Filtering.
- Loading states.
- Empty states.
- Error states.

---

## 16. Admin Forms

Administrative forms use the project's approved form-validation architecture.

Where appropriate:

```text
React Hook Form
+
Zod
```

The backend must repeat critical validation.

---

## 17. Admin Search

Administrative search may support:

```text
Products
Orders
Inventory
```

Admin search endpoints remain protected.

Search parameters must be validated and constrained.

---

## 18. Admin Authorization

Every administrative mutation must be authorized server-side.

Examples:

```text
Create Product
Update Product
Update Inventory
Update Order
Update Delivery
Configure Recommendations
```

A user must not gain administrative access by modifying frontend routes or API requests.

---

## 19. Auditability

Important administrative changes should be traceable where appropriate.

Potential audit information includes:

```text
Administrator
Action
Target Resource
Previous State
New State
Timestamp
```

The exact audit scope follows the security and operations architecture.

---

## 20. Real-Time Admin Information

Socket.IO may be used for relevant operational updates.

Examples:

```text
New Order
Delivery Update
Inventory Warning
```

Real-time information should remain scoped to authorized administrative clients.

---

## 21. Admin Error Handling

Administrative errors should distinguish:

```text
Validation Error
Unauthorized
Forbidden
Not Found
Conflict
Server Failure
```

Production responses must not expose database errors or internal stack traces.

---

## 22. Admin Security

Administrative functionality requires:

- Authentication.
- Role-based authorization.
- Resource authorization.
- Input validation.
- Rate limiting where appropriate.
- Secure error handling.
- Protected sessions/tokens.
- No secrets in frontend code.

Administrative APIs are high-value security targets and require stronger scrutiny.

---

## 23. Admin Performance

Admin interfaces should use:

- Pagination.
- Server-side filtering where appropriate.
- Efficient database queries.
- Lazy loading for large sections.
- TanStack Table for large datasets.
- React Query caching where appropriate.

Do not load entire datasets into the browser unnecessarily.

---

## 24. Accessibility

The admin interface must support:

- Keyboard navigation.
- Accessible tables.
- Form labels.
- Visible focus.
- Screen-reader-friendly status messages.
- Accessible dialogs.
- Clear validation errors.

Status must not rely only on color.

---

## 25. Responsive Design

The administrative interface should support:

```text
Desktop
Tablet
Mobile where practical
```

Complex data tables may use an approved responsive strategy rather than forcing unreadable layouts onto small screens.

---

## 26. Localization and RTL

The admin interface should support:

```text
English
Arabic / RTL
```

Where localization is included in the approved project scope.

Layout should use logical directional properties.

---

## 27. API

Typical administrative endpoints include:

```text
/api/admin/products
/api/admin/categories
/api/admin/inventory
/api/admin/orders
/api/admin/delivery
/api/admin/analytics
```

The exact endpoints and permissions follow the backend implementation.

---

## 28. Testing

Admin testing should cover:

```text
Admin Login
Customer Cannot Access Admin
Product Management
Category Management
Inventory Management
Order Management
Delivery Management
Payment Visibility
Recommendation Configuration
Image Search Management
Analytics
Table Pagination
Authorization
Validation
Unauthorized API Requests
```

Critical administrative workflows should be covered by E2E tests.

---

## 29. Definition of Done

Admin functionality is complete when:

- Administrator authentication works.
- Role-based authorization works.
- Product management works.
- Category management works.
- Inventory management works.
- Order management works.
- Delivery management works.
- Authorized payment information is visible.
- Recommendation configuration works where required.
- Image-search administration works where required.
- Analytics are available where required.
- Large datasets are handled efficiently.
- Security controls are enforced server-side.
- Accessibility is verified.
- Responsive behavior is verified.
- RTL/localization is verified where required.
- Tests pass.
- Documentation matches implementation.

---

## 30. Admin Principle

> **The admin interface is an operational control surface, but every administrative permission and mutation must be enforced by the backend rather than trusted to the frontend.**
