// Theme preference rules shared by ThemeProvider and mirrored (in plain JS) by `public/theme-init.js`, which applies the
// same resolution before first paint. Keep the two in sync: storage key, accepted values and the attribute they write.
//
//   1. A valid explicit choice saved in localStorage wins.
//   2. Otherwise the operating-system `prefers-color-scheme`.
//   3. Otherwise light (the original ElectroHub design).
//
// Only the user's explicit choice is persisted; following the system writes nothing. The preference is device-local
// and never sent to the backend.

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'electrohub:theme';
export const THEME_ATTRIBUTE = 'data-theme';
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

/** The saved explicit choice, or null when none is saved, the value is invalid, or storage is unavailable. */
export function readStoredTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

/** Persists an explicit choice. Storage failures (private mode, quota, blocked) are ignored: the theme still applies. */
export function writeStoredTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* preference only */
  }
}

export function systemTheme(): Theme {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(DARK_SCHEME_QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** The theme the pre-paint script already applied, when it is valid; otherwise the rules above. */
export function resolveInitialTheme(root: HTMLElement = document.documentElement): Theme {
  const applied = root.getAttribute(THEME_ATTRIBUTE);
  if (isTheme(applied)) return applied;
  return readStoredTheme() ?? systemTheme();
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (root.getAttribute(THEME_ATTRIBUTE) !== theme) root.setAttribute(THEME_ATTRIBUTE, theme);
}
