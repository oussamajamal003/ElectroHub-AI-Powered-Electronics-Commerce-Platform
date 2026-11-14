# Task 06.2 (PR #51) — account pages, profile photo UX, Cookie Policy, Contact reload and placeholders: evidence

This report records what was changed and what was actually observed for the PR #51 follow-up covering work packages A–G
(admin profile layout, profile photo UX, account page redesign, Cookie Policy redesign and discoverability, Contact reload,
placeholders). It is not an approval and makes no deployment or production claim. Anything not run is marked **NOT VERIFIED**.

## 1. Branch, base and scope

| Item | Value |
|---|---|
| Working branch | `fix/06.2-account-privacy-contact-ux` (isolated worktree `.claude/worktrees/account-privacy-ux`) |
| Base | started on `704166d`; rebased onto `origin/feature/06.2-accessibility-qa-ci-cd` at `c5d2fa5` (four newer commits: web push, header bell removal, last-unit checkout race). One conflict: the base deleted `CustomerNotifications.module.scss`, which this work had edited, so the deletion was kept. |
| Delivery | fast-forward push to `feature/06.2-accessibility-qa-ci-cd`, updating PR #51 (base `develop`). No new PR, no merge, no deploy. |
| Backend | not changed (contact API `POST /api/store/contact`, media validation, OTP/password/session/deletion safeguards untouched) |
| Database / storage / email | not touched. Every browser check answers `/api/*` in the browser (`tests/visual/darkMode.fixtures.ts`); profile photo upload/remove are mocked in the spec, so no real account, private object or email was used. |

## 2. Root causes

### A. `/admin/profile` "broken" layout (user screenshot: giant moon/bell/OJ icons, striped avatar, no sidebar, blank content)

1. **Browser zoom (~500%) reflow — reproduced.** Emulating Brave at 500% (CSS viewport 384×184, device scale factor 5)
   reproduced the screenshot's proportions exactly: header icons ~85 device px, the avatar ~175 device px. At that CSS width the
   admin shell correctly switches to its compact header (sidebar moves into the drawer behind "Open navigation"; the Admin pill
   and part of the brand are hidden below `sm`). The icons are not oversized in CSS; they are zoomed. Not changed: hiding
   controls at high zoom would break WCAG 1.4.4/1.4.10 reflow.
2. **Blue vertical stripes on the avatar — real CSS bug, fixed.** `AdminLayout.module.scss .avatar` overrode the shared Avatar
   root with `display: grid; background: $color-primary; color: $color-text-inverse`. The Radix fallback inside it
   (`width/height: 100%`, its own `$color-background`) then sat in a grid cell over a brand-blue root: blue bands at the edges
   with the light fallback between them, magnified by zoom into stripes.
   Fix at the foundation (`components/ui/Avatar`):
   - the fallback is now `position: absolute; inset: 0` and fills the root whatever display a consumer sets;
   - both root and fallback use the neutral `$color-surface-hover` wash with `$color-text-primary` text and a `$color-border` ring;
   - initials inherit the size class's `font-size`.
   The AdminLayout override is reduced to size only. This also applies to the customer header, account page, profile page,
   admin header and admin profile.
3. **Narrow-width overflow — real, fixed.** An overflow audit at 320/390 found:
   - `/admin/profile` at 320 overflowed by 11 px. The Danger Zone button "Transfer Ownership & Delete Account" is `nowrap`.
     Below `sm`, `.actionsStart` buttons and links may now wrap.
   - Every signed-in customer page at 320 overflowed by 38 px: the header's icons, avatar and logo did not fit beside the
     44 px notifications bell. At ≤360 px the header icons, avatar and logo now use compact sizes (≥30 px targets, above the
     24 px WCAG 2.5.8 minimum). After rebasing onto `c5d2fa5` (which removed the header bell), the bell-specific rule was
     dropped with its file; the remaining compaction still keeps 320 px free of horizontal scroll (matrix below).
4. **"No sidebar, blank content" in the screenshot — NOT reproduced.** With the repository's mocked API, `/admin/profile`
   renders the shell and content at every width, after reload, direct navigation, back/forward, a 2.5 s slow profile response
   and a 500 profile response (error state with Retry inside an intact shell). The sidebar's absence matches the compact
   high-zoom layout (it lives in the drawer). Blank content against the user's live DEV backend was not checked, because no live
   backend session was used: **NOT VERIFIED** against live data.

### F. Contact page reload

