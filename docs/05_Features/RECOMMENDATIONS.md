# Recommendations

> **Implemented in Task 04.4 (branch `feature/04.4-ml-powered-recommendations`).** The sections after "Implemented
> behaviour" are the original Phase 00 planning baseline; where they differ, this section and the code are authoritative.
> Algorithm, signals and evaluation: [`07_AI/RECOMMENDER.md`](../07_AI/RECOMMENDER.md).

## Implemented behaviour (Task 04.4)

| Rail | Where | Strategy (server `strategy`) | Shown when |
|---|---|---|---|
| Similar Products | Product detail | `EMBEDDING_SIMILARITY` (D3 SigLIP2 centroids + pgvector) | AI ready; otherwise `FALLBACK_CATEGORY` titled "More in {category}" with a "View category" link |
| You May Also Like | Product detail | `HYBRID_EMBEDDING` (deeper D3 pool, excludes Similar ids, category-diversified) | AI ready and at least 2 items |
| Frequently Bought Together | Product detail, Cart | `CO_PURCHASE` | At least 2 distinct qualifying orders contain the pair; otherwise `NO_DATA` and the rail is hidden |
| Recommended for You | Home (signed-in customers) | `BEHAVIOR_EMBEDDING` | Consent on and profile evidence ≥ 2 products and weight ≥ 3; otherwise hidden (`isPersonalized: false`) |
| Popular Products | Home | `MEASURED_POPULARITY` | ≥ 3 distinct contributing users in 30 days; the `FALLBACK_NEW_ARRIVALS` answer is not shown on Home (it would duplicate New Arrivals) |
| Recently Viewed | Account | Customer's own history (not a recommendation) | Consent on |

Every rail reuses the store `ProductCard` (same cart, wishlist and navigation), is a semantic `<section aria-labelledby>`
grid (no carousel), shows skeletons only while nothing is loaded, and is hidden rather than showing "no results".
Failures never block the page, cart or checkout.

### API (Express)

| Method and path | Access | Notes |
|---|---|---|
| `GET /api/products/:slug/recommendations?limit=1..12` | Public | `{ sections: [SIMILAR, YOU_MAY_ALSO_LIKE, FBT] }`, deduplicated across sections, `Cache-Control: private, no-store` to protect per-response attribution batches, 120/min |
| `GET /api/recommendations/popular` | Public | Measured popularity or honest new-arrivals fallback; `Cache-Control: private, no-store` because the response carries a per-response attribution token |
| `POST /api/recommendations/cart` | Public | `{ productIds ≤ 50, limit }`; ids are context only, cart is never mutated; `Cache-Control: private, no-store` |
| `POST /api/recommendations/events` | Public | `{ token, events ≤ 24 }` IMPRESSION/CLICK; HMAC token issued per section; no user id stored; `202` |
| `GET /api/me/recommendations` | CUSTOMER | Personal rail or fallback; `private, no-store` |
| `GET/PATCH /api/me/recommendation-preferences` | CUSTOMER | Opt-in (default off). Turning off deletes interactions and recently viewed |
| `GET/DELETE /api/me/recently-viewed` | CUSTOMER | Clear deletes the list and its VIEW events |
| `DELETE /api/me/recently-viewed/:productId` | CUSTOMER | Idempotently removes that customer's item and its VIEW events; other signals remain |
| `POST /api/product-interactions` | CUSTOMER | VIEW / RECOMMENDATION_CLICK, idempotent key; ignored (200) without consent, 201 when recorded |

All AI ids are re-hydrated through the public catalog projection (active, storefront-visible, non-fixture, current
price and stock). Clients never send user ids, prices, weights or strategy.

### Privacy

- Personalization is explicit opt-in; nothing behavioural is stored for anonymous visitors or without consent.
- Wishlist, cart and paid-order signals are read in place (no copies) and only for the signed-in user's own profile.
- Retention: interactions 90 days (reads filter, hourly purge); recently viewed capped at 20 per user.
- Account deletion removes preferences, interactions and recently viewed in the deletion transaction.
- FastAPI receives only product ids and normalised weights (`profile-v1`); no user ids, emails or orders.
- Two-horizon profile: the long-horizon profile (all signals, 14-day half-life) is ranked as before. Products browsed in the
  last 3 days (views and recommendation clicks, 1-day half-life) form a second, short-horizon profile, ranked concurrently
  with every profile product excluded. Two or three recently browsed products earn one rail slot and four or more earn two;
  these slots are positions 2 and 4. A single accidental view earns nothing, long-term interests always keep position 1 and
  at least half the rail, and a failed recent ranking only drops its slots.
