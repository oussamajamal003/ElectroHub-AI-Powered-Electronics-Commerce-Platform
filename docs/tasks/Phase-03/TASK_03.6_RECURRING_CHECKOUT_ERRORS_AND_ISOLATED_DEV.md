# Task 03.6: Recurring checkout and failed-payment errors, and isolated local development

Status: **Task 03.6 remains OPEN.** Nothing here was migrated to shared DEV or PROD, committed, pushed or deployed.

## A. Symptom
On `localhost:3000`:
- the Payment step showed "temporarily unavailable" and no Payment Element;
- the trash icon refused to remove the purchase with the same message;
- a Cart banner sat above Failed payments.

## B. Root cause (end to end)
1. `localhost:3000` (Vite) proxies `/api` to `:5000`.
2. The process on `:5000` is the watched `npm run dev` backend, connected to the shared Supabase DEV pooler.
3. The payment isolation boundary (`src/payment-isolation.ts`) resolved `allowed=false target=shared reason=watched-dev-server-on-shared-target`.
4. Every payment write (setup, dismiss, Try Again) returned 503 `PAYMENT_MUTATIONS_DISABLED`, and the UI showed its maintenance state.

The guard did what it was designed to do. The real gap was that no supported way existed to run the app locally against a disposable database, so the only local stack available was one that is write-disabled by design.

## C. Fix
- **Isolated development tooling.** `apps/backend/scripts/dev-isolated.cjs` is exposed through these `package.json` scripts:
  - `db:isolated:init` — creates the cluster;
  - `db:isolated:start`, `db:isolated:stop`, `db:isolated:status`;
  - `dev:isolated` — runs the backend.

  The cluster it creates:
  - runs PostgreSQL 17 on `127.0.0.1:55434` (loopback only);
  - uses verified TLS (a per-environment CA) and scram authentication;
  - holds the `electrohub_disposable` database, provisioned with `prisma migrate deploy` (into this database only) and the repository seed, using generated test credentials.

  All data lives in the git-ignored `apps/backend/.isolated/`. Every command re-checks the target as loopback plus a disposable name, and proves identity over `verify-full` TLS before use. The backend runs with `PAYMENT_SHARED_MUTATIONS_APPROVED` emptied, so it can never inherit a shared approval.
- **Copy.**
  - `PAYMENTS_UNAVAILABLE_MESSAGE` now reads "Payment actions are switched off on this server, so this change wasn't made. Please try again later." It no longer makes a generic "Nothing was charged" claim, because a refusal can't know anything about charges.
  - "Nothing was charged" still appears where provider evidence supports it: on Declined cards, and on a Place Order failure that happened before confirmation.
- **No Cart banner.** The restriction is explained only inside the trash dialog, where the customer acts.
- **Self-correcting capability.** A 503 refusal on dismiss invalidates the cached `payment-capability` query, so cards stop offering Remove until the server allows writes again.
- **Toast overflow (found during visual QA).** The shared Toast viewport was 390 px wide plus 48 px of padding, so it was clipped on a 390 px phone. Adding `box-sizing: border-box` fixed it.

## D. Running locally (isolated)
```bash
cd apps/backend
PG_BIN=<postgres17 bin dir> npm run db:isolated:init
PG_BIN=<postgres17 bin dir> PORT=5200 npm run dev:isolated
cd ../frontend && E2E_API_PROXY_TARGET=http://localhost:5200 npx vite --port 3200 --strictPort
```
Sign in with the accounts in `apps/backend/.isolated/fixture-credentials.txt`.

To use `localhost:3000` instead, stop the shared-DEV backend on `:5000` and the Vite server on `:3000`, then run `dev:isolated` with no `PORT` (it defaults to 5000) and start Vite as usual.

The Stripe key comes from `.env` and is Test Mode only, so **every Payment step creates a real Test Mode PaymentIntent.**

## E. Verification evidence (2026-10-17)
- **Isolated backend log:** `payment.isolation.resolved allowed=true target=disposable reason=disposable-target`. Identity check: `electrohub_disposable|55434|true`.
- **Playwright** `tests/isolated/failed-payment-dismiss.isolated.spec.ts`, run at 1366×900 and 390×844, **2/2 passed**. The run covered:
  - the capability endpoint reports `paymentsEnabled=true`;
  - no environment banner appears;
  - Try Again is visible;
  - trash → Remove makes the card disappear;
  - the card stays gone after a reload, and after clearing cookies and signing in again;
  - no horizontal overflow.

  The fixtures are DECLINED rows inserted into the disposable database only, with no Stripe intent; dismissal is a database-only write.

  Screenshots are in `apps/frontend/test-results/isolated/dismiss-*.png`.
- **Frontend:** checkout and Toast unit tests 259/259; `tsc` clean; ESLint clean; build OK.
- **Backend:** payment, isolation, routes, webhook and seed tests 400 passed (45 skipped, which need a live database); `tsc` clean; ESLint clean.
- `git diff --check`: no whitespace errors.

## F. Not verified
- **Payment Element rendering on this run.** Reaching the Payment step creates a real Test Mode PaymentIntent, and the authorized allowance is used up. The earlier authorized real runs (`pi_3URYW5…`, `pi_3URZGx…`) and the mocked suite remain the evidence. Status: **NOT VERIFIED (this run).**
- The user's own `localhost:3000` was not switched over: the shared-DEV servers were left running.

## G. Migrations
No shared migration was applied. The schema went into the disposable database only.

## H. Data safety
- No writes went to shared DEV or PROD.
- No Stripe calls were made.
- No financial records were deleted.

## I. Risks
- The fixture rows are hand-written DECLINED attempts. They are valid for the dismiss and list UI, but they don't represent a provider decline flow.

## J. Status
Task 03.6 is **OPEN**.
