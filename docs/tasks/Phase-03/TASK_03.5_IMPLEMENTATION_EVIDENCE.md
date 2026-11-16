# Task 03.5 implementation evidence

Status: COMPLETE IMPLEMENTATION AND REQUIRED LOCAL/LIVE GATES; ready for independent Principal Architect review. Branch feature/Checkout. Baseline 0852d116b508917e4c2da9f64d1b7de2db29b384. No self-approval, commit, push or merge.

## Related-file manifest

- Backend core: checkout.domain.ts, checkout.service.ts, order.service.ts, checkout.routes.ts, route aggregator; Shipping, delivery, revision, atomic Order, idempotency, confirmation.
- Direct Cart integration: cart.service.ts and cart.lock.ts, service/route tests; shared lock and economic revision, existing OOS decrement preserved.
- Database: schema.prisma and 20261006000000_checkout_core migration; existing Order/OrderItem extended, no parallel model.
- Frontend core: features/checkout types, state, API-connected page, production components/styles, Confirmation page, stories/tests.
- Direct integration: CartProvider/context/types, CartPage, route/query-key registration, ProtectedRoute, auth return-path handling in AuthModal/CustomerHeader; no shell styling change.
- Verification: focused Checkout unit/API/database tests, Checkout catalog/Storybook Playwright, isolated live DEV harness and screenshot evidence.
- Docs: authoritative task additive visual invariants, Checkout/Orders/Cart/Inventory, migration/schema/API, test/Storybook records and 03.6/03.7 handoffs.

## Visual classification

All seven Make Checkout/Confirmation/Processing images and contextual Product Details image opened during planning.
Shipping, Delivery, Review, desktop summary and Confirmation composition: approved.
Current shell: reuse. Raw payment entry/PayPal/paid labels: future 03.6 and omitted.
Order Details: future 03.7, omitted. Prototype controls: never ship. Generic spinner: replace with existing ElectroHubLoader.

## Baseline

Remote fetch succeeded through normal authorized tooling after sandbox FETCH_HEAD restriction. Local origin/develop and HEAD relation 0/0.
Planning read-only MCP checks: DEV and PROD each have identical 11 applied migration names, no rollbacks, matching Order/OrderItem columns and zero Orders.
Runtime/direct URLs safely identified DEV in .env/.env.local and PROD in .env.production.local. No values printed.
The planning baseline above is historical. The completed local/live deployment evidence below supersedes its pending status; planning reads are not deployment proof.

## Completed database gates — 2026-10-06

The authorized sequence was local/source validation → DEV identity and zero-Order preflight → Prisma DEV deployment → ledger/physical schema read-back → real authenticated DEV gates → identical Prisma PROD deployment → read-only PROD verification. No seed ran. No purchase/concurrency fixture ran against PROD. Environment credentials and tokens were held in memory and never printed.

| Check | DEV | PROD |
| --- | --- | --- |
| Verified project | pzxekjybdiulzmssalfo | yepfgjehdstlxbpespun |
| Historical completed migrations | 11 | 11 |
| New completed migration | 20261006000000_checkout_core | Same |
| Total completed migrations | 12 | 12 |
| New migration SHA-256/ledger checksum | 4b8a8afbdaeee67ba9e6f58accc9f704d03692100e9a714bd04ba966f88893ca | Same |
| Orders/OrderItems before deployment | 0 / 0 | 0 / 0 |
| New columns / enums / unique index | 8 / 2 / owner+attempt | Same |
| Four validated CHECKs and retained FKs | PASS | PASS |
| No unexplained migration or Checkout schema differences | PASS | PASS |
| Existing ledger rows preserved | PASS | PASS |
| Public anon/authenticated Order SELECT/INSERT/UPDATE/DELETE privileges | All false | All false |

The four CHECKs enforce Order nonnegative subtotal/shipping/total, ordered delivery dates, positive item quantities and nonnegative item price/total. Post-deploy PROD Orders/OrderItems remained 0/0. PROD MCP remained `read_only=true`; the only PROD write was the explicitly authorized Prisma forward migration.

