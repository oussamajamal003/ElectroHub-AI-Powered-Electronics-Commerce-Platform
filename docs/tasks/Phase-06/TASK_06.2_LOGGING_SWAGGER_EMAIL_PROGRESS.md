# Logging, OpenAPI and email validation — work in progress

Baseline: `feature/06.2-accessibility-qa-ci-cd` at `9e506557b3f84049e4c1fdf27d2abe39e1055159`.

This is not completion evidence. A preliminary in-memory traversal in test mode found 219 distinct operations in the API router, of which 150 lacked a corresponding method/path in the generated specification. This is not a definitive coverage count: it excludes the test-only `/__e2e` routes and does not include top-level mounts such as the webhook or documentation endpoints. The full endpoint inventory, accurate OpenAPI coverage and route-to-spec guard remain outstanding, as do full regression and browser verification. Do not treat the existing specification as complete.

Customer authentication schemas trim surrounding email whitespace before Zod validation. Editable customer and administrator forms use a shared Zod-backed email check, including targeted missing-local-part and missing-domain messages. Administrator invitation and activation pages also show read-only addresses. No database migration is included.

The existing Winston transport retains responsibility for file output, rotation and sanitization. Backend records now carry service and environment fields. Swagger annotation discovery is relative to the source or compiled module instead of the process working directory; complete API documentation remains outstanding.

In a disposable dependency copy, the logging suite passed 48 tests, including file-output and redaction tests; customer schema tests passed 9 tests; three targeted frontend suites passed 53 tests; and Swagger UI/JSON smoke tests passed 4 tests. Frontend and backend typechecks and lint passed (frontend lint reported three existing Fast Refresh warnings). These results do not establish complete error capture, endpoint coverage, browser behavior, or production operation.

## Administrator runtime incident — 2026-11-12

This targeted follow-up preserves the original incomplete-scope disclosure above. PR #58 remains based on `d6b5a84b5661bc69b3c7253e912e93ecede7f9fe`, source `feature/06.2-logging-swagger-email-validation`, target `feature/06.2-accessibility-qa-ci-cd`.

### Confirmed causes and version difference

The reported localhost session ran from another workstream, `feature/06.2-motion-contact-alerts-cart-cloud` at `2e1b2ae989b81f9ba5718abc3162958e2af9063f`. It adds `businessHours` and per-administrator alert acknowledgment. Neither feature exists at PR #58's starting SHA. The user explicitly requested that those features stay out of this PR.

Local server logs confirm StoreSettingsService.getStore failed with Prisma **P2022**, request `f119797a-392c-4966-8564-4da3db0a6d6a`, 2026-11-12 10:59:24 UTC. AdminDashboardService.baseline failed with **P2021**, request `bde24c68-87da-44a5-b917-a58b2a56a0e4`, 10:59:26 UTC. The original authenticated browser session and its Network panel were not available; its exact HTTP exchange is NOT VERIFIED. The unchanged error middleware maps those exceptions to safe HTTP 500. A DEV catalog read independently confirmed the column and table were absent. These are schema rollout failures, not a reason to disable guards or return fake defaults/counts.

### Authorized DEV correction — PASS

The user subsequently authorized: “apply any remaining dev migration”. DEV project identity was verified as `pzxekjybdiulzmssalfo`. The ledger had 38 finished migrations and exactly one pending local migration: `20261114000000_contact_hours_admin_alert_acknowledgements`. Its SQL adds one nullable column and one table with a nonnegative count constraint, cascading user FK and RLS; no rows are rewritten or dropped. Its dependency `20261105000000_admin_security_settings_analytics` was already applied. The SQL was first applied successfully to this task's disposable PostgreSQL.

The existing protected workflow was dispatched at the other branch's exact SHA, with that single approved migration and the chat authorization reference. [DEV migration run](https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/actions/runs/43208017860) successfully passed preflight, ran Prisma migrate deploy and migrate status, but **FAILED its final post-check**: it incorrectly compared the approved names against the now-empty pending list.

A subsequent DEV read confirms all **39 migrations finished**, the column and table exist, and RLS is enabled. The corrected validator in this PR was independently run on that read-only ledger and the exact Git migration blobs from `2e1b2ae`: **pending=[], problems=[]**, retaining checksum verification. Windows checkout CRLF bytes differ from canonical Git blobs; the exact blobs, rather than a permissive checksum exception, were used. No PROD operation, data reset, payment mutation, merge or deployment occurred.

Do not rerun the old workflow to “fix” the already-applied migration: its pre-check correctly rejects an approved migration that is no longer pending. Integrate the validator correction before the next DEV migration run.

### Focused implementation