- `recommendation_events` stores batch, product, mode, strategy, surface and rank only.

### Configuration

| Variable | Service | Default |
|---|---|---|
| `AI_RECOMMENDATIONS_ENABLED` | FastAPI | `true` |
| `AI_RECOMMENDATION_TIMEOUT_MS` | Express | `4000` (100–10000) |

The impression-token key is derived from the existing `JWT_SECRET`; no new secret.

---

## 1. Purpose

The Recommendation System provides personalized and contextual product suggestions throughout ElectroHub.

Recommendation experiences include:

```text
Recommended for You
You May Also Like
Frequently Bought Together
Similar Products
Popular Products
```

The system is designed to demonstrate intelligent product discovery while remaining practical for a portfolio project.

---

## 2. Recommendation Architecture

```text
User Behavior / Product Context
            ↓
       Backend API
            ↓
   Recommendation Logic
            ↓
     Optional AI Service
            ↓
      Product References
            ↓
       Product Database
            ↓
       React Frontend
```

The backend remains responsible for validating and returning authoritative product data.

---

## 3. Recommendation Modes

The system may support multiple recommendation strategies.

### Popular Items

Based on aggregate product activity.

Possible signals:

```text
Views
Clicks
Purchases
```

### Similar Category

Products are recommended based on category and related product metadata.

### Purchase History

Recommendations may use a customer's previous purchases.

### Similar Products

Products with related:

```text
Category
Brand
Specifications
Tags
```

may be recommended.

### Frequently Bought Together

Products that commonly appear in the same completed orders may be recommended together.

---

## 4. User Workflow

```text
User Browses Product
        ↓
Behavior / Context Captured
        ↓
Recommendation Request
        ↓
Recommendation Logic
        ↓
Recommended Product IDs
        ↓
Backend Product Resolution
        ↓
Recommendation Section
```

The user can select a recommendation and open the normal product details page.

---

## 5. Behavior Signals

The system may track:

```text
Product Views
Product Clicks
Searches
Wishlist Actions
Cart Actions
Purchases
```

Only behavior required for the recommendation strategy should be collected.

---

## 6. Recommendation Quality

The project may demonstrate recommendation improvement over time.

Example:

```text
User Views Gaming Laptops
        ↓
Gaming Laptop Recommendations

User Purchases Gaming Laptop
        ↓
Accessory Recommendations

User Repeatedly Views Monitors
        ↓
Monitor Recommendations
```

The behavior does not need to represent a production-scale machine-learning system unless explicitly implemented.

---

## 7. Simulated Recommendation Mode

For academic or portfolio demonstration, recommendations may be simulated using deterministic rules.

Example:

```text
User Category Interest
        ↓
Category Score
        ↓
Related Products
        ↓
Recommendation Ranking
```

If simulated logic is used, documentation must clearly identify it as rule-based/simulated rather than claiming production ML.

---

## 8. AI Recommendation Mode

If the FastAPI AI service is used, the flow may be:

```text
Frontend
 ↓
Backend
 ↓
FastAPI
 ↓
Recommendation Processing
 ↓
Product References
 ↓
Backend
 ↓
Product Records
 ↓
Frontend
```

The AI service should return references or recommendation scores rather than owning commerce data.

---

## 9. Recommendation API

A typical endpoint may be:

```text
GET /api/recommendations
```

Context may optionally be provided:

```text
GET /api/recommendations?productId=product-123
```

Additional recommendation context should only be accepted when explicitly supported by the API contract.

---

## 10. Recommendation Types

The API or service layer should distinguish recommendation contexts where necessary.

Examples:

```text
personalized
similar
frequently_bought
popular
category_based
```

This makes recommendation behavior explicit and testable.

---

## 11. Product Resolution

Recommendation logic should preferably return product references.

```text
Recommendation Engine
 ↓
Product IDs
 ↓
Backend
 ↓
Prisma
 ↓
Current Product Data
 ↓
Frontend
```

This prevents stale or unauthorized product information from being exposed.

---

## 12. Inventory Awareness

Recommendations should consider product availability where appropriate.

Out-of-stock products should not normally be prioritized as purchasable recommendations.

