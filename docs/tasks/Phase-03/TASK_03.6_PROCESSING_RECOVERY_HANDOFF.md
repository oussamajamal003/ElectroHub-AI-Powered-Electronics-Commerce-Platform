# Processing, live Cart and submitted-purchase navigation follow-up

2026-10-16. Branch `feature/Stripe`; base HEAD `3d69b97fbea4dbcb536ca1a7ed7bcd7dfa54ace4`. Task 03.6 remains OPEN. NO PUSH. This report does not declare the overall task complete.

**Update:** The dated cancellation/recovery addendum at the end supersedes the earlier provider-cancellation blocker. The earlier failed attempts remain historical evidence; DEV state synchronization is still unverified.

## Confirmed $719 DEV purchase and authorization

The owner subsequently authorized access to DEV to cancel the stuck payment. The DEV connector's project URL was verified as `pzxekjybdiulzmssalfo.supabase.co`. Read-only identity checks confirmed database `postgres`, schema `public`, role `supabase_read_only_user`, transaction read-only ON. Catalog reads were confined to payment-related columns. A bounded product/quantity/USD719 match returned exactly one unresolved submitted attempt, without retrieving customer personal data:

- Attempt: `080806e3-70cc-4dfa-a664-2571cbd731fd`.
- PaymentIntent: `pi_3UR8dGKiVgdl63pN0KH6ywoR`.
- Stripe account: `acct_1UEZW5KiVgdl63pN`.
- Initial DEV state: AWAITING_INPUT; no Order; cancellation not yet requested; READY work, zero retries, no error/lease, next run overdue since 2026-10-16 10:45:22 UTC.

The connected Stripe MCP account was DIFFERENT, so it was not used to read or mutate this intent. A guarded local read used the existing DEV Test Mode key, verified both configured database URLs point to the approved DEV project, and verified the Stripe account before retrieving this exact Intent. Stripe confirmed **livemode=false, manual capture, USD719.00, requires_payment_method, received=0, capturable=0, no payment method, no last payment/decline error**, and metadata bound to the exact attempt. This is an unpaid purchase waiting for card entry, not evidence of a declined charge or successful capture. The historical UI/worker execution sequence cannot be reconstructed from this snapshot alone.

No PROD access, migration, global runner, customer-authentication mutation, capture, refund, new PaymentIntent or Order was authorized or executed by this task. The user's latest authorization permits this one DEV cancellation; it does not authorize broad cleanup or other purchase processing.

## Cancellation is NOT complete

A scoped invocation of the existing `PaymentService.cancel` persisted `cancelRequested=true` and claimed the existing work, but encountered database connection/transaction errors before reaching provider cancellation. Its provider wrapper forbade create/capture/refund and checked exact account, amount, identity and unpaid status. The application remained the state-transition owner; no manual SQL financial-state update was performed.

The first preflight stopped before connecting because the working directory did not resolve the configured TLS CA path; it was retried from the backend directory. The actual application attempt then hit idle/connection errors and a timed-out transaction read (SQLSTATE 57014). Read-only lock metadata showed one idle transaction on payment tables; no session was terminated or altered. The lease expired without recording a retry. A bounded alternative using the already-configured DEV transaction-pool path, one connection, strict TLS and timeouts failed at the initial attempt read and performed no further state transition. A module-resolution preflight failure on that alternative likewise performed no database/Stripe operation. No permanent connection configuration was changed.

After each uncertain execution, the exact attempt and Stripe status were rechecked rather than assuming rollback or repeating an irreversible action. Latest confirmed state:

| System | Verified result |
| --- | --- |
| Stripe Test Mode | requires_payment_method; received $0; capturable $0; not canceled |
| DEV attempt | AWAITING_INPUT; cancelRequested=true; no Order |
| DEV work | LEASED with expired lease; retry count 0; no last error |

Automatic approval review rejected a proposed provider-only continuation using the application's existing cancellation idempotency key, because database synchronization had not completed and the records could become inconsistent. That rejected action was NOT executed or bypassed. The inspection helper was returned to read-only behavior. **The purchase has not been canceled and must not be reported as canceled.** Completing the ordinary application workflow requires healthy DEV database access. A provider-only cancellation with deferred database reconciliation requires new explicit owner approval and tool approval; it is not silently substituted for the requested workflow.

Operational scripts and evidence are local under `.cache/payment-lifecycle-followup`; they contain fixed record IDs and guarded environment checks, not embedded credentials. Do not rerun a mutation helper without checking current provider/database state and authorization. No SQL fixture cleanup, ledger edits or forced terminal state is proposed.

## Source root causes and minimal corrections

