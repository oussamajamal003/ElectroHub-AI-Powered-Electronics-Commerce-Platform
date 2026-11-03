# Task 05.1 — Implementation plan, contracts and invariants (M0)

Branch: `feature/05.1-admin-dashboard`. The baseline is `origin/develop` at 43d1c57, which already contains the merged 04.7 work (3776679).
Owner override for this run: **no commit, no push, no merge, no deploy**. Every change is left uncommitted in the working tree for owner review.

## 1. What existed before 05.1 (reused, not replaced)

| Capability | Existing implementation | 05.1 use |
|---|---|---|
| Auth, roles, sessions | `requireAuth` re-reads the user and role from the database on every request and rejects inactive users. `requireRole`, `AuthContext.logout()` clears the query cache. | Every new route uses `requireAuth` + `requireRole('ADMIN')`. Logout comes from the profile menu. |
| Stock writes | `InventoryService.setStock / increaseStock(productId, qty, tx)`: row lock, checked update, `deriveStockStatus`. | The only path admin stock changes take. |
| Delivery / fulfillment | `DeliveryService` (04.5–04.7), `/api/admin/orders/:ref/delivery` start/advance, NEXT map, payment eligibility, revision. | The order detail page calls the same API through `useAdminDeliveryMutations`. No second state machine. |
| Product media | 04.3 `/api/admin/products[/:id]/images` and `AdminProductMediaPage`. | Linked from product rows and the edit page. Untouched. |
| Account lifecycle | `lockUserTokenLifecycle` advisory lock, refresh-token revocation, `DeliveryPublisher.disconnectUser`. Deletion anonymizes the account (`deleted-<id>@deleted.invalid`). | Customer deactivation uses the same lock, revocation and socket close. |
| UI primitives | DataTable, Dialog, Drawer, DropdownMenu, Select, Input, Textarea, Tooltip, Toast, Breadcrumb, Button. SCSS tokens with radius 0. | Reused. DataTable gained additive `sortKey` / `aria-sort` / `caption` / `loadingRows`. Tooltip gained an additive `side` prop. |

## 2. Contract decisions

- **No Prisma migration.** The existing schema already covers archive (`Product.status`), category visibility (`Category.isActive`), stock (`Inventory.quantity/lowStockAt/status`), account state (`User.isActive`) and delivery revision. Audit events are sanitized `logSafely` entries (identifiers, quantities and flags only). No audit table and no new `SecurityEvent` enum value were added. A durable audit ledger is left for an Architect decision.
- **One router** for all new endpoints: `apps/backend/src/routes/admin.routes.ts`, mounted after the delivery admin router.
  - Guard: `requireAuth` → `requireRole('ADMIN')` → `Cache-Control: private, no-store`.
  - Writes are limited to 60 per minute per admin.
  - `/admin/orders` and `/admin/orders/:ref` are matched by an exact regex, so `/admin/orders/:ref/delivery[...]` stays with the 04.5 router.