The final checkout availability is always validated server-side.

---

## 13. Recommendation Ranking

Results may be ranked using signals such as:

```text
Relevance
Popularity
Category Similarity
User Interest
Purchase History
Availability
```

The ranking strategy should remain documented and deterministic when a simulated implementation is used.

---

## 14. Admin Workflow

Administrators may configure recommendation behavior.

Possible settings include:

```text
Popular Items
Similar Category
Purchase History
Frequently Bought Together
```

Administrators may also:

- Pin featured products.
- Review recommendation statistics.
- Review most recommended products.
- Review recommendation conversions.

All administrative actions require server-side authorization.

---

## 15. Recommendation Analytics

The system may track:

```text
Recommendation Impressions
Recommendation Clicks
Product Conversions
Recommendation Conversion Rate
Most Recommended Products
```

A basic conversion flow can be:

```text
Recommendation Shown
        ↓
Recommendation Clicked
        ↓
Product Viewed
        ↓
Added to Cart
        ↓
Purchased
```

Analytics must use appropriate privacy and data-minimization practices.

---

## 16. React Query

Recommendation data is server state and should use React Query.

Example query key:

```ts
["recommendations", recommendationType, productId]
```

Caching should reflect the freshness requirements of recommendation data.

---

## 17. Loading State

Recommendation sections should not create poor page experiences while waiting for data.

Possible states:

```text
Skeleton
Loading Placeholder
Hidden Until Ready
```

The appropriate strategy should follow the approved UI design.

---

## 18. Error Handling

Recommendation failure should degrade gracefully.

Example:

```text
Recommendations temporarily unavailable.
```

Core product browsing must continue to work.

An unavailable recommendation service must not prevent:

```text
Product Viewing
Cart
Checkout
Orders
```

---

## 19. Empty State

If no recommendations exist:

```text
No recommendations available yet.
```

The UI may hide the section entirely when an empty recommendation section adds no value.

---

## 20. Performance

Recommendation requests should avoid excessive computation.

Consider:

- React Query caching.
- Limited result counts.
- Backend caching where appropriate.
- Precomputed aggregates for expensive strategies.
- Avoiding recalculation on every render.

AI processing should have timeouts and resource limits.

---

## 21. AI Service Failure

If FastAPI is unavailable:

```text
AI Recommendation Request
        ↓
Failure / Timeout
        ↓
Fallback Recommendation Strategy
```

Where practical, the system may fall back to simpler logic such as:

```text
Popular Products
Category-Based Products
```

AI availability should not become a single point of failure for core commerce.

---

## 22. Privacy

Recommendation behavior should follow data minimization.

Avoid collecting unnecessary personal information.

Behavioral data should have a defined purpose.

Sensitive information must not be used as recommendation input without an explicit approved requirement.

---

## 23. Security

Recommendation endpoints must:

- Validate query parameters.
- Respect authentication state.
- Enforce administrative authorization for configuration.
- Prevent unauthorized access to user-specific recommendation data.
- Avoid exposing private behavioral information.

---

## 24. Localization and RTL

Recommendation UI must support:

```text
English
Arabic / RTL
```

Product information and recommendation labels should be localized where appropriate.

The layout must remain correct in RTL mode.

---

## 25. Testing

Recommendation testing should cover:

```text
Popular Recommendations
Category Recommendations
Similar Products
Purchase-Based Recommendations
Frequently Bought Together
Personalized Recommendations
Empty Results
Invalid Context
AI Service Failure
Fallback Logic
Inventory Availability
Admin Configuration
Authorization
Analytics Events
```

Critical recommendation display and interaction flows should be covered by E2E tests where appropriate.

---

## 26. Definition of Done

Recommendations are complete when:

- Recommendation sections are implemented.
- At least the approved recommendation strategies work.
- Product references are resolved by the backend.
- Inventory availability is respected.
- Personalized behavior works where required.
- Simulated logic is clearly documented if used.
- AI integration works where required.
- AI failure has graceful handling.
- Admin configuration is secured.
- Analytics are implemented where required.
- Loading/error/empty states exist.
- Accessibility and RTL are verified.
- Performance is acceptable.
- Tests pass.
- Documentation matches the implementation.

---

## 27. Recommendation Principle

> **Recommendations should improve product discovery without becoming a dependency for core commerce functionality, and every recommendation must ultimately resolve to authoritative backend product data.**
