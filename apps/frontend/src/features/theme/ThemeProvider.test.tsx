import { useEffect, useState } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, ThemeToggle, THEME_STORAGE_KEY, useTheme } from '.';
import { readStoredTheme, resolveInitialTheme, systemTheme } from './themePreference';

type Listener = (event: MediaQueryListEvent) => void;
let systemDark = false;
let listeners: Listener[] = [];
function mockSystem(dark: boolean) {
  systemDark = dark;
  listeners = [];
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('dark') ? systemDark : false, media: query, onchange: null,
    addEventListener: (_: string, listener: Listener) => { listeners.push(listener); },
    removeEventListener: (_: string, listener: Listener) => { listeners = listeners.filter(item => item !== listener); },
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}
const changeSystem = (dark: boolean) => { systemDark = dark; act(() => listeners.forEach(listener => listener({ matches: dark } as MediaQueryListEvent))); };
const root = () => document.documentElement;
const originalMatchMedia = window.matchMedia;

function Probe() {
  const { theme, isExplicit } = useTheme();
  return <p data-testid="probe">{theme}:{isExplicit ? 'explicit' : 'system'}</p>;
}
/** Counts mounts: a theme switch must never remount (and so never reset) the tree under the provider. */
let mounts = 0;
function StatefulChild() {
  const [value, setValue] = useState('');
  useEffect(() => { mounts += 1; }, []);
  return <input aria-label="Draft" value={value} onChange={event => setValue(event.target.value)} />;
}
const renderApp = () => render(<ThemeProvider><ThemeToggle /><Probe /><StatefulChild /></ThemeProvider>);

beforeEach(() => {
  window.localStorage.clear();
  root().removeAttribute('data-theme');
  mounts = 0;
  mockSystem(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  window.matchMedia = originalMatchMedia;
  root().removeAttribute('data-theme');
  window.localStorage.clear();
});

describe('theme preference rules', () => {
  it('defaults to light without a saved choice or a dark system preference', () => {
    expect(resolveInitialTheme()).toBe('light');
  });
  it('uses the system preference when nothing valid is saved', () => {
    mockSystem(true);
    expect(systemTheme()).toBe('dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(readStoredTheme()).toBeNull();
    expect(resolveInitialTheme()).toBe('dark');
  });
  it('lets a saved explicit choice win over the system preference', () => {
    mockSystem(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(resolveInitialTheme()).toBe('light');
  });
  it('agrees with the theme the pre-paint script already applied', () => {
    root().setAttribute('data-theme', 'dark');
    expect(resolveInitialTheme()).toBe('dark');
  });
  it('falls back safely when storage or matchMedia throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    window.matchMedia = (() => { throw new Error('unsupported'); }) as unknown as typeof window.matchMedia;
    expect(readStoredTheme()).toBeNull();
    expect(resolveInitialTheme()).toBe('light');
  });
});

describe('ThemeProvider and ThemeToggle', () => {
  it('applies the initial theme to <html> and labels the toggle with the available action', () => {
    renderApp();
    expect(root()).toHaveAttribute('data-theme', 'light');
    const toggle = screen.getByRole('button', { name: 'Switch to dark mode' });
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).not.toHaveAttribute('aria-pressed');
    expect(screen.getByTestId('probe')).toHaveTextContent('light:system');
  });

  it('switches immediately on click, persists the choice and keeps the tree mounted with its state', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByRole('textbox', { name: 'Draft' }), 'unsaved text');
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(root()).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
    expect(screen.getByTestId('probe')).toHaveTextContent('dark:explicit');
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('unsaved text');
    expect(mounts).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(root()).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('is operable from the keyboard (Enter and Space)', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(root()).toHaveAttribute('data-theme', 'dark');
    await user.keyboard(' ');
    expect(root()).toHaveAttribute('data-theme', 'light');
  });

  it('restores a saved preference on the next load (refresh)', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderApp();
    expect(root()).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByTestId('probe')).toHaveTextContent('dark:explicit');
  });

  it('follows system changes until the user chooses, then ignores them', () => {
    renderApp();
    changeSystem(true);
    expect(root()).toHaveAttribute('data-theme', 'dark');
    changeSystem(false);
    expect(root()).toHaveAttribute('data-theme', 'light');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    changeSystem(false);
    expect(root()).toHaveAttribute('data-theme', 'dark');
  });

  it('still switches (without persisting) when storage writes are blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(root()).toHaveAttribute('data-theme', 'dark');
  });

  it('synchronises with choices made in another tab, including a cleared preference', () => {
    renderApp();
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' })); });
    expect(root()).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByTestId('probe')).toHaveTextContent('dark:explicit');
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'light' })); });
    expect(root()).toHaveAttribute('data-theme', 'dark');
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'bogus' })); });
    expect(screen.getByTestId('probe')).toHaveTextContent('light:system');
    mockSystem(true);
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: null })); });
    expect(root()).toHaveAttribute('data-theme', 'dark');
  });

  it('reports the applied theme read-only outside a provider (isolated renders)', () => {
    root().setAttribute('data-theme', 'dark');
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(root()).toHaveAttribute('data-theme', 'dark');
  });
});

describe('public/theme-init.js (pre-paint script)', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../public/theme-init.js'), 'utf8');
  const run = () => new Function(source)();

  it('applies a saved choice, then the system preference, then light', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    run(); expect(root()).toHaveAttribute('data-theme', 'dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'not-a-theme');
    mockSystem(true);
    run(); expect(root()).toHaveAttribute('data-theme', 'dark');
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    mockSystem(false);
    run(); expect(root()).toHaveAttribute('data-theme', 'light');
  });
  it('never throws when storage and matchMedia are unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    window.matchMedia = (() => { throw new Error('unsupported'); }) as unknown as typeof window.matchMedia;
    expect(run).not.toThrow();
    expect(root()).toHaveAttribute('data-theme', 'light');
  });
  it('uses the same storage key and values as the React provider', () => {
    expect(source).toContain(`'${THEME_STORAGE_KEY}'`);
    expect(source).toContain("'(prefers-color-scheme: dark)'");
  });
});
