# Performance

## 1. Purpose

This document defines the performance standards for ElectroHub.

The goal is to keep the application:

- Fast.
- Responsive.
- Efficient.
- Scalable.
- Reliable under realistic usage.

Performance decisions should be based on measurable evidence rather than assumptions.

---

## 2. Performance Principles

The application should prioritize:

- Fast initial rendering.
- Efficient API requests.
- Efficient database queries.
- Optimized images.
- Minimal unnecessary JavaScript.
- Responsive interactions.
- Efficient caching.
- Controlled resource usage.

Avoid premature optimization.

---

## 3. Performance Targets

Performance should be evaluated using:

```text
Lighthouse
Core Web Vitals
Browser DevTools
Network analysis
Backend metrics
Database query performance
Bundle analysis
```

Targets should be defined and verified during QA and final release validation.

---

## 4. Frontend Performance

The React frontend should minimize unnecessary work.

Consider:

- Code splitting.
- Lazy loading.
- Route-level loading.
- Efficient component rendering.
- Appropriate React Query caching.
- Optimized images.
- Virtualization for very large lists.
- Avoiding unnecessary dependencies.

---

## 5. Code Splitting

Large application areas should be loaded only when required.

Examples:

```text
Admin
Checkout
Image Search
Order Tracking
```

Route-level lazy loading should be considered for substantial feature areas.

---

## 6. React Rendering

Components should avoid unnecessary re-renders.

Use:

- Appropriate component boundaries.
- Stable props where useful.
- Derived values instead of duplicated state.
- Memoization only when profiling shows a benefit.

Do not add `memo`, `useMemo`, or `useCallback` everywhere without evidence.

---

## 7. React Query Performance

React Query should be configured to reduce unnecessary requests.

Consider:

- Query caching.
- Appropriate stale times.
- Query invalidation.
- Pagination.
- Prefetching where useful.
- Avoiding duplicate queries.

Cache settings should reflect how frequently the underlying data changes.

---

## 8. API Performance

Backend endpoints should:

- Return only required data.
- Avoid unnecessary processing.
- Support pagination for large collections.
- Use efficient queries.
- Avoid repeated external calls.
- Use appropriate caching where justified.

Avoid returning unbounded datasets.

---

## 9. Database Performance

Prisma queries should be reviewed for:

- N+1 queries.
- Missing indexes.
- Unnecessary joins/includes.
- Large result sets.
- Repeated queries.
- Inefficient filtering.
- Unnecessary database round trips.

Use indexes for frequently queried fields where justified by access patterns.

---

## 10. Transactions

Transactions should remain focused.

Avoid keeping database transactions open while waiting for slow external services.

For example:

```text
Database Transaction
        ↓
Database Operations
        ↓
Commit
        ↓
External Notification
```

Do not hold a database transaction open while waiting for Brevo, Stripe, Cloudinary, or FastAPI unless there is a specific architectural reason.

---

## 11. Pagination

Large collections should use pagination.

Important examples:

```text
Products
Orders
Admin Users
Admin Orders
Analytics
Search Results
```

Pagination protects both database and frontend performance.

---

## 12. Search Performance

Search should:

- Use indexed/query-appropriate fields.
- Limit result sizes.
- Support pagination.
- Avoid unnecessary full-dataset retrieval.
- Debounce client-side search input where appropriate.

Search-by-image should also enforce file-size and processing limits.

---

## 13. Image Performance

Product images are served through Cloudinary where appropriate.

Images should be:

- Optimized.
- Responsive.
- Appropriately sized.
- Lazy-loaded when below the fold.
- Served in efficient formats where supported.

Avoid loading full-resolution assets when a smaller variant is sufficient.

---

## 14. Image Search Performance

Search-by-image should protect system resources.

Consider:

```text
File Size Limit
Image Dimension Limit
Request Timeout
Processing Timeout
Result Limit
Rate Limiting
```

Large or invalid uploads should fail early.

---

## 15. AI Performance

FastAPI AI operations should have controlled execution time.

The backend should handle:

```text
AI Timeout
AI Service Unavailable
Slow Processing
Invalid Response
```

AI functionality should not unnecessarily block unrelated core commerce operations.

---

## 16. Recommendation Performance

Recommendations should avoid expensive recalculation on every UI render.

Prefer:

```text
Backend / AI
 ↓
Recommendation Result
 ↓
React Query Cache
 ↓
UI
```

