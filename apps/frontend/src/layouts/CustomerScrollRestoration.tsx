import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Route-aware scroll restoration for the storefront (Task 06.2 Work Package D owns this as the single scroll authority).
 *
 *  - PUSH (link click, navigate()) and the first visit start at the top; `state.smoothTop` glides there instead.
 *  - POP (Back/Forward) returns to the position this history entry was left at.
 *  - Payment entry/recovery routes always start at the top.
 *  - REPLACE (filter changes that rewrite the URL) keeps the current position.
 *
 * Restoring waits for the page to become tall enough. A route that is still loading (lazy chunk, data, below-the-fold
 * sections) cannot be scrolled to its old position yet: scrolling immediately would clamp the visitor to the bottom of a
 * half-rendered page and record that clamped value over the real one. While a restore is pending nothing is recorded,
 * and any visitor input (wheel, touch, key, pointer) cancels it so the page never jumps under their hand.
 *
 * Positions are mirrored to sessionStorage by history-entry key, so Back still restores after a full document load
 * (React Router keeps the entry key in history.state across reloads). Only numbers and opaque entry keys are stored.
 */
const STORAGE_KEY = 'electrohub:scroll-positions';
const MAX_ENTRIES = 60;
const RESTORE_TIMEOUT_MS = 4_000;

const positions = new Map<string, number>();
const routePositions = new Map<string, number>();
let hydrated = false;
const routeKey = (pathname: string, search: string) => `${pathname}${search}`;

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '{}');
    if (stored && typeof stored === 'object') {
      for (const [key, value] of Object.entries(stored)) {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) positions.set(key, value);
      }
    }
  } catch { /* storage unavailable or corrupt: in-memory restoration still works */ }
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    try {
      const entries = [...positions.entries()].slice(-MAX_ENTRIES);
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch { /* quota or privacy mode: ignore */ }
  }, 150);
}

function save(key: string, route: string, y: number) {
  positions.delete(key);           // keep insertion order = recency, so the cap drops the oldest entries
  positions.set(key, y);
  routePositions.set(route, y);
  persist();
}

const setWindowScroll = (y: number) => {
  try {
    window.scrollTo({ top: y, left: 0, behavior: 'instant' });
  } catch (_error) {
    void _error;
  }
  if (typeof window !== 'undefined' && window.scrollY !== y) {
    window.scrollTo(0, y);
  }
};

/** BrowserRouter stores the entry key in history.state; without one (memory routers, the initial entry) every entry counts as current. */
const isCurrentHistoryEntry = (key: string) => {
  const state: unknown = window.history.state;
  const entryKey = state !== null && typeof state === 'object' ? (state as { key?: unknown }).key : undefined;
  return typeof entryKey !== 'string' || entryKey === key;
};

const scrollToTopSmoothly = () => {
  const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  try {
    window.scrollTo({ top: 0, left: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  } catch (_error) {
    void _error;
  }
};

/** True once the document can scroll to `y` (or has no layout at all, e.g. jsdom, where waiting would never end). */
const canReach = (y: number) => {
  const height = document.documentElement.scrollHeight;
  return height === 0 || height - window.innerHeight >= y - 1;
};

const INPUT_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

/**
 * The first entry of a tab has no router key ("default") until the visitor navigates. Its position is stored per URL so a
 * reload or a Back into it still finds it, and only a document load that really returns to an entry (reload or
 * back/forward, per Navigation Timing) restores on first render: typing or opening a URL afresh always starts at the top.
 */
const entryKey = (key: string, route: string) => key === 'default' ? `default:${route}` : key;
const documentReturnedToEntry = () => {
  try {
    const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    return entry?.type === 'reload' || entry?.type === 'back_forward';
  } catch {
    return false;
  }
};

export function CustomerScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const initialized = useRef(false);

  useLayoutEffect(() => {
    const previousMode = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = previousMode; };
  }, []);

  useLayoutEffect(() => {
    hydrate();
    const firstVisit = !initialized.current;
    initialized.current = true;
    let frame = 0;
    let cancelled = false;
    let restoring = false;
    // Payment entry/recovery must never replay a footer position from history.
    const paymentRoute = location.pathname === '/checkout' || location.pathname.startsWith('/checkout/') ||
      location.pathname.startsWith('/account/payment-status/') || location.pathname.startsWith('/account/payment-retry/');
    const smoothTop = (location.state as { smoothTop?: unknown } | null)?.smoothTop === true;
    const route = routeKey(location.pathname, location.search);
    const key = entryKey(location.key, route);
    // In-app Back/Forward always restores; the first render restores only for a reload or a back/forward document load.
    const restorable = navigationType === 'POP' && (!firstVisit || documentReturnedToEntry());
    const position = restorable ? positions.get(key) ?? routePositions.get(route) : undefined;
    // A navigation that is still pending (e.g. a lazy route downloading) has already moved the browser to the next history
    // entry while this page is on screen; scrolling in that window must not overwrite the position saved for this page.
    const remember = () => {
      if (restoring || !isCurrentHistoryEntry(location.key)) return;
      save(key, route, window.scrollY);
    };
    const stopRestoring = () => {
      if (!restoring) return;
      restoring = false;
      window.cancelAnimationFrame(frame);
      for (const type of INPUT_EVENTS) window.removeEventListener(type, stopRestoring, true);
    };

    if (paymentRoute) {
      setWindowScroll(0);
      frame = window.requestAnimationFrame(() => {
        if (!cancelled) { setWindowScroll(0); remember(); }
      });
    } else if (position !== undefined) {
      restoring = true;
      for (const type of INPUT_EVENTS) window.addEventListener(type, stopRestoring, { capture: true, passive: true });
      const started = performance.now();
      const attempt = () => {
        if (cancelled || !restoring) return;
        const timedOut = performance.now() - started > RESTORE_TIMEOUT_MS;
        if (canReach(position) || timedOut) {
          setWindowScroll(position);
          stopRestoring();
          remember();
          return;
        }
        // Not tall enough yet: stay at the top of the loading page rather than at its clamped bottom.
        if (window.scrollY !== 0) setWindowScroll(0);
        frame = window.requestAnimationFrame(attempt);
      };
      frame = window.requestAnimationFrame(attempt);
    } else if (smoothTop && navigationType !== 'POP') {
      scrollToTopSmoothly();
    } else if (firstVisit || navigationType === 'PUSH') {
      setWindowScroll(0);
    }
    // Record the settled position now, so a page that is never scrolled keeps it after the cleanup below stops recording.
    if (position === undefined) remember();

    window.addEventListener('scroll', remember, { passive: true });
    return () => {
      cancelled = true;
      // An effect re-run or remount while a restore is still pending (the page held at the top of its loader) must not
      // record that placeholder position over the one being restored.
      const wasRestoring = restoring;
      stopRestoring();
      window.cancelAnimationFrame(frame);
      if (!wasRestoring) remember();
      window.removeEventListener('scroll', remember);
    };
  }, [location.key, location.pathname, location.search, location.state, navigationType]);

  return null;
}
