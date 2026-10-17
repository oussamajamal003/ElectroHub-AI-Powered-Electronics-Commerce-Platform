# Task 03.6 — Payment/Order Session Isolation

Date: 2026-10-11. Branch: `feature/Stripe`. Evidence is offline/source or intercepted browser only. Real database/provider execution and `--execute` remain **BLOCKED**. SECURITY-01 is outside this change.

## Confirmed causes

- The checkout draft namespace was user/scope based, so an old saved attempt could be restored after leaving Checkout and changing the Cart. Restoration previously lacked a resolved-current-snapshot gate.
- Recovery installation used the Cart checkout submission path and payment response Cart projection, coupling an old attempt's asynchronous result to shared Cart state and navigation.
- Setup replay/active reuse could return an existing attempt without revalidating the current locked Cart snapshot. Provider-backed status for A must not become setup credentials for B.
- Compensation restored A lines into the current Cart even when it already contained B. This was a separate concrete backend state-contamination path.

The existing Order service already validates the locked economic revision before purchase effects. An empty Cart after a committed A purchase can be legitimate; this review does not claim that the reported UI alone proved an incorrect database Order binding.

## Minimal fixes

- Add optional non-secret attempt identity metadata: `cartIdentity`, `cartRevision`, `intentId`. Current backend responses include these; old responses remain additively compatible. No schema change or client-secret persistence.
- Detach the active saved attempt when leaving Checkout; retain shipping/delivery information. Invalidate the exact user's Cart query when returning to Cart. Backend durable recovery remains intact; no automatic authorization cancellation.
- Wait for current Cart resolution before restoring an attempt. Reject known snapshot/attempt/provider identity mismatches. Ignore unmounted, superseded-generation and superseded-attempt responses.
- Install only the bound payment outcome. Obtain current Cart through authoritative GET, rather than replacing shared Cart from a recovery response. Recheck the refreshed snapshot before confirmation navigation.
- Validate current locked Cart identity/revision on setup replay and same-hash active reuse. An authorized A still holding the unique active claim can safely block B; it must not supply A's secret as B or be force-canceled.
- Restore compensated A only into its original empty Cart. If B occupies the Cart, preserve B and retain A in `recoveryRemainder` for explicit recovery. Inventory/payment compensation stays transactional and fenced.
- Preserve React Strict Mode setup continuation: cleanup marks the instance unmounted rather than invalidating the generation during a development effect replay.

## Scenario evidence

| Requirement | Executed coverage |
|---|---|
| A pending, leave, add B, Checkout B | `PaymentSessionIsolation.test.tsx`; both browser tests below |
| A paid/declined during B Shipping/Payment | Four parameterized frontend cases |
| A setup response after B initialized | `never installs A clientSecret or draft when A setup arrives after B initializes` |
| Wrong snapshot/intent/cart identity | Wrong-snapshot setup test and two changed-binding cases |
| No A confirmation or Cart overwrite | Late outcome cases; authoritative Cart recheck test |
| Back/Forward and refresh | `keeps B isolated through Back/Forward and refresh while A remains recoverable by its owned status route`; both browser tests |
| Genuine pending A remains recoverable | Same-attempt refresh and Cart-resolution gate tests |
| Backend rejects stale reuse | Six `payment.session-isolation.test.ts` cases |
| Committed A does not purchase/clear B | Locked revision rejection and committed replay cases |
| Compensation does not restore A over B | Two compensation cases in `payment.service.test.ts`, including repeated processing |

Browser test names:

- `intercepted browser: pending A cannot confirm or overwrite B in shipping; B survives refresh/history`
- `intercepted browser: pending A cannot confirm or overwrite B in payment; B survives refresh/history`

These use actual Chromium and production frontend components, but intercepted APIs and the repository's fake Stripe SDK. They do **not** prove real PostgreSQL concurrency, Stripe capture or hosted Element readiness.

## Verification checkpoint

