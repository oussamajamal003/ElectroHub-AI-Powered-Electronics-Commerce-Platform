# Task 03.3 — Wishlist database handoff

Existing `Wishlist` and `WishlistItem` models and foundation migration are reused unchanged. No schema change, migration, seed, dependency, or direct database operation was performed.

The API uses principal-scoped customer ownership, existing unique `(wishlistId, productId)` rows, Serializable transactions and bounded retries. Reconciliation is SET UNION, not Cart's maximum quantity rule. Collections are limited to 50 distinct Products. Current public summaries and grouped Review aggregates are hydrated in bulk; inactive metadata is not exposed. No Cart or Inventory writes/reservations occur.

Gemini live verification remains separate: authenticate a dedicated DEV customer through the normal application, save/remove/refresh, retry union reconciliation, validate another customer's isolation, and verify persistence plus inactive/out-of-stock handling. Inspect existing physical constraints before reporting DB verification. Do not apply a new Wishlist migration or seed: none is needed by this implementation. PROD writes/seeds are not authorized.

Local unit/API tests use mocked database/auth boundaries. Browser lifecycle tests intercept API responses. These do not prove hosted database persistence, RLS, or concurrency. The separate non-intercepted localhost smoke covers guest hydration and persistence; authenticated live persistence requires an approved test account.