1. **Misleading Processing presentation:** `AWAITING_CUSTOMER_ACTION` / AWAITING_INPUT used the same Processing badge and animated progress bar as provider work. The real purchase's readback confirms this distinction matters. The card now says Payment details needed, omits provider-processing animation, and links to its owned status. This does not change a financial state or assert that an unresolved charge failed.
2. **Discovery stopped on an empty list:** `pendingPollInterval` intersected known observation IDs with rows already returned by the list. An empty/delayed list disabled observation even when a submitted purchase was known. It now watches the union of backend-pending rows and known observation IDs; missing per-owner submitted pointers from both scopes also keep discovery active. Once a row exists its authoritative state supersedes the discovery pointer. Reads retain the existing 15/60/120-second backoff, visibility pause, request deadline and error handling; no financial POST retry was added.
3. **No explicit purchase re-entry route:** ordinary Checkout only restored from a session pointer when the active Cart was empty, and pending cards offered no direct status link. The explicit `/checkout?purchase=<UUID>` route now renders the existing owned `RestoredPurchase` observer before initializing any Cart checkout/draft/card entry. It requires a verified session and validated ID; backend ownership still applies. Pending cards link to it. Refresh/history preserve the identifier; status failures and missing records remain recoverable. An ordinary `/checkout?step=shipping` without a purchase ID retains normal empty-Cart behavior. Legacy route behavior is unchanged.
4. **Late submission response lost discovery:** Checkout tested whether its component was current before recording a successfully submitted response. Navigation during `/submit` could discard a durable purchase identity. Matching owned identity is now recorded and list/Cart reads invalidated before the generation fence. That fence still prevents confirmation of an unmounted card form and prevents installing the old response into Checkout B.

Production edits are confined to `apps/frontend/src/features/checkout/CheckoutPage.tsx` and `PaymentPurchases.tsx`. Existing status mapping, provider binding, signature verification, financial transactions, worker fencing and compensation code were inspected but not modified. Recovery is a separate runner, not an automatic part of the HTTP server; signed webhook ingestion queues work and does not itself drain it. The inspected Compose definition has no runner service. These are operational dependencies, not proof of which processes were running during the user's original screenshot. Worker execution must never be started globally without approval.

## Ownership and verification

Additional existing test edits: `apps/frontend/src/features/checkout/PaymentPurchases.test.tsx`, `PaymentSessionIsolation.test.tsx`, and `apps/backend/src/services/__tests__/payment.service.test.ts`. New files: `apps/frontend/tests/checkout/payment-recovery-navigation.spec.ts`, `apps/frontend/playwright.payment-recovery-navigation.config.ts`, and this report. Total: eight source/test/config/documentation files. `.cache` contains local before/after artifacts and the owner-authorized operational probes. Other workstreams and the Git index are preserved.

Commands actually executed (each from the indicated package):

```text
# apps/frontend
npx vitest run src/features/checkout/PaymentPurchases.test.tsx src/features/checkout/PaymentSessionIsolation.test.tsx src/features/checkout/SavedPurchaseCheckout.retry.test.tsx src/features/checkout/paymentObservation.test.ts src/features/checkout/paymentResume.test.tsx src/features/checkout/PaymentRecovery.test.tsx src/pages/customer/OrdersPage.test.tsx --maxWorkers=1 --no-file-parallelism
npx playwright test -c playwright.payment-recovery-navigation.config.ts
npx playwright test -c playwright.payment-success-sync.config.ts
npm run typecheck
npm run lint

# apps/backend
npx vitest run src/services/__tests__/payment.service.test.ts src/services/__tests__/payment.domain.test.ts src/routes/stripe-webhook.routes.test.ts --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run lint

# repository root
git --no-optional-locks -c core.safecrlf=false diff --check
```

Before production edits: the new polling assertion failed (exit 1); Chromium had seven failures/one pass (exit 1). The empty-list discovery failure was timing-dependent, with one case succeeding before the fix; the deterministic pure polling test established the stop condition. Re-entry cases displayed empty Checkout rather than the identified purchase. Before screenshots and JSON are preserved under `.cache/payment-lifecycle-followup/before-shots` and `before-browser-report.json`.

After the initial fix, all eight browser cases passed. Visual review identified screenshots taken during the existing 450ms exit animation; the fixture clock now advances beyond it and explicitly requires a visible Failed payments card before capture. The real-awaiting-input finding added two status-label cases. Final new suite: **10 passed, exit 0**, 41.3 seconds, at 390×900 and 1366×900. These cover live discovery and PAID/DECLINED transitions, toast newness, same-product separate purchases and Cart B, reload/history re-entry, transport recovery, ordinary empty checkout and no automatic submission on return. The existing **29-case** retry/synchronization/notification Chromium suite also passed (exit 0); the subsequent awaiting-input presentation branch is covered by the new two cases and component tests. No success assertion uses provider authorization alone as capture proof.