- `.github/scripts/migration-plan.cjs`: post mode now requires approved migrations to be successfully recorded and nothing pending, while retaining ledger/checksum validation. Pre mode still requires the exact ordered pending approval set. Offline tests reject failed, missing and checksum-mismatched rows.
- `apps/backend/src/middleware/errorHandler.ts`: errors carry HTTP method and registered route template, without original URLs or submitted values. Existing logger, safe error classification and stack sanitization are retained.
- `apps/backend/src/docs/swagger/admin-runtime.openapi.ts` and `openapi.ts`: document both GET contracts, fields, envelopes, distinct authentication requirements and safe 401/403/500 responses. This does not establish global OpenAPI coverage.
- `apps/frontend/src/layouts/AdminLayout.tsx`: explicit alert retry and successful zero-alert announcement. Operational counts and refresh interval retain existing semantics.
- Focused service, Swagger, component and disposable-browser regressions added/extended. Swagger tests share a loopback server after Windows ephemeral per-request listeners repeatedly timed out. No assertion or timeout was weakened.
- `apps/frontend/src/lib/apiBinary.test.ts`: copy fixture bytes into an ArrayBuffer accepted by current DOM Response typing; fixes an existing test-only type error with the isolated dependency installation.

### Real runtime evidence — PASS for the tested PR branch

The repository `task05-2-browser-stack.cjs` provisioned a new TLS-enabled, loopback PostgreSQL database, ran the real Express backend at `127.0.0.1:5288`, and Vite at `localhost:3288`. Synthetic Owner sign-in completed real TOTP enrollment and obtained the normal session. No auth guard was bypassed. The harness skips four pgvector-dependent migrations, as documented by its existing provisioning log; this is not full migrate-deploy repeatability proof.

`GET /api/health`: **200**, healthy. Both target GETs: **200**, private/no-store; Store Information and all supported alert categories rendered after reload. Screenshot inspected at 1280×720: [Store and Alerts](evidence/pr58-admin-runtime/settings-alerts-chromium.png). The screenshot shows actual fixture counts: low stock 1, out of stock 1, paid awaiting fulfillment 19, out for delivery 0. No acknowledgment semantics were introduced.

In the disposable database only, temporarily renaming `store_settings` then `inventory` produced real HTTP **500** failures, visible errors and successful Retry recovery to **200** after restoring each table in `finally`. The actual `error.log` contains sanitized P2021 errors for both operations; [extracted safe evidence](evidence/pr58-admin-runtime/sanitized-schema-errors.json) records method, route, timestamp, service, environment and request ID. Example settings request `e357928e-7e27-4509-9e11-037f14807344`; alerts `29f99146-e1ea-4973-9913-3c6c9b193b4b`. Three requests per endpoint reflect bounded React Query retries, not duplicate HTTP-error events for one request. Runtime log files remain ignored.

### Verification results and boundaries

Commands run from the isolated PR worktree, with environment files disabled for unit/API tests and a nonconnecting disposable URL:

| Check | Result |
| --- | --- |
| `node --test .github/scripts/ci-safety.test.cjs .github/scripts/quality-gates.test.cjs` | PASS: 29 tests |
| backend `vitest run src/services/__tests__/store-settings.service.test.ts src/routes/admin-settings.routes.test.ts src/routes/admin.routes.test.ts --maxWorkers=1` | PASS: 64 tests |
| backend `vitest run tests/swagger.test.ts src/services/admin-operations.service.test.ts --maxWorkers=1` | PASS: 30 tests |
| frontend `vitest run src/pages/admin/AdminSettingsPage.test.tsx src/layouts/AdminLayout.test.tsx src/lib/apiBinary.test.ts src/lib/emailValidation.test.ts` | PASS: 69 tests |
| backend `npm run test:logging` | PASS: 48 tests, real error.log output/redaction/rotation |
| `npx playwright test -c playwright.admin-runtime.config.ts` | PASS: 1 Chromium journey, actual backend/DB failure and recovery |

The final browser rerun also verified real Owner save/reload, plus-addressed support email persistence, inline missing-local-part rejection, exact safe 500 envelopes, request IDs and no-store response headers. Start a **fresh** disposable stack for each run (the synthetic Owner enrolls MFA): from the repository root set `TASK05_2_API_PORT=5288`, `TASK05_2_FRONTEND_PORT=3288` and run `node apps/backend/scripts/task05-2-browser-stack.cjs`; from `apps/frontend` run the Playwright command above. It uses installed Chrome, has traces/videos disabled and never substitutes a successful API response. PostgreSQL 18 and OpenSSL paths can be overridden using the existing harness variables. Both applications' lint and builds passed; frontend lint retains three existing Fast Refresh warnings. Typecheck was rerun after correcting the binary test's DOM type compatibility and the new component test's query options.

Earlier Swagger runs failed with per-request ephemeral listeners (3/5, then 1/5 timed out); the shared loopback server run passed all 5 Swagger tests. Initial browser launch failed because the bundled Playwright browser was absent; the installed Chrome channel then passed. Firefox and WebKit are NOT VERIFIED locally. Existing repository settings/route suites cover defaults, version conflicts, Owner restrictions, validation and unsaved changes with mocked persistence; the real browser evidence is separately identified above. Non-Owner/customer/session revocation behavior was not re-enacted on shared DEV. No claim of original-browser-session recovery or Figma pixel parity is made.

The existing PR head's 19 GitHub checks passed before this follow-up. Final follow-up SHA and CI status are recorded in the PR update after push. The PR remains draft because the original global logging/OpenAPI/email completion scope is still outstanding.
