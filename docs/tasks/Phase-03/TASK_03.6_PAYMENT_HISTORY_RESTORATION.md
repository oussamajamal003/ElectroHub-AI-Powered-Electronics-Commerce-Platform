# Submitted payment history restoration

2026-10-16. Task 03.6 remains OPEN. NO PUSH. Frontend source correction only; no database or provider operation executed in this work.

## Reproduced cause

The prior fix restored `/checkout?purchase=<attempt>` correctly but did not attach an identity to the original `/checkout?step=review` history entry. `CheckoutDraftSession` detaches submitted drafts when leaving Checkout; showing a terminal toast clears the submitted-purchase discovery pointer. Browser Back to the original entry consequently had neither an attempt nor a discovery pointer. Normal empty-Cart guards then downgraded the route to Shipping and displayed the empty view. The notification cleanup was correct for a new Checkout B; using that same pointer as historical navigation identity was the defect.

Before production edits, a new intercepted Chromium test reproduced this sequence at 390px and 1366px: submit A, reach processing, Cart, publish confirmed decline, show one failure toast, Back. Both failed to restore Payment Failed; error contexts captured the empty Shipping view. No real card was submitted to reproduce it.

## Correction and ownership

- `state.ts`: stores only opaque purchase IDs and browser-entry keys in a separate, customer/scope-specific session record. Notification acknowledgement does not delete these bindings. Inputs are validated; the generic `default` entry is excluded to avoid hijacking an ordinary direct checkout. The newest 100 bindings are retained.
- `CheckoutPage.tsx`: snapshots a history binding when entering an entry, restores the server-owned purchase before Cart checkout initialization, and replaces the reopened URL with explicit `?purchase=<id>`. It does not switch out the active card form when a submission first writes its binding. On durable submission, captured original step-entry keys are bound even if its response arrives after navigation. Checkout B's newer keys are never added to that captured submission.
- `SavedPurchaseCheckout.tsx`: explicit retry submission also binds its original entry before provider confirmation. Reading/restoring that entry never submits a payment.
- `PaymentSessionIsolation.test.tsx`: verifies a late submitted response records A's original entry without confirming its old form or changing B; a bound A entry restores Checking while a distinct new B entry opens Shipping normally.
- `payment-recovery-navigation.spec.ts`: reproduces original history loss, verifies failure restoration after toast, refresh, fresh retry, unresolved re-entry/back/forward, and independent same-product Cart B.

No terminal backend status, Stripe identity, transaction, stock, Cart item or notification-deduplication rule was changed. Toast discovery pointers still clear as before. Ordinary empty checkout without a purchase identity still displays its legitimate empty view. Backend ownership checks remain mandatory for every restored opaque ID.

## Verification

Commands from `apps/frontend`:

```text
npx playwright test -c playwright.payment-recovery-navigation.config.ts --grep 'original checkout history'
npx playwright test -c playwright.payment-recovery-navigation.config.ts
npx playwright test -c playwright.payment-recovery-navigation.config.ts --grep 'original.*history'
npx playwright test -c playwright.payment-success-sync.config.ts --grep 'eligible retry requires'
npx vitest run src/features/checkout/PaymentSessionIsolation.test.tsx src/features/checkout/PaymentPurchases.test.tsx src/features/checkout/SavedPurchaseCheckout.retry.test.tsx src/features/checkout/PaymentRecovery.test.tsx src/features/checkout/paymentObservation.test.ts --maxWorkers=1 --no-file-parallelism
npx vitest run src/features/checkout/PaymentSessionIsolation.test.tsx --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run lint
```

Root command: `git --no-optional-locks -c core.safecrlf=false diff --check`.

Before: original-history Chromium **0/2**, exit 1. After: focused recovery suite **12/12**, exit 0, including both failure-history cases. A subsequent four-case original-history run additionally covers unresolved A with nonempty Cart B. Existing successful-retry journeys **2/2**, exit 0, preserve explicit card/review/submission and authoritative Paid confirmation. These are real Chromium with intercepted API/provider boundaries, not new real-backend financial acceptance.

The first post-fix history run restored the correct failure view but its final assertion incorrectly expected a pre-refresh in-page Stripe fixture counter to survive refresh. The test now checks one original confirmation before refresh and zero new confirmations afterward. The initial unit selection passed 87/88; one asynchronous Review click in the late-submission case was not awaited. Awaiting that validation/update completed the intended interaction. Final isolation rerun **17/17**, exit 0, including the added A-history/B-isolation case. The other 72 focused cases passed unchanged. Typecheck/lint exit 0. Vite retains its existing bundle-size warning.

## Boundaries

History metadata is per tab, customer and scope; it is not a financial source of truth. Clearing/blocking session storage, exceeding its retained entries, or reopening a pre-fix URL whose identity was already erased cannot reconstruct an arbitrary purchase safely. Use the explicit purchase status link in those cases; never guess from products, totals or the active Cart. A reopened identified entry is normalized to an explicit purchase URL for subsequent refresh/direct navigation. Do not keep an old purchase globally pinned to every new checkout.

No shared DEV/PROD writes, Stripe calls, migration, staging, commit, push, CI or deployment occurred in this correction. Previously authorized cancellation receipts remain historical evidence. No new disposable PostgreSQL/Stripe acceptance environment was established. The original screenshot is the actual before reference; generated browser screenshots use synthetic fixtures and are not a claim about a customer's financial outcome.

Final supplemental history checks: **4/4 passed**, exit 0 (1.1 minutes). Mobile restored-failure and desktop restored-processing screenshots were visually inspected. Typecheck/lint and diff check passed; Git index and migration bytes matched the preserved baseline, with no changes outside cumulative task-owned files. Local machine-readable receipt: `.cache/payment-lifecycle-followup/history-route-evidence.json`. The later backend intermittent-recovery addendum remains a separate open acceptance requirement; navigation checks do not certify autonomous recovery.