Backend: **136 tests in three files passed, exit 0**. New processor tests use mocked persistence and provider responses to verify fresh-instance recovery of an expired lease into a verified decline, and unknown readback remaining scheduled/unresolved without cancellation/capture. Existing webhook tests use genuine signature generation/verification with mocked persistence. These are not actual PostgreSQL failover or live Stripe payment acceptance.

Frontend intermediate run: 100/104 passed; three old assertions forbade every link and were updated to allow only the new read-only status link while still rejecting payment/retry actions. The new late-submit test initially clicked before Review was enabled; it now waits for valid entry. The resulting 104-test run passed. A subsequent status-label run found one more old assertion requiring Processing for card-entry states; it now requires accurate Payment details needed without inventing provider processing. **Final run: 104/104 passed across seven files, exit 0, 33.82 seconds**, including that branch. Frontend and backend typecheck/lint and final diff check all exited 0. The existing Orders pagination test still emits JSDOM's window.scrollTo diagnostic while passing.

Real Chromium uses a fresh task-owned build and loopback preview, with intercepted API/Stripe boundaries and a closed-loopback fallback. Screenshots are synthetic UI evidence, **not the actual customer's $719 purchase being reconciled**. Real environment evidence is limited to the owner-authorized DEV/Stripe readbacks and the partial cancellation described above. Actual hosted card entry/new-charge acceptance was not run. Existing browser attachment inspection failed with a computer-use kernel-assets path error; no existing tab or authentication/session was modified.

Before/after artifacts at both widths are under `.cache/payment-lifecycle-followup/before-shots` and `shots`: `reentry-before-390.png`, `reentry-before-1366.png`, `reentry-after-390.png`, `reentry-after-1366.png`, and `live-after-DECLINED/PAID-<width>.png`. Some archived pre-fix re-entry captures caught the initial loader before the failed assertion, so they are not presented as screenshots proving the settled empty state. The owner's supplied empty-Checkout image is the actual observed before reference. The post-fix Checking view and settled mobile Cart containing separate pending, failed and same-product active-Cart entries were visually inspected. Existing components/tokens/layout were reused; no new CSS design was introduced. All attached screenshots were inspected. Repository Figma assets are absent, so no Figma pixel approval is claimed.

## Remaining decision

Source corrections are locally verified; the real DEV cancellation remains unfinished. Do not delete this attempt, force FAILED/CANCELED, cancel a potentially captured payment, terminate an unowned database session, weaken TLS, reset a lease manually or launch a global worker to mask the failure. The smallest next owner action is either restore the approved DEV application database path and finish the existing scoped cancellation, or explicitly approve the reviewed provider-only Test Mode cancellation with deferred database reconciliation. Principal Architect/owner acceptance remains pending. Task 03.6 remains OPEN; NO PUSH.

## 2026-10-16 cancellation and bounded-recovery addendum

The owner explicitly approved canceling only this unpaid Test Mode intent after being informed that DEV synchronization would be deferred. The guarded operation rechecked the exact account, intent, attempt metadata, USD719 amount, manual capture, Test Mode, zero received/capturable and `requires_payment_method` status. It reused `electrohub:03.6:080806e3-70cc-4dfa-a664-2571cbd731fd:cancel`. No create, confirm, capture or refund operation was performed.

**Fresh Stripe readback at 2026-10-16 11:42:41.847 UTC:** `pi_3UR8dGKiVgdl63pN0KH6ywoR` is `canceled`, `livemode=false`, amount received 0, amount capturable 0, no payment method. Cancellation timestamp 1792150961. The helper exited 0. Sanitized evidence is `.cache/payment-lifecycle-followup/dev-intent-readback.json`.

A subsequent read-only DEV query verified the exact project again, database `postgres`, role `supabase_read_only_user`, read-only ON. The exact attempt remained `AWAITING_INPUT`, `cancelRequested=true`, stored provider status `requires_payment_method`, no Order; work remained `LEASED` with expired lease, retry count 0 and no lastError. **Provider cancellation is complete; database synchronization and removal of the real customer's card are NOT VERIFIED.** No SQL update, manual lease reset, global runner, session termination or further application database write was executed in this addendum.

New source findings and corrections, confined to this payment task:

- `payment-runner.ts` previously performed its initial database round trip outside the retry loop. A temporary startup outage exited the runner. It now retries readiness with capped 30-second backoff; three consecutive failures emit `payment.recovery.escalation` / `RUNNER_UNAVAILABLE`. A failed `--once` execution still fails rather than reporting acceptance success. Signal handling interrupts backoff before the existing disconnect/log-flush path.
- `PaymentService.runBatch` previously stopped on the first escaping job exception. It now processes the remaining selected jobs serially, logs the affected attempt and then throws an aggregate failure. Claim fencing, provider operations, idempotency keys and transaction rules are unchanged. This fixes within-batch starvation; it is not proof of fairness under a sustained database outage.
- The existing 12-failure incident boundary remains intact. After the incident transaction completes, an explicit `RETRY_BUDGET_EXHAUSTED` escalation event is emitted. An unknown payment is never relabeled PAID/FAILED or canceled based on age.
- Once per minute, a running recovery process inspects up to ten oldest work records requiring attention: INCIDENT work or READY/LEASED work submitted at least 30 minutes ago. It emits opaque attempt/work metadata in `PAYMENT_REQUIRES_ATTENTION`; monitor failures emit `RECOVERY_MONITOR_UNAVAILABLE`. This is a bounded alert sample, not an exhaustive incident export. No customer/card/token data is selected. The query is typechecked but not executed against shared DEV in this pass.
- The old indefinite-wait promise is removed from Cart. Overdue purchases now say confirmation needs attention, offer the existing status-check action and retain a support reference. The card remains truthful while the authoritative backend result is unavailable. Existing live discovery, route identity, Cart B isolation and toast behavior remain intact.

Additional owned files: `apps/backend/src/payment-runner.ts`, `apps/backend/src/services/payment.service.ts`, new `apps/backend/src/payment-recovery-loop.ts` and new `apps/backend/src/services/__tests__/payment-recovery-loop.test.ts`. Narrow hunks preserve the preexisting work in the two backend production files; the local before-edit snapshot is `recovery-hardening-baseline.json`. No schema, migration, pool configuration, AUTH or logging implementation changes were made.

### New verification and operational boundary

Commands actually executed:

```text
# repository root: owner-authorized single provider cancellation
node .cache/payment-lifecycle-followup/inspect-dev-intent.cjs --cancel

# apps/backend: mocked persistence/provider and injected loop dependencies
npx vitest run src/services/__tests__/payment-recovery-loop.test.ts src/services/__tests__/payment.service.test.ts --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run lint

# apps/frontend
npx vitest run src/features/checkout/PaymentPurchases.test.tsx --maxWorkers=1 --no-file-parallelism
npx playwright test -c playwright.payment-recovery-navigation.config.ts
npm run typecheck
npm run lint
```

Final focused results: backend **96/96**, frontend **43/43**, exit 0; both packages' typecheck and lint exit 0. Backend cases include expired-lease recovery of a verified external cancellation without create/capture/cancel/refund/order creation, existing paid/declined/unknown recovery cases, batch isolation, startup failure recovery, capped backoff, monitor failures and escalation. No new broad suite was selected. Earlier accepted tests remain historical evidence as described above.

Fresh Chromium rerun: **10/10 passed, exit 0, 39.7 seconds**, at 390px and 1366px, with intercepted API/provider responses. The first sandboxed launch built successfully but its loopback preview remained unreachable; it was interrupted (exit 1, no test result). The approved elevated rerun then passed. Vite retained the existing bundle-size warning. Final tracked diff check and separate owned-untracked-file whitespace/conflict checks exited 0. Ownership checks found no changes outside the twelve task-owned source/test/config/documentation paths, no migration-byte change and no index change. Evidence: `.cache/payment-lifecycle-followup/cancellation-recovery-evidence.json` and `recovery-hardening-ownership.json`.

No approved disposable PostgreSQL/financial acceptance runtime was established; neither Docker nor psql was found in this shell's command inventory. Actual PostgreSQL restart/failover, webhook delay and new-card Stripe acceptance remain NOT VERIFIED. Unit mocks and intercepted Chromium must not be presented as that evidence. The exact real Test Mode cancellation/readback above is the only new provider mutation.

**Required operational closure:** restore healthy application DB access; use the owner-reviewed, exact-attempt existing recovery path to persist Stripe's verified cancellation; verify CANCELED/DONE, no Order and unchanged independent Cart/inventory before closing the customer's incident. Do not run a global DEV worker as a shortcut. Separately ensure the deployed recovery process is supervised/restarted and route `payment.recovery.escalation` plus missing runner readiness/heartbeat signals to a monitored alert destination. No alert service was configured or notified here. Log emission is verified locally; operator delivery is NOT VERIFIED. A stopped runner cannot monitor its own absence, and infrastructure loss can prevent durable escalation. Genuine unknown provider outcomes require operator investigation and must remain financially unresolved internally.