- **Catalog CRUD lives at `/api/admin/catalog/products`** because `GET /api/admin/products[/:id]` already belongs to the 04.3 media API.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/dashboard/overview?days=7\|30\|90` | KPIs, revenue series, orders by status, stock attention, recent orders |
| GET | `/api/admin/dashboard/alerts` | Header alert counts |
| GET | `/api/admin/catalog/options` | Categories (with `isActive`) + brands for forms |
| GET/POST | `/api/admin/catalog/products` | List (q, status, stock, categoryId, sort, page) / create (draft by default + inventory row) |
| GET/PATCH | `/api/admin/catalog/products/:id` | Detail with specifications / update (`expectedUpdatedAt`) |
| PATCH | `/api/admin/catalog/products/:id/status` | Archive (INACTIVE) / reactivate |
| GET/POST | `/api/admin/categories` | List with product counts + summary / create (hidden by default) |
| PATCH | `/api/admin/categories/:id`, `/:id/status` | Edit (slug immutable) / show-hide |
| DELETE | `/api/admin/categories/:id` | Only when no product references it (409 `CATEGORY_IN_USE`) |
| GET | `/api/admin/inventory` | Stock rows + summary |
| POST | `/api/admin/inventory/:productId/adjustments` | `{operation: RESTOCK\|SET, quantity, expectedQuantity, reason?}` |
| PATCH | `/api/admin/inventory/:productId/threshold` | `{lowStockAt, expectedLowStockAt}` |
| GET | `/api/admin/orders`, `/api/admin/orders/:orderReference` | Read projections. Payment is read-only. |
| GET | `/api/admin/customers`, `/api/admin/customers/:userId` | CUSTOMER role only, allowlisted fields |
| PATCH | `/api/admin/customers/:userId/status` | Deactivate / reactivate (`expectedUpdatedAt`) |

Envelopes:
- List: `{ data, meta: { page, pageSize, total, totalPages, ...summary } }`.
- Item: `{ data }`.
- Error: `{ error: { code, message, fields? } }`.
- Inventory conflict: `{ error, data: currentRow }`.

## 3. Invariants

1. **Server authority.** ADMIN is enforced server-side from the database role on every request. Every body is `.strict()`, so `role`, `isTestFixture`, payment state, revision and actor are rejected. Every list query is whitelisted (no client `where`/`orderBy`).
2. **No silent overwrite.** Product, category and customer writes carry `expectedUpdatedAt` and use `updateMany … where updatedAt`, returning 409 `*_CONFLICT`. Inventory writes carry `expectedQuantity`, which is compared under `SELECT … FOR UPDATE`. A resubmitted restock or a concurrent sale is a 409 that returns the current row, never a double apply.
3. **Stock changes only through `InventoryService`.** This is the same path checkout and payment compensation use. A missing inventory row can be created only by an absolute SET.
4. **No hard delete of commercial history.**
   - Products are archived (status INACTIVE) and reactivated.
   - Order items keep their purchase-time snapshots.
   - A category is deleted only when no product, including QA fixtures, references it. Otherwise it is hidden.
5. **Visibility coherence.**
   - A product cannot be activated, created as active, or moved into a hidden category (409 `CATEGORY_INACTIVE`).
   - Hiding a category hides its products from the storefront (`publicProductWhere`) without archiving them.
6. **Payment is read-only.**
   - Payment state comes only from verified Stripe events.
   - The console never offers mark-as-paid, refund or cancel.
   - Fulfillment actions call the existing delivery API, which re-checks eligibility, transition and revision.
7. **Customer safety.**
   - No role changes.
   - An admin cannot change their own status.
   - Anonymized (deleted) accounts can never be reactivated, and their name and email are nulled in projections.
   - Deactivation runs in one transaction (lifecycle lock, `isActive=false`, refresh-token revocation), and sockets are closed after commit.
   - Order history is untouched.
8. **Truthful numbers.**
   - Revenue is the amount of SUCCEEDED payments by `paidAt`, in UTC days, per currency, never summed across currencies. A refunded payment changes to REFUNDED and leaves the total, so the figure excludes refunded payments; it is labelled that way in the UI.
   - Empty days are shown as zero.
   - No growth percentages, fake charts or unread counters.
   - An unavailable KPI shows a dash, never a zero.
9. **Fixtures.** `isTestFixture` products are excluded from admin lists and counts and return 404 for writes.
10. **Logout and account switch.** `AuthContext.logout()` clears every query, and all admin keys start with `'admin'`. Signing out from an admin route lands on `/admin/login`. A deep link survives sign-in through a validated `/admin/...` return path.

## 4. Test map

| Invariant / area | Test |
|---|---|
| 401/403 on every new route, DB role beats JWT claim, inactive admin, `no-store` | `apps/backend/src/routes/admin.routes.test.ts` |
| Query whitelist, strict bodies, field errors, 404 for malformed ids, required expected versions, dashboard windows | same |
| 409 envelopes (`INVENTORY_CONFLICT` with `data`, `CATEGORY_IN_USE`), 204 delete, actor from token | same |
| Restock once under `FOR UPDATE` via InventoryService, stale/resubmitted restock rejected, P2034 → conflict, fixtures, SET-only tracking start | `apps/backend/src/services/admin-operations.service.test.ts` |
| Self-change blocked, lifecycle lock + token revocation + socket disconnect, stale/deleted accounts refused | same |
| Hidden-category activation refused, optimistic archive, category delete only when unused under lock | same |
| Shell nav (only 05.1 modules), active route, alert counts, collapse persistence, logout, skip link | `apps/frontend/src/layouts/AdminLayout.test.tsx` |
| URL state rejects forged filters, deep links, page reset, debounced search, stable query keys | `apps/frontend/src/features/admin/__tests__/useListParams.test.tsx` |
| Inventory dialog sends expected quantity, adopts current stock on 409, refuses zero restock | `apps/frontend/src/pages/admin/AdminInventoryPage.test.tsx` |
| Primitive states (header, KPI, filter band, sortable table, loading/empty, errors, confirm dialog) | Storybook `Admin/Primitives` (`AdminUi.stories.tsx`) |
| Fulfillment panel: confirm before start, one allowed step with the current revision, reload on 409, no action for cancelled/unpaid/delivered orders, payment-blocked explanation | `apps/frontend/src/pages/admin/AdminOrderDetailPage.test.tsx` |
| Saved or conflicting inventory rows update every cached page at once (no stale follow-up adjustment) | `apps/frontend/src/features/admin/__tests__/inventoryMutations.test.tsx` |
| New categories start hidden | `admin-operations.service.test.ts` |
| Live DEV: every route, skip link, QA category/product/inventory flow, read-only order/customer detail, no page overflow at 390/768/1440/1920/200%, mobile drawer | `apps/frontend/tests/visual/admin-dashboard-live-dev.spec.ts` (opt-in: `EH_RUN_LIVE_ADMIN_DEV=true`, `EH_DEV_ADMIN_EMAIL`, `EH_DEV_ADMIN_PASSWORD`, optional `EH_LIVE_ADMIN_OUT`, `EH_LIVE_ADMIN_BASE_URL`; config `playwright.admin-dashboard-live-dev.config.ts`). Leaves one tagged draft `QA 05.1 <stamp> Probe` product per run. |

## 5. Design decisions recorded

- **Radius.** `FIGMA.md` lists radii of 16/15/5/12, but the implemented token system is square (all `$radius-*` = 0, ADR-007 / Task 01.5). The admin keeps the square system rather than introducing a competing radius scale.
- **Header search.** The Figma header shows a global search field. No global admin search API exists in 05.1, so the field is omitted rather than shipped inert. Each module has its own working search in its filter band.
- **Mobile.** There are no admin mobile references, so the shell uses the existing breakpoints: below `lg` the sidebar becomes the shared right-side Drawer, and below `sm` the profile name and ADMIN pill are hidden.
- **Legacy media picker.** `pages/admin/AdminProductsPage.tsx` (the 04.3 media-only picker) is no longer routed, because `/admin/products` is now the full catalog table and every row links to `/admin/products/:id/media`. The file and its tests are kept unchanged for Architect disposition.