Historical ledger whole-row fingerprints before and after deployment matched:
- DEV: `248c4e8df7a987a6c754b76b81d11c242f2f4f6234b0055f9e6d4e2b7934bb6d`
- PROD: `94f9a58c32213c75a6d77f2c3e14c3e4fdebdb228fb4f07e8b560bc89b0d2dbe`

### Preserved historical discrepancies

Two formatting-only differences were independently reproduced against repository SQL: PROD foundation uses UTF-8 BOM + CRLF, and PROD OTP uses CRLF; DEV used LF. The owner explicitly approved proceeding without changing historical files or existing `_prisma_migrations` rows. No normalization, re-checksum, resolve, deletion or ledger rewrite occurred.

Prisma's raw physical diff also proposes dropping seven historical SQL defaults: `gen_random_uuid()` on email_deliveries, otp_challenges, password_reset_tokens, refresh_tokens and security_events IDs; `CURRENT_TIMESTAMP` on email_deliveries/otp_challenges updatedAt. Their exact definitions were verified against immutable historical SQL and physical catalogs. They were preserved, not applied from the diff. Excluding those exact known defaults, the post-deploy diff is empty. Do not describe the raw global Prisma diff as empty. The Checkout/Order changes agree between schema, repository migration and physical database.

`.gitattributes` pins LF only for the new Checkout migration, preventing Windows `core.autocrlf=true` from changing its deployed checksum on a future checkout. It does not normalize any historical migration.

## LIVE DEV — real login, API and PostgreSQL

`checkout.live.test.ts` explicitly opts in with `CHECKOUT_LIVE_DEV=true`, rejects non-DEV URLs, verifies the approved backend-env customer through real login and `/auth/me`, then creates separately authenticated disposable customers/products/categories/carts. The approved customer's Cart/account and curated Products are not modified.

Eight final tests passed:
1. Multi-item API commit: quantities 2 and 3, stock 2→0 and 5→2, subtotal 40.28, Express total 50.27; Order +2 items persist, Cart clears, matching replay returns 200 unchanged, changed replay rejects, other-owner confirmation returns 404, attempt recovery returns the saved snapshots, no Payment/Delivery records.
2. Controlled second-item failure inside a real PostgreSQL transaction after earlier Order/items/first Inventory writes: Order, items, both Inventory rows and Cart match the before snapshot exactly. This fault case invokes the production OrderService with an injected Inventory failure; it is real DB rollback proof, not an intercepted endpoint claim.
3. Two independently authenticated customers compete for stock 1: one 201 and one 409, exactly one Order, final stock 0, losing Cart preserved.
4. Same-Cart concurrent same key: one 201 and one 200, one Order, stock 10→8, Cart empty.
5. Same-Cart concurrent different keys: one 201 and one 409, one Order, stock 10→8, Cart empty.
6–8. Stock shrink, price change and inactive Product reject with 409 and preserve all economic writes/Cart.

First live run exposed three adapter-pg concurrency failures (5 passed / 3 failed): raw SQL serialization failures surfaced as Prisma P2010 with `Transaction write conflict`, rather than P2034. The scoped classifier now retries only known serialization/deadlock forms, bounded to three attempts. Arbitrary constraint/network failures are not retried. The complete second live run passed 8/8, including genuine races, with cleanup PASS. This history is preserved instead of claiming the first run passed.

Both live-suite cleanup and browser-fixture cleanup asserted zero rows for their exact disposable IDs. A later read found an unrelated DEV Order outside these fixture IDs; it was not deleted or changed. Cleanup never means clearing the whole DEV database.

## REAL BROWSER → LOCALHOST → LIVE DEV

`scripts/checkout-browser-gate.cjs` used Chromium, the actual frontend and backend, real API login and DEV PostgreSQL without route interception. The final run passed:
- Reference: `ORD-4708D4D7-0563-4B11-A1F0-20B43DD82180` (disposable and cleaned afterward).
- Products: `6145110e-e581-48d2-957d-95c0fc6bafb8` qty 2, stock 6→4; `1130ac4e-3be5-47ea-9402-8f0b2e5cf42c` qty 3, stock 6→3.
- Subtotal 69.98; Express 9.99; Order Total 79.97; one Order, two snapshots, Cart rows 0.
- One POST /api/orders, zero Inventory HTTP requests, zero browser runtime errors.
- Confirmation survives hard refresh and a change to current disposable Product name/price; saved snapshots and owned GET agree exactly.
- Cleanup PASS; curated data unchanged; PROD not used.

