# Work item — Load the approved typefaces (Poppins, JetBrains Mono)

**Workstream:** Design system / FRONTEND foundations. Kept separate from Task 03.6 on purpose: no font or global design-system change is bundled into payment work.
**Raised:** 2026-10-15, by the Scenarios 2–6 session. **Status:** OPEN, not started.

## Finding

`docs/02_Design/TYPOGRAPHY.md` approves **Poppins** (UI) and **JetBrains Mono** (data, including prices). Both are used through `$font-family-base` and `$font-family-mono` in `apps/frontend/src/styles/abstracts/_variables.scss`, and `$font-family-mono` is used by DataTable, OtpVerification and HomePage.

However, the application loads **neither** typeface:

- `index.html` has no font `<link>`;
- `src/` has no `@font-face` rule;
- no font package (`@fontsource/*`) is installed;
- `public/` contains no font files.

Effects:

- Visitors without a local Poppins install see the system fallback (`-apple-system`, `Segoe UI`, …) instead of the approved typeface.
- Every `$font-family-mono` usage falls back to `Fira Code` or the platform monospace. On this workstation the Orders reference rendered in a serif-like Courier fallback, so that surface now uses the base font instead.
- Screenshot QA on machines that have Poppins installed hides the gap. The Task 03.6 screenshots render Poppins only because the workstation has it installed.

## Proposed scope (needs Design-system owner + Architect approval)

1. Choose a delivery method. Options: self-hosted `@fontsource/poppins` + `@fontsource/jetbrains-mono` with only the used weights, or Google Fonts (`AGENTS.md` lists it as an allowed stylesheet source for artifacts; confirm for the app).
2. Use `font-display: swap`, preload the main Poppins weight, and keep the existing fallback stacks.
3. Record bundle-size and CLS impact before and after.
4. Visual regression: re-capture key customer screens on a machine without Poppins installed.
5. Update `TYPOGRAPHY.md` with the loading strategy.

## Out of scope

Any change to font tokens, sizes or weights, and any payment or checkout behaviour.
