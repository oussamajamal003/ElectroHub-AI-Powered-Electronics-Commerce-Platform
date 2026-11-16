import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useInRouterContext, useLocation } from 'react-router-dom';
import { DARK_SCHEME_QUERY, THEME_STORAGE_KEYS, applyTheme, isTheme, migrateLegacyTheme, readStoredTheme,
  resolveInitialTheme, systemTheme, themeScope, writeStoredTheme, type Theme, type ThemeScope } from './themePreference';

export interface ThemeContextValue {
  theme: Theme;
  isExplicit: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}
const ThemeContext = createContext<ThemeContextValue | null>(null);
type Choice = { theme: Theme; isExplicit: boolean };
const choice = (stored: Theme | null): Choice => ({ theme: stored ?? systemTheme(), isExplicit: stored !== null });

/** One document theme, selected by route ownership; preferences and in-memory fallbacks remain independent. */
function ScopedThemeProvider({ scope, children }: { scope: ThemeScope; children: ReactNode }) {
  const [choices, setChoices] = useState<Record<ThemeScope, Choice>>(() => {
    migrateLegacyTheme();
    return { customer: choice(readStoredTheme('customer')), admin: choice(readStoredTheme('admin')) };
  });
  const { theme, isExplicit } = choices[scope];
  useLayoutEffect(() => { applyTheme(theme); }, [theme, scope]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    let query: MediaQueryList;
    try { query = window.matchMedia(DARK_SCHEME_QUERY); } catch { return; }
    const onChange = (event: MediaQueryListEvent) => setChoices(previous => {
      const next = { ...previous };
      for (const key of ['customer', 'admin'] as const) {
        if (!previous[key].isExplicit) next[key] = { theme: event.matches ? 'dark' : 'light', isExplicit: false };
      }
      return next;
    });
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea) {
        try { if (event.storageArea !== window.localStorage) return; } catch { return; }
      }
      if (event.key === null) {
        setChoices({ customer: choice(null), admin: choice(null) });
        return;
      }
      const changed = (Object.keys(THEME_STORAGE_KEYS) as ThemeScope[]).find(key => THEME_STORAGE_KEYS[key] === event.key);
      if (!changed) return;
      // Updating an inactive choice never changes the active document. It is ready for the next SPA navigation.
      setChoices(previous => ({ ...previous, [changed]: choice(isTheme(event.newValue) ? event.newValue : null) }));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const setTheme = useCallback((next: Theme) => {
    writeStoredTheme(next, scope);
    setChoices(previous => ({ ...previous, [scope]: { theme: next, isExplicit: true } }));
  }, [scope]);
  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme]);
  const value = useMemo(() => ({ theme, isExplicit, setTheme, toggleTheme }), [theme, isExplicit, setTheme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
function RoutedThemeProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ScopedThemeProvider scope={themeScope(pathname)}>{children}</ScopedThemeProvider>;
}
export function ThemeProvider({ children }: { children: ReactNode }) {
  const routed = useInRouterContext();
  return routed ? <RoutedThemeProvider>{children}</RoutedThemeProvider>
    : <ScopedThemeProvider scope={themeScope()}>{children}</ScopedThemeProvider>;
}
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  return context ?? { theme: resolveInitialTheme(), isExplicit: false, setTheme: () => undefined, toggleTheme: () => undefined };
}