Measured Order API wall time: 11,269 ms (server log 11,160 ms). Submission + subsequent screenshot/reload/database verification: 37,230 ms; this latter metric is not API latency. Hosted DEV auth/Cart reads also showed multi-second latency. No artificial loader delay exists and no sub-three-second performance claim is made. Purchase work is bounded to database operations, with bulk Product hydration and intentional bounded Inventory writes.

The earlier browser run also passed at reference `ORD-C4B70BDE-4E89-43EA-A516-12BDEEDA2675`; its fixtures were cleaned. Final rerun verified the query changes that avoid a needless attempt-recovery read after a clean 201 and share StrictMode DEV confirmation reads. No auth/bootstrap architecture was rewritten.

## Automated verification and provenance

| Category | Final evidence |
| --- | --- |
| UNIT / MOCKED API backend | 145 passed; Cart/Checkout/Inventory/Product/Search/Wishlist focused files |
| Local optional tests | 10 skipped: 2 isolated Inventory PostgreSQL (URL absent), 8 DEV opt-in (disabled in local run) |
| LIVE DEV API / real DB | 8/8 passed separately; never convert local skips to local PASS |
| COMPONENT frontend final combined run | 197 passed across 13 files, including Checkout/Cart, both AuthModal return-path tests, Product/Details/Wishlist/Header/auth and Search/query regressions |
| INTERCEPTED E2E Checkout | 16 passed; UI states/slow network/history/recovery; not DB proof |
| INTERCEPTED E2E Inventory regression | 11 passed |
| STORYBOOK production Checkout/Inventory axe | 35 passed: 11 Checkout +24 Inventory; four viewports each |
| REAL DEV browser | PASS, no interception, real persisted snapshots/stock/Cart |
| Prisma validate | PASS |
| Backend typecheck / lint / build | PASS |
| Frontend typecheck / lint / production build | PASS again after final test-only edits; production build exit 0 |
| Storybook production build | PASS |
| git diff --check | PASS on final tracked tree; all new implementation files also pass. The preserved user task document retains only its six original Markdown hard breaks at lines 3–8. |
| Remote CI | NOT RUN: no commit/push; existing workflow inspected |

Windows sandbox esbuild Access-is-denied failures were rerun through normal authorized local tooling; builds/tests passed without weakening configuration. The Inventory four-viewport test originally exhausted its shared 30-second budget; it now runs four independently isolated tests retaining every assertion, with actual Product-response readiness and unchanged timeouts. Checkout slow initial/submission and cold Confirmation are separate focused tests, not one two-refresh timeout. Screenshots wait for actual step headings and capture from document top to avoid fixed-header full-page offsets.

## Visual inspection and accessibility

Approved Make composition was used for Shipping, Delivery, Review and summary/Confirmation placement; current app shell preserved. Payment is intentionally refined into the honest future-provider shell. Paid semantics/last-four/provider controls/Order Details are future scope. Existing ElectroHubLoader replaces the prototype spinner.

Actual browser evidence includes six Checkout states at 390/768/1440/1920, representative validation and conflict frames, plus real multi-item DEV Shipping/Delivery/Payment/Review/Confirmation at all four widths and real Processing at 1920. Screenshots are opened and inspected, not merely generated. Local ignored folders: `apps/frontend/screenshots/checkout-visual` and `apps/frontend/screenshots/checkout-live`; reusable harnesses remain source-controlled task files.

Found and corrected: undefined SCSS token, Back-button contrast (existing outline variant), premature screenshot of previous step, fixed-header screenshot offset, and duplicate successful-submission recovery read. No unrelated shell redesign. Responsive columns stack below desktop; 390 controls are full width; long addresses/reference wrap; no horizontal overflow. Shipping focuses first invalid field; shared labels/errors remain accessible; whole-row delivery radio selection works with keyboard; one loader announcement; no raw payment controls; reduced motion honored. WCAG A/AA axe passed all 35 production-story tests and Checkout Review at all four widths.

## Requirement traceability — major requirements

