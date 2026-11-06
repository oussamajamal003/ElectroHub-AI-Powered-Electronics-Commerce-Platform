# Task 05.2 — Implementation Evidence

Single evidence record for Task 05.2 (decisions and contracts: `TASK_05.2_IMPLEMENTATION_PLAN.md`; ADR-011). The initial execution
on 2026-11-05 used base `581726eff055db1dca4778c6e17ce86228509a1f` (`develop`); later corrections were committed and pushed to draft
PR #49. The historical results below are dated by their sections; they are not assertions about every later revision. No merge,
production deployment or production migration was performed. "Disposable" = fresh loopback PostgreSQL 18 cluster per run (no pgvector: the four
vector migrations are skipped and logged, exactly as `scripts/recommendation-fbt-pg.cjs` does).

## Commands and results

| Gate | Command | Result |
|---|---|---|
| Backend typecheck | `apps/backend: npx tsc --noEmit` | exit 0 |
| Backend lint | `apps/backend: npm run lint` | exit 0 |
| Backend CI suite (`test:ci`) on disposable PG | `node scripts/admin-security-pg.cjs --suite=ci` | 2063 passed, 7 failed, 134 skipped → after fixes the remaining failures are environmental (below) |
| 05.2 security + business gate on disposable PG | `npm run test:admin-security:pg` | **18/18** (security 12, settings/analytics/recommendations 6) |
| Frontend typecheck | `apps/frontend: npx tsc -b` | exit 0 |
| Frontend lint | `apps/frontend: npx eslint .` | 0 errors, 4 warnings (react-refresh export hints in new security components) |
| Frontend unit suite | `apps/frontend: npx vitest run` | 1213/1219 in the parallel run; the 5 non-layout failures pass in isolation (124/124); `AdminLayout` nav test updated → 8/8 |
| Frontend build | `npx vite build` | exit 0; all new pages are lazy chunks; main bundle contains no WebAuthn/QR code (verified by grep) |
| Storybook build | `npm run build-storybook` | exit 0 |
| Browser, disposable stack | `npm run qa:task05-2:browser-stack` + `npm run test:visual:task05-2` | **6/6** (Chromium, headless) |
| Browser, live DEV | `npm run test:visual:task05-2-live-dev` (localhost:3000 → local Express → DEV) | **2/2** |
| DEV migration | `node scripts/admin-security-migrate.cjs pre` / `deploy` | identity `pzxekjybdiulzmssalfo` verified on both URLs; ledger 29→30; `pending: none`; `migrate status` up to date |

Environmental failures in the local `test:ci` run (not code defects): `tests/swagger.test.ts` first request exceeds 5 s only under the
parallel local run (passes alone, 4/4; CI runs single-worker); `src/lib/db-request-metrics.test.ts` targets a separate pre-existing local
cluster (`.isolated/env.json`) that is not running on this machine (skipped in CI). Payment suites must not run against `.env` (shared DEV):
the payment-mutation gate refuses them by design; they pass on the disposable cluster.

## Defects found and fixed during verification

| Found by | Defect | Root cause / fix |
|---|---|---|
| Disposable PG suite | Loser of a concurrent TOTP submission got `429 too many attempts` | Attempt counter ran on an already-consumed transaction → now `401 MFA_CHALLENGE_INVALID` |
| Lane review | Pinned items in organic rails credited to the engine's strategy | Signed token carries `featuredProductIds`; events stored as `MERCHANDISED_PIN` (old tokens still verify) |
| Lane review | "Invitation accepted" preference had no sender (fake setting) | Inviter notification implemented, preference-governed, after commit |
| Lane review | Retry review showed the seed shipping price after a configured change | Uses the attempt's immutable `shippingCost` |
| Lane review | Bulk audit failure after committed rows → 500, truthful results lost | Audit failure logged, results returned |
| Lane review | Security UI DTO mismatches (sessions/login history/profile/team/delivery enum) | Backend DTOs aligned to the UI contract |
| Lane review | Image-search result selection never sent | Signed, keepalive, fire-and-forget event from the result click |
| Frontend build | Admin login (WebAuthn/QR) eagerly in the storefront bundle | Route made lazy |
| Browser 390px | Recommendations overview overflowed the page by 346 px | Tables wrapped in a focusable horizontal scroll region |
| Visual comparison | Analytics period control under the description; revenue as a spiky line | Control on the title row (reference); bar chart (reference) |
| Visual comparison | Category table clipped in a half-width card at 1440; dead space in stretched panels | Pair side-by-side only ≥1600 px; `align-content: start` |
| CI-equivalent run | Route tests minted session-less ADMIN tokens | Tests use a live-session fixture; session-less behaviour asserted separately |

