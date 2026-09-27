# Task 02.5 — Public Product API

## Routes and response contract

| Method | Path | Result |
| --- | --- | --- |
| GET | /api/products | Lightweight active product summaries |
| GET | /api/products/:slug | Active product detail |
| GET | /api/categories | Active category metadata |
| GET | /api/categories/:slug | Active category metadata |
| GET | /api/brands | Brand metadata |
| GET | /api/brands/:slug | Brand metadata |

All endpoints are public/read-only. Lists return { data: [], meta: { page, pageSize, total } }; details return { data }. Page defaults to 1 (maximum 1,000,000), pageSize to 20 (maximum 100). Both accept canonical positive integer query strings only. Unknown query keys, repeated values, search/filter/sort inputs and malformed slugs return 400 VALIDATION_ERROR; no silently ignored filters. Detail requests accept no query parameters. Slugs are lowercase ASCII kebab-case, at most 280 characters for products and 120 for categories/brands. normalizeSlug handles accents/case/punctuation; unique DB constraints reject collisions rather than silently renaming existing identities.

Product ordering is createdAt descending then ID ascending, category/brand ordering name then ID ascending. List/count use one RepeatableRead transaction. Product reads require ACTIVE status and an active category; hidden resources return the same 404 as nonexistent products. Categories expose no nested products. Brand metadata is not conditional on having currently visible products.

Product summaries contain id/name/slug, category and nullable brand summaries, price, nullable compareAtPrice, currency USD, availability and nullable primaryImage. Price/reference price are exact two-decimal strings, never floating-point values. AVAILABLE requires ACTIVE status and positive Inventory quantity; missing Inventory and zero stock are UNAVAILABLE. Internal inventory quantity/status and auth/customer data are not returned. compareAtPrice must be at least price in curated validation; future write APIs must reuse validation.

Detail adds description (nullable), SKU, modelNumber (nullable), images and specifications. Images order primary-first, sortOrder ascending, ID ascending; legacy position is mapped to sortOrder without changing stored positions. Specifications are groups: [{ group, items: [{ id, group, name, value, sortOrder }] }], ordered by group then sortOrder then ID. Lists include only one primary image and omit the gallery/specifications/description. No fake primary image is invented when legacy media is absent.

Errors follow existing { error: { code, message } }: 400 VALIDATION_ERROR; 404 PRODUCT_NOT_FOUND/CATEGORY_NOT_FOUND/BRAND_NOT_FOUND; unexpected 500 INTERNAL_SERVER_ERROR with generic sanitized message. No Prisma/SQL/stack data appears in API responses. No auth or commerce API behavior changed.

OpenAPI: /api/openapi.json and /api/docs, Products tag. Frontend contracts: apps/frontend/src/features/products/types.ts. Existing numeric ProductCard presentation props remain unchanged because no API consumer wiring is part of this task. A future adapter must handle decimal strings deliberately rather than implicitly changing existing UI contracts.

Brand is mandatory for all new/curated 02.5 products, while legacy rows without verifiable manufacturer data remain nullable until safely reconciled.

## Verification boundary

Service/database mocks and Express API tests verify contracts without shared DB writes. Schema validate/generate and offline migration diff do not prove physical schema, SQL execution, query plans or shared seed state. Gated DEV constraint tests and real database-backed reads are deferred to [Gemini handoff](../06_Database/PRODUCT_FOUNDATION_HANDOFF.md).