| Requirement | Classification | Proof |
| --- | --- | --- |
| Authenticated Checkout / verified guard | Implemented | ProtectedRoute, CheckoutPage; component/API/browser auth guard |
| Cart review / sole Cart authority | Implemented | CartProvider, OrderSummary; queue/cache tests |
| Shipping / bounds / focus / preservation | Implemented | domain validation, controlled ShippingStep; unit/component/browser |
| Delivery / server fees / business dates | Implemented | domain config/Decimal/businessDate; all-three totals tests |
| Payment method shell | Implemented | no PAN/CVV/expiry; honest unpaid copy; browser no inputs |
| Review / Edit / protected final validation | Implemented | ReviewStep, current quote/revision guard; conflict/background tests |
| Backend price and shipping authority | Implemented | strict request schema + DB prices + Decimal; tampering tests/live totals |
| Order creation and item snapshots | Implemented | OrderService + schema; real multi-item API/browser snapshot persistence |
| Inventory decrease / no negative stock | Implemented | existing InventoryService same tx; exact-stock/last-unit live gates |
| Cart success clear / failure preservation | Implemented | same tx + Cart queue; live success/conflict/rollback, stale-read test |
| Atomic rollback | Implemented | real controlled second-item fault, all before/after effects equal |
| Concurrency / idempotency | Implemented | real last-unit/same-Cart races + unique key/request hash |
| Confirmation / refresh / ownership | Implemented | owner-scoped snapshots; live API/browser refresh + other-owner 404 |
| No raw payment / no fake Paid | Implemented | strict payloads, unprocessed DTO/UI; no Payment/Delivery records |
| Current loader reuse | Implemented | production ElectroHubLoader, one pending status |
| Storybook / responsive / accessibility | Implemented | 11 production states;35 axe/overflow tests;opened four-width screenshots |
| Playwright / real-browser review / screenshot inspection | Implemented | separately labeled intercepted and real DEV evidence |
| 03.6 handoff | Implemented | CHECKOUT_CORE_03.5.md provider mount/unpaid/idempotency/atomic boundary |
| 03.7 handoff | Implemented | persisted snapshots/reference/ownership/totals/Confirmation DTO |
| DEV/PROD migration gates | Implemented | exact checksum, ledger preservation and physical catalogs |

Scenarios A–M/T/U/V/X/Y/Z/AA/AB have component/intercepted-browser coverage. N/O (stock/exact stock), S (rollback), W (ownership), and persistence/concurrency are proven by real DEV API/DB/browser gates rather than mocks.

## Deferred functionality and limits

03.6: provider-hosted payment collection/orchestration, authoritative payment states/webhooks. No external provider calls may be placed inside this Order transaction. Reuse Order totals/idempotency/purchase core.
03.7: order lists/details/status management, emails/PDF/tracking. Reuse immutable snapshots, ORD-UUID reference, ownership and Confirmation DTO. No duplicate Order model.
Other: no production application deployment or remote CI was performed, and no independent architectural approval is claimed. Hosted DEV latency remains a measured operational risk; no unrelated performance hunt was started.

## Final closure review — 2026-10-06

Full-file review covered the 60-file task manifest, including direct Cart/auth integration, schema/migration, operational harnesses, tests/stories and affected documentation. Final read-only review checked server ownership, strict payloads, Decimal authority, deterministic locks, bounded retries, rollback, recovery, identity-scoped cache/drafts and the unpaid 03.6 boundary. No remaining task-scoped source blocker was identified; independent Principal Architect approval is still required.

Final verification: backend 145 focused tests passed with 10 explicitly optional local skips; the separate real DEV suite passed all eight. Frontend final aggregate 197 passed. Unique Playwright coverage is 62 tests (16 Checkout, 11 Inventory catalog, 35 production Storybook/a11y), with a separate non-intercepted real browser-to-DEV purchase. Repeated screenshot/targeted reruns are not counted twice. Final real DEV screenshots at 390/768/1440/1920 were all opened, including Processing at 1920; representative intercepted validation/conflict/slow-network frames were also opened.

All nine recorded source hashes matched again after verification. Historical migration files have no Git changes; existing live ledger fingerprints matched deployment preflight. The exact changed-file manifest matches Git's tracked diff plus untracked task files (60 files). Generated build/browser artifacts remain ignored. No credentials were added to source or documentation. Both frontend and backend typecheck/lint/build, Prisma validation, Storybook build and final diff checks passed. The existing 617 kB shared frontend entry chunk warning is retained as an out-of-scope baseline warning, not concealed or refactored in this task.