The first paint was decided too late in the shared `SectionReveal` (`components/motion/Motion.tsx`):
- Every reveal section rendered visible, then a `useEffect` switched it to `pending` (`opacity: 0`).
- It reappeared only when the IntersectionObserver callback ran.
- On reload, content already on screen therefore flashed (visible → hidden → animated in). On a slow device or network it
  stayed blank until the observer fired.

Measured in Chromium with CPU throttled 6× on reload at 1440×800, by sampling the hero's reveal wrapper every animation frame:
- **Before:** `shown@10396 → hidden@10419 → shown@10553`. The painted hero was hidden again, about 134 ms blank, then faded in.
- **After:** `hidden@12394 → shown@12495`. The first painted frame is frame 0 of the entrance animation; nothing visible is
  ever hidden.

Fix: the phase is now decided in a layout effect before the first paint.
- A section already in the viewport starts its entrance immediately as a CSS animation, with no observer dependency.
- A section above the viewport is settled.
- Only sections below the fold wait for the observer (unchanged behaviour, including the restored-scroll sweep).

Animations are not disabled. Reduced motion is unchanged: content is static and visible. The backend contract is unchanged.
Header navigation, refresh, direct URL, refresh after scroll, back/forward, profile API error and reduced motion are covered by
the Playwright spec below.

## 3. Changes by work package

| WP | Change | Files |
|---|---|---|
| A | Neutral, non-striping Avatar foundation; admin header avatar override reduced to size; Danger Zone action wraps at <sm; compact signed-in customer header at ≤360 px | `components/ui/Avatar/*`, `layouts/AdminLayout.module.scss`, `features/admin/shared/AdminPages.module.scss`, `components/layout/CustomerHeader/CustomerHeader.module.scss` |
| B | `ProfilePhotoManager` as an identity card. Details below the table. | `components/profilePhoto/ProfilePhotoManager.{tsx,module.scss,test.tsx}` |
| C | Customer account identity card and link cards; profile page card headers and Danger Zone. Details below the table. | `pages/customer/AccountPage.{tsx,module.scss}`, `pages/customer/ProfilePage.module.scss` |
| D | Cookie Policy redesign. Details below the table. | `features/privacy/CookiePolicy.{tsx,module.scss}` |
| E | Footer Cookie Settings matches the footer links; equal-weight banner choices; current choice in the dialog; one dialog reopened from anywhere. Details below the table. | `features/privacy/CookieControls.{tsx,module.scss}`, `features/privacy/consent.ts`, `layouts/CustomerLayout.module.scss`, `pages/customer/AccountPage.tsx` |
| F | `SectionReveal` first-paint phase | `components/motion/Motion.tsx` |
| G | Contact and Store settings placeholders. Details below the table. | `pages/ContactPage.tsx`, `features/admin/settings/components/StoreSettingsForm.tsx`, tests |
| a11y | Contact help links used `$color-primary` text, which fails 4.5:1 on the dark surface (found by axe in this spec); now `$color-primary-text`, the token made for brand-coloured text | `pages/CompanyPages.module.scss` |
| QA | Reusable Playwright spec and config | `tests/visual/task06-2-account-privacy.spec.ts`, `playwright.task06-2-account-privacy.config.ts` |

**B — profile photo identity card.**
- Visible actions: Upload/Change, Take photo, View (only when a photo exists), Remove (only when a photo exists).
- Guidance reads "JPEG, PNG or WebP · Max 5 MB", with a quiet privacy line.
- Native file inputs use `hidden`, triggered only by the custom buttons, so no "No file chosen" text can render.
- One polite live region for feedback ("Profile photo updated." / "Profile photo removed." / pending text). It clears itself after
  6 s and resets on navigation.
- Clicking a saved photo opens a Radix preview dialog with a title, a larger image, Close, Escape, a focus trap and focus
  restore, and no upload.
- With no photo, the avatar opens the edit menu, never an empty preview.
- An expired or broken signed URL is hidden, refreshed once, and offers "Try again".
- Camera, validation, retake, cancel and stream-cleanup logic is unchanged.

**C — account pages.**
- Customer account: identity card with a brand hairline, larger neutral avatar, and icon tiles on the link cards. The Account
  Settings card gains the missing chevron. A Privacy row links to the Cookie Policy and Cookie preferences.
- Profile page: left-aligned card headers that hold the photo identity card, white cards with a subtle shadow, and a Danger
  Zone with an error-coloured title and left-aligned actions.
- No fake stats; content, links and security flows are unchanged. Admin Security and Sessions were audited (no overflow at
  320/390; the sessions table scrolls inside its card) and were not restyled beyond the shared avatar.

