# Task 06.2 — Accessibility, QA and CI/CD

Status: **IN PROGRESS**. Scope: ROADMAP §9 / 06.2. Baseline: latest `origin/develop`
`9cae8647593bd3d48f2faef39552ae5da497f44f`, including merged Task 06.1 PR #50.
Branch: `feature/06.2-accessibility-qa-ci-cd`. No merge or production deployment authorized.

## Acceptance and resources

WCAG 2.1 AA is the baseline. Automated axe results are evidence for tested states, not a compliance certification.
Reuse 06.1 real-backend Playwright journeys, per-project synthetic identities and disposable TLS PostgreSQL.
No shared database or provider credentials are permitted. Captured email only; payment unavailable path only in browser QA.
Payment concurrency/lifecycle integration uses the existing fresh-instance proof and resets only its marked disposable database.
Actual Stripe Elements, provider delivery, trained-model latency, assistive technology and native browser zoom require distinct evidence.

| Area | Requirement / current foundation | Baseline gap / severity | Resolution and verification | Status |
|---|---|---|---|---|
| Customer shell | Keyboard bypass of repeated header | No skip link / Medium | Shared shell link and focusable main; browser Tab/Enter test | Pending final run |
| Input / PasswordInput | Error association and instructions | Caller ARIA spread masks errors / Medium | Merge described-by IDs, error wins invalid state; regression test | 12 targeted tests pass |
| Select | Error announced with control | No invalid state/error ID / Medium | Trigger association; regression test | 12 targeted tests pass |
| Shared text | Normal text contrast | Slate 400 on pale surfaces / High | Existing Slate 600 palette; rendered axe checks | Pending final run |
| Account sign-out | Action text contrast | Error red fails normal text / Medium | Existing error foreground token | Pending final run |
| Search/auth dialogs | Containment, Escape, return focus, names | Existing Radix; no systematic 06.2 scan | Keyboard interactions plus active-dialog axe | Pending final run |
| Customer templates | Home, listing, detail, empty cart/wishlist, account, orders | No complete semantic scan | Quality suite screenshots, roles, WCAG scans | Pending final run |
| Admin templates | MFA, dashboard, products, inventory, orders, delivery, settings | No complete semantic scan | Existing MFA helper plus scans/screenshots | Pending final run |
| Reduced motion | Existing MotionConfig and CSS reduce | Browser evidence missing | Media emulation and active-animation assertion | Pending final run |
| Functional journeys | Existing release suite | Current task SHA unverified | Reuse 06.1 suite, injected search outage/empty states | Pending final run |
| Responsive | Existing six release projects | 320 and 1024 coverage missing | Quality projects at all six required widths | Pending final run |
| Native zoom | Actual browser 100% / 200% | Desktop helper cannot initialize / environment | Both node/sky and CUA fail writing kernel assets; viewport tests are separate | NOT VERIFIED |
| Cross-browser | Chromium, Firefox, WebKit | Current task SHA unverified | Real browser engines in CI and local | Pending final run |
| Performance | Lazy routes, paginated APIs | No repeatable measurements/budget | Bundle gzip guard, route/resource/API read samples | Pending final run |
| CI tests | Existing unit/API and release jobs | Optional frontend tests; payment PG silently gated | Mandatory test command; dedicated disposable payment job | Pending remote run |
| Docker | Existing three Dockerfiles | Frontend/backend not built in CI; unlocked install; backend client absent | Lockfile install, explicit generation, SPA fallback, image smokes | Pending remote run |
| Quality gate | Existing parallel checks | No aggregate required gate | Fail on any non-success dependency | Pending remote run |

## Reproducible commands

```text
node apps/backend/scripts/release-e2e-db.cjs start
npm run test:release --workspace=apps/frontend
npm run test:quality --workspace=apps/frontend
npm run lint
npm run typecheck
npm test
npm run build
node scripts/frontend-budget.mjs
node --test .github/scripts/*.test.cjs
node .github/scripts/check-workflow-policy.cjs
```

For local QA, set `RELEASE_E2E_API_PORT=5212` and `RELEASE_E2E_FRONTEND_PORT=3212` to avoid the 06.1 listeners.
Quality config refuses server reuse. Do not run both suites concurrently: their database seed/output directory is shared.
`test:visual` now compares existing snapshots; explicit `--update-snapshots` requires review of intentional differences.

## Visual source and evidence

References live under `docs/assets/figma/`, not root `assets/figma/`. Read the Components/admin/customer READMEs.
Inspected Components `Admin Form.png`; live Figma Foundations `3:27` metadata confirms Slate 600 `#475569` and AA text/focus rules.
This is not a claim of full Figma visual parity. Browser screenshots are attached to quality reports for independent review.
Muted text now uses the existing secondary foreground; branding, layout and typography tokens remain in use.

## CI design

PR/push → lint + types + unit/API tests + disposable payment integration + release browser/quality matrices + application builds
and gzip budget + three Docker builds/smokes → `Required / Quality Gate` → independent review.
No image publication, deployment or shared database writes occur in ordinary CI. Security Audit is a separate workflow/check.
Configure branch protection to require the aggregate gate and security checks; workflow code cannot itself prove repository settings.

Completion requires exact-SHA CI and browser evidence, documented performance results, reviewed screenshots, no unresolved material defect,
task-scoped commits/push and a PR into `develop`. Remaining manual/external gates must be explicit, never silently marked passed.