Task 03.6 remains OPEN; NO PUSH. Provider cancellation does not by itself establish the full production-reliability acceptance criteria.

## 2026-10-16 exact-attempt DEV reconciliation completed

The owner explicitly authorized the proposed update of this attempt and its PaymentWork through the existing recovery workflow. The previously rejected operation was not executed until that new authorization. Command, from `apps/backend`:

```text
npx tsx ../../.cache/payment-lifecycle-followup/reconcile-canceled-dev-attempt.ts
```

**Exit 0; verified at 2026-10-16 12:41:30.126 UTC (15:41:30 Beirut).** The helper checked the exact DEV project/account/attempt/intent and fresh canceled Test Mode provider status, then invoked `PaymentService.process` for this attempt only. All provider mutation methods were disabled; no batch/global worker ran. This time the existing application database path succeeded, without changing connection source configuration, TLS verification, permissions or schema.

| Check | Verified result |
| --- | --- |
| DEV PaymentAttempt | CANCELED; providerStatus canceled |
| DEV PaymentWork | DONE; leaseUntil null; lease token independently verified cleared; no last error |
| Stripe | canceled; Test Mode; received 0; capturable 0 |
| Order | none created or attached |
| Active Cart | before/after hash identical; zero active lines |
| Relevant inventory | before/after hash identical |

An independent Supabase DEV read-only readback confirmed CANCELED/DONE with both lease fields cleared, no Order and no last error. The existing purchase projection classifies CANCELED as FAILED with `pending=false`; this is the normal canceled-purchase outcome, not a fabricated decline. Its terminal outcome can therefore leave Pending purchases through the existing automatic refetch and transition behavior. No attempt was deleted, hidden or manually patched with SQL.

Sanitized operational receipt: `.cache/payment-lifecycle-followup/dev-cancellation-reconciled-evidence.json`. The earlier database-state blocker is resolved for **080806E3**. Browser attachment verification was attempted but the computer-use kernel failed to write assets (`os error 3`); an actual customer-page after screenshot is NOT VERIFIED. No reload, payment submission or notification acknowledgment was performed in the customer's browser.

No production source edits were needed in this step; the previously passing focused tests/typechecks/lint remain unchanged evidence. Broader operational alert delivery and disposable PostgreSQL/Stripe acceptance remain separate unverified requirements. This specific cancellation is now reconciled; that does not establish 100% production-reliability acceptance or close Task 03.6. NO PUSH.

## 2026-10-16 owner-requested Cart presentation change and $349 readback

The owner requested removing the extra **Payment details needed** Cart presentation. This supersedes the earlier presentation decision in this report. `PaymentPurchases.tsx` now uses the existing Processing badge/progress for submitted AWAITING_CUSTOMER_ACTION purchases, with a truthful note directing the customer to any required payment steps. UNKNOWN retains Awaiting confirmation; confirmed terminal outcomes retain the existing failure/success routing, toasts and retry rules. No backend status mapping, payment submission or automatic financial action changed. Updated the corresponding unit and intercepted Chromium assertions in `PaymentPurchases.test.tsx` and `payment-recovery-navigation.spec.ts`.

Verification: PaymentPurchases **43/43 passed**, focused Chromium **10/10 passed** at 390px/1366px (57.9 seconds), frontend typecheck/lint and tracked diff check exit 0. An initial unit launch caught an intermediate dangling-else test edit before running tests; it was corrected and the final 43-test run passed. Browser coverage still verifies confirmed decline moving automatically into Failed payments and confirmed success leaving Pending without reloading. These are intercepted, not real-card acceptance results.

For the new screenshot, a bounded read-only DEV query matched one USD349, quantity-one Apple iPad 10 Wi-Fi 64GB — Yellow attempt created today: `bdf8f98a-f440-4cef-a910-b585f8425080`, intent `pi_3URAQiKiVgdl63pN1Po0ngMG`, expected Test account `acct_1UEZW5KiVgdl63pN`. DEV showed AWAITING_INPUT, READY work, retry count 0, no last error and no Order. Fresh provider readback at 2026-10-16 12:46:43.949 UTC showed **requires_payment_method, no payment method, no last error/decline code, received 0, capturable 0, Test Mode**. This does not establish an authoritative decline. No FAILED state was fabricated, no cancellation/reconciliation mutation was performed for this new attempt, and no conclusions about browser card validation or the historical confirmation request were inferred from the snapshot alone. Sanitized readback: `.cache/payment-lifecycle-followup/dev-349-intent-readback.json`.