**D — Cookie Policy.**
- Hero with icon, "Manage preferences" and a lead paragraph.
- Keyboard-accessible "On this page" contents with real `#anchors` and `scroll-margin-top` for the sticky header.
- Five icon-headed sections and a "Change preferences" callout that opens the existing Cookie Settings dialog.
- The wording is unchanged; cookie names are marked up as `<code>`.

**E — Cookie Settings.**
- The footer Cookie Settings button is a real `<button data-footer-link>` that shares the footer link styles.
- The banner's Accept all and Reject optional now carry equal visual weight. Accept was previously primary blue and Reject
  cyan secondary.
- The dialog shows the "Current choice"; Reject optional withdraws consent.
- `openCookieSettings()` reopens the single dialog owned by `CookieControls`; there is no second consent manager.
- The banner's policy link is now visible.

**G — placeholders.**
- Contact: Name, Email, Subject and Message placeholders.
- Store settings: address line 1 and 2, region and postal code changed to the requested wording. Email, phone, city, country
  and business hours already matched.
- Placeholders only: labels, validation and saved values are unchanged.

## 4. Legal text review (D)

The Cookie Policy wording was compared against the code:
- Cookie names and lifetimes match the backend: `electrohub_customer_refresh`/`electrohub_admin_refresh` 7 days,
  `electrohub_google_transaction` 5 min, `_completion` 30 s, `electrohub_account_deletion_proof` 5 min.
- The 180-day consent expiry matches `CONSENT_MAX_AGE_MS`. The storage keys match `consent.ts`.

No factual inconsistency was found, so no wording was changed. Flagged for the owner, not changed: the footer "Privacy Policy"
and "Terms of Service" links point to `/contact` because no such pages exist.

## 5. Verification

All commands ran locally on Windows 11 in the worktree, after the rebase onto `c5d2fa5`, unless stated otherwise.