- Backend focused payment/session/lock/retry/BuyNow/Cart/routes: **182 PASS, 0 FAIL, 0 SKIP** (eight files, final compensation source).
- Frontend focused Checkout/recovery/status/Stripe/navigation/Cart: final eight-file rerun **122 PASS, 0 FAIL, 0 SKIP**. A preceding nine-file run including an additional concurrent-agent Cart repro had **122 PASS, 1 FAIL**, because that file referenced `CheckoutPage` without importing it. The repro remains an external unresolved edit; excluding it from the scoped rerun does not make the whole frontend tree green.
- New isolation component suite: **14 PASS**, wrapped in React Strict Mode.
- Focused intercepted browser: **2 PASS, 0 FAIL, 0 SKIP**.
- Backend typecheck/lint/build: PASS. Frontend typecheck/lint/production build: PASS after the concurrent Cart agent finished. Earlier failures belonged to interim concurrent edits and cleared on the final tree. The final build reports the existing >500 kB chunk warning.
- Scoped credential-pattern scan: zero matches in eleven scoped source/test artifacts. This is not an exhaustive deployment secret audit.

## Review and constraints

Reviewed payment setup/replay/projection/compensation and direct Checkout/session/state consumers. Existing Order locked revision check, inventory compare-and-set, Cart cleanup atomicity, provider calls outside transactions, durable work fencing and unknown-outcome classification remain unchanged.

Economic revision identifies contents/prices, not a monotonic temporal Cart epoch. Identical-content history is not distinguished by a new schema field. Attempt/key/intent binding and locked snapshot verification remain the authority. Legacy responses without additive metadata retain compatibility; current source emits metadata.

Real PostgreSQL concurrency, real provider recovery and financial acceptance remain NOT VERIFIED by design for this offline task. No database/provider writes, migrations, workers, commits, pushes or deployments were performed. No financial execution approval is implied.

The final browser rerun exposed an intermittent test setup race: the first navigation assertion could run before the intercepted authoritative Cart GET resolved, so recovery status had not started yet. The browser test now waits for the Cart response before asserting the delayed A status request. The complete final browser run then passed both Shipping and Payment cases (2/2); no fixed sleep or timeout extension was added.

## Source fingerprints

SHA-256 of scoped final implementation/test source:

```text
payment.service.ts FF729B018674562C64681EDD2597D8A2397DA86D6DD6E9BAEEAAE0B7D91384F6
payment.service.test.ts 8A727185005590D4307C6411C35272C270B70FB69AEDC6DD868F99732B3DDE94
payment.session-isolation.test.ts 3F751C6DABB5A29694C72762FD4ABD2FC475F03204DC241116E755BEE1091569
CheckoutPage.tsx 2AED0979BDDDB20CADF0ED19D6E505ABA5A261B69ECFFACB59C3040A984B2D65
CheckoutDraftSession.tsx B21E8D22AD4BA6916CC5F7863B8FE7D48465AE48966833F0A389F241A25CC52B
state.ts 2A18DBD9F7FE3B5D6DC671FB08534B7B6D7EA33B49B3DB5FBF844B1567AEF76B
types.ts 3C88982AAB67F226521824867D61885BD6C4A55121908CDE61828C9413196CB6
paymentPresentation.ts B01B2990696C934E6E97EA1DA80C763A2077E9C6D3D9E49A944CBC60446EBE9D
PaymentSessionIsolation.test.tsx 7022CEF3EC6647350668BCB3B1CCE1D32EB9B14ABE68911E4588B9B7660EA25E
payment-session-isolation.spec.ts 022B24E15893E40B567CC04E421E4225FA87150942C4E1A6E6FFC789A5AD6FB9
stripe-sdk.fixture.js 553CE9CCF6DE37A42C2ECD6E005A539E510E8532D7DAA168E7AC27135936758A
```

## Update - 2026-10-14
`PaymentSessionIsolation.test.tsx` asserted the pre-Scenario-1 status page; three tests failed against current source (legacy status URL now only redirects to `/cart?purchase=<attempt>`; the checking heading is the shared loader). They now assert the current contract and the same isolation invariants plus zero new payment-attempt requests from the legacy route: 14/14 PASS offline. Production source unchanged. Still offline/mocked: real PostgreSQL concurrency is not proven here.
