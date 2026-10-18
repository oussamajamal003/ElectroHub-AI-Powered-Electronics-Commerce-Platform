# Task 03.7: Implementation Evidence

**Task / workstream / owner:** 03.7 Customer Order Management. FRONTEND + read-only Order API. Implemented by Claude Code (Opus 5.5, lead).
**Status:** implementation complete. Not reviewed by the architect, not integrated, not released.
**Branch:** `feature/Order-Management`. Base and current HEAD are both `c646dce` (equal to `origin/develop`, 0/0 divergence when fetched on 2026-10-18).
**Working tree:** uncommitted. **No commit, push, merge, CI trigger, or deployment** was performed.

## Agents

| Agent | Work |
| --- | --- |
| Opus 5.5 (lead) | All architecture, backend, frontend, tests, QA, and docs. |
| Haiku 5.5 subagent | Wrote `features/orders/Orders.stories.tsx` only. The lead reviewed it and corrected one invented status pairing (`AWAITING_CAPTURE` + `FAILED` was removed). |

The requested ten parallel agents were not used. The changes concentrate in a few shared contracts: service/route, badges, Orders page, and confirmation. Parallel writers would have broken the one-owner-per-file rule.

## Changed files

**Backend**
- `apps/backend/src/services/order.service.ts`: adds `orderSummary`, `orderDetails`, `parseOrderReference` and `getDetails`.
- `apps/backend/src/routes/checkout.routes.ts`: adds `GET /orders/:orderReference` and Swagger docs.
- New: `src/routes/orders.management.test.ts` and `src/services/__tests__/orders.management.live.test.ts`.

**Frontend**
- New `src/features/orders/` module: `types`, `presentation`, `fixtures`, `OrderBadges`, `OrdersAccessGate`, `OrdersBreadcrumb`, `OrderDetailsPage` (+ `.module.scss` + test), `Orders.module.scss`, `Orders.stories.tsx`.
- Rewritten: `src/pages/customer/OrdersPage.tsx`, its `.module.scss` and its test.
- Modified:
  - `components/ui/OrderStatus` and `components/ui/PaymentStatus` (+ tests).
  - `components/ui/ProductImage/ProductImage.tsx`: the fallback keeps an informative alt.
  - `features/checkout/CheckoutComponents.tsx` and `Checkout.module.scss`.
  - `lib/query.ts` and `routes/index.tsx`.
- New: `playwright.orders.config.ts` and `tests/orders/orders.spec.ts`.

**Docs**
- `docs/05_Features/ORDER_MANAGEMENT_03.7.md` (new).
- `ORDERS.md`, `08_Quality/TESTING.md`, and the 03.7 spec status line.

Contracts, mappings, and the screenshot matrix are in [ORDER_MANAGEMENT_03.7.md](../../05_Features/ORDER_MANAGEMENT_03.7.md).

## Database decision
**Case A: no migration.** The schema already contains all required fields.

