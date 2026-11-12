import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DARK_SCHEME_QUERY,
  THEME_STORAGE_KEY,
  applyTheme,
  isTheme,
  readStoredTheme,
  resolveInitialTheme,
  systemTheme,
  writeStoredTheme,
  type Theme,
} from './themePreference';

export interface ThemeContextValue {
  /** The theme currently applied to <html data-theme>. */
  theme: Theme;
  /** True once the user picked a theme explicitly (it is then persisted and the OS setting is no longer followed). */
  isExplicit: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Single application-wide theme state for the customer storefront and the admin console (one React root, one
 * <html data-theme>). Switching only flips one attribute: CSS custom properties restyle everything, including Radix
 * portals under <body>, so no provider, query cache, auth state or form below this is re-rendered or remounted.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => resolveInitialTheme());
  const [isExplicit, setIsExplicit] = useState(() => readStoredTheme() !== null);

  // Layout effect: the attribute is in place before the browser paints a render that depends on it.
  useLayoutEffect(() => { applyTheme(theme); }, [theme]);

  // Follow the OS setting until the user makes an explicit choice.
  useEffect(() => {
    if (isExplicit || typeof window.matchMedia !== 'function') return;
    let query: MediaQueryList;
    try { query = window.matchMedia(DARK_SCHEME_QUERY); } catch { return; }
    const onChange = (event: MediaQueryListEvent) => setThemeState(event.matches ? 'dark' : 'light');
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, [isExplicit]);

  // Keep every open tab (storefront and admin alike) on the same choice.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      // key === null: another tab cleared storage, so the explicit choice is gone.
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      const stored = event.key === null ? null : isTheme(event.newValue) ? event.newValue : null;
      setIsExplicit(stored !== null);
      setThemeState(stored ?? systemTheme());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    writeStoredTheme(next);
    setIsExplicit(true);
    setThemeState(next);
  }, []);
  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme]);

  const value = useMemo<ThemeContextValue>(() => ({ theme, isExplicit, setTheme, toggleTheme }), [theme, isExplicit, setTheme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Theme state. Outside a ThemeProvider (isolated component renders, Storybook) it reports the applied theme read-only. */
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context) return context;
  return { theme: resolveInitialTheme(), isExplicit: false, setTheme: () => undefined, toggleTheme: () => undefined };
}