## Acceptance summary (A01–K12)

| Group | Status | Evidence |
|---|---|---|
| A01–A06 repository/architecture | PASS | baseline table in plan; session-issuance audit; screenshots opened (Analytics, Settings, Login); lanes with disjoint ownership |
| B01–B04, B06 schema/migrations | PARTIAL | migration `20261105000000` (additive, CHECKs, partial unique index, RLS); disposable SQL upgrade over legacy rows (B03 test); original DEV gate results reported above. The disposable harness uses psql with four pgvector-dependent migrations skipped: it does NOT prove Prisma ledger/checksum integrity or a repeat-deploy no-op. Full-chain migration verification remains a CI/release gate. |
| B05 encryption/retention/cutover | PASS | versioned AES-GCM key ring, fail-closed 503, operator CLI, 90-day login-history window, analytics 400-day purge, ADR-011 release order |
| C01–C06 invitations | PASS (API, disposable) | C01–C05 test; bootstrap/enrollment window via CLI |
| C07 team UI | PARTIAL | page renders at 390–1920 with real data; create/resend/revoke UI not clicked in the browser run |
| D01–D07 MFA | PASS | disposable API tests + browser enrollment/wrong-code/recovery-codes journey; live DEV shows no session from a password |
| D08 login UI vs reference | PASS | login captured at 390/768/1440/1920 vs `Admin login.png`; MFA step/enrollment states captured |
| E01–E02 passkeys | PASS (virtual authenticator) | browser registration + passkey sign-in with Chromium virtual authenticator; physical device NOT VERIFIED |
| E03–E07 sessions/history/profile | PASS | revocation ends access+refresh (API); two sessions listed in browser; password change revokes all; last factor 409 |
| F01–F06 settings/shipping/notifications | PASS | nav; store save+reload (browser); shipping changes new quotes, revision changes, history untouched, 409 on stale version (disposable); maintenance/digest omitted |
| F07–F08 settings visual/states | PARTIAL | four tabs captured; Store/Shipping compared with references; Settings stories cover requested form states; 200 % real browser zoom NOT VERIFIED |
| G01–G09 recommendations | PASS | pin featured/dedupe/archive/expiry/preview-no-events on real PG; config 409; FastAPI outage fallback covered by existing suites |
| G10 recommendations UI | PARTIAL | all four tabs captured and overflow-checked; pin dialog not driven in the browser |
| H01–H08 analytics pipeline | PASS | signed image-search selection, dedupe, no image/identity columns, consent-only attribution, server-authoritative outcomes |
| I01–I09 analytics page | PASS | revenue/orders/AOV/CTR/conversion reconciled on real PG; 7/30/90/12m in browser |
| I10 analytics visual | PASS | compared with `Analytics page.png`/`Analytics_page.png`; 390/768/1440/1920 captures |
| J01–J03 bulk | PASS (API/unit) | per-item outcomes, bounded, shared policy; browser selection only rendered, not executed |
| J04–J10 UX/a11y/perf | PARTIAL | overflow checks at 4 widths on 14 pages, keyboardable radiogroup/tabs, lazy chunks; real 200 % zoom, reduced-motion and screen-reader passes NOT VERIFIED |
| K01–K08, K10 | PARTIAL | commands above; security/financial paths and lane diffs inspected. Full independent review of every changed file is not certified; browser/a11y gaps remain as recorded. |
| K09 CI on PR head, K11 release, K12 Architect | PARTIAL | PR #49 exists and earlier head CI passed; release and independent final approval remain separate gates. Check the current PR head for current CI. |

## Live DEV status and the remaining operator step

At the initial handoff DEV had the migration but no owner or enrolled administrator. The owner later reported running the two commands
below. A subsequent read-only DEV check confirmed the owner has team-management permission and one active TOTP factor. The owner reports
completing enrollment and storing recovery codes privately. The commands are retained for operator history, not a request to repeat bootstrap:

```
npx tsx scripts/admin-security.ts grant-owner admin@electrohub.com --confirm-target=pzxekjybdiulzmssalfo
npx tsx scripts/admin-security.ts authorize-enrollment admin@electrohub.com --hours=24 --confirm-target=pzxekjybdiulzmssalfo
```

The agent did not run these operator commands. The owner reports successfully accessing the dashboard, but independent authenticated
admin browser journeys on DEV remain NOT VERIFIED because the desktop browser connection failed. A separate customer browser login succeeded on DEV; it did not verify the full
customer recommendation, consent, and image-search journey. Sign-in may write authentication challenge or security-event records.

## Owner-authorized review corrections (2026-11-05)

After Stage 1 returned Request Changes (provisional 76/100), the owner authorized continuing the remaining stages, including corrections
and Git/PR finalization. This does not retroactively turn the earlier review into independent approval. Publication is as a draft until
the final CI and independent acceptance gates are resolved; no merge, deployment or PROD migration is authorized or performed.

All six reported defects were corrected:

- Single-session revocation disconnects the account's existing delivery sockets after commit (valid other sessions reconnect). ADMIN
  subscription requests also recheck their live MFA session; a real Socket.IO regression covers revocation after handshake.
- Recovery verification computes candidate digests using retained key-ring entries; new codes still use the active key. No schema or
  migration rewrite is needed. Real-PG tests prove pre-rotation codes remain single-use after active-key rotation.
- Analytics formats fractional growth as a percentage. Story/test fixtures now use the backend ratio contract.
- Store, Shipping and Notification drafts retain the version they were opened against until explicit save/reload remounts the form.
  Rerender regressions prove a background refetch cannot silently authorize an old draft with a new version.
- Admin login checks `response.user.role`, with customer-denial mocks updated to the real response envelope.
- Invitation password validation/help matches server policy and displays server field errors inline.

Correction validation: frontend focused suites 51/51; backend crypto/socket suites 30/30; disposable security/business suites 19/19;
root typecheck passed; root lint passed with four Fast Refresh warnings. Broader tests/build/browser results and the actual PR head CI
must be recorded separately when completed. The local SQL harness comments have been corrected to remove unsupported Prisma-ledger claims.

### Finalization validation (current correction delta)

| Command / scope | Actual result |
|---|---|
| Root `npm run typecheck` | PASS, frontend and backend |
| Root `npm run lint` | PASS, four Fast Refresh warnings |
| Root `npm run build` | PASS, frontend and backend; existing Sass division and bundle-size warnings remain |
| Focused frontend Login / Invite / Settings / Analytics | 51 passed |
| Backend crypto / Socket.IO | 30 passed |
| `node scripts/admin-security-pg.cjs` | 19 passed, real disposable PostgreSQL; includes retained-key recovery and session revocation |
| Root `npm run test:frontend` | 1,224 passed, 2 failed (routing lazy-home heading and unsaved-changes dialog timeouts) |
| Isolated frontend rerun of both failing files, `--maxWorkers=1` | 6 passed; no source or test weakening |
| Backend `CI=true node scripts/admin-security-pg.cjs --suite=ci` | 2,074 passed, 5 failed, 134 skipped. Four failures were logging/OpenAPI timeouts; the real-adapter metrics test reads a separate pre-existing `.isolated/env.json` target rather than the harness database |
| Isolated backend `--suite=ci --files=tests/logging-continuity.test.ts,tests/swagger.test.ts` | 27 passed on a fresh disposable database; no timeout overrides |
| Frontend `npm run test:visual:task05-2` | 6 passed on disposable API/PostgreSQL, synthetic identities, Chromium virtual authenticator |

Browser verification now executes second-session revocation and confirms the revoked browser returns to login. Invitation verification
executes password-policy rejection, acceptance, TOTP enrollment, recovery acknowledgement and console entry. The run also covers settings
save/reload and page-overflow assertions at 390/768/1440/1920. Updated invitation (390) and analytics (1440) screenshots were opened;
the repository Analytics reference was inspected. This is rendered-flow evidence, not a new certification of exact Figma parity or all
accessibility criteria. Physical passkeys, actual 200% browser zoom and screen-reader/reduced-motion acceptance remain NOT VERIFIED.
An initial restricted browser run was stopped because its frontend was unreachable; the permission-enabled rerun above passed.