Where appropriate, recommendation results may be cached according to their freshness requirements.

---

## 17. API and External Service Calls

External integrations include:

```text
Stripe
Brevo
Cloudinary
FastAPI
```

Calls should use:

- Timeouts.
- Appropriate retry behavior.
- Idempotency where required.
- Connection reuse where supported.
- Clear failure handling.

Do not retry non-idempotent operations blindly.

---

## 18. Real-Time Performance

Socket.IO delivery updates should send only relevant events.

Prefer:

```text
Delivery Update
 ↓
Relevant Order / User
 ↓
Socket Event
```

Avoid broadcasting sensitive or irrelevant data to all connected clients.

---

## 19. Map Performance

Leaflet maps should avoid unnecessary rendering.

Consider:

- Loading maps only when required.
- Limiting markers.
- Updating only changed delivery data.
- Avoiding unnecessary route redraws.
- Efficient viewport updates.

---

## 20. PDF Generation

PDF generation should not unnecessarily block critical request paths.

For larger documents or expensive generation, consider asynchronous processing where justified.

Generated documents should be cached or reused when appropriate rather than regenerated unnecessarily.

---

## 21. Email Performance

Brevo email delivery should not unnecessarily delay successful business operations.

For example:

```text
Order Created
 ↓
Order State Persisted
 ↓
Email Notification
```

Email failure should be handled separately from authoritative order state.

---

## 22. Bundle Performance

The production frontend bundle should be reviewed before release.

Analyze:

```text
JavaScript
CSS
Images
Dependencies
Chunk Sizes
Duplicate Packages
```

Remove unnecessary dependencies and avoid importing entire libraries when smaller imports are available.

---

## 23. Dependency Performance

Before adding a dependency, consider:

- Bundle size.
- Runtime cost.
- Maintenance status.
- Existing project alternatives.
- Whether the functionality can be implemented simply without it.

Avoid dependencies that provide trivial functionality at significant cost.

---

## 24. CSS Performance

SCSS/CSS should avoid:

- Excessive selector complexity.
- Large duplicated styles.
- Unnecessary global rules.
- Expensive animations.

Prefer transform/opacity for animations where appropriate.

---

## 25. Animation Performance

Animations should remain smooth and purposeful.

Prefer GPU-friendly properties such as:

```text
transform
opacity
```

Avoid animating layout-heavy properties unnecessarily.

Respect:

```text
prefers-reduced-motion
```

---

## 26. Network Performance

Reduce unnecessary network requests through:

- Caching.
- Request deduplication.
- Pagination.
- Prefetching where justified.
- Appropriate payload sizes.
- Lazy loading.

Avoid fetching data that is not required for the current user experience.

---

## 27. Caching

Caching may be used at appropriate layers:

```text
Browser
React Query
Backend
Database
CDN / Cloudinary
```

Cached data must not become a source of incorrect authoritative business state.

Payment, order, inventory, and authorization decisions must remain server-authoritative.

---

## 28. Backend Scalability

The backend should remain stateless where practical.

Persistent state belongs in appropriate external systems such as:

```text
Supabase PostgreSQL
```

This supports horizontal scaling if required in the future.

---

## 29. VPS Resource Awareness

Production deployment uses a DigitalOcean Ubuntu VPS.

The system should monitor:

```text
CPU
Memory
Disk
Network
Docker container usage
```

Resource-intensive AI or PDF operations should be monitored carefully on limited VPS resources.

---

## 30. Performance Testing

Performance verification should include:

```text
Lighthouse
Core Web Vitals
Bundle Analysis
API Response Times
Database Query Performance
Image Loading
E2E User Journeys
Mobile Viewports
```

Testing should represent realistic application behavior.

---

## 31. Performance Regression

Performance-sensitive changes should be reviewed for regressions.

Examples:

```text
New dependency
Large component
New API request
Database relation/include
Image processing
AI processing
PDF generation
Admin table
```

Performance should be rechecked when a change materially affects resource usage.

---

## 32. Production Readiness

Before release, verify:

- Production build succeeds.
- Bundle size is reviewed.
- Lighthouse results are acceptable.
- Core Web Vitals are checked.
- No obvious performance regressions exist.
- API performance is acceptable.
- Database queries are reviewed.
- Images are optimized.
- Resource usage is monitored.

---

## 33. Performance Principle

> **Optimize measurable bottlenecks, keep critical paths lightweight, and protect both client and server resources as the application scales.**