Remaining limitations: isolated local Inventory PostgreSQL tests were not enabled; genuine hosted DEV transaction/concurrency proof is separately recorded. PROD verification is schema/read-only only, with no purchase fixtures. Remote CI and production application deployment await the normal review/release process. Hosted DEV Order API latency was 11,269 ms in the final real browser run and is not presented as fast or sub-three-second loading.

## Final source fingerprint

Timestamp: 2026-10-06T11:37:18.744026+00:00

| File | SHA-256 |
| --- | --- |
| `apps/backend/src/services/order.service.ts` | `bed87f0828c6ea4bae5aafe916dbb86f662ee33feadf6cff610b63dd75ae748c` |
| `apps/backend/src/services/checkout.domain.ts` | `1904658031706fd45400455a86f2c66c301e70ae7057fcf0cf4c841e8910a115` |
| `apps/backend/src/services/checkout.service.ts` | `0e5d2cbe2113a80f5b4eade2c3467c21862f2c64e506897c93a376de7d352632` |
| `apps/backend/src/services/cart.service.ts` | `90bea11db28ea5b0f0e910f39e9c814abdef224b6eda7959a8bda03b8a1bbe54` |
| `apps/backend/src/services/cart.lock.ts` | `b4a5c6cceda8e4dbdd90aadad1cb0e978f936a1656aada3ca4c084f31e35429a` |
| `apps/backend/src/services/transaction-conflict.ts` | `ebee9bcc0234029f652ee20b0862413ca78a3a8d5a75677da095f13a8414a7e6` |
| `apps/backend/src/services/inventory.service.ts` | `1cad78afb7c69d4d4960d25e7f8c6e0dd3cf47e6db83081ac1f0c8e63887f90e` |
| `apps/backend/prisma/schema.prisma` | `ebf02207c87ee0f7370cad02561e4080a523d7f14b3e6e2ea7adb91536c23d02` |
| `apps/backend/prisma/migrations/20261006000000_checkout_core/migration.sql` | `4b8a8afbdaeee67ba9e6f58accc9f704d03692100e9a714bd04ba966f88893ca` |

The live gates used these purchase/locking/Inventory/schema sources. Later changes were tests, operational read-verification, screenshots and documentation; InventoryService itself remains unchanged from baseline. No secret material is included.

## Exact changed-file manifest