Full-suite results remain recorded as failures despite successful isolated reruns. The separate metrics-database target was not changed
or written to. Shared DEV provisioning, PROD migrations, deployment and merge were not performed in this finalization run.
Actual remote CI and review status belong to the draft PR's exact head; this document does not assert them before execution.

### PR CI correction

Draft PR #49 was created against `develop`. The first remote migration-policy failure exposed a historical delivery-migration fixture
that incorrectly treated every newer checked-in migration as already applied. The fixture now reconstructs the checkout at that delivery
cutover and explicitly asserts that applying a later migration still makes the older gap unsafe. Migration ordering enforcement is unchanged.
`node --test .github/scripts/ci-safety.test.cjs`: 26 passed; `node .github/scripts/check-workflow-policy.cjs`: passed.
The owner explicitly requested automatic CI fixes; subsequent status must be checked on the pushed correction SHA.

On `ff641fb`, remote backend CI passed (2,059 passed, 154 skipped), and the migration, policy, security-audit, typecheck, lint and build
jobs passed. Frontend CI exposed a real refresh race: inspecting cloned 401 streams could delay a second response beyond completion of
the shared refresh, causing another rotation. The transport now parses each JSON body once and retains that payload for final error
handling, then reuses a replacement token if rotation completed after the original request was sent. ADMIN_SESSION_INVALID still ends
the session without refreshing. A delayed-401 regression failed before the correction (two refreshes instead of one), then passed;
API JSON/binary, admin auth-context and login suites: 52 passed. Bounded 409 retry and cancellation assertions remain intact.
Frontend typecheck, lint (four existing warnings) and production build also passed after the transport correction.

### Focused closure pass (working tree based on PR head `fdf36f8`)

- **ANA-03:** last-click selection is per purchased item, ordered by event time then interaction UUID. Disposable PostgreSQL
  `admin-features.admin-pg.integration.test.ts` verifies the selected stored interaction, absent consent, expiry, failed/refunded
  payments and deduplicated purchase totals; the security/business suite passed 20/20 with four documented pgvector skips.
- **C01–C05:** invitation creation and resend reserve cooldown before delivery; completion is fenced by token hash. The focused
  service tests reproduce concurrent resend and cover initial-send overlap, stale completion and retry after failure.
- **F07:** a failed conflict reload now preserves the draft and exposes retry. `AdminSettingsPage.test.tsx` passed 20/20; 13 Settings
  stories use production forms and synthetic API responses and passed focused local Chromium checks.
- **I10:** Analytics Dashboard breadcrumb points to the actual `/admin` route; page tests passed 12/12. Unsupported WebAuthn actions
  are disabled in login and step-up, with 14 focused tests passing.
- **K01:** disposable browser frontend uses a strict port and is never reused. An occupied port caused the suite to fail before tests;
  on a fresh disposable stack all six existing browser journeys passed, including virtual passkey and four-width overflow checks.
- **K09:** CI migration verification now asserts a second `migrate deploy` is a no-op on the guarded disposable database. Local
  workflow policy and safety tests passed (26/26); the actual assertion awaits CI on the new pushed head.
- **Focused final checks:** root `npm run typecheck`, `npm run lint`, and `npm run build` passed; frontend lint has four Fast Refresh
  warnings, and the builds retain existing Sass division and chunk-size warnings. `npm run build-storybook` passed; 13 Settings
  stories passed the focused Chromium interaction checks. `npm run test:frontend` passed **1238/1238** (149 files).
- **Full backend suite limitation:** `npm run test:backend` was attempted once and failed **679 tests**, passed 1293, skipped 36;
  32 suites could not load (73 failed, 81 passed, 5 skipped files overall). The local default runner has missing/unavailable
  integration dependencies and logging/database environment (including unloaded integration suites and timeouts). The focused
  security/business disposable PostgreSQL suite passed 20/20, and earlier GitHub backend CI on `fdf36f8` passed 2059/2059 with
  154 skipped. The final pushed SHA still requires new CI.
