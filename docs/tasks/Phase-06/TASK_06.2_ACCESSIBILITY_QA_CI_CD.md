# Task 06.2 — Accessibility, QA and CI/CD

Status: **IMPLEMENTED — final CI and manual acceptance tracked in PR #51**. Scope: ROADMAP §9 / 06.2. Baseline: latest `origin/develop`
`9cae8647593bd3d48f2faef39552ae5da497f44f`, including merged Task 06.1 PR #50.
Branch: `feature/06.2-accessibility-qa-ci-cd`. No merge or production deployment authorized.

Final evidence, later fixes, exact limitations and run history: [implementation handoff](TASK_06.2_IMPLEMENTATION_EVIDENCE.md).
The initial matrix below is a baseline audit; final results supersede its pending entries.

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
| Native zoom | Actual browser 100% / 200% | Desktop helper cannot initialize / environment | Resolved with actual Chromium tabs.setZoom/getZoom in temporary profile; see native-zoom.json | VERIFIED locally |
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

Current refinements: all CI jobs check out the exact PR head; Node 22.19.0 matches existing dependency engine requirements.
PROD migrations changed to manual-only with mandatory reviewed SHA and develop-only dispatch guard; no PROD workflow ran.
`playwright.quality.config.ts` supports `QUALITY_PRODUCTION=1`; CI builds the optimized app before these checks.
The dedicated native-zoom project uses no device emulation. Drawer now shares Dialog's controlled-opener focus restoration.
SearchSelect announces required selection in its accessible label without invalid `aria-required` on a button.

## Recorded local evidence (2026-11-10)

- Full frontend Vitest: **1411/1411**, 171 files, before the later Drawer/SearchSelect regressions were added.
- Drawer/Dialog/SearchSelect targeted regression: **7/7**; Input/Select **12/12**.
- Workflow safety/gate tests: **28/28**; backend/frontend typecheck, lint and application builds passed before later QA expansion.
- AI ruff/format checks pass; local pytest completed successfully with one explicit skip (same suite as 06.1).
- Initial full browser quality run: **24 passed, 2 failed, 2 skipped**. Both failures were WebKit's skip-link Tab sequence;
  explicit tabIndex=0 was then proved in WebKit and applied. Final all-project re-run remains required.
- Optimized Chromium expanded run: **7 passed / 1 failed**; native zoom passed. The one failure was SearchSelect's unsupported ARIA,
  corrected afterwards with a regression test. Expanded final admin/browser checks remain required.
- Actual native Chromium **153.0.8010.12**, headless persistent profile, `chrome.tabs.setZoom`/`getZoom`:
  **1 → 2**, inner viewport **1422×904 → 711×452**, devicePixelRatio **1 → 2**. Customer home/detail/cart/auth and
  admin dashboard/products/settings/navigation exercised. No viewport substitution, CSS zoom or scale-factor emulation.
- Optimized local route samples: Home LCP **1036 ms**, CLS **0**; product **784 ms**, **0.0394**; admin **880 ms**, **0.0216**.
  One navigation sample per route, five real read API samples per operation; loopback and unthrottled, diagnostic only.
- API samples (ms): listing **165,82,68,65,64**; search **79,54,53,62,50**; popular recommendations **39,41,40,37,38**.

Raw safe measurements: [performance.json](evidence/task06.2/performance.json), [native-zoom.json](evidence/task06.2/native-zoom.json).
Native API documentation: [Chrome tabs.setZoom](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom);
temporary extension workflow: [Playwright](https://playwright.dev/docs/chrome-extensions).

## CI history and known limits

PR: https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/pull/51 (draft).
Run **42846546724**, head **3a1de19**: backend tests, frontend tests, types/lint/builds, AI tests/Docker, frontend Docker,
payment PostgreSQL, policy, Chromium and WebKit jobs passed. Firefox quality scans caught transient reveal contrast;
the scan now waits for finite animations. Backend Docker smoke caught missing workspace Prisma dependencies;
the runtime copy is corrected. Aggregate gate correctly failed on these failures. This is not final-SHA success evidence.

Local Docker attempt sent a 117 MB filtered context and installed locked dependencies, but was stopped when the workstation
ran low on disk; image validation uses actual remote CI results. User-authorized npm caches and stopped disposable caches were
cleaned; Git worktrees, source and trained-model artifacts were preserved. Some older cache paths were locked and retained.

Actual NVDA/VoiceOver, physical Safari/iOS, supervised Stripe Elements/Test Mode purchase, external email delivery and trained-model
timing remain separate manual/provider acceptance. Current browser stack has no provider credentials. Existing 06.1 tests cover
provider-unavailable checkout and AI fallback; they do not certify provider success. No database schema or API contract changed.

Completion requires exact-SHA CI and browser evidence, documented performance results, reviewed screenshots, no unresolved material defect,
task-scoped commits/push and a PR into `develop`. Remaining manual/external gates must be explicit, never silently marked passed.
