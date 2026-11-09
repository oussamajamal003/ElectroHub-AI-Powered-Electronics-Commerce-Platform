# Shared selectors

All value dropdowns use `Select` or `SearchSelect`. The user-supplied Administrators invitation-status (Pending) screenshot is the visual target: white bordered popup, blue highlighted option with white text, and a checkmark on the selected option. Searchable lists retain their search field and use the same option/popup styling via `components/ui/Select/_dropdown.scss`. Do not introduce native `<select>` controls or a separate dropdown appearance for a new value selector.

Keep unselected prompts such as “Select category…” gray through the existing placeholder state. Selected values use the normal text color. Both controls use the normal 1.5 line height and wrap long values/options, growing vertically instead of clipping glyphs or hiding text with ellipses. Preserve focus rings, disabled states, keyboard navigation and accessible names.

The four Recommendations period/placement controls now reuse `Select`; the all-placement UI sentinel is mapped back to `undefined`, preserving the API query contract. The shared components continue to serve customer and admin pages.

## Verification (2026-11-06)

- `npx vitest run src/components/ui/Select/Select.test.tsx src/components/ui/SearchSelect/SearchSelect.test.tsx src/pages/admin/AdminRecommendationsPage.test.tsx` from `apps/frontend`: 24 tests passed.
- Frontend typecheck, targeted ESLint and production build passed. Build retains existing Sass division, chunk-size and session-restore import warnings.
- `node scripts/select-text-qa.cjs`: checked small/medium/large Select, searchable Select, long labels and gray placeholders at 1440×1000 and 390×1000. Captures in `.cache/select-text/` were inspected against the supplied target. Searchable and ordinary lists retain matching option typography, spacing, highlight and selection styling.
- Source audit found no remaining native `<select>` / `<option>` elements in application TSX (excluding tests/stories).
- `node scripts/administrators-loading-qa.cjs`: passed at 1920×900 and 390×900, including opening Pending and selecting Accepted. Dropdown captures in `.cache/administrators-loading/dropdown-{1920,390}.png` were inspected against the supplied Administrators screenshot.

Browser fixtures use local Vite modules and mock HTML, with no backend requests. These checks verify shared UI behavior; remote CI and live Figma were not checked for this change.