- **Expanded disposable browser:** 9/9 passed: owner TOTP enrollment and recovery acknowledgement on synthetic disposable identity,
  page routes and 390/768/1440/1920 overflow, invitation create/resend/revoke, pin search/add/edit/pause/remove, partial bulk archive,
  settings save/reload, virtual passkey, session revocation, invitation acceptance, and logout. Recovery/enrollment screenshots were
  removed and the reusable browser spec no longer captures them.
- **DEV:** read-only project identity `pzxekjybdiulzmssalfo`; all 30 Prisma ledger entries are finished, none rolled back. Owner is
  enrolled with one active TOTP factor. The owner reports accessing the dashboard and privately saving recovery codes; independent
  browser verification of that session is NOT VERIFIED because the computer-use native pipe could not connect after recovery.
  Customer browser login returned HTTP 200 and displayed the authenticated account menu; further customer actions were not verified.
- **A04/K06:** all seven task screenshot references were visually opened and compared with prior disposable captures. Login keeps a
  centered form but moves the brand inside the card; settings uses structured address fields, a fixed currency and only implemented
  preferences; analytics uses truthful data/tables instead of the prototype's illustrative session duration. These captures are not
  a claim of exact pixel parity. Actual 200% browser zoom, manual screen reader and physical passkey remain unverified.

### Owner MFA addendum and final acceptance evidence

The owner corrected the account mismatch: the earlier screenshot showed the expected fail-closed `ENROLLMENT_NOT_AUTHORIZED` response
for `admin1@electrohub.com`. It is not evidence of an MFA bypass or implementation defect. The authorized owner account is
`admin@electrohub.com` on shared DEV identity `pzxekjybdiulzmssalfo`. The owner reports that enrollment completed and the authenticator,
recovery codes, and dashboard access are in place; secrets and one-time codes were not requested or recorded. No bootstrap was repeated
and no additional administrator was authorized. A read-only database check previously confirmed the project identity, completed
migration ledger and one active TOTP factor.

| Acceptance ID | Route/action and environment | Expected / actual | Status and evidence |
|---|---|---|---|
| D01 | `/admin/login`, shared DEV, wrong account `admin1@electrohub.com` | Non-authorized account is denied; screenshot shows `ENROLLMENT_NOT_AUTHORIZED` | PASS for fail-closed denial; user attachment in this task |
| D02 | `/admin/login` → MFA enrollment → dashboard, shared DEV, owner account | Owner reports successful private enrollment and dashboard access; agent did not obtain browser DOM/network evidence because the connected desktop browser channel was unavailable | NOT VERIFIED by agent; owner report plus read-only DEV identity/factor check |
| D03 | Password-only admin login, disposable PostgreSQL + local Playwright | Password alone cannot enter; TOTP/recovery acknowledgment gates the dashboard | PASS; `apps/frontend/tests/visual/task05-2-admin-disposable.spec.ts`, 9/9 final run |
| ANA-03 | Analytics conversion, disposable PostgreSQL | Latest consented same-product click before each paid item wins deterministically; no-consent, expiry, failed and refunded payments do not attribute | PASS; `apps/backend/src/services/admin-features.admin-pg.integration.test.ts`, stored-fact assertions in `node scripts/admin-security-pg.cjs` (24/24) |
| C07/G10/J01 | Invitation, featured-product and bulk dialogs, local browser + disposable PostgreSQL | Create/resend/revoke; pin search/add/edit/status/remove; real bulk selection and partial result | PASS; Playwright disposable suite (9/9) |
| F01–F08 | Settings Store/Shipping/Notifications, Storybook with synthetic API boundary; browser flows against disposable API | Real production forms render requested populated/dirty/validation/pending/success/failure/conflict states; save/reload and shipping quote remain consistent | PASS; 13 Settings stories, `npm run build-storybook` succeeded; browser suite 9/9 |
| J04/K06 | Responsive behavior, local Playwright | CSS widths 390, 529, 768, 1440 and 1920 have no horizontal page overflow on tested pages; reduced-motion and Escape behavior exercised | PASS for listed widths and automated reduced-motion/Escape checks; final screenshots under `apps/frontend/test-results/task05-2-disposable/screens/` |
| J04 | Actual browser zoom at 200%, local browser | Must use native browser zoom and inspect layout after the overflow correction | NOT VERIFIED post-fix; browser automation did not change native zoom, so viewport/device scale was not treated as proof |
| K01 | Changed-file source/diff coverage, PR branch diff against `origin/develop` | Every changed path read and reconciled across backend, frontend and supporting lanes | PASS; 190/190 paths, no remaining material findings after fixing the recovery-dialog accessible title |
| K09 | Migration deploy repeat/no-op, disposable CI database | Second `prisma migrate deploy` reports no pending migrations | PENDING final CI on the pushed SHA; workflow assertion added, not claimed as locally verified |
| K12 | Independent Architect decision, final pushed SHA | Explicit score and Approve/Request Changes/Reject after reviewing the final SHA | PENDING independent review; no approval is inferred from lane coverage |

