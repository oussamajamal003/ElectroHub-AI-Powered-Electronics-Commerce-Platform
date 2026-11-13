// Mirrored by public/theme-init.js. Only explicit choices are persisted.
export type Theme = 'light' | 'dark';
export type ThemeScope = 'customer' | 'admin';
export const THEME_STORAGE_KEYS = { customer: 'electrohub:theme:customer', admin: 'electrohub:theme:admin' } as const;
/** Customer key retained as a source-compatible export for storefront consumers. */
export const THEME_STORAGE_KEY = THEME_STORAGE_KEYS.customer;
export const THEME_ATTRIBUTE = 'data-theme';
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';
export function themeScope(pathname = window.location.pathname): ThemeScope {
  return /^\/admin(?:\/|$)/.test(pathname) ? 'admin' : 'customer';
}
export function isTheme(value: unknown): value is Theme { return value === 'light' || value === 'dark'; }
/** Consume the legacy choice once, for the storefront only. Explicit scoped values always win. */
export function migrateLegacyTheme(): void {
  try {
    const legacy = window.localStorage.getItem('electrohub:theme');
    if (legacy === null) return;
    if (isTheme(legacy) && !isTheme(window.localStorage.getItem(THEME_STORAGE_KEYS.customer))) {
      window.localStorage.setItem(THEME_STORAGE_KEYS.customer, legacy);
    }
    window.localStorage.removeItem('electrohub:theme');
  } catch { /* A blocked store must never block rendering. */ }
}
export function readStoredTheme(scope: ThemeScope = themeScope()): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEYS[scope]);
    return isTheme(value) ? value : null;
  } catch { return null; }
}
export function writeStoredTheme(theme: Theme, scope: ThemeScope = themeScope()): void {
  try { window.localStorage.setItem(THEME_STORAGE_KEYS[scope], theme); } catch { /* device preference only */ }
}
export function systemTheme(): Theme {
  try { return typeof window.matchMedia === 'function' && window.matchMedia(DARK_SCHEME_QUERY).matches ? 'dark' : 'light'; }
  catch { return 'light'; }
}
export function resolveInitialTheme(root: HTMLElement = document.documentElement): Theme {
  const applied = root.getAttribute(THEME_ATTRIBUTE);
  if (isTheme(applied)) return applied;
  migrateLegacyTheme();
  return readStoredTheme() ?? systemTheme();
}
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (root.getAttribute(THEME_ATTRIBUTE) !== theme) root.setAttribute(THEME_ATTRIBUTE, theme);
}