Read-only DEV checks on 2026-10-18 (project `pzxekjybdiulzmssalfo`, identified through the env's existing DEV endpoint guard):
- `npx prisma migrate status` → "19 migrations found … Database schema is up to date".
- `_prisma_migrations` → 19 finished, 0 unfinished.

**PROD:** no read and no write. The Supabase connector was not authenticated in this session. The PROD baseline therefore rests only on the recorded Update 8 evidence (19/19) and is **NOT VERIFIED** freshly.

## Commands and results (all actually run)

| Command (cwd) | Scope | Result |
| --- | --- | --- |
| `npx vitest run src/routes tests/swagger.test.ts tests/app.test.ts …checkout.domain …payment.service …storefront-visibility.contract …payment-isolation …orders.management.live` (backend; live flags false, localhost dummy DB URLs) | Mocked API/contract, including 03.5/03.6 route regressions | 14 files passed, 1 skipped; **313 passed / 5 skipped** (the live suite stays inert without opt-in) |
| `ORDERS_LIVE_DEV=true NODE_ENV=test npx vitest run src/services/__tests__/orders.management.live.test.ts` (backend) | **Real DEV PostgreSQL + real login and routes**, synthetic fixture Orders | **5/5 passed** (89.7 s). Cleanup verified: 0 `orders-gate-` users, products, or categories remain. |
| `npx tsc --noEmit`; `npx eslint src/ --ext .ts` (backend) | Typecheck and lint | exit 0 |
| `npx vitest run` (frontend) | Full frontend suite | **97 files, 763/763 passed** |
| `npx tsc -b`; `npx eslint .`; `npm run build`; `npm run build-storybook` (frontend) | Gates | all exit 0 (build shows only the pre-existing chunk-size warning) |
| `npx playwright test -c playwright.orders.config.ts` (frontend, production preview, **mocked reads**) | E01–E10 journeys and captures | **18/18 passed** |
| `npx playwright test -c playwright.checkout.config.ts checkout.spec.ts late-results.spec.ts` | E11 regression | 27 passed, **4 failed (pre-existing)**. See below. |
| `git diff --check` | Hygiene | clean (only CRLF normalization notices) |

### Live DEV gate coverage
Customers A, B, and C (empty) are real logged-in users.
- A's history is owner-only; total = 4.
- `(createdAt, id)` tie ordering is verified.
- Paging and out-of-range metadata are correct.
- C's history is empty.
- A reads its own details (CANCELLED + REFUNDED, refundedAt set). Provider id, failure reason, and request hash are absent.
- B reading A's reference gets 404 with the same message as an unknown reference.
- The snapshot is unchanged after the Product name and price are edited (1099.99 kept vs 999.99 current).
- Product delete is rejected by the OrderItem FK.
- GETs leave Order and Payment `status`/`updatedAt` unchanged.

Fixtures were written directly. No Stripe, Inventory, or Cart writes were made.

Two runs needed fixes before passing:
- **First run:** 3 tests hit the 5 s default timeout, so cleanup was blocked and fixtures were preserved. Fix: 120 s per-test timeouts, plus scoped removal of prior `orders-gate-` fixtures.
- **Second run:** 5/5 tests passed, but Vitest 4 rejected the `afterAll(_context, suite)` signature. This signature was copied from the existing `checkout.live.test.ts`, which has the same latent issue (not changed here). Fixed in the new file.

### Pre-existing E11 failures (not caused by 03.7)
The following fail on this branch:
- `checkout.spec.ts`: "CANCELED / COMPENSATED / REFUNDED never becomes Paid…"
- `checkout.spec.ts`: "ownership miss retains recovery…"

They fail identically, with the same missing locators (`Payment did not complete`, `Restore items to Cart`, the processing heading), on a **clean detached worktree of `c646dce`** (4 failed / 3 passed in both). That worktree was removed afterwards.

These are 03.6 recovery-flow specs and are outside the 03.7 scope. They were reported, not modified.

## Visual QA: screenshots captured and opened

**References:** the three supplied Make images, opened from the chat attachments (`Order details page.png`, `Orders page.png`, `Screenshot 2026-09-04 162526.png`). No copies are stored in the repo: no `assets/figma/` convention exists in this checkout.

**Captures:** Chromium production preview, reduced motion, mocked reads. Written to `apps/frontend/test-results/orders/` (gitignored, reproducible). For each width in 390, 768, 1440 and 1920 px:
- `history-*`
- `history-empty-*`
- `details-*`
- `details-long-*`
- `details-cancelled-refunded-*`
- `details-error-*`
- `details-not-found-*`
- `confirmation-actions-*`

There is also `history-loading-{390,1440}`.

**Opened and inspected:** history 1920/390, details 1920/768/390-long, empty 1920, confirmation 1920/390. The remaining captures are covered by geometric assertions only: no horizontal overflow, empty-panel centering, details column alignment, and CTA alignment.

**Findings fixed and recaptured:**
1. **Details title focus ring.** A large focus ring appeared after load, because programmatic focus on the heading triggered `:focus-visible`. The outline on the non-interactive `tabIndex=-1` heading was removed.
2. **Mobile card layout.** On mobile cards, the "+1" preview tile wrapped and the metadata gaps were too wide. Thumbnails and gaps are now smaller below `sm`/`md`.
3. **Image fallback.** The "Image unavailable" fallback text overflowed the 64 px item thumbnail. The fallback is now icon-only.
4. **Fallback alt text.** The ProductImage fallback dropped the product's alt text. It now keeps it via `role="img"` (shared fix).
5. **Card wording.** "Paid with Visa …" was shown for card metadata on unpaid Orders. It now reads "Card: …" unless the Order is PAID.

**Remaining accepted differences from Make:**
- Badges use the design-system sizes, slightly smaller than the Make render.
- On mobile, card metadata wraps onto two rows. This is intentional, with no overflow.
- Real full-UUID references are much longer than `ORD-J220A0`.
- Track Delivery is intentionally omitted.

**Storybook:** the real pages were opened in the built-in browser:
- ManyOrdersWithPagination
- AwaitingCapture
- NotFound
- Empty
- StatusBadges

All of them render correctly.

## Requirement traceability

| ID | Status | Evidence |
| --- | --- | --- |
| R01 | PASS | Branch is equal to `origin/develop`. Only the 03.7 spec was untracked beforehand. Protected payment services were untouched: `commitAuthorized` and `confirmation()` are unchanged. |
| R02 | PASS | No creation, payment, cart, or inventory path was added. B07 tests plus the live no-write check. |
| R03 | PASS | B03 tests, live gate, OrdersPage tests, and Playwright E03. |
| R04 | PASS | B02 tests, live 404 parity, direct-entry and refresh in Playwright E01/E02. |
| R05 | PASS | Live snapshot-after-edit and the FK check. |
| R06 | PASS | Badge tests, details tests, stories. |
| R07 | PASS | Payment mapping tests, unknown fallback, Paid-only wording. |
| R08 | PASS (visual, mocked) | Opened captures compared with Make. Header, Footer, and Account navigation verified in E01. |
| R09 | PASS | Unit structure test plus Playwright geometry at 4 widths (≤1 px edge alignment) and the no-mutation check. |
| R10 | PASS | Unit and E2E loading/error-vs-empty checks, centering assertions, opened capture. |
| R11 | PARTIALLY VERIFIED | All 4 widths captured with no overflow. Not every capture was opened individually. |
| R12 | PARTIALLY VERIFIED | Keyboard Enter → details with focus, visible focus outline, reduced motion. 200% zoom and a screen-reader pass were not run. |
| R13 | PASS (unit) | Account-scoped keys, placeholder isolation test, existing `queryClient.clear()` on logout, E2E stale-page race. A live two-browser account switch was not run. |
| R14 | PASS | 25 stories, build exit 0, 5 opened in the browser. |
| R15 | PASS | Mocked contract tests plus the real DEV gate. |
| R16 | PASS | 18/18 Playwright tests; captures opened; defects fixed. |
| R17 | PASS with noted pre-existing failures | All gates above. 4 pre-existing 03.6 E2E failures were proven against the baseline. |
| R18 | PASS | Feature doc, ORDERS/TESTING links, this file. |
| R19 | PASS | No PROD access. DEV writes were limited to labeled disposable fixtures and cleaned up. No secrets printed. No commit or push. |
| R20 | Self-review only | Every changed file was reviewed by the lead. The architect score and verdict are pending independent review. |

## Residual risks
- The mocked browser journeys do not prove a real end-to-end purchase → details flow in the browser. That path combines the accepted 03.6 purchase evidence with the live API read gate.
- `GET /api/orders` still returns full item arrays per card. This is bounded by pageSize ≤ 50 and the cart line limit. A slimmer summary DTO would need a consumer migration.
- The pre-existing 03.6 recovery E2E failures above need their own investigation.
- The existing `checkout.live.test.ts` `afterAll` signature is incompatible with Vitest 4.