The final disposable Playwright run passed 9/9, including invitation dialogs, featured-product edit/pin actions, bulk archive partial
result, settings save/reload, virtual WebAuthn, session revocation, logout/protected-route rejection, keyboard Escape and automated
reduced-motion behavior. Chromium virtual-authenticator coverage is not physical-passkey hardware QA. Actual 200% zoom after the final
CSS correction and a manual screen-reader pass remain NOT VERIFIED. The Figma Make references were compared by screenshot content;
two settings filenames are transposed relative to the task table, so comparisons used the visible Store/Shipping/Notifications content.
Differences recorded above are intentional implementation choices; pixel parity is not asserted.

Final local checks on the closure worktree: root typecheck PASS; root lint PASS with four Fast Refresh warnings; root frontend/backend
build PASS; Settings Storybook build PASS (existing Sass division and chunk-size warnings). The full frontend suite ended with 91
passing files, 58 failed suites, and one failed test; isolated routing, HomePage and Tooltip rerun passed 8/8. The full backend suite
ended with 72 failed files, 82 passed, 5 skipped; 674 tests failed, 1300 passed, 36 skipped, 7 errors. The primary integration load
error was `DATABASE_TEST_TARGET_REQUIRED`; affected integration suites did not load under the local default environment. These full
suite results are failures and are not represented as green. Focused disposable PostgreSQL business/security coverage passed 24/24,
and focused frontend regressions passed as recorded above. No shared DEV writes, production access, migration, merge or deployment
occurred during this closure pass. CI and Architect status must be attached to the exact final pushed PR SHA before an approval claim.

### Premium admin refinement — 2026-11-05

- Analytics now presents ranked products, per-currency category shares, customer acquisition and repeat-buyer context,
  recommendation attribution and breakdowns, image-search outcomes, inventory proportions and delivery status counts using
  the existing API values. Recommendation management has icon-led tabs, content-shaped loading states and real preview products.
  Settings has grouped store fields, dirty feedback and form-shaped loading states. Login and step-up MFA selectors use matching,
  keyboard-operable method cards; their authentication flows remain unchanged.
- On a local disposable stack, `npm run test:visual:task05-2` passed 9/9, including 390/768/1440/1920 CSS-pixel overflow checks,
  synthetic settings persistence, pin and invitation workflows, virtual WebAuthn and logout. Screenshots in
  `apps/frontend/test-results/task05-2-disposable/screens/` were inspected for Analytics, Recommendations, Shipping and login MFA.
  A 390px synthetic Storybook screenshot of the step-up dialog was also inspected at `apps/frontend/test-results/step-up-story-mobile.png`.
  The first run exposed horizontal overflow from accessible tables, and a Shipping screenshot showed a sticky action covering
  options; both were corrected and the affected browser suite passed. Category bars now use the API's per-currency share.
- Focused frontend tests, typecheck, lint, build and Storybook build passed; lint has four existing Fast Refresh warnings and builds
  report existing Sass/bundle warnings. The browser and local checks ran with concurrent workspace edits subsequently committed
  separately, so they are evidence of that working tree and do not alone certify the final commit. Native 200% browser zoom and the complete
  authenticated shared-DEV journey remain NOT VERIFIED. No production write or deployment was performed.