- DB/MIGRATION: `.gitattributes`
- DB/MIGRATION: `apps/backend/prisma/migrations/20261006000000_checkout_core/migration.sql`
- DB/MIGRATION: `apps/backend/prisma/schema.prisma`
- VERIFICATION: `apps/backend/scripts/checkout-browser-gate.cjs`
- VERIFICATION: `apps/backend/scripts/checkout-migration.cjs`
- TEST/E2E: `apps/backend/src/routes/cart.quantity-correction.integration.test.ts`
- TEST/E2E: `apps/backend/src/routes/checkout.routes.test.ts`
- CORE / DIRECT INTEGRATION: `apps/backend/src/routes/checkout.routes.ts`
- CORE / DIRECT INTEGRATION: `apps/backend/src/routes/index.ts`
- TEST/E2E: `apps/backend/src/services/__tests__/cart.service.test.ts`
- TEST/E2E: `apps/backend/src/services/__tests__/checkout.domain.test.ts`
- TEST/E2E: `apps/backend/src/services/__tests__/checkout.live.test.ts`
- TEST/E2E: `apps/backend/src/services/__tests__/transaction-conflict.test.ts`
- CORE / DIRECT INTEGRATION: `apps/backend/src/services/cart.lock.ts`
- CORE / DIRECT INTEGRATION: `apps/backend/src/services/cart.service.ts`
- CORE / DIRECT INTEGRATION: `apps/backend/src/services/checkout.domain.ts`
- CORE / DIRECT INTEGRATION: `apps/backend/src/services/checkout.service.ts`
- CORE / DIRECT INTEGRATION: `apps/backend/src/services/order.service.ts`
- CORE / DIRECT INTEGRATION: `apps/backend/src/services/transaction-conflict.ts`
- TEST/E2E: `apps/frontend/playwright.checkout.config.ts`
- CORE / DIRECT INTEGRATION: `apps/frontend/src/components/layout/CustomerHeader/CustomerHeader.tsx`
- CORE / DIRECT INTEGRATION: `apps/frontend/src/components/layout/ProtectedRoute/ProtectedRoute.tsx`
- TEST/E2E: `apps/frontend/src/features/auth/components/AuthModal.test.tsx`
- CORE / DIRECT INTEGRATION: `apps/frontend/src/features/auth/components/AuthModal.tsx`
- CORE / DIRECT INTEGRATION: `apps/frontend/src/features/auth/returnPath.ts`
- TEST/E2E: `apps/frontend/src/features/cart/CartProvider.test.tsx`
- CORE / DIRECT INTEGRATION: `apps/frontend/src/features/cart/CartProvider.tsx`
- CORE / DIRECT INTEGRATION: `apps/frontend/src/features/cart/context.ts`
- CORE / DIRECT INTEGRATION: `apps/frontend/src/features/cart/types.ts`
- CORE / DIRECT INTEGRATION: `apps/frontend/src/features/checkout/Checkout.module.scss`
- STORYBOOK: `apps/frontend/src/features/checkout/Checkout.stories.tsx`
- CORE / DIRECT INTEGRATION: `apps/frontend/src/features/checkout/CheckoutComponents.tsx`
- CORE / DIRECT INTEGRATION: `apps/frontend/src/features/checkout/CheckoutDraftSession.tsx`
- TEST/E2E: `apps/frontend/src/features/checkout/CheckoutPage.test.tsx`
- CORE / DIRECT INTEGRATION: `apps/frontend/src/features/checkout/CheckoutPage.tsx`
- CORE / DIRECT INTEGRATION: `apps/frontend/src/features/checkout/ConfirmationPage.tsx`
- TEST/E2E: `apps/frontend/src/features/checkout/checkout.test.tsx`
- CORE / DIRECT INTEGRATION: `apps/frontend/src/features/checkout/fixtures.ts`
- CORE / DIRECT INTEGRATION: `apps/frontend/src/features/checkout/state.ts`
- CORE / DIRECT INTEGRATION: `apps/frontend/src/features/checkout/types.ts`
- CORE / DIRECT INTEGRATION: `apps/frontend/src/lib/query.ts`
- STORYBOOK: `apps/frontend/src/pages/customer/CartPage.stories.tsx`
- TEST/E2E: `apps/frontend/src/pages/customer/CartPage.test.tsx`
- CORE / DIRECT INTEGRATION: `apps/frontend/src/pages/customer/CartPage.tsx`
- CORE / DIRECT INTEGRATION: `apps/frontend/src/routes/index.tsx`
- TEST/E2E: `apps/frontend/tests/catalog/inventory.spec.ts`
- TEST/E2E: `apps/frontend/tests/checkout/checkout.spec.ts`
- STORYBOOK: `apps/frontend/tests/storybook/checkout.stories.spec.ts`
- DOCUMENTATION: `docs/05_Features/CART.md`
- DOCUMENTATION: `docs/05_Features/CHECKOUT.md`
- DOCUMENTATION: `docs/05_Features/CHECKOUT_CORE_03.5.md`
- DOCUMENTATION: `docs/05_Features/INVENTORY.md`
- DOCUMENTATION: `docs/05_Features/ORDERS.md`
- DOCUMENTATION: `docs/06_Database/MIGRATIONS.md`
- DOCUMENTATION: `docs/06_Database/PRISMA_SCHEMA.md`
- DOCUMENTATION: `docs/06_Database/TASK_03.4A_INVENTORY_HANDOFF.md`
- DOCUMENTATION: `docs/08_Quality/STORYBOOK.md`
- DOCUMENTATION: `docs/08_Quality/TESTING.md`
- DOCUMENTATION: `docs/tasks/Phase-03/TASK_03.5_CHECKOUT.md`
- DOCUMENTATION: `docs/tasks/Phase-03/TASK_03.5_IMPLEMENTATION_EVIDENCE.md`