### 5.1 Static checks, unit tests and build

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.quality.json --noEmit` | **PASS** |
| Lint | `npx eslint .` | **PASS**: 0 errors, 4 warnings, all pre-existing `react-refresh/only-export-components` (for example `validateContact` exported from `ContactPage.tsx`) |
| Unit tests | `npx vitest run` | **PASS with one pre-existing flake**: 1554/1555 passed. The single failure was in `useUnsavedChangesGuard.test.tsx` (browser-history timing under full-suite load); it passes 6/6 in isolation. The untouched base `c5d2fa5`, run the same way, also failed one sibling history test (`AdminProductFormPage.test.tsx`) under full-suite load and passed 6/6 in isolation. Not caused by this change. |
| Build | `npm run build` | **PASS** (the existing >500 kB chunk warning only) |
| Bundle budget | `node scripts/frontend-budget.mjs` | **PASS** (after the rebase) |
| Whitespace | `git diff --check` | **PASS** |

### 5.2 Browser QA (Playwright spec `tests/visual/task06-2-account-privacy.spec.ts`)

Run with:

```bash
cd apps/frontend
ACCOUNT_PRIVACY_ALL_BROWSERS=1 ACCOUNT_PRIVACY_EVIDENCE=1 npx playwright test -c playwright.task06-2-account-privacy.config.ts
```

All `/api/*` calls are answered inside the browser by `darkMode.fixtures.ts`. Profile photo upload, remove and expired-URL
responses are mocked in the spec, and the image is a generated SVG on a placeholder host.

| Engine | Result |
|---|---|
| Chromium (Playwright build) | **PASS**: 26/26 |
| WebKit (Playwright build) | **PASS**: 26/26 |
| Firefox (Playwright build) | **NOT VERIFIED**: on this machine Windows refuses to execute the downloaded `firefox-1543/firefox.exe` (`spawn UNKNOWN`; "Permission denied" when started directly). This is an OS execution policy that was not changed. CI runs Firefox for the release and quality suites, not for this spec. |

What the spec covers:

| # | Item | Status |
|---|---|---|
| 1 | Responsive matrix: 8 routes (`/admin/profile`, `/admin/profile/security`, `/admin/profile/sessions`, `/admin/settings`, `/account`, `/account/profile`, `/cookie-policy`, `/contact`) × 320/390/768/1024/1440/1920 × light/dark, no horizontal page scroll | **PASS** (Chromium, WebKit) |
| 2 | A: admin header, sidebar, icon sizes and a neutral avatar (computed colours) after reload, direct URL, back/forward, and in dark mode | **PASS** |
| 3 | A: a 2.5 s slow profile API and a 500 profile API keep the shell; the error state offers Retry | **PASS** |
| 4 | A: ~500% zoom (384×184 CSS px, DPR 5) reflows to the compact header without horizontal scroll | **PASS** (emulated; real browser zoom not driven) |
| 5 | B: admin and customer menus, mocked upload, "Profile photo updated." status, header avatar sync, preview dialog with Escape and focus return (keyboard open), mocked remove | **PASS** |
| 6 | B: an expired or broken signed URL falls back to initials, refetches once, and never shows a broken image | **PASS** |
| 7 | B: hidden native inputs, no "No file chosen", avatar with no photo opens the menu, status clears | **PASS** (Vitest, `ProfilePhotoManager.test.tsx`) |
| 8 | D: Cookie Policy hero, contents anchors landing below the sticky header, "Manage preferences" opening Cookie Settings, axe light and dark | **PASS** |
| 9 | E: banner Accept and Reject have the same background; footer Cookie Settings has the same font size, weight, line height, colour and family as the footer links; dialog shows "Current choice: Optional analytics rejected"; Escape returns focus | **PASS** |
| 10 | F: hero reveal sampled every frame on reload never goes shown → hidden; refresh after scroll; profile API 500; reduced motion | **PASS** |
| 11 | G: Contact and Store settings placeholders are present and not submitted as values | **PASS** (Playwright and Vitest) |
| 12 | axe WCAG 2.0/2.1 A and AA, light and dark, on 7 routes (`/admin/profile`, `/security`, `/sessions`, `/admin/settings`, `/account`, `/account/profile`, `/contact`) plus `/cookie-policy` | **PASS** after the Contact help-link contrast fix |

The CPU-throttled before/after reveal measurement in §2 F was a one-off Chromium measurement with 6× throttling. The
automated check (item 10) asserts the invariant without throttling.

### 5.3 Screenshots

The curated set is in `docs/tasks/Phase-06/evidence/task06.2-account-privacy/` (26 Chromium PNGs). It contains:
- 320 light and 1440 dark for the admin profile, account, account profile, Cookie Policy and Contact;
- the photo menu, identity card and preview for both admin and customer;
- the admin API error, dark header and 500% zoom;
- Store placeholders, Contact after reload, cookie banner, footer Cookie Settings, the Cookie Settings dialog, and the Cookie
  Policy in light and dark.

The full run also writes WebKit and every matrix size into Playwright's output folder. Those copies are not committed
(≈32 MB).

Inspected by eye:
- admin profile 1440 dark and 320 light;
- account 320 light;
- customer identity card;
- Cookie Policy light.

Each shows the full shell, a neutral initials or photo avatar, no stripes and no clipped controls.

### 5.4 Regression checks not run locally

- `test:release` and `test:quality`: both contain the cookie banner, footer and dialog checks this work touches
  (`privacy.release.spec.ts`, `privacy.quality.spec.ts`). They need the disposable PostgreSQL stack. Their selectors were
  re-read and still match:
  - the button names Accept all, Reject optional, Customize, Save preferences and Cookie Settings;
  - the "Cookie preferences saved." status;
  - the dialog name;
  - the equal-height check.
  Neither was run locally, so they are **NOT VERIFIED** here; CI runs them on the pushed SHA (§6).
- Notifications spec: unaffected by this change. The base commit removed the header bell.

## 6. External verification

| Source | Status |
|---|---|
| Figma Design / Figma Make | **NOT VERIFIED**: the Figma connector is not authorised in this session. The design-system tokens in the repository were used; no Figma values were invented. |
| Live DEV backend / Supabase / storage | **NOT VERIFIED**: by design, no real account, photo or private object was used |
| Stripe / Sentry | Not relevant; not touched |
| GitHub CI on the pushed SHA | Not recorded in this file, because this report is part of the commit CI runs on. See the checks on PR #51 for the pushed SHA. |

## 7. Known limitations and risks

- The user's "no sidebar, blank content" state was explained by the zoomed compact layout. It was not reproduced against
  live data.
- Firefox was not run locally (above).
- Admin Security and Sessions were audited, not redesigned.
- Footer "Privacy Policy" and "Terms of Service" point to `/contact` (flagged, not changed).
- Unsaved-changes history tests (`useUnsavedChangesGuard.test.tsx`, `AdminProductFormPage.test.tsx`) fail intermittently
  under full-suite load. This also happens on the base `c5d2fa5`, and both pass 6/6 in isolation on the base and on this
  branch. This is a pre-existing flake and is not addressed here.
- `SectionReveal` now starts on-screen entrances in a layout effect. Sections measured as 0×0 at mount (for example inside a
  hidden tab) keep the previous observer path.