| Refinement acceptance | Status | Evidence / remaining scope |
|---|---|---|
| UI-01–UI-07 Analytics sections | PARTIAL | Production Analytics page and focused tests cover source-backed values and rankings; disposable screenshots inspected. Complete tooltip and per-section interaction coverage is not established. |
| UI-08 Recommendations | PARTIAL | Recommendation page tests and disposable pin journey pass; preview, loading and tab stories exist. Full browser coverage of every loading/error/preview state remains open. |
| UI-09 Settings | PARTIAL | Settings tests and disposable save/reload pass; Store, Shipping and Notifications skeleton stories exist. Team page uses its own loading UI. |
| UI-10–UI-14 MFA | PARTIAL | Login and step-up selectors, OTP tests and virtual passkey journey pass; step-up Storybook screenshot inspected. Browser cancellation/timeout and every error/expiry state were not all rerun. |
| UI-15–UI-17 Skeletons | PARTIAL | Analytics and Recommendation sections and three data-loading Settings forms have section-shaped placeholders; the Settings Administrators tab is a direct link and has no request/loading state. |
| UI-18–UI-19 Refetch and feedback | PARTIAL | Existing React Query data retained during background refresh; focused tests cover selected loading/error/empty cases, not every partial failure. |
| UI-20–UI-21 Responsive and accessibility | PARTIAL | Disposable Playwright exercised 390/768/1440/1920 page overflow, reduced motion and Escape; focused tests cover Radix arrow navigation. Native 200% zoom and manual screen reader remain unverified. |
| UI-22 Clipping and pending | PARTIAL | Tested page overflow and two visual defects corrected; no claim that every pending/error state was inspected. |
| UI-23 Visual references | PARTIAL | Analytics, Settings and login reference images and selected rendered screenshots inspected; no reference exists for every new section and exact pixel parity is not claimed. |
| UI-24 Storybook and tests | PARTIAL | Storybook build, focused tests and disposable Playwright pass; the full requested story/state matrix is not independently exercised. |
| UI-25 Contracts | PARTIAL | No backend or authentication protocol changes in this refinement; focused tests and disposable journeys pass, but this is not a full security or finance audit. |

### Owner follow-ups — 2026-11-06

- **Admin sign-in 500 (fixed, `a552622`).** The MFA login transaction took 7.7 s against the remote DEV pooler, past Prisma's 5 s
  interactive-transaction default, so it expired midway. Every `AdminMfaService` transaction now has a 15 s budget (the same as
  `AuthRepository`). Reproduced and confirmed with a rolled-back call on DEV; no row was written.
- **Admin password minimum lowered to 8 (owner decision).** `admin-security.controller.ts` and `AdminInvitePage` now agree on 8
  characters; uppercase, lowercase and a number are still required, and MFA is still mandatory. The invite form shows each rule
  problem as a live field error and clears server errors on edit.
- **Customer analytics.** Customer growth (running total and per-day/month sign-ups), Repeat customers (ring), Avg. orders per
  customer (`ordersPerCustomer`, new) and Avg. session duration (`sessions`, new) on `GET /api/admin/analytics/customers`.
  Repeat buyers now count distinct paid orders, matching their documented definition (previously counted payments).
- **Storefront session telemetry (supersedes the earlier "no session duration" decision; owner-requested).** `POST
  /api/analytics/events` accepts `storefront.session` with a random per-tab UUID (sessionStorage) and the tab's visible time in ms
  (0–4 h, strict schema, existing 60/min/IP limit). Stored in the existing `analytics_events` table (no migration) as one row per
  tab, upserted to the largest reported total. No account, cookie, URL or IP is stored; the 400-day retention purge applies.
  Sessions under 1 s are ignored in the average. Like any anonymous client metric, it can be inflated by a scripted client within
  the rate limit; it is a trend indicator, not an audited figure.
- **Admin UI.** Breakdown bars use a shared, colour-blind-checked 8-slot palette (`features/admin/shared/chartColors.ts`) with
  state colours for stock and image-search outcomes; navigating to another admin page starts at its top.
- Verification: backend analytics/events/admin tests and the full frontend suite (154 files, 1266 tests) passed locally;
  typecheck and lint clean apart from existing Fast Refresh warnings. Visual QA: NOT VERIFIED (no browser session with an
  admin sign-in in this pass). No production write or deployment.
- Correction to the follow-ups above: the shared administrator transaction budget is now `{ maxWait: 10 s, timeout: 30 s }`
  (`apps/backend/src/lib/transaction-options.ts`) for MFA, team (invitation accept) and account transactions. On DEV seven
  read round trips measured 13.3 s, so 15 s was not enough for invitation acceptance (which failed with a 500 and rolled back).

### Addendum — Admin Profile: Change Password and Danger Zone (2026-11-06)

**Backend** (no migration; additive endpoints under the existing `adminGuard`: DB ADMIN role + live MFA session + no-store):
- `POST /api/admin/me/password` (`requireStepUp`, 5 per 15 min per admin): strict body; administrator password policy; reuses
  `AuthService.changePassword` (bcrypt verification, hashing, every refresh family and AdminSession revoked under the token-lifecycle
  lock, `PASSWORD_CHANGED` security event, notification email); adds `ADMIN_PASSWORD_CHANGED` audit, drops sockets, clears the
  refresh cookie. Rejects reuse of the current password. `POST /api/auth/change-password` now refuses ADMIN tokens
  (`ADMIN_ENDPOINT_REQUIRED`), so the step-up cannot be bypassed through the shared route.
- `POST /api/admin/me/delete` (`requireStepUp`, same limiter): `{ currentPassword, confirmation: "DELETE" }`, strict (no target id).
  Password verified outside the transaction, re-checked inside it. Under the user's token-lifecycle lock (and, for an Owner, the
  shared `admin_owner_lifecycle` advisory lock with an in-transaction count of other active Owners) the account is anonymized and
  disabled in place (`deleted-admin-<id>@deleted.invalid`, no password, inactive), never row-deleted, so orders, inventory, delivery
  and audit foreign keys stay intact. Refresh families and admin sessions revoked; MFA factors, recovery codes, passkeys, OTP/reset
  tokens and OAuth links deleted; open challenges consumed; pending invitations this admin sent revoked; capabilities cleared
  (nothing transferred). `ACCOUNT_DELETED` security event and `ADMIN_ACCOUNT_DELETED` audit kept. Sockets dropped after commit.
  Errors: `INVALID_CURRENT_PASSWORD` 400, `STEP_UP_REQUIRED` 403, `LAST_OWNER` 409, `ACCOUNT_INACTIVE` 409, `ACCOUNT_CHANGED` 409.
- Profile adds advisory `deletion: { allowed, reason: 'LAST_OWNER' | null }`.

**Frontend:** Profile order Personal details → Role and access → Change password → Security → Danger Zone. Change Password
reuses `PasswordInput` and the shared admin password rules (`features/admin/security/passwordPolicy.ts`), live field errors,
single submission, `useStepUp` retry. Danger Zone dialog: identity, consequences, current password, exact `DELETE`, step-up;
destructive button disabled until valid; Escape closes and focus returns to the trigger; failures keep the session. After
either action the client clears auth state and private caches and opens `/admin/login` with fixed-copy notices.

**Verification (local):**
- Disposable PostgreSQL (`node scripts/admin-security-pg.cjs`): 29/29, including PW-01 (step-up, wrong password, policy,
  all sessions and refresh revoked, audit/security events, old password refused), DEL-01 (non-owner deletion, strict body, no
  cross-account id, history kept, login/refresh/access refused), DEL-02 (last Owner blocked; with a co-Owner allowed after
  step-up; no ownership transfer), DEL-03 (two Owners deleting concurrently → exactly one succeeds, one active Owner remains),
  DEL-04 (customer change-password unchanged; admin endpoints refuse customers).
- Backend focused tests 302 passed (6 suites need a test database target and did not run); `tsc` build passed.
- Frontend: full suite 155 files / 1283 tests; typecheck, lint (existing Fast Refresh warnings only) and production build passed.
- Playwright on fresh disposable stacks (`npm run test:visual:task05-2-account`): 4/4 — last-Owner block, live validation,
  show/hide, step-up dialog with a real TOTP and real retried change, every session ended, old password refused; invited
  admin deletes self (keyboard Enter, Escape/focus return), post-deletion login/refresh/protected route refused. Screenshots at
  390/768/1440/1920 and a 720 px reflow (200%-equivalent) were inspected; a sticky action bar covering the confirm field and
  missing list bullets were found and fixed, then re-captured.
- Limits: the browser step-up dialog was triggered by answering the first password request with the server's `STEP_UP_REQUIRED`
  body (a fresh sign-in is inside the 10-minute window); server enforcement itself is proven by PW-01/DEL-02. Native 200% browser
  zoom: NOT VERIFIED (headless). Customer deletion integration suite runs in CI only. No shared DEV or PROD deletion was performed.
